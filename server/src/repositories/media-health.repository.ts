import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, Selectable, Updateable, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import {
  AssetFileType,
  AssetStatus,
  ChecksumAlgorithm,
  MediaHealthCategory,
  MediaHealthSeverity,
  MediaHealthStatus,
} from 'src/enum';
import { DB } from 'src/schema';
import { AssetHealthCandidateTable, AssetHealthRunTable, AssetHealthTable } from 'src/schema/tables/asset-health.table';
import { AssetTable } from 'src/schema/tables/asset.table';
import { anyUuid, asUuid } from 'src/utils/database';

export type MediaHealthRun = Selectable<AssetHealthRunTable>;
export type MediaHealthFinding = Selectable<AssetHealthTable>;
export type MediaHealthCandidate = Selectable<AssetHealthCandidateTable>;

export type MediaHealthAsset = Pick<
  Selectable<AssetTable>,
  | 'id'
  | 'updateId'
  | 'ownerId'
  | 'type'
  | 'originalPath'
  | 'originalFileName'
  | 'isExternal'
  | 'libraryId'
  | 'thumbhash'
  | 'fileCreatedAt'
  | 'fileModifiedAt'
  | 'localDateTime'
  | 'createdAt'
  | 'updatedAt'
  | 'deletedAt'
  | 'duration'
  | 'checksum'
  | 'checksumAlgorithm'
  | 'isFavorite'
  | 'visibility'
  | 'livePhotoVideoId'
  | 'stackId'
  | 'duplicateId'
  | 'status'
  | 'isOffline'
  | 'width'
  | 'height'
  | 'isEdited'
> & {
  previewPath: string | null;
  thumbnailPath: string | null;
};

export type UpsertMediaHealthFinding = Omit<
  Insertable<AssetHealthTable>,
  'id' | 'createdAt' | 'updatedAt' | 'dismissedAt' | 'resolvedAt'
> & {
  dismissedAt?: Date | null;
  resolvedAt?: Date | null;
};

export type UpsertMediaHealthCandidate = Omit<Insertable<AssetHealthCandidateTable>, 'id' | 'createdAt' | 'updatedAt'>;

