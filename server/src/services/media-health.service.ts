import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { execFile as execFileCallback } from 'node:child_process';
import { constants } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { SystemConfig } from 'src/config';
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
  Colorspace,
  JobName,
  JobStatus,
  MediaHealthCategory,
  MediaHealthSeverity,
  MediaHealthStatus,
  QueueName,
} from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { CryptoRepository } from 'src/repositories/crypto.repository';
import { EventRepository } from 'src/repositories/event.repository';
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
import { StorageRepository } from 'src/repositories/storage.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { JobOf } from 'src/types';
import { getConfig } from 'src/utils/config';
import { asDateString } from 'src/utils/date';
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
    private jobRepository: JobRepository,
    private libraryRepository: LibraryRepository,
    private mediaHealthRepository: MediaHealthRepository,
    private mediaRepository: MediaRepository,
    private storageRepository: StorageRepository,
    private systemMetadataRepository: SystemMetadataRepository,
    private userRepository: UserRepository,
  ) {
    this.logger.setContext(MediaHealthService.name);
  }

  async list(auth: AuthDto, dto: MediaHealthListQueryDto): Promise<MediaHealthListResponseDto> {
    const size = dto.size ?? MEDIA_HEALTH_PAGE_SIZE;
    const [findings, run] = await Promise.all([
      this.mediaHealthRepository.list({ category: dto.category, status: dto.status, size }),
      this.mediaHealthRepository.getLatestRun(dto.category),
    ]);
    const [assets, candidates] = await Promise.all([
      this.mediaHealthRepository.getAssets(findings.map(({ assetId }) => assetId)),
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

      const timeBucket = asset.localDateTime.toISOString().slice(0, 10);
      const bucket = buckets.get(timeBucket) ?? { timeBucket, count: 0, items: [] };
      bucket.items.push({
        id: finding.id,
        assetId: finding.assetId,
        category: finding.category,
        status: finding.status,
        severity: finding.severity,
        originalPath: finding.originalPath,
        originalFileName: finding.originalFileName,
        evidence: finding.evidence,
        resolution: finding.resolution,
        checkedAt: asDateString(finding.checkedAt),
        dismissedAt: finding.dismissedAt ? asDateString(finding.dismissedAt) : null,
        resolvedAt: finding.resolvedAt ? asDateString(finding.resolvedAt) : null,
        asset: mapAsset(asset, { auth }),
        candidates: (candidatesByHealthId.get(finding.id) ?? []).map((candidate) => ({
          id: candidate.id,
          healthId: candidate.healthId,
          candidatePath: candidate.candidatePath,
          status: candidate.status,
          visualMatchScore: candidate.visualMatchScore,
          evidence: candidate.evidence,
          resolution: candidate.resolution,
          checkedAt: asDateString(candidate.checkedAt),
        })),
      });
      bucket.count = bucket.items.length;
      buckets.set(timeBucket, bucket);
    }

    return { buckets: [...buckets.values()], total: findings.length, run: run ? this.mapRun(run) : null };
  }

  async startMissingScan(): Promise<MediaHealthScanResponseDto> {
    const run = await this.mediaHealthRepository.createRun(MediaHealthCategory.Missing);
    await this.jobRepository.queue({ name: JobName.MediaHealthScanMissing, data: { runId: run.id } });
    return { runId: run.id };
  }

  async startCorruptScan(): Promise<MediaHealthScanResponseDto> {
    const run = await this.mediaHealthRepository.createRun(MediaHealthCategory.Corrupt);
    await this.jobRepository.queue({ name: JobName.MediaHealthScanCorrupt, data: { runId: run.id } });
    return { runId: run.id };
  }

  async locateMissing(dto: MediaHealthBulkActionDto): Promise<MediaHealthScanResponseDto> {
    const run = await this.mediaHealthRepository.createRun(MediaHealthCategory.Missing);
    await this.jobRepository.queue({ name: JobName.MediaHealthLocateMissing, data: { runId: run.id, ids: dto.ids } });
    return { runId: run.id };
  }

  async dismiss(dto: MediaHealthBulkActionDto): Promise<void> {
    await this.mediaHealthRepository.markDismissed(dto.ids);
  }

  async relinkMissing(dto: MediaHealthBulkActionDto): Promise<MediaHealthBulkResponseDto> {
    const findings = await this.mediaHealthRepository.getByIds(dto.ids);
    const assets = await this.mediaHealthRepository.getAssets(findings.map(({ assetId }) => assetId));
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
    const candidates = await this.mediaHealthRepository.getCandidatesByHealthIds(findings.map(({ id }) => id));
    const candidatesByHealthId = this.groupCandidates(candidates);

    const results: MediaHealthBulkResponseDto['results'] = [];
    for (const finding of findings) {
      const asset = assetsById.get(finding.assetId);
      const candidates = (candidatesByHealthId.get(finding.id) ?? []).filter(
        ({ status }) => status === MediaHealthStatus.Found,
      );

      if (!asset || candidates.length !== 1 || !asset.isExternal || !asset.libraryId) {
        results.push({
          id: finding.id,
          success: false,
          error: 'Finding does not have exactly one validated external-library candidate',
        });
        continue;
      }

      const candidate = candidates[0];
      const validation = await this.validateMissingCandidate(asset, candidate.candidatePath);
      if (validation.status !== MediaHealthStatus.Found) {
        results.push({
          id: finding.id,
          success: false,
          error: String(validation.evidence.reason ?? 'Invalid candidate'),
        });
        continue;
      }

      await this.relinkAsset(asset, candidate.candidatePath, finding.id);
      results.push({ id: finding.id, success: true, status: MediaHealthStatus.Relinked });
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

    const findings = await this.mediaHealthRepository.getByIds(dto.ids);
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

    const assets = await this.mediaHealthRepository.getAssets(accepted.map(({ assetId }) => assetId));
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
    const createdRun = job.runId ? null : await this.mediaHealthRepository.createRun(MediaHealthCategory.Missing);
    const run = job.runId ?? createdRun!.id;
    let checkedAssets = 0;
    let foundAssets = 0;

    try {
      for await (const asset of this.mediaHealthRepository.streamAssets({ assetIds: job.assetIds })) {
        checkedAssets++;
        const missing = !(await this.storageRepository.checkFileExists(asset.originalPath, constants.R_OK));
        if (!missing) {
          await this.mediaHealthRepository.markResolved(MediaHealthCategory.Missing, asset.id);
          continue;
        }

        foundAssets++;
        await this.mediaHealthRepository.upsertFinding({
          runId: run,
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

  @OnJob({ name: JobName.MediaHealthLocateMissing, queue: QueueName.MediaHealth })
  async handleLocateMissing(job: JobOf<JobName.MediaHealthLocateMissing>): Promise<JobStatus> {
    const createdRun = job.runId ? null : await this.mediaHealthRepository.createRun(MediaHealthCategory.Missing);
    const run = job.runId ?? createdRun!.id;
    const findings = await this.mediaHealthRepository.getByIds(job.ids ?? []);
    const assets = await this.mediaHealthRepository.getAssets(findings.map(({ assetId }) => assetId));
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
    let checkedAssets = 0;
    let foundAssets = 0;

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

        const candidates = await this.locateCandidates(asset);
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
        if (validCandidates.length === 1 && asset.isExternal && asset.libraryId) {
          await this.relinkAsset(asset, validCandidates[0].evidence.path as string, finding.id);
        }
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
    const createdRun = job.runId ? null : await this.mediaHealthRepository.createRun(MediaHealthCategory.Corrupt);
    const run = job.runId ?? createdRun!.id;
    let checkedAssets = 0;
    let foundAssets = 0;

    try {
      for await (const asset of this.mediaHealthRepository.streamAssets({ assetIds: job.assetIds })) {
        checkedAssets++;
        const result = await this.validateAssetIntegrity(asset);
        if (!result) {
          await this.mediaHealthRepository.markResolved(MediaHealthCategory.Corrupt, asset.id);
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

  @OnJob({ name: JobName.MediaHealthDeleteCorrupt, queue: QueueName.MediaHealth })
  async handleDeleteCorrupt(job: JobOf<JobName.MediaHealthDeleteCorrupt>): Promise<JobStatus> {
    const findings = await this.mediaHealthRepository.getByIds(job.ids);
    const assets = await this.mediaHealthRepository.getAssets(findings.map(({ assetId }) => assetId));
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
      startedAt: asDateString(run.startedAt),
      finishedAt: run.finishedAt ? asDateString(run.finishedAt) : null,
      totalAssets: run.totalAssets,
      checkedAssets: run.checkedAssets,
      foundAssets: run.foundAssets,
      error: run.error,
    };
  }

  private async validateAssetIntegrity(asset: MediaHealthAsset): Promise<CandidateValidation | null> {
    const sourceExists = await this.storageRepository.checkFileExists(asset.originalPath, constants.R_OK);
    if (!sourceExists) {
      return null;
    }

    return asset.type === AssetType.Video ? this.validateVideo(asset) : this.validateImage(asset);
  }

  private async validateImage(asset: MediaHealthAsset): Promise<CandidateValidation | null> {
    const config = await this.getConfig();
    const isRaw = mimeTypes.isRaw(asset.originalFileName);
    const enhancedRawEnabled = config.image.enhancedRaw?.enabled !== false;
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

  private async locateCandidates(asset: MediaHealthAsset): Promise<CandidateValidation[]> {
    if (!asset.isExternal || !asset.libraryId) {
      return [];
    }

    const library = await this.libraryRepository.get(asset.libraryId);
    if (!library) {
      return [];
    }

    const results: CandidateValidation[] = [];
    for await (const batch of this.storageRepository.walk({
      pathsToCrawl: library.importPaths,
      exclusionPatterns: library.exclusionPatterns,
      includeHidden: false,
      take: 500,
    })) {
      for (const candidatePath of batch) {
        if (path.basename(candidatePath) !== asset.originalFileName || candidatePath === asset.originalPath) {
          continue;
        }

        results.push(await this.validateMissingCandidate(asset, candidatePath));
      }
    }

    return results;
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

  private async relinkAsset(asset: MediaHealthAsset, candidatePath: string, healthId: string): Promise<void> {
    const stat = await this.storageRepository.stat(candidatePath);
    await this.mediaHealthRepository.relinkExternalAsset({
      assetId: asset.id,
      originalPath: path.normalize(candidatePath),
      originalFileName: path.basename(candidatePath),
      checksum: this.cryptoRepository.hashSha1(`path:${path.normalize(candidatePath)}`),
      fileModifiedAt: stat.mtime,
    });

    await this.mediaHealthRepository.upsertFinding({
      runId: null,
      assetId: asset.id,
      category: MediaHealthCategory.Missing,
      status: MediaHealthStatus.Relinked,
      severity: MediaHealthSeverity.Info,
      originalPath: candidatePath,
      originalFileName: path.basename(candidatePath),
      evidence: { reason: 'candidate_relinked', previousPath: asset.originalPath },
      resolution: { healthId },
      checkedAt: new Date(),
      resolvedAt: new Date(),
    });

    await this.jobRepository.queueAll([
      { name: JobName.SidecarCheck, data: { id: asset.id, source: 'upload' } },
      { name: JobName.AssetGenerateThumbnails, data: { id: asset.id } },
    ]);
  }

  private groupCandidates(candidates: MediaHealthCandidate[]): Map<string, MediaHealthCandidate[]> {
    const grouped = new Map<string, MediaHealthCandidate[]>();
    for (const candidate of candidates) {
      grouped.set(candidate.healthId, [...(grouped.get(candidate.healthId) ?? []), candidate]);
    }
    return grouped;
  }
}
