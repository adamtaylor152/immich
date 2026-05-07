import { BadRequestException, Injectable } from '@nestjs/common';
import { Insertable } from 'kysely';
import { createHash } from 'node:crypto';
import { JOBS_ASSET_PAGINATION_SIZE } from 'src/constants';
import { OnJob } from 'src/decorators';
import {
  AssetImageEnrichmentAction,
  AssetImageEnrichmentActionRequestDto,
  AssetImageEnrichmentResponseDto,
} from 'src/dtos/asset.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  AssetMetadataKey,
  AssetStatus,
  AssetType,
  AssetVisibility,
  JobName,
  JobStatus,
  Permission,
  QueueName,
} from 'src/enum';
import {
  ImageDescriptionResult,
  NsfwDetectionOptions,
  NsfwDetectionResult,
} from 'src/repositories/machine-learning.repository';
import { TagAssetTable } from 'src/schema/tables/tag-asset.table';
import { BaseService } from 'src/services/base.service';
import { JobItem, JobOf } from 'src/types';
import { updateLockedColumns } from 'src/utils/database';
import { isImageDescriptionEnabled, isNsfwDetectionEnabled } from 'src/utils/misc';
import { upsertTags } from 'src/utils/tag';

type EnrichmentReview = {
  action: 'accepted' | 'marked-safe' | 'marked-nsfw';
  isNsfw: boolean;
  reviewedAt: string;
  reviewedBy: string;
};

type EnrichmentTask<T> =
  | {
      status: 'success';
      modelName: string;
      updatedAt: string;
      result: T;
      appliedDescriptionHash?: string;
      appliedTagHash?: string;
      appliedTagValues?: string[];
    }
  | {
      status: 'failed';
      modelName: string;
      updatedAt: string;
      error: string;
    };

type NsfwEnrichmentTask = EnrichmentTask<NsfwDetectionResult> & {
  review?: EnrichmentReview;
};

type EnrichmentMetadata = {
  description?: EnrichmentTask<ImageDescriptionResult>;
  nsfwDetection?: NsfwEnrichmentTask;
};

const GENERATED_DESCRIPTION_PREFIX = 'AI description:';
const HIGH_CONFIDENCE = 'high';
const STRONG_NSFW_INDICATORS = new Set([
  'adult-nudity',
  'bare-buttocks',
  'bondage',
  'explicit',
  'exposed-genitals',
  'genital',
  'genitals',
  'naked',
  'nude',
  'nudity',
  'pornography',
  'restrained',
  'restraint',
  'sex-toy',
  'sexual-activity',
]);
const STRONG_NSFW_TEXT_PATTERN =
  /\b(naked|nude|nudity|genitals?|penis|vagina|buttocks?|sexual activity|sex toy|bondage|restrained|restraint)\b/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const getGeneratedDescriptionBlock = (description: string) => {
  const trimmed = description.trim();
  return trimmed ? `${GENERATED_DESCRIPTION_PREFIX} ${trimmed}` : undefined;
};

const withoutGeneratedDescriptionBlocks = (description: string, generatedDescriptions: string[]) => {
  const blocks = new Set(
    generatedDescriptions
      .map((generatedDescription) => getGeneratedDescriptionBlock(generatedDescription))
      .filter((block): block is string => !!block),
  );

  if (blocks.size === 0) {
    return description.trim();
  }

  return description
    .split(/\n{2,}/)
    .filter((part) => !blocks.has(part.trim()))
    .join('\n\n')
    .trim();
};

const normalizeTag = (tag: string) =>
  tag
    .toLowerCase()
    .trim()
    .replaceAll(/[^a-z0-9 _-]/g, '')
    .replaceAll(/\s+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '');

@Injectable()
export class ImageEnrichmentService extends BaseService {
  async getAssetEnrichment(auth: AuthDto, id: string): Promise<AssetImageEnrichmentResponseDto> {
    await this.requireAccess({ auth, permission: Permission.AssetUpdate, ids: [id] });

    const metadata = await this.getEnrichmentMetadata(id);
    return this.toResponse(id, metadata);
  }

