import { Injectable } from '@nestjs/common';
import { SystemConfig } from 'src/config';
import { JOBS_ASSET_PAGINATION_SIZE } from 'src/constants';
import { StorageCore } from 'src/cores/storage.core';
import { OnJob } from 'src/decorators';
import { BulkIdErrorReason, BulkIdResponseDto, BulkIdsDto } from 'src/dtos/asset-ids.response.dto';
import { MapAsset, mapAsset } from 'src/dtos/asset-response.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { DuplicateResolveDto, DuplicateResolveGroupDto, DuplicateResponseDto } from 'src/dtos/duplicate.dto';
import {
  AssetStatus,
  AssetType,
  AssetVisibility,
  JobName,
  JobStatus,
  Permission,
  QueueName,
  StorageFolder,
  TranscodeTarget,
} from 'src/enum';
import { AssetDuplicateResult } from 'src/repositories/search.repository';
import { BaseService } from 'src/services/base.service';
import { JobItem, JobOf } from 'src/types';
import { suggestDuplicateKeepAssetIds } from 'src/utils/duplicate';
import { getHiddenContentQueryOptions } from 'src/utils/hidden-content';
import { ThumbnailConfig } from 'src/utils/media';
import { isDuplicateDetectionEnabled } from 'src/utils/misc';

type ResolveRequest = {
  assetUpdate: {
    isFavorite?: boolean;
    visibility?: AssetVisibility;
  };

  exifUpdate: {
    rating?: number;
    latitude?: number;
    longitude?: number;
    description?: string;
  };

  mergedAlbumIds: string[];

  mergedTagIds: string[];

  mergedTagValues: string[];
};

// Minimum number of sampled frame timestamps required before we attempt
// enhanced video duplicate detection. (Used as a count threshold.)
const VIDEO_DUPLICATE_FRAME_MIN_COUNT = 2;
// Minimum video duration in seconds for enhanced video duplicate detection to
// be attempted. Coincidentally the same numeric value as the min count above,
// but separated for clarity since the units are different.
const VIDEO_DUPLICATE_MIN_DURATION_SECONDS = 2;
const VIDEO_DUPLICATE_FRAME_START_PADDING_SECONDS = 1;
const VIDEO_DUPLICATE_FRAME_END_PADDING_SECONDS = 1;
// The ffmpeg keyframe sampler (`-skip_frame nointra`) emits no frames when the
// sampled start_time lands in the sparse-keyframe dead zone near EOF, which
// makes transcode() fail. A flat 1s tail is too small for short clips with a
// high frameCount (a sample can collapse onto duration-1), so additionally keep
// the latest sample a fraction of the duration clear of the end. 0.2 matches the
// last evenly-spaced sample (duration * frameCount / (frameCount + 1)) for the
// default frameCount of 4, so typical clips are unaffected.
const VIDEO_DUPLICATE_FRAME_END_PADDING_FRACTION = 0.2;

const getEnhancedVideoDuplicateConfig = (machineLearning: SystemConfig['machineLearning']) => {
  const { duplicateDetection } = machineLearning;
  const enhancedVideo = duplicateDetection.enhancedVideo ?? {
    enabled: true,
    frameCount: 4,
    minMatchingFrames: 2,
    maxDistance: duplicateDetection.maxDistance,
  };

  return {
    enabled: enhancedVideo.enabled,
    frameCount: enhancedVideo.frameCount,
    minMatchingFrames: enhancedVideo.minMatchingFrames,
    maxDistance: enhancedVideo.maxDistance ?? duplicateDetection.maxDistance,
  };
};

const uniqueNonEmptyLines = (values: Array<string | null | undefined>): string[] => {
  const unique = new Set<string>();
  const lines: string[] = [];
  for (const value of values) {
    if (!value) {
      continue;
    }
    for (const line of value.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || unique.has(trimmed)) {
        continue;
      }
      unique.add(trimmed);
      lines.push(trimmed);
    }
  }
  return lines;
};

const getUniqueCoordinate = (assets: MapAsset[], key: 'latitude' | 'longitude'): number | null => {
  const values = assets
    .map((asset) => asset.exifInfo?.[key])
    .filter((value): value is number => Number.isFinite(value));

  if (values.length === 0) {
    return null;
  }

  const unique = new Set(values);
  return unique.size === 1 ? [...unique][0] : null;
};

