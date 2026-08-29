import { Kysely, sql } from 'kysely';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, copyFile, link, mkdir, mkdtemp, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageCore } from 'src/cores/storage.core';
import { ChecksumAlgorithm } from 'src/enum';
import {
  up as createCutoverVerification,
  down as rollbackCutoverVerification,
} from 'src/fork-schema/migrations/0000000000050-CutoverVerification';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { ForkCutoverVerificationRepository } from 'src/repositories/fork-cutover-verification.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { ForkCutoverVerificationService } from 'src/services/fork-cutover-verification.service';
import { mediumFactory } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

const digest = (algorithm: 'sha1' | 'sha256', bytes: Buffer) => createHash(algorithm).update(bytes).digest();
const resetCutoverVerification = async (db: Kysely<DB>) => {
  await rollbackCutoverVerification(db);
  await createCutoverVerification(db);
};

describe('storage cutover verification', () => {
  let db: Kysely<DB>;
  let root: string;
  let service: ForkCutoverVerificationService;

  beforeAll(async () => {
    db = await getKyselyDB('storage_cutover_verification_v2');
    await new DatabaseRepository(db, LoggingRepository.create(), new ConfigRepository()).runForkMigrations();
    service = new ForkCutoverVerificationService(new ForkCutoverVerificationRepository(db));
  }, 120_000);

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'immich-cutover-verification-'));
    StorageCore.setMediaLocation(root);
    await resetCutoverVerification(db);
    await sql`TRUNCATE immich_fork.asset_physical_file, immich_fork.physical_file, immich_fork.asset_checksum`.execute(
      db,
    );
    await db.deleteFrom('asset').execute();
    await db.deleteFrom('user').execute();
  });

  afterEach(async () => rm(root, { recursive: true, force: true }));
  afterAll(async () => db.destroy());

  const seedDatabase = async (bytes: Buffer, path: string) => {
    const user = await mediumFactory.userWithClusterGroup(db);
    const asset = mediumFactory.assetInsert({
      ownerId: user.id,
      originalPath: path,
      checksum: digest('sha1', bytes),
      checksumAlgorithm: ChecksumAlgorithm.sha1File,
    });
    await db.insertInto('user').values(user).execute();
    await db.insertInto('asset').values(asset).execute();
    await sql`
      INSERT INTO immich_fork.asset_checksum
        ("assetId", sha1, sha256, "sizeInBytes", "verifiedPaths", "linkCount")
      VALUES (${asset.id}::uuid, ${digest('sha1', bytes)}, ${digest('sha256', bytes)}, ${bytes.length}, ARRAY[${path}], 1)
    `.execute(db);
    await sql`
      INSERT INTO immich_fork.asset_physical_file ("assetId", "physicalFileId", "upstreamPath")
      VALUES (${asset.id}::uuid, NULL, ${path})
    `.execute(db);
    return { asset, path, user };
  };

  const seed = async (bytes: Buffer, path = join(root, `${randomUUID()}.jpg`)) => {
    await writeFile(path, bytes);
    return seedDatabase(bytes, path);
  };

  it('resumes deterministic batches without double-counting and completes with a canonical digest', async () => {
    await seed(Buffer.from('one'));
    await seed(Buffer.from('two'));
    const started = await service.start('backup-1', 'snapshot-1');

    const interrupted = await service.resume(started.id, 1);
    expect(interrupted).toMatchObject({ applicableAssetCount: 2, verifiedCount: 1, status: 'running' });
    const completed = await service.resume(started.id, 1);
    expect(completed).toMatchObject({ verifiedCount: 2, failureCount: 0, status: 'completed' });
    expect(completed.aggregateDigest).toMatch(/^[\da-f]{64}$/);
    expect(await service.resume(started.id, 1)).toEqual(completed);
  });

  it.each(['missing', 'changed', 'symlink'] as const)('rolls back a corrupt %s batch', async (kind) => {
    const bytes = Buffer.from('original');
    const { path } = await seed(bytes);
    const started = await service.start('backup-2', `snapshot-${kind}`);
    switch (kind) {
      case 'missing': {
        await unlink(path);
        break;
      }
      case 'changed': {
        await writeFile(path, Buffer.from('changed'));
        break;
      }
      case 'symlink': {
        const outside = join(tmpdir(), `${randomUUID()}.jpg`);
        await writeFile(outside, bytes);
        await unlink(path);
        await symlink(outside, path);
        break;
      }
    }

    await expect(service.resume(started.id, 10)).rejects.toThrow();
    const status = await service.status(started.id);
    expect(status).toMatchObject({ cursor: null, verifiedCount: 0, failureCount: 1, status: 'failed' });
  });

  it('accepts truthful hardlink evidence for shared bytes', async () => {
    const bytes = Buffer.from('shared');
    const first = await seed(bytes);
    const secondPath = join(root, `${randomUUID()}.jpg`);
    await link(first.path, secondPath);
    const second = await seed(bytes, secondPath);
    const started = await service.start('backup-3', 'snapshot-hardlink');
    const completed = await service.resume(started.id, 10);
    const rows = await sql<{ assetId: string; device: string; inode: string; links: number }>`
      SELECT "assetId", device::text, inode::text, links FROM immich_fork.cutover_verification_asset
      WHERE "runId" = ${started.id}::uuid ORDER BY "assetId"
    `.execute(db);

    expect(completed.status).toBe('completed');
    expect(rows.rows.map(({ assetId }) => assetId)).toEqual([first.asset.id, second.asset.id].toSorted());
    expect(new Set(rows.rows.map(({ device, inode }) => `${device}:${inode}`))).toHaveLength(1);
    expect(rows.rows.every(({ links }) => links >= 2)).toBe(true);
  });

  it('rejects an unreadable file without advancing the batch', async () => {
    const { path } = await seed(Buffer.from('unreadable'));
    const started = await service.start('backup-unreadable', 'snapshot-unreadable');
    await chmod(path, 0);

    await expect(service.resume(started.id, 1)).rejects.toThrow();
    await expect(service.status(started.id)).resolves.toMatchObject({
      cursor: null,
      verifiedCount: 0,
      status: 'failed',
    });
  });

  it('rejects public path drift from the locked asset set', async () => {
    const { asset } = await seed(Buffer.from('path drift'));
    const started = await service.start('backup-path-drift', 'snapshot-path-drift');
    await db
      .updateTable('asset')
      .set({ originalPath: join(root, 'different.jpg') })
      .where('id', '=', asset.id!)
      .execute();

    await expect(service.resume(started.id, 1)).rejects.toThrow('path drift');
    await expect(service.status(started.id)).resolves.toMatchObject({
      cursor: null,
      verifiedCount: 0,
      status: 'failed',
    });
  });

  it('rejects approved-root drift from the locked asset set', async () => {
    const { asset, user } = await seed(Buffer.from('root drift'));
    const started = await service.start('backup-root-drift', 'snapshot-root-drift');
    const replacementMediaRoot = join(root, 'replacement-media-root');
    await mkdir(replacementMediaRoot);
    StorageCore.setMediaLocation(replacementMediaRoot);
    const libraryId = randomUUID();
    await sql`
      INSERT INTO public.library (id, name, "ownerId", "importPaths", "exclusionPatterns")
      VALUES (${libraryId}::uuid, 'drifted roots', ${user.id}::uuid, ARRAY[${root}], ARRAY[]::text[])
    `.execute(db);
    await db.updateTable('asset').set({ libraryId }).where('id', '=', asset.id!).execute();

    await expect(service.resume(started.id, 1)).rejects.toThrow('root drift');
    await expect(service.status(started.id)).resolves.toMatchObject({
      cursor: null,
      verifiedCount: 0,
      status: 'failed',
    });
  });

  it('prevents two workers from verifying the same batch', async () => {
    await seed(Buffer.from('concurrent'));
    const repository = new ForkCutoverVerificationRepository(db);
    const started = await service.start('backup-workers', 'snapshot-workers');
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const didEnter = new Promise<void>((resolve) => (entered = resolve));
    const evidence = async (candidate: { assetId: string; path: string }) => {
      entered();
      await blocked;
      return {
        assetId: candidate.assetId,
        path: candidate.path,
        size: 10,
        sha1: 'a'.repeat(40),
        sha256: 'b'.repeat(64),
        device: '1',
        inode: '1',
        links: 1,
      };
    };
    const first = repository.resume(started.id, 1, evidence, () => 'c'.repeat(64));
    await didEnter;

    await expect(repository.resume(started.id, 1, evidence, () => 'd'.repeat(64))).rejects.toThrow(
      'already being resumed',
    );
    release();
    await expect(first).resolves.toMatchObject({ verifiedCount: 1, status: 'completed' });
    const count = await sql<{ count: number }>`
      SELECT count(*)::int AS count FROM immich_fork.cutover_verification_asset
      WHERE "runId" = ${started.id}::uuid AND status = 'verified'
    `.execute(db);
    expect(count.rows[0]?.count).toBe(1);
  });

  it('verifies a reflink clone when the local filesystem supports forced cloning', async () => {
    const bytes = Buffer.from('reflink');
    const source = join(root, 'reflink-source.jpg');
    const clone = join(root, 'reflink-clone.jpg');
    await writeFile(source, bytes);
    try {
      await copyFile(source, clone, constants.COPYFILE_FICLONE_FORCE);
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : '';
      if (['ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'EINVAL', 'ENOSYS'].includes(code)) {
        return;
      }
      throw error;
    }
    const [sourceStats, cloneStats] = await Promise.all([
      stat(source, { bigint: true }),
      stat(clone, { bigint: true }),
    ]);
    expect(cloneStats.ino).not.toBe(sourceStats.ino);
    await seedDatabase(bytes, clone);

    const started = await service.start('backup-reflink', 'snapshot-reflink');
    await expect(service.resume(started.id, 1)).resolves.toMatchObject({ verifiedCount: 1, status: 'completed' });
  });

  it('completes a zero-asset run and keeps checkpoint IDs immutable', async () => {
    const completed = await service.start('backup-zero', 'snapshot-zero');
    expect(completed).toMatchObject({ applicableAssetCount: 0, verifiedCount: 0, status: 'completed' });
    await expect(
      sql`
        UPDATE immich_fork.cutover_verification_run
        SET "databaseBackupId" = 'changed'
        WHERE id = ${completed.id}::uuid
      `.execute(db),
    ).rejects.toThrow('immutable');
    await expect(
      sql`
        UPDATE immich_fork.cutover_verification_run
        SET "snapshotId" = 'changed'
        WHERE id = ${completed.id}::uuid
      `.execute(db),
    ).rejects.toThrow('immutable');
  });

  it('keeps completed canonical asset evidence immutable', async () => {
    await seed(Buffer.from('immutable evidence'));
    const started = await service.start('backup-evidence', 'snapshot-evidence');
    await service.resume(started.id, 1);

    await expect(
      sql`
        UPDATE immich_fork.cutover_verification_asset
        SET size = size + 1
        WHERE "runId" = ${started.id}::uuid
      `.execute(db),
    ).rejects.toThrow('immutable');
  });

  it('prevents deleting a completed run', async () => {
    const completed = await service.start('backup-delete-run', 'snapshot-delete-run');

    await expect(
      sql`DELETE FROM immich_fork.cutover_verification_run WHERE id = ${completed.id}::uuid`.execute(db),
    ).rejects.toThrow('immutable');
  });

  it('prevents deleting verified asset evidence', async () => {
    await seed(Buffer.from('delete evidence'));
    const completed = await service.start('backup-delete-evidence', 'snapshot-delete-evidence');
    await service.resume(completed.id, 1);

    await expect(
      sql`DELETE FROM immich_fork.cutover_verification_asset WHERE "runId" = ${completed.id}::uuid`.execute(db),
    ).rejects.toThrow('immutable');
  });

  it('prevents inserting replacement evidence under a completed run', async () => {
    const completed = await service.start('backup-insert-evidence', 'snapshot-insert-evidence');

    await expect(
      sql`
        INSERT INTO immich_fork.cutover_verification_asset
          ("runId", "assetId", path, "approvedRoots", "expectedSize", "expectedSha1", "expectedSha256")
        VALUES (
          ${completed.id}::uuid, ${randomUUID()}::uuid, ${join(root, 'replacement.jpg')}, ARRAY[${root}], 1,
          ${Buffer.alloc(20, 1)}, ${Buffer.alloc(32, 2)}
        )
      `.execute(db),
    ).rejects.toThrow('immutable');
  });

  it('prevents delete and reinsert replacement of verified evidence', async () => {
    await seed(Buffer.from('replace evidence'));
    const completed = await service.start('backup-replace-evidence', 'snapshot-replace-evidence');
    await service.resume(completed.id, 1);
    const original = await sql<{
      assetId: string;
      path: string;
      approvedRoots: string[];
      expectedSize: number;
      expectedSha1: Buffer;
      expectedSha256: Buffer;
      size: number;
      sha1: string;
      sha256: string;
      device: string;
      inode: string;
      links: number;
      verifiedAt: Date;
    }>`
      SELECT "assetId", path, "approvedRoots", "expectedSize"::float8 AS "expectedSize",
        "expectedSha1", "expectedSha256", size::float8 AS size, sha1, sha256,
        device::text, inode::text, links, "verifiedAt"
      FROM immich_fork.cutover_verification_asset WHERE "runId" = ${completed.id}::uuid
    `.execute(db);
    const row = original.rows[0]!;

    await expect(
      db.transaction().execute(async (trx) => {
        await sql`
          DELETE FROM immich_fork.cutover_verification_asset
          WHERE "runId" = ${completed.id}::uuid AND "assetId" = ${row.assetId}::uuid
        `.execute(trx);
        await sql`
          INSERT INTO immich_fork.cutover_verification_asset
            ("runId", "assetId", path, "approvedRoots", "expectedSize", "expectedSha1", "expectedSha256",
             status, size, sha1, sha256, device, inode, links, "verifiedAt")
          VALUES (
            ${completed.id}::uuid, ${row.assetId}::uuid, ${row.path}, ${row.approvedRoots}, ${row.expectedSize},
            ${row.expectedSha1}, ${row.expectedSha256}, 'verified', ${row.size}, ${row.sha1}, ${row.sha256},
            ${row.device}::bigint, ${row.inode}::bigint, ${row.links}, ${row.verifiedAt}
          )
        `.execute(trx);
      }),
    ).rejects.toThrow('immutable');
  });

  it('prevents truncating and recreating completed verification evidence', async () => {
    await seed(Buffer.from('truncate replacement evidence'));
    const completed = await service.start('backup-truncate-evidence', 'snapshot-truncate-evidence');
    await service.resume(completed.id, 1);
    const original = await sql<{
      assetId: string;
      approvedRoots: string[];
      device: string;
      expectedSha1: Buffer;
      expectedSha256: Buffer;
      expectedSize: number;
      inode: string;
      links: number;
      path: string;
      sha1: string;
      sha256: string;
      size: number;
      verifiedAt: Date;
    }>`
      SELECT "assetId", "approvedRoots", device::text, "expectedSha1", "expectedSha256",
        "expectedSize"::float8 AS "expectedSize", inode::text, links, path, sha1, sha256,
        size::float8 AS size, "verifiedAt"
      FROM immich_fork.cutover_verification_asset WHERE "runId" = ${completed.id}::uuid
    `.execute(db);
    const row = original.rows[0]!;

    await expect(
      db.transaction().execute(async (trx) => {
        await sql`TRUNCATE immich_fork.cutover_verification_asset, immich_fork.cutover_verification_run`.execute(trx);
        await sql`
          INSERT INTO immich_fork.cutover_verification_run
            (id, "databaseBackupId", "snapshotId", status, "applicableAssetCount")
          VALUES (${completed.id}::uuid, 'replacement-backup', 'replacement-snapshot', 'running', 1)
        `.execute(trx);
        await sql`
          INSERT INTO immich_fork.cutover_verification_asset
            ("runId", "assetId", path, "approvedRoots", "expectedSize", "expectedSha1", "expectedSha256",
             status, size, sha1, sha256, device, inode, links, "verifiedAt")
          VALUES (
            ${completed.id}::uuid, ${row.assetId}::uuid, ${join(root, 'replacement.jpg')}, ${row.approvedRoots},
            ${row.expectedSize}, ${row.expectedSha1}, ${row.expectedSha256}, 'verified', ${row.size}, ${row.sha1},
            ${row.sha256}, ${row.device}::bigint, ${row.inode}::bigint, ${row.links}, ${row.verifiedAt}
          )
        `.execute(trx);
        await sql`
          UPDATE immich_fork.cutover_verification_run
          SET status = 'completed', "verifiedCount" = 1, "aggregateDigest" = ${'f'.repeat(64)}, "completedAt" = now()
          WHERE id = ${completed.id}::uuid
        `.execute(trx);
      }),
    ).rejects.toThrow('immutable');
  });

  it('allows the migration down path to drop immutable evidence', async () => {
    const rollbackMarker = 'roll back migration down test';

    await expect(
      db.transaction().execute(async (trx) => {
        await rollbackCutoverVerification(trx);
        const catalog = await sql<{ assetTable: string | null; runTable: string | null }>`
          SELECT to_regclass('immich_fork.cutover_verification_asset')::text AS "assetTable",
            to_regclass('immich_fork.cutover_verification_run')::text AS "runTable"
        `.execute(trx);
        expect(catalog.rows[0]).toEqual({ assetTable: null, runTable: null });
        throw new Error(rollbackMarker);
      }),
    ).rejects.toThrow(rollbackMarker);
  });
});
