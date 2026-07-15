import { Kysely, sql } from 'kysely';
import { createHash, randomUUID } from 'node:crypto';
import { link, mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChecksumAlgorithm, JobStatus, PhysicalFileType } from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { ForkSchemaRepository } from 'src/repositories/fork-schema.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { ForkSchemaMigrationService } from 'src/services/fork-schema-migration.service';
import { ForkStorageNormalizationService } from 'src/services/fork-storage-normalization.service';
import { mediumFactory } from 'test/medium.factory';
import { getKyselyDB, newTestService } from 'test/utils';

const sha = (algorithm: 'sha1' | 'sha256', bytes: Buffer) => createHash(algorithm).update(bytes).digest();

describe('checksum and physical-storage normalization', () => {
  let db: Kysely<DB>;
  let temporaryRoot: string;

  beforeAll(async () => {
    db = await getKyselyDB('checksum_storage_backfill');
    await new DatabaseRepository(db, LoggingRepository.create(), new ConfigRepository()).runForkMigrations();
  }, 120_000);

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'immich-fork-normalization-'));
    await sql`
      TRUNCATE
        immich_fork.asset_physical_file,
        immich_fork.physical_file,
        immich_fork.asset_checksum,
        immich_fork.backfill_progress
    `.execute(db);
    await sql`UPDATE immich_fork.state SET phase = 'dual-write', active = false WHERE id = 1`.execute(db);
    await db.deleteFrom('asset').execute();
    await db.deleteFrom('user').execute();
  });

  afterEach(async () => rm(temporaryRoot, { recursive: true, force: true }));
  afterAll(async () => db.destroy());

  it('creates fork-owned checksum and physical mappings without cross-schema foreign keys', async () => {
    const expected = ['asset_checksum', 'asset_physical_file', 'physical_file'];
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

  it('preserves SHA-256, restores upstream SHA-1, and gives every shared asset an independently removable path', async () => {
    const bytes = Buffer.from('isolated test media bytes');
    const canonicalPath = join(temporaryRoot, `${randomUUID()}.jpg`);
    await writeFile(canonicalPath, bytes);
    const users = [mediumFactory.userInsert(), mediumFactory.userInsert()];
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
    expect(new Set(normalized.map(({ originalPath }) => originalPath))).toHaveLength(2);
    expect(normalized).toEqual(
      expect.arrayContaining(
        assets.map(({ id }) =>
          expect.objectContaining({
            id,
            checksum: sha('sha1', bytes),
            checksumAlgorithm: ChecksumAlgorithm.sha1File,
            physicalOriginalFileId: null,
          }),
        ),
      ),
    );
    expect(sidecars.rows).toEqual(
      expect.arrayContaining(
        assets.map(({ id }) => expect.objectContaining({ assetId: id, sha256: sha('sha256', bytes) })),
      ),
    );

    const [firstPath, secondPath] = normalized.map(({ originalPath }) => originalPath);
    const [firstStats, secondStats] = await Promise.all([stat(firstPath), stat(secondPath)]);
    expect(firstStats.ino).toBe(secondStats.ino);
    await unlink(firstPath);
    await expect(readFile(secondPath)).resolves.toEqual(bytes);
    await link(secondPath, firstPath);
    await unlink(secondPath);
    await expect(readFile(firstPath)).resolves.toEqual(bytes);
  });

  it('fails the fenced progress row and leaves the asset unchanged when its original is unreadable', async () => {
    const user = mediumFactory.userInsert();
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

  it('fails closed without asset or sidecar changes when the readable original checksum mismatches', async () => {
    const bytes = Buffer.from('readable but mismatched bytes');
    const originalPath = join(temporaryRoot, 'mismatch.jpg');
    await writeFile(originalPath, bytes);
    const user = mediumFactory.userInsert();
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
    const user = mediumFactory.userInsert();
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

    await expect(sut.runBatch('storage', 10)).resolves.toBe(JobStatus.Success);
    await expect(sut.runBatch('checksum', 10)).resolves.toBe(JobStatus.Success);

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
