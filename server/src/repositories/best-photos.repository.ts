import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, Selectable, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators';
import { AssetStatus, AssetType, AssetVisibility } from 'src/enum';
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
import { AssetBestPhotoScoreTable } from 'src/schema/tables/asset-best-photo-score.table';
import { AssetTable } from 'src/schema/tables/asset.table';
import { anyUuid, asUuid, withHiddenContentFilter } from 'src/utils/database';
import type { HiddenContentQueryOptions } from 'src/utils/hidden-content';
import { paginationHelper } from 'src/utils/pagination';

export type BestPhotoScore = Selectable<AssetBestPhotoScoreTable>;

export type BestPhotoScoreUpsert = Omit<Insertable<AssetBestPhotoScoreTable>, 'createdAt' | 'updatedAt'>;
type BestPhotoBackfillTables = { assetBestPhotoScore: TableVerification };
type BestPhotoAssetRow = Selectable<AssetTable> & {
  bestPhotoScore: number;
  bestPhotoAestheticScore: number | null;
  bestPhotoTechnicalScore: number | null;
  bestPhotoSubjectScore: number | null;
  bestPhotoDiversityScore: number | null;
  bestPhotoScoreVersion: number;
  bestPhotoComputedAt: Date;
  bestPhotoMetadata: Record<string, unknown> | null;
  bestPhotoBestFrameTimestampMs: number | null;
  bestPhotoFrameScore: number | null;
  bestPhotoFrameMetadata: Record<string, unknown> | null;
};

export interface BestPhotosQueryOptions extends HiddenContentQueryOptions {
  ownerId: string;
  limit: number;
  page: number;
  minScore?: number;
  includeArchived?: boolean;
}

