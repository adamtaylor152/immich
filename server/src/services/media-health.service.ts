import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { execFile as execFileCallback } from 'node:child_process';
import { constants } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { SystemConfig } from 'src/config';
import { StorageCore } from 'src/cores/storage.core';
import { OnJob } from 'src/decorators';
import { mapAsset } from 'src/dtos/asset-response.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  CORRUPT_DELETE_STATUSES,
  CORRUPT_MEDIA_DELETE_CONFIRM_TEXT,
  CORRUPT_MEDIA_DELETE_RECENT_MS,
  MediaHealthBulkActionDto,
  MediaHealthBulkResponseDto,
  MediaHealthDeleteCorruptDto,
  MediaHealthListQueryDto,
  MediaHealthListResponseDto,
  MediaHealthRunResponseDto,
  MediaHealthScanResponseDto,
} from 'src/dtos/media-health.dto';
import {
  AssetStatus,
  AssetType,
  AssetVisibility,
  ChecksumAlgorithm,
  Colorspace,
  JobName,
  JobStatus,
  MediaHealthCategory,
  MediaHealthSeverity,
  MediaHealthStatus,
  QueueName,
  StorageFolder,
} from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { CryptoRepository } from 'src/repositories/crypto.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { ForkSchemaRepository } from 'src/repositories/fork-schema.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LibraryRepository } from 'src/repositories/library.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import {
  MediaHealthAsset,
  MediaHealthCandidate,
  MediaHealthRepository,
  MediaHealthRun,
} from 'src/repositories/media-health.repository';
import { MediaRepository } from 'src/repositories/media.repository';
import { PhysicalFileRepository } from 'src/repositories/physical-file.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { JobOf } from 'src/types';
import { getConfig } from 'src/utils/config';
import { isAssetChecksumConstraint } from 'src/utils/database';
import { asDateTimeString } from 'src/utils/date';
import { getHiddenContentQueryOptions } from 'src/utils/hidden-content';
import { classifyImageDecodeFailure, getErrorMessage } from 'src/utils/media-health';
import { mimeTypes } from 'src/utils/mime-types';
import { renderRawWithLibRaw } from 'src/utils/raw-renderer';

const execFile = promisify(execFileCallback);
const MEDIA_HEALTH_PAGE_SIZE = 100;
const VISUAL_MATCH_THRESHOLD = 0.85;

type CandidateValidation = {
  status: MediaHealthStatus;
  score: number | null;
  evidence: Record<string, unknown>;
  resolution: Record<string, unknown>;
};

@Injectable()
export class MediaHealthService {
  constructor(
    private logger: LoggingRepository,
    private assetRepository: AssetRepository,
    private configRepository: ConfigRepository,
    private cryptoRepository: CryptoRepository,
    private eventRepository: EventRepository,
    private forkSchemaRepository: ForkSchemaRepository,
    private jobRepository: JobRepository,
    private libraryRepository: LibraryRepository,
    private mediaHealthRepository: MediaHealthRepository,
    private mediaRepository: MediaRepository,
    private physicalFileRepository: PhysicalFileRepository,
    private storageRepository: StorageRepository,
    private systemMetadataRepository: SystemMetadataRepository,
    private userRepository: UserRepository,
  ) {
    this.logger.setContext(MediaHealthService.name);
  }

  async list(auth: AuthDto, dto: MediaHealthListQueryDto): Promise<MediaHealthListResponseDto> {
    const size = dto.size ?? MEDIA_HEALTH_PAGE_SIZE;
    const privacy = getHiddenContentQueryOptions(auth);
    const [findings, run, user] = await Promise.all([
      this.mediaHealthRepository.list({
        category: dto.category,
        ownerId: auth.user.id,
        privacy,
        status: dto.status,
        size,
      }),
      this.mediaHealthRepository.getLatestRun(dto.category, auth.user.id),
      this.userRepository.get(auth.user.id, {}),
    ]);
    const candidateRoots = [
      StorageCore.getFolderLocation(StorageFolder.Upload, auth.user.id),
      StorageCore.getLibraryFolder({ id: auth.user.id, storageLabel: user?.storageLabel ?? null }),
    ];
    const [assets, candidates] = await Promise.all([
      this.mediaHealthRepository.getAssets(
        findings.map(({ assetId }) => assetId),
        auth.user.id,
        privacy,
      ),
      this.mediaHealthRepository.getCandidatesByHealthIds(findings.map(({ id }) => id)),
    ]);

    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    const candidatesByHealthId = this.groupCandidates(candidates);
    const buckets = new Map<string, MediaHealthListResponseDto['buckets'][number]>();

    for (const finding of findings) {
      const asset = assetById.get(finding.assetId);
      if (!asset) {
        continue;
      }

      const isOwnedPath = asset.isExternal || this.isPathWithinRoots(finding.originalPath, candidateRoots);
      const originalPath = isOwnedPath ? finding.originalPath : 'Managed file in another user directory';
      const timeBucket = asset.localDateTime.toISOString().slice(0, 10);
      const bucket = buckets.get(timeBucket) ?? { timeBucket, count: 0, items: [] };
      bucket.items.push({
        id: finding.id,
        assetId: finding.assetId,
        category: finding.category,
        status: finding.status,
        severity: finding.severity,
        originalPath,
        originalFileName: finding.originalFileName,
        evidence: finding.evidence,
        resolution: finding.resolution,
        checkedAt: asDateTimeString(finding.checkedAt),
        dismissedAt: finding.dismissedAt ? asDateTimeString(finding.dismissedAt) : null,
        resolvedAt: finding.resolvedAt ? asDateTimeString(finding.resolvedAt) : null,
        asset: mapAsset(isOwnedPath ? asset : { ...asset, originalPath }, { auth }),
        candidates: (candidatesByHealthId.get(finding.id) ?? []).map((candidate) =>
          this.mapCandidateForRoots(candidate, asset.isExternal ? null : candidateRoots),
        ),
      });
      bucket.count = bucket.items.length;
      buckets.set(timeBucket, bucket);
    }

    return { buckets: buckets.values().toArray(), total: findings.length, run: run ? this.mapRun(run) : null };
  }

  async startMissingScan(auth: AuthDto, force?: boolean): Promise<MediaHealthScanResponseDto> {
    const { missingRunId } = await this.queueMediaHealthScan(auth.user.id, force);
    return { runId: missingRunId };
  }

