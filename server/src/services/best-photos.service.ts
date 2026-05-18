import { Injectable } from '@nestjs/common';
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
import { AssetStatus, AssetType, AssetVisibility, JobName, JobStatus, QueueName } from 'src/enum';
import { AssetJobRepository } from 'src/repositories/asset-job.repository';
import { BestPhotoScoreUpsert, BestPhotosRepository } from 'src/repositories/best-photos.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { MediaRepository } from 'src/repositories/media.repository';
import { JobItem, JobOf } from 'src/types';
import { asDateString } from 'src/utils/date';
import { getHiddenContentQueryOptions } from 'src/utils/hidden-content';

type BestPhotoScoringAsset = NonNullable<Awaited<ReturnType<AssetJobRepository['getForBestPhotoScoring']>>>;

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

@Injectable()
export class BestPhotosService {
  constructor(
    private logger: LoggingRepository,
    private assetJobRepository: AssetJobRepository,
    private bestPhotosRepository: BestPhotosRepository,
    private jobRepository: JobRepository,
    private mediaRepository: MediaRepository,
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
      await this.bestPhotosRepository.upsertScore(await this.scoreAsset(asset));
      return JobStatus.Success;
    } catch (error: Error | any) {
      this.logger.warn(`Failed to score Best Photos asset ${id}: ${error.message || error}`);
      return JobStatus.Failed;
    }
  }

  private isEligible(asset: BestPhotoScoringAsset) {
    return (
      asset.type === AssetType.Image &&
      asset.status === AssetStatus.Active &&
      asset.deletedAt === null &&
      (asset.visibility === AssetVisibility.Timeline || asset.visibility === AssetVisibility.Archive)
    );
  }

  private async scoreAsset(asset: BestPhotoScoringAsset): Promise<BestPhotoScoreUpsert> {
    const thumbnailScore = await this.mediaRepository.scoreThumbnailCandidate(asset.previewFile!);
    const normalizedThumbnailScore = clamp((thumbnailScore + 40) / 220);
    const pixels = Math.max(0, (asset.width ?? 0) * (asset.height ?? 0));
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
      // TODO: Future video scoring can sample frames after transcoding/thumbnail generation,
      // score frames with this image scorer, and suggest the highest-scoring frame as a thumbnail candidate.
      bestFrameTimestampMs: null,
      frameScore: null,
      frameMetadata: null,
    };
  }

  private mapBestPhotoAsset(auth: AuthDto, asset: any): BestPhotoAssetResponseDto {
    return {
      ...mapAsset(asset, { auth }),
      bestPhotoScore: {
        score: asset.bestPhotoScore,
        aestheticScore: asset.bestPhotoAestheticScore,
        technicalScore: asset.bestPhotoTechnicalScore,
        subjectScore: asset.bestPhotoSubjectScore,
        diversityScore: asset.bestPhotoDiversityScore,
        scoreVersion: asset.bestPhotoScoreVersion,
        computedAt: asDateString(asset.bestPhotoComputedAt),
        metadata: asset.bestPhotoMetadata,
        bestFrameTimestampMs: asset.bestPhotoBestFrameTimestampMs,
        frameScore: asset.bestPhotoFrameScore,
        frameMetadata: asset.bestPhotoFrameMetadata,
      },
    };
  }
}
