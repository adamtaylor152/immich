import { Kysely, sql } from 'kysely';
import { LEGACY_FORK_MIGRATIONS } from 'src/fork-schema/migration-manifest';
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
    expect(forkMigrations.rows).toEqual([expect.objectContaining({ name: '0000000000000-ForkSchemaBaseline' })]);
    expect(controlTables.rows.map(({ tableName }) => tableName)).toEqual([
      'backfill_progress',
      'migration_audit',
      'state',
    ]);
    expect(state.rows).toEqual([
      { id: 1, active: false, schemaVersion: '1', upstreamVersion: '3.0.3', phase: 'inactive' },
    ]);
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