  async startCorruptScan(auth: AuthDto, force?: boolean): Promise<MediaHealthScanResponseDto> {
    const { corruptRunId } = await this.queueMediaHealthScan(auth.user.id, force);
    return { runId: corruptRunId };
  }

  async locateMissing(auth: AuthDto, dto: MediaHealthBulkActionDto): Promise<MediaHealthScanResponseDto> {
    const findings = await this.mediaHealthRepository.getByIds(
      dto.ids,
      auth.user.id,
      getHiddenContentQueryOptions(auth),
    );
    const run = await this.mediaHealthRepository.createRun(MediaHealthCategory.Missing, auth.user.id);
    await this.jobRepository.queue({
      name: JobName.MediaHealthLocateMissing,
      data: { runId: run.id, ids: findings.map(({ id }) => id), userId: auth.user.id },
    });
    return { runId: run.id };
  }

  async dismiss(auth: AuthDto, dto: MediaHealthBulkActionDto): Promise<void> {
    const findings = await this.mediaHealthRepository.getByIds(
      dto.ids,
      auth.user.id,
      getHiddenContentQueryOptions(auth),
    );
    await this.mediaHealthRepository.markDismissed(
      findings.map(({ id }) => id),
      auth.user.id,
    );
  }

  async relinkMissing(auth: AuthDto, dto: MediaHealthBulkActionDto): Promise<MediaHealthBulkResponseDto> {
    const privacy = getHiddenContentQueryOptions(auth);
    const findings = await this.mediaHealthRepository.getByIds(dto.ids, auth.user.id, privacy);
    const assets = await this.mediaHealthRepository.getAssets(
      findings.map(({ assetId }) => assetId),
      auth.user.id,
      privacy,
    );
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
    const candidates = await this.mediaHealthRepository.getCandidatesByHealthIds(findings.map(({ id }) => id));
    const candidatesByHealthId = this.groupCandidates(candidates);

    const results: MediaHealthBulkResponseDto['results'] = [];
    for (const finding of findings) {
      const asset = assetsById.get(finding.assetId);
      const candidates = (candidatesByHealthId.get(finding.id) ?? []).filter(
        ({ status }) => status === MediaHealthStatus.Found,
      );

      if (!asset || candidates.length !== 1) {
        results.push({
          id: finding.id,
          success: false,
          error: 'Finding does not have exactly one validated candidate',
        });
        continue;
      }

      const candidate = candidates[0];
      if (!asset.isExternal) {
        const digests = await this.validateManagedCandidate(asset, candidate.candidatePath);
        if (!digests) {
          results.push({
            id: finding.id,
            success: false,
            error: 'Candidate no longer matches or could not be safely linked',
          });
          continue;
        }

        const stat = await this.storageRepository.stat(candidate.candidatePath);
        const relinked = await this.mediaHealthRepository.relinkManagedAsset({
          assetId: asset.id,
          candidateId: candidate.id,
          ownerId: auth.user.id,
          healthId: finding.id,
          expectedOriginalPath: asset.originalPath,
          originalPath: candidate.candidatePath,
          originalFileName: asset.originalFileName,
          expectedChecksum: asset.checksum,
          ...digests,
          fileModifiedAt: stat.mtime,
        });
        if (!relinked) {
          results.push({ id: finding.id, success: false, error: 'Asset or finding changed during relink' });
          continue;
        }
        await this.queueRelinkJobs(asset.id);
        results.push({ id: finding.id, success: true, status: MediaHealthStatus.Relinked });
        continue;
      }

      if (!asset.libraryId) {
        results.push({ id: finding.id, success: false, error: 'External asset no longer belongs to a library' });
        continue;
      }
      const validation = await this.validateMissingCandidate(asset, candidate.candidatePath);
      if (validation.status !== MediaHealthStatus.Found) {
        results.push({
          id: finding.id,
          success: false,
          error: String(validation.evidence.reason ?? 'Invalid candidate'),
        });
        continue;
      }

      const relinked = await this.relinkAsset(asset, candidate.candidatePath, finding.id);
      results.push(
        relinked
          ? { id: finding.id, success: true, status: MediaHealthStatus.Relinked }
          : { id: finding.id, success: false, error: 'Asset is no longer eligible for external-library relink' },
      );
    }

    return { results };
  }

  async deleteCorrupt(auth: AuthDto, dto: MediaHealthDeleteCorruptDto): Promise<MediaHealthBulkResponseDto> {
    if (dto.confirmText !== CORRUPT_MEDIA_DELETE_CONFIRM_TEXT) {
      throw new BadRequestException(`Type ${CORRUPT_MEDIA_DELETE_CONFIRM_TEXT} to move corrupt media to trash`);
    }

    const user = await this.userRepository.getForPinCode(auth.user.id);
    if (user?.pinCode && !auth.session?.hasElevatedPermission) {
      throw new ForbiddenException('Elevated PIN session is required to delete corrupt media');
    }

    const privacy = getHiddenContentQueryOptions(auth);
    const findings = await this.mediaHealthRepository.getByIds(dto.ids, auth.user.id, privacy);
    const now = Date.now();
    const accepted = findings.filter(
      (finding) =>
        finding.category === MediaHealthCategory.Corrupt &&
        CORRUPT_DELETE_STATUSES.has(finding.status) &&
        now - finding.checkedAt.getTime() <= CORRUPT_MEDIA_DELETE_RECENT_MS,
    );

    if (accepted.length === 0) {
      throw new BadRequestException('No recently confirmed corrupt media findings were selected');
    }

    const assets = await this.mediaHealthRepository.getAssets(
      accepted.map(({ assetId }) => assetId),
      auth.user.id,
      privacy,
    );
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
    const queuedIds: string[] = [];
    const resultStatusById = new Map<string, MediaHealthStatus>();

    for (const finding of accepted) {
      const asset = assetsById.get(finding.assetId);
      const result = asset ? await this.validateAssetIntegrity(asset) : null;

      if (result?.status === MediaHealthStatus.CorruptConfirmed) {
        queuedIds.push(finding.id);
        resultStatusById.set(finding.id, MediaHealthStatus.TrashQueued);
        continue;
      }

      const status = result?.status ?? MediaHealthStatus.Resolved;
      resultStatusById.set(finding.id, status);
      await this.mediaHealthRepository.upsertFinding({
        ...finding,
        status,
        severity: result ? MediaHealthSeverity.Warning : MediaHealthSeverity.Info,
        evidence: result?.evidence ?? { reason: 'trash_revalidation_passed' },
        resolution: result?.resolution ?? { trashSkipped: true },
        checkedAt: new Date(),
        resolvedAt: result ? null : new Date(),
      });
    }

    if (queuedIds.length === 0) {
      throw new BadRequestException('Selected corrupt media no longer failed deletion revalidation');
    }

    await this.mediaHealthRepository.markStatus(queuedIds, MediaHealthStatus.TrashQueued);
    await this.jobRepository.queue({
      name: JobName.MediaHealthDeleteCorrupt,
      data: { ids: queuedIds, userId: auth.user.id },
    });

    return {
      results: findings.map((finding) => ({
        id: finding.id,
        success: resultStatusById.get(finding.id) === MediaHealthStatus.TrashQueued,
        status: resultStatusById.get(finding.id) ?? finding.status,
        error:
          resultStatusById.get(finding.id) === MediaHealthStatus.TrashQueued
            ? undefined
            : 'Finding is not recently confirmed corrupt or failed revalidation',
      })),
    };
  }

