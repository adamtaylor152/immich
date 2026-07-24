import { Kysely, sql } from 'kysely';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaults } from 'src/config';
import { StorageCore } from 'src/cores/storage.core';
import { ChecksumAlgorithm } from 'src/enum';
import supportedVersions from 'src/fork-schema/supported-versions.json';
import { getWorkflowCompatibilityEvidence } from 'src/fork-schema/workflow-compatibility';
import { ForkHandoffRepository } from 'src/repositories/fork-handoff.repository';
import { BACKFILL_KINDS, ForkSchemaRepository } from 'src/repositories/fork-schema.repository';
import { PhysicalFileRepository } from 'src/repositories/physical-file.repository';
import { DB } from 'src/schema';
import { ForkHandoffService } from 'src/services/fork-handoff.service';
import { ForkSchemaMigrationService } from 'src/services/fork-schema-migration.service';
import { ForkStorageNormalizationService } from 'src/services/fork-storage-normalization.service';
import { getKyselyConfig } from 'src/utils/database';
import { mediumFactory } from 'test/medium.factory';
import { getKyselyDB, newTestService } from 'test/utils';

const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => (resolve = resolvePromise));
  return { promise, resolve };
};

const connectToSameDatabase = async (db: Kysely<DB>): Promise<Kysely<DB>> => {
  const database = await sql<{ name: string }>`SELECT current_database() AS name`.execute(db);
  const url = process.env.IMMICH_TEST_POSTGRES_URL!.replace('/mich', `/${database.rows[0]!.name}`);
  return new Kysely<DB>(getKyselyConfig({ connectionType: 'url', url }));
};

const waitForCondition = async (predicate: () => boolean, timeout = 2000): Promise<boolean> => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return predicate();
};

const waitForWriter = async (db: Kysely<DB>, writerPid: number, tableName: string) => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const waiting = await sql<{ granted: boolean; mode: string; waitEvent: string; waitEventType: string }>`
      SELECT lock.mode, lock.granted, activity.wait_event_type AS "waitEventType", activity.wait_event AS "waitEvent"
      FROM pg_catalog.pg_stat_activity activity
      JOIN pg_catalog.pg_locks lock ON lock.pid = activity.pid
      JOIN pg_catalog.pg_class relation ON relation.oid = lock.relation
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE activity.pid = ${writerPid} AND namespace.nspname = 'immich_fork'
        AND relation.relname = ${tableName} AND NOT lock.granted
    `.execute(db);
    if (waiting.rows[0]) {
      return waiting.rows[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Writer ${writerPid} did not block on immich_fork.${tableName}`);
};

const waitForBackendBlock = async (db: Kysely<DB>, writerPid: number, blockerPid: number) => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const waiting = await sql<{ blockers: number[]; waitEvent: string; waitEventType: string }>`
      SELECT pg_blocking_pids(pid) AS blockers, wait_event_type AS "waitEventType", wait_event AS "waitEvent"
      FROM pg_catalog.pg_stat_activity
      WHERE pid = ${writerPid} AND ${blockerPid} = ANY(pg_blocking_pids(pid))
    `.execute(db);
    if (waiting.rows[0]) {
      return waiting.rows[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Backend ${writerPid} did not block behind ${blockerPid}`);
};

const getReturnBytes = async (db: Kysely<DB>) => {
  const result = await sql<{ audit: string; config: string; progress: string }>`
    SELECT
      (SELECT row_to_json(audit)::text FROM immich_fork.migration_audit audit
       WHERE name = 'fork-return-reconciliation' ORDER BY id DESC LIMIT 1) AS audit,
      (SELECT coalesce(jsonb_agg(to_jsonb(config) ORDER BY key), '[]'::jsonb)::text
       FROM immich_fork.config config) AS config,
      (SELECT row_to_json(progress)::text FROM immich_fork.backfill_progress progress
       WHERE kind = 'automation') AS progress
  `.execute(db);
  return result.rows[0]!;
};

class PausingForkHandoffRepository extends ForkHandoffRepository {
  onLocks?: (transaction: Kysely<DB>) => Promise<void>;
  onOfficialHandoffReady?: (transaction: Kysely<DB>) => Promise<void>;

  override async assertOfficialHandoffReady(transaction: Kysely<DB> = this.db) {
    const tag = await super.assertOfficialHandoffReady(transaction);
    await this.onOfficialHandoffReady?.(transaction);
    return tag;
  }

  protected override afterOrphanRelationLocks(transaction: Kysely<DB>): Promise<void> {
    return this.onLocks?.(transaction) ?? Promise.resolve();
  }
}

class PausingPhysicalFileRepository extends PhysicalFileRepository {
  onAuthority?: (transaction: Kysely<DB>, action: 'reserve' | 'run' | 'release') => Promise<void>;

  protected afterNormalizationAuthority(transaction: Kysely<DB>, action: 'reserve' | 'run' | 'release'): Promise<void> {
    return this.onAuthority?.(transaction, action) ?? Promise.resolve();
  }
}

