import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { OnEvent } from 'src/decorators';
import { RunPodBackfillResultDto, RunPodGpuTypeDto, RunPodProvisionDto, RunPodStateDto } from 'src/dtos/runpod.dto';
import {
  BootstrapEventPriority,
  DatabaseLock,
  ImmichWorker,
  JobName,
  NotificationLevel,
  NotificationType,
  SystemMetadataKey,
} from 'src/enum';
import { ArgOf } from 'src/repositories/event.repository';
import { RunPodApiError, RunPodNotFoundError, RunPodPodSummary } from 'src/repositories/runpod.repository';
import { BaseService } from 'src/services/base.service';
import { RunPodPersistedState } from 'src/types';

// Job names whose successful (or failed) execution counts as ML activity.
// If any of these run, we know the pod was useful in the recent window.
const ML_JOB_NAMES: ReadonlySet<JobName> = new Set([
  JobName.AssetDetectFaces,
  JobName.AssetDetectDuplicates,
  JobName.SmartSearch,
  JobName.Ocr,
  JobName.ImageDescription,
  JobName.NsfwDetection,
]);

// Queues to start when the user clicks "Run ML backfill" or auto-backfill is on.
// Mirrors the buttons in /admin/queues. Use callbacks so each call is typed
// against the JobItem union without `as never` casts.
const ML_BACKFILL_QUEUES: Array<{ name: string; enqueue: (job: { queue: (item: any) => Promise<unknown> }) => Promise<unknown> }> = [
  {
    name: 'smartSearch',
    enqueue: (job) => job.queue({ name: JobName.SmartSearchQueueAll, data: { force: false } }),
  },
  {
    name: 'faceDetection',
    enqueue: (job) => job.queue({ name: JobName.AssetDetectFacesQueueAll, data: { force: false } }),
  },
  {
    name: 'duplicateDetection',
    enqueue: (job) => job.queue({ name: JobName.AssetDetectDuplicatesQueueAll, data: { force: false } }),
  },
  {
    name: 'ocr',
    enqueue: (job) => job.queue({ name: JobName.OcrQueueAll, data: { force: false } }),
  },
  {
    name: 'imageDescription',
    enqueue: (job) => job.queue({ name: JobName.ImageDescriptionQueueAll, data: { force: false } }),
  },
  {
    name: 'nsfwDetection',
    enqueue: (job) => job.queue({ name: JobName.NsfwDetectionQueueAll, data: { force: false } }),
  },
];

const PROVISION_TIMEOUT_MS = 5 * 60 * 1000; // pod must reach RUNNING within 5 min
const UNHEALTHY_GRACE_MS = 5 * 60 * 1000; // pod RUNNING-but-unresponsive grace
const STOP_MAX_ATTEMPTS = 5;
const TICK_INTERVAL_MS = 30_000;
const ML_PORT = 3003;
const ML_AUTH_ENV = 'IMMICH_ML_AUTH_TOKEN';

@Injectable()
export class RunPodService extends BaseService {
  private tickHandle?: ReturnType<typeof setInterval>;
  private currentApiKey = '';

  @OnEvent({ name: 'ConfigInit', priority: BootstrapEventPriority.SystemConfig + 1 })
  async onConfigInit({ newConfig }: ArgOf<'ConfigInit'>) {
    this.currentApiKey = newConfig.machineLearning.runpod.apiKey;
    await this.syncManagedUrl();
    this.startTicker();
  }

  @OnEvent({ name: 'AppShutdown' })
  onShutdown() {
    this.stopTicker();
  }

  @OnEvent({ name: 'ConfigUpdate', server: true })
  async onConfigUpdate({ newConfig }: ArgOf<'ConfigUpdate'>) {
    this.currentApiKey = newConfig.machineLearning.runpod.apiKey;
    await this.syncManagedUrl();
  }

  @OnEvent({ name: 'JobSuccess' })
  onJobSuccess({ job }: ArgOf<'JobSuccess'>) {
    void this.recordBusy(job.name);
  }