  @OnJob({ name: JobName.MediaHealthScanMissing, queue: QueueName.MediaHealth })
  async handleMissingScan(job: JobOf<JobName.MediaHealthScanMissing>): Promise<JobStatus> {
    return this.handleMediaHealthScan(job);
  }

  @OnJob({ name: JobName.MediaHealthLocateMissing, queue: QueueName.MediaHealth })
  async handleLocateMissing(job: JobOf<JobName.MediaHealthLocateMissing>): Promise<JobStatus> {
    let run = job.runId;
    if (!run) {
      const created = await this.mediaHealthRepository.createRun(MediaHealthCategory.Missing, job.userId);
      run = created.id;
    }
    const findings = await this.mediaHealthRepository.getByIds(job.ids ?? [], job.userId);
    const assets = await this.mediaHealthRepository.getAssets(
      findings.map(({ assetId }) => assetId),
      job.userId,
    );
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
    const managedCandidates = await this.locateManagedCandidates(assets.filter(({ isExternal }) => !isExternal));
    let checkedAssets = 0;
    let foundAssets = 0;

    // Walk each library exactly once and build a basename→paths index covering
    // every missing asset in that library. Per-finding `locateCandidates` then
    // does an O(1) Map lookup instead of re-traversing the import paths.
    const libraryIndexes = new Map<string, Map<string, string[]>>();
    const basenamesByLibrary = new Map<string, Set<string>>();
    for (const finding of findings) {
      if (finding.category !== MediaHealthCategory.Missing) {
        continue;
      }
      const asset = assetsById.get(finding.assetId);
      if (!asset?.isExternal || !asset.libraryId) {
        continue;
      }
      const set = basenamesByLibrary.get(asset.libraryId) ?? new Set<string>();
      set.add(asset.originalFileName);
      basenamesByLibrary.set(asset.libraryId, set);
    }
    for (const [libraryId, basenames] of basenamesByLibrary) {
      libraryIndexes.set(libraryId, await this.buildLibraryCandidateIndex(libraryId, basenames));
    }

    try {
      for (const finding of findings) {
        if (finding.category !== MediaHealthCategory.Missing) {
          continue;
        }

        checkedAssets++;
        const asset = assetsById.get(finding.assetId);
        if (!asset) {
          continue;
        }

        const candidates = asset.isExternal
          ? await this.locateCandidates(asset, asset.libraryId ? libraryIndexes.get(asset.libraryId) : undefined)
          : (managedCandidates.get(asset.id) ?? []);
        if (candidates.some(({ status }) => status === MediaHealthStatus.Found)) {
          foundAssets++;
        }

        await this.mediaHealthRepository.replaceCandidates(
          finding.id,
          candidates.map((candidate) => ({
            healthId: finding.id,
            candidatePath: candidate.evidence.path as string,
            status: candidate.status,
            visualMatchScore: candidate.score,
            evidence: candidate.evidence,
            resolution: candidate.resolution,
            checkedAt: new Date(),
          })),
        );

        const validCandidates = candidates.filter(({ status }) => status === MediaHealthStatus.Found);
        const findingStatus =
          validCandidates.length > 0
            ? MediaHealthStatus.Found
            : candidates.length > 0
              ? MediaHealthStatus.Candidate
              : MediaHealthStatus.Missing;

        await this.mediaHealthRepository.upsertFinding({
          runId: run,
          assetId: asset.id,
          category: MediaHealthCategory.Missing,
          status: findingStatus,
          severity:
            findingStatus === MediaHealthStatus.Missing ? MediaHealthSeverity.Critical : MediaHealthSeverity.Warning,
          originalPath: asset.originalPath,
          originalFileName: asset.originalFileName,
          evidence: {
            ...(finding.evidence as Record<string, unknown>),
            candidateCount: candidates.length,
            validatedCandidateCount: validCandidates.length,
          },
          resolution: {
            ...(finding.resolution as Record<string, unknown>),
            autoRelinkable: validCandidates.length === 1,
          },
          checkedAt: new Date(),
        });
      }

      await this.mediaHealthRepository.finishRun(run, {
        status: 'completed',
        totalAssets: checkedAssets,
        checkedAssets,
        foundAssets,
      });
      return JobStatus.Success;
    } catch (error) {
      await this.mediaHealthRepository.finishRun(run, { status: 'failed', error: getErrorMessage(error) });
      throw error;
    }
  }

