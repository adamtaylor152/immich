import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, NotNull, Selectable, ShallowDehydrateObject, sql } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { InjectKysely } from 'nestjs-kysely';
import { columns } from 'src/database';
import { Chunked, DummyValue, GenerateSql } from 'src/decorators';
import { MapAsset } from 'src/dtos/asset-response.dto';
import { AssetType, VectorIndex } from 'src/enum';
import { probes } from 'src/repositories/database.repository';
import {
  combineVerifications,
  DerivedBackfillResult,
  getForkSchemaPhase,
  lockForkAssetParent,
  readsForkSidecar,
  TableVerification,
  verifyRows,
  writesForkSidecar,
  writesLegacy,
} from 'src/repositories/fork-derived-results';
import { DB } from 'src/schema';
import { AssetExifTable } from 'src/schema/tables/asset-exif.table';
import { AssetVideoDuplicateFrameTable } from 'src/schema/tables/asset-video-duplicate-frame.table';
import { anyUuid, asUuid, withDefaultVisibility, withHiddenContentFilter } from 'src/utils/database';
import type { HiddenContentQueryOptions } from 'src/utils/hidden-content';

// Maximum number of candidate duplicates to return from vector search
const DUPLICATE_SEARCH_LIMIT = 64;

interface DuplicateSearch {
  assetId: string;
  embedding: string;
  maxDistance: number;
  type: AssetType;
  userIds: string[];
}

interface DuplicateMergeOptions {
  targetId: string | null;
  assetIds: string[];
  sourceIds: string[];
}

type DuplicatePrivacyOptions = HiddenContentQueryOptions;
type VideoDuplicateFrameInsert = Pick<
  Insertable<AssetVideoDuplicateFrameTable>,
  'assetId' | 'frameIndex' | 'timestampMs' | 'path' | 'embedding'
>;

type VideoDuplicateFrameMatchOptions = {
  assetId: string;
  candidateAssetIds: string[];
  maxDistance: number;
  minMatchingFrames: number;
};
type VideoFrameBackfillTables = { assetVideoDuplicateFrame: TableVerification };

