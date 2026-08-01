import { Kysely, sql } from 'kysely';
import { LEGACY_FORK_MIGRATIONS } from 'src/fork-schema/migration-manifest';
import supportedVersions from 'src/fork-schema/supported-versions.json';
import { WORKFLOW_COMPATIBILITY_MIGRATIONS } from 'src/fork-schema/workflow-compatibility';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { getKyselyDB } from 'test/utils';

describe('fork schema migration ledgers', () => {
  let db: Kysely<DB>;
  let repository: DatabaseRepository;

  beforeAll(async () => {
    db = await getKyselyDB('fork_schema');
    await sql`DROP SCHEMA public CASCADE`.execute(db);
    await sql`DROP SCHEMA IF EXISTS immich_fork CASCADE`.execute(db);
    await sql`CREATE SCHEMA public`.execute(db);
    repository = new DatabaseRepository(db, LoggingRepository.create(), new ConfigRepository());
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('records official and fork migrations in separate ledgers', async () => {
    expect(await repository.detectMigrationMode()).toBe('fresh');

    await repository.runOfficialMigrations();
    await repository.runForkMigrations();

    const officialForkMigrations = await sql<{ name: string }>`
      SELECT name FROM kysely_migrations WHERE name LIKE '%Fork%'
    `.execute(db);
    const forkMigrations = await sql<{ name: string }>`SELECT name FROM immich_fork.migrations`.execute(db);
    const controlTables = await sql<{ tableName: string }>`
      SELECT table_name AS "tableName"
      FROM information_schema.tables
      WHERE table_schema = 'immich_fork'
        AND table_name IN ('state', 'migration_audit', 'backfill_progress')
      ORDER BY table_name
    `.execute(db);
    const state = await sql<{
      active: boolean;
      id: number;
      phase: string;
      schemaVersion: string;
      upstreamVersion: string;
    }>`
      SELECT id, active, "schemaVersion", "upstreamVersion", phase FROM immich_fork.state
    `.execute(db);

    expect(officialForkMigrations.rows).toHaveLength(0);
    expect(forkMigrations.rows).toEqual([
      { name: '0000000000000-ForkSchemaBaseline' },
      { name: '0000000000010-PrivacyAndAlbums' },
      { name: '0000000000020-EnrichmentAndAutomation' },
      { name: '0000000000030-DerivedResults' },
      { name: '0000000000040-ChecksumsAndStorage' },
      { name: '0000000000050-CutoverVerification' },
      { name: '0000000000060-SharedUpstreamPaths' },
    ]);
    expect(controlTables.rows.map(({ tableName }) => tableName)).toEqual([
      'backfill_progress',
      'migration_audit',
      'state',
    ]);
    expect(state.rows).toEqual([
      { id: 1, active: false, schemaVersion: '1', upstreamVersion: '3.0.3', phase: 'inactive' },
    ]);
  });

  it('initializes a certified current-fork source in the legacy phase', async () => {
    await sql`DROP SCHEMA immich_fork CASCADE`.execute(db);
    await sql`CREATE TABLE public.physical_file (id uuid PRIMARY KEY)`.execute(db);
    await sql`
      INSERT INTO kysely_migrations (name, timestamp)
      VALUES ('1779400000000-UpdateWorkflowTables', ${new Date().toISOString()})
    `.execute(db);

    try {
      await repository.runForkMigrations();

      const state = await sql<{ phase: string }>`SELECT phase FROM immich_fork.state WHERE id = 1`.execute(db);
      expect(state.rows).toEqual([{ phase: 'legacy' }]);
    } finally {
      await sql`DROP TABLE public.physical_file`.execute(db);
      await sql`DELETE FROM kysely_migrations WHERE name = '1779400000000-UpdateWorkflowTables'`.execute(db);
      await sql`UPDATE immich_fork.state SET phase = 'inactive' WHERE id = 1`.execute(db);
    }
  });

  it('distinguishes fresh, isolated, and legacy migration modes', async () => {
    expect(await repository.detectMigrationMode()).toBe('isolated');

    await sql`DROP SCHEMA immich_fork CASCADE`.execute(db);
    expect(await repository.detectMigrationMode()).toBe('fresh');

    await sql`
      INSERT INTO kysely_migrations (name, timestamp)
      VALUES (${[...LEGACY_FORK_MIGRATIONS][0]}, ${new Date().toISOString()})
    `.execute(db);
    expect(await repository.detectMigrationMode()).toBe('legacy');
  });

  it('accepts already-executed certified provider gaps without executing their protected SQL', async () => {
    await sql`DELETE FROM kysely_migrations WHERE name = ANY(${[...LEGACY_FORK_MIGRATIONS]})`.execute(db);
    const ledger = await sql<{ name: string }>`SELECT name FROM kysely_migrations`.execute(db);
    const applied = new Set(ledger.rows.map(({ name }) => name));
    for (const name of supportedVersions.upstreamMigrations.filter((name) => !applied.has(name))) {
      await sql`
        INSERT INTO kysely_migrations (name, timestamp)
        VALUES (${name}, ${name})
        ON CONFLICT (name) DO NOTHING
      `.execute(db);
    }
    for (const [index, name] of supportedVersions.upstreamMigrations.entries()) {
      await sql`
        UPDATE kysely_migrations
        SET timestamp = ${new Date(Date.UTC(2026, 6, 15, 0, 0, 0, index)).toISOString()}
        WHERE name = ${name}
      `.execute(db);
    }

    await expect(repository.runOfficialMigrations()).resolves.toBeUndefined();
  });

  it('refuses a ledger that skips a certified workflow marker but retains later migrations', async () => {
    const [missing] = WORKFLOW_COMPATIBILITY_MIGRATIONS;
    await sql`DELETE FROM kysely_migrations WHERE name = ${missing}`.execute(db);

    await expect(repository.runOfficialMigrations()).rejects.toThrow(
      'Official migration ledger is not an exact ordered prefix of the bundled provider',
    );

    await sql`
      INSERT INTO kysely_migrations (name, timestamp)
      VALUES (${missing}, ${missing})
    `.execute(db);
  });

  it('accepts already-executed certified provider gaps in current-fork legacy mode', async () => {
    const [officialWorkflow] = WORKFLOW_COMPATIBILITY_MIGRATIONS;
    await sql`
      UPDATE kysely_migrations
      SET name = '1779400000000-UpdateWorkflowTables'
      WHERE name = ${officialWorkflow}
    `.execute(db);
    for (const name of LEGACY_FORK_MIGRATIONS) {
      await sql`
        INSERT INTO kysely_migrations (name, timestamp)
        VALUES (${name}, ${name})
        ON CONFLICT (name) DO NOTHING
      `.execute(db);
    }
    const orderedLedger = await sql<{ name: string }>`SELECT name FROM kysely_migrations ORDER BY name`.execute(db);
    for (const [index, { name }] of orderedLedger.rows.entries()) {
      await sql`
        UPDATE kysely_migrations
        SET timestamp = ${new Date(Date.UTC(2026, 6, 15, 0, 0, 0, index)).toISOString()}
        WHERE name = ${name}
      `.execute(db);
    }

    await expect(repository.runMigrations()).resolves.toBeUndefined();

    await sql`DELETE FROM kysely_migrations WHERE name = ANY(${[...LEGACY_FORK_MIGRATIONS]})`.execute(db);
    await sql`
      INSERT INTO kysely_migrations (name, timestamp)
      VALUES (${officialWorkflow}, ${officialWorkflow})
    `.execute(db);
  });

  it('refuses unknown official-ledger migration names', async () => {
    await sql`DELETE FROM kysely_migrations WHERE name = ANY(${[...LEGACY_FORK_MIGRATIONS]})`.execute(db);
    await sql`
      INSERT INTO kysely_migrations (name, timestamp)
      VALUES ('9999999999999-CustomPatch', ${new Date().toISOString()})
    `.execute(db);

    await expect(repository.detectMigrationMode()).rejects.toThrow(
      'Unknown migration in kysely_migrations: 9999999999999-CustomPatch',
    );
  });
});
