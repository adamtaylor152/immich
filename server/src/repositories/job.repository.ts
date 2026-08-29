import { getQueueToken } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { ModuleRef, Reflector } from '@nestjs/core';
import { Job, JobsOptions, Queue, Worker, type WorkerOptions } from 'bullmq';
import { setTimeout } from 'node:timers/promises';
import { JobConfig } from 'src/decorators';
import { QueueJobResponseDto, QueueJobSearchDto } from 'src/dtos/queue.dto';
import { ImmichWorker, JobName, JobStatus, MetadataKey, QueueCleanType, QueueJobStatus, QueueName } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { JobCounts, JobItem, JobOf } from 'src/types';
import { getKeyByValue, getMethodNames, ImmichStartupError } from 'src/utils/misc';

type JobMapItem = {
  jobName: JobName;
  queueName: QueueName;
  handler: (job: JobOf<any>) => Promise<JobStatus>;
  label: string;
};

export const getForkSchemaBackfillJobOptions = (kind: JobOf<JobName.ForkSchemaBackfill>['kind']): JobsOptions => ({
  deduplication: { id: `${JobName.ForkSchemaBackfill}:${kind}`, keepLastIfActive: true },
});

const DATABASE_BACKUP_LOCK_DURATION = 30 * 60_000;

/**
 * Size of the per-job-name ring buffer used to compute a rolling average of
 * job completion duration. Sized for steady-state image-description workloads
 * (~10s/job, 100 samples ≈ last ~16 minutes of activity) — large enough to
 * smooth out outliers, small enough that fresh hardware/model changes are
 * reflected in the estimate within a few minutes of activity.
 */
const ROLLING_AVG_BUFFER_SIZE = 100;
const WORKER_WATCH_INTERVAL_MS = 30_000;

@Injectable()
export class JobRepository {
  private workers: Partial<Record<QueueName, Worker>> = {};
  private handlers: Partial<Record<JobName, JobMapItem>> = {};
  private workerWatcher?: ReturnType<typeof setInterval>;
  private microservicesPresent = true;

  /**
   * In-memory ring buffer of per-job-name completion durations (ms).
   *
   * - Populated by the BullMQ Worker `completed` event (finishedOn - processedOn).
   * - Bounded to ROLLING_AVG_BUFFER_SIZE entries; oldest entries are dropped first.
   * - Resets on process restart — acceptable for v1. A persistent store would
   *   require schema churn for marginal value (admin only consults this when
   *   estimating the cost of a one-shot re-queue).
   * - Not shared across workers; each Node process keeps its own buffer. The
   *   single-process default deployment means the API process happens to see
   *   every completion event it owns, which is good enough for an estimate.
   */
  private rollingAvgBuffers: Partial<Record<JobName, number[]>> = {};

  constructor(
    private moduleRef: ModuleRef,
    private configRepository: ConfigRepository,
    private eventRepository: EventRepository,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(JobRepository.name);
  }

  setup(services: (new (...args: any[]) => unknown)[]) {
    const reflector = this.moduleRef.get(Reflector, { strict: false });

    // discovery
    for (const Service of services) {
      const instance = this.moduleRef.get<any>(Service);
      for (const methodName of getMethodNames(instance)) {
        const handler = instance[methodName];
        const config = reflector.get<JobConfig>(MetadataKey.JobConfig, handler);
        if (!config) {
          continue;
        }

        const { name: jobName, queue: queueName } = config;
        const label = `${Service.name}.${handler.name}`;

        // one handler per job
        if (Object.hasOwn(this.handlers, jobName)) {
          const jobKey = getKeyByValue(JobName, jobName);
          const errorMessage = `Failed to add job handler for ${label}`;
          this.logger.error(
            `${errorMessage}. JobName.${jobKey} is already handled by ${this.handlers[jobName]!.label}.`,
          );
          throw new ImmichStartupError(errorMessage);
        }

        this.handlers[jobName] = {
          label,
          jobName,
          queueName,
          handler: handler.bind(instance),
        };

        this.logger.verbose(`Added job handler: ${jobName} => ${label}`);
      }
    }

    // no missing handlers
    for (const [jobKey, jobName] of Object.entries(JobName)) {
      const item = this.handlers[jobName];
      if (!item) {
        const errorMessage = `Failed to find job handler for Job.${jobKey} ("${jobName}")`;
        this.logger.error(
          `${errorMessage}. Make sure to add the @OnJob({ name: JobName.${jobKey}, queue: QueueName.XYZ }) decorator for the new job.`,
        );
        throw new ImmichStartupError(errorMessage);
      }
    }
  }

  startWorkers() {
    const { bull } = this.configRepository.getEnv();
    for (const queueName of Object.values(QueueName)) {
      this.logger.debug(`Starting worker for queue: ${queueName}`);
      this.workers[queueName] = new Worker(
        queueName,
        (job) => this.processJob(queueName, job),
        this.getWorkerOptions(queueName, bull.config as WorkerOptions),
      );
      this.registerWorkerEvents(queueName, this.workers[queueName]);
    }
  }

