import { Kysely, sql } from 'kysely';
import { LEGACY_FORK_MIGRATIONS } from 'src/fork-schema/migration-manifest';
import { OFFICIAL_WORKFLOW_MIGRATION } from 'src/fork-schema/workflow-compatibility';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { BACKFILL_KINDS } from 'src/repositories/fork-schema.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { ForkSchemaCutoverService } from 'src/services/fork-schema-cutover.service';
import { getKyselyConfig } from 'src/utils/database';
import { getKyselyDB, newTestService } from 'test/utils';

const NON_WORKFLOW_PROVIDER_GAPS = [
  '1780435471692-DeleteMismatchedAssetFaces',
  '1780592070031-ConvertNegativeRatingToNull',
  '1780592071031-AssetOcrSync',
  '1781089983296-CreateIntegrityReportTable',
  '1782500000000-RestoreLivePhotoStillVisibility',
] as const;

class FailingPreCommitRepository extends DatabaseRepository {
  protected override async finishForkSchemaCutover(transaction: Kysely<DB>): Promise<void> {
    await sql`CREATE TABLE cutover_should_rollback (id integer PRIMARY KEY)`.execute(transaction);
    throw new Error('synthetic pre-commit cutover failure');
  }
}

class TaskOneCutoverRepository extends DatabaseRepository {
  // Task 1 validates the pre-migrator ledger transaction. The official files
  // consumed after commit intentionally arrive in the later catch-up task.
  override runOfficialMigrations(): Promise<void> {
    return Promise.resolve();
  }
}

const connectToSameDatabase = async (db: Kysely<DB>): Promise<Kysely<DB>> => {
  const database = await sql<{ name: string }>`SELECT current_database() AS name`.execute(db);
  const url = process.env.IMMICH_TEST_POSTGRES_URL!.replace('/mich', `/${database.rows[0]!.name}`);
  return new Kysely<DB>(getKyselyConfig({ connectionType: 'url', url }));
};

const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => (resolve = resolvePromise));
  return { promise, resolve };
};

type WriterLockEvidence = {
  granted: boolean;
  mode: string;
  pid: number;
  relationName: string;
  waitEvent: string | null;
  waitEventType: string | null;
};