  @OnJob({ name: JobName.MediaHealthScanCorrupt, queue: QueueName.MediaHealth })
  async handleCorruptScan(job: JobOf<JobName.MediaHealthScanCorrupt>): Promise<JobStatus> {
    let run = job.runId;
    if (!run) {
      const created = await this.mediaHealthRepository.createRun(MediaHealthCategory.Corrupt, job.userId);
      run = created.id;
    }
    let checkedAssets = 0;
    let foundAssets = 0;
    // Buffer healthy-asset resolutions and flush in batches. On large rescans
    // (millions of assets, mostly healthy) doing one UPDATE per asset inside
    // the streaming loop dominates the DB cost; batching collapses that.
    const RESOLVE_BATCH = 500;
    const resolveBuffer: string[] = [];
    const flushResolved = async () => {
      if (resolveBuffer.length === 0) {
        return;
      }
      await this.mediaHealthRepository.markResolvedMany(MediaHealthCategory.Corrupt, resolveBuffer);
      resolveBuffer.length = 0;
    };

    try {
      for await (const asset of this.mediaHealthRepository.streamAssets({
        assetIds: job.assetIds,
        ownerId: job.userId,
      })) {
        checkedAssets++;
        const result = await this.validateAssetIntegrity(asset);
        if (!result) {
          resolveBuffer.push(asset.id);
          if (resolveBuffer.length >= RESOLVE_BATCH) {
            await flushResolved();
          }
          continue;
        }

        foundAssets++;
        await this.mediaHealthRepository.upsertFinding({
          runId: run,
          assetId: asset.id,
          category: MediaHealthCategory.Corrupt,
          status: result.status,
          severity:
            result.status === MediaHealthStatus.CorruptConfirmed
              ? MediaHealthSeverity.Critical
              : result.status === MediaHealthStatus.UnsupportedRaw
                ? MediaHealthSeverity.Info
                : MediaHealthSeverity.Warning,
          originalPath: asset.originalPath,
          originalFileName: asset.originalFileName,
          evidence: result.evidence,
          resolution: result.resolution,
          checkedAt: new Date(),
        });
      }

      await flushResolved();

      await this.mediaHealthRepository.finishRun(run, {
        status: 'completed',
        totalAssets: checkedAssets,
        checkedAssets,
        foundAssets,
      });
      return JobStatus.Success;
    } catch (error) {
      await flushResolved();
      await this.mediaHealthRepository.finishRun(run, { status: 'failed', error: getErrorMessage(error) });
      throw error;
    }
  }

  @OnJob({ name: JobName.MediaHealthDeleteCorrupt, queue: QueueName.MediaHealth })
  async handleDeleteCorrupt(job: JobOf<JobName.MediaHealthDeleteCorrupt>): Promise<JobStatus> {
    const findings = await this.mediaHealthRepository.getByIds(job.ids, job.userId);
    const assets = await this.mediaHealthRepository.getAssets(
      findings.map(({ assetId }) => assetId),
      job.userId,
    );
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
    const healthIdsToTrash: string[] = [];
    const assetIdsToTrash: string[] = [];

    for (const finding of findings) {
      const asset = assetsById.get(finding.assetId);
      if (!asset || finding.status !== MediaHealthStatus.TrashQueued) {
        continue;
      }

      const result = await this.validateAssetIntegrity(asset);
      if (result?.status === MediaHealthStatus.CorruptConfirmed) {
        healthIdsToTrash.push(finding.id);
        assetIdsToTrash.push(finding.assetId);
      } else {
        await this.mediaHealthRepository.upsertFinding({
          ...finding,
          runId: finding.runId,
          status: result?.status ?? MediaHealthStatus.Resolved,
          severity: result ? MediaHealthSeverity.Warning : MediaHealthSeverity.Info,
          evidence: result?.evidence ?? { reason: 'revalidation_passed' },
          resolution: result?.resolution ?? { trashSkipped: true },
          checkedAt: new Date(),
          resolvedAt: result ? null : new Date(),
        });
      }
    }

    if (assetIdsToTrash.length > 0) {
      await this.assetRepository.updateAll(assetIdsToTrash, {
        deletedAt: new Date(),
        status: AssetStatus.Trashed,
      });
      await this.eventRepository.emit('AssetTrashAll', {
        assetIds: assetIdsToTrash,
        userId: job.userId,
      });
      await this.mediaHealthRepository.markStatus(healthIdsToTrash, MediaHealthStatus.Trashed);
    }

    return JobStatus.Success;
  }

  private async getConfig(): Promise<SystemConfig> {
    return getConfig(
      {
        configRepo: this.configRepository,
        metadataRepo: this.systemMetadataRepository,
        logger: this.logger,
      },
      { withCache: true },
    );
  }

  private mapRun(run: MediaHealthRun): MediaHealthRunResponseDto {
    return {
      id: run.id,
      category: run.category,
      status: run.status,
      startedAt: asDateTimeString(run.startedAt),
      finishedAt: run.finishedAt ? asDateTimeString(run.finishedAt) : null,
      totalAssets: run.totalAssets,
      checkedAssets: run.checkedAssets,
      foundAssets: run.foundAssets,
      error: run.error,
    };
  }

  private async queueMediaHealthScan(
    userId: string,
    force?: boolean,
  ): Promise<{ missingRunId: string; corruptRunId: string }> {
    const [missingRun, corruptRun] = await Promise.all([
      this.mediaHealthRepository.createRun(MediaHealthCategory.Missing, userId),
      this.mediaHealthRepository.createRun(MediaHealthCategory.Corrupt, userId),
    ]);

    try {
      await this.jobRepository.queue({
        name: JobName.MediaHealthScanMissing,
        data: { missingRunId: missingRun.id, corruptRunId: corruptRun.id, force, userId },
      });
    } catch (error) {
      const failure = { status: 'failed' as const, error: getErrorMessage(error) };
      const results = await Promise.allSettled([
        this.mediaHealthRepository.finishRun(missingRun.id, failure),
        this.mediaHealthRepository.finishRun(corruptRun.id, failure),
      ]);
      for (const settled of results) {
        if (settled.status === 'rejected') {
          this.logger.warn(`Failed to mark orphaned media health run as failed: ${getErrorMessage(settled.reason)}`);
        }
      }
      throw error;
    }

    return { missingRunId: missingRun.id, corruptRunId: corruptRun.id };
  }

