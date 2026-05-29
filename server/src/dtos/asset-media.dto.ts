import { createZodDto } from 'nestjs-zod';
import { HistoryBuilder } from 'src/decorators';
import { AssetMetadataUpsertItemSchema } from 'src/dtos/asset.dto';
import { AssetVisibilitySchema } from 'src/enum';
import { isoDatetimeToDate, JsonParsed, stringToBool } from 'src/validation';
import z from 'zod';

export enum AssetMediaSize {
  Original = 'original',
  /**
   * An full-sized image extracted/converted from non-web-friendly formats like RAW/HIF.
   * or otherwise the original image itself.
   */
  FULLSIZE = 'fullsize',
  PREVIEW = 'preview',
  THUMBNAIL = 'thumbnail',
}

const AssetMediaSizeSchema = z.enum(AssetMediaSize).describe('Asset media size').meta({ id: 'AssetMediaSize' });

const AssetMediaOptionsSchema = z
  .object({
    size: AssetMediaSizeSchema.optional().meta(
      new HistoryBuilder()
        .updated('v3', "Specifying 'original' is deprecated. Use the original endpoint directly instead")
        .getExtensions(),
    ),
    edited: stringToBool.default(false).optional().describe('Return edited asset if available'),
  })
  .meta({ id: 'AssetMediaOptionsDto' });

export enum UploadFieldName {
  ASSET_DATA = 'assetData',
  SIDECAR_DATA = 'sidecarData',
  PROFILE_DATA = 'file',
}

// Fork-only: legacy clients (immich-go, pre-3.0 mobile) send `duration` as an
// `hh:mm:ss[.SSSSSS]` string instead of integer milliseconds. Convert that
// shape here so the rest of the chain (.int().min(0)) sees a number.
// SECURITY (security.md L4): hours and fractional-seconds parts are bounded
// to a sane upper digit count so a pathological multi-megabyte input string
// is rejected at regex time rather than coerced into Number().
const hmsToMillisecondsPreprocess = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 64) {
    return value;
  }
  const match = /^(\d{1,6}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) {
    return value;
  }
  const milli = match[4] ? Number(match[4].padEnd(3, '0').slice(0, 3)) : 0;
  return Number(match[1]) * 3_600_000 + Number(match[2]) * 60_000 + Number(match[3]) * 1000 + milli;
};

const AssetMediaBaseSchema = z.object({
  fileCreatedAt: isoDatetimeToDate.describe('File creation date'),
  fileModifiedAt: isoDatetimeToDate.describe('File modification date'),
  duration: z
    .preprocess(hmsToMillisecondsPreprocess, z.coerce.number().int().min(0))
    .optional()
    .describe('Duration in milliseconds (for videos)'),
  filename: z.string().optional().describe('Filename'),
  /** The properties below are added to correctly generate the API docs and client SDKs. Validation should be handled in the controller. */
  [UploadFieldName.ASSET_DATA]: z.any().describe('Asset file data').meta({ type: 'string', format: 'binary' }),
});

const AssetMediaCreateSchema = AssetMediaBaseSchema.extend({
  isFavorite: stringToBool.optional().describe('Mark as favorite'),
  visibility: AssetVisibilitySchema.optional(),
  livePhotoVideoId: z.uuidv4().optional().describe('Live photo video ID'),
  metadata: JsonParsed.pipe(z.array(AssetMetadataUpsertItemSchema)).optional().describe('Asset metadata items'),
  [UploadFieldName.SIDECAR_DATA]: z
    .any()
    .optional()
    .describe('Sidecar file data')
    .meta({ type: 'string', format: 'binary' }),
}).meta({ id: 'AssetMediaCreateDto' });

const AssetBulkUploadCheckItemSchema = z
  .object({
    id: z.string().describe('Asset ID'),
    checksum: z
      .string()
      .describe(
        'Base64 or hex encoded checksum. SHA-256 (32 bytes / 64 hex / 44 base64) for new uploads; SHA-1 (20 bytes / 40 hex / 28 base64) accepted for legacy assets.',
      ),
  })
  .meta({ id: 'AssetBulkUploadCheckItem' });

const AssetBulkUploadCheckSchema = z
  .object({
    assets: z.array(AssetBulkUploadCheckItemSchema).describe('Assets to check'),
  })
  .meta({ id: 'AssetBulkUploadCheckDto' });

export class AssetMediaOptionsDto extends createZodDto(AssetMediaOptionsSchema) {}
export class AssetMediaCreateDto extends createZodDto(AssetMediaCreateSchema) {}
export class AssetBulkUploadCheckDto extends createZodDto(AssetBulkUploadCheckSchema) {}