  async updateAssetEnrichment(
    auth: AuthDto,
    id: string,
    dto: AssetImageEnrichmentActionRequestDto,
  ): Promise<AssetImageEnrichmentResponseDto> {
    await this.requireAccess({ auth, permission: Permission.AssetUpdate, ids: [id] });

    const asset = await this.assetRepository.getById(id, { exifInfo: true, tags: true });
    if (!asset) {
      throw new BadRequestException('Asset not found');
    }

    const metadata = await this.getEnrichmentMetadata(id);

    switch (dto.action) {
      case AssetImageEnrichmentAction.RerunImageDescription: {
        await this.jobRepository.queue({ name: JobName.ImageDescription, data: { id } });
        break;
      }

      case AssetImageEnrichmentAction.RerunNsfwDetection: {
        await this.jobRepository.queue({ name: JobName.NsfwDetection, data: { id } });
        break;
      }

      case AssetImageEnrichmentAction.AcceptNsfwResult: {
        const nsfw = this.ensureManualNsfwMetadata(metadata, this.getEffectiveNsfw(metadata) ?? false);
        nsfw.review = this.getReview(auth, 'accepted', this.getEffectiveNsfw(metadata) ?? false);
        await this.saveEnrichmentMetadata(id, metadata);

        const changed = nsfw.review.isNsfw
          ? await this.applyNsfwTags(id, asset.ownerId, this.getStoredNsfw(metadata)!, metadata)
          : await this.clearAppliedNsfwTags(id, asset.ownerId, metadata);
        await this.finalizeRepair(id, changed, metadata);
        break;
      }

      case AssetImageEnrichmentAction.MarkNsfw: {
        const nsfw = this.ensureManualNsfwMetadata(metadata, true);
        nsfw.review = this.getReview(auth, 'marked-nsfw', true);
        await this.saveEnrichmentMetadata(id, metadata);
        const changed = await this.applyNsfwTags(id, asset.ownerId, this.getStoredNsfw(metadata)!, metadata);
        await this.finalizeRepair(id, changed, metadata);
        break;
      }

      case AssetImageEnrichmentAction.MarkSafe: {
        const nsfw = this.ensureManualNsfwMetadata(metadata, false);
        nsfw.review = this.getReview(auth, 'marked-safe', false);
        await this.saveEnrichmentMetadata(id, metadata);
        const changed = await this.clearAppliedNsfwTags(id, asset.ownerId, metadata);
        await this.finalizeRepair(id, changed, metadata);
        break;
      }

      case AssetImageEnrichmentAction.ClearGeneratedDescription: {
        const changed = await this.clearGeneratedDescription(id, asset.exifInfo?.description ?? '', metadata);
        await this.finalizeRepair(id, changed, metadata);
        break;
      }

      case AssetImageEnrichmentAction.ClearGeneratedTags: {
        const changed = await this.clearGeneratedTags(id, asset.ownerId, this.getStoredGeneratedTags(metadata));
        if (metadata.description?.status === 'success') {
          delete metadata.description.appliedTagHash;
          delete metadata.description.appliedTagValues;
          changed.metadata = true;
        }
        if (metadata.nsfwDetection?.status === 'success') {
          delete metadata.nsfwDetection.appliedTagHash;
          delete metadata.nsfwDetection.appliedTagValues;
          changed.metadata = true;
        }
        await this.finalizeRepair(id, changed, metadata);
        break;
      }
    }

    return this.toResponse(id, await this.getEnrichmentMetadata(id));
  }