  private async handleMediaHealthScan(job: JobOf<JobName.MediaHealthScanMissing>): Promise<JobStatus> {
    const hasMissingRun = job.missingRunId || job.runId;
    const isLegacyMissingOnly = !job.missingRunId && !!job.runId && !job.corruptRunId;
    const includeCorrupt = !isLegacyMissingOnly;
    const [createdMissingRun, createdCorruptRun] = await Promise.all([
      hasMissingRun ? null : this.mediaHealthRepository.createRun(MediaHealthCategory.Missing, job.userId),
      includeCorrupt && !job.corruptRunId
        ? this.mediaHealthRepository.createRun(MediaHealthCategory.Corrupt, job.userId)
        : null,
    ]);
    const missingRunId = job.missingRunId ?? job.runId ?? createdMissingRun!.id;
    const corruptRunId = includeCorrupt ? (job.corruptRunId ?? createdCorruptRun!.id) : null;
    let checkedAssets = 0;
    let missingFoundAssets = 0;
    let corruptFoundAssets = 0;

    try {
      for await (const asset of this.mediaHealthRepository.streamAssets({
        assetIds: job.assetIds,
        ownerId: job.userId,
      })) {
        checkedAssets++;
        const sourceExists = await this.storageRepository.checkFileExists(asset.originalPath, constants.R_OK);
        if (!sourceExists) {
          missingFoundAssets++;
          await this.mediaHealthRepository.upsertFinding({
            runId: missingRunId,
            assetId: asset.id,
            category: MediaHealthCategory.Missing,
            status: MediaHealthStatus.Missing,
            severity: MediaHealthSeverity.Critical,
            originalPath: asset.originalPath,
            originalFileName: asset.originalFileName,
            evidence: { reason: 'source_file_missing_or_unreadable' },
            resolution: { autoRelinkable: !!asset.isExternal && !!asset.libraryId },
            checkedAt: new Date(),
          });
          if (corruptRunId) {
            await this.mediaHealthRepository.markResolved(MediaHealthCategory.Corrupt, asset.id);
          }
          continue;
        }

        if (!corruptRunId) {
          await this.mediaHealthRepository.markResolved(MediaHealthCategory.Missing, asset.id);
          continue;
        }
        const result = await this.validateReadableAssetIntegrity(asset);
        if (!result) {
          await this.mediaHealthRepository.markResolvedCategories(
            [MediaHealthCategory.Missing, MediaHealthCategory.Corrupt],
            asset.id,
          );
          continue;
        }
        await this.mediaHealthRepository.markResolved(MediaHealthCategory.Missing, asset.id);

        corruptFoundAssets++;
        await this.mediaHealthRepository.upsertFinding({
          runId: corruptRunId,
          assetId: asset.id,
          category: MediaHealthCategory.Corrupt,
          status: result.status,
          severity:
            result.status === MediaHealthStatus.CorruptConfirmed
              ? MediaHealthSeverity.Critical
              : result.status === MediaHealthStatus.UnsupportedRaw
                ? MediaHealthSeverity.Info
                : MediaHealthSeverity.Warning,
          originalPath: asset.originalPath,
          originalFileName: asset.originalFileName,
          evidence: result.evidence,
          resolution: result.resolution,
          checkedAt: new Date(),
        });
      }

      if (job.userId) {
        await this.restoreUntrackedFiles(job.userId);
      }

      const finishCalls = [
        this.mediaHealthRepository.finishRun(missingRunId, {
          status: 'completed',
          totalAssets: checkedAssets,
          checkedAssets,
          foundAssets: missingFoundAssets,
        }),
      ];
      if (corruptRunId) {
        finishCalls.push(
          this.mediaHealthRepository.finishRun(corruptRunId, {
            status: 'completed',
            totalAssets: checkedAssets,
            checkedAssets,
            foundAssets: corruptFoundAssets,
          }),
        );
      }
      await Promise.all(finishCalls);
      return JobStatus.Success;
    } catch (error) {
      const update = { status: 'failed' as const, error: getErrorMessage(error) };
      const failCalls = [this.mediaHealthRepository.finishRun(missingRunId, update)];
      if (corruptRunId) {
        failCalls.push(this.mediaHealthRepository.finishRun(corruptRunId, update));
      }
      const settled = await Promise.allSettled(failCalls);
      for (const result of settled) {
        if (result.status === 'rejected') {
          this.logger.warn(`Failed to mark media health run as failed: ${getErrorMessage(result.reason)}`);
        }
      }
      throw error;
    }
  }

  private async validateAssetIntegrity(asset: MediaHealthAsset): Promise<CandidateValidation | null> {
    const sourceExists = await this.storageRepository.checkFileExists(asset.originalPath, constants.R_OK);
    if (!sourceExists) {
      return null;
    }

    return this.validateReadableAssetIntegrity(asset);
  }

  private async restoreUntrackedFiles(userId: string): Promise<void> {
    const user = await this.userRepository.get(userId, {});
    if (!user) {
      return;
    }

    let importedBytes = 0;
    const pathsToCrawl = [
      StorageCore.getFolderLocation(StorageFolder.Upload, user.id),
      StorageCore.getLibraryFolder(user),
    ];
    for await (const batch of this.storageRepository.walk({
      pathsToCrawl,
      exclusionPatterns: [],
      includeHidden: false,
      take: 500,
    })) {
      const mediaPaths = batch.filter((candidatePath) => mimeTypes.isAsset(candidatePath));
      const tracked = await this.mediaHealthRepository.getTrackedPaths(mediaPaths);
      for (const candidatePath of mediaPaths) {
        if (tracked.has(candidatePath)) {
          continue;
        }

        let digests: Awaited<ReturnType<CryptoRepository['hashFileDigests']>>;
        try {
          digests = await this.cryptoRepository.hashFileDigests(candidatePath);
        } catch (error) {
          this.logger.warn(`Skipping unreadable recovered file ${candidatePath}: ${getErrorMessage(error)}`);
          continue;
        }
        const checksumAssets = await this.assetRepository.getByChecksums(userId, [digests.sha1, digests.sha256]);
        const duplicate =
          checksumAssets.length > 0 ||
          (await this.forkSchemaRepository.hasAssetChecksum(userId, digests.sha1, digests.sha256));
        if (duplicate) {
          continue;
        }
        if (
          user.quotaSizeInBytes !== null &&
          user.quotaUsageInBytes + importedBytes + digests.sizeInBytes > user.quotaSizeInBytes
        ) {
          this.logger.warn(`Skipping recovered file because user ${userId} has exceeded their quota`);
          continue;
        }

        let stat: Awaited<ReturnType<StorageRepository['stat']>>;
        try {
          stat = await this.storageRepository.stat(candidatePath);
        } catch (error) {
          this.logger.warn(`Skipping missing recovered file ${candidatePath}: ${getErrorMessage(error)}`);
          continue;
        }
        let asset: Awaited<ReturnType<AssetRepository['create']>> | undefined;
        try {
          asset = await this.assetRepository.create({
            ownerId: userId,
            libraryId: null,
            checksum: digests.sha256,
            checksumAlgorithm: ChecksumAlgorithm.sha256File,
            originalPath: path.normalize(candidatePath),
            fileCreatedAt: stat.mtime,
            fileModifiedAt: stat.mtime,
            localDateTime: stat.mtime,
            type: mimeTypes.assetType(candidatePath),
            isFavorite: false,
            duration: null,
            visibility: AssetVisibility.Timeline,
            livePhotoVideoId: null,
            originalFileName: path.basename(candidatePath),
          });
          await this.assetRepository.upsertExif({
            exif: { assetId: asset.id, fileSizeInByte: digests.sizeInBytes },
            lockedPropertiesBehavior: 'override',
          });
          await this.physicalFileRepository.ensureOriginalPhysicalFile(asset.id);
          await this.forkSchemaRepository.recordAssetChecksums({
            assetId: asset.id,
            ...digests,
            path: candidatePath,
            source: 'recovery',
          });
          await this.jobRepository.queue({
            name: JobName.AssetExtractMetadata,
            data: { id: asset.id, source: 'upload' },
          });
          await this.eventRepository.emit('AssetCreate', {
            asset,
            file: {
              uuid: asset.id,
              checksum: digests.sha256,
              legacyChecksum: digests.sha1,
              originalPath: candidatePath,
              originalName: path.basename(candidatePath),
              size: digests.sizeInBytes,
            },
          });
          importedBytes += digests.sizeInBytes;
        } catch (error) {
          if (asset) {
            await this.assetRepository.remove({ id: asset.id });
          }
          if (!isAssetChecksumConstraint(error)) {
            throw error;
          }
        }
      }
    }
  }

