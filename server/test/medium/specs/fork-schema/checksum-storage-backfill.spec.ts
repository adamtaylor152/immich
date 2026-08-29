import { Kysely, sql } from 'kysely';
import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageCore } from 'src/cores/storage.core';
import { ChecksumAlgorithm, JobStatus, PhysicalFileType } from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { CryptoRepository } from 'src/repositories/crypto.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { ForkSchemaRepository } from 'src/repositories/fork-schema.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PhysicalFileRepository } from 'src/repositories/physical-file.repository';
import { DB } from 'src/schema';
import { ForkSchemaMigrationService } from 'src/services/fork-schema-migration.service';
import { ForkStorageNormalizationService } from 'src/services/fork-storage-normalization.service';
import { mediumFactory } from 'test/medium.factory';
import { getKyselyDB, newTestService } from 'test/utils';

const sha = (algorithm: 'sha1' | 'sha256', bytes: Buffer) => createHash(algorithm).update(bytes).digest();
const vector = `[${Array.from({ length: 512 }, (_, index) => (index === 0 ? 1 : 0)).join(',')}]`;

const seedForkCleanupSidecars = async (db: Kysely<DB>, assetId: string, ownerId: string, root: string) => {
  const healthRunId = randomUUID();
  const healthId = randomUUID();
  const physicalFileId = randomUUID();
  const token = randomUUID();
  const checksum = sha('sha256', Buffer.from(assetId));
  await sql`
    INSERT INTO immich_fork.asset_health_run (id, category, status)
    VALUES (${healthRunId}::uuid, 'missing', 'completed')
  `.execute(db);
  await sql`
    INSERT INTO immich_fork.asset_health
      (id, "assetId", "runId", category, status, severity, "originalPath", "originalFileName", evidence,
       resolution, "checkedAt")
    VALUES (${healthId}::uuid, ${assetId}::uuid, ${healthRunId}::uuid, 'missing', 'missing', 'warning',
      ${join(root, `${assetId}.jpg`)}, ${`${assetId}.jpg`}, '{}'::jsonb, '{}'::jsonb, now())
  `.execute(db);
  await sql`
    INSERT INTO immich_fork.asset_health_candidate
      ("healthId", "candidatePath", status, evidence, resolution, "checkedAt")
    VALUES (${healthId}::uuid, ${join(root, `${assetId}.candidate.jpg`)}, 'candidate', '{}'::jsonb, '{}'::jsonb, now())
  `.execute(db);
  await sql`
    INSERT INTO immich_fork.asset_best_photo_score
      ("assetId", "ownerId", score, "scoreVersion", "computedAt")
    VALUES (${assetId}::uuid, ${ownerId}::uuid, 0.75, 1, now())
  `.execute(db);
  await sql`
    INSERT INTO immich_fork.asset_video_duplicate_frame
      ("assetId", "frameIndex", "timestampMs", path, embedding)
    VALUES (${assetId}::uuid, 0, 0, ${join(root, `${assetId}.frame.jpg`)}, ${vector}::vector)
  `.execute(db);
  await sql`
    INSERT INTO immich_fork.asset_storage_reservation
      ("assetId", token, "sourcePath", "upstreamPath", "temporaryPath", status)
    VALUES (${assetId}::uuid, ${token}::uuid, ${join(root, `${assetId}.source.jpg`)},
      ${join(root, `${assetId}.upstream.jpg`)}, ${join(root, `${assetId}.temporary.jpg`)}, 'reserved')
  `.execute(db);
  await sql`
    INSERT INTO immich_fork.asset_checksum
      ("assetId", sha1, sha256, "sizeInBytes", "verifiedPaths", "linkCount")
    VALUES (${assetId}::uuid, ${sha('sha1', Buffer.from(assetId))}, ${checksum}, 1, ARRAY[${join(root, `${assetId}.jpg`)}], 1)
  `.execute(db);
  await sql`
    INSERT INTO immich_fork.physical_file
      (id, "canonicalAssetId", type, checksum, "sizeInBytes", "canonicalPath", "createdAt", "updatedAt")
    VALUES (${physicalFileId}::uuid, ${assetId}::uuid, 'original', ${checksum}, 1,
      ${join(root, `${assetId}.physical.jpg`)}, now(), now())
  `.execute(db);
  await sql`
    INSERT INTO immich_fork.asset_physical_file ("assetId", "physicalFileId", "upstreamPath")
    VALUES (${assetId}::uuid, ${physicalFileId}::uuid, ${join(root, `${assetId}.mapped.jpg`)})
  `.execute(db);
  return physicalFileId;
};

const snapshotForkCleanupSidecars = async (db: Kysely<DB>, assetIds: string[], physicalFileIds: string[]) => {
  const result = await sql<{ snapshot: unknown }>`SELECT jsonb_build_object(
    'healthCandidates', (SELECT coalesce(jsonb_agg(to_jsonb(candidate) ORDER BY candidate.id), '[]'::jsonb)
      FROM immich_fork.asset_health_candidate candidate
      JOIN immich_fork.asset_health health ON health.id = candidate."healthId"
      WHERE health."assetId" = ANY(${assetIds}::uuid[])),
    'health', (SELECT coalesce(jsonb_agg(to_jsonb(health) ORDER BY health.id), '[]'::jsonb)
      FROM immich_fork.asset_health health WHERE health."assetId" = ANY(${assetIds}::uuid[])),
    'scores', (SELECT coalesce(jsonb_agg(to_jsonb(score) ORDER BY score."assetId"), '[]'::jsonb)
      FROM immich_fork.asset_best_photo_score score WHERE score."assetId" = ANY(${assetIds}::uuid[])),
    'frames', (SELECT coalesce(jsonb_agg(to_jsonb(frame) ORDER BY frame."assetId", frame."frameIndex"), '[]'::jsonb)
      FROM immich_fork.asset_video_duplicate_frame frame WHERE frame."assetId" = ANY(${assetIds}::uuid[])),
    'reservations', (SELECT coalesce(jsonb_agg(to_jsonb(reservation) ORDER BY reservation."assetId"), '[]'::jsonb)
      FROM immich_fork.asset_storage_reservation reservation WHERE reservation."assetId" = ANY(${assetIds}::uuid[])),
    'checksums', (SELECT coalesce(jsonb_agg(to_jsonb(checksum) ORDER BY checksum."assetId"), '[]'::jsonb)
      FROM immich_fork.asset_checksum checksum WHERE checksum."assetId" = ANY(${assetIds}::uuid[])),
    'mappings', (SELECT coalesce(jsonb_agg(to_jsonb(mapping) ORDER BY mapping."assetId"), '[]'::jsonb)
      FROM immich_fork.asset_physical_file mapping WHERE mapping."assetId" = ANY(${assetIds}::uuid[])),
    'physicalFiles', (SELECT coalesce(jsonb_agg(to_jsonb(physical) ORDER BY physical.id), '[]'::jsonb)
      FROM immich_fork.physical_file physical WHERE physical.id = ANY(${physicalFileIds}::uuid[]))
  ) AS snapshot`.execute(db);
  return result.rows[0]!.snapshot;
};

