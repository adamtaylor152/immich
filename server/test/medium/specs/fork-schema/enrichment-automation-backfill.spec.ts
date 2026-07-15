import { Kysely, sql } from 'kysely';
import { createHash } from 'node:crypto';
import { AlbumUserRole, SystemMetadataKey } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { ForkConfigRepository } from 'src/repositories/fork-config.repository';
import { ForkEnrichmentRepository } from 'src/repositories/fork-enrichment.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SmartAlbumRepository } from 'src/repositories/smart-album.repository';
import { DB } from 'src/schema';
import { mediumFactory } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

describe('enrichment, configuration, and automation fork sidecars', () => {
  let db: Kysely<DB>;

  beforeAll(async () => {
    db = await getKyselyDB('enrichment_automation_backfill');
    const repository = new DatabaseRepository(db, LoggingRepository.create(), new ConfigRepository());
    await repository.runForkMigrations();
  }, 120_000);

  beforeEach(async () => {
    await sql`
      TRUNCATE
        immich_fork.smart_album_exclusion,
        immich_fork.smart_album_match,
        immich_fork.smart_album_rule,
        immich_fork.config,
        immich_fork.asset_enrichment
    `.execute(db);
    await sql`UPDATE immich_fork.state SET phase = 'inactive', active = false WHERE id = 1`.execute(db);
    await db.deleteFrom('album').execute();
    await db.deleteFrom('asset').execute();
    await db.deleteFrom('user').execute();
  });

  afterAll(async () => db.destroy());

  it('creates fork-only sidecars without cross-schema foreign keys', async () => {
    const tables = await sql<{ tableName: string }>`
      SELECT table_name AS "tableName"
      FROM information_schema.tables
      WHERE table_schema = 'immich_fork'
        AND table_name IN ('asset_enrichment', 'config', 'smart_album_rule', 'smart_album_match', 'smart_album_exclusion')
      ORDER BY table_name
    `.execute(db);
    const foreignKeys = await sql<{ count: number }>`
      SELECT count(*)::int AS count
      FROM information_schema.table_constraints
      WHERE table_schema = 'immich_fork'
        AND table_name = ANY(${tables.rows.map(({ tableName }) => tableName)})
        AND constraint_type = 'FOREIGN KEY'
    `.execute(db);

    expect(tables.rows.map(({ tableName }) => tableName)).toEqual([
      'asset_enrichment',
      'config',
      'smart_album_exclusion',
      'smart_album_match',
      'smart_album_rule',
    ]);
    expect(foreignKeys.rows[0]?.count).toBe(0);
  });

  it('extracts only an exactly reproduced generated description and preserves exact user text', async () => {
    const user = mediumFactory.userInsert();
    const exact = mediumFactory.assetInsert({ ownerId: user.id });
    const mismatch = mediumFactory.assetInsert({ ownerId: user.id });
    const wrongHash = mediumFactory.assetInsert({ ownerId: user.id });
    const absent = mediumFactory.assetInsert({ ownerId: user.id });
    await db.insertInto('user').values(user).execute();
    await db.insertInto('asset').values([exact, mismatch, wrongHash, absent]).execute();
    await db
      .insertInto('asset_exif')
      .values([
        { assetId: exact.id!, description: '  User text exactly.  \n\nAI description: A generated scene' },
        { assetId: mismatch.id!, description: 'Keep all of this\n\nAI description: Edited by the user' },
        { assetId: wrongHash.id!, description: 'Do not strip\n\nAI description: Matching text' },
        { assetId: absent.id!, description: 'No provenance\n\nAI description: Recovered from text' },
      ])
      .execute();
    await db
      .insertInto('asset_metadata')
      .values([
        {
          assetId: exact.id!,
          key: 'ml-enrichment',
          value: {
            description: {
              status: 'success',
              modelName: 'vlm',
              updatedAt: '2026-07-15T00:00:00.000Z',
              result: { description: 'A generated scene', tags: ['scene'] },
              appliedDescriptionHash: createHash('sha256').update(JSON.stringify('A generated scene')).digest('hex'),
            },
          },
        },
        {
          assetId: wrongHash.id!,
          key: 'ml-enrichment',
          value: {
            description: {
              status: 'success',
              modelName: 'vlm',
              updatedAt: '2026-07-15T00:00:00.000Z',
              result: { description: 'Matching text', tags: [] },
              appliedDescriptionHash: 'wrong-hash',
            },
          },
        },
        {
          assetId: mismatch.id!,
          key: 'ml-enrichment',
          value: {
            description: {
              status: 'success',
              modelName: 'vlm',
              updatedAt: '2026-07-15T00:00:00.000Z',
              result: { description: 'Original generated scene', tags: ['edited'] },
              appliedDescriptionHash: 'proof',
            },
          },
        },
      ])
      .execute();

    const repository = new ForkEnrichmentRepository(db);
    const first = await repository.backfillEnrichment([mismatch.id!, exact.id!, wrongHash.id!, absent.id!]);
    const second = await repository.backfillEnrichment([wrongHash.id!, absent.id!, exact.id!, mismatch.id!]);
    const rows = await sql<{
      assetId: string;
      userDescription: string;
      generatedDescription: string;
      requiresReview: boolean;
    }>`
      SELECT "assetId"::text AS "assetId", "userDescription", "generatedDescription", "requiresReview"
      FROM immich_fork.asset_enrichment ORDER BY "assetId"::text
    `.execute(db);
    const upstream = await db.selectFrom('asset_exif').select(['assetId', 'description']).orderBy('assetId').execute();

    expect(second).toEqual(first);
    expect(first.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(rows.rows).toEqual(
      [
        {
          assetId: exact.id,
          userDescription: '  User text exactly.  ',
          generatedDescription: 'A generated scene',
          requiresReview: false,
        },
        {
          assetId: mismatch.id,
          userDescription: 'Keep all of this\n\nAI description: Edited by the user',
          generatedDescription: 'Original generated scene',
          requiresReview: true,
        },
        {
          assetId: wrongHash.id,
          userDescription: 'Do not strip\n\nAI description: Matching text',
          generatedDescription: 'Matching text',
          requiresReview: true,
        },
        {
          assetId: absent.id,
          userDescription: 'No provenance\n\nAI description: Recovered from text',
          generatedDescription: 'Recovered from text',
          requiresReview: true,
        },
      ].sort((a, b) => a.assetId!.localeCompare(b.assetId!)),
    );
    expect(upstream).toEqual(
      [
        { assetId: exact.id, description: '  User text exactly.  ' },
        { assetId: mismatch.id, description: 'Keep all of this\n\nAI description: Edited by the user' },
        { assetId: wrongHash.id, description: 'Do not strip\n\nAI description: Matching text' },
        { assetId: absent.id, description: 'No provenance\n\nAI description: Recovered from text' },
      ].sort((a, b) => a.assetId!.localeCompare(b.assetId!)),
    );
  });

  it('backfills RunPod configuration and automation without changing official album membership', async () => {
    const user = mediumFactory.userInsert();
    const asset = mediumFactory.assetInsert({ ownerId: user.id });
    const album = mediumFactory.albumInsert({});
    await db.insertInto('user').values(user).execute();
    await db.insertInto('asset').values(asset).execute();
    await db.insertInto('album').values(album).execute();
    await db
      .insertInto('album_user')
      .values({ albumId: album.id!, userId: user.id, role: AlbumUserRole.Owner })
      .execute();
    await db.insertInto('album_asset').values({ albumId: album.id!, assetId: asset.id! }).execute();
    const smart = await db
      .insertInto('smart_album')
      .values({ albumId: album.id!, ownerId: user.id, kind: 'travel' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('smart_album_asset')
      .values({ smartAlbumId: smart.id, assetId: asset.id!, matchReason: 'tag' })
      .execute();
    await db.insertInto('smart_album_exclusion').values({ smartAlbumId: smart.id, assetId: asset.id! }).execute();
    const runpod = { enabled: true, mode: 'serverless' as const, apiKey: 'rp_secret', imageName: 'fork/image:latest' };
    await db
      .insertInto('system_metadata')
      .values({ key: SystemMetadataKey.SystemConfig, value: { machineLearning: { runpod } } })
      .execute();

    const automation = new SmartAlbumRepository(db);
    const config = new ForkConfigRepository(db);
    const first = await automation.backfillAutomation([album.id!]);
    const second = await automation.backfillAutomation([album.id!]);
    const configResult = await config.backfillConfig();
    const membership = await db.selectFrom('album_asset').selectAll().execute();
    const forkConfig = await sql<{
      value: typeof runpod;
    }>`SELECT value FROM immich_fork.config WHERE key = 'machineLearning.runpod'`.execute(db);

    expect(second).toEqual(first);
    expect(first.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(configResult.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(forkConfig.rows[0]?.value).toMatchObject(runpod);
    expect(membership).toHaveLength(1);

    await sql`UPDATE immich_fork.smart_album_rule SET kind = 'fork-travel' WHERE id = ${smart.id}::uuid`.execute(db);
    await sql`UPDATE immich_fork.state SET phase = 'dual-write' WHERE id = 1`.execute(db);
    await expect(automation.getAllSmartAlbumIdsForOwner(user.id)).resolves.toEqual(new Map([['travel', smart.id]]));

    await sql`UPDATE immich_fork.state SET phase = 'ready' WHERE id = 1`.execute(db);
    await expect(automation.getAllSmartAlbumIdsForOwner(user.id)).resolves.toEqual(
      new Map([['fork-travel', smart.id]]),
    );
    await db.deleteFrom('smart_album').where('id', '=', smart.id).execute();
    await sql`UPDATE immich_fork.state SET phase = 'inactive' WHERE id = 1`.execute(db);
    await expect(automation.getAllSmartAlbumIdsForOwner(user.id)).resolves.toEqual(
      new Map([['fork-travel', smart.id]]),
    );
    await expect(db.selectFrom('album_asset').selectAll().execute()).resolves.toHaveLength(1);
  });
});