describe('certified fork return evidence', () => {
  let db: Kysely<DB>;
  let repository: ForkHandoffRepository;
  let forkSchemaRepository: ForkSchemaRepository;

  const seedExactLedger = async () => {
    await sql`DELETE FROM public.kysely_migrations`.execute(db);
    for (const [index, name] of supportedVersions.upstreamMigrations.entries()) {
      await sql`
        INSERT INTO public.kysely_migrations (name, timestamp)
        VALUES (${name}, ${String(index).padStart(6, '0')})
      `.execute(db);
    }
  };

  const seedOfficialHandoffPrefix = async () => {
    const markerIndex = supportedVersions.upstreamMigrations.indexOf('1778614946174-UpdateWorkflowTables');
    await sql`
      DELETE FROM public.kysely_migrations
      WHERE name = ANY(${supportedVersions.upstreamMigrations.slice(markerIndex + 1)}::varchar[])
    `.execute(db);
  };

  const setupActivationService = () => {
    const { sut: migration, mocks } = newTestService(ForkSchemaMigrationService, {
      forkSchema: forkSchemaRepository,
    });
    (migration as unknown as { db: Kysely<DB> }).db = db;
    mocks.systemMetadata.get.mockResolvedValue({});
    migration.onModuleInit();
    const database = repository as unknown as ConstructorParameters<typeof ForkHandoffService>[0];
    (database as unknown as { withLock: <T>(_lock: unknown, callback: () => Promise<T>) => Promise<T> }).withLock =
      async (_lock, callback) => callback();
    return new ForkHandoffService(database, migration);
  };

  beforeAll(async () => {
    db = await getKyselyDB('fork_return_evidence');
    repository = new ForkHandoffRepository(db);
    forkSchemaRepository = new ForkSchemaRepository(db);
  });

  beforeEach(async () => {
    await seedExactLedger();
    await sql`TRUNCATE immich_fork.migration_audit, immich_fork.backfill_progress`.execute(db);
    await sql`
      TRUNCATE immich_fork.orphaned_records, immich_fork.asset_health_candidate, immich_fork.asset_health,
        immich_fork.asset_health_run, immich_fork.smart_album_match, immich_fork.smart_album_exclusion,
        immich_fork.smart_album_rule, immich_fork.album_closure, immich_fork.album_metadata,
        immich_fork.asset_privacy, immich_fork.asset_enrichment, immich_fork.asset_best_photo_score,
        immich_fork.asset_video_duplicate_frame, immich_fork.asset_checksum, immich_fork.asset_physical_file,
        immich_fork.asset_storage_reservation, immich_fork.physical_file, immich_fork.config
    `.execute(db);
    await db.deleteFrom('album').execute();
    await db.deleteFrom('asset').execute();
    await db.deleteFrom('user').execute();
    await sql`
      UPDATE immich_fork.state
      SET active = false, phase = 'inactive', "schemaVersion" = '2', "updatedAt" = now()
      WHERE id = 1
    `.execute(db);
    await sql`
      INSERT INTO public.system_metadata (key, value)
      VALUES ('maintenance-mode', '{"isMaintenanceMode":true}'::jsonb)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `.execute(db);
    await sql`
      INSERT INTO immich_fork.migration_audit (name, phase, status, details, "completedAt")
      VALUES (
        'fork-schema-cutover',
        'official-cutover',
        'applied',
        jsonb_build_object('reportDigest', ${'a'.repeat(64)}::text, 'databaseBackupId', 'backup-1', 'mediaSnapshotId', 'snapshot-1'),
        now()
      )
    `.execute(db);
  });

  afterAll(async () => db.destroy());

  it.each(['missing', 'extra', 'reordered', 'partial'] as const)(
    'rejects an %s official return ledger before migration',
    async (mutation) => {
      switch (mutation) {
        case 'missing': {
          await sql`DELETE FROM public.kysely_migrations WHERE name = ${supportedVersions.upstreamMigrations.at(-1)!}`.execute(
            db,
          );
          break;
        }
        case 'extra': {
          await sql`
            INSERT INTO public.kysely_migrations (name, timestamp) VALUES ('9999999999999-CustomPatch', '999999')
          `.execute(db);
          break;
        }
        case 'reordered': {
          await sql`
            UPDATE public.kysely_migrations
            SET timestamp = CASE name
              WHEN ${supportedVersions.upstreamMigrations[0]} THEN '000001'
              WHEN ${supportedVersions.upstreamMigrations[1]} THEN '000000'
              ELSE timestamp
            END
            WHERE name IN (${supportedVersions.upstreamMigrations[0]}, ${supportedVersions.upstreamMigrations[1]})
          `.execute(db);
          break;
        }
        case 'partial': {
          await sql`
            DELETE FROM public.kysely_migrations
            WHERE name <> ${supportedVersions.upstreamMigrations[0]}
          `.execute(db);
          break;
        }
      }

      await expect(repository.assertCertifiedReturnLedger()).rejects.toThrow(/exact certified v3\.0\.3 ledger/);
    },
  );

  it('accepts exact v3.0.3 only while inactive at schema version 2 in maintenance mode', async () => {
    await expect(repository.getReturnEvidence()).resolves.toMatchObject({
      active: false,
      maintenanceMode: true,
      phase: 'inactive',
      schemaVersion: '2',
      supportedTag: 'v3.0.3',
      reconciliationStatus: 'not-started',
      appliedCheckpointId: expect.any(String),
      officialLedgerDigest: expect.stringMatching(/^[\da-f]{64}$/),
    });
  });

  it('rejects return evidence outside maintenance mode', async () => {
    await sql`
      UPDATE public.system_metadata SET value = '{"isMaintenanceMode":false}'::jsonb WHERE key = 'maintenance-mode'
    `.execute(db);

    await expect(repository.getReturnEvidence()).rejects.toThrow('maintenance mode');
  });

  it('rejects return evidence outside inactive schema version 2 state', async () => {
    await sql`UPDATE immich_fork.state SET phase = 'active', active = true WHERE id = 1`.execute(db);

    await expect(repository.getReturnEvidence()).rejects.toThrow('inactive schema version 2');
  });

  it('returns the applied official handoff checkpoint', async () => {
    await expect(repository.getOfficialHandoffCheckpoint()).resolves.toMatchObject({
      databaseBackupId: 'backup-1',
      id: expect.any(String),
      mediaSnapshotId: 'snapshot-1',
      reportDigest: 'a'.repeat(64),
    });
  });

  it.each(['missing-marker', 'fork-marker', 'gap', 'out-of-order', 'unknown'] as const)(
    'rejects a %s official handoff ledger before starting the official image',
    async (mutation) => {
      await seedOfficialHandoffPrefix();
      const marker = '1778614946174-UpdateWorkflowTables';
      switch (mutation) {
        case 'missing-marker': {
          await sql`DELETE FROM public.kysely_migrations WHERE name = ${marker}`.execute(db);
          break;
        }
        case 'fork-marker': {
          await sql`
            UPDATE public.kysely_migrations
            SET name = '1779400000000-UpdateWorkflowTables'
            WHERE name = ${marker}
          `.execute(db);
          break;
        }
        case 'gap': {
          await sql`
            DELETE FROM public.kysely_migrations
            WHERE name = ${supportedVersions.upstreamMigrations[10]}
          `.execute(db);
          break;
        }
        case 'out-of-order': {
          await sql`
            UPDATE public.kysely_migrations
            SET timestamp = CASE name
              WHEN ${supportedVersions.upstreamMigrations[0]} THEN '000001'
              WHEN ${supportedVersions.upstreamMigrations[1]} THEN '000000'
              ELSE timestamp
            END
            WHERE name IN (${supportedVersions.upstreamMigrations[0]}, ${supportedVersions.upstreamMigrations[1]})
          `.execute(db);
          break;
        }
        case 'unknown': {
          await sql`
            INSERT INTO public.kysely_migrations (name, timestamp)
            VALUES ('1779000000001-UnknownPatch', '999999')
          `.execute(db);
          break;
        }
      }

      const service = new ForkHandoffService(repository as never, {} as ForkSchemaMigrationService);
      await expect(service.prepareOfficial()).rejects.toThrow('exact certified v3.0.3 prefix through 177861');
    },
  );

  it('prepares the exact official image only from a fresh bound storage checkpoint without mutation', async () => {
    await seedOfficialHandoffPrefix();
    const runId = randomUUID();
    const emptyDigest = createHash('sha256').update('').digest('hex');
    await sql`
      INSERT INTO immich_fork.cutover_verification_run (
        id, "databaseBackupId", "snapshotId", status, "applicableAssetCount", "verifiedCount",
        "failureCount", "aggregateDigest", "completedAt"
      ) VALUES (${runId}::uuid, 'backup-1', 'snapshot-1', 'completed', 0, 0, 0, ${emptyDigest}, now())
    `.execute(db);
    await sql`
      UPDATE immich_fork.migration_audit
      SET details = details || jsonb_build_object(
        'storageVerificationRunId', ${runId}::text,
        'storageVerificationDigest', ${emptyDigest}::text,
        'storageVerificationAssetCount', 0
      )
      WHERE name = 'fork-schema-cutover'
    `.execute(db);
    StorageCore.setMediaLocation('/usr/src/app/upload');
    const stateBefore = await forkSchemaRepository.getState();
    const service = new ForkHandoffService(repository as never, {} as ForkSchemaMigrationService);

    await expect(service.prepareOfficial()).resolves.toMatchObject({
      databaseBackupId: 'backup-1',
      mediaSnapshotId: 'snapshot-1',
      officialImage: 'ghcr.io/immich-app/immich-server:v3.0.3',
      storageVerificationDigest: emptyDigest,
      storageVerificationAssetCount: 0,
      storageVerificationRunId: runId,
    });
    await expect(forkSchemaRepository.getState()).resolves.toEqual(stateBefore);
  });

  it('prepares official evidence and checkpoint from one repeatable read snapshot', async () => {
    await seedOfficialHandoffPrefix();
    const firstRunId = randomUUID();
    const secondRunId = randomUUID();
    const emptyDigest = createHash('sha256').update('').digest('hex');
    await sql`
      INSERT INTO immich_fork.cutover_verification_run (
        id, "databaseBackupId", "snapshotId", status, "applicableAssetCount", "verifiedCount",
        "failureCount", "aggregateDigest", "completedAt"
      ) VALUES
        (${firstRunId}::uuid, 'backup-1', 'snapshot-1', 'completed', 0, 0, 0, ${emptyDigest}, now()),
        (${secondRunId}::uuid, 'backup-1', 'snapshot-1', 'completed', 0, 0, 0, ${emptyDigest}, now())
    `.execute(db);
    await sql`
      UPDATE immich_fork.migration_audit
      SET details = details || jsonb_build_object(
        'storageVerificationRunId', ${firstRunId}::text,
        'storageVerificationDigest', ${emptyDigest}::text,
        'storageVerificationAssetCount', 0
      )
      WHERE name = 'fork-schema-cutover'
    `.execute(db);
    StorageCore.setMediaLocation('/usr/src/app/upload');
    const pausing = new PausingForkHandoffRepository(db);
    const writerDb = await connectToSameDatabase(db);
    const evidenceReached = deferred();
    const releaseEvidence = deferred();
    pausing.onOfficialHandoffReady = async () => {
      evidenceReached.resolve();
      await releaseEvidence.promise;
    };
    const service = new ForkHandoffService(pausing as never, {} as ForkSchemaMigrationService);
    const preparation = service.prepareOfficial();
    try {
      await evidenceReached.promise;
      await sql`
        UPDATE immich_fork.migration_audit
        SET details = details || jsonb_build_object('storageVerificationRunId', ${secondRunId}::text)
        WHERE name = 'fork-schema-cutover'
      `.execute(writerDb);
      releaseEvidence.resolve();

      await expect(preparation).resolves.toMatchObject({ storageVerificationRunId: firstRunId });
    } finally {
      releaseEvidence.resolve();
      await Promise.allSettled([preparation]);
      await writerDb.destroy();
    }
  });

  it('rejects official preparation without a fresh bound storage checkpoint', async () => {
    const service = new ForkHandoffService(repository as never, {} as ForkSchemaMigrationService);

    await expect(service.prepareOfficial()).rejects.toThrow('bound storage verification checkpoint');
  });

  it('starts a fresh inactive reconciliation once and resumes exact progress after interruption', async () => {
    await sql`
      INSERT INTO immich_fork.backfill_progress (kind, cursor, processed, remaining, digest)
      VALUES ('privacy', 'old-cursor', 99, 0, ${'f'.repeat(64)})
    `.execute(db);

    await forkSchemaRepository.beginOrResumeReturnReconciliation();

    const initialized = await forkSchemaRepository.getProgress();
    expect(initialized.map(({ kind }) => kind).toSorted()).toEqual([...BACKFILL_KINDS].toSorted());
    expect(initialized).toHaveLength(BACKFILL_KINDS.length);
    expect(initialized.every(({ cursor, processed }) => cursor === null && processed === 0)).toBe(true);
    await sql`
      UPDATE immich_fork.backfill_progress
      SET cursor = 'completed-cursor', processed = 1, remaining = 0, digest = ${'a'.repeat(64)}
      WHERE kind = 'privacy'
    `.execute(db);

    await forkSchemaRepository.beginOrResumeReturnReconciliation();

    await expect(forkSchemaRepository.getProgress()).resolves.toContainEqual(
      expect.objectContaining({
        kind: 'privacy',
        cursor: 'completed-cursor',
        processed: 1,
        remaining: 0,
        digest: 'a'.repeat(64),
      }),
    );
    const audits = await sql<{ count: number }>`
      SELECT count(*)::int AS count
      FROM immich_fork.migration_audit
      WHERE name = 'fork-return-reconciliation' AND phase = 'inactive' AND status = 'running'
    `.execute(db);
    expect(audits.rows[0]?.count).toBe(1);
  });

  it('claims return batches only in inactive mode with a running reconciliation audit', async () => {
    await forkSchemaRepository.beginOrResumeReturnReconciliation();
    await expect(forkSchemaRepository.claimReturnBatch('privacy', 1)).resolves.toBeNull();
    await sql`
      UPDATE immich_fork.migration_audit SET status = 'failed'
      WHERE name = 'fork-return-reconciliation'
    `.execute(db);
    await expect(forkSchemaRepository.claimReturnBatch('privacy', 1)).rejects.toThrow('running return reconciliation');
    await sql`UPDATE immich_fork.state SET phase = 'dual-write' WHERE id = 1`.execute(db);
    await expect(forkSchemaRepository.claimReturnBatch('privacy', 1)).rejects.toThrow('inactive phase');
  });

  it('fails closed instead of resuming a non-exact return progress set', async () => {
    await forkSchemaRepository.beginOrResumeReturnReconciliation();
    await sql`INSERT INTO immich_fork.backfill_progress (kind, remaining) VALUES ('unknown', 0)`.execute(db);

    await expect(forkSchemaRepository.beginOrResumeReturnReconciliation()).rejects.toThrow(
      'exact fork return progress set',
    );
  });

  it('preserves smart-album matches and exclusions whose parent fork rule and upstream records exist', async () => {
    const user = mediumFactory.userInsert();
    const asset = mediumFactory.assetInsert({ ownerId: user.id });
    const album = mediumFactory.albumInsert({});
    const ruleId = randomUUID();
    await db.insertInto('user').values(user).execute();
    await db.insertInto('asset').values(asset).execute();
    await db.insertInto('album').values(album).execute();
    await sql`
      INSERT INTO immich_fork.smart_album_rule (id, "albumId", "ownerId", kind)
      VALUES (${ruleId}::uuid, ${album.id}::uuid, ${user.id}::uuid, 'certified')
    `.execute(db);
    await sql`
      INSERT INTO immich_fork.smart_album_match ("smartAlbumId", "assetId", "matchReason")
      VALUES (${ruleId}::uuid, ${asset.id}::uuid, 'both')
    `.execute(db);
    await sql`
      INSERT INTO immich_fork.smart_album_exclusion ("smartAlbumId", "assetId")
      VALUES (${ruleId}::uuid, ${asset.id}::uuid)
    `.execute(db);

    await expect(repository.archiveAndDeleteOrphans()).resolves.toEqual({ archived: 0, deleted: 0 });
    const rows = await sql<{ exclusions: number; matches: number; rules: number }>`
      SELECT
        (SELECT count(*)::int FROM immich_fork.smart_album_rule) AS rules,
        (SELECT count(*)::int FROM immich_fork.smart_album_match) AS matches,
        (SELECT count(*)::int FROM immich_fork.smart_album_exclusion) AS exclusions
    `.execute(db);
    expect(rows.rows[0]).toEqual({ exclusions: 1, matches: 1, rules: 1 });
  });

  it('archives smart-album rules and children when only the upstream album is deleted', async () => {
    const user = mediumFactory.userInsert();
    const asset = mediumFactory.assetInsert({ ownerId: user.id });
    const album = mediumFactory.albumInsert({});
    const ruleId = randomUUID();
    await db.insertInto('user').values(user).execute();
    await db.insertInto('asset').values(asset).execute();
    await db.insertInto('album').values(album).execute();
    await sql`
      INSERT INTO immich_fork.smart_album_rule (id, "albumId", "ownerId", kind)
      VALUES (${ruleId}::uuid, ${album.id}::uuid, ${user.id}::uuid, 'certified')
    `.execute(db);
    await sql`
      INSERT INTO immich_fork.smart_album_match ("smartAlbumId", "assetId", "matchReason")
      VALUES (${ruleId}::uuid, ${asset.id}::uuid, 'both')
    `.execute(db);
    await sql`
      INSERT INTO immich_fork.smart_album_exclusion ("smartAlbumId", "assetId")
      VALUES (${ruleId}::uuid, ${asset.id}::uuid)
    `.execute(db);
    await db.deleteFrom('album').where('id', '=', album.id).execute();

    await expect(repository.archiveAndDeleteOrphans()).resolves.toEqual({ archived: 3, deleted: 3 });
    const live = await sql<{ exclusions: number; matches: number; rules: number }>`
      SELECT
        (SELECT count(*)::int FROM immich_fork.smart_album_rule) AS rules,
        (SELECT count(*)::int FROM immich_fork.smart_album_match) AS matches,
        (SELECT count(*)::int FROM immich_fork.smart_album_exclusion) AS exclusions
    `.execute(db);
    expect(live.rows[0]).toEqual({ exclusions: 0, matches: 0, rules: 0 });
  });

  it.each([
    ['asset_privacy missing asset', 'asset_privacy'],
    ['album_metadata missing album', 'album_metadata'],
    ['album_metadata missing parent', 'album_metadata'],
    ['album_closure missing ancestor', 'album_closure'],
    ['album_closure missing descendant', 'album_closure'],
    ['asset_enrichment missing asset', 'asset_enrichment'],
    ['smart_album_rule missing album', 'smart_album_rule'],
    ['smart_album_match missing rule', 'smart_album_match'],
    ['smart_album_match missing asset', 'smart_album_match'],
    ['smart_album_exclusion missing rule', 'smart_album_exclusion'],
    ['smart_album_exclusion missing asset', 'smart_album_exclusion'],
    ['asset_health missing asset', 'asset_health'],
    ['asset_health_candidate missing health', 'asset_health_candidate'],
    ['asset_health_run without health', 'asset_health_run'],
    ['asset_best_photo_score missing asset', 'asset_best_photo_score'],
    ['asset_video_duplicate_frame missing asset', 'asset_video_duplicate_frame'],
    ['asset_checksum missing asset', 'asset_checksum'],
    ['asset_physical_file missing asset', 'asset_physical_file'],
    ['asset_physical_file missing physical file', 'asset_physical_file'],
    ['asset_storage_reservation missing asset', 'asset_storage_reservation'],
    ['physical_file missing canonical asset', 'physical_file'],
    ['physical_file null canonical asset', 'physical_file'],
  ] as const)('independently archives and deletes %s', async (predicate, sourceTable) => {
    const user = mediumFactory.userInsert();
    const asset = mediumFactory.assetInsert({ ownerId: user.id });
    const album = mediumFactory.albumInsert({});
    const orphanAssetId = randomUUID();
    const orphanAlbumId = randomUUID();
    const physicalFileId = randomUUID();
    const now = new Date('2026-07-16T12:00:00.000Z');
    const bytes = Buffer.from('orphan');
    const vector = `[${Array.from({ length: 512 }, (_, index) => (index === 0 ? 1 : 0)).join(',')}]`;
    await db.insertInto('user').values(user).execute();
    await db.insertInto('asset').values(asset).execute();
    await db.insertInto('album').values(album).execute();

    switch (predicate) {
      case 'asset_privacy missing asset': {
        await sql`INSERT INTO immich_fork.asset_privacy ("assetId") VALUES (${orphanAssetId}::uuid)`.execute(db);
        break;
      }
      case 'album_metadata missing album': {
        await sql`INSERT INTO immich_fork.album_metadata ("albumId") VALUES (${orphanAlbumId}::uuid)`.execute(db);
        break;
      }
      case 'album_metadata missing parent': {
        await sql`INSERT INTO immich_fork.album_metadata ("albumId", "parentId") VALUES (${album.id}::uuid, ${orphanAlbumId}::uuid)`.execute(
          db,
        );
        break;
      }
      case 'album_closure missing ancestor': {
        await sql`INSERT INTO immich_fork.album_closure ("ancestorId", "descendantId") VALUES (${orphanAlbumId}::uuid, ${album.id}::uuid)`.execute(
          db,
        );
        break;
      }
      case 'album_closure missing descendant': {
        await sql`INSERT INTO immich_fork.album_closure ("ancestorId", "descendantId") VALUES (${album.id}::uuid, ${orphanAlbumId}::uuid)`.execute(
          db,
        );
        break;
      }
      case 'asset_enrichment missing asset': {
        await sql`INSERT INTO immich_fork.asset_enrichment ("assetId") VALUES (${orphanAssetId}::uuid)`.execute(db);
        break;
      }
      case 'smart_album_rule missing album': {
        await sql`INSERT INTO immich_fork.smart_album_rule (id, "albumId", "ownerId", kind) VALUES (${randomUUID()}::uuid, ${orphanAlbumId}::uuid, ${user.id}::uuid, 'review')`.execute(
          db,
        );
        break;
      }
      case 'smart_album_match missing rule': {
        await sql`INSERT INTO immich_fork.smart_album_match ("smartAlbumId", "assetId", "matchReason") VALUES (${orphanAlbumId}::uuid, ${asset.id}::uuid, 'tag')`.execute(
          db,
        );
        break;
      }
      case 'smart_album_match missing asset': {
        await sql`INSERT INTO immich_fork.smart_album_match ("smartAlbumId", "assetId", "matchReason") VALUES (${album.id}::uuid, ${orphanAssetId}::uuid, 'tag')`.execute(
          db,
        );
        break;
      }
      case 'smart_album_exclusion missing rule': {
        await sql`INSERT INTO immich_fork.smart_album_exclusion ("smartAlbumId", "assetId") VALUES (${orphanAlbumId}::uuid, ${asset.id}::uuid)`.execute(
          db,
        );
        break;
      }
      case 'smart_album_exclusion missing asset': {
        await sql`INSERT INTO immich_fork.smart_album_exclusion ("smartAlbumId", "assetId") VALUES (${album.id}::uuid, ${orphanAssetId}::uuid)`.execute(
          db,
        );
        break;
      }
      case 'asset_health missing asset': {
        await sql`INSERT INTO immich_fork.asset_health (id, "assetId", category, status, severity, "originalPath", "originalFileName", evidence, resolution, "checkedAt") VALUES (${randomUUID()}::uuid, ${orphanAssetId}::uuid, 'missing', 'missing', 'warning', '/orphan.jpg', 'orphan.jpg', '{}'::jsonb, '{}'::jsonb, ${now})`.execute(
          db,
        );
        break;
      }
      case 'asset_health_candidate missing health': {
        await sql`INSERT INTO immich_fork.asset_health_candidate (id, "healthId", "candidatePath", status, evidence, resolution, "checkedAt") VALUES (${randomUUID()}::uuid, ${randomUUID()}::uuid, '/candidate.jpg', 'candidate', '{}'::jsonb, '{}'::jsonb, ${now})`.execute(
          db,
        );
        break;
      }
      case 'asset_health_run without health': {
        await sql`INSERT INTO immich_fork.asset_health_run (id, category, status) VALUES (${randomUUID()}::uuid, 'missing', 'completed')`.execute(
          db,
        );
        break;
      }
      case 'asset_best_photo_score missing asset': {
        await sql`INSERT INTO immich_fork.asset_best_photo_score ("assetId", "ownerId", score, "scoreVersion", "computedAt") VALUES (${orphanAssetId}::uuid, ${user.id}::uuid, 0.5, 1, ${now})`.execute(
          db,
        );
        break;
      }
      case 'asset_video_duplicate_frame missing asset': {
        await sql`INSERT INTO immich_fork.asset_video_duplicate_frame ("assetId", "frameIndex", "timestampMs", path, embedding) VALUES (${orphanAssetId}::uuid, 0, 0, '/frame.jpg', ${vector}::vector)`.execute(
          db,
        );
        break;
      }
      case 'asset_checksum missing asset': {
        await sql`INSERT INTO immich_fork.asset_checksum ("assetId", sha1, sha256, "sizeInBytes", "verifiedPaths", "linkCount") VALUES (${orphanAssetId}::uuid, ${bytes}, ${bytes}, 6, ARRAY['/orphan.jpg'], 1)`.execute(
          db,
        );
        break;
      }
      case 'asset_physical_file missing asset': {
        await sql`INSERT INTO immich_fork.asset_physical_file ("assetId", "upstreamPath") VALUES (${orphanAssetId}::uuid, '/orphan.jpg')`.execute(
          db,
        );
        break;
      }
      case 'asset_physical_file missing physical file': {
        await sql`INSERT INTO immich_fork.asset_physical_file ("assetId", "physicalFileId", "upstreamPath") VALUES (${asset.id}::uuid, ${physicalFileId}::uuid, '/orphan.jpg')`.execute(
          db,
        );
        break;
      }
      case 'asset_storage_reservation missing asset': {
        await sql`INSERT INTO immich_fork.asset_storage_reservation ("assetId", token, "sourcePath", "upstreamPath", "temporaryPath", status) VALUES (${orphanAssetId}::uuid, ${randomUUID()}::uuid, '/source', '/upstream', '/temp', 'reserved')`.execute(
          db,
        );
        break;
      }
      case 'physical_file missing canonical asset': {
        await sql`INSERT INTO immich_fork.physical_file (id, "canonicalAssetId", type, checksum, "sizeInBytes", "canonicalPath", "createdAt", "updatedAt") VALUES (${physicalFileId}::uuid, ${orphanAssetId}::uuid, 'original', ${bytes}, 6, '/orphan.jpg', ${now}, ${now})`.execute(
          db,
        );
        break;
      }
      case 'physical_file null canonical asset': {
        await sql`INSERT INTO immich_fork.physical_file (id, "canonicalAssetId", type, checksum, "sizeInBytes", "canonicalPath", "createdAt", "updatedAt") VALUES (${physicalFileId}::uuid, NULL, 'original', ${bytes}, 6, '/orphan.jpg', ${now}, ${now})`.execute(
          db,
        );
        break;
      }
    }

    await repository.archiveAndDeleteOrphans();
    await expect(
      sql<{ count: number }>`
      SELECT count(*)::int AS count FROM immich_fork.orphaned_records WHERE "sourceTable" = ${sourceTable}
    `.execute(db),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it('blocks an exact-backend-PID orphan writer through the final verification and commit', async () => {
    const pausing = new PausingForkHandoffRepository(db);
    const writerDb = await connectToSameDatabase(db);
    const mayWrite = deferred();
    const writerPid = deferred<number>();
    const release = deferred();
    let writerCompleted = false;
    let locksReached = false;
    const writer = writerDb.connection().execute(async (connection) => {
      const backend = await sql<{ pid: number }>`SELECT pg_backend_pid()::int AS pid`.execute(connection);
      writerPid.resolve(backend.rows[0]!.pid);
      await mayWrite.promise;
      await sql`INSERT INTO immich_fork.asset_privacy ("assetId") VALUES (${randomUUID()}::uuid)`.execute(connection);
      writerCompleted = true;
    });
    const pid = await writerPid.promise;
    pausing.onLocks = async (transaction) => {
      locksReached = true;
      mayWrite.resolve();
      expect(await waitForWriter(transaction, pid, 'asset_privacy')).toEqual({
        granted: false,
        mode: 'RowExclusiveLock',
        waitEvent: 'relation',
        waitEventType: 'Lock',
      });
      expect(writerCompleted).toBe(false);
      await release.promise;
    };
    const reconciliation = pausing.archiveAndDeleteOrphans();
    try {
      expect(await waitForCondition(() => locksReached)).toBe(true);
      expect(writerCompleted).toBe(false);
      release.resolve();
      await reconciliation;
      await writer;
      expect(writerCompleted).toBe(true);
    } finally {
      mayWrite.resolve();
      release.resolve();
      await Promise.allSettled([reconciliation, writer]);
      await writerDb.destroy();
    }
  }, 10_000);

  it('archives before deleting every orphan sidecar family and preserves workflow/plugin bytes and catalog', async () => {
    const assetId = randomUUID();
    const albumId = randomUUID();
    const ruleId = randomUUID();
    const runId = randomUUID();
    const healthId = randomUUID();
    const candidateId = randomUUID();
    const physicalFileId = randomUUID();
    const now = new Date('2026-07-16T12:00:00.000Z');
    const vector = `[${Array.from({ length: 512 }, (_, index) => (index === 0 ? 1 : 0)).join(',')}]`;
    const bytes = Buffer.from('orphan');
    await sql`INSERT INTO immich_fork.asset_privacy ("assetId") VALUES (${assetId}::uuid)`.execute(db);
    await sql`INSERT INTO immich_fork.album_metadata ("albumId", "parentId") VALUES (${albumId}::uuid, ${albumId}::uuid)`.execute(
      db,
    );
    await sql`INSERT INTO immich_fork.album_closure ("ancestorId", "descendantId") VALUES (${albumId}::uuid, ${albumId}::uuid)`.execute(
      db,
    );
    await sql`INSERT INTO immich_fork.asset_enrichment ("assetId") VALUES (${assetId}::uuid)`.execute(db);
    await sql`
      INSERT INTO immich_fork.smart_album_rule (id, "albumId", "ownerId", kind)
      VALUES (${ruleId}::uuid, ${albumId}::uuid, ${randomUUID()}::uuid, 'review')
    `.execute(db);
    await sql`
      INSERT INTO immich_fork.smart_album_match ("smartAlbumId", "assetId", "matchReason")
      VALUES (${albumId}::uuid, ${assetId}::uuid, 'tag')
    `.execute(db);
    await sql`
      INSERT INTO immich_fork.smart_album_exclusion ("smartAlbumId", "assetId")
      VALUES (${albumId}::uuid, ${assetId}::uuid)
    `.execute(db);
    await sql`
      INSERT INTO immich_fork.asset_health_run (id, category, status)
      VALUES (${runId}::uuid, 'missing', 'completed')
    `.execute(db);
    await sql`
      INSERT INTO immich_fork.asset_health
        (id, "assetId", "runId", category, status, severity, "originalPath", "originalFileName", evidence,
         resolution, "checkedAt")
      VALUES (${healthId}::uuid, ${assetId}::uuid, ${runId}::uuid, 'missing', 'missing', 'warning', '/orphan.jpg',
        'orphan.jpg', '{}'::jsonb, '{}'::jsonb, ${now})
    `.execute(db);
    await sql`
      INSERT INTO immich_fork.asset_health_candidate
        (id, "healthId", "candidatePath", status, evidence, resolution, "checkedAt")
      VALUES (${candidateId}::uuid, ${healthId}::uuid, '/candidate.jpg', 'candidate', '{}'::jsonb, '{}'::jsonb, ${now})
    `.execute(db);
    await sql`
      INSERT INTO immich_fork.asset_best_photo_score ("assetId", "ownerId", score, "scoreVersion", "computedAt")
      VALUES (${assetId}::uuid, ${randomUUID()}::uuid, 0.5, 1, ${now})
    `.execute(db);
    await sql`
      INSERT INTO immich_fork.asset_video_duplicate_frame ("assetId", "frameIndex", "timestampMs", path, embedding)
      VALUES (${assetId}::uuid, 0, 0, '/frame.jpg', ${vector}::vector)
    `.execute(db);
    await sql`
      INSERT INTO immich_fork.asset_checksum
        ("assetId", sha1, sha256, "sizeInBytes", "verifiedPaths", "linkCount")
      VALUES (${assetId}::uuid, ${bytes}, ${bytes}, 6, ARRAY['/orphan.jpg'], 1)
    `.execute(db);
    await sql`
      INSERT INTO immich_fork.physical_file
        (id, "canonicalAssetId", type, checksum, "sizeInBytes", "canonicalPath", "createdAt", "updatedAt")
      VALUES (${physicalFileId}::uuid, ${assetId}::uuid, 'original', ${bytes}, 6, '/orphan.jpg', ${now}, ${now})
    `.execute(db);
    await sql`
      INSERT INTO immich_fork.asset_physical_file ("assetId", "physicalFileId", "upstreamPath")
      VALUES (${assetId}::uuid, ${physicalFileId}::uuid, '/orphan.jpg')
    `.execute(db);
    await sql`
      INSERT INTO immich_fork.asset_storage_reservation
        ("assetId", token, "sourcePath", "upstreamPath", "temporaryPath", status)
      VALUES (${assetId}::uuid, ${randomUUID()}::uuid, '/source.jpg', '/upstream.jpg', '/temporary.jpg', 'reserved')
    `.execute(db);
    await sql`INSERT INTO immich_fork.config (key, value) VALUES ('smartAlbums', '{"enabled":true}'::jsonb)`.execute(
      db,
    );
    const workflowBefore = await getWorkflowCompatibilityEvidence(db);

    await expect(repository.archiveAndDeleteOrphans()).resolves.toEqual({ archived: 16, deleted: 16 });

    const archived = await sql<{ sourceTable: string }>`
      SELECT "sourceTable" FROM immich_fork.orphaned_records ORDER BY "sourceTable"
    `.execute(db);
    expect(archived.rows.map(({ sourceTable }) => sourceTable)).toEqual(
      [
        'album_closure',
        'album_metadata',
        'asset_best_photo_score',
        'asset_checksum',
        'asset_enrichment',
        'asset_health',
        'asset_health_candidate',
        'asset_health_run',
        'asset_physical_file',
        'asset_privacy',
        'asset_storage_reservation',
        'asset_video_duplicate_frame',
        'physical_file',
        'smart_album_exclusion',
        'smart_album_match',
        'smart_album_rule',
      ].toSorted(),
    );
    await expect(
      sql<{ count: number }>`
      SELECT count(*)::int AS count FROM immich_fork.config WHERE key = 'smartAlbums'
    `.execute(db),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
    expect(await getWorkflowCompatibilityEvidence(db)).toEqual(workflowBefore);
  });

  it('seeds non-authoritative defaults for IDs created by the official image and keeps workflow bytes unchanged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'immich-return-defaults-'));
    StorageCore.setMediaLocation(root);
    try {
      const bytes = Buffer.from('official-created-asset');
      const path = join(root, `${randomUUID()}.jpg`);
      await writeFile(path, bytes);
      const user = mediumFactory.userInsert();
      const asset = mediumFactory.assetInsert({
        ownerId: user.id,
        originalPath: path,
        checksum: createHash('sha1').update(bytes).digest(),
        checksumAlgorithm: ChecksumAlgorithm.sha1File,
      });
      const album = mediumFactory.albumInsert({});
      await db.insertInto('user').values(user).execute();
      await db.insertInto('asset').values(asset).execute();
      await db.insertInto('album').values(album).execute();
      await db.insertInto('album_closure').values({ id_ancestor: album.id!, id_descendant: album.id! }).execute();
      const workflowBefore = await getWorkflowCompatibilityEvidence(db);
      const { sut } = newTestService(ForkSchemaMigrationService, { forkSchema: forkSchemaRepository });
      (sut as unknown as { db: Kysely<DB> }).db = db;
      sut.onModuleInit();
      StorageCore.setMediaLocation(root);

      const result = await sut.reconcileAfterOfficialReturn(1);

      expect(result).toMatchObject({ active: false, phase: 'inactive', verified: true });
      await expect(
        sql<{ count: number }>`
        SELECT count(*)::int AS count FROM immich_fork.asset_privacy
        WHERE "assetId" = ${asset.id}::uuid AND "isNsfw" = false AND suppression IS NULL
      `.execute(db),
      ).resolves.toMatchObject({ rows: [{ count: 1 }] });
      await expect(
        sql<{ count: number }>`
        SELECT count(*)::int AS count FROM immich_fork.asset_enrichment
        WHERE "assetId" = ${asset.id}::uuid AND "userDescription" = '' AND "generatedDescription" IS NULL
          AND "generatedTags" = '[]'::jsonb AND "requiresReview" = false
      `.execute(db),
      ).resolves.toMatchObject({ rows: [{ count: 1 }] });
      await expect(
        sql<{ count: number }>`
        SELECT count(*)::int AS count FROM immich_fork.album_metadata
        WHERE "albumId" = ${album.id}::uuid AND "parentId" IS NULL AND icon IS NULL AND "sortOrder" IS NULL
      `.execute(db),
      ).resolves.toMatchObject({ rows: [{ count: 1 }] });
      await expect(
        sql<{ count: number }>`
        SELECT count(*)::int AS count FROM immich_fork.album_closure
        WHERE "ancestorId" = ${album.id}::uuid AND "descendantId" = ${album.id}::uuid
      `.execute(db),
      ).resolves.toMatchObject({ rows: [{ count: 1 }] });
      await expect(
        sql<{ config: number; checksum: number; mapping: number; reservation: number }>`SELECT
        (SELECT count(*)::int FROM immich_fork.config) AS config,
        (SELECT count(*)::int FROM immich_fork.asset_checksum WHERE "assetId" = ${asset.id}::uuid) AS checksum,
        (SELECT count(*)::int FROM immich_fork.asset_physical_file WHERE "assetId" = ${asset.id}::uuid) AS mapping,
        (SELECT count(*)::int FROM immich_fork.asset_storage_reservation WHERE "assetId" = ${asset.id}::uuid) AS reservation
      `.execute(db),
      ).resolves.toMatchObject({ rows: [{ config: 2, checksum: 1, mapping: 1, reservation: 0 }] });
      expect(await getWorkflowCompatibilityEvidence(db)).toEqual(workflowBefore);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('keeps ordinary inactive storage blocked during reconciliation and fences return storage to the durable claim', async () => {
    const root = await mkdtemp(join(tmpdir(), 'immich-return-storage-capability-'));
    StorageCore.setMediaLocation(root);
    try {
      const bytes = Buffer.from('claimed-storage-asset');
      const path = join(root, 'claimed.jpg');
      const unclaimedBytes = Buffer.from('unclaimed-storage-asset');
      const unclaimedPath = join(root, 'unclaimed.jpg');
      await writeFile(path, bytes);
      await writeFile(unclaimedPath, unclaimedBytes);
      const user = mediumFactory.userInsert();
      const claimed = mediumFactory.assetInsert({
        ownerId: user.id,
        originalPath: path,
        checksum: createHash('sha1').update(bytes).digest(),
        checksumAlgorithm: ChecksumAlgorithm.sha1File,
      });
      const unclaimed = mediumFactory.assetInsert({
        ownerId: user.id,
        originalPath: unclaimedPath,
        checksum: createHash('sha1').update(unclaimedBytes).digest(),
        checksumAlgorithm: ChecksumAlgorithm.sha1File,
      });
      await db.insertInto('user').values(user).execute();
      await db.insertInto('asset').values([claimed, unclaimed]).execute();
      await forkSchemaRepository.beginOrResumeReturnReconciliation();
      const claim = await forkSchemaRepository.claimReturnBatch('storage', 1);
      expect(claim).not.toBeNull();
      const claimedId = claim!.ids[0]!;
      const unclaimedId = [claimed.id!, unclaimed.id!].find((id) => id !== claimedId)!;
      const normalization = new ForkStorageNormalizationService(db);
      const repository = new PhysicalFileRepository(db);

      await expect(normalization.normalizeBatch([claimedId])).rejects.toThrow('current phase');
      await expect(
        repository.createReturnNormalizationReservation(claimedId, (asset) => asset.originalPath, {
          kind: 'storage',
          claimToken: 'wrong-token',
          claimedIds: claim!.ids,
        }),
      ).rejects.toThrow('durable return storage claim');
      await expect(
        repository.createReturnNormalizationReservation(claimedId, (asset) => asset.originalPath, {
          kind: 'checksum',
          claimToken: claim!.cursor,
          claimedIds: claim!.ids,
        }),
      ).rejects.toThrow('durable return storage claim');
      await expect(
        repository.createReturnNormalizationReservation(unclaimedId, (asset) => asset.originalPath, {
          kind: 'storage',
          claimToken: claim!.cursor,
          claimedIds: [unclaimedId],
        }),
      ).rejects.toThrow('durable return storage claim');

      await expect(
        normalization.normalizeBatch(claim!.ids, {
          kind: 'storage',
          claimToken: claim!.cursor,
          claimedIds: claim!.ids,
        }),
      ).resolves.toMatchObject({ count: 1, digest: expect.stringMatching(/^[0-9a-f]{64}$/) });
      await expect(
        sql<{ count: number }>`
        SELECT count(*)::int AS count FROM immich_fork.asset_storage_reservation
      `.execute(db),
      ).resolves.toMatchObject({ rows: [{ count: 0 }] });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it.each([
    ['legacy', false],
    ['dual-write', true],
    ['ready', true],
    ['inactive', false],
    ['active', true],
    ['failed', false],
  ] as const)('applies ordinary storage authority in %s phase (allowed=%s)', async (phase, allowed) => {
    await sql`
      UPDATE immich_fork.state SET phase = ${phase}, active = ${phase === 'active'} WHERE id = 1
    `.execute(db);
    const action = new PhysicalFileRepository(db).createNormalizationReservation(
      '00000000-0000-4000-8000-000000000000',
      (asset) => asset.originalPath,
    );
    await (allowed
      ? expect(action).rejects.toThrow('does not exist')
      : expect(action).rejects.toThrow('current phase'));
  });

  it('holds the exact return claim through an in-flight run before allowing completion and replacement', async () => {
    const user = mediumFactory.userInsert();
    const assets = [
      mediumFactory.assetInsert({ ownerId: user.id, originalPath: '/claim-a.jpg' }),
      mediumFactory.assetInsert({ ownerId: user.id, originalPath: '/claim-b.jpg' }),
    ];
    await db.insertInto('user').values(user).execute();
    await db.insertInto('asset').values(assets).execute();
    await forkSchemaRepository.beginOrResumeReturnReconciliation();
    const first = await forkSchemaRepository.claimReturnBatch('storage', 1);
    expect(first).not.toBeNull();
    const firstCapability = { kind: 'storage' as const, claimToken: first!.cursor, claimedIds: first!.ids };
    const repository = new PausingPhysicalFileRepository(db);
    const prepared = await repository.createReturnNormalizationReservation(
      first!.ids[0]!,
      (asset) => asset.originalPath,
      firstCapability,
    );
    expect(prepared.status).toBe('reserved');
    if (prepared.status !== 'reserved') {
      throw new Error('Expected a storage reservation');
    }

    const authorityReached = deferred<number>();
    const releaseRun = deferred();
    repository.onAuthority = async (transaction, action) => {
      if (action !== 'run') {
        return;
      }
      const pid = await sql<{ pid: number }>`SELECT pg_backend_pid()::int AS pid`.execute(transaction);
      authorityReached.resolve(pid.rows[0]!.pid);
      await releaseRun.promise;
    };
    const run = repository.withLockedReturnNormalizationAsset(
      first!.ids[0]!,
      prepared.reservation.token,
      firstCapability,
      () => Promise.resolve(),
    );
    const observed = await Promise.race([authorityReached.promise.then(() => true), run.then(() => false)]);
    expect(observed).toBe(true);
    const workerPid = await authorityReached.promise;

    const writer = await connectToSameDatabase(db);
    try {
      const writerPid = await sql<{ pid: number }>`SELECT pg_backend_pid()::int AS pid`.execute(writer);
      const completion = new ForkSchemaRepository(writer).completeBatch('storage', first!.cursor, 1, 'd'.repeat(64));
      await expect(waitForBackendBlock(db, writerPid.rows[0]!.pid, workerPid)).resolves.toMatchObject({
        waitEventType: 'Lock',
      });
      releaseRun.resolve();
      await run;
      await completion;
    } finally {
      releaseRun.resolve();
      await writer.destroy();
    }

    const replacement = await forkSchemaRepository.claimReturnBatch('storage', 1);
    expect(replacement).not.toBeNull();
    await expect(
      repository.createReturnNormalizationReservation(
        replacement!.ids[0]!,
        (asset) => asset.originalPath,
        firstCapability,
      ),
    ).rejects.toThrow('durable return storage claim');
    const replacementCapability = {
      kind: 'storage' as const,
      claimToken: replacement!.cursor,
      claimedIds: replacement!.ids,
    };
    const replacementReservation = await repository.createReturnNormalizationReservation(
      replacement!.ids[0]!,
      (asset) => asset.originalPath,
      replacementCapability,
    );
    expect(replacementReservation.status).toBe('reserved');
  }, 15_000);

  it.each(['database', 'file'] as const)(
    'durably reconciles %s config with zero albums across interruptions before and after evidence',
    async (source) => {
      const expected = {
        ...defaults,
        smartAlbums: { ...defaults.smartAlbums, enabled: !defaults.smartAlbums.enabled },
      };
      await sql`
        INSERT INTO immich_fork.config (key, value) VALUES ('smartAlbums', '{"enabled":"stale"}'::jsonb)
      `.execute(db);
      const { sut, mocks } = newTestService(ForkSchemaMigrationService, { forkSchema: forkSchemaRepository });
      (sut as unknown as { db: Kysely<DB> }).db = db;
      mocks.systemMetadata.get.mockResolvedValue(source === 'database' ? { smartAlbums: expected.smartAlbums } : null);
      mocks.systemMetadata.readFile.mockResolvedValue(`smartAlbums:\n  enabled: ${expected.smartAlbums.enabled}\n`);
      mocks.config.getEnv.mockReturnValue({
        ...mocks.config.getEnv(),
        configFile: source === 'file' ? '/config/immich.yml' : undefined,
      });
      sut.onModuleInit();
      const official = await forkSchemaRepository.overlayConfig(expected);
      expect(official.smartAlbums).toEqual(expected.smartAlbums);

      await expect(
        sut.reconcileAfterOfficialReturn(1, {
          beforeConfigEvidence: () => {
            throw new Error('before-config-evidence');
          },
        }),
      ).rejects.toThrow('before-config-evidence');
      await expect(forkSchemaRepository.getReturnConfigReconciliation()).resolves.toBeNull();

      await expect(
        sut.reconcileAfterOfficialReturn(1, {
          afterConfigEvidence: () => {
            throw new Error('after-config-evidence');
          },
        }),
      ).rejects.toThrow('after-config-evidence');
      const evidence = await forkSchemaRepository.getReturnConfigReconciliation();
      expect(evidence).toMatchObject({ source, digest: expect.stringMatching(/^[0-9a-f]{64}$/) });

      const result = await sut.reconcileAfterOfficialReturn(1);
      expect(result.progress.find(({ kind }) => kind === 'automation')).toMatchObject({
        remaining: 0,
        digest: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      await expect(
        sql<{ value: unknown }>`
        SELECT value FROM immich_fork.config WHERE key = 'smartAlbums'
      `.execute(db),
      ).resolves.toMatchObject({ rows: [{ value: expected.smartAlbums }] });
      const effective = await forkSchemaRepository.overlayConfig(expected);
      expect(effective.smartAlbums).toEqual(expected.smartAlbums);

      const firstSuccessfulRun = await getReturnBytes(db);
      await expect(sut.reconcileAfterOfficialReturn(1)).resolves.toMatchObject({
        active: false,
        phase: 'inactive',
        verified: true,
      });
      expect(await getReturnBytes(db)).toEqual(firstSuccessfulRun);
      await sql`
        UPDATE immich_fork.backfill_progress SET digest = ${'e'.repeat(64)} WHERE kind = 'automation'
      `.execute(db);
      await expect(sut.reconcileAfterOfficialReturn(1)).rejects.toThrow('automation reconciliation evidence drifted');
    },
  );

  it('activates only in the final verified transaction', async () => {
    const { sut: migration, mocks } = newTestService(ForkSchemaMigrationService, {
      forkSchema: forkSchemaRepository,
    });
    (migration as unknown as { db: Kysely<DB> }).db = db;
    mocks.systemMetadata.get.mockResolvedValue({});
    migration.onModuleInit();
    const database = repository as unknown as ConstructorParameters<typeof ForkHandoffService>[0];
    (database as unknown as { withLock: <T>(_lock: unknown, callback: () => Promise<T>) => Promise<T> }).withLock =
      async (_lock, callback) => callback();
    const service = new ForkHandoffService(database, migration);

    const report = await service.prepareFork({ batchSize: 1 });

    expect(report).toMatchObject({ active: true, phase: 'active', supportedTag: 'v3.0.3' });
    await expect(forkSchemaRepository.getState()).resolves.toMatchObject({ active: true, phase: 'active' });
  });

  it('rolls back activation when final verification drifts', async () => {
    const { sut: migration, mocks } = newTestService(ForkSchemaMigrationService, {
      forkSchema: forkSchemaRepository,
    });
    (migration as unknown as { db: Kysely<DB> }).db = db;
    mocks.systemMetadata.get.mockResolvedValue({});
    migration.onModuleInit();
    const database = repository as unknown as ConstructorParameters<typeof ForkHandoffService>[0];
    (database as unknown as { withLock: <T>(_lock: unknown, callback: () => Promise<T>) => Promise<T> }).withLock =
      async (_lock, callback) => callback();
    const service = new ForkHandoffService(database, migration);

    await expect(
      service.prepareFork(
        { batchSize: 1 },
        {
          beforeActivate: async (transaction) => {
            await sql`
              UPDATE immich_fork.backfill_progress SET remaining = 1 WHERE kind = 'privacy'
            `.execute(transaction);
          },
        },
      ),
    ).rejects.toThrow('incomplete backfills');
    await expect(forkSchemaRepository.getState()).resolves.toMatchObject({ active: false, phase: 'inactive' });
  });

  it('rejects a source row inserted after reconciliation instead of sealing zero work', async () => {
    const user = mediumFactory.userInsert();
    const asset = mediumFactory.assetInsert({ ownerId: user.id });
    await db.insertInto('user').values(user).execute();
    const service = setupActivationService();

    await expect(
      service.prepareFork(
        { batchSize: 1 },
        {
          beforeActivate: async (transaction) => {
            await transaction.insertInto('asset').values(asset).execute();
          },
        },
      ),
    ).rejects.toThrow(/source|backfill|cardinality/);
    await expect(forkSchemaRepository.getState()).resolves.toMatchObject({ active: false, phase: 'inactive' });
    await expect(
      db
        .selectFrom('asset')
        .select(({ fn }) => fn.countAll<number>().as('count'))
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ count: 0 });
  });

  it('rejects a forged non-automation digest with valid hexadecimal shape', async () => {
    const service = setupActivationService();

    await expect(
      service.prepareFork(
        { batchSize: 1 },
        {
          beforeActivate: async (transaction) => {
            await sql`
              UPDATE immich_fork.backfill_progress SET digest = ${'f'.repeat(64)} WHERE kind = 'privacy'
            `.execute(transaction);
          },
        },
      ),
    ).rejects.toThrow(/digest|evidence|drift/);
    await expect(forkSchemaRepository.getState()).resolves.toMatchObject({ active: false, phase: 'inactive' });
  });

  it('rejects processed-count drift even when remaining is zero', async () => {
    const service = setupActivationService();

    await expect(
      service.prepareFork(
        { batchSize: 1 },
        {
          beforeActivate: async (transaction) => {
            await sql`
              UPDATE immich_fork.backfill_progress SET processed = processed + 1 WHERE kind = 'privacy'
            `.execute(transaction);
          },
        },
      ),
    ).rejects.toThrow(/processed|source|evidence|drift/);
    await expect(forkSchemaRepository.getState()).resolves.toMatchObject({ active: false, phase: 'inactive' });
  });

  it('fails closed when duplicate running return audits exist', async () => {
    const service = setupActivationService();

    await expect(
      service.prepareFork(
        { batchSize: 1 },
        {
          beforeActivate: async (transaction) => {
            await sql`
              INSERT INTO immich_fork.migration_audit (name, phase, status, details)
              VALUES (
                'fork-return-reconciliation',
                'inactive',
                'running',
                jsonb_build_object('backfillKinds', ${JSON.stringify([...BACKFILL_KINDS])}::jsonb)
              )
            `.execute(transaction);
          },
        },
      ),
    ).rejects.toThrow(/exactly one|single|duplicate|audit/);
    await expect(forkSchemaRepository.getState()).resolves.toMatchObject({ active: false, phase: 'inactive' });
    await expect(
      sql<{ count: number }>`
        SELECT count(*)::int AS count FROM immich_fork.migration_audit
        WHERE name = 'fork-return-reconciliation' AND phase = 'inactive' AND status = 'running'
      `.execute(db),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });
});