  private getWorkerOptions(queueName: QueueName, bullConfig: WorkerOptions): WorkerOptions {
    const workerOptions: WorkerOptions = { ...bullConfig, concurrency: 1, name: ImmichWorker.Microservices };

    if (queueName === QueueName.BackupDatabase) {
      workerOptions.lockDuration = DATABASE_BACKUP_LOCK_DURATION;
      workerOptions.lockRenewTime = DATABASE_BACKUP_LOCK_DURATION / 2;
    }

    return workerOptions;
  }

  private async processJob(queueName: QueueName, job: Job): Promise<void> {
    try {
      await this.eventRepository.emit('JobRun', queueName, job as JobItem);
    } catch (error: any) {
      this.logger.error(`Unable to process job ${job.name} in queue ${queueName}: ${error}`, error?.stack);
      throw error;
    }
  }

  private registerWorkerEvents(queueName: QueueName, worker?: Worker) {
    worker?.on('error', (error) => {
      this.logger.error(`Queue worker error in ${queueName}: ${error}`, error?.stack);
    });

    worker?.on('failed', (job, error) => {
      this.logger.error(`Job ${job?.name || 'unknown'} failed in queue ${queueName}: ${error}`, error?.stack);
    });

    worker?.on('stalled', (jobId, previous) => {
      this.logger.warn(`Job ${jobId} stalled in queue ${queueName} from ${previous}`);
    });

    worker?.on('completed', (job) => {
      // BullMQ sets processedOn when the worker picks the job up and
      // finishedOn when the handler resolves. Both are present on `completed`
      // events; guard defensively to avoid crashing on any future BullMQ
      // changes.
      const startedAt = job.processedOn;
      const finishedAt = job.finishedOn;
      if (startedAt === undefined || finishedAt === undefined || finishedAt < startedAt) {
        return;
      }
      const duration = finishedAt - startedAt;
      this.recordRollingAvgSample(job.name as JobName, duration);
    });
  }

  private recordRollingAvgSample(name: JobName, durationMs: number) {
    let buffer = this.rollingAvgBuffers[name];
    if (!buffer) {
      buffer = [];
      this.rollingAvgBuffers[name] = buffer;
    }
    buffer.push(durationMs);
    if (buffer.length > ROLLING_AVG_BUFFER_SIZE) {
      // Drop the oldest sample. shift() is O(n) but n is bounded at 100, so
      // even a hot description queue won't notice. If this gets hot we can
      // swap in a true ring buffer with a write index.
      buffer.shift();
    }
  }

  /**
   * Returns the rolling-average completion duration (ms) for the given job
   * name, or `null` if no samples have been recorded since process start.
   * Used by the admin re-queue cost estimator to show a realistic wall-clock
   * estimate that reflects the user's actual hardware.
   */
  getRollingAvgMs(name: JobName): number | null {
    const buffer = this.rollingAvgBuffers[name];
    if (!buffer || buffer.length === 0) {
      return null;
    }
    let sum = 0;
    for (const sample of buffer) {
      sum += sample;
    }
    return sum / buffer.length;
  }

  watchWorkers() {
    this.workerWatcher ??= setInterval(() => void this.checkWorkers(), WORKER_WATCH_INTERVAL_MS);
  }

  teardown() {
    if (!this.workerWatcher) {
      return;
    }

    clearInterval(this.workerWatcher);
    this.workerWatcher = undefined;
  }

  private async checkWorkers() {
    let isPresent: boolean;
    try {
      const suffix = `:w:${ImmichWorker.Microservices}`;
      const workers = await this.getQueue(QueueName.BackgroundTask).getWorkers();
      isPresent = workers.some((worker) => worker.rawname?.endsWith(suffix));
    } catch {
      return;
    }

    if (this.microservicesPresent !== isPresent) {
      if (isPresent) {
        this.logger.log('Microservices worker connected.');
      } else {
        this.logger.warn(
          'No microservices worker is connected. Background jobs will not be processed until one is running.',
        );
      }
    }
    this.microservicesPresent = isPresent;
  }

  async run({ name, data }: JobItem) {
    const item = this.handlers[name as JobName];
    if (!item) {
      this.logger.warn(`Skipping unknown job: "${name}"`);
      return JobStatus.Skipped;
    }

    return item.handler(data);
  }

  setConcurrency(queueName: QueueName, concurrency: number) {
    const worker = this.workers[queueName];
    if (!worker) {
      this.logger.warn(`Unable to set queue concurrency, worker not found: '${queueName}'`);
      return;
    }

    worker.concurrency = concurrency;
  }

  async isActive(name: QueueName): Promise<boolean> {
    const queue = this.getQueue(name);
    const count = await queue.getActiveCount();
    return count > 0;
  }

  async isPaused(name: QueueName): Promise<boolean> {
    return this.getQueue(name).isPaused();
  }

  pause(name: QueueName) {
    return this.getQueue(name).pause();
  }

  resume(name: QueueName) {
    return this.getQueue(name).resume();
  }

  empty(name: QueueName) {
    return this.getQueue(name).drain();
  }

  clear(name: QueueName, type: QueueCleanType) {
    return this.getQueue(name).clean(0, 1000, type);
  }