  @OnJob({ name: JobName.ImageDescriptionQueueAll, queue: QueueName.ImageDescription })
  async handleQueueImageDescription({ force }: JobOf<JobName.ImageDescriptionQueueAll>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    if (!isImageDescriptionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    let jobs: JobItem[] = [];
    const assets = this.assetJobRepository.streamForImageDescriptionJob(force);

    for await (const asset of assets) {
      jobs.push({ name: JobName.ImageDescription, data: { id: asset.id } });

      if (jobs.length >= JOBS_ASSET_PAGINATION_SIZE) {
        await this.jobRepository.queueAll(jobs);
        jobs = [];
      }
    }

    await this.jobRepository.queueAll(jobs);
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.NsfwDetectionQueueAll, queue: QueueName.NsfwDetection })
  async handleQueueNsfwDetection({ force }: JobOf<JobName.NsfwDetectionQueueAll>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    if (!isNsfwDetectionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    let jobs: JobItem[] = [];
    const assets = this.assetJobRepository.streamForNsfwDetectionJob(force);

    for await (const asset of assets) {
      jobs.push({ name: JobName.NsfwDetection, data: { id: asset.id } });

      if (jobs.length >= JOBS_ASSET_PAGINATION_SIZE) {
        await this.jobRepository.queueAll(jobs);
        jobs = [];
      }
    }

    await this.jobRepository.queueAll(jobs);
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.NsfwDetection, queue: QueueName.NsfwDetection })
  async handleNsfwDetection({ id }: JobOf<JobName.NsfwDetection>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isNsfwDetectionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    const asset = await this.assetJobRepository.getForImageEnrichment(id);
    if (!asset || !this.isEligibleImage(asset)) {
      return JobStatus.Skipped;
    }

    if (!asset.previewFile) {
      return JobStatus.Failed;
    }

    const metadata = await this.getEnrichmentMetadata(id);
    try {
      const result = await this.detectAndStoreNsfw(id, asset.previewFile, machineLearning.nsfwDetection, metadata);
      const changed = await this.applyNsfwTags(id, asset.ownerId, result, metadata);

      if (changed.metadata) {
        await this.saveEnrichmentMetadata(id, metadata);
      }

      if (changed.visible) {
        await this.jobRepository.queue({ name: JobName.SidecarWrite, data: { id } });
      }

      return JobStatus.Success;
    } catch (error) {
      metadata.nsfwDetection = {
        status: 'failed',
        modelName: machineLearning.nsfwDetection.modelName,
        updatedAt: new Date().toISOString(),
        error: getErrorMessage(error),
      };
      await this.saveEnrichmentMetadata(id, metadata);
      return JobStatus.Failed;
    }
  }

  @OnJob({ name: JobName.ImageDescription, queue: QueueName.ImageDescription })
  async handleImageDescription({ id }: JobOf<JobName.ImageDescription>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isImageDescriptionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    const asset = await this.assetJobRepository.getForImageEnrichment(id);
    if (!asset || !this.isEligibleImage(asset)) {
      return JobStatus.Skipped;
    }

    if (!asset.previewFile) {
      return JobStatus.Failed;
    }

    const metadata = await this.getEnrichmentMetadata(id);

    try {
      const nsfw = isNsfwDetectionEnabled(machineLearning)
        ? await this.ensureNsfw(id, asset.previewFile, metadata)
        : this.getStoredNsfw(metadata);
      const previousDescription =
        metadata.description?.status === 'success' && metadata.description.appliedDescriptionHash
          ? metadata.description.result.description
          : undefined;
      const previousTagValues =
        metadata.description?.status === 'success' ? (metadata.description.appliedTagValues ?? []) : [];
      const result = await this.machineLearningRepository.describeImage(
        asset.previewFile,
        machineLearning.imageDescription,
        nsfw,
      );

      metadata.description = {
        status: 'success',
        modelName: machineLearning.imageDescription.modelName,
        updatedAt: new Date().toISOString(),
        result,
      };
      await this.saveEnrichmentMetadata(id, metadata);

      const changed = await this.applyVisibleMetadata({
        id,
        ownerId: asset.ownerId,
        existingDescription: asset.description ?? '',
        result,
        nsfw,
        metadata,
        previousDescription,
        previousTagValues,
      });

      if (changed.metadata) {
        await this.saveEnrichmentMetadata(id, metadata);
      }

      if (changed.visible) {
        await this.jobRepository.queue({ name: JobName.SidecarWrite, data: { id } });
      }

      return JobStatus.Success;
    } catch (error) {
      metadata.description = {
        status: 'failed',
        modelName: machineLearning.imageDescription.modelName,
        updatedAt: new Date().toISOString(),
        error: getErrorMessage(error),
      };
      await this.saveEnrichmentMetadata(id, metadata);
      return JobStatus.Failed;
    }
  }