@Injectable()
export class MediaHealthRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  createRun(category: MediaHealthCategory): Promise<MediaHealthRun> {
    return this.db.insertInto('asset_health_run').values({ category }).returningAll().executeTakeFirstOrThrow();
  }

  finishRun(id: string, update: Updateable<AssetHealthRunTable>): Promise<MediaHealthRun | undefined> {
    return this.db
      .updateTable('asset_health_run')
      .set({ ...update, finishedAt: update.finishedAt ?? new Date() })
      .where('id', '=', asUuid(id))
      .returningAll()
      .executeTakeFirst();
  }

  getLatestRun(category?: MediaHealthCategory): Promise<MediaHealthRun | undefined> {
    return this.db
      .selectFrom('asset_health_run')
      .selectAll()
      .$if(!!category, (qb) => qb.where('category', '=', category!))
      .orderBy('startedAt', 'desc')
      .limit(1)
      .executeTakeFirst();
  }

  list(options: {
    category?: MediaHealthCategory;
    status?: MediaHealthStatus;
    size: number;
  }): Promise<MediaHealthFinding[]> {
    return this.db
      .selectFrom('asset_health')
      .selectAll()
      .$if(!!options.category, (qb) => qb.where('category', '=', options.category!))
      .$if(!!options.status, (qb) => qb.where('status', '=', options.status!))
      .orderBy('checkedAt', 'desc')
      .limit(options.size)
      .execute();
  }

  getByIds(ids: string[]): Promise<MediaHealthFinding[]> {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }

    return this.db.selectFrom('asset_health').selectAll().where('id', '=', anyUuid(ids)).execute();
  }

  getCandidatesByHealthIds(healthIds: string[]): Promise<MediaHealthCandidate[]> {
    if (healthIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.db
      .selectFrom('asset_health_candidate')
      .selectAll()
      .where('healthId', '=', anyUuid(healthIds))
      .orderBy('visualMatchScore', 'desc')
      .execute();
  }

  async replaceCandidates(healthId: string, candidates: UpsertMediaHealthCandidate[]): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('asset_health_candidate').where('healthId', '=', asUuid(healthId)).execute();

      if (candidates.length > 0) {
        await trx.insertInto('asset_health_candidate').values(candidates).execute();
      }
    });
  }

  upsertFinding(finding: UpsertMediaHealthFinding): Promise<MediaHealthFinding> {
    return this.db
      .insertInto('asset_health')
      .values({
        dismissedAt: null,
        resolvedAt: null,
        ...finding,
      })
      .onConflict((oc) =>
        oc.columns(['assetId', 'category']).doUpdateSet((eb) => ({
          runId: eb.ref('excluded.runId'),
          status: eb.ref('excluded.status'),
          severity: eb.ref('excluded.severity'),
          originalPath: eb.ref('excluded.originalPath'),
          originalFileName: eb.ref('excluded.originalFileName'),
          evidence: eb.ref('excluded.evidence'),
          resolution: eb.ref('excluded.resolution'),
          checkedAt: eb.ref('excluded.checkedAt'),
          dismissedAt: eb.ref('excluded.dismissedAt'),
          resolvedAt: eb.ref('excluded.resolvedAt'),
        })),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async markResolved(category: MediaHealthCategory, assetId: string): Promise<void> {
    await this.db
      .updateTable('asset_health')
      .set({ status: MediaHealthStatus.Resolved, severity: MediaHealthSeverity.Info, resolvedAt: new Date() })
      .where('category', '=', category)
      .where('assetId', '=', asUuid(assetId))
      .execute();
  }

  async markDismissed(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.db
      .updateTable('asset_health')
      .set({ status: MediaHealthStatus.Dismissed, dismissedAt: new Date() })
      .where('id', '=', anyUuid(ids))
      .execute();
  }

  async markStatus(ids: string[], status: MediaHealthStatus): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.db.updateTable('asset_health').set({ status }).where('id', '=', anyUuid(ids)).execute();
  }

  async *streamAssets(options: { assetIds?: string[] } = {}): AsyncGenerator<MediaHealthAsset> {
    if (options.assetIds && options.assetIds.length === 0) {
      return;
    }

    const query = this.db
      .selectFrom('asset')
      .select([
        'asset.id',
        'asset.updateId',
        'asset.ownerId',
        'asset.type',
        'asset.originalPath',
        'asset.originalFileName',
        'asset.isExternal',
        'asset.libraryId',
        'asset.thumbhash',
        'asset.fileCreatedAt',
        'asset.fileModifiedAt',
        'asset.localDateTime',
        'asset.createdAt',
        'asset.updatedAt',
        'asset.deletedAt',
        'asset.duration',
        'asset.checksum',
        'asset.checksumAlgorithm',
        'asset.isFavorite',
        'asset.visibility',
        'asset.livePhotoVideoId',
        'asset.stackId',
        'asset.duplicateId',
        'asset.status',
        'asset.isOffline',
        'asset.width',
        'asset.height',
        'asset.isEdited',
      ])
      .select((eb) => [
        eb
          .selectFrom('asset_file')
          .select('path')
          .whereRef('asset_file.assetId', '=', 'asset.id')
          .where('type', '=', AssetFileType.Preview)
          .where('isEdited', '=', false)
          .limit(1)
          .as('previewPath'),
        eb
          .selectFrom('asset_file')
          .select('path')
          .whereRef('asset_file.assetId', '=', 'asset.id')
          .where('type', '=', AssetFileType.Thumbnail)
          .where('isEdited', '=', false)
          .limit(1)
          .as('thumbnailPath'),
      ])
      .where('asset.deletedAt', 'is', null)
      .where('asset.status', '!=', sql.lit(AssetStatus.Deleted))
      .$if(!!options.assetIds, (qb) => qb.where('asset.id', '=', anyUuid(options.assetIds!)));

    for await (const asset of query.stream()) {
      yield asset;
    }
  }

  getAssets(assetIds: string[]): Promise<MediaHealthAsset[]> {
    if (assetIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.db
      .selectFrom('asset')
      .selectAll('asset')
      .select((eb) => [
        eb
          .selectFrom('asset_file')
          .select('path')
          .whereRef('asset_file.assetId', '=', 'asset.id')
          .where('type', '=', AssetFileType.Preview)
          .where('isEdited', '=', false)
          .limit(1)
          .as('previewPath'),
        eb
          .selectFrom('asset_file')
          .select('path')
          .whereRef('asset_file.assetId', '=', 'asset.id')
          .where('type', '=', AssetFileType.Thumbnail)
          .where('isEdited', '=', false)
          .limit(1)
          .as('thumbnailPath'),
      ])
      .where('asset.id', '=', anyUuid(assetIds))
      .execute();
  }

  async relinkExternalAsset(options: {
    assetId: string;
    originalPath: string;
    originalFileName: string;
    checksum: Buffer;
    fileModifiedAt: Date;
  }): Promise<void> {
    await this.db
      .updateTable('asset')
      .set({
        originalPath: options.originalPath,
        originalFileName: options.originalFileName,
        checksum: options.checksum,
        checksumAlgorithm: ChecksumAlgorithm.sha1Path,
        fileModifiedAt: options.fileModifiedAt,
        isOffline: false,
        deletedAt: null,
        status: AssetStatus.Active,
      })
      .where('id', '=', asUuid(options.assetId))
      .where('isExternal', '=', true)
      .where('libraryId', 'is not', null)
      .execute();
  }
}
