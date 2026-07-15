import { Kysely, sql } from 'kysely';
import { createHash, randomUUID } from 'node:crypto';
import { defaults } from 'src/config';
import { AlbumUserRole, LogLevel, SystemMetadataKey } from 'src/enum';
import { AlbumRepository } from 'src/repositories/album.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { ForkAlbumMetadataRepository } from 'src/repositories/fork-album-metadata.repository';
import { ForkConfigRepository } from 'src/repositories/fork-config.repository';
import { ForkEnrichmentRepository } from 'src/repositories/fork-enrichment.repository';
import { ForkPrivacyRepository } from 'src/repositories/fork-privacy.repository';
import { ForkSchemaRepository } from 'src/repositories/fork-schema.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SmartAlbumRepository } from 'src/repositories/smart-album.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { DB } from 'src/schema';
import { ImageEnrichmentService } from 'src/services/image-enrichment.service';
import { clearConfigCache, getConfig, updateConfig } from 'src/utils/config';
import { mediumFactory } from 'test/medium.factory';
import { getKyselyDB, newTestService } from 'test/utils';

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
        immich_fork.asset_enrichment,
        immich_fork.asset_privacy,
        immich_fork.album_closure,
        immich_fork.album_metadata
    `.execute(db);
    await sql`UPDATE immich_fork.state SET phase = 'inactive', active = false WHERE id = 1`.execute(db);
    await db.deleteFrom('album').execute();
    await db.deleteFrom('asset').execute();
    await db.deleteFrom('user').execute();
    await db.deleteFrom('system_metadata').where('key', '=', SystemMetadataKey.SystemConfig).execute();
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
          requiresReview: true,
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

  it('preserves ambiguous descriptions byte-for-byte and reviews generated tags without an applied hash', async () => {
    const user = mediumFactory.userInsert();
    const duplicate = mediumFactory.assetInsert({ ownerId: user.id });
    const blanks = mediumFactory.assetInsert({ ownerId: user.id });
    await db.insertInto('user').values(user).execute();
    await db.insertInto('asset').values([duplicate, blanks]).execute();
    const generated = 'Exact generated text';
    const appliedDescriptionHash = createHash('sha256').update(JSON.stringify(generated)).digest('hex');
    const duplicateText = `before\n\nAI description: ${generated}\n\nmiddle\n\nAI description: ${generated}\n\nafter`;
    const blankText = `user paragraph\n\nAI description: ${generated}\n\n\n\ntrailing`;
    await db
      .insertInto('asset_exif')
      .values([
        { assetId: duplicate.id!, description: duplicateText },
        { assetId: blanks.id!, description: blankText },
      ])
      .execute();
    await db
      .insertInto('asset_metadata')
      .values(
        [duplicate, blanks].map((asset) => ({
          assetId: asset.id!,
          key: 'ml-enrichment' as const,
          value: {
            description: {
              status: 'success',
              result: { description: generated, tags: ['generated-tag'] },
              appliedDescriptionHash,
            },
          },
        })),
      )
      .execute();

    await new ForkEnrichmentRepository(db).backfillEnrichment([duplicate.id!, blanks.id!]);
    const rows = await sql<{ assetId: string; userDescription: string; requiresReview: boolean }>`
      SELECT "assetId"::text AS "assetId", "userDescription", "requiresReview"
      FROM immich_fork.asset_enrichment ORDER BY "assetId"::text
    `.execute(db);

    expect(rows.rows).toEqual(
      [
        { assetId: duplicate.id, userDescription: duplicateText, requiresReview: true },
        { assetId: blanks.id, userDescription: 'user paragraph\n\n\n\ntrailing', requiresReview: true },
      ].sort((a, b) => a.assetId!.localeCompare(b.assetId!)),
    );
  });

  it.each(['dual-write', 'ready', 'active', 'inactive'] as const)(
    'initializes enrichment on asset creation in %s and cleans asset references on deletion',
    async (phase) => {
      await sql`UPDATE immich_fork.state SET phase = ${phase} WHERE id = 1`.execute(db);
      const user = mediumFactory.userInsert();
      await db.insertInto('user').values(user).execute();
      const asset = await new AssetRepository(db).create(mediumFactory.assetInsert({ ownerId: user.id }));
      const sidecar = await new ForkEnrichmentRepository(db).get(asset.id);
      expect(sidecar).toMatchObject({ assetId: asset.id, provenance: {}, generatedTags: [] });

      const album = mediumFactory.albumInsert({});
      await db.insertInto('album').values(album).execute();
      const ruleId = randomUUID();
      await sql`INSERT INTO immich_fork.smart_album_rule (id, "albumId", "ownerId", kind)
        VALUES (${ruleId}::uuid, ${album.id}::uuid, ${user.id}::uuid, 'test')`.execute(db);
      await sql`INSERT INTO immich_fork.smart_album_match ("smartAlbumId", "assetId", "matchReason")
        VALUES (${ruleId}::uuid, ${asset.id}::uuid, 'tag')`.execute(db);
      await sql`INSERT INTO immich_fork.smart_album_exclusion ("smartAlbumId", "assetId")
        VALUES (${ruleId}::uuid, ${asset.id}::uuid)`.execute(db);

      await new AssetRepository(db).remove(asset);
      await expect(new ForkEnrichmentRepository(db).get(asset.id)).resolves.toBeUndefined();
      await expect(new ForkPrivacyRepository(db).get(asset.id)).resolves.toBeUndefined();
      const references = await sql<{ count: number }>`SELECT
        (SELECT count(*) FROM immich_fork.smart_album_match WHERE "assetId" = ${asset.id}::uuid) +
        (SELECT count(*) FROM immich_fork.smart_album_exclusion WHERE "assetId" = ${asset.id}::uuid) AS count`.execute(
        db,
      );
      expect(Number(references.rows[0]?.count)).toBe(0);
    },
  );

  it('cleans every asset sidecar during owned-asset bulk deletion', async () => {
    await sql`UPDATE immich_fork.state SET phase = 'ready' WHERE id = 1`.execute(db);
    const user = mediumFactory.userInsert();
    await db.insertInto('user').values(user).execute();
    const inserts = [mediumFactory.assetInsert({ ownerId: user.id }), mediumFactory.assetInsert({ ownerId: user.id })];
    const repository = new AssetRepository(db);
    const ids = await repository.createAll(inserts);
    await repository.deleteAll(user.id);
    const remaining = await sql<{ count: number }>`SELECT
      (SELECT count(*) FROM immich_fork.asset_privacy WHERE "assetId" = ANY(${ids}::uuid[])) +
      (SELECT count(*) FROM immich_fork.asset_enrichment WHERE "assetId" = ANY(${ids}::uuid[])) AS count`.execute(db);
    expect(Number(remaining.rows[0]?.count)).toBe(0);
    await expect(db.selectFrom('asset').select('id').where('ownerId', '=', user.id).execute()).resolves.toHaveLength(0);
  });

  it('cleans rules for an album subtree and all albums owned by a deleted user', async () => {
    const user = mediumFactory.userInsert();
    const root = mediumFactory.albumInsert({});
    const child = mediumFactory.albumInsert({ parentId: root.id });
    await db.insertInto('user').values(user).execute();
    await db.insertInto('album').values([root, child]).execute();
    await db
      .insertInto('album_user')
      .values([
        { albumId: root.id!, userId: user.id, role: AlbumUserRole.Owner },
        { albumId: child.id!, userId: user.id, role: AlbumUserRole.Owner },
      ])
      .execute();
    await db
      .insertInto('album_closure')
      .values([
        { id_ancestor: root.id!, id_descendant: root.id! },
        { id_ancestor: root.id!, id_descendant: child.id! },
        { id_ancestor: child.id!, id_descendant: child.id! },
      ])
      .execute();
    for (const album of [root, child]) {
      await sql`INSERT INTO immich_fork.smart_album_rule (id, "albumId", "ownerId", kind)
        VALUES (${randomUUID()}::uuid, ${album.id}::uuid, ${user.id}::uuid, ${album.id})`.execute(db);
    }
    await new ForkAlbumMetadataRepository(db).mirrorFromLegacy([root.id!, child.id!]);

    await new AlbumRepository(db).delete(root.id!);
    const unrelated = mediumFactory.albumInsert({});
    await db.insertInto('album').values(unrelated).execute();
    await new ForkAlbumMetadataRepository(db).mirrorFromLegacy([unrelated.id!]);
    await sql`INSERT INTO immich_fork.smart_album_rule (id, "albumId", "ownerId", kind)
      VALUES (${randomUUID()}::uuid, ${unrelated.id}::uuid, ${user.id}::uuid, 'owner-orphan')`.execute(db);
    await new AlbumRepository(db).deleteAll(user.id);
    const remaining = await sql<{ count: number }>`SELECT count(*)::int AS count FROM immich_fork.smart_album_rule
      WHERE "ownerId" = ${user.id}::uuid`.execute(db);
    expect(remaining.rows[0]?.count).toBe(0);
    const task5Remaining = await sql<{ count: number }>`SELECT
      (SELECT count(*) FROM immich_fork.album_metadata WHERE "albumId" = ANY(${[root.id, child.id]}::uuid[])) +
      (SELECT count(*) FROM immich_fork.album_closure WHERE "ancestorId" = ANY(${[root.id, child.id]}::uuid[]) OR "descendantId" = ANY(${[root.id, child.id]}::uuid[])) AS count`.execute(
      db,
    );
    expect(Number(task5Remaining.rows[0]?.count)).toBe(0);
  });

  it('keeps generated descriptions and tags sidecar-only after cutover', async () => {
    const user = mediumFactory.userInsert();
    const asset = mediumFactory.assetInsert({ ownerId: user.id });
    await db.insertInto('user').values(user).execute();
    await db.insertInto('asset').values(asset).execute();
    await db
      .insertInto('asset_exif')
      .values({ assetId: asset.id!, description: 'User text\n\nkept exactly' })
      .execute();
    const userTag = mediumFactory.tagInsert({ userId: user.id, value: 'generated-tag' });
    await db.insertInto('tag').values(userTag).execute();
    await db.insertInto('tag_asset').values({ assetId: asset.id!, tagId: userTag.id }).execute();
    await sql`UPDATE immich_fork.state SET phase = 'ready' WHERE id = 1`.execute(db);
    await new ForkEnrichmentRepository(db).initialize([asset.id!]);

    const { sut, mocks } = newTestService(ImageEnrichmentService);
    (sut as unknown as { db: Kysely<DB> }).db = db;
    const metadata = {
      description: {
        status: 'success' as const,
        modelName: 'vlm',
        updatedAt: '2026-07-15T00:00:00.000Z',
        result: { description: 'Generated text', tags: ['generated-tag'] },
      },
    };
    const service = sut as unknown as {
      applyVisibleMetadata(input: Record<string, unknown>): Promise<{ metadata: boolean; visible: boolean }>;
      applyNsfwTags(
        id: string,
        ownerId: string,
        result: Record<string, unknown>,
        metadata: Record<string, unknown>,
      ): Promise<{ metadata: boolean; visible: boolean }>;
      clearAppliedNsfwTags(
        id: string,
        ownerId: string,
        metadata: Record<string, unknown>,
      ): Promise<{ metadata: boolean; visible: boolean }>;
      clearGeneratedTags(id: string, ownerId: string, tags: string[]): Promise<{ metadata: boolean; visible: boolean }>;
      saveEnrichmentMetadata(id: string, value: Record<string, unknown>): Promise<void>;
    };
    await expect(
      service.applyVisibleMetadata({
        id: asset.id,
        ownerId: user.id,
        existingDescription: 'User text\n\nkept exactly',
        result: metadata.description.result,
        metadata,
        previousTagValues: [],
      }),
    ).resolves.toEqual({ metadata: true, visible: false });
    const nsfwMetadata = {
      nsfwDetection: {
        status: 'success',
        result: { isNsfw: true, score: 1, labels: { explicit: 1 } },
      },
    };
    await expect(
      service.applyNsfwTags(asset.id!, user.id, nsfwMetadata.nsfwDetection.result, nsfwMetadata),
    ).resolves.toEqual({ metadata: true, visible: false });
    await expect(service.clearGeneratedTags(asset.id!, user.id, ['generated-tag'])).resolves.toEqual({
      metadata: false,
      visible: false,
    });
    await expect(service.clearAppliedNsfwTags(asset.id!, user.id, nsfwMetadata)).resolves.toEqual({
      metadata: true,
      visible: false,
    });
    await service.saveEnrichmentMetadata(asset.id!, metadata);

    expect(mocks.asset.upsertExif).not.toHaveBeenCalled();
    expect(mocks.tag.upsertValue).not.toHaveBeenCalled();
    await expect(
      db.selectFrom('asset_exif').select('description').where('assetId', '=', asset.id!).executeTakeFirst(),
    ).resolves.toEqual({
      description: 'User text\n\nkept exactly',
    });
    const sidecar = await new ForkEnrichmentRepository(db).get(asset.id!);
    expect(sidecar).toMatchObject({ generatedDescription: 'Generated text', generatedTags: ['generated-tag'] });
    await expect(
      db.selectFrom('tag_asset').selectAll().where('assetId', '=', asset.id!).where('tagId', '=', userTag.id).execute(),
    ).resolves.toHaveLength(1);
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
    const effectiveConfig = structuredClone(defaults);
    effectiveConfig.machineLearning.runpod = { ...effectiveConfig.machineLearning.runpod, ...runpod };
    const configResult = await config.backfillConfig(effectiveConfig, 'database');
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

  it('overlays authoritative fork config for shared consumers while persisting official updates upstream', async () => {
    const metadataRepo = new SystemMetadataRepository(db);
    const forkSchemaRepo = new ForkSchemaRepository(db);
    const repos = {
      configRepo: new ConfigRepository(),
      metadataRepo,
      logger: LoggingRepository.create(),
      forkSchemaRepo,
    };
    const upstream = structuredClone(defaults);
    upstream.logging.level = LogLevel.Warn;
    await metadataRepo.set(SystemMetadataKey.SystemConfig, upstream);
    await sql`UPDATE immich_fork.state SET phase = 'ready' WHERE id = 1`.execute(db);
    await new ForkConfigRepository(db).mirrorConfig({
      ...upstream,
      machineLearning: { ...upstream.machineLearning, runpod: { ...upstream.machineLearning.runpod, enabled: true } },
      smartAlbums: { ...upstream.smartAlbums, enabled: true },
    });
    clearConfigCache();

    const first = await getConfig(repos, { withCache: false });
    expect(first.logging.level).toBe('warn');
    expect(first.machineLearning.runpod.enabled).toBe(true);
    expect(first.smartAlbums.enabled).toBe(true);

    const next = structuredClone(first);
    next.logging.level = LogLevel.Error;
    next.machineLearning.runpod.enabled = false;
    next.smartAlbums.enabled = false;
    const updated = await updateConfig(repos, next);
    const official = await metadataRepo.get(SystemMetadataKey.SystemConfig);
    expect(official?.logging?.level).toBe('error');
    expect(updated.logging.level).toBe('error');
    expect(updated.machineLearning.runpod.enabled).toBe(false);
    expect(updated.smartAlbums.enabled).toBe(false);
  });

  it('backfills fork configuration from the exact effective config-file value', async () => {
    const fileConfig = structuredClone(defaults);
    fileConfig.machineLearning.runpod.enabled = true;
    fileConfig.machineLearning.runpod.apiKey = 'file-secret';
    fileConfig.smartAlbums.enabled = true;
    await db
      .insertInto('system_metadata')
      .values({
        key: SystemMetadataKey.SystemConfig,
        value: {
          machineLearning: { runpod: { enabled: false, apiKey: 'database-secret' } },
          smartAlbums: { enabled: false },
        },
      })
      .execute();

    await new ForkConfigRepository(db).backfillConfig(fileConfig, 'file');
    const rows = await sql<{ key: string; value: Record<string, unknown> }>`
      SELECT key, value FROM immich_fork.config ORDER BY key
    `.execute(db);
    expect(rows.rows).toEqual([
      { key: 'machineLearning.runpod', value: expect.objectContaining({ apiKey: 'file-secret', enabled: true }) },
      { key: 'smartAlbums', value: expect.objectContaining({ enabled: true }) },
    ]);
  });

  it('deep-merges a locked partial database config into complete validated fork fields', async () => {
    const preLockEffective = structuredClone(defaults);
    preLockEffective.machineLearning.runpod.serverless.gpuTypeIds.push('STALE_GPU');
    preLockEffective.smartAlbums.builtIn.travel.tagTriggers.push('stale-tag');
    preLockEffective.smartAlbums.builtIn.travel.clipQueries.push('stale query');
    await db
      .insertInto('system_metadata')
      .values({
        key: SystemMetadataKey.SystemConfig,
        value: {
          machineLearning: { runpod: { enabled: true, serverless: { gpuTypeIds: ['LOCKED_GPU'] } } },
          smartAlbums: {
            enabled: true,
            builtIn: { travel: { tagTriggers: ['locked-tag'], clipQueries: ['locked query'] } },
          },
        },
      })
      .execute();
    await new ForkConfigRepository(db).backfillConfig(preLockEffective, 'database');
    await sql`UPDATE immich_fork.state SET phase = 'ready' WHERE id = 1`.execute(db);

    const complete = await new ForkSchemaRepository(db).overlayConfig(structuredClone(defaults));
    const expectedRunpod = structuredClone(defaults.machineLearning.runpod);
    expectedRunpod.enabled = true;
    expectedRunpod.serverless.gpuTypeIds = ['LOCKED_GPU'];
    const expectedSmartAlbums = structuredClone(defaults.smartAlbums);
    expectedSmartAlbums.enabled = true;
    expectedSmartAlbums.builtIn.travel.tagTriggers = ['locked-tag'];
    expectedSmartAlbums.builtIn.travel.clipQueries = ['locked query'];
    expect(complete.machineLearning.runpod).toEqual(expectedRunpod);
    expect(complete.smartAlbums).toEqual(expectedSmartAlbums);
    expect(complete.machineLearning.runpod.serverless.gpuTypeIds).toEqual(['LOCKED_GPU']);
    expect(complete.smartAlbums.builtIn.travel.tagTriggers).toEqual(['locked-tag']);
    expect(complete.smartAlbums.builtIn.travel.clipQueries).toEqual(['locked query']);
  });

  it('re-queries authority on every cache hit across independent consumers', async () => {
    const metadataRepo = new SystemMetadataRepository(db);
    const forkSchemaRepo = new ForkSchemaRepository(db);
    const repos = {
      configRepo: new ConfigRepository(),
      metadataRepo,
      logger: LoggingRepository.create(),
      forkSchemaRepo,
    };
    const legacy = structuredClone(defaults);
    legacy.machineLearning.runpod.enabled = false;
    await metadataRepo.set(SystemMetadataKey.SystemConfig, legacy);
    await forkSchemaRepo.setPhase('dual-write');
    await new ForkConfigRepository(db).mirrorConfig({
      ...legacy,
      machineLearning: { ...legacy.machineLearning, runpod: { ...legacy.machineLearning.runpod, enabled: true } },
    });
    clearConfigCache();
    await expect(getConfig(repos, { withCache: false })).resolves.toMatchObject({
      machineLearning: { runpod: { enabled: false } },
    });

    await sql`UPDATE immich_fork.state SET phase = 'ready' WHERE id = 1`.execute(db);
    await expect(getConfig(repos, { withCache: true })).resolves.toMatchObject({
      machineLearning: { runpod: { enabled: true } },
    });

    await sql`UPDATE immich_fork.config SET value = jsonb_set(value, '{enabled}', 'false')
      WHERE key = 'machineLearning.runpod'`.execute(db);
    const independentRepos = { ...repos, forkSchemaRepo: new ForkSchemaRepository(db) };
    await expect(getConfig(independentRepos, { withCache: true })).resolves.toMatchObject({
      machineLearning: { runpod: { enabled: false } },
    });

    await forkSchemaRepo.setPhase('dual-write');
    await sql`UPDATE immich_fork.config SET value = jsonb_set(value, '{enabled}', 'true')
      WHERE key = 'machineLearning.runpod'`.execute(db);
    clearConfigCache();
    let resumeBaseBuild!: () => void;
    let markBaseBuildPaused!: () => void;
    const baseBuildPaused = new Promise<void>((resolve) => (markBaseBuildPaused = resolve));
    const baseBuildResume = new Promise<void>((resolve) => (resumeBaseBuild = resolve));
    const delayedMetadataRepo = {
      get: async (...args: Parameters<SystemMetadataRepository['get']>) => {
        markBaseBuildPaused();
        await baseBuildResume;
        return metadataRepo.get(...args);
      },
      readFile: metadataRepo.readFile.bind(metadataRepo),
    } as SystemMetadataRepository;
    const spanningBuild = getConfig({ ...repos, metadataRepo: delayedMetadataRepo }, { withCache: false });
    await baseBuildPaused;
    await sql`UPDATE immich_fork.state SET phase = 'ready' WHERE id = 1`.execute(db);
    resumeBaseBuild();
    await expect(spanningBuild).resolves.toMatchObject({
      machineLearning: { runpod: { enabled: true } },
    });
  });

  it('serializes official and fork config updates and rolls both back on mirror failure', async () => {
    const metadataRepo = new SystemMetadataRepository(db);
    const forkSchemaRepo = new ForkSchemaRepository(db);
    const repos = {
      configRepo: new ConfigRepository(),
      metadataRepo,
      logger: LoggingRepository.create(),
      forkSchemaRepo,
    };
    await forkSchemaRepo.setPhase('dual-write');
    const first = structuredClone(defaults);
    first.machineLearning.runpod.apiKey = 'first';
    first.smartAlbums.enabled = true;
    const second = structuredClone(defaults);
    second.machineLearning.runpod.apiKey = 'second';
    second.smartAlbums.enabled = false;
    await Promise.all([updateConfig(repos, first), updateConfig(repos, second)]);

    clearConfigCache();
    const officialEffective = await getConfig(
      { configRepo: repos.configRepo, metadataRepo, logger: repos.logger },
      { withCache: false },
    );
    const official = await metadataRepo.get(SystemMetadataKey.SystemConfig);
    const forkRunpod = await new ForkConfigRepository(db).get('machineLearning.runpod');
    const forkSmartAlbums = await new ForkConfigRepository(db).get('smartAlbums');
    expect(forkRunpod).toEqual(officialEffective.machineLearning.runpod);
    expect(forkSmartAlbums).toEqual(officialEffective.smartAlbums);

    const before = structuredClone(official);
    await sql`ALTER TABLE immich_fork.config RENAME TO config_unavailable`.execute(db);
    const failing = structuredClone(defaults);
    failing.logging.level = LogLevel.Fatal;
    await expect(updateConfig(repos, failing)).rejects.toThrow();
    await sql`ALTER TABLE immich_fork.config_unavailable RENAME TO config`.execute(db);
    await expect(metadataRepo.get(SystemMetadataKey.SystemConfig)).resolves.toEqual(before);
  });
});