  getJobCounts(name: QueueName): Promise<JobCounts> {
    return this.getQueue(name).getJobCounts(
      'active',
      'completed',
      'failed',
      'delayed',
      'waiting',
      'paused',
    ) as unknown as Promise<JobCounts>;
  }

  /**
   * Check whether a deduplicated job (via BullMQ dedup id) is currently
   * in-flight on the given queue. Used to surface the "already running"
   * state for one-shot admin-triggered jobs that share a queue with others
   * (e.g. SmartAlbumReevaluateAll on BackgroundTask).
   */
  async hasDedupJob(name: QueueName, dedupId: string): Promise<boolean> {
    const jobId = await this.getQueue(name).getDeduplicationJobId(dedupId);
    return jobId !== null && jobId !== undefined;
  }

  private getQueueName(name: JobName) {
    return (this.handlers[name] as JobMapItem).queueName;
  }

  async queueAll(items: JobItem[]): Promise<void> {
    if (items.length === 0) {
      return;
    }

    const promises = [];
    const itemsByQueue = {} as Record<string, (JobItem & { data: any; options: JobsOptions | undefined })[]>;
    for (const item of items) {
      const queueName = this.getQueueName(item.name);
      const job = {
        name: item.name,
        data: item.data || {},
        options: this.getJobOptions(item) || undefined,
      } as JobItem & { data: any; options: JobsOptions | undefined };

      if (job.options?.jobId || job.options?.deduplication) {
        // need to use add() instead of addBulk() for jobId/deduplication to take effect
        promises.push(this.getQueue(queueName).add(item.name, item.data, job.options));
      } else {
        itemsByQueue[queueName] ||= [];
        itemsByQueue[queueName].push(job);
      }
    }

    for (const [queueName, jobs] of Object.entries(itemsByQueue)) {
      const queue = this.getQueue(queueName as QueueName);
      promises.push(queue.addBulk(jobs));
    }

    await Promise.all(promises);
  }

  async queue(item: JobItem): Promise<void> {
    return this.queueAll([item]);
  }

  async waitForQueueCompletion(...queues: QueueName[]): Promise<void> {
    const getPending = async () => {
      const results = await Promise.all(queues.map(async (name) => ({ pending: await this.isActive(name), name })));
      return results.filter(({ pending }) => pending).map(({ name }) => name);
    };

    let pending = await getPending();

    while (pending.length > 0) {
      this.logger.verbose(`Waiting for ${pending[0]} queue to stop...`);
      await setTimeout(1000);
      pending = await getPending();
    }
  }

  async searchJobs(name: QueueName, dto: QueueJobSearchDto): Promise<QueueJobResponseDto[]> {
    const jobs = await this.getQueue(name).getJobs(dto.status ?? Object.values(QueueJobStatus), 0, 1000);
    return jobs.map((job) => {
      const { id, name, timestamp, data } = job;
      return { id, name: name as JobName, timestamp, data };
    });
  }

  private getJobOptions(item: JobItem): JobsOptions | null {
    switch (item.name) {
      case JobName.NotifyAlbumUpdate: {
        return {
          jobId: `${item.data.id}/${item.data.recipientId}`,
          delay: item.data?.delay,
        };
      }
      case JobName.StorageTemplateMigrationSingle: {
        return { jobId: item.data.id };
      }
      case JobName.PersonGenerateThumbnail: {
        return { priority: 1 };
      }
      case JobName.FacialRecognitionQueueAll: {
        return { deduplication: { id: JobName.FacialRecognitionQueueAll } };
      }
      case JobName.ImageDescriptionQueueAll: {
        return { deduplication: { id: JobName.ImageDescriptionQueueAll } };
      }
      case JobName.ForkSchemaBackfill: {
        return getForkSchemaBackfillJobOptions(item.data.kind);
      }
      case JobName.SmartAlbumReevaluateAll: {
        // Kind-scoped dispatches get their own dedup namespace so they don't
        // collide with each other OR with the all-kinds dispatch. This lets
        // an admin queue (e.g.) "food" and "pets" simultaneously without
        // BullMQ silently dropping the second one as a duplicate of the first.
        const kind = (item.data as { kind?: string } | undefined)?.kind;
        const dedupId = kind ? `${JobName.SmartAlbumReevaluateAll}:${kind}` : JobName.SmartAlbumReevaluateAll;
        return { deduplication: { id: dedupId } };
      }
      case JobName.VersionCheck: {
        return { deduplication: { id: JobName.VersionCheck } };
      }
      case JobName.DatabaseBackup: {
        return { deduplication: { id: JobName.DatabaseBackup } };
      }
      default: {
        return null;
      }
    }
  }

  private getQueue(queue: QueueName): Queue {
    return this.moduleRef.get<Queue>(getQueueToken(queue), { strict: false });
  }

  /** @deprecated */
  // todo: remove this when asset notifications no longer need it.
  public async removeJob(name: JobName, jobID: string): Promise<void> {
    const existingJob = await this.getQueue(this.getQueueName(name)).getJob(jobID);
    if (existingJob) {
      await existingJob.remove();
    }
  }
}