  private async validateReadableAssetIntegrity(asset: MediaHealthAsset): Promise<CandidateValidation | null> {
    return asset.type === AssetType.Video ? this.validateVideo(asset) : this.validateImage(asset);
  }

  private async validateImage(asset: MediaHealthAsset): Promise<CandidateValidation | null> {
    const config = await this.getConfig();
    const isRaw = mimeTypes.isRaw(asset.originalFileName);
    const enhancedRawEnabled = config.image.enhancedRaw?.enabled;
    let firstError: unknown;

    try {
      if (isRaw && config.image.extractEmbedded) {
        const extracted = await this.mediaRepository.extract(asset.originalPath);
        if (extracted) {
          await this.decodeSmallImage(extracted.buffer);
          return null;
        }
      }

      await this.decodeSmallImage(asset.originalPath);
      return null;
    } catch (error) {
      firstError = error;
    }

    if (isRaw && enhancedRawEnabled) {
      try {
        const rendered = await renderRawWithLibRaw(asset.originalPath);
        await this.decodeSmallImage(rendered);
        return null;
      } catch (error) {
        return {
          status: classifyImageDecodeFailure(error, { isRaw, enhancedRawAttempted: true }),
          score: null,
          evidence: {
            reason: 'image_decode_failed',
            error: getErrorMessage(error),
            initialError: firstError ? getErrorMessage(firstError) : undefined,
            rawRenderer: 'dcraw_emu',
          },
          resolution: { reuploadRecommended: true },
        };
      }
    }

    return {
      status: classifyImageDecodeFailure(firstError, { isRaw, enhancedRawAttempted: false }),
      score: null,
      evidence: { reason: 'image_decode_failed', error: getErrorMessage(firstError) },
      resolution: {
        reuploadRecommended: !isRaw,
        unsupportedRaw: isRaw,
      },
    };
  }

  private async validateVideo(asset: MediaHealthAsset): Promise<CandidateValidation | null> {
    try {
      const info = await this.mediaRepository.probe(asset.originalPath, { countFrames: false });
      if (info.videoStreams.length === 0) {
        return {
          status: MediaHealthStatus.CorruptConfirmed,
          score: null,
          evidence: { reason: 'video_probe_has_no_video_stream' },
          resolution: { reuploadRecommended: true },
        };
      }

      await execFile('ffmpeg', ['-v', 'error', '-i', asset.originalPath, '-f', 'null', '-'], { timeout: 120_000 });
      return null;
    } catch (error) {
      return {
        status: MediaHealthStatus.CorruptConfirmed,
        score: null,
        evidence: { reason: 'video_decode_failed', error: getErrorMessage(error) },
        resolution: { reuploadRecommended: true },
      };
    }
  }

  private async decodeSmallImage(input: string | Buffer) {
    return this.mediaRepository.decodeImage(input, {
      colorspace: Colorspace.Srgb,
      processInvalidImages: false,
      size: 64,
    });
  }

  private async locateCandidates(
    asset: MediaHealthAsset,
    libraryIndex?: Map<string, string[]>,
  ): Promise<CandidateValidation[]> {
    if (!asset.isExternal || !asset.libraryId) {
      return [];
    }

    const candidatePaths = libraryIndex
      ? (libraryIndex.get(asset.originalFileName) ?? [])
      : await this.collectCandidatePathsForAsset(asset);

    const results: CandidateValidation[] = [];
    for (const candidatePath of candidatePaths) {
      if (candidatePath === asset.originalPath) {
        continue;
      }
      results.push(await this.validateMissingCandidate(asset, candidatePath));
    }
    return results;
  }

