import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { AlbumUserRole } from 'src/enum';
import { DB } from 'src/schema';

@Injectable()
export class SmartAlbumRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  /**
   * Idempotent: for each (ownerId, kind) pair that doesn't already have a
   * smart_album row, create the backing album + album_user (owner) + smart_album
   * in a single transaction guarded by a per-(ownerId, kind) advisory lock.
   *
   * The advisory lock is required because ON CONFLICT DO NOTHING on the
   * smart_album insert silently skips the row on conflict, but the data-modifying
   * CTEs above it (new_album, new_album_owner) have already executed by then.
   * Without serialization, two concurrent callers would each create an album +
   * album_user row, only one of which ends up referenced by smart_album — the
   * other becomes orphaned. The advisory lock serializes per (ownerId, kind),
   * so the SELECT-then-INSERT path is race-safe.
   */
  async ensureForUser(ownerId: string, kinds: { kind: string; name: string }[]): Promise<void> {
    if (kinds.length === 0) {
      return;
    }

    for (const { kind, name } of kinds) {
      await this.db.transaction().execute(async (trx) => {
        // Serialize this (ownerId, kind) pair across concurrent callers. Released
        // automatically at end-of-transaction.
        await sql`SELECT pg_advisory_xact_lock(hashtext(${`${ownerId}:${kind}`}))`.execute(trx);

        const existing = await trx
          .selectFrom('smart_album')
          .select('id')
          .where('ownerId', '=', ownerId)
          .where('kind', '=', kind)
          .executeTakeFirst();

        if (existing) {
          return;
        }

        // Create backing album + album_user (owner) + smart_album in one CTE
        // chain. The final INSERT references both `new_album` and `new_album_owner`
        // so PostgreSQL is forced to execute every data-modifying CTE.
        await trx
          .with('new_album', (qb) => qb.insertInto('album').values({ albumName: name }).returning('id'))
          .with('new_album_owner', (qb) =>
            qb
              .insertInto('album_user')
              .expression((eb) =>
                eb
                  .selectFrom('new_album')
                  .select((eb) => [
                    eb.ref('new_album.id').as('albumId'),
                    sql`${ownerId}::uuid`.as('userId'),
                    sql`${AlbumUserRole.Owner}::album_user_role_enum`.as('role'),
                  ]),
              )
              .returning('albumId'),
          )
          .insertInto('smart_album')
          .columns(['albumId', 'ownerId', 'kind'])
          .expression((eb) =>
            eb
              .selectFrom('new_album_owner')
              .innerJoin('new_album', 'new_album.id', 'new_album_owner.albumId')
              .select((eb) => [
                eb.ref('new_album_owner.albumId').as('albumId'),
                sql`${ownerId}::uuid`.as('ownerId'),
                sql`${kind}`.as('kind'),
              ]),
          )
          .execute();
      });
    }
  }

  async getSmartAlbumIdForOwnerAndKind(ownerId: string, kind: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('smart_album')
      .select('id')
      .where('ownerId', '=', ownerId)
      .where('kind', '=', kind)
      .executeTakeFirst();
    return row?.id ?? null;
  }

  /**
   * Return a map of kind -> smart_album.id for all built-in kinds belonging to
   * `ownerId`. Replaces N round-trips to `getSmartAlbumIdForOwnerAndKind` with
   * a single query.
   */
  async getAllSmartAlbumIdsForOwner(ownerId: string): Promise<Map<string, string>> {
    const rows = await this.db
      .selectFrom('smart_album')
      .select(['id', 'kind'])
      .where('ownerId', '=', ownerId)
      .execute();
    return new Map(rows.map((r) => [r.kind, r.id]));
  }

  async isExcluded(smartAlbumId: string, assetId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('smart_album_exclusion')
      .select('smartAlbumId')
      .where('smartAlbumId', '=', smartAlbumId)
      .where('assetId', '=', assetId)
      .executeTakeFirst();
    return !!row;
  }

  /**
   * Return the subset of `smartAlbumIds` that have the given asset excluded.
   * Single query equivalent of calling `isExcluded` per smart album.
   */
  async getExcludedSmartAlbumIds(assetId: string, smartAlbumIds: string[]): Promise<Set<string>> {
    if (smartAlbumIds.length === 0) {
      return new Set();
    }
    const rows = await this.db
      .selectFrom('smart_album_exclusion')
      .select('smartAlbumId')
      .where('assetId', '=', assetId)
      .where('smartAlbumId', 'in', smartAlbumIds)
      .execute();
    return new Set(rows.map((r) => r.smartAlbumId));
  }

  /**
   * Add asset to smart_album_asset AND mirror into album_asset so it shows
   * up in normal album browsing. Both inserts run in a single transaction so
   * we never end up with a half-applied membership.
   */
  async addAssetToSmartAlbum(
    smartAlbumId: string,
    assetId: string,
    matchReason: 'tag' | 'clip' | 'both',
  ): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const smartAlbum = await trx
        .selectFrom('smart_album')
        .select('albumId')
        .where('id', '=', smartAlbumId)
        .executeTakeFirst();

      if (!smartAlbum) {
        return;
      }

      await trx
        .insertInto('smart_album_asset')
        .values({ smartAlbumId, assetId, matchReason })
        .onConflict((oc) => oc.doNothing())
        .execute();

      await trx
        .insertInto('album_asset')
        .values({ albumId: smartAlbum.albumId, assetId })
        .onConflict((oc) => oc.doNothing())
        .execute();
    });
  }

  /**
   * Remove asset from smart_album_asset AND from the backing album_asset.
   *
   * Wrapped in a transaction so we never leave the mirror half-applied. The
   * mirror is deleted FIRST so that, if a transaction aborts midway, the
   * remaining `smart_album_asset` row will let the next `evaluate` call
   * either re-add the mirror or remove the smart-album-asset row — i.e. the
   * orphan self-heals. Deleting in the opposite order would leave a stuck
   * `album_asset` row that no future evaluate could clean up.
   */
  async removeAssetFromSmartAlbum(smartAlbumId: string, assetId: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const smartAlbum = await trx
        .selectFrom('smart_album')
        .select('albumId')
        .where('id', '=', smartAlbumId)
        .executeTakeFirst();

      if (smartAlbum) {
        await trx
          .deleteFrom('album_asset')
          .where('albumId', '=', smartAlbum.albumId)
          .where('assetId', '=', assetId)
          .execute();
      }

      await trx
        .deleteFrom('smart_album_asset')
        .where('smartAlbumId', '=', smartAlbumId)
        .where('assetId', '=', assetId)
        .execute();
    });
  }

  /**
   * Return the smart-album kinds the asset is currently in for this owner.
   */
  async getMatchingKinds(assetId: string, ownerId: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom('smart_album_asset')
      .innerJoin('smart_album', 'smart_album.id', 'smart_album_asset.smartAlbumId')
      .select('smart_album.kind')
      .where('smart_album_asset.assetId', '=', assetId)
      .where('smart_album.ownerId', '=', ownerId)
      .execute();
    return rows.map((r) => r.kind);
  }

  /**
   * Add to smart_album_exclusion and remove from smart_album_asset + album_asset
   * atomically. Stub for PR 7 (admin UI opt-out endpoint).
   */
  async excludeAsset(smartAlbumId: string, assetId: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('smart_album_exclusion')
        .values({ smartAlbumId, assetId })
        .onConflict((oc) => oc.doNothing())
        .execute();

      const smartAlbum = await trx
        .selectFrom('smart_album')
        .select('albumId')
        .where('id', '=', smartAlbumId)
        .executeTakeFirst();

      if (smartAlbum) {
        await trx
          .deleteFrom('album_asset')
          .where('albumId', '=', smartAlbum.albumId)
          .where('assetId', '=', assetId)
          .execute();
      }

      await trx
        .deleteFrom('smart_album_asset')
        .where('smartAlbumId', '=', smartAlbumId)
        .where('assetId', '=', assetId)
        .execute();
    });
  }
}
