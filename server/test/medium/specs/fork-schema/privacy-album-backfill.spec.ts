import { Kysely, sql } from 'kysely';
import { createHash } from 'node:crypto';
import { AlbumRepository } from 'src/repositories/album.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { ForkAlbumMetadataRepository } from 'src/repositories/fork-album-metadata.repository';
import { ForkPrivacyRepository } from 'src/repositories/fork-privacy.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { ImageEnrichmentService } from 'src/services/image-enrichment.service';
import { withNsfwAssets, withoutNsfwAssets } from 'src/utils/database';
import { authStub } from 'test/fixtures/auth.stub';
import { mediumFactory } from 'test/medium.factory';
import { newUuid } from 'test/small.factory';
import { getKyselyDB, newTestService } from 'test/utils';

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

  it.each(['inactive', 'failed'] as const)('does not mutate privacy or album sidecars in %s', async (phase) => {
    const user = mediumFactory.userInsert();
    const asset = mediumFactory.assetInsert({ ownerId: user.id, is_nsfw: false });
    const album = mediumFactory.albumInsert({ icon: 'before', sortOrder: 1 });
    await db.insertInto('user').values(user).execute();
    await db.insertInto('asset').values(asset).execute();
    await db.insertInto('album').values(album).execute();
    await db.insertInto('album_closure').values({ id_ancestor: album.id!, id_descendant: album.id! }).execute();
    const privacy = new ForkPrivacyRepository(db);
    const albums = new ForkAlbumMetadataRepository(db);
    await privacy.backfillPrivacy([asset.id!]);
    await albums.backfillAlbums([album.id!]);
    const before = await sql`
      SELECT 'privacy' AS source, row_to_json(row)::text AS value FROM immich_fork.asset_privacy row
      UNION ALL
      SELECT 'album', row_to_json(row)::text FROM immich_fork.album_metadata row
      UNION ALL
      SELECT 'closure', row_to_json(row)::text FROM immich_fork.album_closure row
      ORDER BY source, value
    `.execute(db);

    await sql`UPDATE immich_fork.state SET phase = ${phase}, active = false WHERE id = 1`.execute(db);
    await db.updateTable('asset').set({ is_nsfw: true }).where('id', '=', asset.id!).execute();
    await db.updateTable('album').set({ icon: 'after', sortOrder: 2 }).where('id', '=', album.id!).execute();
    await privacy.mirrorFromLegacy(asset.id!);
    await albums.mirrorFromLegacy([album.id!]);
    await privacy.delete([asset.id!]);
    await albums.delete([album.id!]);

    const after = await sql`
      SELECT 'privacy' AS source, row_to_json(row)::text AS value FROM immich_fork.asset_privacy row
      UNION ALL
      SELECT 'album', row_to_json(row)::text FROM immich_fork.album_metadata row
      UNION ALL
      SELECT 'closure', row_to_json(row)::text FROM immich_fork.album_closure row
      ORDER BY source, value
    `.execute(db);
    expect(after.rows).toEqual(before.rows);
  });

  it('keeps legacy album reads through ready, exposes no inactive overlay, and switches only when active', async () => {
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
    await expect(albums.applyReadMetadata([legacyRow])).resolves.toEqual([legacyRow]);
    await expect(privacy.shouldReadSidecar()).resolves.toBe(false);

    await sql`UPDATE immich_fork.state SET phase = 'inactive' WHERE id = 1`.execute(db);
    await expect(albums.applyReadMetadata([legacyRow])).resolves.toEqual([legacyRow]);
    await expect(privacy.shouldReadSidecar()).resolves.toBe(false);

    await sql`UPDATE immich_fork.state SET phase = 'active', active = true WHERE id = 1`.execute(db);
    await expect(albums.applyReadMetadata([legacyRow])).resolves.toEqual([
      { ...legacyRow, icon: 'legacy', sortOrder: 1 },
    ]);
    await expect(privacy.shouldReadSidecar()).resolves.toBe(true);
  });

  it('uses the phase authority for production NSFW predicates and fails closed without a sidecar', async () => {
    const user = mediumFactory.userInsert();
    const legacyHidden = mediumFactory.assetInsert({ ownerId: user.id, is_nsfw: true });
    const sidecarHidden = mediumFactory.assetInsert({ ownerId: user.id, is_nsfw: false });
    const missingSidecar = mediumFactory.assetInsert({ ownerId: user.id, is_nsfw: false });
    await db.insertInto('user').values(user).execute();
    await db.insertInto('asset').values([legacyHidden, sidecarHidden, missingSidecar]).execute();

    const visibleIds = () =>
      db
        .selectFrom('asset')
        .select('asset.id')
        .$call((qb) => withoutNsfwAssets(qb))
        .orderBy('asset.id')
        .execute()
        .then((rows) => rows.map(({ id }) => id));
    const hiddenIds = () =>
      db
        .selectFrom('asset')
        .select('asset.id')
        .$call((qb) => withNsfwAssets(qb))
        .orderBy('asset.id')
        .execute()
        .then((rows) => rows.map(({ id }) => id));

    await sql`UPDATE immich_fork.state SET phase = 'dual-write' WHERE id = 1`.execute(db);
    await expect(hiddenIds()).resolves.toEqual([legacyHidden.id]);

    await sql`
      INSERT INTO immich_fork.asset_privacy ("assetId", "isNsfw")
      VALUES (${legacyHidden.id}::uuid, false), (${sidecarHidden.id}::uuid, true)
    `.execute(db);
    await sql`UPDATE immich_fork.state SET phase = 'ready' WHERE id = 1`.execute(db);
    await expect(visibleIds()).resolves.toEqual([sidecarHidden.id, missingSidecar.id].sort());
    await expect(hiddenIds()).resolves.toEqual([legacyHidden.id]);

    await sql`UPDATE immich_fork.state SET phase = 'inactive' WHERE id = 1`.execute(db);
    await expect(visibleIds()).resolves.toEqual([legacyHidden.id, sidecarHidden.id, missingSidecar.id].sort());
    await expect(hiddenIds()).resolves.toEqual([]);

    await sql`UPDATE immich_fork.state SET phase = 'active', active = true WHERE id = 1`.execute(db);
    await expect(visibleIds()).resolves.toEqual([legacyHidden.id]);
    await expect(hiddenIds()).resolves.toEqual(expect.arrayContaining([sidecarHidden.id, missingSidecar.id]));
  });

  it('rejects authoritative album reads when the required sidecar is missing', async () => {
    const album = mediumFactory.albumInsert({ icon: 'legacy', sortOrder: 7 });
    await db.insertInto('album').values(album).execute();
    await sql`UPDATE immich_fork.state SET phase = 'active', active = true WHERE id = 1`.execute(db);

    await expect(new ForkAlbumMetadataRepository(db).applyReadMetadata([album as never])).rejects.toThrow(
      `Missing fork album metadata sidecar for album ${album.id}`,
    );
  });

  it('rejects authoritative enrichment reads when the required privacy sidecar is missing', async () => {
    const assetId = newUuid();
    const { sut, mocks } = newTestService(ImageEnrichmentService);
    (sut as unknown as { db: Kysely<DB> }).db = db;
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    mocks.asset.getMetadataByKey.mockResolvedValue({ value: {} } as never);
    await sql`UPDATE immich_fork.state SET phase = 'active', active = true WHERE id = 1`.execute(db);

    await expect(sut.getAssetEnrichment(authStub.user1, assetId)).rejects.toThrow(
      `Missing fork privacy sidecar for asset ${assetId}`,
    );
  });

  it('deletes album metadata and every related closure pair in the legacy delete transaction', async () => {
    const root = mediumFactory.albumInsert({});
    const child = mediumFactory.albumInsert({ parentId: root.id });
    const grandchild = mediumFactory.albumInsert({ parentId: child.id });
    await db.insertInto('album').values([root, child, grandchild]).execute();
    await db
      .insertInto('album_closure')
      .values([
        { id_ancestor: root.id!, id_descendant: root.id! },
        { id_ancestor: child.id!, id_descendant: child.id! },
        { id_ancestor: grandchild.id!, id_descendant: grandchild.id! },
        { id_ancestor: root.id!, id_descendant: child.id! },
        { id_ancestor: root.id!, id_descendant: grandchild.id! },
        { id_ancestor: child.id!, id_descendant: grandchild.id! },
      ])
      .execute();
    const subtreeIds = [root.id!, child.id!, grandchild.id!];
    await new ForkAlbumMetadataRepository(db).backfillAlbums(subtreeIds);
    await sql`UPDATE immich_fork.state SET phase = 'ready', active = false WHERE id = 1`.execute(db);

    await new AlbumRepository(db).delete(root.id!);

    await expect(db.selectFrom('album').select('id').where('id', 'in', subtreeIds).execute()).resolves.toHaveLength(0);
    const metadata = await sql`
      SELECT 1 FROM immich_fork.album_metadata WHERE "albumId" = ANY(${subtreeIds}::uuid[])
    `.execute(db);
    const closure = await sql`
      SELECT 1 FROM immich_fork.album_closure
      WHERE "ancestorId" = ANY(${subtreeIds}::uuid[]) OR "descendantId" = ANY(${subtreeIds}::uuid[])
    `.execute(db);
    expect(metadata.rows).toHaveLength(0);
    expect(closure.rows).toHaveLength(0);
  });

  it('uses ordinal key ordering for canonical privacy digests', async () => {
    const user = mediumFactory.userInsert();
    const asset = mediumFactory.assetInsert({ ownerId: user.id, is_nsfw: true });
    const suppression = { ä: 3, a: 2, Z: 1 };
    await db.insertInto('user').values(user).execute();
    await db.insertInto('asset').values(asset).execute();
    await db
      .insertInto('asset_metadata')
      .values({
        assetId: asset.id!,
        key: 'ml-enrichment',
        value: { nsfwDetection: { review: suppression } },
      })
      .execute();

    const result = await new ForkPrivacyRepository(db).backfillPrivacy([asset.id!]);
    const expected = createHash('sha256')
      .update(JSON.stringify([{ assetId: asset.id, isNsfw: true, suppression: { Z: 1, a: 2, ä: 3 } }]))
      .digest('hex');
    expect(result.digest).toBe(expected);
  });
});
