import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { AssetType, AssetVisibility } from 'src/enum';
import { DB } from 'src/schema';
import { asUuid } from 'src/utils/database';

export type LivePhotoCandidateRow = {
  photoId: string;
  videoId: string;
};

// A separated live photo's parts are still visible in the library (timeline or
// archive). Hidden/locked assets are intentionally excluded.
const VISIBLE_STATES = [AssetVisibility.Timeline, AssetVisibility.Archive];

// Lowercased filename with its extension stripped (e.g. `IMG_1234.HEIC` -> `img_1234`).
const filenameStem = (column: string) => sql<string>`lower(regexp_replace(${sql.ref(column)}, '\\.[^.]+$', ''))`;

@Injectable()
export class LivePhotoRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  /**
   * High-confidence candidates: a still image and a video that share Apple's
   * embedded ContentIdentifier (`asset_exif.livePhotoCID`) but are not linked.
   * This is the same key immich uses to link live photos during ingestion.
   */
  getUnlinkedByContentId(ownerId: string): Promise<LivePhotoCandidateRow[]> {
    return this.db
      .selectFrom('asset as photo')
      .innerJoin('asset_exif as photo_exif', 'photo_exif.assetId', 'photo.id')
      .innerJoin('asset_exif as video_exif', 'video_exif.livePhotoCID', 'photo_exif.livePhotoCID')
      .innerJoin('asset as video', 'video.id', 'video_exif.assetId')
      .select(['photo.id as photoId', 'video.id as videoId'])
      .where('photo.ownerId', '=', asUuid(ownerId))
      .whereRef('video.ownerId', '=', 'photo.ownerId')
      .where('photo.type', '=', AssetType.Image)
      .where('video.type', '=', AssetType.Video)
      .where('photo.livePhotoVideoId', 'is', null)
      .where('photo_exif.livePhotoCID', 'is not', null)
      .where('photo.deletedAt', 'is', null)
      .where('video.deletedAt', 'is', null)
      .where('photo.visibility', 'in', VISIBLE_STATES)
      .where('video.visibility', 'in', VISIBLE_STATES)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb.selectFrom('asset as linked').select('linked.id').whereRef('linked.livePhotoVideoId', '=', 'video.id'),
          ),
        ),
      )
      .execute();
  }

  /**
   * Low-confidence fallback for files whose ContentIdentifier was stripped: a
   * still image and a video owned by the same user that share the same filename
   * stem (e.g. `IMG_1234.HEIC` / `IMG_1234.MOV`) and were captured within
   * `windowSeconds` of each other.
   */
  getUnlinkedByFilename(ownerId: string, windowSeconds: number): Promise<LivePhotoCandidateRow[]> {
    return this.db
      .selectFrom('asset as photo')
      .innerJoin('asset as video', (join) =>
        join
          .onRef('video.ownerId', '=', 'photo.ownerId')
          .on(sql`${filenameStem('photo.originalFileName')} = ${filenameStem('video.originalFileName')}`)
          .on(
            sql`abs(extract(epoch from (${sql.ref('photo.fileCreatedAt')} - ${sql.ref('video.fileCreatedAt')}))) <= ${windowSeconds}`,
          ),
      )
      .select(['photo.id as photoId', 'video.id as videoId'])
      .where('photo.ownerId', '=', asUuid(ownerId))
      .where('photo.type', '=', AssetType.Image)
      .where('video.type', '=', AssetType.Video)
      .where('photo.livePhotoVideoId', 'is', null)
      .where('photo.deletedAt', 'is', null)
      .where('video.deletedAt', 'is', null)
      .where('photo.visibility', 'in', VISIBLE_STATES)
      .where('video.visibility', 'in', VISIBLE_STATES)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb.selectFrom('asset as linked').select('linked.id').whereRef('linked.livePhotoVideoId', '=', 'video.id'),
          ),
        ),
      )
      .execute();
  }
}
