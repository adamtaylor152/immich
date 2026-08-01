import { ShallowDehydrateObject } from 'kysely';
import { createZodDto } from 'nestjs-zod';
import { ALBUM_ICON_KEYS } from 'src/constants/album-icons';
import { AlbumUser, AuthSharedLink } from 'src/database';
import { HistoryBuilder } from 'src/decorators';
import { BulkIdErrorReasonSchema } from 'src/dtos/asset-ids.response.dto';
import { MapAsset } from 'src/dtos/asset-response.dto';
import { UserResponseSchema, mapUser } from 'src/dtos/user.dto';
import { AlbumUserRole, AlbumUserRoleSchema, AssetOrder, AssetOrderSchema } from 'src/enum';
import { MaybeDehydrated } from 'src/types';
import { asDateTimeString } from 'src/utils/date';
import { stringToBool } from 'src/validation';
import z from 'zod';

// Constrain icon to the finite catalog of valid keys (kept in sync with
// web/src/lib/utils/album-icons.ts). Unknown values are rejected at the API
// boundary instead of being stored and echoed back verbatim.
//
// Enforced at runtime via refine (not z.enum) so the generated OpenAPI/SDK/Dart
// wire type stays `string`: a nominal enum would force a coordinated codegen
// bump across every client. Runtime validation still rejects invalid keys,
// which is the data-integrity goal of the constraint.
const ALBUM_ICON_KEY_SET: ReadonlySet<string> = new Set(ALBUM_ICON_KEYS);
const AlbumIconKeySchema = z
  .string()
  .refine((value) => ALBUM_ICON_KEY_SET.has(value), { message: 'Invalid album icon key' });

const AlbumUserAddSchema = z
  .object({
    userId: z.uuidv4().describe('User ID'),
    role: AlbumUserRoleSchema.default(AlbumUserRole.Editor).optional().describe('Album user role'),
  })
  .meta({ id: 'AlbumUserAddDto' });

const AddUsersSchema = z
  .object({
    albumUsers: z.array(AlbumUserAddSchema).min(1).describe('Album users to add'),
  })
  .meta({ id: 'AddUsersDto' });

const AlbumUserCreateSchema = z
  .object({
    userId: z.uuidv4().describe('User ID'),
    role: AlbumUserRoleSchema,
  })
  .meta({ id: 'AlbumUserCreateDto' });

const CreateAlbumSchema = z
  .object({
    albumName: z.string().describe('Album name'),
    // TODO: drop the empty-string-to-null transform in v4 (clients should send null)
    description: z
      .string()
      .nullable()
      .transform((value) => (value === '' ? null : value))
      .optional()
      .describe('Album description')
      .meta({
        ...new HistoryBuilder()
          .added('v1')
          .updated(
            'v3',
            'Sending an empty string is deprecated; send null instead. Empty strings will no longer be coerced to null in v4.',
          )
          .getExtensions(),
      }),
    albumUsers: z.array(AlbumUserCreateSchema).optional().describe('Album users'),
    assetIds: z.array(z.uuidv4()).optional().describe('Initial asset IDs'),
    parentId: z.uuidv4().optional().describe('Parent album ID for nesting (omit for top-level)'),
    icon: AlbumIconKeySchema.optional().describe('Optional icon key (see album-icons.ts)'),
  })
  .meta({ id: 'CreateAlbumDto' });

const AlbumsAddAssetsSchema = z
  .object({
    albumIds: z.array(z.uuidv4()).describe('Album IDs'),
    assetIds: z.array(z.uuidv4()).describe('Asset IDs'),
  })
  .meta({ id: 'AlbumsAddAssetsDto' });

const AlbumsAddAssetsResponseSchema = z
  .object({
    success: z.boolean().describe('Operation success'),
    error: BulkIdErrorReasonSchema.optional(),
  })
  .meta({ id: 'AlbumsAddAssetsResponseDto' });

const UpdateAlbumSchema = z
  .object({
    albumName: z.string().optional().describe('Album name'),
    // TODO: drop the empty-string-to-null transform in v4 (clients should send null)
    description: z
      .string()
      .nullable()
      .transform((value) => (value === '' ? null : value))
      .optional()
      .describe('Album description')
      .meta({
        ...new HistoryBuilder()
          .added('v1')
          .updated(
            'v3',
            'Sending an empty string is deprecated; send null instead. Empty strings will no longer be coerced to null in v4.',
          )
          .getExtensions(),
      }),
    albumThumbnailAssetId: z.uuidv4().optional().describe('Album thumbnail asset ID'),
    isActivityEnabled: z.boolean().optional().describe('Enable activity feed'),
    order: AssetOrderSchema.optional(),
    parentId: z
      .uuidv4()
      .nullable()
      .optional()
      .describe('Parent album ID for nesting (null = move to top-level, omit = no change)'),
    icon: AlbumIconKeySchema.nullable().optional().describe('Icon key (null = clear / use default folder icon)'),
    sortOrder: z
      .number()
      .optional()
      .describe('Sibling display position. Lower values appear first. Computed by the client as a midpoint.'),
  })
  .meta({ id: 'UpdateAlbumDto' });