@Injectable()
export class BestPhotosRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID] })
  async getScore(assetId: string): Promise<BestPhotoScore | undefined> {
    const phase = await getForkSchemaPhase(this.db);
    return this.db
      .withSchema(readsForkSidecar(phase) ? 'immich_fork' : 'public')
      .selectFrom('asset_best_photo_score')
      .selectAll()
      .where('assetId', '=', asUuid(assetId))
      .executeTakeFirst();
  }

  @GenerateSql({
    params: [
      {
        assetId: DummyValue.UUID,
        ownerId: DummyValue.UUID,
        score: 0.7,
        aestheticScore: 0.7,
        technicalScore: 0.7,
        subjectScore: 0.5,
        diversityScore: 0.5,
        scoreVersion: 1,
        computedAt: DummyValue.DATE,
        metadata: {},
        bestFrameTimestampMs: null,
        frameScore: null,
        frameMetadata: null,
      },
    ],
  })
  async upsertScore(score: BestPhotoScoreUpsert): Promise<void> {
    const phase = await getForkSchemaPhase(this.db);
    await this.db.transaction().execute(async (trx) => {
      if (writesForkSidecar(phase)) {
        const asset = await lockForkAssetParent(trx, score.assetId);
        if (asset.ownerId !== score.ownerId) {
          throw new Error(`Cannot write fork best-photo score with mismatched owner for asset ${score.assetId}`);
        }
      }
      if (writesLegacy(phase)) {
        await this.upsertInto(trx.withSchema('public'), score);
      }
      if (writesForkSidecar(phase)) {
        if (writesLegacy(phase)) {
          const legacy = await trx
            .withSchema('public')
            .selectFrom('asset_best_photo_score')
            .selectAll()
            .where('assetId', '=', asUuid(score.assetId))
            .executeTakeFirstOrThrow();
          await this.copyExact(trx.withSchema('immich_fork'), legacy);
        } else {
          await this.upsertInto(trx.withSchema('immich_fork'), score);
        }
      }
    });
  }

  private async upsertInto(db: Kysely<DB>, score: BestPhotoScoreUpsert): Promise<void> {
    await db
      .insertInto('asset_best_photo_score')
      .values(score)
      .onConflict((oc) =>
        oc.column('assetId').doUpdateSet(({ ref }) => ({
          ownerId: ref('excluded.ownerId'),
          score: ref('excluded.score'),
          aestheticScore: ref('excluded.aestheticScore'),
          technicalScore: ref('excluded.technicalScore'),
          subjectScore: ref('excluded.subjectScore'),
          diversityScore: ref('excluded.diversityScore'),
          scoreVersion: ref('excluded.scoreVersion'),
          computedAt: ref('excluded.computedAt'),
          metadata: ref('excluded.metadata'),
          bestFrameTimestampMs: ref('excluded.bestFrameTimestampMs'),
          frameScore: ref('excluded.frameScore'),
          frameMetadata: ref('excluded.frameMetadata'),
          updatedAt: sql`now()`,
        })),
      )
      .execute();
  }

  private async copyExact(db: Kysely<DB>, score: BestPhotoScore): Promise<void> {
    await db
      .insertInto('asset_best_photo_score')
      .values(score)
      .onConflict((oc) => oc.column('assetId').doUpdateSet(score))
      .execute();
  }

  @GenerateSql({
    params: [
      {
        ownerId: DummyValue.UUID,
        limit: 100,
        page: 1,
        minScore: 0.5,
        includeArchived: false,
      },
    ],
  })
  async getBestPhotos(options: BestPhotosQueryOptions) {
    const phase = await getForkSchemaPhase(this.db);
    const scoreSchema = readsForkSidecar(phase) ? 'immich_fork' : 'public';
    const query = (this.db as Kysely<any>)
      .selectFrom(`${scoreSchema}.asset_best_photo_score as asset_best_photo_score`)
      .innerJoin('public.asset as asset', 'asset.id', 'asset_best_photo_score.assetId')
      .where('asset_best_photo_score.ownerId', '=', asUuid(options.ownerId))
      .where('asset.ownerId', '=', asUuid(options.ownerId))
      .where('asset.deletedAt', 'is', null)
      .where('asset.status', '=', sql.lit(AssetStatus.Active))
      .where('asset.visibility', 'in', [
        sql.lit(AssetVisibility.Timeline),
        ...(options.includeArchived ? [sql.lit(AssetVisibility.Archive)] : []),
      ])
      .where('asset.type', 'in', [sql.lit(AssetType.Image), sql.lit(AssetType.Video)])
      .$if(options.minScore !== undefined, (qb) => qb.where('asset_best_photo_score.score', '>=', options.minScore!))
      .$call((qb) => withHiddenContentFilter(qb, options));

    const [{ count }, items] = await Promise.all([
      query.select((eb) => eb.fn.countAll().as('count')).executeTakeFirstOrThrow(),
      query
        .selectAll('asset')
        .select([
          'asset_best_photo_score.score as bestPhotoScore',
          'asset_best_photo_score.aestheticScore as bestPhotoAestheticScore',
          'asset_best_photo_score.technicalScore as bestPhotoTechnicalScore',
          'asset_best_photo_score.subjectScore as bestPhotoSubjectScore',
          'asset_best_photo_score.diversityScore as bestPhotoDiversityScore',
          'asset_best_photo_score.scoreVersion as bestPhotoScoreVersion',
          'asset_best_photo_score.computedAt as bestPhotoComputedAt',
          'asset_best_photo_score.metadata as bestPhotoMetadata',
          'asset_best_photo_score.bestFrameTimestampMs as bestPhotoBestFrameTimestampMs',
          'asset_best_photo_score.frameScore as bestPhotoFrameScore',
          'asset_best_photo_score.frameMetadata as bestPhotoFrameMetadata',
        ])
        .orderBy('asset_best_photo_score.score', 'desc')
        .orderBy('asset.fileCreatedAt', 'desc')
        .limit(options.limit + 1)
        .offset((options.page - 1) * options.limit)
        .execute(),
    ]);

    return { ...paginationHelper(items as BestPhotoAssetRow[], options.limit), total: Number(count) };
  }

  @GenerateSql({ params: [[DummyValue.UUID]] })
  async deleteForAssets(assetIds: string[]): Promise<void> {
    if (assetIds.length === 0) {
      return;
    }
    const phase = await getForkSchemaPhase(this.db);
    await this.db.transaction().execute(async (trx) => {
      if (writesLegacy(phase)) {
        await trx
          .withSchema('public')
          .deleteFrom('asset_best_photo_score')
          .where('assetId', '=', anyUuid(assetIds))
          .execute();
      }
      if (writesForkSidecar(phase)) {
        await trx
          .withSchema('immich_fork')
          .deleteFrom('asset_best_photo_score')
          .where('assetId', '=', anyUuid(assetIds))
          .execute();
      }
    });
  }

  async backfillScores(ids: string[]): Promise<DerivedBackfillResult<BestPhotoBackfillTables>> {
    return this.db.transaction().execute(async (trx) => {
      await sql`
        INSERT INTO immich_fork.orphaned_records ("sourceTable", "sourceKey", payload)
        SELECT 'asset_best_photo_score', score."assetId"::text, to_jsonb(score)
        FROM public.asset_best_photo_score score
        LEFT JOIN public.asset ON asset.id = score."assetId"
        WHERE asset.id IS NULL
        ON CONFLICT ("sourceTable", "sourceKey") DO UPDATE SET payload = EXCLUDED.payload
      `.execute(trx);
      if (ids.length > 0) {
        await sql`DELETE FROM immich_fork.asset_best_photo_score WHERE "assetId" = ANY(${ids}::uuid[])`.execute(trx);
        await sql`
          INSERT INTO immich_fork.asset_best_photo_score
          SELECT score.* FROM public.asset_best_photo_score score
          INNER JOIN public.asset ON asset.id = score."assetId"
          WHERE score."assetId" = ANY(${ids}::uuid[])
          ON CONFLICT ("assetId") DO UPDATE SET
            "ownerId" = EXCLUDED."ownerId", score = EXCLUDED.score,
            "aestheticScore" = EXCLUDED."aestheticScore", "technicalScore" = EXCLUDED."technicalScore",
            "subjectScore" = EXCLUDED."subjectScore", "diversityScore" = EXCLUDED."diversityScore",
            "scoreVersion" = EXCLUDED."scoreVersion", "computedAt" = EXCLUDED."computedAt",
            metadata = EXCLUDED.metadata, "bestFrameTimestampMs" = EXCLUDED."bestFrameTimestampMs",
            "frameScore" = EXCLUDED."frameScore", "frameMetadata" = EXCLUDED."frameMetadata",
            "createdAt" = EXCLUDED."createdAt", "updatedAt" = EXCLUDED."updatedAt"
        `.execute(trx);
      }
      await sql`
        DELETE FROM immich_fork.asset_best_photo_score score
        WHERE NOT EXISTS (SELECT 1 FROM public.asset WHERE asset.id = score."assetId")
      `.execute(trx);
      const rows = await sql<BestPhotoScore>`
        SELECT * FROM immich_fork.asset_best_photo_score
        WHERE "assetId" = ANY(${ids}::uuid[]) ORDER BY "assetId"::text
      `.execute(trx);
      return combineVerifications(ids.length, { assetBestPhotoScore: verifyRows(rows.rows) });
    });
  }
}
