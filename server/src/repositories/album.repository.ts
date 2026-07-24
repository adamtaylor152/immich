import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ExpressionBuilder,
  Insertable,
  Kysely,
  NotNull,
  Selectable,
  ShallowDehydrateObject,
  sql,
  Updateable,
} from 'kysely';
import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/postgres';
import { InjectKysely } from 'nestjs-kysely';
import { columns } from 'src/database';
import { Chunked, ChunkedArray, ChunkedSet, DummyValue, GenerateSql } from 'src/decorators';
import { AlbumUserCreateDto, MapAlbumDto } from 'src/dtos/album.dto';
import { AlbumUserRole } from 'src/enum';
import { ForkAlbumMetadataRepository } from 'src/repositories/fork-album-metadata.repository';
import { SmartAlbumRepository } from 'src/repositories/smart-album.repository';
import { DB } from 'src/schema';
import { AlbumTable } from 'src/schema/tables/album.table';
import { AssetExifTable } from 'src/schema/tables/asset-exif.table';
import { asUuid, dummy, withDefaultVisibility, withHiddenContentFilter } from 'src/utils/database';
import type { HiddenContentQueryOptions } from 'src/utils/hidden-content';

export interface AlbumAssetCount {
  albumId: string;
  assetCount: number;
  thumbnailAssetId?: string | null;
  startDate: Date | null;
  endDate: Date | null;
  lastModifiedAssetTimestamp: Date | null;
}

export interface AlbumInfoOptions extends HiddenContentQueryOptions {
  withAssets: boolean;
}

const withAlbumUsers = (authUserId?: string) => (eb: ExpressionBuilder<DB, 'album'>) =>
  jsonArrayFrom(
    eb
      .selectFrom('album_user')
      .innerJoin('user', 'user.id', 'album_user.userId')
      .whereRef('album_user.albumId', '=', 'album.id')
      .select('album_user.role')
      .select((eb) => jsonObjectFrom(eb.selectFrom(dummy).select(columns.user)).$notNull().as('user'))
      .orderBy('album_user.role')
      .$if(!!authUserId, (qb) => qb.orderBy((eb) => eb('album_user.userId', '=', authUserId!), 'desc'))
      .orderBy('user.name', 'asc'),
  )
    .$notNull()
    .as('albumUsers');

const withSharedLink = (eb: ExpressionBuilder<DB, 'album'>) =>
  jsonArrayFrom(
    eb.selectFrom('shared_link').selectAll('shared_link').whereRef('shared_link.albumId', '=', 'album.id'),
  ).as('sharedLinks');

const withAssets = (options: AlbumInfoOptions) => (eb: ExpressionBuilder<DB, 'album'>) => {
  return eb
    .selectFrom((eb) =>
      eb
        .selectFrom('asset')
        .selectAll('asset')
        .leftJoin('asset_exif', 'asset.id', 'asset_exif.assetId')
        .select((eb) =>
          eb.table('asset_exif').$castTo<ShallowDehydrateObject<Selectable<AssetExifTable>>>().as('exifInfo'),
        )
        .innerJoin('album_asset', 'album_asset.assetId', 'asset.id')
        .whereRef('album_asset.albumId', '=', 'album.id')
        .where('asset.deletedAt', 'is', null)
        .$call(withDefaultVisibility)
        .$call((qb) => withHiddenContentFilter(qb, options))
        .orderBy('asset.fileCreatedAt', 'desc')
        .as('asset'),
    )
    .select((eb) => eb.fn.jsonAgg('asset').as('assets'))
    .as('assets');
};

const isAlbumOwned = (ownerId: string) => (eb: ExpressionBuilder<DB, 'album'>) =>
  eb.exists(
    eb
      .selectFrom('album_user')
      .whereRef('album_user.albumId', '=', 'album.id')
      .where('album_user.role', '=', AlbumUserRole.Owner)
      .where('album_user.userId', '=', ownerId),
  );

@Injectable()
export class AlbumRepository {
  private readonly forkMetadata: ForkAlbumMetadataRepository;
  private readonly smartAlbums: SmartAlbumRepository;