const GetAlbumsSchema = z
  .object({
    id: z.uuidv4().optional().describe('Album ID'),
    name: z.string().optional().describe('Album name (exact match)'),
    isOwned: stringToBool
      .optional()
      .describe('Filter by ownership: true = only owned, false = only shared-with-me, undefined = no filter'),
    isShared: stringToBool
      .optional()
      .describe('Filter by shared status: true = only shared, false = not shared, undefined = no filter'),
    assetId: z.uuidv4().optional().describe('Filter albums containing this asset ID (ignores other parameters)'),
    suppressedOnly: stringToBool.optional().describe('Return album metadata for suppressed content only'),
  })
  .meta({ id: 'GetAlbumsDto' });

const GetAlbumInfoSchema = z
  .object({
    suppressedOnly: stringToBool.optional().describe('Return album metadata for suppressed content only'),
  })
  .meta({ id: 'GetAlbumInfoDto' });

const AlbumStatisticsResponseSchema = z
  .object({
    owned: z.int().min(0).describe('Number of owned albums'),
    shared: z.int().min(0).describe('Number of shared albums'),
    notShared: z.int().min(0).describe('Number of non-shared albums'),
  })
  .meta({ id: 'AlbumStatisticsResponseDto' });

const UpdateAlbumUserSchema = z
  .object({
    role: AlbumUserRoleSchema,
  })
  .meta({ id: 'UpdateAlbumUserDto' });

const AlbumUserResponseSchema = z
  .object({
    user: UserResponseSchema,
    role: AlbumUserRoleSchema,
  })
  .meta({ id: 'AlbumUserResponseDto' });

const ContributorCountResponseSchema = z
  .object({
    userId: z.uuidv4().describe('User ID'),
    assetCount: z.int().min(0).describe('Number of assets contributed'),
  })
  .meta({ id: 'ContributorCountResponseDto' });

export const AlbumResponseSchema = z
  .object({
    id: z.uuidv4().describe('Album ID'),
    albumName: z.string().describe('Album name'),
    description: z
      .string()
      .describe('Album description')
      .meta({
        ...new HistoryBuilder()
          .added('v1')
          .updated(
            'v3',
            'An empty string is returned instead of null for backwards compatibility; null will be returned in v4.',
          )
          .getExtensions(),
      }),
    // TODO: use `isoDatetimeToDate` when using `ZodSerializerDto` on the controllers.
    createdAt: z.string().meta({ format: 'date-time' }).describe('Creation date'),
    // TODO: use `isoDatetimeToDate` when using `ZodSerializerDto` on the controllers.
    updatedAt: z.string().meta({ format: 'date-time' }).describe('Last update date'),
    albumThumbnailAssetId: z.uuidv4().nullable().describe('Thumbnail asset ID'),
    shared: z.boolean().describe('Is shared album'),
    albumUsers: z
      .array(AlbumUserResponseSchema)
      .min(1)
      .describe(
        'First entry is always the album owner. Second entry is the auth user, if it differs from the owner. The rest are ordered alphabetically.',
      ),
    hasSharedLink: z.boolean().describe('Has shared link'),
    assetCount: z.int().min(0).describe('Number of assets'),
    // TODO: use `isoDatetimeToDate` when using `ZodSerializerDto` on the controllers.
    lastModifiedAssetTimestamp: z
      .string()
      .meta({ format: 'date-time' })
      .optional()
      .describe('Last modified asset timestamp'),
    // TODO: use `isoDatetimeToDate` when using `ZodSerializerDto` on the controllers.
    startDate: z.string().meta({ format: 'date-time' }).optional().describe('Start date (earliest asset)'),
    // TODO: use `isoDatetimeToDate` when using `ZodSerializerDto` on the controllers.
    endDate: z.string().meta({ format: 'date-time' }).optional().describe('End date (latest asset)'),
    isActivityEnabled: z.boolean().describe('Activity feed enabled'),
    order: AssetOrderSchema.optional(),
    contributorCounts: z.array(ContributorCountResponseSchema).optional(),
    parentId: z.string().nullable().describe('Parent album ID for nesting (null = top-level)'),
    // Deliberately tolerant on read: a value stored before the enum was enforced
    // (or written directly to the DB) must not break album reads. Writes are
    // constrained via AlbumIconKeySchema on create/update.
    icon: z.string().nullable().describe('Icon key (null = default folder icon)'),
    sortOrder: z.number().nullable().describe('Sibling display position. Lower values appear first.'),
  })
  .meta({ id: 'AlbumResponseDto' });

