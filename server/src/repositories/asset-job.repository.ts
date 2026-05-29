import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { InjectKysely } from 'nestjs-kysely';
import { columns } from 'src/database';
import { DummyValue, GenerateSql } from 'src/decorators';
import { AssetFileType, AssetMetadataKey, AssetStatus, AssetType, AssetVisibility } from 'src/enum';
import { DB } from 'src/schema';
import {
  anyUuid,
  asUuid,
  withAudioStream,
  withDefaultVisibility,
  withEdits,
  withExif,
  withExifInner,
  withFaces,
  withFilePath,
  withFiles,
  withVideoFormat,
  withVideoStream,
} from 'src/utils/database';
import { mimeTypes } from 'src/utils/mime-types';

@Injectable()
export class AssetJobRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID] })
  getForSearchDuplicatesJob(id: string) {
    return this.db
      .selectFrom('asset')
      .where('asset.id', '=', asUuid(id))
      .leftJoin('smart_search', 'asset.id', 'smart_search.assetId')
      .select(['id', 'type', 'ownerId', 'duplicateId', 'stackId', 'visibility', 'smart_search.embedding'])
      .limit(1)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getForSidecarWriteJob(id: string) {
    return this.db
      .selectFrom('asset')
      .where('asset.id', '=', asUuid(id))
      .select(['id', 'ownerId', 'originalPath', 'physicalOriginalFileId'])
      .select((eb) => withFiles(eb, AssetFileType.Sidecar))
      .$call(withExifInner)
      .limit(1)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getForSidecarCheckJob(id: string) {
    return this.db
      .selectFrom('asset')
      .where('asset.id', '=', asUuid(id))
      .select(['id', 'ownerId', 'originalPath', 'physicalOriginalFileId'])
      .select((eb) => withFiles(eb, AssetFileType.Sidecar))
      .limit(1)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [{ force: false, fullsizeEnabled: true }], stream: true })
  streamForThumbnailJob(options: { force: boolean | undefined; fullsizeEnabled: boolean }) {
    return this.db
      .selectFrom('asset')
      .select(['asset.id', 'asset.isEdited'])
      .where('asset.deletedAt', 'is', null)
      .where('asset.visibility', '!=', sql.lit(AssetVisibility.Hidden))
      .$if(!options.force, (qb) =>
        qb
          // If there aren't any entries, metadata extraction hasn't run yet which is required for thumbnails
          .innerJoin('asset_job_status', 'asset_job_status.assetId', 'asset.id')
          .where(({ and, eb, exists, not, or, selectFrom }) => {
            const file = (type: AssetFileType) =>
              selectFrom('asset_file').whereRef('assetId', '=', 'asset.id').where('type', '=', sql.lit(type));

            const conditions = [
              not(exists(file(AssetFileType.Thumbnail))),
              not(exists(file(AssetFileType.Preview))),
              and([
                eb('asset.isEdited', '=', sql.lit(true)),
                not(exists(file(AssetFileType.FullSize).where('asset_file.isEdited', '=', sql.lit(true)))),
              ]),
              eb('asset.thumbhash', 'is', null),
            ];

            if (options.fullsizeEnabled) {
              const isWebUnsupported = sql.join(
                Object.keys(mimeTypes.webUnsupportedImage).map((ext) => sql.lit(`%${ext}`)),
              );
              conditions.push(
                and([
                  not(exists(file(AssetFileType.FullSize))),
                  eb(sql`f_unaccent(asset."originalFileName")`, 'like', sql`any(array[${isWebUnsupported}]::text[])`),
                ]),
              );
            }

            return or(conditions);
          }),
      )
      .stream();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getForMigrationJob(id: string) {
    return this.db
      .selectFrom('asset')
      .select(['asset.id', 'asset.ownerId'])
      .select(withFiles)
      .where('asset.id', '=', id)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getForGenerateThumbnailJob(id: string) {
    return this.db
      .selectFrom('asset')
      .select([
        'asset.id',
        'asset.visibility',
        'asset.originalFileName',
        'asset.originalPath',
        'asset.ownerId',
        'asset.thumbhash',
        'asset.type',
      ])
      .select((eb) =>
        jsonArrayFrom(
          eb
            .selectFrom('asset_file')
            .select(columns.assetFilesForThumbnail)
            .whereRef('asset_file.assetId', '=', 'asset.id')
            .where('asset_file.type', 'in', [AssetFileType.Thumbnail, AssetFileType.Preview, AssetFileType.FullSize]),
        ).as('files'),
      )
      .select(withEdits)
      .$call(withExifInner)
      .leftJoin('asset_video', 'asset_video.assetId', 'asset.id')
      .select((eb) => withVideoStream(eb).as('videoStream'))
      .select((eb) => withVideoFormat(eb).as('format'))
      .where('asset.id', '=', id)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getForMetadataExtraction(id: string) {
    return this.db
      .selectFrom('asset')
      .select(columns.asset)
      .select(withFaces)
      .select((eb) => withFiles(eb, AssetFileType.Sidecar))
      .where('asset.id', '=', id)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getLockedPropertiesForMetadataExtraction(assetId: string) {
    return this.db
      .selectFrom('asset_exif')
      .select('asset_exif.lockedProperties')
      .where('asset_exif.assetId', '=', assetId)
      .executeTakeFirst()
      .then((row) => row?.lockedProperties ?? []);
  }

  @GenerateSql({ params: [DummyValue.UUID, AssetFileType.Thumbnail] })
  getAlbumThumbnailFiles(id: string, fileType?: AssetFileType) {
    return this.db
      .selectFrom('asset_file')
      .select(columns.assetFiles)
      .where('asset_file.assetId', '=', id)
      .$if(!!fileType, (qb) => qb.where('asset_file.type', '=', fileType!))
      .execute();
  }

  private assetsWithPreviews() {
    return this.db
      .selectFrom('asset')
      .where('asset.visibility', '!=', AssetVisibility.Hidden)
      .where('asset.deletedAt', 'is', null)
      .innerJoin('asset_job_status as job_status', 'assetId', 'asset.id')
      .where((eb) =>
        eb.exists((qb) =>
          qb
            .selectFrom('asset_file')
            .whereRef('assetId', '=', 'asset.id')
            .where('asset_file.type', '=', AssetFileType.Preview),
        ),
      );
  }

  @GenerateSql({ params: [], stream: true })
  streamForSearchDuplicates(force?: boolean) {
    return this.db
      .selectFrom('asset')
      .select(['asset.id'])
      .where('asset.deletedAt', 'is', null)
      .innerJoin('smart_search', 'asset.id', 'smart_search.assetId')
      .$call(withDefaultVisibility)
      .$if(!force, (qb) =>
        qb
          .innerJoin('asset_job_status as job_status', 'job_status.assetId', 'asset.id')
          .where('job_status.duplicatesDetectedAt', 'is', null),
      )
      .stream();
  }

  @GenerateSql({ params: [{ force: false, frameCount: 4 }], stream: true })
  streamForVideoDuplicateFrames(options: { force?: boolean; frameCount: number }) {
    return this.db
      .selectFrom('asset')
      .leftJoin('asset_video_duplicate_frame as frame', 'frame.assetId', 'asset.id')
      .select(['asset.id'])
      .where('asset.type', '=', sql.lit(AssetType.Video))
      .where('asset.deletedAt', 'is', null)
      .where('asset.visibility', '!=', sql.lit(AssetVisibility.Hidden))
      .where('asset.visibility', '!=', sql.lit(AssetVisibility.Locked))
      .groupBy('asset.id')
      .$if(!options.force, (qb) => qb.having((eb) => eb.fn.count('frame.assetId'), '<', options.frameCount))
      .stream();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getForVideoDuplicateFrameJob(id: string) {
    return this.db
      .selectFrom('asset')
      .innerJoin('asset_video', 'asset_video.assetId', 'asset.id')
      .innerJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select(['asset.id', 'asset.ownerId', 'asset.originalPath', 'asset.visibility'])
      .select((eb) => withVideoStream(eb).$notNull().as('videoStream'))
      .select((eb) => withVideoFormat(eb).$notNull().as('format'))
      .where('asset.id', '=', id)
      .where('asset.type', '=', sql.lit(AssetType.Video))
      .executeTakeFirst();
  }

  @GenerateSql({ params: [], stream: true })
  streamForEncodeClip(force?: boolean) {
    return this.assetsWithPreviews()
      .select(['asset.id'])
      .$if(!force, (qb) =>
        qb.where((eb) => eb.not((eb) => eb.exists(eb.selectFrom('smart_search').whereRef('assetId', '=', 'asset.id')))),
      )
      .stream();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getForClipEncoding(id: string) {
    return this.db
      .selectFrom('asset')
      .select(['asset.id', 'asset.visibility', 'asset.ownerId'])
      .select((eb) => withFiles(eb, AssetFileType.Preview))
      .where('asset.id', '=', id)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getForDetectFacesJob(id: string) {
    return this.db
      .selectFrom('asset')
      .select(['asset.id', 'asset.visibility'])
      .$call(withExifInner)
      .select((eb) => withFaces(eb, true, true))
      .select((eb) => withFiles(eb, AssetFileType.Preview))
      .where('asset.id', '=', id)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getForOcr(id: string) {
    return this.db
      .selectFrom('asset')
      .select((eb) => ['asset.visibility', withFilePath(eb, AssetFileType.Preview).as('previewFile')])
      .where('asset.id', '=', id)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getForImageEnrichment(id: string) {
    return this.db
      .selectFrom('asset')
      .leftJoin('asset_exif', 'asset.id', 'asset_exif.assetId')
      .select((eb) => [
        'asset.id',
        'asset.ownerId',
        'asset.type',
        'asset.status',
        'asset.deletedAt',
        'asset.visibility',
        'asset_exif.description',
        withFilePath(eb, AssetFileType.Preview).as('previewFile'),
      ])
      .where('asset.id', '=', id)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [{ force: false, scoreVersion: 1 }], stream: true })
  streamForBestPhotosScoring(options: { force?: boolean; scoreVersion: number }) {
    return this.db
      .selectFrom('asset')
      .select(['asset.id'])
      .where('asset.type', '=', sql.lit(AssetType.Image))
      .where('asset.status', '=', sql.lit(AssetStatus.Active))
      .where('asset.deletedAt', 'is', null)
      .$call(withDefaultVisibility)
      .where((eb) =>
        eb.exists((qb) =>
          qb
            .selectFrom('asset_file')
            .whereRef('asset_file.assetId', '=', 'asset.id')
            .where('asset_file.type', '=', sql.lit(AssetFileType.Preview)),
        ),
      )
      .$if(!options.force, (qb) =>
        qb.where((eb) =>
          eb.or([
            eb.not(
              eb.exists(
                eb.selectFrom('asset_best_photo_score').whereRef('asset_best_photo_score.assetId', '=', 'asset.id'),
              ),
            ),
            eb.exists(
              eb
                .selectFrom('asset_best_photo_score')
                .whereRef('asset_best_photo_score.assetId', '=', 'asset.id')
                .where('asset_best_photo_score.scoreVersion', '<', options.scoreVersion),
            ),
          ]),
        ),
      )
      .stream();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getForBestPhotoScoring(id: string) {
    return this.db
      .selectFrom('asset')
      .select((eb) => [
        'asset.id',
        'asset.ownerId',
        'asset.type',
        'asset.status',
        'asset.deletedAt',
        'asset.visibility',
        'asset.originalFileName',
        'asset.width',
        'asset.height',
        withFilePath(eb, AssetFileType.Preview).as('previewFile'),
        sql<number>`(
          select count(*)
          from asset_face
          where asset_face."assetId" = asset.id
            and asset_face."deletedAt" is null
            and asset_face."isVisible" is true
        )`.as('faceCount'),
      ])
      .where('asset.id', '=', id)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [[DummyValue.UUID]] })
  getForSyncAssets(ids: string[]) {
    return this.db
      .selectFrom('asset')
      .select([
        'asset.id',
        'asset.isOffline',
        'asset.libraryId',
        'asset.originalPath',
        'asset.status',
        'asset.fileModifiedAt',
      ])
      .where('asset.id', '=', anyUuid(ids))
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getForAssetDeletion(id: string) {
    return this.db
      .selectFrom('asset')
      .select([
        'asset.id',
        'asset.visibility',
        'asset.libraryId',
        'asset.ownerId',
        'asset.livePhotoVideoId',
        'asset.originalPath',
        'asset.isOffline',
      ])
      .$call(withExif)
      .select(withFiles)
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom('stack')
            .whereRef('stack.id', '=', 'asset.stackId')
            .select((eb) => [
              'stack.id',
              'stack.primaryAssetId',
              jsonArrayFrom(
                eb
                  .selectFrom('asset as stack_asset')
                  .select(['stack_asset.id'])
                  .whereRef('stack_asset.stackId', '=', 'stack.id')
                  .whereRef('stack_asset.id', '!=', 'stack.primaryAssetId')
                  .where('stack_asset.visibility', '=', sql.val(AssetVisibility.Timeline))
                  .where('stack_asset.status', '!=', sql.val(AssetStatus.Deleted)),
              ).as('assets'),
            ])
            .as('stack_result'),
        (join) => join.onTrue(),
      )
      .select((eb) =>
        eb.fn
          .toJson(eb.table('stack_result'))
          .$castTo<{ id: string; primaryAssetId: string; assets: { id: string }[] } | null>()
          .as('stack'),
      )
      .where('asset.id', '=', id)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [], stream: true })
  streamForVideoConversion(force?: boolean) {
    return this.db
      .selectFrom('asset')
      .select(['asset.id'])
      .where('asset.type', '=', sql.lit(AssetType.Video))
      .$if(!force, (qb) =>
        qb
          .where((eb) =>
            eb.not(
              eb.exists(
                eb
                  .selectFrom('asset_file')
                  .select('asset_file.id')
                  .whereRef('asset_file.assetId', '=', 'asset.id')
                  .where('asset_file.type', '=', sql.lit(AssetFileType.EncodedVideo)),
              ),
            ),
          )
          .where('asset.visibility', '!=', sql.lit(AssetVisibility.Hidden)),
      )
      .where('asset.deletedAt', 'is', null)
      .stream();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getForVideoConversion(id: string) {
    return this.db
      .selectFrom('asset')
      .innerJoin('asset_exif', 'asset.id', 'asset_exif.assetId')
      .innerJoin('asset_video', 'asset_video.assetId', 'asset.id')
      .leftJoin('asset_audio', 'asset_audio.assetId', 'asset.id')
      .select(['asset.id', 'asset.ownerId', 'asset.originalPath'])
      .select(withFiles)
      .select((eb) => withAudioStream(eb).as('audioStream'))
      .select((eb) => withVideoStream(eb).$notNull().as('videoStream'))
      .select((eb) => withVideoFormat(eb).$notNull().as('format'))
      .where('asset.id', '=', id)
      .where('asset.type', '=', sql.lit(AssetType.Video))
      .executeTakeFirst();
  }

  @GenerateSql({ params: [], stream: true })
  streamForMetadataExtraction(force?: boolean) {
    return this.db
      .selectFrom('asset')
      .select(['asset.id'])
      .$if(!force, (qb) =>
        qb
          .leftJoin('asset_job_status', 'asset_job_status.assetId', 'asset.id')
          .where((eb) =>
            eb.or([eb('asset_job_status.metadataExtractedAt', 'is', null), eb('asset_job_status.assetId', 'is', null)]),
          ),
      )
      .where('asset.deletedAt', 'is', null)
      .stream();
  }

  private storageTemplateAssetQuery() {
    return this.db
      .selectFrom('asset')
      .innerJoin('asset_exif', 'asset.id', 'asset_exif.assetId')
      .select([
        'asset.id',
        'asset.ownerId',
        'asset.type',
        'asset.checksum',
        'asset.originalPath',
        'asset.physicalOriginalFileId',
        'asset.isExternal',
        'asset.visibility',
        'asset.originalFileName',
        'asset.livePhotoVideoId',
        'asset.fileCreatedAt',
        'asset_exif.timeZone',
        'asset_exif.fileSizeInByte',
        'asset_exif.make',
        'asset_exif.model',
        'asset_exif.lensModel',
      ])
      .select((eb) => withFiles(eb, AssetFileType.Sidecar))
      .where('asset.deletedAt', 'is', null);
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getForStorageTemplateJob(id: string, options?: { includeHidden?: boolean }) {
    return this.storageTemplateAssetQuery()
      .where('asset.id', '=', id)
      .$if(!options?.includeHidden, (qb) => qb.where('asset.visibility', '!=', AssetVisibility.Hidden))
      .executeTakeFirst();
  }

  @GenerateSql({ params: [], stream: true })
  streamForStorageTemplateJob() {
    return this.storageTemplateAssetQuery().where('asset.visibility', '!=', AssetVisibility.Hidden).stream();
  }

  @GenerateSql({ params: [DummyValue.DATE], stream: true })
  streamForDeletedJob(trashedBefore: Date) {
    return this.db
      .selectFrom('asset')
      .select(['id', 'isOffline'])
      .where('asset.deletedAt', '<=', trashedBefore)
      .stream();
  }

  @GenerateSql({ params: [], stream: true })
  streamForSidecar(force?: boolean) {
    return this.db
      .selectFrom('asset')
      .select(['asset.id'])
      .where('asset.status', '!=', sql.lit(AssetStatus.Deleted))
      .$if(!force, (qb) =>
        qb.where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('asset_file')
                .select('asset_file.id')
                .whereRef('asset_file.assetId', '=', 'asset.id')
                .where('asset_file.type', '=', AssetFileType.Sidecar),
            ),
          ),
        ),
      )
      .stream();
  }

  @GenerateSql({ params: [], stream: true })
  streamForDetectFacesJob(force?: boolean) {
    return this.assetsWithPreviews()
      .$if(force === false, (qb) => qb.where('job_status.facesRecognizedAt', 'is', null))
      .select(['asset.id'])
      .orderBy('asset.fileCreatedAt', 'desc')
      .stream();
  }

  @GenerateSql({ params: [], stream: true })
  streamForOcrJob(force?: boolean) {
    return this.db
      .selectFrom('asset')
      .select(['asset.id'])
      .$if(!force, (qb) =>
        qb
          .innerJoin('asset_job_status', 'asset_job_status.assetId', 'asset.id')
          .where('asset_job_status.ocrAt', 'is', null),
      )
      .where('asset.deletedAt', 'is', null)
      .where('asset.visibility', '!=', AssetVisibility.Hidden)
      .stream();
  }

  private streamForImageEnrichmentTask(force: boolean | undefined, task: 'description' | 'nsfwDetection') {
    return this.assetsWithPreviews()
      .select(['asset.id'])
      .where('asset.type', '=', sql.lit(AssetType.Image))
      .$call(withDefaultVisibility)
      .$if(!force, (qb) =>
        qb.where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('asset_metadata')
                .select('asset_metadata.assetId')
                .whereRef('asset_metadata.assetId', '=', 'asset.id')
                .where('asset_metadata.key', '=', AssetMetadataKey.MlEnrichment)
                .where(sql<string>`asset_metadata.value -> ${task} ->> 'status'`, '=', 'success'),
            ),
          ),
        ),
      )
      .orderBy('asset.fileCreatedAt', 'desc')
      .stream();
  }

  @GenerateSql({ params: [], stream: true })
  streamForImageDescriptionJob(force?: boolean) {
    // Image descriptions also run on videos that have persisted
    // duplicate-detection frames (those frames are composited into a grid that
    // feeds the single-image VLM endpoint). Videos without persisted frames
    // are excluded — the handler would skip them anyway with
    // `video-frames-unavailable`.
    return this.assetsWithPreviews()
      .select(['asset.id'])
      .$call(withDefaultVisibility)
      .where((eb) =>
        eb.or([
          eb('asset.type', '=', sql.lit(AssetType.Image)),
          eb.and([
            eb('asset.type', '=', sql.lit(AssetType.Video)),
            eb.exists((qb) =>
              qb
                .selectFrom('asset_video_duplicate_frame')
                .select('asset_video_duplicate_frame.assetId')
                .whereRef('asset_video_duplicate_frame.assetId', '=', 'asset.id'),
            ),
          ]),
        ]),
      )
      .$if(!force, (qb) =>
        qb.where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('asset_metadata')
                .select('asset_metadata.assetId')
                .whereRef('asset_metadata.assetId', '=', 'asset.id')
                .where('asset_metadata.key', '=', AssetMetadataKey.MlEnrichment)
                .where(sql<string>`asset_metadata.value -> 'description' ->> 'status'`, '=', 'success'),
            ),
          ),
        ),
      )
      .orderBy('asset.fileCreatedAt', 'desc')
      .stream();
  }

  /**
   * Stream image AND video assets that have a successfully completed description,
   * yielding the asset id, owner id, and the tag array from the description result.
   * Used by the smart-album bulk re-evaluate job.
   *
   * Videos with persisted duplicate frames are included because
   * `ImageEnrichmentService.handleImageDescription` runs on both images and
   * videos (compositing video frames into a grid for the VLM). Filtering on
   * `type = Image` would mean the admin "Re-evaluate all" button could never
   * remove or refresh video memberships in smart albums.
   */
  @GenerateSql({ params: [], stream: true })
  streamForSmartAlbumReevaluation() {
    return this.db
      .selectFrom('asset')
      .innerJoin('asset_metadata', (join) =>
        join
          .onRef('asset_metadata.assetId', '=', 'asset.id')
          .on('asset_metadata.key', '=', AssetMetadataKey.MlEnrichment),
      )
      .select([
        'asset.id',
        'asset.ownerId',
        sql<string[]>`COALESCE(asset_metadata.value -> 'description' -> 'result' -> 'tags', '[]'::jsonb)`.as('tags'),
      ])
      .where('asset.deletedAt', 'is', null)
      .$call(withDefaultVisibility)
      .where((eb) =>
        eb.exists((qb) =>
          qb
            .selectFrom('asset_file')
            .whereRef('asset_file.assetId', '=', 'asset.id')
            .where('asset_file.type', '=', sql.lit(AssetFileType.Preview)),
        ),
      )
      .where(sql<string>`asset_metadata.value -> 'description' ->> 'status'`, '=', 'success')
      .orderBy('asset.fileCreatedAt', 'desc')
      .stream();
  }

  @GenerateSql({ params: [], stream: true })
  streamForNsfwDetectionJob(force?: boolean) {
    return this.streamForImageEnrichmentTask(force, 'nsfwDetection');
  }

  @GenerateSql({ params: [DummyValue.DATE], stream: true })
  streamForMigrationJob() {
    return this.db.selectFrom('asset').select(['id']).where('asset.deletedAt', 'is', null).stream();
  }
}
