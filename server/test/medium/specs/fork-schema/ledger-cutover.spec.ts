import { Kysely, sql } from 'kysely';
import { LEGACY_FORK_MIGRATIONS } from 'src/fork-schema/migration-manifest';
import { OFFICIAL_WORKFLOW_MIGRATION } from 'src/fork-schema/workflow-compatibility';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { ForkSchemaCutoverService } from 'src/services/fork-schema-cutover.service';
import { getKyselyConfig } from 'src/utils/database';
import { getKyselyDB, newTestService } from 'test/utils';

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

class PausingCutoverRepository extends DatabaseRepository {
  private continueResolve!: () => void;
  private reachedResolve!: () => void;
  readonly reached = new Promise<void>((resolve) => (this.reachedResolve = resolve));
  private readonly continuePromise = new Promise<void>((resolve) => (this.continueResolve = resolve));

  continue() {
    this.continueResolve();
  }

  protected override async finishForkSchemaCutover(): Promise<void> {
    this.reachedResolve();
    await this.continuePromise;
  }
}

const connectToSameDatabase = async (db: Kysely<DB>): Promise<Kysely<DB>> => {
  const database = await sql<{ name: string }>`SELECT current_database() AS name`.execute(db);
  const url = process.env.IMMICH_TEST_POSTGRES_URL!.replace('/mich', `/${database.rows[0]!.name}`);
  return new Kysely<DB>(getKyselyConfig({ connectionType: 'url', url }));
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
      WHERE name IN ('9999999999999-CustomPatch', '1780435471692-DeleteMismatchedAssetFaces')
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
      expect.objectContaining({ phase: 'ready', reportDigest: report.digest, schemaVersion: '2' }),
    );
    expect(officialAfter.rows).toEqual(officialBefore.rows);
    expect(forkAfter.rows).toEqual(forkBefore.rows);
    expect(audit.rows).toEqual([
      {
        details: { classification: 'legacy-fork', originalTimestamp: legacyTimestamp, reportDigest: report.digest },
        name: legacyName,
      },
    ]);
    expect(state.rows).toEqual([{ active: false, phase: 'ready', schemaVersion: '2' }]);
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

  it('rejects an absent official migration outside the audited workflow compatibility stages', async () => {
    await sql`
      INSERT INTO kysely_migrations (name, timestamp)
      VALUES ('1780435471692-DeleteMismatchedAssetFaces', '2026-07-15T00:00:01.000Z')
    `.execute(db);
    const { sut } = newTestService(ForkSchemaCutoverService, { database: repository });

    const report = await sut.preflight();

    expect(report.migrationOrderValid).toBe(false);
    expect(report.blockers).toContain(
      'Official migration ledger is not an exact ordered prefix of the bundled provider',
    );
  });

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
    const pausingRepository = new PausingCutoverRepository(db, LoggingRepository.create(), new ConfigRepository());
    const cutover = pausingRepository.commitForkSchemaCutover('b'.repeat(64), async () => {});
    await pausingRepository.reached;

    const writer = sql`
      INSERT INTO public.migration_overrides (name, value)
      VALUES ('cutover_concurrency_probe', '{"type":"trigger","name":"probe","sql":"SELECT 1"}'::jsonb)
    `.execute(concurrentDb);
    try {
      const outcome = await Promise.race([
        writer.then(() => 'wrote' as const),
        new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 100)),
      ]);
      expect(outcome).toBe('blocked');
    } finally {
      pausingRepository.continue();
      await Promise.all([cutover, writer]);
      await concurrentDb.destroy();
    }
  });

  it('classifies unknown fork residue and refuses cutover', async () => {
    await sql`CREATE TABLE physical_file_unexpected (id integer PRIMARY KEY)`.execute(db);
    const { sut } = newTestService(ForkSchemaCutoverService, { database: repository });

    const report = await sut.preflight();

    expect(report.ready).toBe(false);
    expect(report.schemaResidue).toContainEqual({
      allowed: false,
      kind: 'table',
      name: 'public.physical_file_unexpected',
    });
    await expect(sut.apply(report.digest)).rejects.toThrow(
      'Unknown fork schema residue: table public.physical_file_unexpected',
    );
  });
});