@Injectable()
export class DuplicateRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID, { excludeNsfw: true }] })
  getAll(userId: string, options: DuplicatePrivacyOptions = {}) {
    return (
      this.db
        .with('duplicates', (qb) =>
          qb
            .selectFrom('asset')
            .$call(withDefaultVisibility)
            // Use innerJoinLateral to build a composite object per asset that includes
            // exifInfo and tags. This "asset2" object is then aggregated via jsonAgg.
            // Tags must be included here (not via separate joins) so they appear in the
            // final MapAsset[] output - needed for tag synchronization during resolution.
            .innerJoinLateral(
              (qb) =>
                qb
                  .selectFrom('asset_exif')
                  .selectAll('asset')
                  .select((eb) =>
                    eb.fn
                      .toJson('asset_exif')
                      .$castTo<ShallowDehydrateObject<Selectable<AssetExifTable>>>()
                      .as('exifInfo'),
                  )

                  .select((eb) =>
                    jsonArrayFrom(
                      eb
                        .selectFrom('tag')
                        .select(columns.tag)
                        .innerJoin('tag_asset', 'tag.id', 'tag_asset.tagId')
                        .whereRef('tag_asset.assetId', '=', 'asset.id'),
                    ).as('tags'),
                  )
                  .whereRef('asset_exif.assetId', '=', 'asset.id')
                  .as('asset2'),
              (join) => join.onTrue(),
            )
            .select('asset.duplicateId')
            .select((eb) =>
              eb.fn.jsonAgg('asset2').orderBy('asset.localDateTime', 'asc').$castTo<MapAsset[]>().as('assets'),
            )
            .where('asset.ownerId', '=', asUuid(userId))
            .where('asset.duplicateId', 'is not', null)
            .$narrowType<{ duplicateId: NotNull }>()
            .where('asset.deletedAt', 'is', null)
            .where('asset.stackId', 'is', null)
            .$call((qb) => withHiddenContentFilter(qb, options))
            .groupBy('asset.duplicateId'),
        )
        .selectFrom('duplicates')
        .selectAll()
        // Filter out singleton groups (only 1 asset) directly in the query
        .where((eb) => eb(eb.fn('json_array_length', ['assets']), '>', 1))
        .execute()
    );
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async cleanupSingletonGroups(userId: string): Promise<void> {
    // Remove duplicateId from assets that are the only member of their duplicate group
    await this.db
      .with('singletons', (qb) =>
        qb
          .selectFrom('asset')
          .select('duplicateId')
          .where('ownerId', '=', asUuid(userId))
          .where('duplicateId', 'is not', null)
          .$narrowType<{ duplicateId: NotNull }>()
          .where('deletedAt', 'is', null)
          .where('stackId', 'is', null)
          .groupBy('duplicateId')
          .having((eb) => eb.fn.count('id'), '=', 1),
      )
      .updateTable('asset')
      .set({ duplicateId: null })
      .from('singletons')
      .whereRef('asset.duplicateId', '=', 'singletons.duplicateId')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, { excludeNsfw: true }] })
  async get(
    duplicateId: string,
    options: DuplicatePrivacyOptions = {},
  ): Promise<{ duplicateId: string; assets: MapAsset[] } | undefined> {
    const result = await this.db
      .selectFrom('asset')
      .$call(withDefaultVisibility)
      // Use innerJoinLateral to build a composite object per asset that includes
      // exifInfo and tags. This "asset2" object is then aggregated via jsonAgg.
      // Tags must be included here (not via separate joins) so they appear in the
      // final MapAsset[] output - needed for tag synchronization during resolution.
      .innerJoinLateral(
        (qb) =>
          qb
            .selectFrom('asset_exif')
            .selectAll('asset')
            .select((eb) => eb.fn.toJson('asset_exif').as('exifInfo'))
            .select((eb) =>
              jsonArrayFrom(
                eb
                  .selectFrom('tag')
                  .select(columns.tag)
                  .innerJoin('tag_asset', 'tag.id', 'tag_asset.tagId')
                  .whereRef('tag_asset.assetId', '=', 'asset.id'),
              ).as('tags'),
            )
            .whereRef('asset_exif.assetId', '=', 'asset.id')
            .as('asset2'),
        (join) => join.onTrue(),
      )
      .select('asset.duplicateId')
      .select((eb) => eb.fn.jsonAgg('asset2').orderBy('asset.localDateTime', 'asc').$castTo<MapAsset[]>().as('assets'))
      .where('asset.duplicateId', '=', asUuid(duplicateId))
      .where('asset.deletedAt', 'is', null)
      .where('asset.stackId', 'is', null)
      .$call((qb) => withHiddenContentFilter(qb, options))
      .groupBy('asset.duplicateId')
      .executeTakeFirst();

    if (!result || !result.duplicateId) {
      return;
    }

    return { duplicateId: result.duplicateId, assets: result.assets };
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async delete(userId: string, id: string): Promise<void> {
    await this.db
      .updateTable('asset')
      .set({ duplicateId: null })
      .where('ownerId', '=', userId)
      .where('duplicateId', '=', id)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  @Chunked({ paramIndex: 1 })
  async deleteAll(userId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.db
      .updateTable('asset')
      .set({ duplicateId: null })
      .where('ownerId', '=', userId)
      .where('duplicateId', 'in', ids)
      .execute();
  }

  @GenerateSql({
    params: [
      {
        assetId: DummyValue.UUID,
        embedding: DummyValue.VECTOR,
        maxDistance: 0.6,
        type: AssetType.Image,
        userIds: [DummyValue.UUID],
      },
    ],
  })
  search({ assetId, embedding, maxDistance, type, userIds }: DuplicateSearch) {
    return this.db.transaction().execute(async (trx) => {
      await sql`set local vchordrq.probes = ${sql.lit(probes[VectorIndex.Clip])}`.execute(trx);
      return await trx
        .with('cte', (qb) =>
          qb
            .selectFrom('asset')
            .$call(withDefaultVisibility)
            .select([
              'asset.id as assetId',
              'asset.duplicateId',
              sql<number>`smart_search.embedding <=> ${embedding}`.as('distance'),
            ])
            .innerJoin('smart_search', 'asset.id', 'smart_search.assetId')
            .where('asset.ownerId', '=', anyUuid(userIds))
            .where('asset.deletedAt', 'is', null)
            .where('asset.type', '=', type)
            .where('asset.id', '!=', asUuid(assetId))
            .where('asset.stackId', 'is', null)
            .orderBy('distance')
            .limit(DUPLICATE_SEARCH_LIMIT),
        )
        .selectFrom('cte')
        .selectAll()
        .where('cte.distance', '<=', maxDistance as number)
        .execute();
    });
  }

  @GenerateSql({
    params: [{ targetDuplicateId: DummyValue.UUID, duplicateIds: [DummyValue.UUID], assetIds: [DummyValue.UUID] }],
  })
  async merge(options: DuplicateMergeOptions): Promise<void> {
    await this.db
      .updateTable('asset')
      .set({ duplicateId: options.targetId })
      .where((eb) =>
        eb.or([eb('duplicateId', '=', anyUuid(options.sourceIds)), eb('id', '=', anyUuid(options.assetIds))]),
      )
      .execute();
  }

  async getVideoDuplicateFrames(assetIds: string[]) {
    if (assetIds.length === 0) {
      return [];
    }

    const phase = await getForkSchemaPhase(this.db);
    return this.db
      .withSchema(readsForkSidecar(phase) ? 'immich_fork' : 'public')
      .selectFrom('asset_video_duplicate_frame')
      .selectAll()
      .where('assetId', '=', anyUuid(assetIds))
      .orderBy('assetId')
      .orderBy('frameIndex')
      .execute();
  }

  async replaceVideoDuplicateFrames(assetId: string, frames: VideoDuplicateFrameInsert[]): Promise<string[]> {
    const phase = await getForkSchemaPhase(this.db);
    return this.db.transaction().execute(async (trx) => {
      if (frames.some((frame) => frame.assetId !== assetId)) {
        throw new Error(`Cannot replace video duplicate frames for multiple assets`);
      }
      if (writesForkSidecar(phase)) {
        await lockForkAssetParent(trx, assetId);
      }
      let stalePaths: string[] = [];
      if (writesLegacy(phase)) {
        stalePaths = await this.replaceFramesIn(trx.withSchema('public'), assetId, frames);
      }
      if (writesForkSidecar(phase)) {
        if (writesLegacy(phase)) {
          const exact = await trx
            .withSchema('public')
            .selectFrom('asset_video_duplicate_frame')
            .selectAll()
            .where('assetId', '=', asUuid(assetId))
            .execute();
          await trx
            .withSchema('immich_fork')
            .deleteFrom('asset_video_duplicate_frame')
            .where('assetId', '=', asUuid(assetId))
            .execute();
          if (exact.length > 0) {
            await trx.withSchema('immich_fork').insertInto('asset_video_duplicate_frame').values(exact).execute();
          }
        } else {
          stalePaths = await this.replaceFramesIn(trx.withSchema('immich_fork'), assetId, frames);
        }
      }
      return stalePaths;
    });
  }

  private async replaceFramesIn(
    db: Kysely<DB>,
    assetId: string,
    frames: VideoDuplicateFrameInsert[],
  ): Promise<string[]> {
    const existing = await db
      .selectFrom('asset_video_duplicate_frame')
      .select('path')
      .where('assetId', '=', asUuid(assetId))
      .execute();
    const nextPaths = new Set(frames.map(({ path }) => path));
    const stalePaths = existing.map(({ path }) => path).filter((path) => !nextPaths.has(path));

    await db.deleteFrom('asset_video_duplicate_frame').where('assetId', '=', asUuid(assetId)).execute();

    if (frames.length > 0) {
      await db.insertInto('asset_video_duplicate_frame').values(frames).execute();
    }

    return stalePaths;
  }

  async getVideoDuplicateFrameMatches({
    assetId,
    candidateAssetIds,
    maxDistance,
    minMatchingFrames,
  }: VideoDuplicateFrameMatchOptions): Promise<string[]> {
    if (candidateAssetIds.length === 0) {
      return [];
    }

    const phase = await getForkSchemaPhase(this.db);
    const framesTable = sql.raw(
      readsForkSidecar(phase) ? 'immich_fork.asset_video_duplicate_frame' : 'public.asset_video_duplicate_frame',
    );
    const { rows } = await sql<{ assetId: string }>`
      select candidate."assetId" as "assetId"
      from ${framesTable} source
      inner join ${framesTable} candidate
        on candidate."frameIndex" = source."frameIndex"
        and candidate."assetId" = ${anyUuid(candidateAssetIds)}
      where source."assetId" = ${asUuid(assetId)}
        and source."embedding" <=> candidate."embedding" <= ${maxDistance}
      group by candidate."assetId"
      having count(*) >= ${minMatchingFrames}
    `.execute(this.db);

    return rows.map(({ assetId }) => assetId);
  }

  async backfillVideoDuplicateFrames(ids: string[]): Promise<DerivedBackfillResult<VideoFrameBackfillTables>> {
    return this.db.transaction().execute(async (trx) => {
      await sql`
        INSERT INTO immich_fork.orphaned_records ("sourceTable", "sourceKey", payload)
        SELECT 'asset_video_duplicate_frame', frame."assetId"::text || ':' || frame."frameIndex"::text, to_jsonb(frame)
        FROM public.asset_video_duplicate_frame frame
        LEFT JOIN public.asset ON asset.id = frame."assetId"
        WHERE asset.id IS NULL
        ON CONFLICT ("sourceTable", "sourceKey") DO UPDATE SET payload = EXCLUDED.payload
      `.execute(trx);
      if (ids.length > 0) {
        await sql`DELETE FROM immich_fork.asset_video_duplicate_frame WHERE "assetId" = ANY(${ids}::uuid[])`.execute(
          trx,
        );
        await sql`
          INSERT INTO immich_fork.asset_video_duplicate_frame
          SELECT frame.* FROM public.asset_video_duplicate_frame frame
          INNER JOIN public.asset ON asset.id = frame."assetId"
          WHERE frame."assetId" = ANY(${ids}::uuid[])
          ON CONFLICT ("assetId", "frameIndex") DO UPDATE SET
            "timestampMs" = EXCLUDED."timestampMs", path = EXCLUDED.path, embedding = EXCLUDED.embedding,
            "createdAt" = EXCLUDED."createdAt", "updatedAt" = EXCLUDED."updatedAt"
        `.execute(trx);
      }
      await sql`
        DELETE FROM immich_fork.asset_video_duplicate_frame frame
        WHERE NOT EXISTS (SELECT 1 FROM public.asset WHERE asset.id = frame."assetId")
      `.execute(trx);
      const rows = await sql<Record<string, unknown>>`
        SELECT "assetId"::text AS "assetId", "frameIndex", "timestampMs", path, embedding::text AS embedding,
          "createdAt", "updatedAt"
        FROM immich_fork.asset_video_duplicate_frame
        WHERE "assetId" = ANY(${ids}::uuid[]) ORDER BY "assetId"::text, "frameIndex"
      `.execute(trx);
      return combineVerifications(ids.length, { assetVideoDuplicateFrame: verifyRows(rows.rows) });
    });
  }
}