  @OnEvent({ name: 'JobError' })
  onJobError({ job }: ArgOf<'JobError'>) {
    void this.recordBusy(job.name);
  }

  // ── Admin actions ──────────────────────────────────────────────────────

  async testConnection(overrideKey?: string): Promise<{ ok: boolean; message?: string }> {
    const key = overrideKey?.trim() || (await this.getApiKey());
    if (!key) {
      return { ok: false, message: 'No API key configured' };
    }
    try {
      await this.runPodRepository.testApiKey(key);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async listGpuTypes(): Promise<RunPodGpuTypeDto[]> {
    const key = await this.requireApiKey();
    const types = await this.runPodRepository.listGpuTypes(key);
    return types.map((t) => ({
      id: t.id,
      displayName: t.displayName,
      memoryInGb: t.memoryInGb,
      pricePerHour: t.pricePerHour ?? null,
      secureCloud: t.secureCloud,
      communityCloud: t.communityCloud,
    }));
  }

  async getCurrentState(): Promise<RunPodStateDto> {
    const state = await this.loadState();
    return this.mapStateToDto(state);
  }

  async provision(dto: RunPodProvisionDto): Promise<RunPodStateDto> {
    if (!dto.acknowledgeDataPrivacy) {
      throw new BadRequestException('Data privacy acknowledgement required to launch a pod');
    }
    const config = await this.getConfig({ withCache: false });
    const runpod = config.machineLearning.runpod;
    if (!runpod.enabled) {
      throw new BadRequestException('RunPod integration is not enabled');
    }

    const key = await this.requireApiKey();
    const state = await this.loadState();
    if (state.status !== 'idle' && state.status !== 'error') {
      throw new BadRequestException(`Cannot provision while pod is ${state.status}`);
    }

    // Persist the privacy ack and the max runtime hours back to config if changed.
    if (!runpod.dataPrivacyAcknowledged || (dto.maxRuntimeHours && dto.maxRuntimeHours !== runpod.maxRuntimeHours)) {
      const next = JSON.parse(JSON.stringify(config));
      next.machineLearning.runpod.dataPrivacyAcknowledged = true;
      if (dto.maxRuntimeHours) {
        next.machineLearning.runpod.maxRuntimeHours = dto.maxRuntimeHours;
      }
      await this.updateConfig(next);
    }

    const instanceTag = state.status === 'idle' && !state.instanceTag ? randomUUID() : (state.instanceTag ?? randomUUID());
    const authToken = randomBytes(32).toString('hex');
    const imageName = dto.imageName?.trim() || runpod.imageName;
    const podName = `immich-${instanceTag.slice(0, 8)}-${Math.floor(Date.now() / 1000)}`;

    let created: RunPodPodSummary;
    try {
      created = await this.runPodRepository.createPod(key, {
        name: podName,
        imageName,
        gpuTypeIds: [dto.gpuTypeId],
        gpuCount: dto.gpuCount ?? 1,
        containerDiskInGb: runpod.containerDiskGb,
        volumeInGb: runpod.volumeGb,
        volumeMountPath: '/cache',
        ports: [`${ML_PORT}/http`],
        env: {
          [ML_AUTH_ENV]: authToken,
          MACHINE_LEARNING_CACHE_FOLDER: '/cache',
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.writeState({
        status: 'error',
        message: `Failed to create pod: ${message}`,
        errorAt: new Date().toISOString(),
        instanceTag,
      });
      throw new BadRequestException(message);
    }

    const next: RunPodPersistedState = {
      status: 'provisioning',
      podId: created.id,
      podCreatedAt: new Date().toISOString(),
      gpuTypeId: dto.gpuTypeId,
      imageName,
      authToken,
      instanceTag,
    };
    await this.writeState(next);
    this.logger.log(`RunPod pod created: ${created.id} (${imageName}) tag=${instanceTag}`);
    // Kick the reconcile poll without waiting.
    void this.reconcile().catch((error) => this.logger.warn(`Initial reconcile failed: ${error}`));
    return this.mapStateToDto(next);
  }

  async stop(): Promise<RunPodStateDto> {
    const state = await this.loadState();
    if (state.status === 'idle') {
      throw new BadRequestException('No pod to stop');
    }
    if (state.status === 'error' || state.status === 'stopped' || state.status === 'stopping') {
      return this.mapStateToDto(state);
    }
    if (!('podId' in state) || !state.podId) {
      throw new BadRequestException('No pod id on current state');
    }
    const next: RunPodPersistedState = {
      status: 'stopping',
      podId: state.podId,
      podCreatedAt: 'podCreatedAt' in state ? state.podCreatedAt : undefined,
      gpuTypeId: 'gpuTypeId' in state ? state.gpuTypeId : 'unknown',
      imageName: 'imageName' in state ? (state.imageName ?? '') : '',
      authToken: 'authToken' in state ? state.authToken : '',
      instanceTag: state.instanceTag ?? randomUUID(),
      stopAttempts: 0,
    };
    await this.writeState(next);
    await this.syncManagedUrl();
    void this.attemptStop(next).catch((error) => this.logger.warn(`Initial stop attempt failed: ${error}`));
    return this.mapStateToDto(next);
  }

  async start(): Promise<RunPodStateDto> {
    const state = await this.loadState();
    if (state.status !== 'stopped') {
      throw new BadRequestException(`Cannot start pod while status is ${state.status}`);
    }
    const key = await this.requireApiKey();
    try {
      await this.runPodRepository.startPod(key, state.podId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(`RunPod start failed: ${message}`);
    }
    const next: RunPodPersistedState = {
      status: 'starting',
      podId: state.podId,
      podCreatedAt: state.podCreatedAt,
      gpuTypeId: state.gpuTypeId,
      imageName: state.imageName,
      authToken: state.authToken,
      instanceTag: state.instanceTag,
    };
    await this.writeState(next);
    void this.reconcile().catch((error) => this.logger.warn(`Reconcile after start failed: ${error}`));
    return this.mapStateToDto(next);
  }

  async terminate(): Promise<RunPodStateDto> {
    const state = await this.loadState();
    if (state.status === 'idle') {
      throw new BadRequestException('No pod to terminate');
    }
    if (!('podId' in state) || !state.podId) {
      throw new BadRequestException('No pod id on current state');
    }
    const key = await this.requireApiKey();
    try {
      await this.runPodRepository.terminatePod(key, state.podId);
    } catch (error) {
      if (!(error instanceof RunPodNotFoundError)) {
        const message = error instanceof Error ? error.message : String(error);
        throw new BadRequestException(`RunPod terminate failed: ${message}`);
      }
    }
    const next: RunPodPersistedState = { status: 'idle', instanceTag: state.instanceTag };
    await this.writeState(next);
    await this.syncManagedUrl();
    return this.mapStateToDto(next);
  }

  async runBackfill(): Promise<RunPodBackfillResultDto> {
    const state = await this.loadState();
    if (state.status !== 'running') {
      throw new BadRequestException(`Cannot start backfill while pod is ${state.status}`);
    }
    return this.enqueueBackfill();
  }

  // ── Periodic reconciler ────────────────────────────────────────────────

  private startTicker() {
    if (this.tickHandle || this.worker !== ImmichWorker.Api) {
      // pin the reconciler timer to the Api worker; other workers still
      // refresh their ML URL on ConfigInit/Update + JobSuccess events.
      return;
    }
    this.tickHandle = setInterval(() => {
      void this.reconcile().catch((error) => this.logger.warn(`RunPod reconcile failed: ${error}`));
    }, TICK_INTERVAL_MS);
  }

  private stopTicker() {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = undefined;
    }
  }

  /**
   * Periodic check: re-read state, poll the pod, advance the state machine,
   * trigger idle auto-stop / max-runtime / unhealthy-stop / stop-retry.
   * Safe to call on a 30s cadence; safe to call concurrently (advisory-locked).
   */
  private async reconcile() {
    await this.databaseRepository.withLock(DatabaseLock.RunPodTransition, async () => {
      const state = await this.loadState();
      switch (state.status) {
        case 'provisioning':
        case 'starting': {
          await this.pollPodToReady(state);
          break;
        }
        case 'running': {
          await this.tickRunning(state);
          break;
        }
        case 'stopping': {
          await this.attemptStop(state);
          break;
        }
        case 'stopped': {
          await this.verifyStopped(state);
          break;
        }
        case 'idle':
        case 'error':
        default:
          // nothing to reconcile
          break;
      }
    });
    await this.syncManagedUrl();
  }

  private async pollPodToReady(
    state: Extract<RunPodPersistedState, { status: 'provisioning' | 'starting' }>,
  ) {
    const key = await this.getApiKey();
    if (!key) {
      return;
    }

    const createdAtMs = Date.parse(state.podCreatedAt);
    if (!Number.isNaN(createdAtMs) && Date.now() - createdAtMs > PROVISION_TIMEOUT_MS) {
      await this.handleProvisionFailure(state, 'Pod did not reach RUNNING within 5 minutes');
      return;
    }

    let summary: RunPodPodSummary;
    try {
      summary = await this.runPodRepository.getPod(key, state.podId);
    } catch (error) {
      if (error instanceof RunPodNotFoundError) {
        await this.handleProvisionFailure(state, 'Pod no longer exists');
      } else {
        this.logger.warn(`getPod ${state.podId} failed: ${error}`);
      }
      return;
    }

    if (summary.desiredStatus !== 'RUNNING') {
      // Still bringing up; the next tick will re-check.
      if (state.status === 'provisioning') {
        await this.writeState({ ...state, status: 'starting' });
      }
      return;
    }

    const proxyUrl = this.runPodRepository.buildProxyUrl(state.podId, ML_PORT);
    const ready = await this.pingMl(proxyUrl);
    if (!ready) {
      // pod RUNNING but ML server not up yet; flip to 'starting' if not already
      if (state.status === 'provisioning') {
        await this.writeState({ ...state, status: 'starting' });
      }
      return;
    }

    const now = new Date().toISOString();
    const config = await this.getConfig({ withCache: false });
    await this.writeState({
      status: 'running',
      podId: state.podId,
      podCreatedAt: state.podCreatedAt,
      gpuTypeId: state.gpuTypeId,
      imageName: state.imageName,
      authToken: state.authToken,
      mlUrl: proxyUrl,
      runningSince: now,
      lastBusyAt: now,
      maxRuntimeHours: config.machineLearning.runpod.maxRuntimeHours,
      instanceTag: state.instanceTag,
    });
    this.logger.log(`RunPod pod ${state.podId} reached RUNNING; ML URL injected`);

    if (config.machineLearning.runpod.autoBackfillOnLaunch) {
      try {
        const result = await this.enqueueBackfill();
        this.logger.log(`Auto-backfill enqueued: ${result.enqueued.join(', ')}`);
      } catch (error) {
        this.logger.warn(`Auto-backfill failed: ${error}`);
      }
    }
  }

  private async tickRunning(state: Extract<RunPodPersistedState, { status: 'running' }>) {
    const key = await this.getApiKey();
    if (!key) {
      return;
    }

    // 1. Hard runtime ceiling: stop regardless of activity.
    const runningSinceMs = Date.parse(state.runningSince);
    if (!Number.isNaN(runningSinceMs) && Date.now() - runningSinceMs > state.maxRuntimeHours * 3600 * 1000) {
      this.logger.warn(`RunPod pod ${state.podId} hit maxRuntimeHours=${state.maxRuntimeHours}; forcing stop`);
      await this.notifyAdmin(
        NotificationLevel.Warning,
        'RunPod pod max runtime exceeded',
        `Pod ${state.podId} ran for more than ${state.maxRuntimeHours} hours and was force-stopped to prevent runaway billing.`,
      );
      await this.transitionRunningToStopping(state);
      return;
    }

    // 2. Out-of-band reconciliation: did someone kill the pod on RunPod.io?
    let summary: RunPodPodSummary;
    try {
      summary = await this.runPodRepository.getPod(key, state.podId);
    } catch (error) {
      if (error instanceof RunPodNotFoundError) {
        this.logger.warn(`Pod ${state.podId} disappeared; clearing managed URL`);
        await this.writeState({ status: 'idle', instanceTag: state.instanceTag });
        await this.notifyAdmin(
          NotificationLevel.Warning,
          'RunPod pod disappeared',
          `Pod ${state.podId} no longer exists on RunPod. ML jobs will fall back to local processing.`,
        );
        return;
      }
      this.logger.warn(`getPod ${state.podId} failed: ${error}`);
      return;
    }
    if (summary.desiredStatus !== 'RUNNING') {
      this.logger.log(`Pod ${state.podId} is no longer RUNNING (${summary.desiredStatus}); marking stopped`);
      await this.writeState({
        status: 'stopped',
        podId: state.podId,
        podCreatedAt: state.podCreatedAt,
        gpuTypeId: state.gpuTypeId,
        imageName: state.imageName,
        authToken: state.authToken,
        stoppedAt: new Date().toISOString(),
        instanceTag: state.instanceTag,
      });
      return;
    }

    // 3. Health check: ping the ML server through the proxy.
    const healthy = await this.pingMl(state.mlUrl, state.authToken);
    if (!healthy) {
      const unhealthySince = state.unhealthySince ?? new Date().toISOString();
      const ms = Date.now() - Date.parse(unhealthySince);
      if (Number.isFinite(ms) && ms > UNHEALTHY_GRACE_MS) {
        this.logger.warn(`Pod ${state.podId} unhealthy for >5min; stopping`);
        await this.notifyAdmin(
          NotificationLevel.Warning,
          'RunPod pod unhealthy',
          `Pod ${state.podId} stopped responding to /ping. Stopping it to avoid wasted billing.`,
        );
        await this.transitionRunningToStopping(state);
        return;
      }
      if (!state.unhealthySince) {
        await this.writeState({ ...state, unhealthySince });
      }
      return;
    }
    if (state.unhealthySince) {
      await this.writeState({ ...state, unhealthySince: undefined });
    }

    // 4. Idle auto-stop.
    const config = await this.getConfig({ withCache: false });
    const rp = config.machineLearning.runpod;
    if (rp.autoStopEnabled) {
      const lastBusyMs = Date.parse(state.lastBusyAt);
      const idleMs = Date.now() - lastBusyMs;
      if (Number.isFinite(idleMs) && idleMs > rp.autoStopGraceMinutes * 60 * 1000) {
        this.logger.log(`Pod ${state.podId} idle ${Math.round(idleMs / 60_000)}min; auto-stopping`);
        await this.transitionRunningToStopping(state);
      }
    }
  }

  private async attemptStop(state: Extract<RunPodPersistedState, { status: 'stopping' }>) {
    const key = await this.getApiKey();
    if (!key) {
      return;
    }
    try {
      await this.runPodRepository.stopPod(key, state.podId);
      const config = await this.getConfig({ withCache: false });
      this.logger.log(`Pod ${state.podId} stopped`);
      await this.writeState({
        status: 'stopped',
        podId: state.podId,
        podCreatedAt: state.podCreatedAt ?? new Date().toISOString(),
        gpuTypeId: state.gpuTypeId,
        imageName: state.imageName ?? config.machineLearning.runpod.imageName,
        authToken: state.authToken,
        stoppedAt: new Date().toISOString(),
        instanceTag: state.instanceTag,
      } as RunPodPersistedState);
      return;
    } catch (error) {
      if (error instanceof RunPodNotFoundError) {
        this.logger.log(`Pod ${state.podId} already gone; marking idle`);
        await this.writeState({ status: 'idle', instanceTag: state.instanceTag });
        return;
      }
      const attempts = state.stopAttempts + 1;
      const message = error instanceof Error ? error.message : String(error);
      if (attempts >= STOP_MAX_ATTEMPTS) {
        this.logger.error(`RunPod stop failed ${attempts} times: ${message}`);
        await this.notifyAdmin(
          NotificationLevel.Error,
          'RunPod stop failed',
          `Failed to stop pod ${state.podId} after ${attempts} attempts. Check the RunPod dashboard — it may still be billing. Error: ${message}`,
        );
        // Leave state as 'stopping' with the attempts counter so the next tick keeps trying.
      } else {
        this.logger.warn(`RunPod stop attempt ${attempts}/${STOP_MAX_ATTEMPTS} failed: ${message}`);
      }
      await this.writeState({ ...state, stopAttempts: attempts, lastStopAttemptAt: new Date().toISOString() });
    }
  }

  private async verifyStopped(state: Extract<RunPodPersistedState, { status: 'stopped' }>) {
    // Light-touch: if someone restarted the pod via the RunPod dashboard, flip back to starting.
    const key = await this.getApiKey();
    if (!key) {
      return;
    }
    try {
      const summary = await this.runPodRepository.getPod(key, state.podId);
      if (summary.desiredStatus === 'RUNNING') {
        this.logger.log(`Pod ${state.podId} unexpectedly running; reconciling to starting`);
        await this.writeState({
          status: 'starting',
          podId: state.podId,
          podCreatedAt: state.podCreatedAt,
          gpuTypeId: state.gpuTypeId,
          imageName: state.imageName,
          authToken: state.authToken,
          instanceTag: state.instanceTag,
        });
      }
    } catch (error) {
      if (error instanceof RunPodNotFoundError) {
        this.logger.log(`Stopped pod ${state.podId} no longer exists; marking idle`);
        await this.writeState({ status: 'idle', instanceTag: state.instanceTag });
      } else {
        this.logger.warn(`verifyStopped getPod failed: ${error}`);
      }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private async pingMl(baseUrl: string, authToken?: string): Promise<boolean> {
    try {
      const url = baseUrl.endsWith('/') ? `${baseUrl}ping` : `${baseUrl}/ping`;
      const response = await fetch(url, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        signal: AbortSignal.timeout(10_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async transitionRunningToStopping(state: Extract<RunPodPersistedState, { status: 'running' }>) {
    const next: RunPodPersistedState = {
      status: 'stopping',
      podId: state.podId,
      podCreatedAt: state.podCreatedAt,
      gpuTypeId: state.gpuTypeId,
      imageName: state.imageName,
      authToken: state.authToken,
      instanceTag: state.instanceTag,
      stopAttempts: 0,
    };
    await this.writeState(next);
    await this.syncManagedUrl();
    await this.attemptStop(next);
  }

  private async handleProvisionFailure(
    state: Extract<RunPodPersistedState, { status: 'provisioning' | 'starting' }>,
    message: string,
  ) {
    this.logger.warn(`RunPod provision failure (${state.podId}): ${message}`);
    // Best-effort: try to clean up the pod.
    const key = await this.getApiKey();
    if (key && state.podId) {
      this.runPodRepository.terminatePod(key, state.podId).catch((error) => {
        if (!(error instanceof RunPodNotFoundError)) {
          this.logger.warn(`Cleanup terminate failed: ${error}`);
        }
      });
    }
    await this.writeState({
      status: 'error',
      podId: state.podId,
      gpuTypeId: state.gpuTypeId,
      imageName: state.imageName,
      message,
      errorAt: new Date().toISOString(),
      instanceTag: state.instanceTag,
    });
    await this.notifyAdmin(NotificationLevel.Error, 'RunPod provision failed', message);
  }

  private async recordBusy(jobName: JobName) {
    if (!ML_JOB_NAMES.has(jobName)) {
      return;
    }
    const state = await this.loadState();
    if (state.status !== 'running') {
      return;
    }
    // Idempotent write — no lock needed.
    await this.writeState({ ...state, lastBusyAt: new Date().toISOString() });
  }

  /**
   * Reflect the current DB state onto this worker's MachineLearningRepository.
   * Idempotent; called on bootstrap, config-change, transition, and tick.
   */
  private async syncManagedUrl(): Promise<void> {
    const state = await this.loadState();
    if (state.status === 'running') {
      const existing = this.machineLearningRepository.getManagedUrl();
      if (existing !== state.mlUrl) {
        this.machineLearningRepository.setManagedUrl(state.mlUrl, state.authToken);
      }
    } else if (this.machineLearningRepository.getManagedUrl()) {
      this.machineLearningRepository.clearManagedUrl();
    }
  }

  private async loadState(): Promise<RunPodPersistedState> {
    const raw = await this.systemMetadataRepository.get(SystemMetadataKey.RunPodState);
    return raw ?? { status: 'idle' };
  }

  private async writeState(state: RunPodPersistedState): Promise<void> {
    await this.systemMetadataRepository.set(SystemMetadataKey.RunPodState, state);
  }

  private async getApiKey(): Promise<string> {
    if (this.currentApiKey) {
      return this.currentApiKey;
    }
    const config = await this.getConfig({ withCache: true });
    this.currentApiKey = config.machineLearning.runpod.apiKey;
    return this.currentApiKey;
  }

  private async requireApiKey(): Promise<string> {
    const key = await this.getApiKey();
    if (!key) {
      throw new BadRequestException('RunPod API key is not configured');
    }
    return key;
  }

  private async enqueueBackfill(): Promise<RunPodBackfillResultDto> {
    const enqueued: string[] = [];
    const skipped: string[] = [];
    for (const entry of ML_BACKFILL_QUEUES) {
      try {
        await entry.enqueue(this.jobRepository);
        enqueued.push(entry.name);
      } catch (error) {
        this.logger.warn(`Backfill enqueue failed for ${entry.name}: ${error}`);
        skipped.push(entry.name);
      }
    }
    return { enqueued, skipped };
  }

  private async notifyAdmin(level: NotificationLevel, title: string, description: string): Promise<void> {
    try {
      const admin = await this.userRepository.getAdmin();
      if (!admin) {
        return;
      }
      await this.notificationRepository.create({
        userId: admin.id,
        type: NotificationType.SystemMessage,
        level,
        title,
        description,
      });
    } catch (error) {
      this.logger.warn(`Failed to send admin notification: ${error}`);
    }
  }

  private mapStateToDto(state: RunPodPersistedState): RunPodStateDto {
    const base: RunPodStateDto = { status: state.status };
    if ('podId' in state && state.podId) {
      base.podId = state.podId;
    }
    if ('instanceTag' in state && state.instanceTag) {
      base.instanceTag = state.instanceTag;
    }
    if ('imageName' in state && state.imageName) {
      base.imageName = state.imageName;
    }
    if ('gpuTypeId' in state && state.gpuTypeId) {
      base.gpuTypeId = state.gpuTypeId;
    }
    if ('podCreatedAt' in state && state.podCreatedAt) {
      base.podCreatedAt = state.podCreatedAt;
    }
    if (state.status === 'running') {
      base.mlUrl = state.mlUrl;
      base.runningSince = state.runningSince;
      base.lastBusyAt = state.lastBusyAt;
      base.maxRuntimeHours = state.maxRuntimeHours;
      base.unhealthySince = state.unhealthySince;
    }
    if (state.status === 'stopped') {
      base.stoppedAt = state.stoppedAt;
    }
    if (state.status === 'error') {
      base.errorMessage = state.message;
    }
    return base;
  }
}
