import { Injectable } from '@nestjs/common';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JOBS_ASSET_PAGINATION_SIZE } from 'src/constants';
import { OnJob } from 'src/decorators';
import { mapAsset } from 'src/dtos/asset-response.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  BEST_PHOTO_SCORE_VERSION,
  BestPhotoAssetResponseDto,
  BestPhotosQueryDto,
  BestPhotosResponseDto,
} from 'src/dtos/best-photos.dto';
import { AssetStatus, AssetType, AssetVisibility, JobName, JobStatus, QueueName, TranscodeTarget } from 'src/enum';
import { AssetJobRepository } from 'src/repositories/asset-job.repository';
import { BestPhotoScoreUpsert, BestPhotosRepository } from 'src/repositories/best-photos.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { MediaRepository } from 'src/repositories/media.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { JobItem, JobOf } from 'src/types';
import { getConfig } from 'src/utils/config';
import { asDateTimeString } from 'src/utils/date';
import { getHiddenContentQueryOptions } from 'src/utils/hidden-content';
import { ThumbnailConfig } from 'src/utils/media';

type BestPhotoScoringAsset = NonNullable<Awaited<ReturnType<AssetJobRepository['getForBestPhotoScoring']>>>;

/** Asset row joined with best_photo_score columns. Derived from the repository
 * return type so a schema change to `asset_best_photo_score` trips the
 * compiler at `mapBestPhotoAsset`. */
type BestPhotoAssetRow = Awaited<ReturnType<BestPhotosRepository['getBestPhotos']>>['items'][number];

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const isScreenshotLike = (fileName: string) =>
  /\b(screen ?shot|screen capture|scan|document|receipt|invoice)\b/i.test(fileName);

// Subject-score heuristic constants. The aim is a mild bump for assets with
// recognizable subjects (faces) without letting a single group photo dominate
// the leaderboard. Three faces is the inflection point where additional faces
// stop adding signal — beyond that we're usually in "crowd" territory which
// doesn't make for a good "best photo".
const FACE_COUNT_CAP = 3;
const PER_FACE_WEIGHT = 0.08;

// Video frame sampling. Videos are scored by extracting a handful of frames
// (via the same ffmpeg thumbnail path used for video previews) and running
// each through the image scorer. The best frame supplies the score and is
// recorded (bestFrameTimestampMs / frameScore / frameMetadata) so clients can
// seek the player or preview to the best moment.
const VIDEO_FRAME_SAMPLE_COUNT = 5;
// Per-video cost ceiling. Each sampled frame is one ffmpeg seek + single-frame
// decode. Media-health bounds its ffmpeg probes at 120 seconds; five frame
// extractions from a <= 15-minute file stay comfortably inside that budget,
// while hour-long screen recordings and dashcam footage are skipped rather
// than monopolizing the background queue.
const VIDEO_SCORE_MAX_DURATION_SECONDS = 15 * 60;

@Injectable()
export class BestPhotosService {
  constructor(
    private logger: LoggingRepository,
    private assetJobRepository: AssetJobRepository,
    private bestPhotosRepository: BestPhotosRepository,
    private jobRepository: JobRepository,
    private mediaRepository: MediaRepository,
    private configRepository: ConfigRepository,
    private systemMetadataRepository: SystemMetadataRepository,
  ) {
    this.logger.setContext(BestPhotosService.name);
  }

  async getBestPhotos(auth: AuthDto, dto: BestPhotosQueryDto): Promise<BestPhotosResponseDto> {
    const { hasNextPage, items, total } = await this.bestPhotosRepository.getBestPhotos({
      ...getHiddenContentQueryOptions(auth),
      ownerId: auth.user.id,
      limit: dto.limit,
      page: dto.page,
      minScore: dto.minScore,
      includeArchived: dto.includeArchived,
    });

    return {
      total,
      count: items.length,
      items: items.map((asset) => this.mapBestPhotoAsset(auth, asset)),
      nextPage: hasNextPage ? String(dto.page + 1) : null,
    };
  }

