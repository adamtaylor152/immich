import { ModuleRef } from '@nestjs/core';
import { JobsOptions } from 'bullmq';
import { JobName, QueueName } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { JobItem } from 'src/types';

const mocks = vi.hoisted(() => ({
  worker: vi.fn(() => ({ on: vi.fn() })),
}));

vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<typeof import('bullmq')>()),
  Worker: mocks.worker,
}));

/**
 * Drives the worker `completed` listener directly. startWorkers() registers
 * one Worker per queue; each Worker mock captures its `on(event, handler)`
 * calls so we can replay synthetic completion events.
 */
const completedHandlerFor = (queueName: QueueName): ((job: Record<string, unknown>) => void) => {
  const workerCalls = mocks.worker.mock.calls as unknown as Array<[QueueName, unknown, unknown]>;
  const idx = workerCalls.findIndex(([qn]) => qn === queueName);
  if (idx === -1) {
    throw new Error(`Worker for ${queueName} was never created`);
  }
  const workerInstance = mocks.worker.mock.results[idx].value as { on: ReturnType<typeof vi.fn> };
  const onCalls = workerInstance.on.mock.calls as unknown as Array<[string, (job: any) => void]>;
  const completed = onCalls.find(([event]) => event === 'completed');
  if (!completed) {
    throw new Error(`No completed listener registered for ${queueName}`);
  }
  return completed[1];
};

describe(JobRepository.name, () => {
  let sut: JobRepository;

  beforeEach(() => {
    mocks.worker.mockClear();

    sut = new JobRepository(
      {} as ModuleRef,
      {
        getEnv: () => ({
          bull: {
            config: {
              connection: {},
              prefix: 'immich_bull',
            },
          },
        }),
      } as ConfigRepository,
      {} as EventRepository,
      {
        debug: vi.fn(),
        error: vi.fn(),
        setContext: vi.fn(),
        warn: vi.fn(),
      } as unknown as LoggingRepository,
    );
  });

  it('should use a longer lock for the database backup worker', () => {
    sut.startWorkers();

    const workerCalls = mocks.worker.mock.calls as unknown as Array<[QueueName, unknown, Record<string, unknown>]>;
    const backupWorkerCall = workerCalls.find(([queueName]) => queueName === QueueName.BackupDatabase);
    const backgroundWorkerCall = workerCalls.find(([queueName]) => queueName === QueueName.BackgroundTask);

    expect(backupWorkerCall?.[2]).toMatchObject({
      concurrency: 1,
      lockDuration: 30 * 60_000,
      lockRenewTime: 15 * 60_000,
    });
    expect(backgroundWorkerCall?.[2]).not.toHaveProperty('lockDuration');
    expect(mocks.worker).toHaveBeenCalled();
  });

  it('deduplicates fork schema batches per kind', () => {
    const getJobOptions = (sut as unknown as { getJobOptions(item: JobItem): JobsOptions | null }).getJobOptions.bind(
      sut,
    );

    expect(getJobOptions({ name: JobName.ForkSchemaBackfill, data: { kind: 'privacy', batchSize: 100 } })).toEqual({
      deduplication: { id: `${JobName.ForkSchemaBackfill}:privacy` },
    });
    expect(getJobOptions({ name: JobName.ForkSchemaBackfill, data: { kind: 'albums', batchSize: 100 } })).toEqual({
      deduplication: { id: `${JobName.ForkSchemaBackfill}:albums` },
    });
  });

  describe('getRollingAvgMs (job completion telemetry)', () => {
    it('returns null when no samples have been recorded', () => {
      sut.startWorkers();
      expect(sut.getRollingAvgMs(JobName.ImageDescription)).toBeNull();
    });

    it('averages recorded completion durations', () => {
      sut.startWorkers();
      const handler = completedHandlerFor(QueueName.ImageDescription);

      handler({ name: JobName.ImageDescription, processedOn: 1000, finishedOn: 2000 });
      handler({ name: JobName.ImageDescription, processedOn: 5000, finishedOn: 7000 });
      handler({ name: JobName.ImageDescription, processedOn: 10_000, finishedOn: 13_000 });

      // (1000 + 2000 + 3000) / 3 = 2000
      expect(sut.getRollingAvgMs(JobName.ImageDescription)).toBe(2000);
    });

    it('caps the buffer at 100 samples (oldest dropped first)', () => {
      sut.startWorkers();
      const handler = completedHandlerFor(QueueName.ImageDescription);

      // Push 105 samples: 5 quick (100ms) then 100 slow (1000ms). After
      // ROLLING_AVG_BUFFER_SIZE=100 fills, the 5 quick ones get dropped and
      // only the 100 slow ones remain -> avg = 1000.
      for (let i = 0; i < 5; i++) {
        handler({ name: JobName.ImageDescription, processedOn: 0, finishedOn: 100 });
      }
      for (let i = 0; i < 100; i++) {
        handler({ name: JobName.ImageDescription, processedOn: 0, finishedOn: 1000 });
      }

      expect(sut.getRollingAvgMs(JobName.ImageDescription)).toBe(1000);
    });

    it('ignores events with missing or inverted timestamps', () => {
      sut.startWorkers();
      const handler = completedHandlerFor(QueueName.ImageDescription);

      handler({ name: JobName.ImageDescription, processedOn: undefined, finishedOn: 1000 });
      handler({ name: JobName.ImageDescription, processedOn: 1000, finishedOn: undefined });
      handler({ name: JobName.ImageDescription, processedOn: 2000, finishedOn: 1000 });

      expect(sut.getRollingAvgMs(JobName.ImageDescription)).toBeNull();

      handler({ name: JobName.ImageDescription, processedOn: 0, finishedOn: 500 });
      expect(sut.getRollingAvgMs(JobName.ImageDescription)).toBe(500);
    });

    it('keeps buffers per job name', () => {
      sut.startWorkers();
      const imageDescriptionHandler = completedHandlerFor(QueueName.ImageDescription);
      const ocrHandler = completedHandlerFor(QueueName.Ocr);

      imageDescriptionHandler({ name: JobName.ImageDescription, processedOn: 0, finishedOn: 1000 });
      ocrHandler({ name: JobName.Ocr, processedOn: 0, finishedOn: 5000 });

      expect(sut.getRollingAvgMs(JobName.ImageDescription)).toBe(1000);
      expect(sut.getRollingAvgMs(JobName.Ocr)).toBe(5000);
    });
  });
});
