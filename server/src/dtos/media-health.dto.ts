import { createZodDto } from 'nestjs-zod';
import { AssetResponseSchema } from 'src/dtos/asset-response.dto';
import {
  MediaHealthCategorySchema,
  MediaHealthSeveritySchema,
  MediaHealthStatus,
  MediaHealthStatusSchema,
} from 'src/enum';
import z from 'zod';

const JsonObjectSchema = z.record(z.string(), z.unknown());

const MediaHealthCandidateSchema = z
  .object({
    id: z.uuidv4().describe('Candidate ID'),
    healthId: z.uuidv4().describe('Media health finding ID'),
    candidatePath: z.string().describe('Candidate file path'),
    status: MediaHealthStatusSchema,
    visualMatchScore: z.number().nullable().describe('Visual match score from 0 to 1'),
    evidence: JsonObjectSchema,
    resolution: JsonObjectSchema,
    checkedAt: z.string().meta({ format: 'date-time' }),
  })
  .meta({ id: 'MediaHealthCandidateDto' });

const MediaHealthItemSchema = z
  .object({
    id: z.uuidv4().describe('Media health finding ID'),
    assetId: z.uuidv4().describe('Asset ID'),
    category: MediaHealthCategorySchema,
    status: MediaHealthStatusSchema,
    severity: MediaHealthSeveritySchema,
    originalPath: z.string().describe('Original media path'),
    originalFileName: z.string().describe('Original media filename'),
    evidence: JsonObjectSchema,
    resolution: JsonObjectSchema,
    checkedAt: z.string().meta({ format: 'date-time' }),
    dismissedAt: z.string().meta({ format: 'date-time' }).nullable(),
    resolvedAt: z.string().meta({ format: 'date-time' }).nullable(),
    asset: AssetResponseSchema,
    candidates: z.array(MediaHealthCandidateSchema),
  })
  .meta({ id: 'MediaHealthItemDto' });

const MediaHealthBucketSchema = z
  .object({
    timeBucket: z.string().describe('Timeline bucket date'),
    count: z.int().describe('Number of findings in the bucket'),
    items: z.array(MediaHealthItemSchema),
  })
  .meta({ id: 'MediaHealthBucketDto' });

const MediaHealthRunResponseSchema = z
  .object({
    id: z.uuidv4().describe('Media health run ID'),
    category: MediaHealthCategorySchema,
    status: z.string().describe('Run status'),
    startedAt: z.string().meta({ format: 'date-time' }),
    finishedAt: z.string().meta({ format: 'date-time' }).nullable(),
    totalAssets: z.int(),
    checkedAssets: z.int(),
    foundAssets: z.int(),
    error: z.string().nullable(),
  })
  .meta({ id: 'MediaHealthRunResponseDto' });

const MediaHealthListResponseSchema = z
  .object({
    buckets: z.array(MediaHealthBucketSchema),
    total: z.int(),
    run: MediaHealthRunResponseSchema.nullable(),
  })
  .meta({ id: 'MediaHealthListResponseDto' });

const MediaHealthListQuerySchema = z
  .object({
    category: MediaHealthCategorySchema.optional(),
    status: MediaHealthStatusSchema.optional(),
    size: z.coerce.number().int().min(1).max(200).default(100).optional(),
  })
  .meta({ id: 'MediaHealthListQueryDto' });

const MediaHealthBulkActionSchema = z
  .object({
    ids: z.array(z.uuidv4()).min(1).max(1000).describe('Media health finding IDs'),
  })
  .meta({ id: 'MediaHealthBulkActionDto' });

const MediaHealthDeleteCorruptSchema = MediaHealthBulkActionSchema.extend({
  confirmText: z.string().describe('Typed confirmation text'),
}).meta({ id: 'MediaHealthDeleteCorruptDto' });

const MediaHealthScanResponseSchema = z
  .object({
    runId: z.uuidv4(),
  })
  .meta({ id: 'MediaHealthScanResponseDto' });

const MediaHealthBulkResultSchema = z
  .object({
    id: z.uuidv4(),
    success: z.boolean(),
    status: MediaHealthStatusSchema.optional(),
    error: z.string().optional(),
  })
  .meta({ id: 'MediaHealthBulkResultDto' });

const MediaHealthBulkResponseSchema = z
  .object({
    results: z.array(MediaHealthBulkResultSchema),
  })
  .meta({ id: 'MediaHealthBulkResponseDto' });

export class MediaHealthCandidateDto extends createZodDto(MediaHealthCandidateSchema) {}
export class MediaHealthItemDto extends createZodDto(MediaHealthItemSchema) {}
export class MediaHealthBucketDto extends createZodDto(MediaHealthBucketSchema) {}
export class MediaHealthRunResponseDto extends createZodDto(MediaHealthRunResponseSchema) {}
export class MediaHealthListResponseDto extends createZodDto(MediaHealthListResponseSchema) {}
export class MediaHealthListQueryDto extends createZodDto(MediaHealthListQuerySchema) {}
export class MediaHealthBulkActionDto extends createZodDto(MediaHealthBulkActionSchema) {}
export class MediaHealthDeleteCorruptDto extends createZodDto(MediaHealthDeleteCorruptSchema) {}
export class MediaHealthScanResponseDto extends createZodDto(MediaHealthScanResponseSchema) {}
export class MediaHealthBulkResponseDto extends createZodDto(MediaHealthBulkResponseSchema) {}

export const CORRUPT_MEDIA_DELETE_CONFIRM_TEXT = 'MOVE CORRUPT MEDIA TO TRASH';
export const CORRUPT_MEDIA_DELETE_RECENT_MS = 24 * 60 * 60 * 1000;

export const CORRUPT_DELETE_STATUSES = new Set<MediaHealthStatus>([MediaHealthStatus.CorruptConfirmed]);
