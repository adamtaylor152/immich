import { Kysely, sql } from 'kysely';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { ForkAlbumMetadataRepository } from 'src/repositories/fork-album-metadata.repository';
import { ForkPrivacyRepository } from 'src/repositories/fork-privacy.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { mediumFactory } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

describe('privacy and album fork sidecars', () => {
  let db: Kysely<DB>;

  beforeAll(async () => {
    db = await getKyselyDB('privacy_album_backfill');
    const databaseRepository = new DatabaseRepository(db, LoggingRepository.create(), new ConfigRepository());
    await databaseRepository.runForkMigrations();
  }, 120_000);

  beforeEach(async () => {
    await sql`TRUNCATE immich_fork.album_closure, immich_fork.album_metadata, immich_fork.asset_privacy`.execute(db);
    await sql`UPDATE immich_fork.state SET phase = 'inactive', active = false WHERE id = 1`.execute(db);
    await db.deleteFrom('album').execute();
    await db.deleteFrom('asset').execute();
    await db.deleteFrom('user').execute();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('creates fork-owned privacy and album sidecars without upstream foreign keys', async () => {
    const tables = await sql<{ tableName: string }>`
      SELECT table_name AS "tableName"
      FROM information_schema.tables
      WHERE table_schema = 'immich_fork'
        AND table_name IN ('asset_privacy', 'album_metadata', 'album_closure')
      ORDER BY table_name
    `.execute(db);
    const foreignKeys = await sql<{ count: number }>`
      SELECT count(*)::int AS count
      FROM information_schema.table_constraints
      WHERE table_schema = 'immich_fork'
        AND table_name IN ('asset_privacy', 'album_metadata', 'album_closure')
        AND constraint_type = 'FOREIGN KEY'
    `.execute(db);

    expect(tables.rows.map(({ tableName }) => tableName)).toEqual(['album_closure', 'album_metadata', 'asset_privacy']);
    expect(foreignKeys.rows[0]?.count).toBe(0);
  });

  it('idempotently backfills legacy privacy review state with a canonical digest', async () => {
    const user = mediumFactory.userInsert();
    const reviewed = mediumFactory.assetInsert({ ownerId: user.id, is_nsfw: true });
    const withoutMetadata = mediumFactory.assetInsert({ ownerId: user.id, is_nsfw: false });
    const review = {
      reviewedBy: user.id,
      isNsfw: true,
      action: 'marked-nsfw',
      reviewedAt: '2026-07-15T00:00:00.000Z',
    };
    await db.insertInto('user').values(user).execute();
    await db.insertInto('asset').values([reviewed, withoutMetadata]).execute();
    await db
      .insertInto('asset_metadata')
      .values({
        assetId: reviewed.id,
        key: 'ml-enrichment',
        value: { nsfwDetection: { status: 'success', review } },
      })
      .execute();

    const repository = new ForkPrivacyRepository(db);
    const ids = [withoutMetadata.id!, reviewed.id!];
    const first = await repository.backfillPrivacy(ids);
    const firstRows = await sql`
      SELECT "assetId"::text AS "assetId", "isNsfw", suppression
      FROM immich_fork.asset_privacy
      ORDER BY "assetId"::text
    `.execute(db);
    const second = await repository.backfillPrivacy(ids.toReversed());
    const secondRows = await sql`
      SELECT "assetId"::text AS "assetId", "isNsfw", suppression
      FROM immich_fork.asset_privacy
      ORDER BY "assetId"::text
    `.execute(db);

    expect(first).toEqual({ count: 2, digest: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(second).toEqual(first);
    expect(secondRows.rows).toEqual(firstRows.rows);
    expect(secondRows.rows).toEqual(
      [
        { assetId: reviewed.id, isNsfw: true, suppression: review },
        { assetId: withoutMetadata.id, isNsfw: false, suppression: null },
      ].sort((left, right) => left.assetId!.localeCompare(right.assetId!)),
    );
  });

  it('idempotently backfills album metadata and closure without duplicate paths', async () => {
    const root = mediumFactory.albumInsert({ icon: 'folder', sortOrder: 1 });
    const child = mediumFactory.albumInsert({ parentId: root.id, icon: 'camera', sortOrder: 2 });
    await db.insertInto('album').values(root).execute();
    await db.insertInto('album').values(child).execute();
    await db
      .insertInto('album_closure')
      .values([
        { id_ancestor: root.id!, id_descendant: root.id! },
        { id_ancestor: child.id!, id_descendant: child.id! },
        { id_ancestor: root.id!, id_descendant: child.id! },
      ])
      .execute();

    const repository = new ForkAlbumMetadataRepository(db);
    const ids = [child.id!, root.id!];
    const first = await repository.backfillAlbums(ids);
    const firstMetadata = await sql`
      SELECT "albumId"::text AS "albumId", "parentId"::text AS "parentId", icon, "sortOrder"
      FROM immich_fork.album_metadata ORDER BY "albumId"::text
    `.execute(db);
    const firstClosure = await sql`
      SELECT "ancestorId"::text AS "ancestorId", "descendantId"::text AS "descendantId"
      FROM immich_fork.album_closure ORDER BY "descendantId"::text, "ancestorId"::text
    `.execute(db);
    const second = await repository.backfillAlbums(ids.toReversed());
    const secondClosure = await sql`
      SELECT "ancestorId"::text AS "ancestorId", "descendantId"::text AS "descendantId"
      FROM immich_fork.album_closure ORDER BY "descendantId"::text, "ancestorId"::text
    `.execute(db);

    expect(first).toEqual({ count: 2, digest: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(second).toEqual(first);
    expect(firstMetadata.rows).toEqual(
      [
        { albumId: root.id, parentId: null, icon: 'folder', sortOrder: 1 },
        { albumId: child.id, parentId: root.id, icon: 'camera', sortOrder: 2 },
      ].sort((left, right) => left.albumId!.localeCompare(right.albumId!)),
    );
    expect(secondClosure.rows).toEqual(firstClosure.rows);
    expect(secondClosure.rows).toHaveLength(3);
    expect(new Set(secondClosure.rows.map((row) => JSON.stringify(row))).size).toBe(3);
  });

  it('keeps legacy album reads through dual-write and switches to sidecars when ready or isolated', async () => {
    const album = mediumFactory.albumInsert({ icon: 'legacy', sortOrder: 1 });
    await db.insertInto('album').values(album).execute();
    await db.insertInto('album_closure').values({ id_ancestor: album.id!, id_descendant: album.id! }).execute();

    const albums = new ForkAlbumMetadataRepository(db);
    const privacy = new ForkPrivacyRepository(db);
    await albums.backfillAlbums([album.id!]);
    const legacyRow = { id: album.id!, parentId: null, icon: 'changed-legacy', sortOrder: 9 };

    await sql`UPDATE immich_fork.state SET phase = 'dual-write' WHERE id = 1`.execute(db);
    await expect(albums.applyReadMetadata([legacyRow])).resolves.toEqual([legacyRow]);
    await expect(privacy.shouldReadSidecar()).resolves.toBe(false);

    await sql`UPDATE immich_fork.state SET phase = 'ready' WHERE id = 1`.execute(db);
    await expect(albums.applyReadMetadata([legacyRow])).resolves.toEqual([
      { ...legacyRow, icon: 'legacy', sortOrder: 1 },
    ]);
    await expect(privacy.shouldReadSidecar()).resolves.toBe(true);

    await sql`UPDATE immich_fork.state SET phase = 'inactive' WHERE id = 1`.execute(db);
    await expect(albums.applyReadMetadata([legacyRow])).resolves.toEqual([
      { ...legacyRow, icon: 'legacy', sortOrder: 1 },
    ]);
  });
});
