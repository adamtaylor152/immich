import { Injectable } from '@nestjs/common';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SystemConfig } from 'src/config';
import { FACE_THUMBNAIL_SIZE, JOBS_ASSET_PAGINATION_SIZE } from 'src/constants';
import { ImagePathOptions, StorageCore, ThumbnailPathEntity } from 'src/cores/storage.core';
import { AssetFile } from 'src/database';
import { OnEvent, OnJob } from 'src/decorators';
import { AssetEditAction, AssetEditActionItem, CropParameters } from 'src/dtos/editing.dto';
import { SystemConfigFFmpegDto } from 'src/dtos/system-config.dto';
import {
  AssetFileType,
  AssetType,
  AssetVisibility,
  AudioCodec,
  Colorspace,
  ImageFormat,
  ImmichWorker,
  JobName,
  JobStatus,
  PhysicalFileType,
  QueueName,
  RawExtractedFormat,
  StorageFolder,
  TranscodeHardwareAcceleration,
  TranscodePolicy,
  TranscodeTarget,
  VideoCodec,
  VideoContainer,
} from 'src/enum';
import { AssetJobRepository } from 'src/repositories/asset-job.repository';
import { BoundingBox } from 'src/repositories/machine-learning.repository';
import { BaseService } from 'src/services/base.service';
import {
  AudioStreamInfo,
  DecodeToBufferOptions,
  GenerateThumbnailOptions,
  ImageDimensions,
  JobItem,
  JobOf,
  TranscodeCommand,
  VideoFormat,
  VideoInterfaces,
  VideoStreamInfo,
} from 'src/types';
import { getAssetFile, getDimensions } from 'src/utils/asset.util';
import { checkFaceVisibility, checkOcrVisibility } from 'src/utils/editor';
import { BaseConfig, ThumbnailConfig } from 'src/utils/media';
import { isUnsupportedRawDecodeError } from 'src/utils/media-health';
import { mimeTypes } from 'src/utils/mime-types';
import { clamp, isFaceImportEnabled, isFacialRecognitionEnabled } from 'src/utils/misc';
import { renderRawWithLibRaw } from 'src/utils/raw-renderer';
import { getOutputDimensions } from 'src/utils/transform';

interface UpsertFileOptions {
  assetId: string;
  type: AssetFileType;
  path: string;
  physicalFileId?: string | null;
  isEdited: boolean;
  isProgressive: boolean;
  isTransparent: boolean;
}

type ExistingAssetFile = Omit<AssetFile, 'physicalFileId'> & {
  physicalFileId?: string | null;
  isProgressive: boolean;
  isTransparent: boolean;
};

type ThumbnailAsset = NonNullable<Awaited<ReturnType<AssetJobRepository['getForGenerateThumbnailJob']>>>;

type VideoThumbnailAsset = ThumbnailPathEntity & {
  originalPath: string;
  videoStream: VideoStreamInfo;
  format: VideoFormat;
};

type SpeedInterval = {
  startMs: number;
  endMs: number;
  rate: number;
};

type VideoEditTimeline = {
  startMs: number;
  endMs: number;
  intervals: SpeedInterval[];
};

enum VideoEditAccelerationMode {
  Software = 'Software',
  HardwareNative = 'HardwareNative',
  HybridHardwareEncode = 'HybridHardwareEncode',
  SoftwareFallback = 'SoftwareFallback',
}

type VideoEditCommandPlan = {
  command: TranscodeCommand;
  config: SystemConfigFFmpegDto;
  hasCpuVideoFilters: boolean;
  mode: VideoEditAccelerationMode;
  fallbackReason?: string;
};

const cpuVideoEditActions = new Set<AssetEditAction>([
  AssetEditAction.Crop,
  AssetEditAction.Rotate,
  AssetEditAction.Straighten,
  AssetEditAction.Mirror,
  AssetEditAction.Stabilize,
  AssetEditAction.AutoEnhance,
  AssetEditAction.Adjust,
  AssetEditAction.Filter,
  AssetEditAction.Effect,
  AssetEditAction.TextOverlay,
  AssetEditAction.Speed,
]);

const isEditAction =
  <T extends AssetEditAction>(action: T) =>
  (edit: AssetEditActionItem): edit is Extract<AssetEditActionItem, { action: T }> =>
    edit.action === action;

@Injectable()
export class MediaService extends BaseService {
  videoInterfaces: VideoInterfaces = { dri: [], mali: false };

  @OnEvent({ name: 'AppBootstrap', workers: [ImmichWorker.Microservices] })
  async onBootstrap() {
    this.videoInterfaces = await this.storageCore.getVideoInterfaces();
  }

