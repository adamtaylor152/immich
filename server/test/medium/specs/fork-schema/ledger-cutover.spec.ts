import { Kysely, sql } from 'kysely';
import { LEGACY_FORK_MIGRATIONS } from 'src/fork-schema/migration-manifest';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { ForkSchemaCutoverService } from 'src/services/fork-schema-cutover.service';
import { getKyselyDB, newTestService } from 'test/utils';

class FailingPreCommitRepository extends DatabaseRepository {
  protected override async finishForkSchemaCutover(transaction: Kysely<DB>): Promise<void> {
    await sql`CREATE TABLE cutover_should_rollback (id integer PRIMARY KEY)`.execute(transaction);
    throw new Error('synthetic pre-commit cutover failure');
  }
}

describe('fork schema ledger cutover', () => {
  let db: Kysely<DB>;
  let repository: DatabaseRepository;

  beforeAll(async () => {
    db = await getKyselyDB('ledger_cutover');
    repository = new DatabaseRepository(db, LoggingRepository.create(), new ConfigRepository());
  });

  afterAll(async () => db.destroy());

  beforeEach(async () => {
    await sql`DELETE FROM kysely_migrations WHERE name = '9999999999999-CustomPatch'`.execute(db);
    await sql`DELETE FROM kysely_migrations WHERE name = ANY(${[...LEGACY_FORK_MIGRATIONS]})`.execute(db);
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
