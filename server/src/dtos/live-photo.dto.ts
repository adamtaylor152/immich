import { createZodDto } from 'nestjs-zod';
import { AssetResponseSchema } from 'src/dtos/asset-response.dto';
import z from 'zod';

const LivePhotoMatchConfidenceSchema = z.enum(['high', 'low']).meta({ id: 'LivePhotoMatchConfidence' });

const LivePhotoCandidateSchema = z
  .object({
    photo: AssetResponseSchema,
    video: AssetResponseSchema,
    confidence: LivePhotoMatchConfidenceSchema,
    matchReason: z.string().describe('Why these two assets are believed to be a separated live photo pair'),
  })
  .meta({ id: 'LivePhotoCandidateDto' });

const LivePhotoCandidatesResponseSchema = z
  .object({
    candidates: z.array(LivePhotoCandidateSchema),
    total: z.int().describe('Total number of candidate pairs found'),
  })
  .meta({ id: 'LivePhotoCandidatesResponseDto' });

const LivePhotoRelinkItemSchema = z
  .object({
    photoId: z.uuidv4().describe('Still image asset ID'),
    videoId: z.uuidv4().describe('Motion video asset ID'),
  })
  .meta({ id: 'LivePhotoRelinkItemDto' });

const LivePhotoRelinkSchema = z
  .object({
    pairs: z.array(LivePhotoRelinkItemSchema).min(1).max(1000),
  })
  .meta({ id: 'LivePhotoRelinkDto' });

const LivePhotoRelinkResultSchema = z
  .object({
    photoId: z.uuidv4(),
    videoId: z.uuidv4(),
    success: z.boolean(),
    error: z.string().optional(),
  })
  .meta({ id: 'LivePhotoRelinkResultDto' });

const LivePhotoRelinkResponseSchema = z
  .object({
    results: z.array(LivePhotoRelinkResultSchema),
  })
  .meta({ id: 'LivePhotoRelinkResponseDto' });

export class LivePhotoCandidateDto extends createZodDto(LivePhotoCandidateSchema) {}
export class LivePhotoCandidatesResponseDto extends createZodDto(LivePhotoCandidatesResponseSchema) {}
export class LivePhotoRelinkDto extends createZodDto(LivePhotoRelinkSchema) {}
export class LivePhotoRelinkResponseDto extends createZodDto(LivePhotoRelinkResponseSchema) {}
