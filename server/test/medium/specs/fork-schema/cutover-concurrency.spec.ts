import { Kysely, sql } from 'kysely';
import { LEGACY_FORK_MIGRATIONS } from 'src/fork-schema/migration-manifest';
import {
  up as createCutoverVerification,
  down as rollbackCutoverVerification,
} from 'src/fork-schema/migrations/0000000000050-CutoverVerification';
import { REVERSIBLE_POST_CERTIFIED_MIGRATIONS } from 'src/fork-schema/post-certified-residue';
import { LEGACY_WORKFLOW_MIGRATION, OFFICIAL_WORKFLOW_MIGRATION } from 'src/fork-schema/workflow-compatibility';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { BACKFILL_KINDS } from 'src/repositories/fork-schema.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { ForkSchemaCutoverService } from 'src/services/fork-schema-cutover.service';
import { getKyselyConfig } from 'src/utils/database';
import { alignCertifiedGeodataCatalog } from 'test/medium/specs/fork-schema/certified-geodata-fixture';
import { getKyselyDB, newTestService } from 'test/utils';

const EMPTY_STORAGE_DIGEST = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const options = { databaseBackupId: 'backup-concurrency', mediaSnapshotId: 'snapshot-concurrency' };

class NoOfficialMigrationRepository extends DatabaseRepository {
  override runOfficialMigrations(): Promise<void> {
    return Promise.resolve();
  }
}

const connectToSameDatabase = async (db: Kysely<DB>): Promise<Kysely<DB>> => {
  const database = await sql<{ name: string }>`SELECT current_database() AS name`.execute(db);
  const url = process.env.IMMICH_TEST_POSTGRES_URL!.replace('/mich', () => `/${database.rows[0]!.name}`);
  return new Kysely<DB>(getKyselyConfig({ connectionType: 'url', url }));
};

const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => (resolve = resolvePromise));
  return { promise, resolve };
};