  private async locateManagedCandidates(assets: MediaHealthAsset[]): Promise<Map<string, CandidateValidation[]>> {
    const result = new Map<string, CandidateValidation[]>();
    if (assets.length === 0) {
      return result;
    }

    const stored = await this.mediaHealthRepository.getAssetChecksums(assets.map(({ id }) => id));
    const storedByAsset = new Map(stored.map((checksum) => [checksum.assetId, checksum]));
    const knownSizes = new Set(stored.map(({ sizeInBytes }) => sizeInBytes));
    const hasUnknownSize = assets.some((asset) => {
      const sidecar = storedByAsset.get(asset.id);
      if (!sidecar) {
        return true;
      }
      return asset.checksum.length === 20
        ? !asset.checksum.equals(sidecar.sha1)
        : asset.checksum.length === 32
          ? !asset.checksum.equals(sidecar.sha256)
          : true;
    });
    const targetByAsset = new Map<string, { asset: MediaHealthAsset; sha1: Buffer[]; sha256: Buffer[] }>();
    const sha1Targets = new Map<string, string[]>();
    const sha256Targets = new Map<string, string[]>();

    const addTarget = (index: Map<string, string[]>, digest: Buffer | undefined, assetId: string) => {
      if (!digest) {
        return;
      }
      const key = digest.toString('hex');
      const ids = index.get(key) ?? [];
      if (!ids.includes(assetId)) {
        index.set(key, [...ids, assetId]);
      }
    };

    for (const asset of assets) {
      const sidecar = storedByAsset.get(asset.id);
      const target = {
        asset,
        sha1: [sidecar?.sha1, asset.checksum?.length === 20 ? asset.checksum : undefined].filter(
          (digest): digest is Buffer => !!digest,
        ),
        sha256: [sidecar?.sha256, asset.checksum?.length === 32 ? asset.checksum : undefined].filter(
          (digest): digest is Buffer => !!digest,
        ),
      };
      targetByAsset.set(asset.id, target);
      for (const digest of target.sha1) {
        addTarget(sha1Targets, digest, asset.id);
      }
      for (const digest of target.sha256) {
        addTarget(sha256Targets, digest, asset.id);
      }
    }

    const matches = new Map<string, Map<string, Set<'sha1' | 'sha256'>>>();
    const users = await this.userRepository.getList();
    const pathsToCrawl = [
      ...new Set(
        users.flatMap((user) => [
          StorageCore.getFolderLocation(StorageFolder.Upload, user.id),
          StorageCore.getLibraryFolder(user),
        ]),
      ),
    ];
    if (pathsToCrawl.length === 0) {
      return result;
    }
    const originalPaths = new Set(assets.map(({ originalPath }) => originalPath));

    for await (const batch of this.storageRepository.walk({
      pathsToCrawl,
      exclusionPatterns: [],
      includeHidden: false,
      take: 500,
    })) {
      for (const candidatePath of batch) {
        if (!mimeTypes.isAsset(candidatePath) || originalPaths.has(candidatePath)) {
          continue;
        }
        if (!hasUnknownSize) {
          try {
            const { size } = await this.storageRepository.stat(candidatePath);
            if (!knownSizes.has(size)) {
              continue;
            }
          } catch (error) {
            this.logger.debug(`Could not stat missing media candidate ${candidatePath}: ${getErrorMessage(error)}`);
            continue;
          }
        }
        let digests: Awaited<ReturnType<CryptoRepository['hashFileDigests']>>;
        try {
          digests = await this.cryptoRepository.hashFileDigests(candidatePath);
        } catch (error) {
          this.logger.debug(`Could not hash missing media candidate ${candidatePath}: ${getErrorMessage(error)}`);
          continue;
        }
        const matched = [
          ...(sha1Targets.get(digests.sha1.toString('hex')) ?? []).map((assetId) => ({
            assetId,
            algorithm: 'sha1' as const,
          })),
          ...(sha256Targets.get(digests.sha256.toString('hex')) ?? []).map((assetId) => ({
            assetId,
            algorithm: 'sha256' as const,
          })),
        ];
        for (const { assetId, algorithm } of matched) {
          const target = targetByAsset.get(assetId);
          if (!target || mimeTypes.assetType(candidatePath) !== target.asset.type) {
            continue;
          }
          const byPath = matches.get(assetId) ?? new Map<string, Set<'sha1' | 'sha256'>>();
          const algorithms = byPath.get(candidatePath) ?? new Set<'sha1' | 'sha256'>();
          algorithms.add(algorithm);
          byPath.set(candidatePath, algorithms);
          matches.set(assetId, byPath);
        }
      }
    }

    for (const [assetId, target] of targetByAsset) {
      const byPath = matches.get(assetId) ?? new Map<string, Set<'sha1' | 'sha256'>>();
      const sha1Paths = new Set([...byPath].filter(([, algorithms]) => algorithms.has('sha1')).map(([path]) => path));
      const sha256Paths = new Set(
        [...byPath].filter(([, algorithms]) => algorithms.has('sha256')).map(([path]) => path),
      );
      const conflict =
        target.sha1.length > 0 &&
        target.sha256.length > 0 &&
        sha1Paths.size > 0 &&
        sha256Paths.size > 0 &&
        [...sha1Paths].every((candidatePath) => !sha256Paths.has(candidatePath));

      result.set(
        assetId,
        [...byPath].map(([candidatePath, algorithms]) => ({
          status: conflict ? MediaHealthStatus.Candidate : MediaHealthStatus.Found,
          score: algorithms.size === 2 ? 1 : 0.99,
          evidence: {
            path: candidatePath,
            reason: conflict ? 'checksum_evidence_conflict' : 'checksum_match',
            algorithms: [...algorithms],
          },
          resolution: { autoRelinkable: !conflict },
        })),
      );
    }

    return result;
  }

  /** Walk the asset's library importPaths once and return matching basenames. Used when we
   *  don't have a precomputed index (e.g., single-finding path).
   */
  private async collectCandidatePathsForAsset(asset: MediaHealthAsset): Promise<string[]> {
    if (!asset.libraryId) {
      return [];
    }
    const library = await this.libraryRepository.get(asset.libraryId);
    if (!library) {
      return [];
    }
    const out: string[] = [];
    for await (const batch of this.storageRepository.walk({
      pathsToCrawl: library.importPaths,
      exclusionPatterns: library.exclusionPatterns,
      includeHidden: false,
      take: 500,
    })) {
      for (const p of batch) {
        if (path.basename(p) === asset.originalFileName) {
          out.push(p);
        }
      }
    }
    return out;
  }

  /** Walk a library once and build a basename→paths index for all findings in that library. */
  private async buildLibraryCandidateIndex(libraryId: string, basenames: Set<string>): Promise<Map<string, string[]>> {
    const index = new Map<string, string[]>();
    const library = await this.libraryRepository.get(libraryId);
    if (!library) {
      return index;
    }
    for await (const batch of this.storageRepository.walk({
      pathsToCrawl: library.importPaths,
      exclusionPatterns: library.exclusionPatterns,
      includeHidden: false,
      take: 500,
    })) {
      for (const p of batch) {
        const base = path.basename(p);
        if (!basenames.has(base)) {
          continue;
        }
        const existing = index.get(base);
        if (existing) {
          existing.push(p);
        } else {
          index.set(base, [p]);
        }
      }
    }
    return index;
  }

