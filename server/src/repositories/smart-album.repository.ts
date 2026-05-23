import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DB } from 'src/schema';

@Injectable()
export class SmartAlbumRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  /**
   * Idempotent: for each (ownerId, kind) pair that doesn't already have a
   * smart_album row, create a backing album + smart_album in a single CTE.
   */
  async ensureForUser(ownerId: string, kinds: { kind: string; name: string }[]): Promise<void> {
    if (kinds.length === 0) {
      return;
    }

    for (const { kind, name } of kinds) {
      const existing = await this.db
        .selectFrom('smart_album')
        .select('id')
        .where('ownerId', '=', ownerId)
        .where('kind', '=', kind)
        .executeTakeFirst();

      if (existing) {
        continue;
      }

      // Create the backing album and smart_album row in one CTE.
      await this.db
        .with('new_album', (qb) =>
          qb
            .insertInto('album')
            .values({ albumName: name })
            .returning('id'),
        )
        .with('new_album_owner', (qb) =>
          qb
            .insertInto('album_user')
            .expression((eb) =>
              eb
                .selectFrom('new_album')
                .select((eb) => [
                  eb.ref('new_album.id').as('albumId'),
                  sql`${ownerId}::uuid`.as('userId'),
                  sql`${'owner'}::album_user_role_enum`.as('role'),
                ]),
            )
            .returning('albumId'),
        )
        .insertInto('smart_album')
        .expression((eb) =>
          eb
            .selectFrom('new_album')
            .select((eb) => [
              eb.ref('new_album.id').as('albumId'),
              sql`${ownerId}::uuid`.as('ownerId'),
              sql`${kind}`.as('kind'),
            ]),
        )
        .execute();
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
   * Add asset to smart_album_asset AND mirror into album_asset so it shows
   * up in normal album browsing. Both inserts are ON CONFLICT DO NOTHING.
   */
  async addAssetToSmartAlbum(
    smartAlbumId: string,
    assetId: string,
    matchReason: 'tag' | 'clip' | 'both',
  ): Promise<void> {
    const smartAlbum = await this.db
      .selectFrom('smart_album')
      .select('albumId')
      .where('id', '=', smartAlbumId)
      .executeTakeFirst();

    if (!smartAlbum) {
      return;
    }

    await this.db
      .insertInto('smart_album_asset')
      .values({ smartAlbumId, assetId, matchReason })
      .onConflict((oc) => oc.doNothing())
      .execute();

    await this.db
      .insertInto('album_asset')
      .values({ albumId: smartAlbum.albumId, assetId })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }

  /**
   * Remove asset from smart_album_asset AND from the backing album_asset.
   */
  async removeAssetFromSmartAlbum(smartAlbumId: string, assetId: string): Promise<void> {
    const smartAlbum = await this.db
      .selectFrom('smart_album')
      .select('albumId')
      .where('id', '=', smartAlbumId)
      .executeTakeFirst();

    await this.db
      .deleteFrom('smart_album_asset')
      .where('smartAlbumId', '=', smartAlbumId)
      .where('assetId', '=', assetId)
      .execute();

    if (smartAlbum) {
      await this.db
        .deleteFrom('album_asset')
        .where('albumId', '=', smartAlbum.albumId)
        .where('assetId', '=', assetId)
        .execute();
    }
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
   * Add to smart_album_exclusion and remove from smart_album_asset + album_asset.
   * Stub for PR 7 (admin UI opt-out endpoint).
   */
  async excludeAsset(smartAlbumId: string, assetId: string): Promise<void> {
    await this.db
      .insertInto('smart_album_exclusion')
      .values({ smartAlbumId, assetId })
      .onConflict((oc) => oc.doNothing())
      .execute();

    await this.removeAssetFromSmartAlbum(smartAlbumId, assetId);
  }
}
