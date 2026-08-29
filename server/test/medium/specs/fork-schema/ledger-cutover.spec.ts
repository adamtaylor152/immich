import { Kysely, sql } from 'kysely';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageCore } from 'src/cores/storage.core';
import { ChecksumAlgorithm } from 'src/enum';
import { LEGACY_FORK_MIGRATIONS, POST_CERTIFIED_UPSTREAM_MIGRATIONS } from 'src/fork-schema/migration-manifest';
import {
  up as createCutoverVerification,
  down as rollbackCutoverVerification,
} from 'src/fork-schema/migrations/0000000000050-CutoverVerification';
import { REVERSIBLE_POST_CERTIFIED_MIGRATIONS } from 'src/fork-schema/post-certified-residue';
import {
  getWorkflowCompatibilityEvidence,
  LEGACY_WORKFLOW_MIGRATION,
  OFFICIAL_WORKFLOW_MIGRATION,
} from 'src/fork-schema/workflow-compatibility';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { ForkCutoverVerificationRepository } from 'src/repositories/fork-cutover-verification.repository';
import { BACKFILL_KINDS } from 'src/repositories/fork-schema.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { ForkCutoverVerificationService } from 'src/services/fork-cutover-verification.service';
import { ForkSchemaCutoverService } from 'src/services/fork-schema-cutover.service';
import { getKyselyConfig } from 'src/utils/database';
import { mediumFactory } from 'test/medium.factory';
import { alignCertifiedGeodataCatalog } from 'test/medium/specs/fork-schema/certified-geodata-fixture';
import { getKyselyDB, newTestService } from 'test/utils';

const EMPTY_STORAGE_DIGEST = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const LEGACY_OVERRIDE_NAMES = [
  'function_album_parent_cycle_check',
  'index_album_parentId_idx',
  'index_album_parent_sort_idx',
  'index_album_root_sort_idx',
  'index_idx_asset_exif_description_trigram',
  'index_idx_asset_is_nsfw',
  'trigger_album_parent_cycle_check_trigger',
  'trigger_asset_health_candidate_updatedAt',
  'trigger_asset_health_updatedAt',
  'trigger_asset_video_duplicate_frame_updatedAt',
  'trigger_physical_file_updatedAt',
] as const;
const LEGACY_TRIGGERS = [
  ['public.album', 'album_parent_cycle_check_trigger'],
  ['public.asset_health', 'asset_health_updatedAt'],
  ['public.asset_health_candidate', 'asset_health_candidate_updatedAt'],
  ['public.asset_video_duplicate_frame', 'asset_video_duplicate_frame_updatedAt'],
  ['public.physical_file', 'physical_file_updatedAt'],
] as const;
const fileDigest = (algorithm: 'sha1' | 'sha256', bytes: Buffer) => createHash(algorithm).update(bytes).digest();
const resetCutoverVerification = async (db: Kysely<DB>) => {
  await rollbackCutoverVerification(db);
  await createCutoverVerification(db);
};

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

class OfficialMigrationFailureRepository extends DatabaseRepository {
  override runOfficialMigrations(): Promise<void> {
    throw new Error('synthetic official migration failure');
  }
}

const CUTOVER_MUTATION_STAGES = [
  'workflow-alias',
  'legacy-ledger-audit',
  'legacy-ledger-delete',
  'legacy-artifact-shutdown',
  'post-certified-residue',
  'state-transition',
  'checkpoint-audit',
] as const;

class StageFailingCutoverRepository extends TaskOneCutoverRepository {
  constructor(
    db: Kysely<DB>,
    logging: LoggingRepository,
    config: ConfigRepository,
    private readonly failingStage: (typeof CUTOVER_MUTATION_STAGES)[number],
  ) {
    super(db, logging, config);
  }

  protected afterForkSchemaCutoverStage(
    _transaction: Kysely<DB>,
    stage: (typeof CUTOVER_MUTATION_STAGES)[number],
  ): Promise<void> {
    if (stage === this.failingStage) {
      throw new Error(`synthetic failure after ${stage}`);
    }
    return Promise.resolve();
  }
}