const insertSharedAssets = async (db: Kysely<DB>, root: string, bytes: Buffer) => {
  const canonicalPath = join(root, `${randomUUID()}.jpg`);
  await writeFile(canonicalPath, bytes);
  const users = [await mediumFactory.userWithClusterGroup(db), await mediumFactory.userWithClusterGroup(db)];
  const assets = users.map((user) =>
    mediumFactory.assetInsert({
      ownerId: user.id,
      originalPath: canonicalPath,
      checksum: sha('sha256', bytes),
      checksumAlgorithm: ChecksumAlgorithm.sha256File,
    }),
  );
  await db.insertInto('user').values(users).execute();
  await db.insertInto('asset').values(assets).execute();
  const physical = await db
    .insertInto('physical_file')
    .values({
      canonicalAssetId: assets[0].id!,
      checksum: sha('sha256', bytes),
      path: canonicalPath,
      sizeInBytes: bytes.length,
      type: PhysicalFileType.Original,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .updateTable('asset')
    .set({ physicalOriginalFileId: physical.id })
    .where(
      'id',
      'in',
      assets.map(({ id }) => id!),
    )
    .execute();
  return { assets, canonicalPath, users };
};

describe('checksum and physical-storage normalization', () => {
  let db: Kysely<DB>;
  let temporaryRoot: string;

  beforeAll(async () => {
    db = await getKyselyDB('checksum_storage_backfill');
    await new DatabaseRepository(db, LoggingRepository.create(), new ConfigRepository()).runForkMigrations();
  }, 120_000);

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'immich-fork-normalization-'));
    StorageCore.setMediaLocation(temporaryRoot);
    await sql`
      TRUNCATE
        immich_fork.asset_health_candidate,
        immich_fork.asset_health,
        immich_fork.asset_health_run,
        immich_fork.asset_best_photo_score,
        immich_fork.asset_video_duplicate_frame,
        immich_fork.asset_physical_file,
        immich_fork.asset_storage_reservation,
        immich_fork.physical_file,
        immich_fork.asset_checksum,
        immich_fork.backfill_progress
    `.execute(db);
    await sql`UPDATE immich_fork.state SET phase = 'dual-write', active = false WHERE id = 1`.execute(db);
    await db.deleteFrom('asset').execute();
    await db.deleteFrom('user').execute();
  });

  afterEach(async () => rm(temporaryRoot, { recursive: true, force: true }));
  afterAll(async () => {
    await db.destroy();
  });

  it('creates fork-owned checksum and physical mappings without cross-schema foreign keys', async () => {
    const expected = ['asset_checksum', 'asset_physical_file', 'asset_storage_reservation', 'physical_file'];
    const tables = await sql<{ tableName: string }>`
      SELECT table_name AS "tableName"
      FROM information_schema.tables
      WHERE table_schema = 'immich_fork' AND table_name = ANY(${expected})
      ORDER BY table_name
    `.execute(db);
    const foreignKeys = await sql<{ count: number }>`
      SELECT count(*)::int AS count
      FROM information_schema.table_constraints
      WHERE table_schema = 'immich_fork'
        AND table_name = ANY(${expected})
        AND constraint_type = 'FOREIGN KEY'
    `.execute(db);

    expect(tables.rows.map(({ tableName }) => tableName)).toEqual(expected);
    expect(foreignKeys.rows[0]?.count).toBe(0);
  });

  it('preserves SHA-256, the shared deduplicated path, and physical links during steady-state normalization', async () => {
    const bytes = Buffer.from('isolated test media bytes');
    const canonicalPath = join(temporaryRoot, `${randomUUID()}.jpg`);
    await writeFile(canonicalPath, bytes);
    const users = [await mediumFactory.userWithClusterGroup(db), await mediumFactory.userWithClusterGroup(db)];
    const assets = [
      mediumFactory.assetInsert({
        ownerId: users[0].id,
        originalPath: canonicalPath,
        checksum: sha('sha256', bytes),
        checksumAlgorithm: ChecksumAlgorithm.sha256File,
      }),
      mediumFactory.assetInsert({
        ownerId: users[1].id,
        originalPath: canonicalPath,
        checksum: sha('sha256', bytes),
        checksumAlgorithm: ChecksumAlgorithm.sha256File,
      }),
    ];
    await db.insertInto('user').values(users).execute();
    await db.insertInto('asset').values(assets).execute();
    const physical = await db
      .insertInto('physical_file')
      .values({
        canonicalAssetId: assets[0].id!,
        checksum: sha('sha256', bytes),
        path: canonicalPath,
        sizeInBytes: bytes.length,
        type: PhysicalFileType.Original,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .updateTable('asset')
      .set({ physicalOriginalFileId: physical.id })
      .where(
        'id',
        'in',
        assets.map(({ id }) => id!),
      )
      .execute();

    const normalization = new ForkStorageNormalizationService(db);
    const results = await Promise.all(assets.map(({ id }) => normalization.normalizeAsset(id!)));
    const normalized = await db
      .selectFrom('asset')
      .select(['id', 'checksum', 'checksumAlgorithm', 'originalPath', 'physicalOriginalFileId'])
      .where(
        'id',
        'in',
        assets.map(({ id }) => id!),
      )
      .orderBy('id')
      .execute();
    const sidecars = await sql<{ assetId: string; sha256: Buffer }>`
      SELECT "assetId", sha256 FROM immich_fork.asset_checksum ORDER BY "assetId"
    `.execute(db);

    expect(results).toEqual(
      expect.arrayContaining(
        assets.map(({ id }) =>
          expect.objectContaining({
            assetId: id,
            sha1: sha('sha1', bytes).toString('hex'),
            sha256: sha('sha256', bytes).toString('hex'),
          }),
        ),
      ),
    );
    // steady-state normalization records evidence without un-deduplicating:
    // both assets keep the shared canonical path, their physical link, and
    // their original SHA-256 checksum
    expect(new Set(normalized.map(({ originalPath }) => originalPath))).toEqual(new Set([canonicalPath]));
    expect(normalized).toEqual(
      expect.arrayContaining(
        assets.map(({ id }) =>
          expect.objectContaining({
            id,
            checksum: sha('sha256', bytes),
            checksumAlgorithm: ChecksumAlgorithm.sha256File,
            physicalOriginalFileId: physical.id,
          }),
        ),
      ),
    );
    expect(sidecars.rows).toEqual(
      expect.arrayContaining(
        assets.map(({ id }) => expect.objectContaining({ assetId: id, sha256: sha('sha256', bytes) })),
      ),
    );

    // repeat runs use the committed evidence and stay idempotent
    await expect(
      Promise.all([normalization.normalizeAsset(assets[1].id!), normalization.normalizeAsset(assets[1].id!)]),
    ).resolves.toHaveLength(2);
    await expect(readFile(canonicalPath)).resolves.toEqual(bytes);
    // no per-asset copies were materialized
    await expect(lstat(join(temporaryRoot, `${assets[0].id}.jpg`))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(join(temporaryRoot, `${assets[1].id}.jpg`))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects symlink sources and paths outside approved storage roots', async () => {
    const bytes = Buffer.from('unsafe path bytes');
    const realFile = join(temporaryRoot, 'real.jpg');
    const symlinkPath = join(temporaryRoot, 'symlink.jpg');
    await writeFile(realFile, bytes);
    await symlink(realFile, symlinkPath);
    const outsideRoot = await mkdtemp(join(tmpdir(), 'immich-fork-outside-'));
    const outsidePath = join(outsideRoot, 'outside.jpg');
    await writeFile(outsidePath, bytes);
    const users = [await mediumFactory.userWithClusterGroup(db), await mediumFactory.userWithClusterGroup(db)];
    const assets = [symlinkPath, outsidePath].map((originalPath, index) =>
      mediumFactory.assetInsert({
        ownerId: users[index].id,
        originalPath,
        checksum: sha('sha256', bytes),
        checksumAlgorithm: ChecksumAlgorithm.sha256File,
      }),
    );
    await db.insertInto('user').values(users).execute();
    await db.insertInto('asset').values(assets).execute();
    const normalization = new ForkStorageNormalizationService(db);

    await expect(normalization.normalizeAsset(assets[0].id!)).rejects.toThrow(/non-symlink/);
    await expect(normalization.normalizeAsset(assets[1].id!)).rejects.toThrow(/outside approved storage roots/);
    await expect(lstat(symlinkPath)).resolves.toMatchObject({});
    await rm(outsideRoot, { recursive: true, force: true });
  });

  it('rejects an independently owned target even when it has identical bytes', async () => {
    const bytes = Buffer.from('ownership is not byte equality');
    const canonicalPath = join(temporaryRoot, 'canonical.jpg');
    await writeFile(canonicalPath, bytes);
    const users = [
      await mediumFactory.userWithClusterGroup(db),
      await mediumFactory.userWithClusterGroup(db),
      await mediumFactory.userWithClusterGroup(db),
    ];
    const duplicate = mediumFactory.assetInsert({
      ownerId: users[1].id,
      originalPath: canonicalPath,
      checksum: sha('sha256', bytes),
      checksumAlgorithm: ChecksumAlgorithm.sha256File,
    });
    const targetPath = join(temporaryRoot, `${duplicate.id}.jpg`);
    await writeFile(targetPath, bytes);
    const assets = [
      mediumFactory.assetInsert({
        ownerId: users[0].id,
        originalPath: canonicalPath,
        checksum: sha('sha256', bytes),
        checksumAlgorithm: ChecksumAlgorithm.sha256File,
      }),
      duplicate,
      mediumFactory.assetInsert({
        ownerId: users[2].id,
        originalPath: targetPath,
        checksum: sha('sha256', bytes),
        checksumAlgorithm: ChecksumAlgorithm.sha256File,
      }),
    ];
    await db.insertInto('user').values(users).execute();
    await db.insertInto('asset').values(assets).execute();
    const physical = await db
      .insertInto('physical_file')
      .values({
        canonicalAssetId: assets[0].id!,
        checksum: sha('sha256', bytes),
        path: canonicalPath,
        sizeInBytes: bytes.length,
        type: PhysicalFileType.Original,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .updateTable('asset')
      .set({ physicalOriginalFileId: physical.id })
      .where('id', 'in', [assets[0].id!, duplicate.id!])
      .execute();

    // steady-state normalization targets the shared canonical path, so the
    // independently owned per-asset file is never considered — and never touched
    await expect(new ForkStorageNormalizationService(db).normalizeAsset(duplicate.id!)).resolves.toMatchObject({
      assetId: duplicate.id,
    });
    await expect(readFile(targetPath)).resolves.toEqual(bytes);
    const mapping = await sql<{ upstreamPath: string }>`
      SELECT "upstreamPath" FROM immich_fork.asset_physical_file WHERE "assetId" = ${duplicate.id}::uuid
    `.execute(db);
    expect(mapping.rows[0]?.upstreamPath).toBe(canonicalPath);
  });

  it('recovers a stale always-split reservation by re-reserving the shared canonical path', async () => {
    const bytes = Buffer.from('published crash recovery');
    const { assets, canonicalPath } = await insertSharedAssets(db, temporaryRoot, bytes);
    const assetId = assets[1].id!;
    const upstreamPath = join(temporaryRoot, `${assetId}.jpg`);
    const token = randomUUID();
    const temporaryPath = join(temporaryRoot, `.${assetId}.jpg.${token}.normalize`);
    await sql`
      INSERT INTO immich_fork.asset_storage_reservation
        ("assetId", token, "sourcePath", "upstreamPath", "temporaryPath", status)
      VALUES (${assetId}::uuid, ${token}::uuid, ${canonicalPath}, ${upstreamPath}, ${temporaryPath}, 'reserved')
    `.execute(db);
    await link(canonicalPath, temporaryPath);
    await link(temporaryPath, upstreamPath);

    await expect(new ForkStorageNormalizationService(db).normalizeAsset(assetId)).resolves.toMatchObject({ assetId });
    const state = await sql<{ mapping: number; upstreamPath: string | null; reservations: number }>`
      SELECT
        (SELECT count(*)::int FROM immich_fork.asset_physical_file WHERE "assetId" = ${assetId}::uuid) AS mapping,
        (SELECT "upstreamPath" FROM immich_fork.asset_physical_file WHERE "assetId" = ${assetId}::uuid) AS "upstreamPath",
        (SELECT count(*)::int FROM immich_fork.asset_storage_reservation WHERE "assetId" = ${assetId}::uuid) AS reservations
    `.execute(db);
    // the stale split target is abandoned; the mapping points at the shared path
    expect(state.rows[0]).toEqual({ mapping: 1, upstreamPath: canonicalPath, reservations: 0 });
    // the previously published split final is a hardlink of the canonical file and is left as-is
    await expect(readFile(upstreamPath)).resolves.toEqual(bytes);
    await expect(lstat(temporaryPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('ignores an unrelated matching final at the old split path during steady-state normalization', async () => {
    const bytes = Buffer.from('matching final without proof');
    const { assets, canonicalPath } = await insertSharedAssets(db, temporaryRoot, bytes);
    const assetId = assets[1].id!;
    const upstreamPath = join(temporaryRoot, `${assetId}.jpg`);
    await writeFile(upstreamPath, bytes);
    const normalization = new ForkStorageNormalizationService(db);

    await expect(normalization.normalizeAsset(assetId)).resolves.toMatchObject({ assetId });
    const state = await sql<{ mappings: number; upstreamPath: string | null; reservations: number }>`
      SELECT
        (SELECT count(*)::int FROM immich_fork.asset_physical_file WHERE "assetId" = ${assetId}::uuid) AS mappings,
        (SELECT "upstreamPath" FROM immich_fork.asset_physical_file WHERE "assetId" = ${assetId}::uuid) AS "upstreamPath",
        (SELECT count(*)::int FROM immich_fork.asset_storage_reservation WHERE "assetId" = ${assetId}::uuid) AS reservations
    `.execute(db);
    expect(state.rows[0]).toEqual({ mappings: 1, upstreamPath: canonicalPath, reservations: 0 });
    await expect(readFile(upstreamPath)).resolves.toEqual(bytes);
  });

  it('converts preserved deduplication to the destructive official form during handoff preparation', async () => {
    const bytes = Buffer.from('official handoff preparation bytes');
    const { assets, canonicalPath } = await insertSharedAssets(db, temporaryRoot, bytes);
    // force the canonical-path keeper to be processed first (batches claim in
    // id order): its sharers' steady-state mappings still reference the
    // canonical path at that point, which must not read as a takeover
    const [firstId] = assets.map(({ id }) => id!).toSorted();
    await db.updateTable('physical_file').set({ canonicalAssetId: firstId }).execute();
    const { sut } = newTestService(ForkSchemaMigrationService);
    (sut as unknown as { db: Kysely<DB> }).db = db;
    (sut as unknown as { forkSchemaRepository: ForkSchemaRepository }).forkSchemaRepository = new ForkSchemaRepository(
      db,
    );
    sut.onModuleInit();
    StorageCore.setMediaLocation(temporaryRoot);
    await sql`DELETE FROM immich_fork.migration_audit WHERE name = 'official-handoff-preparation'`.execute(db);

    // steady-state backfills first: deduplication is preserved
    await sql`UPDATE immich_fork.state SET phase = 'dual-write', active = false WHERE id = 1`.execute(db);
    await expect(Promise.all([sut.runBatch('storage', 10), sut.runBatch('checksum', 10)])).resolves.toEqual([
      JobStatus.Success,
      JobStatus.Success,
    ]);
    const preserved = await db
      .selectFrom('asset')
      .select(['originalPath', 'physicalOriginalFileId'])
      .where('id', '=', assets[1].id!)
      .executeTakeFirstOrThrow();
    expect(preserved.originalPath).toBe(canonicalPath);
    expect(preserved.physicalOriginalFileId).not.toBeNull();

    // handoff preparation requires the ready phase and converts destructively
    await expect(sut.prepareOfficialHandoff(10)).rejects.toThrow(/requires the ready phase/);
    await sql`UPDATE immich_fork.state SET phase = 'ready', active = false WHERE id = 1`.execute(db);
    await sut.prepareOfficialHandoff(10);

    const converted = await db
      .selectFrom('asset')
      .select(['id', 'checksum', 'checksumAlgorithm', 'originalPath', 'physicalOriginalFileId'])
      .where(
        'id',
        'in',
        assets.map(({ id }) => id!),
      )
      .execute();
    expect(new Set(converted.map(({ originalPath }) => originalPath)).size).toBe(2);
    for (const asset of converted) {
      expect(asset.checksum).toEqual(sha('sha1', bytes));
      expect(asset.checksumAlgorithm).toBe(ChecksumAlgorithm.sha1File);
      expect(asset.physicalOriginalFileId).toBeNull();
      await expect(readFile(asset.originalPath)).resolves.toEqual(bytes);
      const mapping = await sql<{ upstreamPath: string }>`
        SELECT "upstreamPath" FROM immich_fork.asset_physical_file WHERE "assetId" = ${asset.id}::uuid
      `.execute(db);
      expect(mapping.rows[0]?.upstreamPath).toBe(asset.originalPath);
    }
    const audit = await sql<{ status: string }>`
      SELECT status FROM immich_fork.migration_audit
      WHERE name = 'official-handoff-preparation' ORDER BY id DESC LIMIT 1
    `.execute(db);
    expect(audit.rows[0]?.status).toBe('applied');
    const progress = await sql<{ kind: string; remaining: number; digest: string | null }>`
      SELECT kind, remaining::int AS remaining, digest FROM immich_fork.backfill_progress
      WHERE kind IN ('storage', 'checksum') ORDER BY kind
    `.execute(db);
    expect(progress.rows).toEqual([
      { kind: 'checksum', remaining: 0, digest: expect.stringMatching(/^[0-9a-f]{64}$/) },
      { kind: 'storage', remaining: 0, digest: expect.stringMatching(/^[0-9a-f]{64}$/) },
    ]);
  });

  it('does not conflict with another asset reservation on the old split path', async () => {
    const bytes = Buffer.from('cross owner reservation');
    const { assets, canonicalPath } = await insertSharedAssets(db, temporaryRoot, bytes);
    const targetAssetId = assets[1].id!;
    const upstreamPath = join(temporaryRoot, `${targetAssetId}.jpg`);
    const token = randomUUID();
    await sql`
      INSERT INTO immich_fork.asset_storage_reservation
        ("assetId", token, "sourcePath", "upstreamPath", "temporaryPath", status)
      VALUES (
        ${assets[0].id}::uuid,
        ${token}::uuid,
        ${canonicalPath},
        ${upstreamPath},
        ${join(temporaryRoot, `.${targetAssetId}.jpg.${token}.normalize`)},
        'reserved'
      )
    `.execute(db);

    // the other asset's stale split reservation blocks its own re-run recovery,
    // not this asset's steady-state normalization of the shared canonical path
    await expect(new ForkStorageNormalizationService(db).normalizeAsset(targetAssetId)).resolves.toMatchObject({
      assetId: targetAssetId,
    });
    const reservation = await sql<{ assetId: string }>`
      SELECT "assetId" FROM immich_fork.asset_storage_reservation WHERE "upstreamPath" = ${upstreamPath}
    `.execute(db);
    expect(reservation.rows[0]?.assetId).toBe(assets[0].id);
  });

  it('scavenges only the stale temp named by a durable same-asset reservation', async () => {
    const bytes = Buffer.from('temporary crash recovery');
    const { assets, canonicalPath } = await insertSharedAssets(db, temporaryRoot, bytes);
    const assetId = assets[1].id!;
    const upstreamPath = join(temporaryRoot, `${assetId}.jpg`);
    const token = randomUUID();
    const temporaryPath = join(temporaryRoot, `.${assetId}.jpg.${token}.normalize`);
    const unrelatedTemp = join(temporaryRoot, '.unrelated.normalize');
    await sql`
      INSERT INTO immich_fork.asset_storage_reservation
        ("assetId", token, "sourcePath", "upstreamPath", "temporaryPath", status)
      VALUES (${assetId}::uuid, ${token}::uuid, ${canonicalPath}, ${upstreamPath}, ${temporaryPath}, 'reserved')
    `.execute(db);
    await link(canonicalPath, temporaryPath);
    await writeFile(unrelatedTemp, bytes);

    await expect(new ForkStorageNormalizationService(db).normalizeAsset(assetId)).resolves.toMatchObject({ assetId });
    await expect(lstat(temporaryPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(unrelatedTemp)).resolves.toEqual(bytes);
    // the stale split final was never published; the shared canonical path is the target
    await expect(lstat(upstreamPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(canonicalPath)).resolves.toEqual(bytes);
  });

  it('deletion consumes a durable reservation and returns only its per-asset target and temp paths', async () => {
    const bytes = Buffer.from('delete reserved crash state');
    const { assets, canonicalPath } = await insertSharedAssets(db, temporaryRoot, bytes);
    const assetId = assets[1].id!;
    const upstreamPath = join(temporaryRoot, `${assetId}.jpg`);
    const token = randomUUID();
    const temporaryPath = join(temporaryRoot, `.${assetId}.jpg.${token}.normalize`);
    await sql`
      INSERT INTO immich_fork.asset_storage_reservation
        ("assetId", token, "sourcePath", "upstreamPath", "temporaryPath", status)
      VALUES (${assetId}::uuid, ${token}::uuid, ${canonicalPath}, ${upstreamPath}, ${temporaryPath}, 'reserved')
    `.execute(db);

    await expect(new AssetRepository(db).remove({ id: assetId })).resolves.toEqual({
      originalPath: upstreamPath,
      reservationTemporaryPath: temporaryPath,
    });
    const remaining = await sql<{ count: number }>`
      SELECT count(*)::int AS count FROM immich_fork.asset_storage_reservation WHERE "assetId" = ${assetId}::uuid
    `.execute(db);
    expect(remaining.rows[0]?.count).toBe(0);
    await expect(readFile(canonicalPath)).resolves.toEqual(bytes);
  });

  it.each([
    ['single', 'inactive'],
    ['single', 'failed'],
    ['owner-wide', 'inactive'],
    ['owner-wide', 'failed'],
  ] as const)('does not mutate fork cleanup sidecars during %s deletion in %s', async (mode, phase) => {
    await sql`UPDATE immich_fork.state SET phase = ${phase}, active = false WHERE id = 1`.execute(db);
    const user = await mediumFactory.userWithClusterGroup(db);
    const assets = [mediumFactory.assetInsert({ ownerId: user.id }), mediumFactory.assetInsert({ ownerId: user.id })];
    await db.insertInto('user').values(user).execute();
    await db.insertInto('asset').values(assets).execute();
    const selected = mode === 'single' ? assets.slice(0, 1) : assets;
    const assetIds = selected.map(({ id }) => id!);
    const physicalFileIds = await Promise.all(
      selected.map(({ id }) => seedForkCleanupSidecars(db, id!, user.id, temporaryRoot)),
    );
    const before = await snapshotForkCleanupSidecars(db, assetIds, physicalFileIds);

    const repository = new AssetRepository(db);
    await (mode === 'single' ? repository.remove({ id: assetIds[0] }) : repository.deleteAll(user.id));

    await expect(snapshotForkCleanupSidecars(db, assetIds, physicalFileIds)).resolves.toEqual(before);
    const remainingAssets = await db.selectFrom('asset').select('id').where('id', 'in', assetIds).execute();
    expect(remainingAssets).toHaveLength(0);
  });

  it.each(['single', 'owner-wide'] as const)(
    'cleans every fork cleanup sidecar during %s deletion in ready',
    async (mode) => {
      await sql`UPDATE immich_fork.state SET phase = 'ready', active = false WHERE id = 1`.execute(db);
      const user = await mediumFactory.userWithClusterGroup(db);
      const assets = [mediumFactory.assetInsert({ ownerId: user.id }), mediumFactory.assetInsert({ ownerId: user.id })];
      await db.insertInto('user').values(user).execute();
      await db.insertInto('asset').values(assets).execute();
      const selected = mode === 'single' ? assets.slice(0, 1) : assets;
      const assetIds = selected.map(({ id }) => id!);
      const physicalFileIds = await Promise.all(
        selected.map(({ id }) => seedForkCleanupSidecars(db, id!, user.id, temporaryRoot)),
      );

      const repository = new AssetRepository(db);
      await (mode === 'single' ? repository.remove({ id: assetIds[0] }) : repository.deleteAll(user.id));

      await expect(snapshotForkCleanupSidecars(db, assetIds, physicalFileIds)).resolves.toEqual({
        checksums: [],
        frames: [],
        health: [],
        healthCandidates: [],
        mappings: [],
        physicalFiles: [],
        reservations: [],
        scores: [],
      });
    },
  );

  it.each(['single', 'bulk'] as const)(
    'serializes normalization with %s deletion and returns the locked normalized path',
    async (mode) => {
      const bytes = Buffer.from('normalization delete race');
      const canonicalPath = join(temporaryRoot, 'delete-race.jpg');
      await writeFile(canonicalPath, bytes);
      const users = [await mediumFactory.userWithClusterGroup(db), await mediumFactory.userWithClusterGroup(db)];
      const assets = users.map((user) =>
        mediumFactory.assetInsert({
          ownerId: user.id,
          originalPath: canonicalPath,
          checksum: sha('sha256', bytes),
          checksumAlgorithm: ChecksumAlgorithm.sha256File,
        }),
      );
      await db.insertInto('user').values(users).execute();
      await db.insertInto('asset').values(assets).execute();
      const physical = await db
        .insertInto('physical_file')
        .values({
          canonicalAssetId: assets[0].id!,
          checksum: sha('sha256', bytes),
          path: canonicalPath,
          sizeInBytes: bytes.length,
          type: PhysicalFileType.Original,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await db
        .updateTable('asset')
        .set({ physicalOriginalFileId: physical.id })
        .where(
          'id',
          'in',
          assets.map(({ id }) => id!),
        )
        .execute();

      let release!: () => void;
      let entered!: () => void;
      const blocked = new Promise<void>((resolve) => (release = resolve));
      const hashing = new Promise<void>((resolve) => (entered = resolve));
      class GatedCryptoRepository extends CryptoRepository {
        private first = true;
        override async hashFileDigests(filepath: string | Buffer) {
          if (this.first) {
            this.first = false;
            entered();
            await blocked;
          }
          return super.hashFileDigests(filepath);
        }
      }
      const normalizing = new ForkStorageNormalizationService(db, new GatedCryptoRepository()).normalizeAsset(
        assets[1].id!,
      );
      await hashing;
      const repository = new AssetRepository(db);
      const deleting = mode === 'single' ? repository.remove({ id: assets[1].id! }) : repository.deleteAll(users[1].id);
      await new Promise((resolve) => setTimeout(resolve, 20));
      release();
      await normalizing;
      const result = await deleting;
      const removed = Array.isArray(result) ? result[0] : result;

      // steady-state normalization keeps the shared canonical path, so the
      // removed asset reports it and the shared file survives the deletion
      expect(removed?.originalPath).toBe(canonicalPath);
      await expect(readFile(canonicalPath)).resolves.toEqual(bytes);
      await expect(lstat(join(temporaryRoot, `${assets[1].id}.jpg`))).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it('fails the fenced progress row and leaves the asset unchanged when its original is unreadable', async () => {
    const user = await mediumFactory.userWithClusterGroup(db);
    const original = mediumFactory.assetInsert({
      ownerId: user.id,
      originalPath: join(temporaryRoot, 'missing.jpg'),
      checksum: Buffer.alloc(32, 7),
      checksumAlgorithm: ChecksumAlgorithm.sha256File,
    });
    await db.insertInto('user').values(user).execute();
    await db.insertInto('asset').values(original).execute();
    const { sut } = newTestService(ForkSchemaMigrationService);
    (sut as unknown as { db: Kysely<DB> }).db = db;
    (sut as unknown as { forkSchemaRepository: ForkSchemaRepository }).forkSchemaRepository = new ForkSchemaRepository(
      db,
    );
    sut.onModuleInit();
    StorageCore.setMediaLocation(temporaryRoot);

    await expect(sut.runBatch('checksum', 1)).resolves.toBe(JobStatus.Failed);

    const unchanged = await db
      .selectFrom('asset')
      .select(['checksum', 'checksumAlgorithm', 'originalPath', 'physicalOriginalFileId'])
      .where('id', '=', original.id!)
      .executeTakeFirstOrThrow();
    const progress = await sql<{ lastError: string | null; processed: number }>`
      SELECT "lastError", processed::int AS processed
      FROM immich_fork.backfill_progress WHERE kind = 'checksum'
    `.execute(db);
    const sidecars = await sql<{ count: number }>`
      SELECT count(*)::int AS count FROM immich_fork.asset_checksum WHERE "assetId" = ${original.id}::uuid
    `.execute(db);

    expect(unchanged).toEqual({
      checksum: original.checksum,
      checksumAlgorithm: original.checksumAlgorithm,
      originalPath: original.originalPath,
      physicalOriginalFileId: null,
    });
    expect(progress.rows[0]?.processed).toBe(0);
    expect(progress.rows[0]?.lastError).toMatch(/missing\.jpg|ENOENT/);
    expect(sidecars.rows[0]?.count).toBe(0);
  });

  it('completes concurrent checksum and storage handlers for a shared noncanonical asset', async () => {
    const bytes = Buffer.from('shared concurrent handlers');
    const { assets } = await insertSharedAssets(db, temporaryRoot, bytes);
    const { sut } = newTestService(ForkSchemaMigrationService);
    (sut as unknown as { db: Kysely<DB> }).db = db;
    (sut as unknown as { forkSchemaRepository: ForkSchemaRepository }).forkSchemaRepository = new ForkSchemaRepository(
      db,
    );
    sut.onModuleInit();
    StorageCore.setMediaLocation(temporaryRoot);

    await expect(Promise.all([sut.runBatch('storage', 10), sut.runBatch('checksum', 10)])).resolves.toEqual([
      JobStatus.Success,
      JobStatus.Success,
    ]);
    const duplicate = await db
      .selectFrom('asset')
      .select(['originalPath', 'physicalOriginalFileId'])
      .where('id', '=', assets[1].id!)
      .executeTakeFirstOrThrow();
    // steady-state normalization preserves the physical deduplication link
    expect(duplicate.originalPath).not.toBe(join(temporaryRoot, `${assets[1].id}.jpg`));
    expect(duplicate.physicalOriginalFileId).not.toBeNull();
  });

  it('lets a waiting handler use committed evidence while the first handler still owns temp cleanup', async () => {
    const bytes = Buffer.from('post-commit cleanup race');
    const { assets } = await insertSharedAssets(db, temporaryRoot, bytes);
    const assetId = assets[1].id!;

    let releaseFirst!: () => void;
    let firstCommitted!: () => void;
    const firstBlocked = new Promise<void>((resolve) => (releaseFirst = resolve));
    const committed = new Promise<void>((resolve) => (firstCommitted = resolve));
    const firstRepository = new PhysicalFileRepository(db);
    const firstLocked = firstRepository.withLockedNormalizationAsset.bind(firstRepository);
    vi.spyOn(firstRepository, 'withLockedNormalizationAsset').mockImplementation(async (...args) => {
      const result = await firstLocked(...args);
      firstCommitted();
      await firstBlocked;
      return result;
    });

    const secondRepository = new PhysicalFileRepository(db);
    vi.spyOn(secondRepository, 'withLockedNormalizationAsset').mockRejectedValue(
      new Error('completed normalization must not recover the reservation temp'),
    );

    const firstNormalization = new ForkStorageNormalizationService(db, new CryptoRepository(), firstRepository);
    const secondNormalization = new ForkStorageNormalizationService(db, new CryptoRepository(), secondRepository);
    const { sut } = newTestService(ForkSchemaMigrationService);
    (sut as unknown as { db: Kysely<DB> }).db = db;
    (sut as unknown as { forkSchemaRepository: ForkSchemaRepository }).forkSchemaRepository = new ForkSchemaRepository(
      db,
    );
    StorageCore.setMediaLocation(temporaryRoot);
    sut.registerHandler('storage', () => firstNormalization.normalizeBatch([assetId]));
    sut.registerHandler('checksum', () => secondNormalization.normalizeBatch([assetId]));

    const storage = sut.runBatch('storage', 1);
    const firstState = await Promise.race([
      committed.then(() => 'committed'),
      storage.then((status) => `storage:${status}`),
    ]);
    if (firstState !== 'committed') {
      const failed = await sql<{ lastError: string | null }>`
        SELECT "lastError" FROM immich_fork.backfill_progress WHERE kind = 'storage'
      `.execute(db);
      throw new Error(`Storage failed before commit: ${failed.rows[0]?.lastError}`);
    }
    // steady-state normalization is in-place: no durable reservation row and
    // no temp file exist even between commit and release
    const residue = await sql<{ count: number }>`
      SELECT count(*)::int AS count FROM immich_fork.asset_storage_reservation WHERE "assetId" = ${assetId}::uuid
    `.execute(db);
    expect(residue.rows[0]?.count).toBe(0);
    const checksum = sut.runBatch('checksum', 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseFirst();

    await expect(Promise.all([storage, checksum])).resolves.toEqual([JobStatus.Success, JobStatus.Success]);
    const progress = await sql<{ kind: string; lastError: string | null }>`
      SELECT kind, "lastError" FROM immich_fork.backfill_progress
      WHERE kind IN ('storage', 'checksum') ORDER BY kind
    `.execute(db);
    expect(progress.rows).toEqual([
      { kind: 'checksum', lastError: null },
      { kind: 'storage', lastError: null },
    ]);
  });

  it('uses committed evidence to clean crash-after-commit reservation residue without recovering its temp', async () => {
    const bytes = Buffer.from('crash after metadata commit');
    const { assets } = await insertSharedAssets(db, temporaryRoot, bytes);
    const assetId = assets[1].id!;
    let releaseFirst!: () => void;
    let firstCommitted!: () => void;
    const firstBlocked = new Promise<void>((resolve) => (releaseFirst = resolve));
    const committed = new Promise<void>((resolve) => (firstCommitted = resolve));
    const firstRepository = new PhysicalFileRepository(db);
    const firstLocked = firstRepository.withLockedNormalizationAsset.bind(firstRepository);
    vi.spyOn(firstRepository, 'withLockedNormalizationAsset').mockImplementation(async (...args) => {
      const result = await firstLocked(...args);
      firstCommitted();
      await firstBlocked;
      return result;
    });
    const interrupted = new ForkStorageNormalizationService(db, new CryptoRepository(), firstRepository).normalizeAsset(
      assetId,
    );
    await committed;
    // steady-state normalization is in-place: a crash after commit leaves no
    // reservation row and no temp file behind
    const residue = await sql<{ count: number }>`
      SELECT count(*)::int AS count FROM immich_fork.asset_storage_reservation WHERE "assetId" = ${assetId}::uuid
    `.execute(db);
    expect(residue.rows[0]?.count).toBe(0);
    const leftovers = await readdir(temporaryRoot);
    expect(leftovers.filter((path) => path.endsWith('.normalize'))).toEqual([]);

    const retryRepository = new PhysicalFileRepository(db);
    vi.spyOn(retryRepository, 'withLockedNormalizationAsset').mockRejectedValue(
      new Error('completed normalization must not recover the reservation temp'),
    );
    await expect(
      new ForkStorageNormalizationService(db, new CryptoRepository(), retryRepository).normalizeAsset(assetId),
    ).resolves.toMatchObject({ assetId });

    releaseFirst();
    await expect(interrupted).resolves.toMatchObject({ assetId });
  });

  it('fails closed without asset or sidecar changes when the readable original checksum mismatches', async () => {
    const bytes = Buffer.from('readable but mismatched bytes');
    const originalPath = join(temporaryRoot, 'mismatch.jpg');
    await writeFile(originalPath, bytes);
    const user = await mediumFactory.userWithClusterGroup(db);
    const original = mediumFactory.assetInsert({
      ownerId: user.id,
      originalPath,
      checksum: Buffer.alloc(32, 7),
      checksumAlgorithm: ChecksumAlgorithm.sha256File,
    });
    await db.insertInto('user').values(user).execute();
    await db.insertInto('asset').values(original).execute();
    const { sut } = newTestService(ForkSchemaMigrationService);
    (sut as unknown as { db: Kysely<DB> }).db = db;
    (sut as unknown as { forkSchemaRepository: ForkSchemaRepository }).forkSchemaRepository = new ForkSchemaRepository(
      db,
    );
    sut.onModuleInit();
    StorageCore.setMediaLocation(temporaryRoot);

    await expect(sut.runBatch('checksum', 1)).resolves.toBe(JobStatus.Failed);

    const unchanged = await db
      .selectFrom('asset')
      .select(['checksum', 'checksumAlgorithm', 'originalPath'])
      .where('id', '=', original.id!)
      .executeTakeFirstOrThrow();
    const evidence = await sql<{ lastError: string | null; sidecars: number }>`
      SELECT
        progress."lastError",
        (SELECT count(*)::int FROM immich_fork.asset_checksum WHERE "assetId" = ${original.id}::uuid) AS sidecars
      FROM immich_fork.backfill_progress progress
      WHERE progress.kind = 'checksum'
    `.execute(db);
    expect(unchanged).toEqual({
      checksum: original.checksum,
      checksumAlgorithm: original.checksumAlgorithm,
      originalPath,
    });
    expect(evidence.rows[0]?.lastError).toMatch(/checksum mismatch/);
    expect(evidence.rows[0]?.sidecars).toBe(0);
  });

  it('completes both fenced handlers with digests and cleans sidecars through asset lifecycle deletion', async () => {
    const bytes = Buffer.from('handler and cleanup bytes');
    const originalPath = join(temporaryRoot, `${randomUUID()}.jpg`);
    await writeFile(originalPath, bytes);
    const user = await mediumFactory.userWithClusterGroup(db);
    const asset = mediumFactory.assetInsert({
      ownerId: user.id,
      originalPath,
      checksum: sha('sha256', bytes),
      checksumAlgorithm: ChecksumAlgorithm.sha256File,
    });
    await db.insertInto('user').values(user).execute();
    await db.insertInto('asset').values(asset).execute();
    const { sut } = newTestService(ForkSchemaMigrationService);
    (sut as unknown as { db: Kysely<DB> }).db = db;
    (sut as unknown as { forkSchemaRepository: ForkSchemaRepository }).forkSchemaRepository = new ForkSchemaRepository(
      db,
    );
    sut.onModuleInit();
    StorageCore.setMediaLocation(temporaryRoot);

    await expect(Promise.all([sut.runBatch('storage', 10), sut.runBatch('checksum', 10)])).resolves.toEqual([
      JobStatus.Success,
      JobStatus.Success,
    ]);

    const progress = await sql<{ digest: string; kind: string; processed: number }>`
      SELECT kind, processed::int AS processed, digest
      FROM immich_fork.backfill_progress
      WHERE kind IN ('storage', 'checksum')
      ORDER BY kind
    `.execute(db);
    expect(progress.rows).toEqual([
      { kind: 'checksum', processed: 1, digest: expect.stringMatching(/^[0-9a-f]{64}$/) },
      { kind: 'storage', processed: 1, digest: expect.stringMatching(/^[0-9a-f]{64}$/) },
    ]);

    await new AssetRepository(db).remove({ id: asset.id! });
    const remaining = await sql<{ count: number }>`
      SELECT
        (SELECT count(*) FROM immich_fork.asset_checksum WHERE "assetId" = ${asset.id}::uuid) +
        (SELECT count(*) FROM immich_fork.asset_physical_file WHERE "assetId" = ${asset.id}::uuid) AS count
    `.execute(db);
    expect(Number(remaining.rows[0]?.count)).toBe(0);
  });
});
