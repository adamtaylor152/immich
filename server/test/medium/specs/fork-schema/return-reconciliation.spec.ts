import { Kysely, sql } from 'kysely';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageCore } from 'src/cores/storage.core';
import { ChecksumAlgorithm } from 'src/enum';
import supportedVersions from 'src/fork-schema/supported-versions.json';
import { getWorkflowCompatibilityEvidence } from 'src/fork-schema/workflow-compatibility';
import { ForkHandoffRepository } from 'src/repositories/fork-handoff.repository';
import { BACKFILL_KINDS, ForkSchemaRepository } from 'src/repositories/fork-schema.repository';
import { DB } from 'src/schema';
import { ForkSchemaMigrationService } from 'src/services/fork-schema-migration.service';
import { mediumFactory } from 'test/medium.factory';
import { getKyselyDB, newTestService } from 'test/utils';

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

  beforeAll(async () => {
    db = await getKyselyDB('fork_return_evidence');
    repository = new ForkHandoffRepository(db);
    forkSchemaRepository = new ForkSchemaRepository(db);
  });

  beforeEach(async () => {
    await seedExactLedger();
    await sql`TRUNCATE immich_fork.migration_audit, immich_fork.backfill_progress`.execute(db);
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
});