@Injectable()
export class DuplicateService extends BaseService {
  async getDuplicates(auth: AuthDto): Promise<DuplicateResponseDto[]> {
    // Clean up singleton groups (assets that are the only member of their duplicate group)
    await this.duplicateRepository.cleanupSingletonGroups(auth.user.id);

    const { machineLearning } = await this.getConfig({ withCache: true });
    const { preferOriginalFormat } = machineLearning.duplicateDetection;

    const duplicates = await this.duplicateRepository.getAll(auth.user.id, this.nsfwOptions(auth));
    return duplicates.map(({ duplicateId, assets }) => {
      const mappedAssets = assets.map((asset) => mapAsset(asset, { auth }));
      return {
        duplicateId,
        assets: mappedAssets,
        suggestedKeepAssetIds: suggestDuplicateKeepAssetIds(mappedAssets, { preferOriginalFormat }),
      };
    });
  }

  async delete(auth: AuthDto, id: string): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.DuplicateDelete, ids: [id] });
    await this.duplicateRepository.delete(auth.user.id, id);
  }

  async deleteAll(auth: AuthDto, dto: BulkIdsDto) {
    await this.requireAccess({ auth, permission: Permission.DuplicateDelete, ids: dto.ids });
    await this.duplicateRepository.deleteAll(auth.user.id, dto.ids);
  }

  async resolve(auth: AuthDto, dto: DuplicateResolveDto) {
    const duplicateIds = dto.groups.map(({ duplicateId }) => duplicateId);

    await this.requireAccess({ auth, permission: Permission.DuplicateDelete, ids: duplicateIds });

    const results: BulkIdResponseDto[] = [];

    for (const group of dto.groups) {
      try {
        results.push(await this.resolveGroup(auth, group));
      } catch (error: Error | any) {
        this.logger.error(`Error resolving duplicate group ${group.duplicateId}: ${error}`, error?.stack);
        results.push({ id: group.duplicateId, success: false, error: BulkIdErrorReason.UNKNOWN });
      }
    }

    return results;
  }

  private async resolveGroup(auth: AuthDto, group: DuplicateResolveGroupDto): Promise<BulkIdResponseDto> {
    const { duplicateId, keepAssetIds, trashAssetIds } = group;

    const duplicateGroup = await this.duplicateRepository.get(duplicateId, this.nsfwOptions(auth));
    if (!duplicateGroup) {
      return { id: duplicateId, success: false, error: BulkIdErrorReason.NOT_FOUND };
    }

    const groupAssetIds = new Set(duplicateGroup.assets.map((a) => a.id));

    // SECURITY (server.md Medium #nsfwOptions): explicitly reject ids the
    // user didn't see when their NSFW privacy is on. Silently filtering would
    // let an attacker probe for hidden ids by guessing UUIDs in the
    // trashAssetIds list.
    const submittedIds = [...keepAssetIds, ...trashAssetIds];
    const unknownIds = submittedIds.filter((id) => !groupAssetIds.has(id));
    if (unknownIds.length > 0) {
      return {
        id: duplicateId,
        success: false,
        error: BulkIdErrorReason.NOT_FOUND,
        errorMessage: 'One or more assetIds are not part of this duplicate group',
      };
    }

    const idsToKeep = keepAssetIds;
    const idsToTrash = trashAssetIds;

    for (const assetId of groupAssetIds) {
      if (idsToKeep.includes(assetId) && idsToTrash.includes(assetId)) {
        return {
          id: duplicateId,
          success: false,
          error: BulkIdErrorReason.VALIDATION,
          errorMessage: 'An asset cannot be in both keepAssetIds and trashAssetIds',
        };
      }

      if (!idsToKeep.includes(assetId) && !idsToTrash.includes(assetId)) {
        return {
          id: duplicateId,
          success: false,
          error: BulkIdErrorReason.VALIDATION,
          errorMessage: 'Every asset must be in either keepAssetIds or trashAssetIds',
        };
      }
    }

    if (idsToTrash.length > 0) {
      const ids = await this.checkAccess({ auth, permission: Permission.AssetDelete, ids: idsToTrash });
      if (ids.size !== idsToTrash.length) {
        return {
          id: duplicateId,
          success: false,
          error: BulkIdErrorReason.NO_PERMISSION,
          errorMessage: 'No permission to delete assets',
        };
      }
    }

    // Only merge metadata into the keeper when exactly one asset can absorb trashed duplicates.
    if (idsToKeep.length === 1 && idsToTrash.length > 0) {
      const assetAlbumMap = await this.albumRepository.getByAssetIds(auth.user.id, [...groupAssetIds]);

      const { assetUpdate, exifUpdate, mergedAlbumIds, mergedTagIds, mergedTagValues } = this.getSyncMergeResult(
        duplicateGroup.assets,
        assetAlbumMap,
      );

      if (mergedAlbumIds.length > 0) {
        const allowedAlbumIds = await this.checkAccess({
          auth,
          permission: Permission.AlbumAssetCreate,
          ids: mergedAlbumIds,
        });

        const allowedShareIds = await this.checkAccess({
          auth,
          permission: Permission.AssetShare,
          ids: idsToKeep,
        });

        if (allowedAlbumIds.size > 0 && allowedShareIds.size > 0) {
          await this.albumRepository.addAssetIdsToAlbums(
            [...allowedAlbumIds].flatMap((albumId) => [...allowedShareIds].map((assetId) => ({ albumId, assetId }))),
          );
        }
      }

      if (mergedTagIds.length > 0) {
        const allowedTagIds = await this.checkAccess({
          auth,
          permission: Permission.TagAsset,
          ids: mergedTagIds,
        });

        if (allowedTagIds.size > 0) {
          await Promise.all(
            idsToKeep.map((assetId) => this.tagRepository.replaceAssetTags(assetId, [...allowedTagIds])),
          );

          await this.assetRepository.updateAllExif(idsToKeep, { tags: mergedTagValues });
        }
      }

      const hasExifUpdate = Object.keys(exifUpdate).length > 0;
      const hasTagUpdate = mergedTagIds.length > 0;

      if (hasExifUpdate) {
        await this.assetRepository.updateAllExif(idsToKeep, exifUpdate);
      }

      if (hasExifUpdate || hasTagUpdate) {
        await this.jobRepository.queueAll(idsToKeep.map((id) => ({ name: JobName.SidecarWrite, data: { id } })));
      }

      await this.assetRepository.updateAll(idsToKeep, { duplicateId: null, ...assetUpdate });
    } else if (idsToKeep.length > 0) {
      await this.assetRepository.updateAll(idsToKeep, { duplicateId: null });
    }

    if (idsToTrash.length > 0) {
      // TODO: this is duplicated with AssetService.deleteAssets
      const { trash } = await this.getConfig({ withCache: true });
      const isForce = !trash.enabled;

      await this.assetRepository.updateAll(idsToTrash, {
        deletedAt: new Date(),
        status: isForce ? AssetStatus.Deleted : AssetStatus.Trashed,
        duplicateId: null,
      });

      await this.eventRepository.emit(isForce ? 'AssetDeleteAll' : 'AssetTrashAll', {
        assetIds: idsToTrash,
        userId: auth.user.id,
      });
    }

    return { id: duplicateId, success: true };
  }

  private getSyncMergeResult(assets: MapAsset[], assetAlbumMap: Map<string, string[]> = new Map()): ResolveRequest {
    const response: ResolveRequest = {
      mergedAlbumIds: [],
      mergedTagIds: [],
      mergedTagValues: [],
      assetUpdate: {},
      exifUpdate: {},
    };

    response.assetUpdate.isFavorite = assets.some((asset) => asset.isFavorite);

    const visibilityOrder = [AssetVisibility.Locked, AssetVisibility.Archive, AssetVisibility.Timeline];
    let visibility = visibilityOrder.find((level) => assets.some((asset) => asset.visibility === level));
    if (!visibility && assets.some((asset) => asset.visibility === AssetVisibility.Hidden)) {
      visibility = AssetVisibility.Hidden;
    }
    if (visibility) {
      response.assetUpdate.visibility = visibility;
    }

    let rating = 0;
    for (const asset of assets) {
      const assetRating = asset.exifInfo?.rating ?? 0;
      if (assetRating > rating) {
        rating = assetRating;
      }
    }
    if (rating > 0) {
      response.exifUpdate.rating = rating;
    }

    const descriptionLines = uniqueNonEmptyLines(assets.map((asset) => asset.exifInfo?.description));
    const description = descriptionLines.length > 0 ? descriptionLines.join('\n') : null;
    if (description !== null) {
      response.exifUpdate.description = description;
    }

    const latitude = getUniqueCoordinate(assets, 'latitude');
    const longitude = getUniqueCoordinate(assets, 'longitude');
    if (latitude !== null && longitude !== null) {
      response.exifUpdate.latitude = latitude;
      response.exifUpdate.longitude = longitude;
    }

    const albumIdSet = new Set<string>();
    for (const [, albumIds] of assetAlbumMap) {
      for (const albumId of albumIds) {
        albumIdSet.add(albumId);
      }
    }
    response.mergedAlbumIds = [...albumIdSet];

    const allTags = assets.flatMap((asset) => asset.tags ?? []);
    const tagIds = [...new Set(allTags.map((tag) => tag.id).filter((id): id is string => !!id))];
    const tagValues = [...new Set(allTags.map((tag) => tag.value).filter((v): v is string => !!v))];
    if (tagIds.length > 0) {
      response.mergedTagIds = tagIds;
      response.mergedTagValues = tagValues;
    }

    return response;
  }

  private nsfwOptions(auth: AuthDto) {
    return getHiddenContentQueryOptions(auth);
  }

  @OnJob({ name: JobName.AssetDetectDuplicatesQueueAll, queue: QueueName.DuplicateDetection })
  async handleQueueSearchDuplicates({ force }: JobOf<JobName.AssetDetectDuplicatesQueueAll>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    if (!isDuplicateDetectionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    let jobs: JobItem[] = [];
    const queueAll = async () => {
      await this.jobRepository.queueAll(jobs);
      jobs = [];
    };

    const assets = this.assetJobRepository.streamForSearchDuplicates(force);
    for await (const asset of assets) {
      jobs.push({ name: JobName.AssetDetectDuplicates, data: { id: asset.id } });
      if (jobs.length >= JOBS_ASSET_PAGINATION_SIZE) {
        await queueAll();
      }
    }

    await queueAll();

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.AssetGenerateVideoDuplicateFramesQueueAll, queue: QueueName.VideoDuplicateDetection })
  async handleQueueGenerateVideoDuplicateFrames({
    force,
  }: JobOf<JobName.AssetGenerateVideoDuplicateFramesQueueAll>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    if (!isDuplicateDetectionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    const enhancedVideo = getEnhancedVideoDuplicateConfig(machineLearning);
    if (!enhancedVideo.enabled) {
      return JobStatus.Skipped;
    }

    let jobs: JobItem[] = [];
    const queueAll = async () => {
      await this.jobRepository.queueAll(jobs);
      jobs = [];
    };

    const assets = this.assetJobRepository.streamForVideoDuplicateFrames({
      force,
      frameCount: enhancedVideo.frameCount,
    });
    for await (const asset of assets) {
      jobs.push({ name: JobName.AssetGenerateVideoDuplicateFrames, data: { id: asset.id } });
      if (jobs.length >= JOBS_ASSET_PAGINATION_SIZE) {
        await queueAll();
      }
    }

    await queueAll();

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.AssetGenerateVideoDuplicateFrames, queue: QueueName.VideoDuplicateDetection })
  async handleGenerateVideoDuplicateFrames({
    id,
  }: JobOf<JobName.AssetGenerateVideoDuplicateFrames>): Promise<JobStatus> {
    const config = await this.getConfig({ withCache: true });
    const { machineLearning } = config;
    if (!isDuplicateDetectionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    const enhancedVideo = getEnhancedVideoDuplicateConfig(machineLearning);
    if (!enhancedVideo.enabled) {
      return JobStatus.Skipped;
    }

    const asset = await this.assetJobRepository.getForVideoDuplicateFrameJob(id);
    if (!asset) {
      this.logger.error(`Asset ${id} not found`);
      return JobStatus.Failed;
    }

    if (asset.visibility === AssetVisibility.Hidden || asset.visibility === AssetVisibility.Locked) {
      this.logger.debug(`Asset ${id} is not visible, skipping`);
      return JobStatus.Skipped;
    }

    const timestamps = this.getVideoDuplicateFrameTimestamps(enhancedVideo.frameCount, asset.format);
    if (timestamps.length < VIDEO_DUPLICATE_FRAME_MIN_COUNT) {
      this.logger.debug(`Asset ${id} is too short for enhanced video duplicate detection`);
      await this.assetRepository.upsertJobStatus({ assetId: asset.id, duplicatesDetectedAt: new Date() });
      return JobStatus.Skipped;
    }

    const frames = [];
    for (const [frameIndex, timestamp] of timestamps.entries()) {
      const path = StorageCore.getNestedPath(
        StorageFolder.Thumbnails,
        asset.ownerId,
        `${asset.id}_video_duplicate_${frameIndex}.jpeg`,
      );
      this.storageCore.ensureFolders(path);

      const command = ThumbnailConfig.create(
        { ...config.ffmpeg, targetResolution: config.image.preview.size.toString() },
        timestamp,
      ).getCommand(TranscodeTarget.Video, asset.videoStream, undefined, asset.format);

      try {
        await this.mediaRepository.transcode(asset.originalPath, path, command);
        const embedding = await this.machineLearningRepository.encodeImage(path, machineLearning.clip);

        frames.push({
          assetId: asset.id,
          frameIndex,
          timestampMs: Math.round(timestamp * 1000),
          path,
          embedding,
        });
      } catch (error: Error | any) {
        // A single frame can fail to extract when its sampled start_time lands in
        // the sparse-keyframe dead zone near EOF (ffmpeg writes no packets and
        // exits non-zero). Skip just that frame instead of failing the whole job.
        this.logger.warn(
          `Failed to extract video duplicate frame ${frameIndex} for asset ${asset.id} at ${timestamp}s: ${error}`,
          error?.stack,
        );
      }
    }

    if (frames.length === 0) {
      // Every frame failed: don't fall through to replaceVideoDuplicateFrames([]),
      // which would delete any previously-stored frames for this asset. Surface
      // the job as failed so it can be retried.
      this.logger.warn(`Failed to extract any video duplicate frames for asset ${asset.id}`);
      return JobStatus.Failed;
    }

    const newConfig = await this.getConfig({ withCache: false });
    if (machineLearning.clip.modelName !== newConfig.machineLearning.clip.modelName) {
      if (frames.length > 0) {
        await this.jobRepository.queue({ name: JobName.FileDelete, data: { files: frames.map(({ path }) => path) } });
      }
      return JobStatus.Skipped;
    }

    const stalePaths = await this.duplicateRepository.replaceVideoDuplicateFrames(asset.id, frames);
    if (stalePaths.length > 0) {
      await this.jobRepository.queue({ name: JobName.FileDelete, data: { files: stalePaths } });
    }

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.AssetDetectDuplicates, queue: QueueName.DuplicateDetection })
  async handleSearchDuplicates({ id }: JobOf<JobName.AssetDetectDuplicates>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isDuplicateDetectionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    const asset = await this.assetJobRepository.getForSearchDuplicatesJob(id);
    if (!asset) {
      this.logger.error(`Asset ${id} not found`);
      return JobStatus.Failed;
    }

    if (asset.stackId) {
      this.logger.debug(`Asset ${id} is part of a stack, skipping`);
      return JobStatus.Skipped;
    }

    if (asset.visibility === AssetVisibility.Hidden) {
      this.logger.debug(`Asset ${id} is not visible, skipping`);
      return JobStatus.Skipped;
    }

    if (asset.visibility === AssetVisibility.Locked) {
      this.logger.debug(`Asset ${id} is locked, skipping`);
      return JobStatus.Skipped;
    }

    if (!asset.embedding) {
      this.logger.debug(`Asset ${id} is missing embedding`);
      return JobStatus.Failed;
    }

    let duplicateAssets = await this.duplicateRepository.search({
      assetId: asset.id,
      embedding: asset.embedding,
      maxDistance: machineLearning.duplicateDetection.maxDistance,
      type: asset.type,
      userIds: [asset.ownerId],
    });

    if (asset.type === AssetType.Video && duplicateAssets.length > 0) {
      duplicateAssets = await this.filterConfirmedVideoDuplicates(
        asset,
        duplicateAssets,
        machineLearning.duplicateDetection,
      );
    }

    let assetIds = [asset.id];
    if (duplicateAssets.length > 0) {
      this.logger.debug(
        `Found ${duplicateAssets.length} duplicate${duplicateAssets.length === 1 ? '' : 's'} for asset ${asset.id}`,
      );
      assetIds = await this.updateDuplicates(asset, duplicateAssets);
    } else if (asset.duplicateId) {
      this.logger.debug(`No duplicates found for asset ${asset.id}, removing duplicateId`);
      await this.assetRepository.update({ id: asset.id, duplicateId: null });
    }

    const duplicatesDetectedAt = new Date();
    await this.assetRepository.upsertJobStatus(...assetIds.map((assetId) => ({ assetId, duplicatesDetectedAt })));

    return JobStatus.Success;
  }

  private getVideoDuplicateFrameTimestamps(frameCount: number, format: { duration: number }): number[] {
    const duration = format.duration / 1000;
    if (!Number.isFinite(duration) || duration <= VIDEO_DUPLICATE_MIN_DURATION_SECONDS) {
      return [];
    }

    const endPadding = Math.max(
      VIDEO_DUPLICATE_FRAME_END_PADDING_SECONDS,
      duration * VIDEO_DUPLICATE_FRAME_END_PADDING_FRACTION,
    );
    const latest = duration - endPadding;
    if (latest <= VIDEO_DUPLICATE_FRAME_START_PADDING_SECONDS) {
      return [];
    }

    return [
      ...new Set(
        Array.from({ length: frameCount }, (_, index) => {
          const timestamp = (duration * (index + 1)) / (frameCount + 1);
          return Number(Math.min(Math.max(timestamp, VIDEO_DUPLICATE_FRAME_START_PADDING_SECONDS), latest).toFixed(3));
        }),
      ),
    ].filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0);
  }

  private async filterConfirmedVideoDuplicates(
    asset: { id: string },
    duplicateAssets: AssetDuplicateResult[],
    duplicateDetection: SystemConfig['machineLearning']['duplicateDetection'],
  ): Promise<AssetDuplicateResult[]> {
    const enhancedVideo = getEnhancedVideoDuplicateConfig({ duplicateDetection } as SystemConfig['machineLearning']);
    if (!enhancedVideo.enabled) {
      return duplicateAssets;
    }

    const assetIds = [asset.id, ...duplicateAssets.map(({ assetId }) => assetId)];
    const frames = await this.duplicateRepository.getVideoDuplicateFrames(assetIds);
    const frameCounts = new Map<string, number>();
    for (const frame of frames) {
      frameCounts.set(frame.assetId, (frameCounts.get(frame.assetId) ?? 0) + 1);
    }

    const missingFrameAssetIds = assetIds.filter(
      (assetId) => (frameCounts.get(assetId) ?? 0) < enhancedVideo.minMatchingFrames,
    );
    if (missingFrameAssetIds.length > 0) {
      await this.jobRepository.queueAll(
        [...new Set(missingFrameAssetIds)].map((id) => ({
          name: JobName.AssetGenerateVideoDuplicateFrames,
          data: { id },
        })),
      );
      return [];
    }

    const matchingAssetIds = new Set(
      await this.duplicateRepository.getVideoDuplicateFrameMatches({
        assetId: asset.id,
        candidateAssetIds: duplicateAssets.map(({ assetId }) => assetId),
        maxDistance: enhancedVideo.maxDistance,
        minMatchingFrames: enhancedVideo.minMatchingFrames,
      }),
    );

    return duplicateAssets.filter(({ assetId }) => matchingAssetIds.has(assetId));
  }

  private async updateDuplicates(
    asset: { id: string; duplicateId: string | null },
    duplicateAssets: AssetDuplicateResult[],
  ): Promise<string[]> {
    const duplicateIds = [
      ...new Set(
        duplicateAssets
          .filter((asset): asset is AssetDuplicateResult & { duplicateId: string } => !!asset.duplicateId)
          .map((duplicate) => duplicate.duplicateId),
      ),
    ];

    const targetDuplicateId = asset.duplicateId ?? duplicateIds.shift() ?? this.cryptoRepository.randomUUID();
    const assetIdsToUpdate = duplicateAssets
      .filter((asset) => asset.duplicateId !== targetDuplicateId)
      .map((duplicate) => duplicate.assetId);
    assetIdsToUpdate.push(asset.id);

    await this.duplicateRepository.merge({
      targetId: targetDuplicateId,
      assetIds: assetIdsToUpdate,
      sourceIds: duplicateIds,
    });
    return assetIdsToUpdate;
  }
}