  private async validateMissingCandidate(asset: MediaHealthAsset, candidatePath: string): Promise<CandidateValidation> {
    const candidateType = mimeTypes.isVideo(candidatePath) ? AssetType.Video : AssetType.Image;
    const evidence: Record<string, unknown> = { path: candidatePath };

    if (candidateType !== asset.type) {
      return {
        status: MediaHealthStatus.Candidate,
        score: null,
        evidence: { ...evidence, reason: 'media_type_mismatch' },
        resolution: { autoRelinkable: false },
      };
    }

    if (asset.libraryId) {
      const existing = await this.assetRepository.getByLibraryIdAndOriginalPath(asset.libraryId, candidatePath);
      if (existing && existing.id !== asset.id) {
        return {
          status: MediaHealthStatus.Candidate,
          score: null,
          evidence: { ...evidence, reason: 'candidate_already_imported', assetId: existing.id },
          resolution: { autoRelinkable: false },
        };
      }
    }

    const score =
      asset.type === AssetType.Video
        ? await this.scoreVideoCandidate(asset, candidatePath)
        : await this.scoreImageCandidate(asset, candidatePath);
    const valid = score === null ? false : score >= VISUAL_MATCH_THRESHOLD;

    return {
      status: valid ? MediaHealthStatus.Found : MediaHealthStatus.Candidate,
      score,
      evidence: {
        ...evidence,
        reason: valid ? 'candidate_validated' : 'visual_match_below_threshold',
        threshold: VISUAL_MATCH_THRESHOLD,
      },
      resolution: { autoRelinkable: valid && asset.isExternal && !!asset.libraryId },
    };
  }

  private async validateManagedCandidate(asset: MediaHealthAsset, candidatePath: string) {
    if (!mimeTypes.isAsset(candidatePath) || mimeTypes.assetType(candidatePath) !== asset.type) {
      return;
    }

    let digests: Awaited<ReturnType<CryptoRepository['hashFileDigests']>>;
    try {
      digests = await this.cryptoRepository.hashFileDigests(candidatePath);
    } catch (error) {
      this.logger.debug(`Could not revalidate missing media candidate ${candidatePath}: ${error}`);
      return;
    }
    const sidecars = await this.mediaHealthRepository.getAssetChecksums([asset.id]);
    const sidecar = sidecars[0];
    const matches =
      digests.sha1.equals(asset.checksum) ||
      digests.sha256.equals(asset.checksum) ||
      (!!sidecar && (digests.sha1.equals(sidecar.sha1) || digests.sha256.equals(sidecar.sha256)));
    return matches ? digests : undefined;
  }

  private async scoreImageCandidate(asset: MediaHealthAsset, candidatePath: string): Promise<number | null> {
    const referencePath = asset.previewPath ?? asset.thumbnailPath;
    if (!referencePath || !(await this.storageRepository.checkFileExists(referencePath, constants.R_OK))) {
      return null;
    }

    try {
      const candidateInput = mimeTypes.isRaw(candidatePath) ? await renderRawWithLibRaw(candidatePath) : candidatePath;
      const [reference, candidate] = await Promise.all([
        this.decodeSmallImage(referencePath),
        this.decodeSmallImage(candidateInput),
      ]);
      const length = Math.min(reference.data.length, candidate.data.length);
      if (length === 0) {
        return null;
      }

      let delta = 0;
      for (let index = 0; index < length; index++) {
        delta += Math.abs(reference.data[index] - candidate.data[index]);
      }

      return Math.max(0, 1 - delta / length / 255);
    } catch (error) {
      this.logger.debug(`Could not compare missing media candidate ${candidatePath}: ${error}`);
      return null;
    }
  }

  private async scoreVideoCandidate(asset: MediaHealthAsset, candidatePath: string): Promise<number | null> {
    if (!asset.duration) {
      return null;
    }

    try {
      const info = await this.mediaRepository.probe(candidatePath, { countFrames: false });
      const durationMs = Math.round((info.format.duration ?? 0) * 1000);
      if (!durationMs) {
        return null;
      }

      const difference = Math.abs(durationMs - asset.duration);
      return Math.max(0, 1 - difference / Math.max(asset.duration, durationMs));
    } catch {
      return null;
    }
  }

  private async relinkAsset(asset: MediaHealthAsset, candidatePath: string, healthId: string): Promise<boolean> {
    const stat = await this.storageRepository.stat(candidatePath);
    const relinked = await this.mediaHealthRepository.relinkExternalAsset({
      assetId: asset.id,
      originalPath: path.normalize(candidatePath),
      originalFileName: path.basename(candidatePath),
      checksum: this.cryptoRepository.hashSha1(`path:${path.normalize(candidatePath)}`),
      fileModifiedAt: stat.mtime,
    });

    if (!relinked) {
      return false;
    }

    await this.markRelinked(asset, candidatePath, healthId);
    return true;
  }

  private async markRelinked(asset: MediaHealthAsset, candidatePath: string, healthId: string): Promise<void> {
    await this.mediaHealthRepository.upsertFinding({
      runId: null,
      assetId: asset.id,
      category: MediaHealthCategory.Missing,
      status: MediaHealthStatus.Relinked,
      severity: MediaHealthSeverity.Info,
      originalPath: candidatePath,
      originalFileName: asset.originalFileName,
      evidence: { reason: 'candidate_relinked', previousPath: asset.originalPath },
      resolution: { healthId },
      checkedAt: new Date(),
      resolvedAt: new Date(),
    });

    await this.queueRelinkJobs(asset.id);
  }

  private async queueRelinkJobs(assetId: string): Promise<void> {
    await this.jobRepository.queueAll([
      { name: JobName.SidecarCheck, data: { id: assetId, source: 'upload' } },
      { name: JobName.AssetGenerateThumbnails, data: { id: assetId } },
    ]);
  }

  private groupCandidates(candidates: MediaHealthCandidate[]): Map<string, MediaHealthCandidate[]> {
    const grouped = new Map<string, MediaHealthCandidate[]>();
    for (const candidate of candidates) {
      grouped.set(candidate.healthId, [...(grouped.get(candidate.healthId) ?? []), candidate]);
    }
    return grouped;
  }

  private mapCandidateForRoots(candidate: MediaHealthCandidate, roots: string[] | null) {
    const isOwned = !roots || this.isPathWithinRoots(candidate.candidatePath, roots);
    const evidence = candidate.evidence as Record<string, unknown>;
    const { path: _candidatePath, ...redactedEvidence } = evidence;

    return {
      id: candidate.id,
      healthId: candidate.healthId,
      candidatePath: isOwned ? candidate.candidatePath : 'Exact checksum match in another user directory',
      status: candidate.status,
      visualMatchScore: candidate.visualMatchScore,
      evidence: isOwned ? candidate.evidence : redactedEvidence,
      resolution: candidate.resolution,
      checkedAt: asDateTimeString(candidate.checkedAt),
    };
  }

  private isPathWithinRoots(candidatePath: string, roots: string[]) {
    return roots.some((root) => {
      const relative = path.relative(root, candidatePath);
      return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
    });
  }
}