const waitForRelationWriter = async (
  transaction: Kysely<DB>,
  writerPid: number,
  schemaName: string,
  tableName: string,
) => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const waiting = await sql<{
      granted: boolean;
      mode: string;
      waitEvent: string | null;
      waitEventType: string | null;
    }>`
      SELECT lock.mode, lock.granted, activity.wait_event_type AS "waitEventType", activity.wait_event AS "waitEvent"
      FROM pg_catalog.pg_stat_activity activity
      JOIN pg_catalog.pg_locks lock ON lock.pid = activity.pid
      JOIN pg_catalog.pg_class relation ON relation.oid = lock.relation
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE activity.pid = ${writerPid}
        AND namespace.nspname = ${schemaName}
        AND relation.relname = ${tableName}
        AND NOT lock.granted
    `.execute(transaction);
    if (waiting.rows[0]) {
      return waiting.rows[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Writer ${writerPid} did not block on ${schemaName}.${tableName}`);
};

const writerCases = [
  [
    'official ledger',
    'public',
    'kysely_migrations',
    'UPDATE public.kysely_migrations SET timestamp = timestamp WHERE false',
  ],
  ['fork ledger', 'immich_fork', 'migrations', 'UPDATE immich_fork.migrations SET timestamp = timestamp WHERE false'],
  ['authority state', 'immich_fork', 'state', 'UPDATE immich_fork.state SET active = active WHERE false'],
  [
    'backfill evidence',
    'immich_fork',
    'backfill_progress',
    'UPDATE immich_fork.backfill_progress SET remaining = remaining WHERE false',
  ],
  [
    'checksum coverage',
    'immich_fork',
    'asset_checksum',
    'UPDATE immich_fork.asset_checksum SET "assetId" = "assetId" WHERE false',
  ],
  [
    'mapping coverage',
    'immich_fork',
    'asset_physical_file',
    'UPDATE immich_fork.asset_physical_file SET "assetId" = "assetId" WHERE false',
  ],
  ['workflow data', 'public', 'workflow', 'UPDATE public.workflow SET enabled = enabled WHERE false'],
  [
    'storage checkpoint',
    'immich_fork',
    'cutover_verification_run',
    'UPDATE immich_fork.cutover_verification_run SET cursor = cursor WHERE false',
  ],
  [
    'storage bytes evidence',
    'immich_fork',
    'cutover_verification_asset',
    'UPDATE immich_fork.cutover_verification_asset SET status = status WHERE false',
  ],
  ['maintenance evidence', 'public', 'system_metadata', 'UPDATE public.system_metadata SET value = value WHERE false'],
  ['catalog/table evidence', 'public', 'user', 'UPDATE public.user SET "updatedAt" = "updatedAt" WHERE false'],
] as const;

describe('fork schema cutover concurrency', () => {
  let db: Kysely<DB>;
  // The official workflow marker is the sole audited provider gap, so it must
  // occupy the ledger slot the legacy workflow migration was applied in for the
  // ledger to stay an exact ordered prefix of the certified official set.
  let workflowMarkerTimestamp: string;

  beforeAll(async () => {
    db = await getKyselyDB('cutover_concurrency');
    const repository = new NoOfficialMigrationRepository(db, LoggingRepository.create(), new ConfigRepository());
    await repository.runForkMigrations();
    await alignCertifiedGeodataCatalog(db);
    const legacyWorkflowRow = await sql<{ timestamp: string }>`
      SELECT timestamp::text AS timestamp FROM public.kysely_migrations WHERE name = ${LEGACY_WORKFLOW_MIGRATION}
    `.execute(db);
    workflowMarkerTimestamp = legacyWorkflowRow.rows[0]!.timestamp;
  });

  afterAll(async () => db.destroy());

  beforeEach(async () => {
    await sql`DELETE FROM public.kysely_migrations WHERE name = ANY(${[...LEGACY_FORK_MIGRATIONS]})`.execute(db);
    await sql`
      INSERT INTO public.kysely_migrations (name, timestamp)
      VALUES (${OFFICIAL_WORKFLOW_MIGRATION}, ${workflowMarkerTimestamp})
      ON CONFLICT (name) DO UPDATE SET timestamp = EXCLUDED.timestamp
    `.execute(db);
    // A successful cutover in an earlier test reverts and de-ledgers the
    // post-certified upstream residue; restore the current-fork baseline.
    for (const [name, { apply }] of REVERSIBLE_POST_CERTIFIED_MIGRATIONS) {
      await apply(db);
      await sql`
        INSERT INTO public.kysely_migrations (name, timestamp)
        VALUES (${name}, '9999-01-01T00:00:00.000Z')
        ON CONFLICT (name) DO NOTHING
      `.execute(db);
    }
    await sql`
      UPDATE immich_fork.state
      SET phase = 'ready', active = false, "schemaVersion" = '1',
          "checkpointStartedAt" = NULL, "checkpointCompletedAt" = NULL
      WHERE id = 1
    `.execute(db);
    await sql`TRUNCATE immich_fork.migration_audit, immich_fork.backfill_progress`.execute(db);
    await sql`
      INSERT INTO immich_fork.backfill_progress (kind, remaining, digest)
      SELECT kind, 0, ${'a'.repeat(64)} FROM unnest(${[...BACKFILL_KINDS]}::text[]) AS kind
    `.execute(db);
    await sql`
      INSERT INTO public.system_metadata (key, value)
      VALUES ('maintenance-mode', '{"isMaintenanceMode":true}'::jsonb)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `.execute(db);
    await rollbackCutoverVerification(db);
    await createCutoverVerification(db);
    await sql`
      INSERT INTO immich_fork.cutover_verification_run
        (id, "databaseBackupId", "snapshotId", status, "applicableAssetCount", "aggregateDigest", "completedAt")
      VALUES (gen_random_uuid(), ${options.databaseBackupId}, ${options.mediaSnapshotId}, 'completed', 0,
        ${EMPTY_STORAGE_DIGEST}, now())
    `.execute(db);
  });

  it('allows exactly one of two apply workers to mutate without deadlock', async () => {
    const repositories = [1, 2].map(
      () => new NoOfficialMigrationRepository(db, LoggingRepository.create(), new ConfigRepository()),
    );
    const services = repositories.map((database) => newTestService(ForkSchemaCutoverService, { database }).sut);
    const report = await services[0]!.preflight(options);
    expect(report.ready).toBe(true);

    const results = await Promise.allSettled(
      services.map((service) => service.apply({ ...options, reportDigest: report.digest })),
    );

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const state = await sql<{ phase: string; schemaVersion: string }>`
      SELECT phase, "schemaVersion" FROM immich_fork.state WHERE id = 1
    `.execute(db);
    const checkpoints = await sql<{ count: number }>`
      SELECT count(*)::int AS count FROM immich_fork.migration_audit
      WHERE name = 'fork-schema-cutover' AND status = 'applied'
    `.execute(db);
    expect(state.rows[0]).toEqual({ phase: 'inactive', schemaVersion: '2' });
    expect(checkpoints.rows[0]?.count).toBe(1);
  }, 15_000);

  it.each(writerCases)(
    'blocks a concurrent %s writer under the manifest lock',
    async (_, schema, table, write) => {
      const repository = new NoOfficialMigrationRepository(db, LoggingRepository.create(), new ConfigRepository());
      const writerDb = await connectToSameDatabase(db);
      const mayWrite = deferred();
      const writerPid = deferred<number>();
      const release = deferred();
      let writerCompleted = false;
      const writer = writerDb.connection().execute(async (connection) => {
        const backend = await sql<{ pid: number }>`SELECT pg_backend_pid()::int AS pid`.execute(connection);
        writerPid.resolve(backend.rows[0]!.pid);
        await mayWrite.promise;
        await sql.raw(write).execute(connection);
        writerCompleted = true;
      });
      const pid = await writerPid.promise;
      const cutover = repository.commitForkSchemaCutover('a'.repeat(64), async (transaction) => {
        mayWrite.resolve();
        const waiting = await waitForRelationWriter(transaction, pid, schema, table);
        expect(waiting).toEqual({
          granted: false,
          mode: 'RowExclusiveLock',
          waitEvent: 'relation',
          waitEventType: 'Lock',
        });
        expect(writerCompleted).toBe(false);
        await release.promise;
      });

      try {
        await new Promise((resolve) => setTimeout(resolve, 25));
        release.resolve();
        await cutover;
        await writer;
        expect(writerCompleted).toBe(true);
      } finally {
        mayWrite.resolve();
        release.resolve();
        await Promise.allSettled([cutover, writer]);
        await writerDb.destroy();
      }
    },
    10_000,
  );
});
