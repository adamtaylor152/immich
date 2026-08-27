import { createZodDto } from 'nestjs-zod';
import {
  AdminConfigSchema,
  ConfigFFmpegDto,
  ConfigTemplateStorageOptionDto,
  mapAdminConfig,
  type SystemConfig,
} from 'src/dtos/config.dto';
import { MachineLearningHardwareAccelerationSchema } from 'src/enum';
import z from 'zod';

// Upstream moved the system config schema/defaults into src/dtos/config.dto.ts
// (new config module, see the /admin/config endpoints). This file keeps the
// fork's legacy import path alive and hosts the fork-only DTOs used by the
// /system-config fork endpoints (image-description re-queue, smart albums,
// ML hardware detection).

export { SystemConfigDto, SystemConfigSmtpDto } from 'src/dtos/config.dto';
export { ReleaseChannel } from 'src/enum';
export { ConfigFFmpegDto as SystemConfigFFmpegDto, ConfigTemplateStorageOptionDto as SystemConfigTemplateStorageOptionDto };

/** Full admin config schema — used by the fork's config repositories for validation. */
export const SystemConfigSchema = AdminConfigSchema;

/** @deprecated use {@link mapAdminConfig}; kept for fork call sites and specs. */
export const mapConfig = mapAdminConfig;

const MachineLearningHardwareResponseSchema = z
  .object({
    providers: z.array(z.string()).describe('Available ONNX Runtime providers'),
    openvinoDeviceIds: z.array(z.string()).describe('Available OpenVINO device IDs'),
    torchCudaAvailable: z.boolean().describe('Whether PyTorch CUDA is available'),
    cudaDeviceCount: z.int().min(0).describe('Available PyTorch CUDA device count'),
    preferredAcceleration: MachineLearningHardwareAccelerationSchema.describe(
      'Detected preferred hardware acceleration',
    ),
  })
  .meta({ id: 'MachineLearningHardwareResponseDto' });

export class MachineLearningHardwareResponseDto extends createZodDto(MachineLearningHardwareResponseSchema) {}

const ImageDescriptionRequeueEstimateSchema = z
  .object({
    totalAssets: z.int().min(0).describe('Total eligible image assets'),
    withDescription: z
      .int()
      .min(0)
      .describe('Number of eligible assets that currently have a description (will be re-run on force-requeue).'),
    withoutDescription: z.int().min(0).describe('Number of eligible assets that currently have no description.'),
    rollingAvgSeconds: z
      .number()
      .meta({ format: 'double' })
      .min(0)
      .describe(
        'Average seconds per asset, computed as a rolling mean of the most recent 100 completed image-description jobs. Falls back to a 1.5s default when no jobs have completed since the server started.',
      ),
    estimatedTotalSeconds: z
      .number()
      .meta({ format: 'double' })
      .min(0)
      .describe(
        'Estimated wall-clock time to re-describe every eligible asset (force mode: every asset is re-processed, not just those without descriptions).',
      ),
    activeBackend: z.string().describe('Configured hardware acceleration backend (e.g. "auto", "cuda")'),
    activeModel: z.string().describe('Configured image description model name'),
  })
  .meta({ id: 'ImageDescriptionRequeueEstimateDto' });

export class ImageDescriptionRequeueEstimateDto extends createZodDto(ImageDescriptionRequeueEstimateSchema) {}

const ImageDescriptionRequeueResponseSchema = z
  .object({
    queued: z.boolean().describe('Whether the queue-all job was newly enqueued (false = already in-flight)'),
  })
  .meta({ id: 'ImageDescriptionRequeueResponseDto' });

export class ImageDescriptionRequeueResponseDto extends createZodDto(ImageDescriptionRequeueResponseSchema) {}

const SmartAlbumReevaluateEstimateSchema = z
  .object({
    totalAssets: z
      .int()
      .min(0)
      .describe('Total image assets that will be evaluated (currently equals withDescription)'),
    withDescription: z.int().min(0).describe('Image assets with a successfully completed description'),
  })
  .meta({ id: 'SmartAlbumReevaluateEstimateDto' });

export class SmartAlbumReevaluateEstimateDto extends createZodDto(SmartAlbumReevaluateEstimateSchema) {}

const SmartAlbumReevaluateResponseSchema = z
  .object({
    queued: z.boolean().describe('Whether the re-evaluate job was newly enqueued (false = already in-flight)'),
  })
  .meta({ id: 'SmartAlbumReevaluateResponseDto' });

export class SmartAlbumReevaluateResponseDto extends createZodDto(SmartAlbumReevaluateResponseSchema) {}

/** Known built-in smart-album kinds. Keep aligned with SystemConfig['smartAlbums']['builtIn']. */
export const SMART_ALBUM_BUILT_IN_KINDS = [
  'travel',
  'documents',
  'screenshots',
  'food',
  'pets',
  'nature',
] as const satisfies readonly (keyof SystemConfig['smartAlbums']['builtIn'])[];
export type SmartAlbumBuiltInKind = (typeof SMART_ALBUM_BUILT_IN_KINDS)[number];

const SmartAlbumReevaluateRequestSchema = z
  .object({
    kind: z
      .enum(SMART_ALBUM_BUILT_IN_KINDS)
      .optional()
      .describe('Optional built-in kind to scope the re-evaluation to. Omit to re-evaluate every enabled kind.'),
  })
  .meta({ id: 'SmartAlbumReevaluateRequestDto' });

export class SmartAlbumReevaluateRequestDto extends createZodDto(SmartAlbumReevaluateRequestSchema) {}