  private toResponse(id: string, metadata: EnrichmentMetadata): AssetImageEnrichmentResponseDto {
    const description = metadata.description;
    const nsfwDetection = metadata.nsfwDetection;

    return {
      assetId: id,
      description:
        description?.status === 'success'
          ? {
              status: 'success',
              modelName: description.modelName,
              updatedAt: description.updatedAt,
              description: description.result.description,
              tags: description.result.tags,
              objects: description.result.objects,
              people: description.result.people,
              environment: description.result.environment,
              visibleText: description.result.visible_text,
              context: description.result.context,
              appliedDescription: !!description.appliedDescriptionHash,
              appliedTags: !!description.appliedTagHash,
            }
          : {
              status: description?.status ?? 'missing',
              modelName: description?.modelName,
              updatedAt: description?.updatedAt,
              error: description?.status === 'failed' ? description.error : undefined,
              appliedDescription: false,
              appliedTags: false,
            },
      nsfwDetection:
        nsfwDetection?.status === 'success'
          ? {
              status: 'success',
              modelName: nsfwDetection.modelName,
              updatedAt: nsfwDetection.updatedAt,
              isNsfw: nsfwDetection.result.isNsfw,
              effectiveIsNsfw: this.getEffectiveNsfw(metadata) ?? false,
              score: nsfwDetection.result.score,
              labels: nsfwDetection.result.labels,
              review: nsfwDetection.review,
              appliedTags: !!nsfwDetection.appliedTagHash,
            }
          : {
              status: nsfwDetection?.status ?? 'missing',
              modelName: nsfwDetection?.modelName,
              updatedAt: nsfwDetection?.updatedAt,
              error: nsfwDetection?.status === 'failed' ? nsfwDetection.error : undefined,
              effectiveIsNsfw: this.getEffectiveNsfw(metadata) ?? false,
              review: nsfwDetection?.review,
              appliedTags: false,
            },
    };
  }

  private getReview(auth: AuthDto, action: EnrichmentReview['action'], isNsfw: boolean): EnrichmentReview {
    return {
      action,
      isNsfw,
      reviewedAt: new Date().toISOString(),
      reviewedBy: auth.user.id,
    };
  }

  private async finalizeRepair(
    id: string,
    changed: { visible: boolean; metadata: boolean },
    metadata: EnrichmentMetadata,
  ) {
    if (changed.metadata) {
      await this.saveEnrichmentMetadata(id, metadata);
    }

    if (changed.visible) {
      await this.jobRepository.queue({ name: JobName.SidecarWrite, data: { id } });
    }
  }

  private ensureManualNsfwMetadata(metadata: EnrichmentMetadata, isNsfw: boolean): NsfwEnrichmentTask {
    if (metadata.nsfwDetection?.status === 'success') {
      return metadata.nsfwDetection;
    }

    metadata.nsfwDetection = {
      status: 'success',
      modelName: 'manual-review',
      updatedAt: new Date().toISOString(),
      result: {
        isNsfw,
        score: isNsfw ? 1 : 0,
        labels: {},
      },
    };
    return metadata.nsfwDetection;
  }

  private getEffectiveNsfw(metadata: EnrichmentMetadata) {
    const nsfw = metadata.nsfwDetection;

    if (nsfw?.review) {
      return nsfw.review.isNsfw;
    }

    if (nsfw?.status === 'success' && nsfw.result.isNsfw) {
      return true;
    }

    const description = metadata.description?.status === 'success' ? metadata.description.result : undefined;
    if (this.isDescriptionNsfwLikely(description)) {
      return true;
    }

    return nsfw?.status === 'success' ? false : undefined;
  }