class DriftBeforeInnerVerificationRepository extends TaskOneCutoverRepository {
  drift!: () => Promise<void>;

  override async commitForkSchemaCutover(...args: Parameters<DatabaseRepository['commitForkSchemaCutover']>) {
    await this.drift();
    return super.commitForkSchemaCutover(...args);
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

const captureCutoverSnapshot = async (db: Kysely<DB>) => {
  const audit = await sql`SELECT * FROM immich_fork.migration_audit ORDER BY id`.execute(db);
  const ledger = await sql`
    SELECT name, timestamp FROM public.kysely_migrations ORDER BY timestamp, name
  `.execute(db);
  const overrides = await sql<{ name: string; value: unknown }>`
    SELECT name, value FROM public.migration_overrides
    WHERE name = ANY(${[...LEGACY_OVERRIDE_NAMES]})
    ORDER BY name
  `.execute(db);
  const state = await sql`SELECT * FROM immich_fork.state WHERE id = 1`.execute(db);
  const triggers = await sql<{ enabled: string; name: string }>`
    SELECT tgname AS name, tgenabled::text AS enabled
    FROM pg_catalog.pg_trigger
    WHERE NOT tgisinternal AND tgname = ANY(${LEGACY_TRIGGERS.map(([, name]) => name)})
    ORDER BY tgname
  `.execute(db);
  const workflow = await getWorkflowCompatibilityEvidence(db);
  return {
    audit: audit.rows,
    ledger: ledger.rows,
    overrides: overrides.rows,
    state: state.rows,
    triggers: triggers.rows,
    workflow,
  };
};

describe('fork schema ledger cutover', () => {
  let db: Kysely<DB>;
  let repository: DatabaseRepository;
  let legacyOverrides: Array<{ name: string; value: unknown }>;
  // The official workflow marker is the sole audited provider gap, so it must
  // occupy the ledger slot the legacy workflow migration was applied in for the
  // ledger to stay an exact ordered prefix of the certified official set.
  let workflowMarkerTimestamp: string;

  beforeAll(async () => {
    db = await getKyselyDB('ledger_cutover');
    repository = new TaskOneCutoverRepository(db, LoggingRepository.create(), new ConfigRepository());
    await repository.runForkMigrations();
    const legacyWorkflowRow = await sql<{ timestamp: string }>`
      SELECT timestamp::text AS timestamp FROM public.kysely_migrations WHERE name = ${LEGACY_WORKFLOW_MIGRATION}
    `.execute(db);
    workflowMarkerTimestamp = legacyWorkflowRow.rows[0]!.timestamp;
    await alignCertifiedGeodataCatalog(db);
    const overrides = await sql<{ name: string; value: unknown }>`
      SELECT name, value FROM public.migration_overrides WHERE name = ANY(${[...LEGACY_OVERRIDE_NAMES]}) ORDER BY name
    `.execute(db);
    legacyOverrides = [...overrides.rows];
  });

  afterAll(async () => db.destroy());

  beforeEach(async () => {
    await sql`DELETE FROM public.migration_overrides WHERE name = 'cutover_concurrency_probe'`.execute(db);
    for (const { name, value } of legacyOverrides) {
      await sql`
        INSERT INTO public.migration_overrides (name, value)
        VALUES (${name}, ${JSON.stringify(value)}::jsonb)
        ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value
      `.execute(db);
    }
    for (const [table, trigger] of LEGACY_TRIGGERS) {
      await sql.raw(`ALTER TABLE ${table} ENABLE TRIGGER "${trigger}"`).execute(db);
    }
    await sql`DELETE FROM kysely_migrations WHERE name = '9999999999999-CustomPatch'`.execute(db);
    await sql`DELETE FROM kysely_migrations WHERE name = ANY(${[...LEGACY_FORK_MIGRATIONS]})`.execute(db);
    // A successful cutover in an earlier test reverts and de-ledgers the
    // post-certified upstream residue; restore the current-fork baseline. The
    // re-application is idempotent and the 9999 timestamp keeps the rows at the
    // end of the official order.
    for (const [name, { apply }] of REVERSIBLE_POST_CERTIFIED_MIGRATIONS) {
      await apply(db);
      await sql`
        INSERT INTO kysely_migrations (name, timestamp)
        VALUES (${name}, '9999-01-01T00:00:00.000Z')
        ON CONFLICT (name) DO NOTHING
      `.execute(db);
    }
    await sql`
      INSERT INTO kysely_migrations (name, timestamp)
      VALUES (${OFFICIAL_WORKFLOW_MIGRATION}, ${workflowMarkerTimestamp})
      ON CONFLICT (name) DO UPDATE SET timestamp = EXCLUDED.timestamp
    `.execute(db);
    await sql`DROP TABLE IF EXISTS physical_file_unexpected`.execute(db);
    await sql`UPDATE immich_fork.state SET phase = 'ready', active = false, "schemaVersion" = '1' WHERE id = 1`.execute(
      db,
    );
    await sql`TRUNCATE immich_fork.migration_audit`.execute(db);
    await sql`TRUNCATE immich_fork.backfill_progress`.execute(db);
    await sql`TRUNCATE public.workflow_step, public.workflow, public.plugin_method, public.plugin CASCADE`.execute(db);
    await db.deleteFrom('user').execute();
    const workflowOwner = await mediumFactory.userWithClusterGroup(db);
    await db.insertInto('user').values(workflowOwner).execute();
    await sql`
      INSERT INTO public.plugin
        (id, enabled, name, version, title, description, author, "wasmBytes", templates, "sha256hash",
         "createdAt", "updatedAt")
      VALUES
        ('10000000-0000-4000-8000-000000000001', true, 'cutover.plugin', '1.0.0', 'Cutover',
         'complete cutover fixture', 'Immich', decode('00ff1020', 'hex'), '[]'::jsonb,
         sha256(decode('00ff1020', 'hex')),
         '2026-07-15T01:02:03.000Z', '2026-07-15T01:02:04.000Z')
    `.execute(db);
    await sql`
      INSERT INTO public.plugin_method
        (id, "pluginId", name, title, description, types, "hostFunctions", "uiHints", schema)
      VALUES
        ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'process',
         'Process', 'Cutover method', ARRAY['asset']::varchar[], true, ARRAY['hidden']::varchar[],
         '{"type":"object"}'::jsonb)
    `.execute(db);
    await sql`
      INSERT INTO public.workflow
        (id, "ownerId", trigger, name, description, "createdAt", "updatedAt", "updateId", enabled)
      VALUES
        ('30000000-0000-4000-8000-000000000003', ${workflowOwner.id}::uuid, 'asset.uploaded',
         'Cutover workflow', 'Must survive every failure stage', '2026-07-15T02:03:04.000Z',
         '2026-07-15T02:03:05.000Z', '40000000-0000-4000-8000-000000000004', true)
    `.execute(db);
    await sql`
      INSERT INTO public.workflow_step
        (id, enabled, "workflowId", "pluginMethodId", config, "order")
      VALUES
        ('50000000-0000-4000-8000-000000000005', true, '30000000-0000-4000-8000-000000000003',
         '20000000-0000-4000-8000-000000000002', '{"preserve":["bytes","json",7]}'::jsonb, 3)
    `.execute(db);
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
    await resetCutoverVerification(db);
    await sql`
      INSERT INTO immich_fork.cutover_verification_run
        (id, "databaseBackupId", "snapshotId", status, "applicableAssetCount", "aggregateDigest", "completedAt")
      VALUES (gen_random_uuid(), 'backup-1', 'snapshot-1', 'completed', 0, ${EMPTY_STORAGE_DIGEST}, now())
    `.execute(db);
  });

  it.each(CUTOVER_MUTATION_STAGES)(
    'rolls back the complete cutover snapshot after the %s mutation stage',
    async (stage) => {
      const genericLegacy = [...LEGACY_FORK_MIGRATIONS].find((name) => name !== LEGACY_WORKFLOW_MIGRATION)!;
      await sql`DELETE FROM public.kysely_migrations WHERE name = ${OFFICIAL_WORKFLOW_MIGRATION}`.execute(db);
      await sql`
        INSERT INTO public.kysely_migrations (name, timestamp)
        VALUES
          (${genericLegacy}, ${workflowMarkerTimestamp}),
          (${LEGACY_WORKFLOW_MIGRATION}, ${workflowMarkerTimestamp})
      `.execute(db);
      const failingRepository = new StageFailingCutoverRepository(
        db,
        LoggingRepository.create(),
        new ConfigRepository(),
        stage,
      );
      const { sut } = newTestService(ForkSchemaCutoverService, { database: failingRepository });
      const options = { databaseBackupId: 'backup-1', mediaSnapshotId: 'snapshot-1' };
      const report = await sut.preflight(options);
      expect(report.ready, report.blockers.join('\n')).toBe(true);
      const before = await captureCutoverSnapshot(db);

      await expect(sut.apply({ ...options, reportDigest: report.digest })).rejects.toThrow(
        `synthetic failure after ${stage}`,
      );

      expect(await captureCutoverSnapshot(db)).toEqual(before);
    },
  );

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

    const report = await sut.preflight({ databaseBackupId: 'backup-1', mediaSnapshotId: 'snapshot-1' });

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

  it('rejects stale and count-drifted PostgreSQL storage checkpoints', async () => {
    const { sut } = newTestService(ForkSchemaCutoverService, { database: repository });
    await sql`
      INSERT INTO immich_fork.cutover_verification_run
        (id, "databaseBackupId", "snapshotId", status, "applicableAssetCount", "aggregateDigest", "completedAt")
      VALUES (
        gen_random_uuid(), 'backup-stale', 'snapshot-stale', 'completed', 0,
        ${EMPTY_STORAGE_DIGEST}, now() - interval '61 minutes'
      )
    `.execute(db);
    const stale = await sut.preflight({ databaseBackupId: 'backup-stale', mediaSnapshotId: 'snapshot-stale' });
    expect(stale.blockers).toContain('Storage verification checkpoint is older than one hour');

    await sql`
      INSERT INTO immich_fork.cutover_verification_run
        (id, "databaseBackupId", "snapshotId", status, "applicableAssetCount", "aggregateDigest", "completedAt")
      VALUES (gen_random_uuid(), 'backup-count', 'snapshot-count', 'completed', 1, ${'b'.repeat(64)}, now())
    `.execute(db);
    const countDrift = await sut.preflight({ databaseBackupId: 'backup-count', mediaSnapshotId: 'snapshot-count' });
    expect(countDrift.blockers).toContain('Storage verification checkpoint evidence is invalid');
  });

  it('rejects a completed checkpoint whose stored digest does not match its canonical evidence rows', async () => {
    const { sut } = newTestService(ForkSchemaCutoverService, { database: repository });
    await sql`
      INSERT INTO immich_fork.cutover_verification_run
        (id, "databaseBackupId", "snapshotId", status, "applicableAssetCount", "aggregateDigest", "completedAt")
      VALUES (gen_random_uuid(), 'backup-invalid-digest', 'snapshot-invalid-digest', 'completed', 0, ${'b'.repeat(64)}, now())
    `.execute(db);

    const report = await sut.preflight({
      databaseBackupId: 'backup-invalid-digest',
      mediaSnapshotId: 'snapshot-invalid-digest',
    });

    expect(report.blockers).toContain('Storage verification checkpoint evidence is invalid');
  });

  it('rejects preflight and transactional apply after both the asset and mapping move away from verified bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'immich-completed-path-drift-'));
    StorageCore.setMediaLocation(root);
    const pathA = join(root, 'verified-a.jpg');
    const pathB = join(root, 'unverified-b.jpg');
    const bytesA = Buffer.from('verified bytes');
    const bytesB = Buffer.from('different replacement bytes');
    const user = await mediumFactory.userWithClusterGroup(db);
    const asset = mediumFactory.assetInsert({
      ownerId: user.id,
      originalPath: pathA,
      checksum: fileDigest('sha1', bytesA),
      checksumAlgorithm: ChecksumAlgorithm.sha1File,
    });
    try {
      await Promise.all([writeFile(pathA, bytesA), writeFile(pathB, bytesB)]);
      await db.insertInto('user').values(user).execute();
      await db.insertInto('asset').values(asset).execute();
      await sql`
        INSERT INTO immich_fork.asset_checksum
          ("assetId", sha1, sha256, "sizeInBytes", "verifiedPaths", "linkCount")
        VALUES (
          ${asset.id}::uuid, ${fileDigest('sha1', bytesA)}, ${fileDigest('sha256', bytesA)},
          ${bytesA.length}, ARRAY[${pathA}], 1
        )
      `.execute(db);
      await sql`
        INSERT INTO immich_fork.asset_physical_file ("assetId", "physicalFileId", "upstreamPath")
        VALUES (${asset.id}::uuid, NULL, ${pathA})
      `.execute(db);
      const verification = new ForkCutoverVerificationService(new ForkCutoverVerificationRepository(db));
      const run = await verification.start('backup-completed-path-drift', 'snapshot-completed-path-drift');
      await verification.resume(run.id, 1);

      await db.updateTable('asset').set({ originalPath: pathB }).where('id', '=', asset.id!).execute();
      await sql`
        UPDATE immich_fork.asset_physical_file SET "upstreamPath" = ${pathB}
        WHERE "assetId" = ${asset.id}::uuid
      `.execute(db);
      const rootEvidence = await sql<{ assetPresent: boolean; approvedRoots: string[]; currentRoots: string[] }>`
        SELECT asset.id IS NOT NULL AS "assetPresent", verification."approvedRoots",
          ARRAY[${StorageCore.getMediaLocation()}] || coalesce(library."importPaths", ARRAY[]::text[]) AS "currentRoots"
        FROM immich_fork.cutover_verification_asset verification
        LEFT JOIN public.asset asset ON asset.id = verification."assetId"
        LEFT JOIN public.library library ON library.id = asset."libraryId"
        WHERE verification."runId" = ${run.id}::uuid
      `.execute(db);
      expect(rootEvidence.rows[0]).toEqual({ assetPresent: true, approvedRoots: [root], currentRoots: [root] });
      const failingRepository = new FailingPreCommitRepository(db, LoggingRepository.create(), new ConfigRepository());
      const { sut } = newTestService(ForkSchemaCutoverService, { database: failingRepository });
      StorageCore.setMediaLocation(root);
      const report = await sut.preflight({
        databaseBackupId: 'backup-completed-path-drift',
        mediaSnapshotId: 'snapshot-completed-path-drift',
      });

      expect(report.mappingCoverage.valid).toBe(true);
      expect(report.storageVerification).toMatchObject({
        assetCount: 1,
        evidenceAssetCount: 1,
        failureCount: 0,
        rootDriftCount: 1,
        verifiedCount: 1,
      });
      expect.soft(report.ready).toBe(false);
      expect.soft(report.blockers).toContain('Storage verification checkpoint evidence is invalid');
      await expect(
        sut.apply({
          databaseBackupId: 'backup-completed-path-drift',
          mediaSnapshotId: 'snapshot-completed-path-drift',
          reportDigest: report.digest,
        }),
      ).rejects.toThrow('Storage verification checkpoint evidence is invalid');
    } finally {
      await resetCutoverVerification(db);
      await sql`TRUNCATE immich_fork.asset_physical_file, immich_fork.asset_checksum`.execute(db);
      await db.deleteFrom('asset').execute();
      await db.deleteFrom('user').execute();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects path drift introduced between the locked preflight and inner transactional verification', async () => {
    const root = await mkdtemp(join(tmpdir(), 'immich-inner-path-drift-'));
    StorageCore.setMediaLocation(root);
    const pathA = join(root, 'verified-a.jpg');
    const pathB = join(root, 'unverified-b.jpg');
    const bytesA = Buffer.from('verified inner bytes');
    const bytesB = Buffer.from('different inner replacement bytes');
    const user = await mediumFactory.userWithClusterGroup(db);
    const asset = mediumFactory.assetInsert({
      ownerId: user.id,
      originalPath: pathA,
      checksum: fileDigest('sha1', bytesA),
      checksumAlgorithm: ChecksumAlgorithm.sha1File,
    });
    const legacyName = [...LEGACY_FORK_MIGRATIONS][0];
    try {
      await Promise.all([writeFile(pathA, bytesA), writeFile(pathB, bytesB)]);
      await db.insertInto('user').values(user).execute();
      await db.insertInto('asset').values(asset).execute();
      await sql`
        INSERT INTO immich_fork.asset_checksum
          ("assetId", sha1, sha256, "sizeInBytes", "verifiedPaths", "linkCount")
        VALUES (
          ${asset.id}::uuid, ${fileDigest('sha1', bytesA)}, ${fileDigest('sha256', bytesA)},
          ${bytesA.length}, ARRAY[${pathA}], 1
        )
      `.execute(db);
      await sql`
        INSERT INTO immich_fork.asset_physical_file ("assetId", "physicalFileId", "upstreamPath")
        VALUES (${asset.id}::uuid, NULL, ${pathA})
      `.execute(db);
      const verification = new ForkCutoverVerificationService(new ForkCutoverVerificationRepository(db));
      const run = await verification.start('backup-inner-path-drift', 'snapshot-inner-path-drift');
      await verification.resume(run.id, 1);
      await sql`
        INSERT INTO kysely_migrations (name, timestamp)
        VALUES (${legacyName}, '2026-07-16T00:00:00.000Z')
      `.execute(db);

      let driftInjected = false;
      const driftRepository = new DriftBeforeInnerVerificationRepository(
        db,
        LoggingRepository.create(),
        new ConfigRepository(),
      );
      driftRepository.drift = async () => {
        driftInjected = true;
        await db.updateTable('asset').set({ originalPath: pathB }).where('id', '=', asset.id!).execute();
        await sql`
          UPDATE immich_fork.asset_physical_file SET "upstreamPath" = ${pathB}
          WHERE "assetId" = ${asset.id}::uuid
        `.execute(db);
      };
      const { sut } = newTestService(ForkSchemaCutoverService, { database: driftRepository });
      StorageCore.setMediaLocation(root);
      const report = await sut.preflight({
        databaseBackupId: 'backup-inner-path-drift',
        mediaSnapshotId: 'snapshot-inner-path-drift',
      });
      expect(report.ready).toBe(true);

      await expect(
        sut.apply({
          databaseBackupId: 'backup-inner-path-drift',
          mediaSnapshotId: 'snapshot-inner-path-drift',
          reportDigest: report.digest,
        }),
      ).rejects.toThrow('Fork schema cutover preflight changed');

      expect(driftInjected).toBe(true);
      const state = await sql<{ phase: string; schemaVersion: string }>`
        SELECT phase, "schemaVersion" FROM immich_fork.state WHERE id = 1
      `.execute(db);
      const audit = await sql<{ count: number }>`
        SELECT count(*)::int AS count FROM immich_fork.migration_audit
        WHERE name = 'fork-schema-cutover'
      `.execute(db);
      const legacy = await sql<{ count: number }>`
        SELECT count(*)::int AS count FROM kysely_migrations WHERE name = ${legacyName}
      `.execute(db);
      expect(state.rows[0]).toEqual({ phase: 'ready', schemaVersion: '1' });
      expect(audit.rows[0]?.count).toBe(0);
      expect(legacy.rows[0]?.count).toBe(1);
    } finally {
      await sql`DELETE FROM kysely_migrations WHERE name = ${legacyName}`.execute(db);
      await resetCutoverVerification(db);
      await sql`TRUNCATE immich_fork.asset_physical_file, immich_fork.asset_checksum`.execute(db);
      await db.deleteFrom('asset').execute();
      await db.deleteFrom('user').execute();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects apply-time run ID, checkpoint ID, and digest drift', async () => {
    const { sut } = newTestService(ForkSchemaCutoverService, { database: repository });
    const report = await sut.preflight({ databaseBackupId: 'backup-1', mediaSnapshotId: 'snapshot-1' });
    await sql`
      INSERT INTO immich_fork.cutover_verification_run
        (id, "databaseBackupId", "snapshotId", status, "applicableAssetCount", "aggregateDigest", "completedAt")
      VALUES (gen_random_uuid(), 'backup-1', 'snapshot-1', 'completed', 0, ${'b'.repeat(64)}, now() + interval '1 second')
    `.execute(db);

    await expect(
      sut.apply({ databaseBackupId: 'backup-1', mediaSnapshotId: 'snapshot-1', reportDigest: report.digest }),
    ).rejects.toThrow('Fork schema cutover preflight changed');
    await expect(
      sut.apply({ databaseBackupId: 'other-backup', mediaSnapshotId: 'other-snapshot', reportDigest: report.digest }),
    ).rejects.toThrow('Fork schema cutover preflight changed');
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
      WHERE name <> ${legacyName} AND name <> ALL(${[...POST_CERTIFIED_UPSTREAM_MIGRATIONS]})
      ORDER BY name
    `.execute(db);
    const forkBefore = await sql<{ name: string }>`SELECT name FROM immich_fork.migrations ORDER BY name`.execute(db);
    const { sut } = newTestService(ForkSchemaCutoverService, { database: repository });
    const report = await sut.preflight({ databaseBackupId: 'backup-1', mediaSnapshotId: 'snapshot-1' });

    const checkpoint = await sut.apply({
      databaseBackupId: 'backup-1',
      mediaSnapshotId: 'snapshot-1',
      reportDigest: report.digest,
    });

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

    // The post-certified upstream residue is audited, reverted, and removed so
    // the handed-off ledger and schema are byte-compatible with the certified
    // official tag.
    const residueAudit = await sql<{ details: { classification: string }; name: string }>`
      SELECT name, details FROM immich_fork.migration_audit
      WHERE name = ANY(${[...POST_CERTIFIED_UPSTREAM_MIGRATIONS]})
      ORDER BY name
    `.execute(db);
    expect(residueAudit.rows.map(({ name }) => name)).toEqual([...POST_CERTIFIED_UPSTREAM_MIGRATIONS].toSorted());
    for (const row of residueAudit.rows) {
      expect(row.details).toMatchObject({ classification: 'post-certified-upstream', reportDigest: report.digest });
    }
    const revertedColumns = await sql<{ attname: string; attnotnull: boolean }>`
      SELECT attribute.attname, attribute.attnotnull
      FROM pg_catalog.pg_attribute attribute
      JOIN pg_catalog.pg_class class ON class.oid = attribute.attrelid
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = class.relnamespace
      WHERE namespace.nspname = 'public'
        AND ((class.relname = 'album' AND attribute.attname = 'description')
          OR (class.relname = 'user' AND attribute.attname = 'password'))
    `.execute(db);
    expect(revertedColumns.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ attname: 'description', attnotnull: true }),
        expect.objectContaining({ attname: 'password', attnotnull: true }),
      ]),
    );
  });

  it('preserves the committed handoff without reverse ledger surgery when official migration fails', async () => {
    const legacyName = [...LEGACY_FORK_MIGRATIONS].find((name) => name !== LEGACY_WORKFLOW_MIGRATION)!;
    const legacyTimestamp = '2026-01-02T03:04:05.000Z';
    await sql`
      INSERT INTO public.kysely_migrations (name, timestamp) VALUES (${legacyName}, ${legacyTimestamp})
    `.execute(db);
    const failingRepository = new OfficialMigrationFailureRepository(
      db,
      LoggingRepository.create(),
      new ConfigRepository(),
    );
    const { sut } = newTestService(ForkSchemaCutoverService, { database: failingRepository });
    const applyOptions = { databaseBackupId: 'backup-1', mediaSnapshotId: 'snapshot-1' };
    const report = await sut.preflight(applyOptions);
    expect(report.ready).toBe(true);

    await expect(sut.apply({ ...applyOptions, reportDigest: report.digest })).rejects.toThrow(
      'checkpoint restore required: synthetic official migration failure',
    );

    const state = await sql<{ active: boolean; phase: string; schemaVersion: string }>`
      SELECT active, phase, "schemaVersion" FROM immich_fork.state WHERE id = 1
    `.execute(db);
    const ledger = await sql<{ count: number }>`
      SELECT count(*)::int AS count FROM public.kysely_migrations WHERE name = ${legacyName}
    `.execute(db);
    const audit = await sql<{ count: number }>`
      SELECT count(*)::int AS count FROM immich_fork.migration_audit
      WHERE name = 'fork-schema-cutover' AND phase = 'official-cutover' AND status = 'applied'
    `.execute(db);
    expect(state.rows[0]).toEqual({ active: false, phase: 'inactive', schemaVersion: '2' });
    expect(ledger.rows[0]?.count).toBe(0);
    expect(audit.rows[0]?.count).toBe(1);
  });

  it('keeps the ledger and phase unchanged when an unknown migration is found', async () => {
    await sql`
      INSERT INTO kysely_migrations (name, timestamp)
      VALUES ('9999999999999-CustomPatch', now()::text)
    `.execute(db);
    const beforeLedger = await sql`SELECT name, timestamp FROM kysely_migrations ORDER BY name`.execute(db);
    const { sut } = newTestService(ForkSchemaCutoverService, { database: repository });

    const report = await sut.preflight({ databaseBackupId: 'backup-1', mediaSnapshotId: 'snapshot-1' });
    await expect(
      sut.apply({ databaseBackupId: 'backup-1', mediaSnapshotId: 'snapshot-1', reportDigest: report.digest }),
    ).rejects.toThrow('Unknown migration in kysely_migrations');

    const afterLedger = await sql`SELECT name, timestamp FROM kysely_migrations ORDER BY name`.execute(db);
    const state = await sql<{ phase: string }>`SELECT phase FROM immich_fork.state WHERE id = 1`.execute(db);
    expect(afterLedger.rows).toEqual(beforeLedger.rows);
    expect(state.rows[0]?.phase).toBe('ready');
  });

  it('rejects the audited workflow provider gap when its marker is recorded out of official order', async () => {
    await sql`DELETE FROM kysely_migrations WHERE name = ${OFFICIAL_WORKFLOW_MIGRATION}`.execute(db);
    await sql`
      INSERT INTO kysely_migrations (name, timestamp)
      VALUES (${OFFICIAL_WORKFLOW_MIGRATION}, '2099-07-15T00:00:01.000Z')
    `.execute(db);
    const { sut } = newTestService(ForkSchemaCutoverService, { database: repository });

    const report = await sut.preflight({ databaseBackupId: 'backup-1', mediaSnapshotId: 'snapshot-1' });

    expect(report.migrationOrderValid).toBe(false);
    expect(report.blockers).toContain(
      'Official migration ledger is not an exact ordered prefix of the bundled provider',
    );
  });

  it('rolls back pre-commit DDL, ledger surgery, audit, and phase together', async () => {
    const failingRepository = new FailingPreCommitRepository(db, LoggingRepository.create(), new ConfigRepository());
    const beforeLedger = await sql`SELECT name, timestamp FROM kysely_migrations ORDER BY name`.execute(db);
    const { sut } = newTestService(ForkSchemaCutoverService, { database: failingRepository });
    const report = await sut.preflight({ databaseBackupId: 'backup-1', mediaSnapshotId: 'snapshot-1' });

    await expect(
      sut.apply({ databaseBackupId: 'backup-1', mediaSnapshotId: 'snapshot-1', reportDigest: report.digest }),
    ).rejects.toThrow('synthetic pre-commit cutover failure');

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
    const cutover = repository.commitForkSchemaCutover('b'.repeat(64), async (transaction) => {
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
    const cutover = repository.commitForkSchemaCutover('c'.repeat(64), async (transaction) => {
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

    const report = await sut.preflight({ databaseBackupId: 'backup-1', mediaSnapshotId: 'snapshot-1' });

    expect(report.ready).toBe(false);
    expect(report.catalogDiff.unexpected).toContainEqual({
      actual: 'table',
      identity: 'public.physical_file_unexpected',
      kind: 'tables',
    });
    await expect(
      sut.apply({ databaseBackupId: 'backup-1', mediaSnapshotId: 'snapshot-1', reportDigest: report.digest }),
    ).rejects.toThrow('Unknown catalog object: tables public.physical_file_unexpected');
  });
});