  @OnJob({ name: JobName.AssetGenerateThumbnailsQueueAll, queue: QueueName.ThumbnailGeneration })
  async handleQueueGenerateThumbnails({ force }: JobOf<JobName.AssetGenerateThumbnailsQueueAll>): Promise<JobStatus> {
    const config = await this.getConfig({ withCache: true });
    let jobs: JobItem[] = [];

    const queueAll = async () => {
      await this.jobRepository.queueAll(jobs);
      jobs = [];
    };

    const isFullsizeEnabled = config.image.fullsize.enabled;
    for await (const asset of this.assetJobRepository.streamForThumbnailJob({
      force,
      fullsizeEnabled: isFullsizeEnabled,
    })) {
      if (force || !asset.isEdited) {
        jobs.push({ name: JobName.AssetGenerateThumbnails, data: { id: asset.id } });
      }

      if (asset.isEdited) {
        jobs.push({ name: JobName.AssetEditThumbnailGeneration, data: { id: asset.id } });
      }

      if (jobs.length >= JOBS_ASSET_PAGINATION_SIZE) {
        await queueAll();
      }
    }

    await queueAll();

    const people = this.personRepository.getAll(force ? undefined : { thumbnailPath: '' });

    for await (const person of people) {
      if (!person.faceAssetId) {
        const face = await this.personRepository.getRandomFace(person.id);
        if (!face) {
          continue;
        }

        await this.personRepository.update({ id: person.id, faceAssetId: face.id });
      }

      jobs.push({ name: JobName.PersonGenerateThumbnail, data: { id: person.id } });
      if (jobs.length >= JOBS_ASSET_PAGINATION_SIZE) {
        await queueAll();
      }
    }

    await queueAll();

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.FileMigrationQueueAll, queue: QueueName.Migration })
  async handleQueueMigration(): Promise<JobStatus> {
    const { active, waiting } = await this.jobRepository.getJobCounts(QueueName.Migration);
    if (active === 1 && waiting === 0) {
      await this.storageCore.removeEmptyDirs(StorageFolder.Thumbnails);
      await this.storageCore.removeEmptyDirs(StorageFolder.EncodedVideo);
    }

    let jobs: JobItem[] = [];
    const assets = this.assetJobRepository.streamForMigrationJob();
    for await (const asset of assets) {
      jobs.push({ name: JobName.AssetFileMigration, data: { id: asset.id } });
      if (jobs.length >= JOBS_ASSET_PAGINATION_SIZE) {
        await this.jobRepository.queueAll(jobs);
        jobs = [];
      }
    }

    await this.jobRepository.queueAll(jobs);
    jobs = [];

    for await (const person of this.personRepository.getAll()) {
      jobs.push({ name: JobName.PersonFileMigration, data: { id: person.id } });

      if (jobs.length === JOBS_ASSET_PAGINATION_SIZE) {
        await this.jobRepository.queueAll(jobs);
        jobs = [];
      }
    }

    await this.jobRepository.queueAll(jobs);

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.AssetFileMigration, queue: QueueName.Migration })
  async handleAssetMigration({ id }: JobOf<JobName.AssetFileMigration>): Promise<JobStatus> {
    const { image } = await this.getConfig({ withCache: true });
    const asset = await this.assetJobRepository.getForMigrationJob(id);
    if (!asset) {
      return JobStatus.Failed;
    }

    await this.storageCore.moveAssetImage(asset, AssetFileType.FullSize, image.fullsize.format);
    await this.storageCore.moveAssetImage(asset, AssetFileType.Preview, image.preview.format);
    await this.storageCore.moveAssetImage(asset, AssetFileType.Thumbnail, image.thumbnail.format);
    await this.storageCore.moveAssetVideo(asset);

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.AssetEditThumbnailGeneration, queue: QueueName.Editor })
  async handleAssetEditThumbnailGeneration({ id }: JobOf<JobName.AssetEditThumbnailGeneration>): Promise<JobStatus> {
    const asset = await this.assetJobRepository.getForGenerateThumbnailJob(id);
    const config = await this.getConfig({ withCache: true });

    if (!asset) {
      this.logger.warn(`Thumbnail generation failed for asset ${id}: not found in database or missing metadata`);
      return JobStatus.Failed;
    }

    const generated = await this.generateEditedThumbnails(asset, config);
    await this.syncFiles(
      asset.files.filter((file) => file.isEdited),
      generated?.files ?? [],
    );

    let thumbhash: Buffer | undefined = generated?.thumbhash;
    if (!thumbhash) {
      const extractedImage = await this.extractOriginalImage(asset, config.image);
      const { info, data, colorspace } = extractedImage;

      thumbhash = await this.mediaRepository.generateThumbhash(data, {
        colorspace,
        processInvalidImages: false,
        raw: info,
        edits: [],
      });
    }

    if (!asset.thumbhash || Buffer.compare(asset.thumbhash, thumbhash) !== 0) {
      await this.assetRepository.update({ id: asset.id, thumbhash });
    }

    const fullsizeDimensions = generated?.fullsizeDimensions ?? getDimensions(asset.exifInfo!);
    await this.assetRepository.update({ id: asset.id, ...fullsizeDimensions });

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.AssetGenerateThumbnails, queue: QueueName.ThumbnailGeneration })
  async handleGenerateThumbnails({ id }: JobOf<JobName.AssetGenerateThumbnails>): Promise<JobStatus> {
    const asset = await this.assetJobRepository.getForGenerateThumbnailJob(id);
    const config = await this.getConfig({ withCache: true });

    if (!asset) {
      this.logger.warn(`Thumbnail generation failed for asset ${id}: not found in database or missing metadata`);
      return JobStatus.Failed;
    }

    if (asset.visibility === AssetVisibility.Hidden) {
      this.logger.verbose(`Thumbnail generation skipped for asset ${id}: not visible`);
      return JobStatus.Skipped;
    }

    let generated: Awaited<ReturnType<MediaService['generateImageThumbnails']>>;
    if (asset.type === AssetType.Video || asset.originalFileName.toLowerCase().endsWith('.gif')) {
      this.logger.verbose(`Thumbnail generation for video ${id} ${asset.originalPath}`);
      let videoStream: VideoStreamInfo | null = asset.videoStream;
      let format: VideoFormat | null = asset.format;
      if (!videoStream || !format) {
        this.logger.warn(`Missing persisted video metadata for asset ${asset.id}; probing ${asset.originalPath}`);
        const exists = await this.storageRepository.checkFileExists(asset.originalPath);
        if (!exists) {
          throw new Error(
            `Cannot probe video metadata for asset ${asset.id}: original file missing at ${asset.originalPath}`,
          );
        }
        let videoInfo;
        try {
          videoInfo = await this.mediaRepository.probe(asset.originalPath);
        } catch (error) {
          throw new Error(`Failed to probe video metadata for asset ${asset.id}: ${(error as Error).message}`, {
            cause: error,
          });
        }
        videoStream = videoInfo?.videoStreams[0] ?? null;
        format = videoInfo?.format ?? null;
      }

      if (!videoStream || !format || videoStream.timeBase == null) {
        throw new Error(`Missing video metadata for asset ${asset.id}`);
      }
      generated = await this.generateVideoThumbnails(
        {
          id: asset.id,
          ownerId: asset.ownerId,
          originalPath: asset.originalPath,
          videoStream,
          format,
        },
        config,
      );
    } else if (asset.type === AssetType.Image) {
      this.logger.verbose(`Thumbnail generation for image ${id} ${asset.originalPath}`);
      try {
        generated = await this.generateImageThumbnails(asset, config);
      } catch (error) {
        if (this.shouldSkipThumbnailDecodeError(error, asset.originalFileName)) {
          this.logger.warn(`Skipping thumbnail generation for asset ${id}: ${error}`);
          return JobStatus.Skipped;
        }

        throw error;
      }
    } else {
      this.logger.warn(`Skipping thumbnail generation for asset ${id}: ${asset.type} is not an image or video`);
      return JobStatus.Skipped;
    }

    const editedGenerated = await this.generateEditedThumbnails(asset, config);
    if (editedGenerated) {
      generated.files.push(...editedGenerated.files);
    }

    await this.syncFiles(asset.files, generated.files);
    const thumbhash = editedGenerated?.thumbhash || generated.thumbhash;

    if (!asset.thumbhash || Buffer.compare(asset.thumbhash, thumbhash) !== 0) {
      await this.assetRepository.update({ id: asset.id, thumbhash });
    }

    return JobStatus.Success;
  }

  private async extractImage(originalPath: string, minSize: number) {
    let extracted = await this.mediaRepository.extract(originalPath);
    if (extracted && !(await this.shouldUseExtractedImage(extracted.buffer, minSize))) {
      extracted = null;
    }

    return extracted;
  }

  private async renderRawImage(originalPath: string, minSize: number) {
    const buffer = await renderRawWithLibRaw(originalPath);
    if (!(await this.shouldUseExtractedImage(buffer, minSize))) {
      return null;
    }

    return { buffer, format: RawExtractedFormat.Tiff };
  }

  private async decodeImage(thumbSource: string | Buffer, exifInfo: ThumbnailAsset['exifInfo'], targetSize?: number) {
    const { image } = await this.getConfig({ withCache: true });
    const colorspace = this.isSRGB(exifInfo) ? Colorspace.Srgb : image.colorspace;
    const decodeOptions: DecodeToBufferOptions = {
      colorspace,
      processInvalidImages: process.env.IMMICH_PROCESS_INVALID_IMAGES === 'true',
      size: targetSize,
      orientation: exifInfo.orientation ? Number(exifInfo.orientation) : undefined,
    };

    const { info, data } = await this.mediaRepository.decodeImage(thumbSource, decodeOptions);
    return { info, data, colorspace };
  }

  private shouldSkipThumbnailDecodeError(error: unknown, fileName: string) {
    const message = error instanceof Error ? error.message : String(error);
    return (
      isUnsupportedRawDecodeError(error) ||
      (mimeTypes.isRaw(fileName) &&
        (message.includes('dcraw_emu') ||
          message.includes('Command failed') ||
          message.includes('ENOENT') ||
          message.includes('unsupported RAW')))
    );
  }

  private async extractOriginalImage(asset: ThumbnailAsset, image: SystemConfig['image'], useEdits = false) {
    const isRaw = mimeTypes.isRaw(asset.originalFileName);
    const extractEmbedded = image.extractEmbedded && isRaw;
    const enhancedRawEnabled = image.enhancedRaw?.enabled !== false;
    let extracted = extractEmbedded ? await this.extractImage(asset.originalPath, image.preview.size) : null;
    let renderedRaw = false;
    let rawRenderError: unknown;

    if (!extracted && extractEmbedded && enhancedRawEnabled) {
      try {
        extracted = await this.renderRawImage(asset.originalPath, image.preview.size);
        renderedRaw = !!extracted;
      } catch (error) {
        rawRenderError = error;
        this.logger.debug(`Could not render RAW image with LibRaw for ${asset.id}: ${error}`);
      }
    }

    const generateFullsize =
      ((image.fullsize.enabled || asset.exifInfo.projectionType === 'EQUIRECTANGULAR') &&
        !mimeTypes.isWebSupportedImage(asset.originalPath)) ||
      useEdits;

    const decodeThumbSource = () => {
      const convertFullsize =
        generateFullsize && (!extracted || !mimeTypes.isWebSupportedImage(` .${extracted.format}`));
      const thumbSource = extracted ? extracted.buffer : asset.originalPath;
      return this.decodeImage(
        thumbSource,
        // only specify orientation to extracted images which don't have EXIF orientation data
        // or it can double rotate the image
        extracted ? asset.exifInfo : { ...asset.exifInfo, orientation: null },
        convertFullsize ? undefined : image.preview.size,
      ).then((decoded) => ({ ...decoded, convertFullsize }));
    };

    let decoded: Awaited<ReturnType<typeof decodeThumbSource>>;
    try {
      decoded = await decodeThumbSource();
    } catch (error) {
      if (isRaw && enhancedRawEnabled && !renderedRaw) {
        try {
          extracted = await this.renderRawImage(asset.originalPath, image.preview.size);
          renderedRaw = !!extracted;
          if (extracted) {
            decoded = await decodeThumbSource();
          } else {
            throw error;
          }
        } catch (fallbackError) {
          throw rawRenderError ?? fallbackError;
        }
      } else {
        throw rawRenderError ?? error;
      }
    }

    const { data, info, colorspace, convertFullsize } = decoded;

    let isTransparent = false;
    if (!extracted && mimeTypes.canBeTransparent(asset.originalPath)) {
      ({ isTransparent } = await this.mediaRepository.getImageMetadata(asset.originalPath));
    }

    return {
      extracted,
      data,
      info,
      colorspace,
      convertFullsize,
      generateFullsize,
      isTransparent,
    };
  }

  private async generateImageThumbnails(asset: ThumbnailAsset, { image }: SystemConfig, useEdits: boolean = false) {
    // Handle embedded preview extraction for RAW files
    const extractedImage = await this.extractOriginalImage(asset, image, useEdits);
    const { info, data, colorspace, generateFullsize, convertFullsize, extracted, isTransparent } = extractedImage;

    const previewFormat = image.preview.format;
    this.warnOnTransparencyLoss(isTransparent, previewFormat, asset.id);

    const thumbnailFormat = image.thumbnail.format;
    this.warnOnTransparencyLoss(isTransparent, thumbnailFormat, asset.id);

    const previewFile = this.getImageFile(asset, {
      fileType: AssetFileType.Preview,
      format: previewFormat,
      isEdited: useEdits,
      isProgressive: !!image.preview.progressive && previewFormat !== ImageFormat.Webp,
      isTransparent,
    });
    const thumbnailFile = this.getImageFile(asset, {
      fileType: AssetFileType.Thumbnail,
      format: thumbnailFormat,
      isEdited: useEdits,
      isProgressive: !!image.thumbnail.progressive && thumbnailFormat !== ImageFormat.Webp,
      isTransparent,
    });
    this.storageCore.ensureFolders(previewFile.path);

    // generate final images
    const baseOptions = { colorspace, processInvalidImages: false, raw: info, edits: useEdits ? asset.edits : [] };
    const thumbnailOptions = { ...image.thumbnail, ...baseOptions, format: thumbnailFormat };
    const previewOptions = { ...image.preview, ...baseOptions, format: previewFormat };
    const promises = [
      this.mediaRepository.generateThumbhash(data, baseOptions),
      this.mediaRepository.generateThumbnail(data, thumbnailOptions, thumbnailFile.path),
      this.mediaRepository.generateThumbnail(data, previewOptions, previewFile.path),
    ];

    let fullsizeFile: UpsertFileOptions | undefined;
    if (convertFullsize) {
      const fullsizeFormat = image.fullsize.format;
      this.warnOnTransparencyLoss(isTransparent, fullsizeFormat, asset.id);
      // convert a new fullsize image from the same source as the thumbnail
      fullsizeFile = this.getImageFile(asset, {
        fileType: AssetFileType.FullSize,
        format: fullsizeFormat,
        isEdited: useEdits,
        isProgressive: !!image.fullsize.progressive && fullsizeFormat !== ImageFormat.Webp,
        isTransparent,
      });
      const fullsizeOptions = {
        ...baseOptions,
        format: fullsizeFormat,
        quality: image.fullsize.quality,
        progressive: image.fullsize.progressive,
      };
      promises.push(this.mediaRepository.generateThumbnail(data, fullsizeOptions, fullsizeFile.path));
    } else if (generateFullsize && extracted && extracted.format === RawExtractedFormat.Jpeg) {
      fullsizeFile = this.getImageFile(asset, {
        fileType: AssetFileType.FullSize,
        format: extracted.format,
        isEdited: false,
        isProgressive: !!image.fullsize.progressive && image.fullsize.format !== ImageFormat.Webp,
        isTransparent,
      });
      this.storageCore.ensureFolders(fullsizeFile.path);

      // Write the buffer to disk with essential EXIF data
      await this.storageRepository.createOrOverwriteFile(fullsizeFile.path, extracted.buffer);
      await this.mediaRepository.writeExif(
        {
          orientation: asset.exifInfo.orientation,
          colorspace: asset.exifInfo.colorspace,
        },
        fullsizeFile.path,
      );
    }

    const outputs = await Promise.all(promises);

    if (asset.exifInfo.projectionType === 'EQUIRECTANGULAR') {
      const promises = [
        this.mediaRepository.copyTagGroup('XMP-GPano', asset.originalPath, previewFile.path),
        fullsizeFile
          ? this.mediaRepository.copyTagGroup('XMP-GPano', asset.originalPath, fullsizeFile.path)
          : Promise.resolve(),
      ];
      await Promise.all(promises);
    }

    const decodedDimensions = { width: info.width, height: info.height };
    const fullsizeDimensions = useEdits ? getOutputDimensions(asset.edits, decodedDimensions) : decodedDimensions;

    return {
      files: fullsizeFile ? [previewFile, thumbnailFile, fullsizeFile] : [previewFile, thumbnailFile],
      thumbhash: outputs[0] as Buffer,
      fullsizeDimensions,
    };
  }

  @OnJob({ name: JobName.PersonGenerateThumbnail, queue: QueueName.ThumbnailGeneration })
  async handleGeneratePersonThumbnail({ id }: JobOf<JobName.PersonGenerateThumbnail>): Promise<JobStatus> {
    const { image } = await this.getConfig({ withCache: true });
    const data = await this.personRepository.getDataForThumbnailGenerationJob(id);
    if (!data) {
      this.logger.error(`Could not generate person thumbnail for ${id}: missing data`);
      return JobStatus.Failed;
    }

    const { ownerId, x1, y1, x2, y2, oldWidth, oldHeight, exifOrientation, previewPath, originalPath } = data;
    let inputImage: string | Buffer;
    if (data.type === AssetType.Video) {
      if (!previewPath) {
        this.logger.error(`Could not generate person thumbnail for video ${id}: missing preview path`);
        return JobStatus.Failed;
      }
      inputImage = previewPath;
    } else if (image.extractEmbedded && mimeTypes.isRaw(originalPath)) {
      const extracted = await this.extractImage(originalPath, image.preview.size);
      inputImage = extracted ? extracted.buffer : originalPath;
    } else {
      inputImage = originalPath;
    }

    const { data: decodedImage, info } = await this.mediaRepository.decodeImage(inputImage, {
      colorspace: image.colorspace,
      processInvalidImages: process.env.IMMICH_PROCESS_INVALID_IMAGES === 'true',
      // if this is an extracted image, it may not have orientation metadata
      orientation: Buffer.isBuffer(inputImage) && exifOrientation ? Number(exifOrientation) : undefined,
    });

    const thumbnailPath = StorageCore.getPersonThumbnailPath({ id, ownerId });
    this.storageCore.ensureFolders(thumbnailPath);

    const thumbnailOptions: GenerateThumbnailOptions = {
      colorspace: image.colorspace,
      format: ImageFormat.Jpeg,
      raw: info,
      quality: image.thumbnail.quality,
      progressive: false,
      processInvalidImages: false,
      size: FACE_THUMBNAIL_SIZE,
      edits: [
        {
          action: AssetEditAction.Crop,
          parameters: this.getCrop(
            { old: { width: oldWidth, height: oldHeight }, new: { width: info.width, height: info.height } },
            { x1, y1, x2, y2 },
          ),
        },
      ],
    };

    await this.mediaRepository.generateThumbnail(decodedImage, thumbnailOptions, thumbnailPath);
    await this.personRepository.update({ id, thumbnailPath });

    return JobStatus.Success;
  }

  private getCrop(
    dims: { old: ImageDimensions; new: ImageDimensions },
    { x1, y1, x2, y2 }: BoundingBox,
  ): CropParameters {
    // face bounding boxes can spill outside the image dimensions
    const clampedX1 = clamp(x1, 0, dims.old.width);
    const clampedY1 = clamp(y1, 0, dims.old.height);
    const clampedX2 = clamp(x2, 0, dims.old.width);
    const clampedY2 = clamp(y2, 0, dims.old.height);

    const widthScale = dims.new.width / dims.old.width;
    const heightScale = dims.new.height / dims.old.height;

    const halfWidth = (widthScale * (clampedX2 - clampedX1)) / 2;
    const halfHeight = (heightScale * (clampedY2 - clampedY1)) / 2;

    const middleX = Math.round(widthScale * clampedX1 + halfWidth);
    const middleY = Math.round(heightScale * clampedY1 + halfHeight);

    // zoom out 10%
    const targetHalfSize = Math.floor(Math.max(halfWidth, halfHeight) * 1.1);

    // get the longest distance from the center of the image without overflowing
    const newHalfSize = Math.min(
      middleX - Math.max(0, middleX - targetHalfSize),
      middleY - Math.max(0, middleY - targetHalfSize),
      Math.min(dims.new.width - 1, middleX + targetHalfSize) - middleX,
      Math.min(dims.new.height - 1, middleY + targetHalfSize) - middleY,
    );

    return {
      x: middleX - newHalfSize,
      y: middleY - newHalfSize,
      width: newHalfSize * 2,
      height: newHalfSize * 2,
    };
  }

  private getVideoThumbnailDurationSeconds(videoStream: VideoStreamInfo, format: VideoFormat) {
    const durationFromFormat = format.duration;
    const durationFromFrames =
      videoStream.frameCount > 0 && videoStream.frameRate && videoStream.frameRate > 0
        ? videoStream.frameCount / videoStream.frameRate
        : null;

    if (!durationFromFrames || !Number.isFinite(durationFromFrames) || durationFromFrames <= 0) {
      return durationFromFormat;
    }

    if (!Number.isFinite(durationFromFormat) || durationFromFormat <= 0) {
      return durationFromFrames;
    }

    const durationRatio =
      Math.max(durationFromFormat, durationFromFrames) / Math.min(durationFromFormat, durationFromFrames);
    return durationRatio >= 100 ? durationFromFrames : durationFromFormat;
  }

  private getVideoThumbnailCandidateTimestamps(videoStream: VideoStreamInfo, format: VideoFormat) {
    const duration = this.getVideoThumbnailDurationSeconds(videoStream, format);
    if (!Number.isFinite(duration) || duration <= 1) {
      return [];
    }

    // Keep candidates clear of the final stretch of the clip. The frame-selection
    // chain (fps + thumbnail, decoding only keyframes via -skip_frame nointra)
    // needs a run of trailing frames to emit one; a timestamp inside that tail
    // produces zero frames and ffmpeg aborts the whole transcode with "Nothing
    // was written into output file". Reserve a proportional tail, but never less
    // than the historical 0.5s (so very short clips keep their existing spread).
    const tail = Math.min(Math.max(duration * 0.1, 0.5), 5);
    const latest = Math.max(duration - tail, 0);

    // Sample a few spread-out points. For long clips, also anchor an early fixed
    // sample (~30s, past typical intros) -- but only when it sits safely before
    // the tail. The previous implementation instead mapped every long-clip
    // candidate through Math.max(30, timestamp), which collapsed them all onto
    // ~30s for clips of roughly 30-43s; for a clip barely over 30s that single
    // value then clamped into the dead zone above and failed the transcode (e.g.
    // rotating a ~30s video, which regenerates its thumbnails from the edit).
    const fractions = duration >= 30 ? [0.35, 0.55, 0.75] : [0.2, 0.5, 0.8];
    const candidates = fractions.map((fraction) => duration * fraction);
    if (duration >= 30 && 30 < latest) {
      candidates.unshift(30);
    }

    return [
      ...new Set(
        candidates
          .map((timestamp) => Number(Math.min(timestamp, latest).toFixed(3)))
          .filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0),
      ),
    ];
  }

  private getVideoThumbnailCandidatePath(output: string, index: number) {
    const { dir, ext, name } = path.parse(output);
    return path.join(dir, `${name}_candidate_${index}${ext}`);
  }

  private async pickVideoThumbnailStartTime(
    input: string,
    output: string,
    videoStream: VideoStreamInfo,
    format: VideoFormat,
    getOptions: (timestamp: number) => TranscodeCommand,
  ) {
    const timestamps = this.getVideoThumbnailCandidateTimestamps(videoStream, format);
    if (timestamps.length === 0) {
      return 0;
    }

    let selected = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    const candidates: string[] = [];

    try {
      for (const [index, timestamp] of timestamps.entries()) {
        const candidate = this.getVideoThumbnailCandidatePath(output, index);
        candidates.push(candidate);

        try {
          await this.mediaRepository.transcode(input, candidate, getOptions(timestamp));
          const score = await this.mediaRepository.scoreThumbnailCandidate(candidate);
          if (score > bestScore) {
            bestScore = score;
            selected = timestamp;
          }
        } catch (error: any) {
          this.logger.warn(`Could not score thumbnail candidate at ${timestamp}s: ${error?.message ?? error}`);
        }
      }
    } finally {
      await Promise.all(candidates.map((candidate) => fs.rm(candidate, { force: true })));
    }

    return Number.isFinite(bestScore) ? selected : 0;
  }

  private async generateVideoThumbnails(
    asset: VideoThumbnailAsset,
    { ffmpeg, image }: SystemConfig,
    options: { sourcePath?: string; isEdited?: boolean; fullsizeDimensions?: ImageDimensions } = {},
  ) {
    const sourcePath = options.sourcePath ?? asset.originalPath;
    const isEdited = options.isEdited ?? false;
    const previewFile = this.getImageFile(asset, {
      fileType: AssetFileType.Preview,
      format: image.preview.format,
      isEdited,
      isProgressive: false,
      isTransparent: false,
    });
    const thumbnailFile = this.getImageFile(asset, {
      fileType: AssetFileType.Thumbnail,
      format: image.thumbnail.format,
      isEdited,
      isProgressive: false,
      isTransparent: false,
    });
    this.storageCore.ensureFolders(previewFile.path);

    const { videoStream, format } = asset;
    if (!videoStream || !format) {
      throw new Error(`Missing video metadata for asset ${asset.id}`);
    }

    const previewConfig = { ...ffmpeg, targetResolution: image.preview.size.toString() };
    const thumbConfig = { ...ffmpeg, targetResolution: image.thumbnail.size.toString() };
    const startTime = await this.pickVideoThumbnailStartTime(
      sourcePath,
      previewFile.path,
      videoStream,
      format,
      (timestamp) =>
        ThumbnailConfig.create(previewConfig, timestamp).getCommand(
          TranscodeTarget.Video,
          videoStream,
          undefined,
          format,
        ),
    );
    const previewOptions = ThumbnailConfig.create(previewConfig, startTime).getCommand(
      TranscodeTarget.Video,
      videoStream,
      undefined,
      format,
    );
    const thumbnailOptions = ThumbnailConfig.create(thumbConfig, startTime).getCommand(
      TranscodeTarget.Video,
      videoStream,
      undefined,
      format,
    );

    await this.mediaRepository.transcode(sourcePath, previewFile.path, previewOptions);
    await this.mediaRepository.transcode(sourcePath, thumbnailFile.path, thumbnailOptions);

    const thumbhash = await this.mediaRepository.generateThumbhash(previewFile.path, {
      colorspace: image.colorspace,
      processInvalidImages: process.env.IMMICH_PROCESS_INVALID_IMAGES === 'true',
    });

    return {
      files: [previewFile, thumbnailFile],
      thumbhash,
      fullsizeDimensions: options.fullsizeDimensions ?? { width: videoStream.width, height: videoStream.height },
    };
  }

  @OnJob({ name: JobName.AssetEncodeVideoQueueAll, queue: QueueName.VideoConversion })
  async handleQueueVideoConversion(job: JobOf<JobName.AssetEncodeVideoQueueAll>): Promise<JobStatus> {
    const { force } = job;

    let queue: { name: JobName.AssetEncodeVideo; data: { id: string } }[] = [];
    for await (const asset of this.assetJobRepository.streamForVideoConversion(force)) {
      queue.push({ name: JobName.AssetEncodeVideo, data: { id: asset.id } });

      if (queue.length >= JOBS_ASSET_PAGINATION_SIZE) {
        await this.jobRepository.queueAll(queue);
        queue = [];
      }
    }

    await this.jobRepository.queueAll(queue);

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.AssetEncodeVideo, queue: QueueName.VideoConversion })
  async handleVideoConversion({ id }: JobOf<JobName.AssetEncodeVideo>): Promise<JobStatus> {
    const asset = await this.assetJobRepository.getForVideoConversion(id);
    if (!asset) {
      return JobStatus.Failed;
    }

    const input = asset.originalPath;
    const output = StorageCore.getEncodedVideoPath(asset);
    this.storageCore.ensureFolders(output);

    const { videoStream, format } = asset;
    const audioStream = asset.audioStream ?? undefined;
    if (!videoStream || !format) {
      this.logger.warn(`Skipped transcoding for asset ${asset.id}: missing metadata; re-run extraction first`);
      return JobStatus.Failed;
    }
    if (!videoStream.height || !videoStream.width) {
      this.logger.warn(`Skipped transcoding for asset ${asset.id}: no video dimensions`);
      return JobStatus.Failed;
    }

    let { ffmpeg } = await this.getConfig({ withCache: true });
    const target = this.getTranscodeTarget(ffmpeg, videoStream, audioStream);
    if (target === TranscodeTarget.None && !this.isRemuxRequired(ffmpeg, format)) {
      const encodedVideo = getAssetFile(asset.files, AssetFileType.EncodedVideo, { isEdited: false });
      if (encodedVideo) {
        this.logger.log(`Transcoded video exists for asset ${asset.id}, but is no longer required. Deleting...`);
        await this.jobRepository.queue({ name: JobName.FileDelete, data: { files: [encodedVideo.path] } });
        await this.assetRepository.deleteFiles([encodedVideo]);
      } else {
        this.logger.verbose(`Asset ${asset.id} does not require transcoding based on current policy, skipping`);
      }

      return JobStatus.Skipped;
    }

    const command = BaseConfig.create(ffmpeg, this.videoInterfaces).getCommand(target, videoStream, audioStream);
    if (ffmpeg.accel === TranscodeHardwareAcceleration.Disabled) {
      this.logger.log(`Transcoding video ${asset.id} without hardware acceleration`);
    } else {
      this.logger.log(
        `Transcoding video ${asset.id} with ${ffmpeg.accel.toUpperCase()}-accelerated encoding and${ffmpeg.accelDecode ? '' : ' software'} decoding`,
      );
    }

    try {
      await this.mediaRepository.transcode(input, output, command);
    } catch (error: any) {
      this.logger.error(`Error occurred during transcoding: ${error.message}`);
      if (ffmpeg.accel === TranscodeHardwareAcceleration.Disabled) {
        return JobStatus.Failed;
      }

      let isPartialFallbackSuccess = false;
      if (ffmpeg.accelDecode) {
        try {
          this.logger.error(`Retrying with ${ffmpeg.accel.toUpperCase()}-accelerated encoding and software decoding`);
          ffmpeg = { ...ffmpeg, accelDecode: false };
          const command = BaseConfig.create(ffmpeg, this.videoInterfaces).getCommand(target, videoStream, audioStream);
          await this.mediaRepository.transcode(input, output, command);
          isPartialFallbackSuccess = true;
        } catch (error: any) {
          this.logger.error(`Error occurred during transcoding: ${error.message}`);
        }
      }

      if (!isPartialFallbackSuccess) {
        this.logger.error(`Retrying with ${ffmpeg.accel.toUpperCase()} acceleration disabled`);
        ffmpeg = { ...ffmpeg, accel: TranscodeHardwareAcceleration.Disabled };
        const command = BaseConfig.create(ffmpeg, this.videoInterfaces).getCommand(target, videoStream, audioStream);
        await this.mediaRepository.transcode(input, output, command);
      }
    }

    this.logger.log(`Successfully encoded ${asset.id}`);

    const { file: encodedVideo, pathToDelete } = await this.applyPhysicalDeduplicationToGeneratedFile({
      assetId: asset.id,
      type: AssetFileType.EncodedVideo,
      path: output,
      isEdited: false,
      isProgressive: false,
      isTransparent: false,
    });
    await this.assetRepository.upsertFile(encodedVideo);
    if (pathToDelete) {
      await this.jobRepository.queue({ name: JobName.FileDelete, data: { files: [pathToDelete] } });
    }

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.AssetVideoEditGeneration, queue: QueueName.VideoConversion })
  async handleAssetVideoEditGeneration({ id }: JobOf<JobName.AssetVideoEditGeneration>): Promise<JobStatus> {
    const asset = await this.assetJobRepository.getForVideoConversion(id);
    if (!asset) {
      return JobStatus.Failed;
    }

    const { videoStream, format } = asset;
    const audioStream = asset.audioStream ?? undefined;
    if (!videoStream || !format) {
      this.logger.warn(`Skipped video edit generation for asset ${asset.id}: missing metadata`);
      return JobStatus.Failed;
    }

    const thumbnailAsset = {
      id: asset.id,
      ownerId: asset.ownerId,
      originalPath: asset.originalPath,
      videoStream,
      format,
    };
    const config = await this.getConfig({ withCache: true });
    const edits = (await this.assetEditRepository.getAll(id)) as AssetEditActionItem[];
    const editedFiles = this.toExistingAssetFiles(asset.files.filter((file) => file.isEdited));

    if (edits.length === 0) {
      await this.syncFiles(editedFiles, []);
      const generated = await this.generateVideoThumbnails(thumbnailAsset, config);
      await this.syncFiles(
        this.toExistingAssetFiles(asset.files.filter((file) => !file.isEdited && this.isVideoThumbnailFile(file.type))),
        generated.files,
      );
      await this.assetRepository.update({
        id: asset.id,
        thumbhash: generated.thumbhash,
        duration: Math.round(format.duration * 1000),
        ...generated.fullsizeDimensions,
      });
      return JobStatus.Success;
    }

    const output = this.getEditedEncodedVideoPath(thumbnailAsset);
    this.storageCore.ensureFolders(output);

    const plan = this.getVideoEditCommandPlan(config.ffmpeg, edits, videoStream, audioStream, format);
    this.logVideoEditCommandPlan(asset.id, plan);

    try {
      await this.mediaRepository.transcode(asset.originalPath, output, plan.command);
    } catch (error: any) {
      const message = error?.message ?? error;
      this.logger.error(`Error occurred during video edit generation: ${message}`);

      if (plan.config.accel === TranscodeHardwareAcceleration.Disabled) {
        return JobStatus.Failed;
      }

      const fallbackPlan = this.getVideoEditSoftwareFallbackCommandPlan(
        config.ffmpeg,
        edits,
        videoStream,
        audioStream,
        format,
        String(message),
      );
      this.logVideoEditCommandPlan(asset.id, fallbackPlan);

      try {
        await this.mediaRepository.transcode(asset.originalPath, output, fallbackPlan.command);
      } catch (error: any) {
        this.logger.error(`Error occurred during software video edit generation fallback: ${error?.message ?? error}`);
        return JobStatus.Failed;
      }
    }

    await this.assetRepository.upsertFile({
      assetId: asset.id,
      type: AssetFileType.EncodedVideo,
      path: output,
      isEdited: true,
      isProgressive: false,
      isTransparent: false,
    });

    const fullsizeDimensions = this.getVideoEditDimensions(edits, videoStream);
    const generated = await this.generateVideoThumbnails(thumbnailAsset, config, {
      sourcePath: output,
      isEdited: true,
      fullsizeDimensions,
    });
    await this.syncFiles(
      editedFiles.filter((file) => file.type !== AssetFileType.EncodedVideo),
      generated.files,
    );

    await this.assetRepository.update({
      id: asset.id,
      thumbhash: generated.thumbhash,
      duration: this.getVideoEditDurationMs(edits, format),
      ...fullsizeDimensions,
    });

    return JobStatus.Success;
  }

  private isVideoThumbnailFile(type: AssetFileType) {
    return [AssetFileType.Preview, AssetFileType.Thumbnail].includes(type);
  }

  private toExistingAssetFiles(
    files: Array<
      Pick<ExistingAssetFile, 'id' | 'path' | 'type' | 'isEdited'> &
        Partial<Pick<ExistingAssetFile, 'physicalFileId' | 'isProgressive' | 'isTransparent'>>
    >,
  ): ExistingAssetFile[] {
    return files.map(
      (file) =>
        ({
          ...file,
          isProgressive: file.isProgressive ?? false,
          isTransparent: file.isTransparent ?? false,
        }) as ExistingAssetFile,
    );
  }

  private getEditedEncodedVideoPath(asset: ThumbnailPathEntity) {
    const { dir, ext, name } = path.parse(StorageCore.getEncodedVideoPath(asset));
    return path.join(dir, `${name}_edited${ext}`);
  }

  private getVideoEditCommandPlan(
    config: SystemConfigFFmpegDto,
    edits: AssetEditActionItem[],
    videoStream: VideoStreamInfo,
    audioStream: AudioStreamInfo | undefined,
    format: VideoFormat,
  ): VideoEditCommandPlan {
    const hasCpuVideoFilters = this.hasCpuVideoEditFilters(edits);
    const planConfig =
      config.accel === TranscodeHardwareAcceleration.Disabled || !hasCpuVideoFilters
        ? config
        : { ...config, accelDecode: false };
    const mode =
      config.accel === TranscodeHardwareAcceleration.Disabled
        ? VideoEditAccelerationMode.Software
        : hasCpuVideoFilters
          ? VideoEditAccelerationMode.HybridHardwareEncode
          : VideoEditAccelerationMode.HardwareNative;

    return {
      command: this.getVideoEditCommand(planConfig, edits, videoStream, audioStream, format),
      config: planConfig,
      hasCpuVideoFilters,
      mode,
    };
  }

  private getVideoEditSoftwareFallbackCommandPlan(
    config: SystemConfigFFmpegDto,
    edits: AssetEditActionItem[],
    videoStream: VideoStreamInfo,
    audioStream: AudioStreamInfo | undefined,
    format: VideoFormat,
    fallbackReason: string,
  ): VideoEditCommandPlan {
    const fallbackConfig = {
      ...config,
      accel: TranscodeHardwareAcceleration.Disabled,
      accelDecode: false,
    };

    return {
      command: this.getVideoEditCommand(fallbackConfig, edits, videoStream, audioStream, format),
      config: fallbackConfig,
      hasCpuVideoFilters: this.hasCpuVideoEditFilters(edits),
      mode: VideoEditAccelerationMode.SoftwareFallback,
      fallbackReason,
    };
  }

  private logVideoEditCommandPlan(assetId: string, plan: VideoEditCommandPlan) {
    this.logger.debug(
      `Video edit acceleration plan: ${JSON.stringify({
        assetId,
        mode: plan.mode,
        accel: plan.config.accel,
        accelDecode: plan.config.accelDecode,
        hasCpuVideoFilters: plan.hasCpuVideoFilters,
        fallbackReason: plan.fallbackReason,
      })}`,
    );
  }

  private hasCpuVideoEditFilters(edits: AssetEditActionItem[]) {
    return edits.some((edit) => cpuVideoEditActions.has(edit.action));
  }

  private getVideoEditTimeline(edits: AssetEditActionItem[], format: VideoFormat): VideoEditTimeline {
    const trim = edits.find(isEditAction(AssetEditAction.Trim));
    const knownDurationMs = Math.round(format.duration * 1000);
    const lastSegmentEndMs = Math.max(
      0,
      ...edits.filter(isEditAction(AssetEditAction.Speed)).map((edit) => edit.parameters.endMs ?? 0),
    );
    const startMs = trim?.parameters.startMs ?? 0;
    const endMs = trim?.parameters.endMs ?? Math.max(knownDurationMs, lastSegmentEndMs);
    const globalSpeed = edits
      .filter(isEditAction(AssetEditAction.Speed))
      .find((edit) => edit.parameters.startMs === undefined && edit.parameters.endMs === undefined);
    const intervals =
      globalSpeed === undefined
        ? this.getSpeedIntervals(edits, startMs, endMs)
        : [{ startMs, endMs, rate: globalSpeed.parameters.rate }];

    return { startMs, endMs, intervals };
  }

  private getRenderedTimelineMs(timeMs: number, timeline: VideoEditTimeline) {
    let elapsedMs = 0;
    for (const interval of timeline.intervals) {
      if (timeMs <= interval.startMs) {
        return Math.round(elapsedMs);
      }

      if (timeMs <= interval.endMs) {
        return Math.round(elapsedMs + (timeMs - interval.startMs) / interval.rate);
      }

      elapsedMs += (interval.endMs - interval.startMs) / interval.rate;
    }

    return Math.round(elapsedMs);
  }

  private getVideoEditCommand(
    config: SystemConfigFFmpegDto,
    edits: AssetEditActionItem[],
    videoStream: VideoStreamInfo,
    audioStream: AudioStreamInfo | undefined,
    format: VideoFormat,
  ): TranscodeCommand {
    const videoFilters: string[] = [];
    const audioFilters: string[] = [];
    const transcodeConfig = BaseConfig.create(config, this.videoInterfaces) as BaseConfig;
    const inputOptions = [...transcodeConfig.getBaseInputOptions(videoStream, format)];
    const transcodeFilters = transcodeConfig.getFilterOptions(videoStream);

    const trim = edits.find((edit) => edit.action === AssetEditAction.Trim);
    const speedEdits = edits.filter(isEditAction(AssetEditAction.Speed));
    const speedSegments = speedEdits.filter(
      (edit) => edit.parameters.startMs !== undefined && edit.parameters.endMs !== undefined,
    );
    const timeline = this.getVideoEditTimeline(edits, format);
    if (trim && speedSegments.length === 0) {
      inputOptions.push('-ss', this.msToSeconds(trim.parameters.startMs));
    }

    const globalSpeed = speedEdits.find(
      (edit) =>
        edit.parameters.startMs === undefined && edit.parameters.endMs === undefined && edit.parameters.rate !== 1,
    );
    if (globalSpeed) {
      videoFilters.push(`setpts=${this.roundFilterNumber(1 / globalSpeed.parameters.rate)}*PTS`);
      audioFilters.push(...this.getAudioTempoFilters(globalSpeed.parameters.rate));
    }

    const crop = edits.find((edit) => edit.action === AssetEditAction.Crop);
    if (crop) {
      const { x, y, width, height } = crop.parameters;
      videoFilters.push(`crop=${this.toEvenDimension(width)}:${this.toEvenDimension(height)}:${x}:${y}`);
    }

    const rotate = edits.find((edit) => edit.action === AssetEditAction.Rotate);
    if (rotate) {
      switch (rotate.parameters.angle) {
        case 90: {
          videoFilters.push('transpose=1');
          break;
        }
        case 180: {
          videoFilters.push('transpose=1', 'transpose=1');
          break;
        }
        case 270: {
          videoFilters.push('transpose=2');
          break;
        }
      }
    }

    const straighten = edits.find((edit) => edit.action === AssetEditAction.Straighten);
    if (straighten && straighten.parameters.angle !== 0) {
      videoFilters.push(`rotate=${this.roundFilterNumber(straighten.parameters.angle)}*PI/180:fillcolor=black`);
    }

    for (const mirror of edits.filter((edit) => edit.action === AssetEditAction.Mirror)) {
      videoFilters.push(mirror.parameters.axis === 'horizontal' ? 'hflip' : 'vflip');
    }

    if (edits.some((edit) => edit.action === AssetEditAction.Stabilize && edit.parameters.enabled)) {
      videoFilters.push('deshake');
    }

    if (edits.some((edit) => edit.action === AssetEditAction.AutoEnhance && edit.parameters.enabled)) {
      videoFilters.push('eq=contrast=1.08:saturation=1.08:gamma=1.02');
    }

    const adjust = edits.find((edit) => edit.action === AssetEditAction.Adjust);
    if (adjust) {
      videoFilters.push(...this.getAdjustmentFilters(adjust.parameters));
    }

    for (const look of edits.filter(
      (edit) => edit.action === AssetEditAction.Filter || edit.action === AssetEditAction.Effect,
    )) {
      const filter = this.getLookFilter(look.parameters.name, look.parameters.intensity);
      if (filter) {
        videoFilters.push(filter);
      }
    }

    for (const overlay of edits.filter((edit) => edit.action === AssetEditAction.TextOverlay)) {
      videoFilters.push(this.getTextOverlayFilter(overlay.parameters, timeline));
    }

    videoFilters.push(...transcodeFilters);

    const audioEdit = edits.find((edit) => edit.action === AssetEditAction.Audio);
    const muted = !!audioEdit?.parameters.muted;
    if (audioEdit?.parameters.volume !== undefined && !muted) {
      audioFilters.push(`volume=${this.roundFilterNumber(audioEdit.parameters.volume)}`);
    }

    let outputOptions = [
      ...transcodeConfig.getBaseOutputOptions(TranscodeTarget.All, videoStream, muted ? undefined : audioStream),
    ];

    if (speedSegments.length > 0) {
      const { filters, maps } = this.getSegmentedSpeedFilterGraph(
        timeline.intervals,
        videoStream,
        audioStream,
        muted,
        videoFilters,
        audioFilters,
      );
      outputOptions.push('-filter_complex', filters);
      outputOptions = this.replaceOutputMaps(outputOptions, maps);
    } else if (trim) {
      outputOptions.unshift('-t', this.msToSeconds(trim.parameters.endMs - trim.parameters.startMs));
    }

    if (speedSegments.length === 0 && videoFilters.length > 0) {
      outputOptions.push('-vf', videoFilters.join(','));
    }

    if (muted) {
      outputOptions.push('-an');
    } else if (speedSegments.length === 0 && audioFilters.length > 0) {
      outputOptions.push('-filter:a', audioFilters.join(','));
    }

    outputOptions.push(
      ...transcodeConfig.getPresetOptions(),
      ...transcodeConfig.getOutputThreadOptions(),
      ...transcodeConfig.getBitrateOptions(),
    );

    return {
      inputOptions,
      outputOptions,
      twoPass: false,
      progress: { frameCount: videoStream.frameCount, percentInterval: 10 },
    };
  }

  private getSegmentedSpeedFilterGraph(
    intervals: SpeedInterval[],
    videoStream: VideoStreamInfo,
    audioStream: AudioStreamInfo | undefined,
    muted: boolean,
    videoFilters: string[],
    audioFilters: string[],
  ) {
    const filters: string[] = [];
    const hasAudio = !!audioStream && !muted;

    for (const [index, interval] of intervals.entries()) {
      const start = this.msToSeconds(interval.startMs);
      const end = this.msToSeconds(interval.endMs);
      filters.push(
        `[0:${videoStream.index}]trim=start=${start}:end=${end},setpts=${this.roundFilterNumber(1 / interval.rate)}*(PTS-STARTPTS)[v${index}]`,
      );

      if (hasAudio) {
        const tempoFilters = interval.rate === 1 ? [] : this.getAudioTempoFilters(interval.rate);
        filters.push(
          `[0:${audioStream.index}]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS${tempoFilters.length > 0 ? `,${tempoFilters.join(',')}` : ''}[a${index}]`,
        );
      }
    }

    if (hasAudio) {
      const concatInput = intervals.map((_, index) => `[v${index}][a${index}]`).join('');
      const concatVideoLabel = videoFilters.length > 0 ? 'vconcat' : 'vout';
      const concatAudioLabel = audioFilters.length > 0 ? 'aconcat' : 'aout';
      filters.push(`${concatInput}concat=n=${intervals.length}:v=1:a=1[${concatVideoLabel}][${concatAudioLabel}]`);

      if (videoFilters.length > 0) {
        filters.push(`[${concatVideoLabel}]${videoFilters.join(',')}[vout]`);
      }
      if (audioFilters.length > 0) {
        filters.push(`[${concatAudioLabel}]${audioFilters.join(',')}[aout]`);
      }

      return { filters: filters.join(';'), maps: ['[vout]', '[aout]'] };
    }

    const concatInput = intervals.map((_, index) => `[v${index}]`).join('');
    const concatVideoLabel = videoFilters.length > 0 ? 'vconcat' : 'vout';
    filters.push(`${concatInput}concat=n=${intervals.length}:v=1:a=0[${concatVideoLabel}]`);
    if (videoFilters.length > 0) {
      filters.push(`[${concatVideoLabel}]${videoFilters.join(',')}[vout]`);
    }

    return { filters: filters.join(';'), maps: ['[vout]'] };
  }

  private getSpeedIntervals(edits: AssetEditActionItem[], startMs: number, endMs: number): SpeedInterval[] {
    const speedSegments = edits
      .filter(isEditAction(AssetEditAction.Speed))
      .filter((edit) => edit.parameters.startMs !== undefined && edit.parameters.endMs !== undefined)
      .sort((a, b) => a.parameters.startMs! - b.parameters.startMs!);

    const intervals: SpeedInterval[] = [];
    let cursorMs = startMs;
    for (const segment of speedSegments) {
      const segmentStartMs = clamp(segment.parameters.startMs!, startMs, endMs);
      const segmentEndMs = clamp(segment.parameters.endMs!, startMs, endMs);
      if (segmentEndMs <= segmentStartMs) {
        continue;
      }

      if (segmentStartMs > cursorMs) {
        intervals.push({ startMs: cursorMs, endMs: segmentStartMs, rate: 1 });
      }

      intervals.push({ startMs: segmentStartMs, endMs: segmentEndMs, rate: segment.parameters.rate });
      cursorMs = segmentEndMs;
    }

    if (cursorMs < endMs) {
      intervals.push({ startMs: cursorMs, endMs, rate: 1 });
    }

    return intervals;
  }

  private replaceOutputMaps(outputOptions: string[], maps: string[]) {
    const filteredOptions: string[] = [];
    for (let index = 0; index < outputOptions.length; index++) {
      if (outputOptions[index] === '-map') {
        index++;
        continue;
      }

      filteredOptions.push(outputOptions[index]);
    }

    return [...filteredOptions, ...maps.flatMap((map) => ['-map', map])];
  }

  private getAdjustmentFilters(adjust: Extract<AssetEditActionItem, { action: AssetEditAction.Adjust }>['parameters']) {
    const filters: string[] = [];
    const eqOptions: string[] = [];

    if (adjust.brightness) {
      eqOptions.push(`brightness=${this.roundFilterNumber(adjust.brightness / 100)}`);
    }
    if (adjust.contrast) {
      eqOptions.push(`contrast=${this.roundFilterNumber(1 + adjust.contrast / 100)}`);
    }
    if (adjust.saturation) {
      eqOptions.push(`saturation=${this.roundFilterNumber(1 + adjust.saturation / 100)}`);
    }
    if (adjust.highlights || adjust.shadows || adjust.whitePoint || adjust.blackPoint || adjust.hdr) {
      const gamma =
        1 +
        ((adjust.shadows ?? 0) -
          (adjust.highlights ?? 0) +
          (adjust.hdr ?? 0) +
          (adjust.blackPoint ?? 0) -
          (adjust.whitePoint ?? 0)) /
          500;
      eqOptions.push(`gamma=${this.roundFilterNumber(gamma)}`);
    }
    if (eqOptions.length > 0) {
      filters.push(`eq=${eqOptions.join(':')}`);
    }

    const warmth = adjust.warmth ?? 0;
    const tint = adjust.tint ?? 0;
    const skinTone = adjust.skinTone ?? 0;
    const blueTone = adjust.blueTone ?? 0;
    if (warmth || tint || skinTone || blueTone) {
      filters.push(
        `colorbalance=rm=${this.roundFilterNumber((warmth + skinTone) / 350)}:gm=${this.roundFilterNumber(tint / 350)}:bm=${this.roundFilterNumber((blueTone - warmth) / 350)}`,
      );
    }

    if (adjust.vignette) {
      filters.push(`vignette=angle=${this.roundFilterNumber((Math.PI / 4) * (Math.abs(adjust.vignette) / 100))}`);
    }

    return filters;
  }

  private getLookFilter(name: string, intensity = 100) {
    const amount = clamp(intensity / 100, 0, 1);
    switch (name.trim().toLowerCase()) {
      case 'vivid': {
        return `eq=saturation=${this.roundFilterNumber(1 + 0.3 * amount)}:contrast=${this.roundFilterNumber(1 + 0.12 * amount)}`;
      }
      case 'warm': {
        return `colorbalance=rm=${this.roundFilterNumber(0.12 * amount)}:bm=${this.roundFilterNumber(-0.1 * amount)}`;
      }
      case 'cool': {
        return `colorbalance=rm=${this.roundFilterNumber(-0.08 * amount)}:bm=${this.roundFilterNumber(0.12 * amount)}`;
      }
      case 'black_white':
      case 'black-and-white':
      case 'black and white':
      case 'bw': {
        return 'hue=s=0';
      }
      case 'fade': {
        return `eq=contrast=${this.roundFilterNumber(1 - 0.18 * amount)}:saturation=${this.roundFilterNumber(1 - 0.25 * amount)}`;
      }
      case 'vignette': {
        return `vignette=angle=${this.roundFilterNumber((Math.PI / 4) * amount)}`;
      }
      default: {
        return null;
      }
    }
  }

  private getTextOverlayFilter(
    parameters: Extract<AssetEditActionItem, { action: AssetEditAction.TextOverlay }>['parameters'],
    timeline: VideoEditTimeline,
  ) {
    const color = parameters.color.replace('#', '0x');
    const escapedComma = `${String.fromCodePoint(92)},`;
    const startMs =
      parameters.startMs === undefined ? undefined : this.getRenderedTimelineMs(parameters.startMs, timeline);
    const endMs = parameters.endMs === undefined ? undefined : this.getRenderedTimelineMs(parameters.endMs, timeline);
    const enable =
      startMs !== undefined && endMs !== undefined
        ? `:enable='between(t${escapedComma}${this.msToSeconds(startMs)}${escapedComma}${this.msToSeconds(endMs)})'`
        : '';
    return `drawtext=text='${this.escapeFfmpegText(parameters.text)}':x=w*${this.roundFilterNumber(parameters.x)}:y=h*${this.roundFilterNumber(parameters.y)}:fontsize=h*${this.roundFilterNumber(parameters.size)}:fontcolor=${color}${enable}`;
  }

  private getVideoEditDimensions(edits: AssetEditActionItem[], videoStream: VideoStreamInfo): ImageDimensions {
    let width = videoStream.width;
    let height = videoStream.height;

    const crop = edits.find((edit) => edit.action === AssetEditAction.Crop);
    if (crop) {
      width = crop.parameters.width;
      height = crop.parameters.height;
    }

    const rotate = edits.find((edit) => edit.action === AssetEditAction.Rotate);
    if (rotate && [90, 270].includes(rotate.parameters.angle)) {
      [width, height] = [height, width];
    }

    return { width, height };
  }

  private getVideoEditDurationMs(edits: AssetEditActionItem[], format: VideoFormat) {
    const timeline = this.getVideoEditTimeline(edits, format);
    return Math.round(
      timeline.intervals.reduce((durationMs, interval) => {
        return durationMs + (interval.endMs - interval.startMs) / interval.rate;
      }, 0),
    );
  }

  private getAudioTempoFilters(rate: number) {
    const filters: string[] = [];
    let remaining = rate;
    while (remaining < 0.5) {
      filters.push('atempo=0.5');
      remaining /= 0.5;
    }
    while (remaining > 2) {
      filters.push('atempo=2');
      remaining /= 2;
    }
    filters.push(`atempo=${this.roundFilterNumber(remaining)}`);
    return filters;
  }

  private escapeFfmpegText(value: string) {
    const escape = String.fromCodePoint(92);
    return value
      .replaceAll(escape, escape + escape)
      .replaceAll(':', `${escape}:`)
      .replaceAll("'", `${escape}'`)
      .replaceAll(',', `${escape},`);
  }

  private msToSeconds(milliseconds: number) {
    return this.roundFilterNumber(milliseconds / 1000);
  }

  private roundFilterNumber(value: number) {
    return Number(value.toFixed(4)).toString();
  }

  private toEvenDimension(value: number) {
    return Math.max(2, value - (value % 2));
  }

  private getTranscodeTarget(
    config: SystemConfigFFmpegDto,
    videoStream: VideoStreamInfo,
    audioStream?: AudioStreamInfo,
  ): TranscodeTarget {
    const isAudioTranscodeRequired = this.isAudioTranscodeRequired(config, audioStream);
    const isVideoTranscodeRequired = this.isVideoTranscodeRequired(config, videoStream);

    if (isAudioTranscodeRequired && isVideoTranscodeRequired) {
      return TranscodeTarget.All;
    }

    if (isAudioTranscodeRequired) {
      return TranscodeTarget.Audio;
    }

    if (isVideoTranscodeRequired) {
      return TranscodeTarget.Video;
    }

    return TranscodeTarget.None;
  }

  private isAudioTranscodeRequired(ffmpegConfig: SystemConfigFFmpegDto, stream?: AudioStreamInfo): boolean {
    if (!stream) {
      return false;
    }

    switch (ffmpegConfig.transcode) {
      case TranscodePolicy.Disabled: {
        return false;
      }
      case TranscodePolicy.All: {
        return true;
      }
      case TranscodePolicy.Required:
      case TranscodePolicy.Optimal:
      case TranscodePolicy.Bitrate: {
        return !ffmpegConfig.acceptedAudioCodecs.includes(stream.codecName as AudioCodec);
      }
      default: {
        throw new Error(`Unsupported transcode policy: ${ffmpegConfig.transcode}`);
      }
    }
  }

  private isVideoTranscodeRequired(ffmpegConfig: SystemConfigFFmpegDto, stream: VideoStreamInfo): boolean {
    const isScalingEnabled = ffmpegConfig.targetResolution !== 'original';
    const targetRes = Number.parseInt(ffmpegConfig.targetResolution);
    const isLargerThanTargetRes = isScalingEnabled && Math.min(stream.height, stream.width) > targetRes;
    const maxBitrate = this.parseBitrateToBps(ffmpegConfig.maxBitrate);
    const isLargerThanTargetBitrate = maxBitrate > 0 && stream.bitrate > maxBitrate;

    const isTargetVideoCodec = ffmpegConfig.acceptedVideoCodecs.includes(stream.codecName as VideoCodec);
    const isRequired = !isTargetVideoCodec || !stream.pixelFormat.endsWith('420p');

    switch (ffmpegConfig.transcode) {
      case TranscodePolicy.Disabled: {
        return false;
      }
      case TranscodePolicy.All: {
        return true;
      }
      case TranscodePolicy.Required: {
        return isRequired;
      }
      case TranscodePolicy.Optimal: {
        return isRequired || isLargerThanTargetRes;
      }
      case TranscodePolicy.Bitrate: {
        return isRequired || isLargerThanTargetBitrate;
      }
      default: {
        throw new Error(`Unsupported transcode policy: ${ffmpegConfig.transcode}`);
      }
    }
  }

  private isRemuxRequired(ffmpegConfig: SystemConfigFFmpegDto, { formatName, formatLongName }: VideoFormat): boolean {
    if (ffmpegConfig.transcode === TranscodePolicy.Disabled) {
      return false;
    }

    const formatLongNameMapping: Record<string, VideoContainer> = {
      'QuickTime / MOV': VideoContainer.Mov,
      'Matroska / WebM': VideoContainer.Webm,
    };

    const name = (formatLongName ? formatLongNameMapping[formatLongName] : undefined) ?? (formatName as VideoContainer);

    return name !== VideoContainer.Mp4 && !ffmpegConfig.acceptedContainers.includes(name);
  }

  isSRGB({
    colorspace,
    profileDescription,
    bitsPerSample,
  }: {
    colorspace: string | null;
    profileDescription: string | null;
    bitsPerSample: number | null;
  }): boolean {
    if (colorspace || profileDescription) {
      return [colorspace, profileDescription].some((s) => s?.toLowerCase().includes('srgb'));
    }
    if (bitsPerSample) {
      // assume sRGB for 8-bit images with no color profile or colorspace metadata
      return bitsPerSample === 8;
    }
    // assume sRGB for images with no relevant metadata
    return true;
  }

  private parseBitrateToBps(bitrateString: string) {
    const bitrateValue = Number.parseInt(bitrateString);

    if (Number.isNaN(bitrateValue)) {
      this.logger.log(`Maximum bitrate '${bitrateString} is not a number and will be ignored.`);
      return 0;
    }

    if (bitrateString.toLowerCase().endsWith('k')) {
      return bitrateValue * 1000; // Kilobits per second to bits per second
    }
    if (bitrateString.toLowerCase().endsWith('m')) {
      return bitrateValue * 1_000_000; // Megabits per second to bits per second
    }
    return bitrateValue;
  }

  private async shouldUseExtractedImage(extractedPathOrBuffer: string | Buffer, targetSize: number) {
    const { width, height } = await this.mediaRepository.getImageMetadata(extractedPathOrBuffer);
    const extractedSize = Math.min(width, height);
    return extractedSize >= targetSize;
  }

  private async syncFiles(oldFiles: ExistingAssetFile[], newFiles: UpsertFileOptions[]) {
    const toUpsert: UpsertFileOptions[] = [];
    const pathsToDelete: string[] = [];
    const toDelete = new Set(oldFiles);

    for (const inputFile of newFiles) {
      const { file: newFile, pathToDelete } = await this.applyPhysicalDeduplicationToGeneratedFile(inputFile);
      if (pathToDelete) {
        pathsToDelete.push(pathToDelete);
      }
      const existingFile = oldFiles.find((file) => file.type === newFile.type && file.isEdited === newFile.isEdited);
      if (existingFile) {
        toDelete.delete(existingFile);
      }

      // upsert new file path
      if (
        existingFile?.path !== newFile.path ||
        existingFile.isProgressive !== newFile.isProgressive ||
        existingFile.isTransparent !== newFile.isTransparent
      ) {
        toUpsert.push(newFile);

        // delete old file from disk
        if (existingFile && existingFile.path !== newFile.path) {
          this.logger.debug(
            `Deleting old ${newFile.type} image for asset ${newFile.assetId} in favor of a replacement`,
          );
          pathsToDelete.push(existingFile.path);
        }
      }
    }

    if (toUpsert.length > 0) {
      await this.assetRepository.upsertFiles(toUpsert);
    }

    if (toDelete.size > 0) {
      const toDeleteArray = [...toDelete];
      for (const file of toDeleteArray) {
        pathsToDelete.push(file.path);
      }
      await this.assetRepository.deleteFiles(toDeleteArray);
    }

    if (pathsToDelete.length > 0) {
      await this.jobRepository.queue({ name: JobName.FileDelete, data: { files: pathsToDelete } });
    }
  }

  private async applyPhysicalDeduplicationToGeneratedFile(
    file: UpsertFileOptions,
  ): Promise<{ file: UpsertFileOptions; pathToDelete?: string }> {
    if (file.isEdited || !this.isPhysicalDeduplicationGeneratedFile(file.type)) {
      return { file };
    }

    const { physicalDeduplication } = await this.getConfig({ withCache: true });
    if (!physicalDeduplication.enabled) {
      return { file };
    }

    const canonical = await this.physicalFileRepository.getCanonicalGeneratedFile(file.assetId, file.type);
    if (canonical) {
      return {
        file: { ...file, path: canonical.path, physicalFileId: canonical.id },
        pathToDelete: file.path === canonical.path ? undefined : file.path,
      };
    }

    const originalPhysical = await this.physicalFileRepository.getOriginalPhysicalFile(file.assetId);
    if (originalPhysical?.canonicalAssetId !== file.assetId) {
      return { file };
    }

    const stat = await this.storageRepository.stat(file.path);
    const physicalFile = await this.physicalFileRepository.upsertPhysicalFile({
      canonicalAssetId: file.assetId,
      checksum: await this.cryptoRepository.hashFile(file.path),
      path: file.path,
      sizeInBytes: stat.size,
      type: this.toPhysicalFileType(file.type),
    });

    return { file: { ...file, physicalFileId: physicalFile.id } };
  }

  private isPhysicalDeduplicationGeneratedFile(type: AssetFileType) {
    return [
      AssetFileType.Thumbnail,
      AssetFileType.Preview,
      AssetFileType.FullSize,
      AssetFileType.EncodedVideo,
    ].includes(type);
  }

  private toPhysicalFileType(type: AssetFileType) {
    switch (type) {
      case AssetFileType.Thumbnail: {
        return PhysicalFileType.Thumbnail;
      }
      case AssetFileType.Preview: {
        return PhysicalFileType.Preview;
      }
      case AssetFileType.FullSize: {
        return PhysicalFileType.FullSize;
      }
      case AssetFileType.EncodedVideo: {
        return PhysicalFileType.EncodedVideo;
      }
      default: {
        throw new Error(`Unsupported physical file type: ${type}`);
      }
    }
  }

  private async generateEditedThumbnails(asset: ThumbnailAsset, config: SystemConfig) {
    if (asset.type !== AssetType.Image || (asset.files.length === 0 && asset.edits.length === 0)) {
      return;
    }

    const generated = asset.edits.length > 0 ? await this.generateImageThumbnails(asset, config, true) : undefined;

    const crop = asset.edits.find((e) => e.action === AssetEditAction.Crop);
    const cropBox = crop
      ? {
          x1: crop.parameters.x,
          y1: crop.parameters.y,
          x2: crop.parameters.x + crop.parameters.width,
          y2: crop.parameters.y + crop.parameters.height,
        }
      : undefined;

    const originalDimensions = getDimensions(asset.exifInfo!);
    const assetFaces = await this.personRepository.getFaces(asset.id, {});
    const ocrData = await this.ocrRepository.getByAssetId(asset.id, {});

    const faceStatuses = checkFaceVisibility(assetFaces, originalDimensions, cropBox);
    await this.personRepository.updateVisibility(faceStatuses.visible, faceStatuses.hidden);

    const ocrStatuses = checkOcrVisibility(ocrData, originalDimensions, cropBox);
    await this.ocrRepository.updateOcrVisibilities(asset.id, ocrStatuses.visible, ocrStatuses.hidden);

    return generated;
  }

  private warnOnTransparencyLoss(isTransparent: boolean, format: ImageFormat, assetId: string) {
    if (isTransparent && format === ImageFormat.Jpeg) {
      this.logger.warn(
        `Asset ${assetId} has transparency but the configured format is ${format} which does not support it, consider using a format that does, such as ${ImageFormat.Webp}`,
      );
    }
  }

  private getImageFile(
    asset: ThumbnailPathEntity,
    options: ImagePathOptions & { isProgressive: boolean; isTransparent: boolean },
  ) {
    const path = StorageCore.getImagePath(asset, options);
    return {
      assetId: asset.id,
      type: options.fileType,
      path,
      isEdited: options.isEdited,
      isProgressive: options.isProgressive,
      isTransparent: options.isTransparent,
    };
  }
}