  private async clearGeneratedDescription(id: string, existingDescription: string, metadata: EnrichmentMetadata) {
    if (metadata.description?.status !== 'success' || !metadata.description.appliedDescriptionHash) {
      return { visible: false, metadata: false };
    }

    const description = withoutGeneratedDescriptionBlocks(existingDescription, [
      metadata.description.result.description,
    ]);

    const visible = description !== existingDescription.trim();
    if (visible) {
      await this.assetRepository.upsertExif({
        exif: updateLockedColumns({ assetId: id, description }),
        lockedPropertiesBehavior: 'append',
      });
    }

    delete metadata.description.appliedDescriptionHash;
    return { visible, metadata: true };
  }

  private getStoredGeneratedTags(metadata: EnrichmentMetadata) {
    const tags = new Set<string>();

    if (metadata.description?.status === 'success' && metadata.description.appliedTagValues) {
      for (const tag of metadata.description.appliedTagValues) {
        tags.add(tag);
      }
    }

    if (metadata.nsfwDetection?.status === 'success' && metadata.nsfwDetection.appliedTagValues) {
      for (const tag of metadata.nsfwDetection.appliedTagValues) {
        tags.add(tag);
      }
    }

    return [...tags];
  }

  private async clearGeneratedTags(id: string, ownerId: string, tags: string[]) {
    let visible = false;
    for (const tag of tags) {
      const existing = await this.tagRepository.getByValue(ownerId, tag);
      if (!existing) {
        continue;
      }

      await this.tagRepository.removeAssetIds(existing.id, [id]);
      visible = true;
    }

    if (visible) {
      await this.updateExifTags(id);
      await this.eventRepository.emit('AssetUntag', { assetId: id });
    }

    return { visible, metadata: false };
  }

  private async ensureNsfw(id: string, previewFile: string, metadata: EnrichmentMetadata) {
    const stored = this.getStoredNsfw(metadata);
    if (stored) {
      return stored;
    }

    const { machineLearning } = await this.getConfig({ withCache: true });
    return this.detectAndStoreNsfw(id, previewFile, machineLearning.nsfwDetection, metadata);
  }

  private async detectAndStoreNsfw(
    id: string,
    previewFile: string,
    config: NsfwDetectionOptions,
    metadata: EnrichmentMetadata,
  ) {
    const result = await this.machineLearningRepository.detectNsfw(previewFile, config);
    const appliedTagHash =
      metadata.nsfwDetection?.status === 'success' ? metadata.nsfwDetection.appliedTagHash : undefined;
    const appliedTagValues =
      metadata.nsfwDetection?.status === 'success' ? metadata.nsfwDetection.appliedTagValues : undefined;
    metadata.nsfwDetection = {
      status: 'success',
      modelName: config.modelName,
      updatedAt: new Date().toISOString(),
      result,
      appliedTagHash,
      appliedTagValues,
    };
    await this.saveEnrichmentMetadata(id, metadata);
    return result;
  }

  private getStoredNsfw(metadata: EnrichmentMetadata) {
    if (metadata.nsfwDetection?.status !== 'success') {
      return;
    }

    const isNsfw = this.getEffectiveNsfw(metadata);
    return isNsfw === undefined ? metadata.nsfwDetection.result : { ...metadata.nsfwDetection.result, isNsfw };
  }

  private isEligibleImage(
    asset:
      | {
          type: AssetType;
          status: AssetStatus;
          deletedAt: Date | null;
          visibility: AssetVisibility;
        }
      | undefined,
  ) {
    return (
      asset?.type === AssetType.Image &&
      asset.status === AssetStatus.Active &&
      asset.deletedAt === null &&
      (asset.visibility === AssetVisibility.Timeline || asset.visibility === AssetVisibility.Archive)
    );
  }

  private async getEnrichmentMetadata(id: string): Promise<EnrichmentMetadata> {
    const row = await this.assetRepository.getMetadataByKey(id, AssetMetadataKey.MlEnrichment);
    return isRecord(row?.value) ? (row.value as EnrichmentMetadata) : {};
  }

