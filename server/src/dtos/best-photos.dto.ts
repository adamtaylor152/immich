import { createZodDto } from 'nestjs-zod';
import { AssetResponseSchema } from 'src/dtos/asset-response.dto';
import { stringToBool } from 'src/validation';
import z from 'zod';

export const BEST_PHOTO_SCORE_VERSION = 1;

const BestPhotoScoreSchema = z
  .object({
    score: z.number().min(0).max(1),
    aestheticScore: z.number().min(0).max(1).nullable(),
    technicalScore: z.number().min(0).max(1).nullable(),
    subjectScore: z.number().min(0).max(1).nullable(),
    diversityScore: z.number().min(0).max(1).nullable(),
    scoreVersion: z.int(),
    computedAt: z.string().meta({ format: 'date-time' }),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    bestFrameTimestampMs: z.int().nullable(),
    frameScore: z.number().min(0).max(1).nullable(),
    frameMetadata: z.record(z.string(), z.unknown()).nullable(),
  })
  .meta({ id: 'BestPhotoScoreDto' });

const BestPhotoAssetResponseSchema = AssetResponseSchema.extend({
  bestPhotoScore: BestPhotoScoreSchema,
}).meta({ id: 'BestPhotoAssetResponseDto' });

const BestPhotosResponseSchema = z
  .object({
    total: z.int().min(0),
    count: z.int().min(0),
    items: z.array(BestPhotoAssetResponseSchema),
    nextPage: z.string().nullable(),
  })
  .meta({ id: 'BestPhotosResponseDto' });

const BestPhotosQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(500).default(100),
    page: z.coerce.number().int().min(1).default(1),
    minScore: z.coerce.number().min(0).max(1).optional(),
    includeArchived: stringToBool.default(false),
    includeVideos: stringToBool.default(false),
  })
  .meta({ id: 'BestPhotosQueryDto' });

export class BestPhotoScoreDto extends createZodDto(BestPhotoScoreSchema) {}
export class BestPhotoAssetResponseDto extends createZodDto(BestPhotoAssetResponseSchema) {}
export class BestPhotosResponseDto extends createZodDto(BestPhotosResponseSchema) {}
export class BestPhotosQueryDto extends createZodDto(BestPhotosQuerySchema) {}
