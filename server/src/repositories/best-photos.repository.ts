import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, Selectable, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators';
import { AssetStatus, AssetType, AssetVisibility } from 'src/enum';
import { DB } from 'src/schema';
import { AssetBestPhotoScoreTable } from 'src/schema/tables/asset-best-photo-score.table';
import { anyUuid, asUuid, withHiddenContentFilter } from 'src/utils/database';
import type { HiddenContentQueryOptions } from 'src/utils/hidden-content';
import { paginationHelper } from 'src/utils/pagination';

export type BestPhotoScore = Selectable<AssetBestPhotoScoreTable>;

export type BestPhotoScoreUpsert = Omit<Insertable<AssetBestPhotoScoreTable>, 'createdAt' | 'updatedAt'>;

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
  getScore(assetId: string): Promise<BestPhotoScore | undefined> {
    return this.db
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
    await this.db
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
    const query = this.db
      .selectFrom('asset_best_photo_score')
      .innerJoin('asset', 'asset.id', 'asset_best_photo_score.assetId')
      .where('asset_best_photo_score.ownerId', '=', asUuid(options.ownerId))
      .where('asset.ownerId', '=', asUuid(options.ownerId))
      .where('asset.deletedAt', 'is', null)
      .where('asset.status', '=', sql.lit(AssetStatus.Active))
      .where('asset.visibility', 'in', [
        sql.lit(AssetVisibility.Timeline),
        ...(options.includeArchived ? [sql.lit(AssetVisibility.Archive)] : []),
      ])
      .where('asset.type', '=', sql.lit(AssetType.Image))
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

    return { ...paginationHelper(items, options.limit), total: Number(count) };
  }

  @GenerateSql({ params: [[DummyValue.UUID]] })
  async deleteForAssets(assetIds: string[]): Promise<void> {
    await this.db.deleteFrom('asset_best_photo_score').where('assetId', '=', anyUuid(assetIds)).execute();
  }
}