  private async saveEnrichmentMetadata(id: string, value: EnrichmentMetadata) {
    await this.assetRepository.upsertMetadata(id, [
      { key: AssetMetadataKey.MlEnrichment, value: value as Record<string, unknown> },
    ]);
  }

  private async applyVisibleMetadata({
    id,
    ownerId,
    existingDescription,
    result,
    nsfw,
    metadata,
    previousDescription,
    previousTagValues,
  }: {
    id: string;
    ownerId: string;
    existingDescription: string;
    result: ImageDescriptionResult;
    nsfw?: NsfwDetectionResult;
    metadata: EnrichmentMetadata;
    previousDescription?: string;
    previousTagValues: string[];
  }) {
    let visible = false;
    let metadataChanged = false;

    const descriptionHash = hash(result.description);
    if (
      result.description &&
      metadata.description?.status === 'success' &&
      metadata.description.appliedDescriptionHash !== descriptionHash
    ) {
      const block = getGeneratedDescriptionBlock(result.description);
      const baseDescription = withoutGeneratedDescriptionBlocks(
        existingDescription,
        previousDescription ? [previousDescription] : [],
      );

      if (block && !baseDescription.includes(block)) {
        const description = baseDescription ? `${baseDescription}\n\n${block}` : block;
        await this.assetRepository.upsertExif({
          exif: updateLockedColumns({ assetId: id, description }),
          lockedPropertiesBehavior: 'append',
        });
        visible = true;
      }
      metadata.description.appliedDescriptionHash = descriptionHash;
      metadataChanged = true;
    }

    const tags = this.getTags(result, nsfw, metadata);
    const tagHash = hash(tags);
    const descriptionMetadata = metadata.description?.status === 'success' ? metadata.description : undefined;
    const hasStoredTagApplication =
      !!descriptionMetadata?.appliedTagHash || !!descriptionMetadata?.appliedTagValues?.length;
    if (
      descriptionMetadata &&
      (tags.length > 0 || hasStoredTagApplication) &&
      descriptionMetadata.appliedTagHash !== tagHash
    ) {
      const cleared = await this.clearGeneratedTags(id, ownerId, previousTagValues);
      visible ||= cleared.visible;

      if (tags.length > 0) {
        const tagsChanged = await this.upsertAssetTags(id, ownerId, tags);
        visible ||= tagsChanged.visible;

        descriptionMetadata.appliedTagHash = tagHash;
        descriptionMetadata.appliedTagValues = tagsChanged.appliedTagValues;
      } else {
        delete descriptionMetadata.appliedTagHash;
        delete descriptionMetadata.appliedTagValues;
      }
      metadataChanged = true;
    }

    return { visible, metadata: metadataChanged };
  }

  private async applyNsfwTags(id: string, ownerId: string, nsfw: NsfwDetectionResult, metadata: EnrichmentMetadata) {
    if (metadata.nsfwDetection?.status !== 'success') {
      return { visible: false, metadata: false };
    }

    if (!nsfw.isNsfw) {
      return this.clearAppliedNsfwTags(id, ownerId, metadata);
    }

    const tags = this.getNsfwTags(nsfw);
    const tagHash = hash(tags);
    if (metadata.nsfwDetection.appliedTagHash === tagHash) {
      return { visible: false, metadata: false };
    }

    const cleared = await this.clearGeneratedTags(id, ownerId, metadata.nsfwDetection.appliedTagValues ?? []);
    const tagsChanged = await this.upsertAssetTags(id, ownerId, tags);
    metadata.nsfwDetection.appliedTagHash = tagHash;
    metadata.nsfwDetection.appliedTagValues = tagsChanged.appliedTagValues;
    return { visible: cleared.visible || tagsChanged.visible, metadata: true };
  }