const waitForWriterLock = async (
  transaction: Kysely<DB>,
  writerPid: number,
  tableName: string,
): Promise<WriterLockEvidence> => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const waiting = await sql<WriterLockEvidence>`
      SELECT activity.pid, activity.wait_event_type AS "waitEventType", activity.wait_event AS "waitEvent",
        lock.mode, lock.granted, namespace.nspname || '.' || relation.relname AS "relationName"
      FROM pg_catalog.pg_stat_activity activity
      JOIN pg_catalog.pg_locks lock ON lock.pid = activity.pid
      JOIN pg_catalog.pg_class relation ON relation.oid = lock.relation
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE activity.pid = ${writerPid}
        AND lock.locktype = 'relation'
        AND namespace.nspname = 'public'
        AND relation.relname = ${tableName}
        AND NOT lock.granted
    `.execute(transaction);
    if (waiting.rows[0]) {
      return waiting.rows[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Writer backend ${writerPid} did not wait on public.${tableName} before the deadline`);
};

describe('fork schema ledger cutover', () => {
  let db: Kysely<DB>;
  let repository: DatabaseRepository;

  beforeAll(async () => {
    db = await getKyselyDB('ledger_cutover');
    repository = new TaskOneCutoverRepository(db, LoggingRepository.create(), new ConfigRepository());
  });

  afterAll(async () => db.destroy());

  beforeEach(async () => {
    await sql`DELETE FROM public.migration_overrides WHERE name = 'cutover_concurrency_probe'`.execute(db);
    await sql`
      DELETE FROM kysely_migrations
      WHERE name = '9999999999999-CustomPatch' OR name = ANY(${[...NON_WORKFLOW_PROVIDER_GAPS]})
    `.execute(db);
    await sql`DELETE FROM kysely_migrations WHERE name = ANY(${[...LEGACY_FORK_MIGRATIONS]})`.execute(db);
    await sql`
      INSERT INTO kysely_migrations (name, timestamp)
      VALUES (${OFFICIAL_WORKFLOW_MIGRATION}, '2099-07-15T00:00:00.000Z')
      ON CONFLICT (name) DO NOTHING
    `.execute(db);
    await sql`DROP TABLE IF EXISTS physical_file_unexpected`.execute(db);
    await sql`UPDATE immich_fork.state SET phase = 'ready', active = false, "schemaVersion" = '1' WHERE id = 1`.execute(
      db,
    );
    await sql`TRUNCATE immich_fork.migration_audit`.execute(db);
    await sql`TRUNCATE immich_fork.backfill_progress`.execute(db);
    await sql`
      INSERT INTO immich_fork.backfill_progress (kind, remaining, digest)
      SELECT kind, 0, ${'a'.repeat(64)}
      FROM unnest(${[...BACKFILL_KINDS]}::text[]) AS kind
    `.execute(db);
    await sql`
      INSERT INTO system_metadata (key, value)
      VALUES ('maintenance-mode', '{"isMaintenanceMode":true}'::jsonb)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `.execute(db);
  });

  it('keeps preflight strictly read-only', async () => {
    const before = await sql`
      SELECT 'official' AS source, name, timestamp::text AS value FROM public.kysely_migrations
      UNION ALL
      SELECT 'fork', name, timestamp::text FROM immich_fork.migrations
      UNION ALL
      SELECT 'state', id::text, row_to_json(state)::text FROM immich_fork.state state
      UNION ALL
      SELECT 'audit', id::text, row_to_json(audit)::text FROM immich_fork.migration_audit audit
      ORDER BY source, name, value
    `.execute(db);
    const { sut } = newTestService(ForkSchemaCutoverService, { database: repository });

    const report = await sut.preflight();

    const after = await sql`
      SELECT 'official' AS source, name, timestamp::text AS value FROM public.kysely_migrations
      UNION ALL
      SELECT 'fork', name, timestamp::text FROM immich_fork.migrations
      UNION ALL
      SELECT 'state', id::text, row_to_json(state)::text FROM immich_fork.state state
      UNION ALL
      SELECT 'audit', id::text, row_to_json(audit)::text FROM immich_fork.migration_audit audit
      ORDER BY source, name, value
    `.execute(db);
    expect(report.ready).toBe(true);
    expect(after.rows).toEqual(before.rows);
  });

  it('audits and removes only allowlisted legacy rows at a successful cutover', async () => {
    const legacyName = [...LEGACY_FORK_MIGRATIONS][0];
    const legacyTimestamp = new Date('2026-01-02T03:04:05.000Z').toISOString();
    await sql`
      INSERT INTO kysely_migrations (name, timestamp)
      VALUES (${legacyName}, ${legacyTimestamp})
    `.execute(db);
    const officialBefore = await sql<{ name: string }>`
      SELECT name FROM kysely_migrations
      WHERE name <> ${legacyName}
      ORDER BY name
    `.execute(db);
    const forkBefore = await sql<{ name: string }>`SELECT name FROM immich_fork.migrations ORDER BY name`.execute(db);
    const { sut } = newTestService(ForkSchemaCutoverService, { database: repository });
    const report = await sut.preflight();

    const checkpoint = await sut.apply(report.digest);

    const officialAfter = await sql<{ name: string }>`SELECT name FROM kysely_migrations ORDER BY name`.execute(db);
    const forkAfter = await sql<{ name: string }>`SELECT name FROM immich_fork.migrations ORDER BY name`.execute(db);
    const audit = await sql<{ details: { originalTimestamp: string; reportDigest: string }; name: string }>`
      SELECT name, details FROM immich_fork.migration_audit WHERE name = ${legacyName}
    `.execute(db);
    const state = await sql<{ active: boolean; phase: string; schemaVersion: string }>`
      SELECT active, phase, "schemaVersion" FROM immich_fork.state WHERE id = 1
    `.execute(db);
    expect(checkpoint).toEqual(
      expect.objectContaining({ phase: 'inactive', reportDigest: report.digest, schemaVersion: '2' }),
    );
    expect(officialAfter.rows).toEqual(officialBefore.rows);
    expect(forkAfter.rows).toEqual(forkBefore.rows);
    expect(audit.rows).toEqual([
      {
        details: { classification: 'legacy-fork', originalTimestamp: legacyTimestamp, reportDigest: report.digest },
        name: legacyName,
      },
    ]);
    expect(state.rows).toEqual([{ active: false, phase: 'inactive', schemaVersion: '2' }]);
  });

  it('keeps the ledger and phase unchanged when an unknown migration is found', async () => {
    await sql`
      INSERT INTO kysely_migrations (name, timestamp)
      VALUES ('9999999999999-CustomPatch', now()::text)
    `.execute(db);
    const beforeLedger = await sql`SELECT name, timestamp FROM kysely_migrations ORDER BY name`.execute(db);
    const { sut } = newTestService(ForkSchemaCutoverService, { database: repository });

    const report = await sut.preflight();
    await expect(sut.apply(report.digest)).rejects.toThrow('Unknown migration in kysely_migrations');

    const afterLedger = await sql`SELECT name, timestamp FROM kysely_migrations ORDER BY name`.execute(db);
    const state = await sql<{ phase: string }>`SELECT phase FROM immich_fork.state WHERE id = 1`.execute(db);
    expect(afterLedger.rows).toEqual(beforeLedger.rows);
    expect(state.rows[0]?.phase).toBe('ready');
  });

  it.each(NON_WORKFLOW_PROVIDER_GAPS)(
    'rejects provider-absent non-workflow migration %s on a current-fork installation',
    async (name) => {
      await sql`
      INSERT INTO kysely_migrations (name, timestamp)
      VALUES (${name}, '2026-07-15T00:00:01.000Z')
    `.execute(db);
      const { sut } = newTestService(ForkSchemaCutoverService, { database: repository });

      const report = await sut.preflight();

      expect(report.migrationOrderValid).toBe(false);
      expect(report.blockers).toContain(
        'Official migration ledger is not an exact ordered prefix of the bundled provider',
      );
    },
  );

  it('rolls back pre-commit DDL, ledger surgery, audit, and phase together', async () => {
    const failingRepository = new FailingPreCommitRepository(db, LoggingRepository.create(), new ConfigRepository());
    const beforeLedger = await sql`SELECT name, timestamp FROM kysely_migrations ORDER BY name`.execute(db);
    const { sut } = newTestService(ForkSchemaCutoverService, { database: failingRepository });
    const report = await sut.preflight();

    await expect(sut.apply(report.digest)).rejects.toThrow('synthetic pre-commit cutover failure');

    const afterLedger = await sql`SELECT name, timestamp FROM kysely_migrations ORDER BY name`.execute(db);
    const audit = await sql`SELECT * FROM immich_fork.migration_audit`.execute(db);
    const state = await sql<{ phase: string }>`SELECT phase FROM immich_fork.state WHERE id = 1`.execute(db);
    const marker = await sql<{ tableName: string | null }>`
      SELECT to_regclass('public.cutover_should_rollback')::text AS "tableName"
    `.execute(db);
    expect(marker.rows[0]?.tableName).toBeNull();
    expect(afterLedger.rows).toEqual(beforeLedger.rows);
    expect(audit.rows).toHaveLength(0);
    expect(state.rows[0]?.phase).toBe('ready');
  });

  it('locks migration overrides before reclassification so a concurrent writer cannot enter the alias window', async () => {
    const concurrentDb = await connectToSameDatabase(db);
    const writerMayStart = deferred();
    const writerPid = deferred<number>();
    const releaseVerification = deferred();
    const observedWaiting = deferred<WriterLockEvidence>();
    let writerCompleted = false;
    const writer = concurrentDb.connection().execute(async (connection) => {
      const backend = await sql<{ pid: number }>`SELECT pg_backend_pid()::int AS pid`.execute(connection);
      writerPid.resolve(backend.rows[0]!.pid);
      await writerMayStart.promise;
      await sql`
          INSERT INTO public.migration_overrides (name, value)
          VALUES ('cutover_concurrency_probe', '{"type":"trigger","name":"probe","sql":"SELECT 1"}'::jsonb)
        `.execute(connection);
      writerCompleted = true;
    });
    const exactWriterPid = await writerPid.promise;
    const cutover = repository.commitForkSchemaCutover('b'.repeat(64), 'current-fork', async (transaction) => {
      writerMayStart.resolve();
      observedWaiting.resolve(await waitForWriterLock(transaction, exactWriterPid, 'migration_overrides'));
      await releaseVerification.promise;
    });

    try {
      const evidence = await Promise.race([
        observedWaiting.promise,
        cutover.then(() => {
          throw new Error('Cutover completed before the writer lock was observed');
        }),
      ]);
      expect(evidence).toEqual({
        granted: false,
        mode: 'RowExclusiveLock',
        pid: exactWriterPid,
        relationName: 'public.migration_overrides',
        waitEvent: 'relation',
        waitEventType: 'Lock',
      });
      expect(writerCompleted).toBe(false);

      releaseVerification.resolve();
      await cutover;
      await writer;
      expect(writerCompleted).toBe(true);
      const inserted = await sql<{ count: number }>`
          SELECT count(*)::int AS count
          FROM public.migration_overrides
          WHERE name = 'cutover_concurrency_probe'
        `.execute(db);
      expect(inserted.rows).toEqual([{ count: 1 }]);
    } finally {
      writerMayStart.resolve();
      releaseVerification.resolve();
      await Promise.allSettled([cutover, writer]);
      await concurrentDb.destroy();
    }
  }, 10_000);

  it('locks every manifest table before evidence so a public user writer waits', async () => {
    const concurrentDb = await connectToSameDatabase(db);
    const writerMayStart = deferred();
    const writerPid = deferred<number>();
    const releaseVerification = deferred();
    const observedWaiting = deferred<WriterLockEvidence>();
    let writerCompleted = false;
    const writer = concurrentDb.connection().execute(async (connection) => {
      const backend = await sql<{ pid: number }>`SELECT pg_backend_pid()::int AS pid`.execute(connection);
      writerPid.resolve(backend.rows[0]!.pid);
      await writerMayStart.promise;
      await sql`UPDATE public.user SET "updatedAt" = "updatedAt" WHERE false`.execute(connection);
      writerCompleted = true;
    });
    const exactWriterPid = await writerPid.promise;
    const cutover = repository.commitForkSchemaCutover('c'.repeat(64), 'current-fork', async (transaction) => {
      writerMayStart.resolve();
      observedWaiting.resolve(await waitForWriterLock(transaction, exactWriterPid, 'user'));
      await releaseVerification.promise;
    });

    try {
      const evidence = await Promise.race([
        observedWaiting.promise,
        cutover.then(() => {
          throw new Error('Cutover completed before the user writer lock was observed');
        }),
      ]);
      expect(evidence).toEqual({
        granted: false,
        mode: 'RowExclusiveLock',
        pid: exactWriterPid,
        relationName: 'public.user',
        waitEvent: 'relation',
        waitEventType: 'Lock',
      });
      expect(writerCompleted).toBe(false);

      releaseVerification.resolve();
      await cutover;
      await writer;
      expect(writerCompleted).toBe(true);
    } finally {
      writerMayStart.resolve();
      releaseVerification.resolve();
      await Promise.allSettled([cutover, writer]);
      await concurrentDb.destroy();
    }
  }, 10_000);

  it('classifies an unknown public catalog object and refuses cutover', async () => {
    await sql`CREATE TABLE physical_file_unexpected (id integer PRIMARY KEY)`.execute(db);
    const { sut } = newTestService(ForkSchemaCutoverService, { database: repository });

    const report = await sut.preflight();

    expect(report.ready).toBe(false);
    expect(report.catalogDiff.unexpected).toContainEqual({
      actual: 'table',
      identity: 'public.physical_file_unexpected',
      kind: 'tables',
    });
    await expect(sut.apply(report.digest)).rejects.toThrow(
      'Unknown catalog object: tables public.physical_file_unexpected',
    );
  });
});