  @OnJob({ name: JobName.BestPhotosScoreQueueAll, queue: QueueName.BackgroundTask })
  async handleQueueAll({ force }: JobOf<JobName.BestPhotosScoreQueueAll>): Promise<JobStatus> {
    let jobs: JobItem[] = [];

    for await (const asset of this.assetJobRepository.streamForBestPhotosScoring({
      force,
      scoreVersion: BEST_PHOTO_SCORE_VERSION,
    })) {
      jobs.push({ name: JobName.BestPhotosScore, data: { id: asset.id } });

      if (jobs.length >= JOBS_ASSET_PAGINATION_SIZE) {
        await this.jobRepository.queueAll(jobs);
        jobs = [];
      }
    }

    await this.jobRepository.queueAll(jobs);
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.BestPhotosScore, queue: QueueName.BackgroundTask })
  async handleScore({ id }: JobOf<JobName.BestPhotosScore>): Promise<JobStatus> {
    const asset = await this.assetJobRepository.getForBestPhotoScoring(id);
    if (!asset || !this.isEligible(asset)) {
      return JobStatus.Skipped;
    }

    if (!asset.previewFile) {
      this.logger.warn(`Skipping Best Photos scoring for asset ${id}: preview file is missing`);
      return JobStatus.Skipped;
    }

    try {
      const upsert =
        asset.type === AssetType.Video ? await this.scoreVideoAsset(asset) : await this.scoreImageAsset(asset);
      if (!upsert) {
        return JobStatus.Skipped;
      }

      await this.bestPhotosRepository.upsertScore(upsert);
      return JobStatus.Success;
    } catch (error: any) {
      this.logger.warn(`Failed to score Best Photos asset ${id}: ${error.message || error}`);
      return JobStatus.Failed;
    }
  }

  private isEligible(asset: BestPhotoScoringAsset) {
    return (
      (asset.type === AssetType.Image || asset.type === AssetType.Video) &&
      asset.status === AssetStatus.Active &&
      asset.deletedAt === null &&
      (asset.visibility === AssetVisibility.Timeline || asset.visibility === AssetVisibility.Archive)
    );
  }

  private async scoreImageAsset(asset: BestPhotoScoringAsset): Promise<BestPhotoScoreUpsert> {
    const thumbnailScore = await this.mediaRepository.scoreThumbnailCandidate(asset.previewFile!);
    return this.buildScoreUpsert(asset, thumbnailScore, asset.width, asset.height);
  }

  /** Samples frames across the video, scores each with the image scorer, and
   * records the best frame. Returns null (job skipped) when the video has no
   * probe data, is over the duration cap, or no frame could be extracted. */
  private async scoreVideoAsset(asset: BestPhotoScoringAsset): Promise<BestPhotoScoreUpsert | null> {
    // Reuse the video-duplicate frame query: it returns exactly the metadata
    // frame extraction needs (originalPath + probed videoStream/format).
    const video = await this.assetJobRepository.getForVideoDuplicateFrameJob(asset.id);
    if (!video) {
      this.logger.debug(`Skipping Best Photos video scoring for asset ${asset.id}: missing video metadata`);
      return null;
    }

    const durationSeconds = video.format.duration / 1000;
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      this.logger.debug(`Skipping Best Photos video scoring for asset ${asset.id}: unknown duration`);
      return null;
    }

    if (durationSeconds > VIDEO_SCORE_MAX_DURATION_SECONDS) {
      this.logger.debug(
        `Skipping Best Photos video scoring for asset ${asset.id}: duration ${Math.round(durationSeconds)}s exceeds the ${VIDEO_SCORE_MAX_DURATION_SECONDS}s cap`,
      );
      return null;
    }

    const timestamps = this.getVideoFrameSampleTimestamps(durationSeconds);
    if (timestamps.length === 0) {
      return null;
    }

    const config = await getConfig(
      { configRepo: this.configRepository, metadataRepo: this.systemMetadataRepository, logger: this.logger },
      { withCache: true },
    );
    const thumbnailConfig = { ...config.ffmpeg, targetResolution: config.image.preview.size.toString() };

    let best: { timestamp: number; thumbnailScore: number } | null = null;
    const sampledFrames: Array<{ timestampMs: number; thumbnailScore: number }> = [];
    const tempDir = await mkdtemp(path.join(tmpdir(), 'immich-best-photos-'));
    try {
      for (const [index, timestamp] of timestamps.entries()) {
        const framePath = path.join(tempDir, `frame_${index}.jpeg`);
        try {
          const command = ThumbnailConfig.create(thumbnailConfig, timestamp).getCommand(
            TranscodeTarget.Video,
            video.videoStream,
            undefined,
            video.format,
          );
          await this.mediaRepository.transcode(video.originalPath, framePath, command);
          const thumbnailScore = await this.mediaRepository.scoreThumbnailCandidate(framePath);
          sampledFrames.push({ timestampMs: Math.round(timestamp * 1000), thumbnailScore });
          if (!best || thumbnailScore > best.thumbnailScore) {
            best = { timestamp, thumbnailScore };
          }
        } catch (error: any) {
          // A frame can fail to extract when its start_time lands in the
          // sparse-keyframe dead zone near EOF. Skip just that frame.
          this.logger.warn(
            `Could not score Best Photos video frame for asset ${asset.id} at ${timestamp}s: ${error?.message ?? error}`,
          );
        }
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }

    if (!best) {
      this.logger.warn(`Skipping Best Photos video scoring for asset ${asset.id}: no frame could be extracted`);
      return null;
    }

    const upsert = this.buildScoreUpsert(
      asset,
      best.thumbnailScore,
      asset.width ?? video.videoStream.width,
      asset.height ?? video.videoStream.height,
    );

    return {
      ...upsert,
      bestFrameTimestampMs: Math.round(best.timestamp * 1000),
      frameScore: clamp((best.thumbnailScore + 40) / 220),
      frameMetadata: {
        durationMs: video.format.duration,
        sampledFrameCount: timestamps.length,
        frames: sampledFrames,
      },
    };
  }

  /** Evenly spread sample points, avoiding the sparse-keyframe dead zone near
   * the end of the file (see the video thumbnail candidate logic in
   * media.service for the same tail reservation). */
  private getVideoFrameSampleTimestamps(durationSeconds: number): number[] {
    const tail = Math.min(Math.max(durationSeconds * 0.1, 0.5), 5);
    const latest = Math.max(durationSeconds - tail, 0);

    return [
      ...new Set(
        Array.from({ length: VIDEO_FRAME_SAMPLE_COUNT }, (_, index) => {
          const timestamp = (durationSeconds * (index + 1)) / (VIDEO_FRAME_SAMPLE_COUNT + 1);
          return Number(Math.min(timestamp, latest).toFixed(3));
        }),
      ),
    ].filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0);
  }

  private buildScoreUpsert(
    asset: BestPhotoScoringAsset,
    thumbnailScore: number,
    width: number | null,
    height: number | null,
  ): BestPhotoScoreUpsert {
    const normalizedThumbnailScore = clamp((thumbnailScore + 40) / 220);
    const pixels = Math.max(0, (width ?? 0) * (height ?? 0));
    const resolutionScore = clamp((Math.sqrt(pixels) - 700) / 3300);
    const tinyPenalty = pixels > 0 && pixels < 500_000 ? 0.2 : 0;
    const screenshotPenalty = isScreenshotLike(asset.originalFileName) ? 0.2 : 0;

    const technicalScore = clamp(normalizedThumbnailScore * 0.75 + resolutionScore * 0.25 - tinyPenalty);
    const subjectScore = clamp(0.5 + Math.min(asset.faceCount, FACE_COUNT_CAP) * PER_FACE_WEIGHT - screenshotPenalty);
    const aestheticScore = clamp(normalizedThumbnailScore * 0.85 + subjectScore * 0.15 - screenshotPenalty);
    const diversityScore = 0.5;

    // scoreVersion 1 is a local deterministic heuristic. Future versions can use Immich ML-service hooks.
    const score = clamp(0.45 * aestheticScore + 0.3 * technicalScore + 0.15 * subjectScore + 0.1 * diversityScore);

    return {
      assetId: asset.id,
      ownerId: asset.ownerId,
      score,
      aestheticScore,
      technicalScore,
      subjectScore,
      diversityScore,
      scoreVersion: BEST_PHOTO_SCORE_VERSION,
      computedAt: new Date(),
      metadata: {
        thumbnailScore,
        normalizedThumbnailScore,
        resolutionScore,
        pixels,
        faceCount: asset.faceCount,
        screenshotPenalty,
        tinyPenalty,
      },
      // Video scoring fills these in (see scoreVideoAsset); images have no frames.
      bestFrameTimestampMs: null,
      frameScore: null,
      frameMetadata: null,
    };
  }

  private mapBestPhotoAsset(auth: AuthDto, asset: BestPhotoAssetRow): BestPhotoAssetResponseDto {
    return {
      ...mapAsset(asset, { auth }),
      bestPhotoScore: {
        score: asset.bestPhotoScore,
        aestheticScore: asset.bestPhotoAestheticScore,
        technicalScore: asset.bestPhotoTechnicalScore,
        subjectScore: asset.bestPhotoSubjectScore,
        diversityScore: asset.bestPhotoDiversityScore,
        scoreVersion: asset.bestPhotoScoreVersion,
        computedAt: asDateTimeString(asset.bestPhotoComputedAt),
        metadata: asset.bestPhotoMetadata,
        bestFrameTimestampMs: asset.bestPhotoBestFrameTimestampMs,
        frameScore: asset.bestPhotoFrameScore,
        frameMetadata: asset.bestPhotoFrameMetadata,
      },
    };
  }
}
