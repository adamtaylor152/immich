import { Injectable, OnModuleInit } from '@nestjs/common';
import { Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { OnJob } from 'src/decorators';
import { JobName, JobStatus, QueueName } from 'src/enum';
import { BestPhotosRepository } from 'src/repositories/best-photos.repository';
import { DuplicateRepository } from 'src/repositories/duplicate.repository';
import { ForkAlbumMetadataRepository } from 'src/repositories/fork-album-metadata.repository';
import { ForkConfigRepository } from 'src/repositories/fork-config.repository';
import { digestValue } from 'src/repositories/fork-derived-results';
import { ForkEnrichmentRepository } from 'src/repositories/fork-enrichment.repository';
import { ForkPrivacyRepository } from 'src/repositories/fork-privacy.repository';
import {
  BACKFILL_KINDS,
  BackfillClaim,
  BackfillKind,
  BackfillProgress,
  ForkState,
  ReturnConfigReconciliation,
} from 'src/repositories/fork-schema.repository';
import { MediaHealthRepository } from 'src/repositories/media-health.repository';
import { ReturnNormalizationClaim } from 'src/repositories/physical-file.repository';
import { SmartAlbumRepository } from 'src/repositories/smart-album.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { ForkStorageNormalizationService } from 'src/services/fork-storage-normalization.service';
import { JobOf } from 'src/types';

const DEFAULT_BATCH_SIZE = 100;

export type BackfillBatchResult = { count: number; digest: string };
export type BackfillBatchHandler = (ids: string[], claim?: ReturnNormalizationClaim) => Promise<BackfillBatchResult>;
export type ForkSchemaMigrationStatus = ForkState & {
  progress: BackfillProgress[];
  verified: boolean;
};
export type ReturnReconciliationHooks = {
  afterBatch?: (kind: BackfillKind, claim: BackfillClaim) => Promise<void> | void;
  afterConfigEvidence?: (evidence: ReturnConfigReconciliation) => Promise<void> | void;
  beforeConfigEvidence?: (evidence: ReturnConfigReconciliation) => Promise<void> | void;
};

@Injectable()
export class ForkSchemaMigrationService extends BaseService implements OnModuleInit {
  @InjectKysely()
  private db!: Kysely<DB>;

  private readonly handlers = new Map<BackfillKind, BackfillBatchHandler>();
  private forkConfigRepository!: ForkConfigRepository;
  private seedPromise?: Promise<void>;

  onModuleInit(): void {
    const privacyRepository = new ForkPrivacyRepository(this.db);
    const albumRepository = new ForkAlbumMetadataRepository(this.db);
    const enrichmentRepository = new ForkEnrichmentRepository(this.db);
    const automationRepository = new SmartAlbumRepository(this.db);
    this.forkConfigRepository = new ForkConfigRepository(this.db);
    const mediaHealthRepository = new MediaHealthRepository(this.db);
    const bestPhotosRepository = new BestPhotosRepository(this.db);
    const duplicateRepository = new DuplicateRepository(this.db);
    const storageNormalization = new ForkStorageNormalizationService(this.db);
    this.registerHandler('privacy', (ids) => privacyRepository.backfillPrivacy(ids));
    this.registerHandler('albums', (ids) => albumRepository.backfillAlbums(ids));
    this.registerHandler('enrichment', (ids) => enrichmentRepository.backfillEnrichment(ids));
    this.registerHandler('automation', (ids) => automationRepository.backfillAutomation(ids));
    this.registerHandler('health', async (ids) => {
      const health = await mediaHealthRepository.backfillHealth(ids);
      const scores = await bestPhotosRepository.backfillScores(ids);
      const frames = await duplicateRepository.backfillVideoDuplicateFrames(ids);
      return {
        count: ids.length,
        digest: digestValue({ health: health.tables, scores: scores.tables, frames: frames.tables }),
      };
    });
    this.registerHandler('storage', (ids, claim) => storageNormalization.normalizeBatch(ids, claim));
    this.registerHandler('checksum', (ids, claim) => storageNormalization.normalizeBatch(ids, claim));
  }

  registerHandler(kind: BackfillKind, handler: BackfillBatchHandler): void {
    if (this.handlers.has(kind)) {
      throw new Error(`Backfill handler already registered for ${kind}`);
    }
    this.handlers.set(kind, handler);
  }

  async status(): Promise<ForkSchemaMigrationStatus> {
    const [state, storedProgress] = await Promise.all([
      this.forkSchemaRepository.getState(),
      this.forkSchemaRepository.getProgress(),
    ]);
    const byKind = new Map(storedProgress.map((item) => [item.kind, item]));
    const progress = BACKFILL_KINDS.map(
      (kind): BackfillProgress =>
        byKind.get(kind) ?? {
          kind,
          cursor: null,
          processed: 0,
          remaining: 0,
          digest: null,
          lastError: null,
        },
    );
    const verified =
      storedProgress.length === BACKFILL_KINDS.length &&
      new Set(storedProgress.map(({ kind }) => kind)).size === BACKFILL_KINDS.length &&
      storedProgress.every(({ lastError, remaining }) => remaining === 0 && lastError === null);

    return { ...state, progress, verified };
  }

  verify(): Promise<ForkSchemaMigrationStatus> {
    return this.status();
  }

  async activateAfterReturnReconciliation(): Promise<ForkSchemaMigrationStatus> {
    await this.forkSchemaRepository.activateAfterReturnReconciliation();
    return this.status();
  }

  async start(batchSize = DEFAULT_BATCH_SIZE): Promise<ForkSchemaMigrationStatus> {
    const transitioned = await this.forkSchemaRepository.transitionPhase('legacy', 'dual-write');
    const status = await this.status();
    if (!transitioned && status.phase !== 'dual-write') {
      throw new Error('Backfill can only start from legacy phase');
    }
    await this.seedAllKinds(batchSize);
    return this.status();
  }

  async pause(): Promise<ForkSchemaMigrationStatus> {
    const transitioned = await this.forkSchemaRepository.transitionPhase('dual-write', 'legacy');
    const status = await this.status();
    if (!transitioned && status.phase !== 'legacy') {
      throw new Error('Backfill can only pause from dual-write phase');
    }
    this.seedPromise = undefined;
    return status;
  }

  async resume(batchSize = DEFAULT_BATCH_SIZE): Promise<ForkSchemaMigrationStatus> {
    const transitioned = await this.forkSchemaRepository.transitionPhase('legacy', 'dual-write');
    const status = await this.status();
    if (!transitioned && status.phase !== 'dual-write') {
      throw new Error('Backfill can only resume from legacy phase');
    }
    await this.seedAllKinds(batchSize);
    return this.status();
  }

  async reconcileAfterOfficialReturn(
    batchSize = DEFAULT_BATCH_SIZE,
    hooks: ReturnReconciliationHooks = {},
  ): Promise<ForkSchemaMigrationStatus> {
    if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
      throw new Error('Backfill batch size must be a positive integer');
    }
    await this.forkSchemaRepository.beginOrResumeReturnReconciliation();
    let configEvidence = await this.forkSchemaRepository.getReturnConfigReconciliation();
    if (!configEvidence) {
      const source = this.configRepository.getEnv().configFile ? 'file' : 'database';
      const effectiveConfig = await this.getConfig({ withCache: false });
      const config = await this.forkConfigRepository.backfillConfig(effectiveConfig, source);
      configEvidence = { ...config, source };
      await hooks.beforeConfigEvidence?.(configEvidence);
      await this.forkSchemaRepository.recordReturnConfigReconciliation(configEvidence);
      await hooks.afterConfigEvidence?.(configEvidence);
    }
    for (const kind of BACKFILL_KINDS) {
      while (true) {
        const claim = await this.forkSchemaRepository.claimReturnBatch(kind, batchSize);
        if (!claim) {
          break;
        }
        const handler = this.handlers.get(kind);
        if (!handler) {
          await this.forkSchemaRepository.failBatch(kind, claim.cursor, `No backfill handler registered for ${kind}`);
          throw new Error(`No backfill handler registered for ${kind}`);
        }
        try {
          const returnClaim =
            kind === 'storage' || kind === 'checksum'
              ? { kind, claimToken: claim.cursor, claimedIds: claim.ids }
              : undefined;
          const result = returnClaim ? await handler(claim.ids, returnClaim) : await handler(claim.ids);
          await this.forkSchemaRepository.completeBatch(kind, claim.cursor, result.count, result.digest);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await this.forkSchemaRepository.failBatch(kind, claim.cursor, message);
          throw error;
        }
        await hooks.afterBatch?.(kind, claim);
      }
      if (kind === 'automation') {
        await this.forkSchemaRepository.finalizeReturnAutomationProgress(configEvidence.digest);
      }
    }
    return this.status();
  }

  @OnJob({ name: JobName.ForkSchemaBackfill, queue: QueueName.BackgroundTask })
  async handleBackfill({ kind, batchSize }: JobOf<JobName.ForkSchemaBackfill>): Promise<JobStatus> {
    return this.runBatch(kind, batchSize);
  }

  async runBatch(kind: BackfillKind, batchSize: number): Promise<JobStatus> {
    const state = await this.forkSchemaRepository.getState();
    if (state.phase !== 'dual-write') {
      return JobStatus.Skipped;
    }

    let claim: BackfillClaim | null;
    try {
      claim = await this.forkSchemaRepository.claimBatch(kind, batchSize);
    } catch (error) {
      if (error instanceof Error && error.message === 'Fork schema backfills can only run in dual-write phase') {
        return JobStatus.Skipped;
      }
      throw error;
    }
    if (!claim) {
      const status = await this.status();
      if (status.phase === 'dual-write' && status.verified) {
        await this.forkSchemaRepository.transitionPhase('dual-write', 'ready');
      }
      return JobStatus.Skipped;
    }

    try {
      const handler = this.handlers.get(kind);
      if (!handler) {
        throw new Error(`No backfill handler registered for ${kind}`);
      }

      const result = await handler(claim.ids);
      await this.forkSchemaRepository.completeBatch(kind, claim.cursor, result.count, result.digest);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.forkSchemaRepository.failBatch(kind, claim.cursor, message);
      return JobStatus.Failed;
    }

    await this.continueOrFinish(kind, batchSize);
    return JobStatus.Success;
  }

  private async seedAllKinds(batchSize: number): Promise<void> {
    if (!this.seedPromise) {
      this.seedPromise = this.jobRepository.queueAll(
        BACKFILL_KINDS.map((kind) => ({ name: JobName.ForkSchemaBackfill, data: { kind, batchSize } })),
      );
    }
    const seedPromise = this.seedPromise;
    try {
      await seedPromise;
    } finally {
      if (this.seedPromise === seedPromise) {
        this.seedPromise = undefined;
      }
    }
  }

  private async continueOrFinish(kind: BackfillKind, batchSize: number): Promise<void> {
    const status = await this.status();
    if (status.phase !== 'dual-write') {
      return;
    }
    if (status.verified) {
      await this.forkSchemaRepository.transitionPhase('dual-write', 'ready');
      return;
    }

    const progress = status.progress.find((item) => item.kind === kind);
    if (progress && progress.remaining > 0 && progress.lastError === null) {
      await this.jobRepository.queue({ name: JobName.ForkSchemaBackfill, data: { kind, batchSize } });
    }
  }
}