  private async clearAppliedNsfwTags(id: string, ownerId: string, metadata: EnrichmentMetadata) {
    const changed = await this.clearGeneratedTags(
      id,
      ownerId,
      metadata.nsfwDetection?.status === 'success' ? (metadata.nsfwDetection.appliedTagValues ?? []) : [],
    );

    if (metadata.nsfwDetection?.status === 'success') {
      delete metadata.nsfwDetection.appliedTagHash;
      delete metadata.nsfwDetection.appliedTagValues;
      changed.metadata = true;
    }

    return changed;
  }

  private getTags(result: ImageDescriptionResult, nsfw?: NsfwDetectionResult, metadata?: EnrichmentMetadata) {
    const tags = new Set<string>();
    const effectiveNsfw = metadata ? this.getEffectiveNsfw(metadata) : nsfw?.isNsfw;

    for (const tag of result.tags ?? []) {
      const normalized = normalizeTag(tag);
      if (normalized && (effectiveNsfw || !this.isNsfwTag(normalized))) {
        tags.add(normalized);
      }
    }

    if (effectiveNsfw) {
      const effectiveNsfwResult = nsfw?.isNsfw ? nsfw : this.getDescriptionNsfwResult(result);
      for (const tag of this.getNsfwTags(effectiveNsfwResult)) {
        tags.add(tag);
      }
    }

    if (result.medical?.is_medical_likely) {
      tags.add('medical');
      for (const indicator of result.medical.indicators) {
        const normalized = normalizeTag(indicator);
        if (normalized) {
          tags.add(normalized);
        }
      }
    }

    return [...tags].slice(0, 24);
  }

  private isNsfwTag(tag: string) {
    return tag === 'nsfw' || STRONG_NSFW_INDICATORS.has(tag);
  }

  private isDescriptionNsfwLikely(result?: ImageDescriptionResult) {
    const safety = result?.safety;
    if (!result || !safety?.is_nsfw_likely || safety.confidence.toLowerCase() !== HIGH_CONFIDENCE) {
      return false;
    }

    for (const indicator of safety.indicators) {
      if (STRONG_NSFW_INDICATORS.has(normalizeTag(indicator))) {
        return true;
      }
    }

    return STRONG_NSFW_TEXT_PATTERN.test([result.description, safety.reason].join(' '));
  }

  private getDescriptionNsfwResult(result: ImageDescriptionResult): NsfwDetectionResult {
    const labels: Record<string, number> = {};
    for (const indicator of result.safety?.indicators ?? []) {
      const normalized = normalizeTag(indicator);
      if (normalized) {
        labels[normalized] = 1;
      }
    }
    return {
      isNsfw: true,
      score: 1,
      labels,
    };
  }

  private getNsfwTags(nsfw: NsfwDetectionResult) {
    const tags = new Set(['nsfw']);
    for (const [label, score] of Object.entries(nsfw.labels)) {
      const normalized = normalizeTag(label);
      if (score >= 0.5 && normalized && normalized !== 'normal' && normalized !== 'safe') {
        tags.add(normalized);
      }
    }
    return [...tags];
  }

  private async upsertAssetTags(id: string, ownerId: string, tags: string[]) {
    const upsertedTags = await upsertTags(this.tagRepository, { userId: ownerId, tags });
    const items: Insertable<TagAssetTable>[] = upsertedTags.map((tag) => ({ tagId: tag.id, assetId: id }));
    const results = await this.tagRepository.upsertAssetIds(items);
    const insertedTagIds = new Set(results.map(({ tagId }) => tagId));
    const appliedTagValues = upsertedTags.filter(({ id }) => insertedTagIds.has(id)).map(({ value }) => value);

    if (results.length === 0) {
      return { visible: false, appliedTagValues };
    }

    await this.updateExifTags(id);
    await this.eventRepository.emit('AssetTag', { assetId: id });
    return { visible: true, appliedTagValues };
  }

  private async updateExifTags(assetId: string) {
    const { tags } = await this.assetRepository.getForUpdateTags(assetId);
    await this.assetRepository.upsertExif({
      exif: updateLockedColumns({ assetId, tags: tags.map(({ value }) => value) }),
      lockedPropertiesBehavior: 'append',
    });
  }
}