const AlbumDescendantCountResponseSchema = z
  .object({
    count: z.int().min(0).describe('Number of descendant albums (children, grandchildren, etc.)'),
  })
  .meta({ id: 'AlbumDescendantCountResponseDto' });

const AlbumUserParamSchema = z.object({
  id: z.uuidv4().describe('Album ID'),
  // TODO: disallow 'me' as a shortcut in v4 and type userId as uuidv4
  userId: z
    .string()
    .refine((value) => value === 'me' || z.uuidv4().safeParse(value).success, {
      error: 'Must be a UUID v4 or "me"',
    })
    .describe('Album user ID, or "me" to reference the current user.')
    .meta(new HistoryBuilder().updated('v3', '"me" as a value is deprecated').getExtensions()),
});

export class AlbumUserParamDto extends createZodDto(AlbumUserParamSchema) {}
export class AddUsersDto extends createZodDto(AddUsersSchema) {}
export class AlbumUserCreateDto extends createZodDto(AlbumUserCreateSchema) {}
export class CreateAlbumDto extends createZodDto(CreateAlbumSchema) {}
export class AlbumsAddAssetsDto extends createZodDto(AlbumsAddAssetsSchema) {}
export class AlbumsAddAssetsResponseDto extends createZodDto(AlbumsAddAssetsResponseSchema) {}
export class UpdateAlbumDto extends createZodDto(UpdateAlbumSchema) {}
export class GetAlbumsDto extends createZodDto(GetAlbumsSchema) {}
export class GetAlbumInfoDto extends createZodDto(GetAlbumInfoSchema) {}
export class AlbumStatisticsResponseDto extends createZodDto(AlbumStatisticsResponseSchema) {}
export class UpdateAlbumUserDto extends createZodDto(UpdateAlbumUserSchema) {}
export class AlbumResponseDto extends createZodDto(AlbumResponseSchema) {}
export class AlbumDescendantCountResponseDto extends createZodDto(AlbumDescendantCountResponseSchema) {}
class AlbumUserResponseDto extends createZodDto(AlbumUserResponseSchema) {}

export type MapAlbumDto = {
  albumUsers?: AlbumUser[];
  assets?: ShallowDehydrateObject<MapAsset>[];
  sharedLinks?: ShallowDehydrateObject<AuthSharedLink>[];
  albumName: string;
  description: string | null;
  albumThumbnailAssetId: string | null;
  createdAt: Date;
  updatedAt: Date;
  id: string;
  isActivityEnabled: boolean;
  order: AssetOrder;
  parentId: string | null;
  icon: string | null;
  sortOrder: number | null;
};

export const mapAlbum = (entity: MaybeDehydrated<MapAlbumDto>): AlbumResponseDto => {
  const albumUsers: AlbumUserResponseDto[] = [];

  if (entity.albumUsers) {
    for (const albumUser of entity.albumUsers) {
      const user = mapUser(albumUser.user);
      albumUsers.push({
        user,
        role: albumUser.role,
      });
    }
  }

  const assets = entity.assets || [];

  const hasSharedLink = !!entity.sharedLinks && entity.sharedLinks.length > 0;
  const hasSharedUser = albumUsers.length > 1;

  let startDate = assets.at(0)?.localDateTime;
  let endDate = assets.at(-1)?.localDateTime;
  // Swap dates if start date is greater than end date.
  if (startDate && endDate && startDate > endDate) {
    [startDate, endDate] = [endDate, startDate];
  }

  return {
    albumName: entity.albumName,
    // TODO: return null instead of '' in v4
    description: entity.description ?? '',
    albumThumbnailAssetId: entity.albumThumbnailAssetId,
    createdAt: asDateTimeString(entity.createdAt),
    updatedAt: asDateTimeString(entity.updatedAt),
    id: entity.id,
    albumUsers,
    shared: hasSharedUser || hasSharedLink,
    hasSharedLink,
    startDate: asDateTimeString(startDate),
    endDate: asDateTimeString(endDate),
    assetCount: entity.assets?.length || 0,
    isActivityEnabled: entity.isActivityEnabled,
    order: entity.order,
    parentId: entity.parentId,
    icon: entity.icon,
    sortOrder: entity.sortOrder,
  };
};