  constructor(@InjectKysely() private db: Kysely<DB>) {
    this.forkMetadata = new ForkAlbumMetadataRepository(db);
    this.smartAlbums = new SmartAlbumRepository(db);
  }

  @GenerateSql({ params: [DummyValue.UUID, { withAssets: true }, DummyValue.UUID] })
  async getById(id: string, options: AlbumInfoOptions, authUserId?: string) {
    const row = await this.db
      .with('album_user', (qb) => qb.selectFrom('album_user').selectAll().where('album_user.albumId', '=', id))
      .selectFrom('album')
      .selectAll('album')
      .where('album.id', '=', id)
      .where('album.deletedAt', 'is', null)
      .select(withAlbumUsers(authUserId))
      .select(withSharedLink)
      .$if(options.withAssets, (eb) => eb.select(withAssets(options)))
      .$narrowType<{ assets: NotNull }>()
      .executeTakeFirst();
    if (!row) {
      return;
    }
    const [result] = await this.forkMetadata.applyReadMetadata([row]);
    return result;
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID, { excludeNsfw: true }] })
  async getByAssetId(ownerId: string, assetId: string, options: HiddenContentQueryOptions = {}) {
    const rows = await this.db
      .selectFrom('album')
      .selectAll('album')
      .innerJoin('album_asset', 'album_asset.albumId', 'album.id')
      .$call((qb) =>
        qb.innerJoin('asset', 'asset.id', 'album_asset.assetId').$call((qb) => withHiddenContentFilter(qb, options)),
      )
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('album_user')
            .whereRef('album_user.albumId', '=', 'album.id')
            .where('album_user.userId', '=', ownerId),
        ),
      )
      .where('album_asset.assetId', '=', assetId)
      .where('album.deletedAt', 'is', null)
      .select(withAlbumUsers(ownerId))
      .orderBy('album.createdAt', 'desc')
      .execute();
    return this.forkMetadata.applyReadMetadata(rows);
  }

  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  @ChunkedSet({ paramIndex: 1 })
  async getByAssetIds(ownerId: string, assetIds: string[]): Promise<Map<string, string[]>> {
    if (assetIds.length === 0) {
      return new Map();
    }

    const results = await this.db
      .selectFrom('album')
      .select('album.id')
      .innerJoin('album_asset', 'album_asset.albumId', 'album.id')
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('album_user')
            .whereRef('album_user.albumId', '=', 'album.id')
            .where('album_user.userId', '=', ownerId),
        ),
      )
      .where('album_asset.assetId', 'in', assetIds)
      .where('album.deletedAt', 'is', null)
      .select('album_asset.assetId')
      .execute();

    // Group by assetId
    const map = new Map<string, string[]>();
    for (const row of results) {
      const existing = map.get(row.assetId) ?? [];
      existing.push(row.id);
      map.set(row.assetId, existing);
    }

    return map;
  }

  @GenerateSql({ params: [[DummyValue.UUID]] })
  @ChunkedArray()
  async getMetadataForIds(ids: string[], options: HiddenContentQueryOptions = {}): Promise<AlbumAssetCount[]> {
    // Guard against running invalid query when ids list is empty.
    if (ids.length === 0) {
      return [];
    }

    return (
      this.db
        .selectFrom('asset')
        .$call(withDefaultVisibility)
        .$call((qb) => withHiddenContentFilter(qb, options))
        .innerJoin('album_asset', 'album_asset.assetId', 'asset.id')
        .select('album_asset.albumId as albumId')
        .select((eb) => eb.fn.min(sql<Date>`("asset"."localDateTime" AT TIME ZONE 'UTC'::text)::date`).as('startDate'))
        .select((eb) => eb.fn.max(sql<Date>`("asset"."localDateTime" AT TIME ZONE 'UTC'::text)::date`).as('endDate'))
        // lastModifiedAssetTimestamp is only used in mobile app, please remove if not need
        .select((eb) => eb.fn.max('asset.updatedAt').as('lastModifiedAssetTimestamp'))
        .select(
          sql<string | null>`(array_agg("asset"."id" order by "asset"."fileCreatedAt" desc))[1]`.as('thumbnailAssetId'),
        )
        .select((eb) => sql<number>`${eb.fn.count('asset.id')}::int`.as('assetCount'))
        .where('album_asset.albumId', 'in', ids)
        .where('asset.deletedAt', 'is', null)
        .groupBy('album_asset.albumId')
        .execute()
    );
  }

  private buildAlbumBaseQuery(ownerId: string, { isOwned, isShared }: { isOwned?: boolean; isShared?: boolean }) {
    return this.db
      .selectFrom('album')
      .innerJoin('album_user', (join) =>
        join.onRef('album_user.albumId', '=', 'album.id').on('album_user.userId', '=', ownerId),
      )
      .where('album.deletedAt', 'is', null)
      .$if(isOwned === true, (qb) => qb.where('album_user.role', '=', sql.lit(AlbumUserRole.Owner)))
      .$if(isOwned === false, (qb) => qb.where('album_user.role', '!=', sql.lit(AlbumUserRole.Owner)))
      .$if(isShared !== undefined, (qb) =>
        qb.where((eb) => {
          const isSharedAlbum = eb.or([
            eb.exists(
              eb
                .selectFrom('album_user as au')
                .whereRef('au.albumId', '=', 'album.id')
                .where('au.role', '!=', sql.lit(AlbumUserRole.Owner)),
            ),
            eb.exists(eb.selectFrom('shared_link').whereRef('shared_link.albumId', '=', 'album.id')),
          ]);
          return isShared ? isSharedAlbum : eb.not(isSharedAlbum);
        }),
      );
  }

  @GenerateSql({ params: [DummyValue.UUID, { isOwned: true, isShared: true }] })
  async getAll(ownerId: string, options: { isOwned?: boolean; isShared?: boolean } = {}): Promise<MapAlbumDto[]> {
    const rows = await this.buildAlbumBaseQuery(ownerId, options)
      .selectAll('album')
      .select(withAlbumUsers(ownerId))
      .select(withSharedLink)
      .orderBy('album.sortOrder', sql`asc nulls last`)
      .orderBy('album.createdAt', 'desc')
      .execute();
    const albums = await this.forkMetadata.applyReadMetadata(rows);
    return albums.sort((left, right) => {
      if (left.sortOrder === null && right.sortOrder !== null) {
        return 1;
      }
      if (left.sortOrder !== null && right.sortOrder === null) {
        return -1;
      }
      return (left.sortOrder ?? 0) - (right.sortOrder ?? 0) || right.createdAt.getTime() - left.createdAt.getTime();
    });
  }

  @GenerateSql({ params: [DummyValue.UUID, { isOwned: true, isShared: true }] })
  async getAllIds(ownerId: string, options: { isOwned?: boolean; isShared?: boolean } = {}): Promise<string[]> {
    const rows = await this.buildAlbumBaseQuery(ownerId, options)
      .select('album.id')
      .orderBy('album.createdAt', 'desc')
      .execute();
    return rows.map((r) => r.id);
  }

  async restoreAll(userId: string): Promise<void> {
    await this.db.updateTable('album').set({ deletedAt: null }).where(isAlbumOwned(userId)).execute();
  }

  async softDeleteAll(userId: string): Promise<void> {
    await this.db.updateTable('album').set({ deletedAt: new Date() }).where(isAlbumOwned(userId)).execute();
  }

  async deleteAll(userId: string): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      const albums = await tx.selectFrom('album').select('id').where(isAlbumOwned(userId)).execute();
      await this.smartAlbums.deleteAlbums(
        albums.map(({ id }) => id),
        tx,
      );
      await this.smartAlbums.deleteOwner(userId, tx);
      await this.forkMetadata.delete(
        albums.map(({ id }) => id),
        tx,
      );
      await tx.deleteFrom('album').where(isAlbumOwned(userId)).execute();
    });
  }

  @GenerateSql({ params: [[DummyValue.UUID]] })
  @Chunked()
  async removeAssetsFromAll(assetIds: string[]): Promise<void> {
    await this.db.deleteFrom('album_asset').where('album_asset.assetId', 'in', assetIds).execute();
  }

  @Chunked({ paramIndex: 1 })
  async removeAssetIds(albumId: string, assetIds: string[]): Promise<void> {
    if (assetIds.length === 0) {
      return;
    }

    await this.db
      .deleteFrom('album_asset')
      .where('album_asset.albumId', '=', albumId)
      .where('album_asset.assetId', 'in', assetIds)
      .execute();
  }

  /**
   * Get asset IDs for the given album ID.
   *
   * @param albumId Album ID to get asset IDs for.
   * @param assetIds Optional list of asset IDs to filter on.
   * @returns Set of Asset IDs for the given album ID.
   */
  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  @ChunkedSet({ paramIndex: 1 })
  async getAssetIds(albumId: string, assetIds: string[]): Promise<Set<string>> {
    if (assetIds.length === 0) {
      return new Set();
    }

    return this.db
      .selectFrom('album_asset')
      .selectAll()
      .where('album_asset.albumId', '=', albumId)
      .where('album_asset.assetId', 'in', assetIds)
      .execute()
      .then((results) => new Set(results.map(({ assetId }) => assetId)));
  }

  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  async addAssetIds(albumId: string, assetIds: string[]): Promise<void> {
    if (assetIds.length === 0) {
      return;
    }

    await this.db
      .insertInto('album_asset')
      .expression((eb) =>
        eb.selectFrom(dummy).select([asUuid(albumId).as('albumId'), sql`unnest(${assetIds}::uuid[])`.as('assetId')]),
      )
      .onConflict((oc) => oc.doNothing())
      .execute();
  }

  @GenerateSql({
    params: [
      { albumName: DummyValue.STRING },
      [],
      [{ userId: DummyValue.UUID, role: AlbumUserRole.Owner }, DummyValue.UUID],
    ],
  })
  async create(
    album: Insertable<AlbumTable>,
    assetIds: string[],
    albumUsers: AlbumUserCreateDto[],
    authUserId: string,
  ) {
    if (!albumUsers.some((u) => u.role === AlbumUserRole.Owner)) {
      throw new Error('Album must have an owner');
    }

    const userIds = albumUsers.map((u) => u.userId);
    const roles = albumUsers.map((u) => u.role);

    return this.db.transaction().execute(async (tx) => {
      const result = await tx
        .with('album', (db) => db.insertInto('album').values(album).returningAll())
        .with('album_user', (db) =>
          db
            .insertInto('album_user')
            .expression((eb) =>
              eb
                .selectFrom('album')
                .select(({ ref }) => [
                  ref('album.id').as('albumId'),
                  sql`unnest(${userIds}::uuid[])`.as('userId'),
                  sql`unnest(${roles}::album_user_role_enum[])`.as('role'),
                ]),
            )
            .returning(['album_user.albumId', 'album_user.userId', 'album_user.role']),
        )
        .with('album_asset', (db) =>
          db
            .insertInto('album_asset')
            .expression((eb) =>
              eb
                .selectFrom('album')
                .select(({ ref }) => [ref('album.id').as('albumId'), sql`unnest(${assetIds}::uuid[])`.as('assetId')]),
            )
            .onConflict((oc) => oc.doNothing())
            .returning(['album_asset.albumId', 'album_asset.assetId']),
        )
        .selectFrom('album')
        .selectAll('album')
        .select(withAlbumUsers(authUserId))
        .select(withAssets({ withAssets: true }))
        .$narrowType<{ assets: NotNull }>()
        .executeTakeFirstOrThrow();

      // Closure table: every album is its own ancestor.
      await tx.insertInto('album_closure').values({ id_ancestor: result.id, id_descendant: result.id }).execute();

      // If parented, copy every ancestor of the parent to be an ancestor of this new node.
      if (result.parentId) {
        const newId = result.id;
        await tx
          .insertInto('album_closure')
          .columns(['id_ancestor', 'id_descendant'])
          .expression(
            tx
              .selectFrom('album_closure')
              .where('id_descendant', '=', result.parentId)
              .select(['id_ancestor', sql<string>`${newId}::uuid`.as('id_descendant')]),
          )
          .execute();
      }

      await this.forkMetadata.mirrorFromLegacy([result.id], tx);

      return result;
    });
  }

  update(id: string, album: Updateable<AlbumTable>, authUserId: string) {
    return this.db.transaction().execute(async (tx) => {
      const result = await tx
        .updateTable('album')
        .set(album)
        .where('album.id', '=', id)
        .returningAll('album')
        .returning(withSharedLink)
        .returning(withAlbumUsers(authUserId))
        .executeTakeFirstOrThrow();
      await this.forkMetadata.mirrorFromLegacy([id], tx);
      return result;
    });
  }

  async delete(id: string): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      const subtree = await tx
        .selectFrom('album_closure')
        .select('id_descendant')
        .where('id_ancestor', '=', id)
        .execute();
      const subtreeIds = subtree.length > 0 ? subtree.map(({ id_descendant }) => id_descendant) : [id];
      await this.smartAlbums.deleteAlbums(subtreeIds, tx);
      await tx.deleteFrom('album').where('id', '=', id).execute();
      await this.forkMetadata.delete(subtreeIds, tx);
    });
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getDescendantIds(id: string): Promise<Set<string>> {
    const rows = await this.db
      .selectFrom('album_closure')
      .select('id_descendant')
      .where('id_ancestor', '=', id)
      .where('id_descendant', '!=', id)
      .execute();
    return new Set(rows.map((r) => r.id_descendant));
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getAncestorIds(id: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom('album_closure')
      .select('id_ancestor')
      .where('id_descendant', '=', id)
      .where('id_ancestor', '!=', id)
      .execute();
    return rows.map((r) => r.id_ancestor);
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getDescendantCount(id: string): Promise<number> {
    const row = await this.db
      .selectFrom('album_closure')
      .select((eb) => sql<number>`${eb.fn.count('id_descendant')}::int`.as('count'))
      .where('id_ancestor', '=', id)
      .where('id_descendant', '!=', id)
      .executeTakeFirstOrThrow();
    return row.count;
  }

  /**
   * Move an album (and its entire subtree) to a new parent. Closure-table rewrite
   * uses the standard two-step algorithm:
   *   1. Delete all ancestor->descendant rows where the descendant is in the moving
   *      subtree but the ancestor is NOT (clears stale paths from the old parent chain).
   *   2. If newParentId is set, insert a row for every (oldParentAncestor, subtreeNode)
   *      pair so the subtree picks up the new chain.
   * Self-rows are preserved by step 1 (subtree ancestors are also subtree descendants).
   *
   * Cycle prevention is atomic: the descendant check below runs inside the same
   * transaction as the parent update, reading `album_closure` under the
   * transaction's snapshot. This closes the TOCTOU window that existed when the
   * caller checked descendants in a separate statement before calling reparent.
   * The DB-level `album_parent_cycle_check` trigger (migration 2100000000020) is
   * the final backstop and will abort the transaction if a concurrent writer
   * still manages to introduce a cycle.
   */
  async reparent(id: string, newParentId: string | null): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      const subtree = await tx
        .selectFrom('album_closure')
        .select('id_descendant')
        .where('id_ancestor', '=', id)
        .execute();
      if (newParentId !== null) {
        const cycle = await tx
          .selectFrom('album_closure')
          .select('id_descendant')
          .where('id_ancestor', '=', id)
          .where('id_descendant', '=', newParentId)
          .where('id_descendant', '!=', id)
          .executeTakeFirst();
        if (cycle) {
          throw new BadRequestException('Cannot move an album under one of its own descendants');
        }
      }

      await tx.updateTable('album').set({ parentId: newParentId }).where('id', '=', id).execute();

      await tx
        .deleteFrom('album_closure')
        .where('id_descendant', 'in', (eb) =>
          eb.selectFrom('album_closure as sub').select('sub.id_descendant').where('sub.id_ancestor', '=', id),
        )
        .where('id_ancestor', 'not in', (eb) =>
          eb.selectFrom('album_closure as sub2').select('sub2.id_descendant').where('sub2.id_ancestor', '=', id),
        )
        .execute();

      if (newParentId !== null) {
        await tx
          .insertInto('album_closure')
          .columns(['id_ancestor', 'id_descendant'])
          .expression(
            tx
              .selectFrom('album_closure as supertree')
              .innerJoin('album_closure as subtree', (j) => j.onTrue())
              .where('supertree.id_descendant', '=', newParentId)
              .where('subtree.id_ancestor', '=', id)
              .select(['supertree.id_ancestor as id_ancestor', 'subtree.id_descendant as id_descendant']),
          )
          .execute();
      }

      await this.forkMetadata.mirrorFromLegacy(
        subtree.map(({ id_descendant }) => id_descendant),
        tx,
      );
    });
  }

  @Chunked({ chunkSize: 30_000 })
  async addAssetIdsToAlbums(values: { albumId: string; assetId: string }[]): Promise<void> {
    if (values.length === 0) {
      return;
    }
    await this.db
      .insertInto('album_asset')
      .values(values)
      // Allow idempotent album sync without failing on existing album memberships.
      .onConflict((oc) => oc.columns(['albumId', 'assetId']).doNothing())
      .execute();
  }

  /**
   * Makes sure all thumbnails for albums are updated by:
   * - Removing thumbnails from albums without assets
   * - Removing references of thumbnails to assets outside the album
   * - Setting a thumbnail when none is set and the album contains assets
   *
   * @returns Amount of updated album thumbnails or undefined when unknown
   */
  async updateThumbnails(): Promise<number | undefined> {
    // Subquery for getting a new thumbnail.

    const result = await this.db
      .updateTable('album')
      .set((eb) => ({
        albumThumbnailAssetId: this.updateThumbnailBuilder(eb)
          .select('album_asset.assetId')
          .orderBy('asset.fileCreatedAt', 'desc')
          .limit(sql.lit(1)),
      }))
      .where((eb) =>
        eb.or([
          eb.and([
            eb('albumThumbnailAssetId', 'is', null),
            eb.exists(this.updateThumbnailBuilder(eb).select(sql`1`.as('1'))), // Has assets
          ]),
          eb.and([
            eb('albumThumbnailAssetId', 'is not', null),
            eb.not(
              eb.exists(
                this.updateThumbnailBuilder(eb)
                  .select(sql`1`.as('1'))
                  .whereRef('album.albumThumbnailAssetId', '=', 'album_asset.assetId'), // Has invalid assets
              ),
            ),
          ]),
        ]),
      )
      .execute();

    return Number(result[0].numUpdatedRows);
  }

  private updateThumbnailBuilder(eb: ExpressionBuilder<DB, 'album'>) {
    return eb
      .selectFrom('album_asset')
      .innerJoin('asset', (join) =>
        join.onRef('album_asset.assetId', '=', 'asset.id').on('asset.deletedAt', 'is', null),
      )
      .whereRef('album_asset.albumId', '=', 'album.id');
  }

  /**
   * Get per-user asset contribution counts for a single album.
   * Excludes deleted assets, orders by count desc.
   */
  @GenerateSql({ params: [DummyValue.UUID, { excludeNsfw: true }] })
  getContributorCounts(id: string, options: HiddenContentQueryOptions = {}) {
    return this.db
      .selectFrom('album_asset')
      .innerJoin('asset', 'asset.id', 'assetId')
      .where('asset.deletedAt', 'is', sql.lit(null))
      .where('album_asset.albumId', '=', id)
      .$call((qb) => withHiddenContentFilter(qb, options))
      .select('asset.ownerId as userId')
      .select((eb) => eb.fn.countAll<number>().as('assetCount'))
      .groupBy('asset.ownerId')
      .orderBy('assetCount', 'desc')
      .execute();
  }

  @GenerateSql({ params: [{ sourceAssetId: DummyValue.UUID, targetAssetId: DummyValue.UUID }] })
  async copyAlbums({ sourceAssetId, targetAssetId }: { sourceAssetId: string; targetAssetId: string }) {
    return this.db
      .insertInto('album_asset')
      .expression((eb) =>
        eb
          .selectFrom('album_asset')
          .select((eb) => ['album_asset.albumId', eb.val(targetAssetId).as('assetId')])
          .where('album_asset.assetId', '=', sourceAssetId),
      )
      .onConflict((oc) => oc.doNothing())
      .execute();
  }
}
