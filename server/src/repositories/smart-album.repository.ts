import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { createHash, randomUUID } from 'node:crypto';
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

        const existing = await this.getSmartAlbumIdForOwnerAndKind(ownerId, kind, trx);

        if (existing) {
          return;
        }

        // Create backing album + album_user (owner) + smart_album in one CTE
        // chain. The final INSERT references both `new_album` and `new_album_owner`
        // so PostgreSQL is forced to execute every data-modifying CTE.
        const phase = await this.getPhase(trx);
        const album = await trx
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
          .selectFrom('new_album_owner')
          .select('albumId')
          .executeTakeFirstOrThrow();
        if (phase === 'legacy' || phase === 'dual-write') {
          const rule = await trx
            .insertInto('smart_album')
            .values({ albumId: album.albumId, ownerId, kind })
            .returning('id')
            .executeTakeFirstOrThrow();
          if (phase === 'dual-write') {
            await this.upsertRule(rule.id, album.albumId, ownerId, kind, trx);
          }
        } else {
          await this.upsertRule(randomUUID(), album.albumId, ownerId, kind, trx);
        }
      });
    }
  }

  async getSmartAlbumIdForOwnerAndKind(
    ownerId: string,
    kind: string,
    kysely: Kysely<DB> = this.db,
  ): Promise<string | null> {
    if (await this.shouldReadSidecar(kysely)) {
      const result = await sql<{
        id: string;
      }>`SELECT id::text AS id FROM immich_fork.smart_album_rule WHERE "ownerId" = ${ownerId}::uuid AND kind = ${kind}`.execute(
        kysely,
      );
      return result.rows[0]?.id ?? null;
    }
    const row = await kysely
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
    if (await this.shouldReadSidecar()) {
      const result = await sql<{
        id: string;
        kind: string;
      }>`SELECT id::text AS id, kind FROM immich_fork.smart_album_rule WHERE "ownerId" = ${ownerId}::uuid`.execute(
        this.db,
      );
      return new Map(result.rows.map((row) => [row.kind, row.id]));
    }
    const rows = await this.db
      .selectFrom('smart_album')
      .select(['id', 'kind'])
      .where('ownerId', '=', ownerId)
      .execute();
    return new Map(rows.map((r) => [r.kind, r.id]));
  }

  async isExcluded(smartAlbumId: string, assetId: string): Promise<boolean> {
    if (await this.shouldReadSidecar()) {
      const result =
        await sql`SELECT 1 FROM immich_fork.smart_album_exclusion WHERE "smartAlbumId" = ${smartAlbumId}::uuid AND "assetId" = ${assetId}::uuid`.execute(
          this.db,
        );
      return result.rows.length > 0;
    }
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
    if (await this.shouldReadSidecar()) {
      const result = await sql<{
        smartAlbumId: string;
      }>`SELECT "smartAlbumId"::text AS "smartAlbumId" FROM immich_fork.smart_album_exclusion WHERE "assetId" = ${assetId}::uuid AND "smartAlbumId" = ANY(${smartAlbumIds}::uuid[])`.execute(
        this.db,
      );
      return new Set(result.rows.map((row) => row.smartAlbumId));
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
      const phase = await this.getPhase(trx);
      const smartAlbum = await this.getRule(smartAlbumId, trx, phase !== 'legacy' && phase !== 'dual-write');

      if (!smartAlbum) {
        return;
      }

      // ON CONFLICT (smartAlbumId, assetId) DO UPDATE so matchReason refreshes
      // when an asset that originally matched via tag is later evaluated and
      // matches via tag+clip ("both") or clip alone. The DISTINCT guard makes
      // the write a no-op when the reason hasn't changed — keeps the upsert
      // cheap and avoids bumping updatedAt-style triggers.
      if (phase === 'legacy' || phase === 'dual-write') {
        await trx
          .insertInto('smart_album_asset')
          .values({ smartAlbumId, assetId, matchReason })
          .onConflict((oc) => oc.columns(['smartAlbumId', 'assetId']).doUpdateSet({ matchReason }))
          .execute();
      }
      if (phase !== 'legacy') {
        await sql`INSERT INTO immich_fork.smart_album_match ("smartAlbumId", "assetId", "matchReason") VALUES (${smartAlbumId}::uuid, ${assetId}::uuid, ${matchReason}) ON CONFLICT ("smartAlbumId", "assetId") DO UPDATE SET "matchReason" = EXCLUDED."matchReason"`.execute(
          trx,
        );
      }

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
      const phase = await this.getPhase(trx);
      const smartAlbum = await this.getRule(smartAlbumId, trx, phase !== 'legacy' && phase !== 'dual-write');

      if (smartAlbum) {
        await trx
          .deleteFrom('album_asset')
          .where('albumId', '=', smartAlbum.albumId)
          .where('assetId', '=', assetId)
          .execute();
      }

      if (phase === 'legacy' || phase === 'dual-write') {
        await trx
          .deleteFrom('smart_album_asset')
          .where('smartAlbumId', '=', smartAlbumId)
          .where('assetId', '=', assetId)
          .execute();
      }
      if (phase !== 'legacy') {
        await sql`DELETE FROM immich_fork.smart_album_match WHERE "smartAlbumId" = ${smartAlbumId}::uuid AND "assetId" = ${assetId}::uuid`.execute(
          trx,
        );
      }
    });
  }

  /**
   * Return the smart-album kinds the asset is currently in for this owner.
   */
  async getMatchingKinds(assetId: string, ownerId: string): Promise<string[]> {
    if (await this.shouldReadSidecar()) {
      const result = await sql<{
        kind: string;
      }>`SELECT rule.kind FROM immich_fork.smart_album_match match INNER JOIN immich_fork.smart_album_rule rule ON rule.id = match."smartAlbumId" WHERE match."assetId" = ${assetId}::uuid AND rule."ownerId" = ${ownerId}::uuid`.execute(
        this.db,
      );
      return result.rows.map((row) => row.kind);
    }
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
      const phase = await this.getPhase(trx);
      const smartAlbum = await this.getRule(smartAlbumId, trx, phase !== 'legacy' && phase !== 'dual-write');
      if (!smartAlbum) {
        return;
      }
      if (phase === 'legacy' || phase === 'dual-write') {
        await trx
          .insertInto('smart_album_exclusion')
          .values({ smartAlbumId, assetId })
          .onConflict((oc) => oc.doNothing())
          .execute();
      }
      if (phase !== 'legacy') {
        await sql`INSERT INTO immich_fork.smart_album_exclusion ("smartAlbumId", "assetId") VALUES (${smartAlbumId}::uuid, ${assetId}::uuid) ON CONFLICT DO NOTHING`.execute(
          trx,
        );
      }

      await trx
        .deleteFrom('album_asset')
        .where('albumId', '=', smartAlbum.albumId)
        .where('assetId', '=', assetId)
        .execute();

      if (phase === 'legacy' || phase === 'dual-write') {
        await trx
          .deleteFrom('smart_album_asset')
          .where('smartAlbumId', '=', smartAlbumId)
          .where('assetId', '=', assetId)
          .execute();
      }
      if (phase !== 'legacy') {
        await sql`DELETE FROM immich_fork.smart_album_match WHERE "smartAlbumId" = ${smartAlbumId}::uuid AND "assetId" = ${assetId}::uuid`.execute(
          trx,
        );
      }
    });
  }

  async backfillAutomation(albumIds: string[]): Promise<{ count: number; digest: string }> {
    return this.db.transaction().execute(async (trx) => {
      const rules = await sql<{
        id: string;
        albumId: string;
        ownerId: string;
        kind: string;
      }>`SELECT id::text AS id, "albumId"::text AS "albumId", "ownerId"::text AS "ownerId", kind FROM smart_album WHERE "albumId" = ANY(${albumIds}::uuid[]) ORDER BY id::text`.execute(
        trx,
      );
      const ids = rules.rows.map((row) => row.id);
      const existing = await sql<{ id: string }>`
        SELECT id::text AS id FROM immich_fork.smart_album_rule
        WHERE "albumId" = ANY(${albumIds}::uuid[])
      `.execute(trx);
      const affectedIds = [...new Set([...ids, ...existing.rows.map((row) => row.id)])];
      await sql`DELETE FROM immich_fork.smart_album_match WHERE "smartAlbumId" = ANY(${affectedIds}::uuid[])`.execute(
        trx,
      );
      await sql`DELETE FROM immich_fork.smart_album_exclusion WHERE "smartAlbumId" = ANY(${affectedIds}::uuid[])`.execute(
        trx,
      );
      await sql`DELETE FROM immich_fork.smart_album_rule WHERE "albumId" = ANY(${albumIds}::uuid[])`.execute(trx);
      for (const row of rules.rows) {
        await this.upsertRule(row.id, row.albumId, row.ownerId, row.kind, trx);
      }
      if (ids.length > 0) {
        await sql`INSERT INTO immich_fork.smart_album_match ("smartAlbumId", "assetId", "matchReason") SELECT "smartAlbumId", "assetId", "matchReason" FROM smart_album_asset WHERE "smartAlbumId" = ANY(${ids}::uuid[]) ON CONFLICT DO NOTHING`.execute(
          trx,
        );
        await sql`INSERT INTO immich_fork.smart_album_exclusion ("smartAlbumId", "assetId") SELECT "smartAlbumId", "assetId" FROM smart_album_exclusion WHERE "smartAlbumId" = ANY(${ids}::uuid[]) ON CONFLICT DO NOTHING`.execute(
          trx,
        );
      }
      const snapshot =
        await sql`SELECT id::text AS id, "albumId"::text AS "albumId", "ownerId"::text AS "ownerId", kind FROM immich_fork.smart_album_rule WHERE "albumId" = ANY(${albumIds}::uuid[]) ORDER BY id::text`.execute(
          trx,
        );
      const matches =
        await sql`SELECT "smartAlbumId"::text AS "smartAlbumId", "assetId"::text AS "assetId", "matchReason" FROM immich_fork.smart_album_match WHERE "smartAlbumId" = ANY(${ids}::uuid[]) ORDER BY "smartAlbumId"::text, "assetId"::text`.execute(
          trx,
        );
      const exclusions =
        await sql`SELECT * FROM immich_fork.smart_album_exclusion WHERE "smartAlbumId" = ANY(${ids}::uuid[]) ORDER BY "smartAlbumId"::text, "assetId"::text`.execute(
          trx,
        );
      const digest = createHash('sha256')
        .update(JSON.stringify({ exclusions: exclusions.rows, matches: matches.rows, rules: snapshot.rows }))
        .digest('hex');
      return { count: albumIds.length, digest };
    });
  }

  async deleteAssets(assetIds: string[], kysely: Kysely<DB> = this.db): Promise<void> {
    if (assetIds.length === 0) {
      return;
    }
    await sql`DELETE FROM immich_fork.smart_album_match WHERE "assetId" = ANY(${assetIds}::uuid[])`.execute(kysely);
    await sql`DELETE FROM immich_fork.smart_album_exclusion WHERE "assetId" = ANY(${assetIds}::uuid[])`.execute(kysely);
  }

  async deleteAlbums(albumIds: string[], kysely: Kysely<DB> = this.db): Promise<void> {
    if (albumIds.length === 0) {
      return;
    }
    const rules = await sql<{ id: string }>`
      SELECT id::text AS id FROM immich_fork.smart_album_rule WHERE "albumId" = ANY(${albumIds}::uuid[])
    `.execute(kysely);
    const ids = rules.rows.map(({ id }) => id);
    if (ids.length > 0) {
      await sql`DELETE FROM immich_fork.smart_album_match WHERE "smartAlbumId" = ANY(${ids}::uuid[])`.execute(kysely);
      await sql`DELETE FROM immich_fork.smart_album_exclusion WHERE "smartAlbumId" = ANY(${ids}::uuid[])`.execute(
        kysely,
      );
    }
    await sql`DELETE FROM immich_fork.smart_album_rule WHERE "albumId" = ANY(${albumIds}::uuid[])`.execute(kysely);
  }

  async deleteOwner(ownerId: string, kysely: Kysely<DB> = this.db): Promise<void> {
    const rules = await sql<{ albumId: string }>`
      SELECT "albumId"::text AS "albumId" FROM immich_fork.smart_album_rule WHERE "ownerId" = ${ownerId}::uuid
    `.execute(kysely);
    await this.deleteAlbums(
      rules.rows.map(({ albumId }) => albumId),
      kysely,
    );
  }

  private async shouldReadSidecar(kysely: Kysely<DB> = this.db) {
    const phase = await this.getPhase(kysely);
    return phase !== 'legacy' && phase !== 'dual-write';
  }
  private async getPhase(kysely: Kysely<DB>) {
    const exists = await sql<{ table: string | null }>`SELECT to_regclass('immich_fork.state')::text AS table`.execute(
      kysely,
    );
    if (!exists.rows[0]?.table) {
      return 'legacy';
    }
    const result = await sql<{ phase: string }>`SELECT phase FROM immich_fork.state WHERE id = 1`.execute(kysely);
    return result.rows[0]?.phase ?? 'inactive';
  }
  private async upsertRule(id: string, albumId: string, ownerId: string, kind: string, kysely: Kysely<DB>) {
    await sql`INSERT INTO immich_fork.smart_album_rule (id, "albumId", "ownerId", kind) VALUES (${id}::uuid, ${albumId}::uuid, ${ownerId}::uuid, ${kind}) ON CONFLICT (id) DO UPDATE SET "albumId" = EXCLUDED."albumId", "ownerId" = EXCLUDED."ownerId", kind = EXCLUDED.kind`.execute(
      kysely,
    );
  }
  private async getRule(id: string, kysely: Kysely<DB>, sidecar: boolean): Promise<{ albumId: string } | undefined> {
    if (sidecar) {
      const result = await sql<{
        albumId: string;
      }>`SELECT "albumId"::text AS "albumId" FROM immich_fork.smart_album_rule WHERE id = ${id}::uuid`.execute(kysely);
      return result.rows[0];
    }
    return kysely.selectFrom('smart_album').select('albumId').where('id', '=', id).executeTakeFirst();
  }
}
