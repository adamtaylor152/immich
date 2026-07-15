import { Kysely, sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { JobStatus, MediaHealthCategory, MediaHealthSeverity, MediaHealthStatus } from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { BestPhotosRepository } from 'src/repositories/best-photos.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { DuplicateRepository } from 'src/repositories/duplicate.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { MediaHealthRepository } from 'src/repositories/media-health.repository';
import { DB } from 'src/schema';
import { ForkSchemaMigrationService } from 'src/services/fork-schema-migration.service';
import { mediumFactory } from 'test/medium.factory';
import { getKyselyDB, newTestService } from 'test/utils';

const vector = `[${Array.from({ length: 512 }, (_, index) => (index === 0 ? 1 : 0)).join(',')}]`;
const expectVerification = (value: { count: number; digest: string }, count: number) => {
  expect(value.count).toBe(count);
  expect(value.digest).toMatch(/^[0-9a-f]{64}$/);
};

describe('health, scoring, and duplicate-frame fork sidecars', () => {
  let db: Kysely<DB>;

  beforeAll(async () => {
    db = await getKyselyDB('derived_results_backfill');
    await new DatabaseRepository(db, LoggingRepository.create(), new ConfigRepository()).runForkMigrations();
  }, 120_000);

  beforeEach(async () => {
    await sql`
      TRUNCATE
        immich_fork.orphaned_records,
        immich_fork.asset_health_candidate,
        immich_fork.asset_health,
        immich_fork.asset_health_run,
        immich_fork.asset_best_photo_score,
        immich_fork.asset_video_duplicate_frame,
        public.asset_health_candidate,
        public.asset_health,
        public.asset_health_run,
        public.asset_best_photo_score,
        public.asset_video_duplicate_frame
    `.execute(db);
    await sql`UPDATE immich_fork.state SET phase = 'inactive', active = false WHERE id = 1`.execute(db);
    await db.deleteFrom('asset').execute();
    await db.deleteFrom('user').execute();
  });

  afterAll(async () => db.destroy());

  it('creates fork-only derived tables without cross-schema foreign keys', async () => {
    const expected = [
      'asset_best_photo_score',
      'asset_health',
      'asset_health_candidate',
      'asset_health_run',
      'asset_video_duplicate_frame',
      'orphaned_records',
    ];
    const tables = await sql<{ tableName: string }>`
      SELECT table_name AS "tableName"
      FROM information_schema.tables
      WHERE table_schema = 'immich_fork' AND table_name = ANY(${expected})
      ORDER BY table_name
    `.execute(db);
    const foreignKeys = await sql<{ count: number }>`
      SELECT count(*)::int AS count
      FROM information_schema.table_constraints
      WHERE table_schema = 'immich_fork'
        AND table_name = ANY(${expected})
        AND constraint_type = 'FOREIGN KEY'
    `.execute(db);

    expect(tables.rows.map(({ tableName }) => tableName)).toEqual(expected);
    expect(foreignKeys.rows[0]?.count).toBe(0);
  });

  it('copies exact legacy rows idempotently, verifies every table, and quarantines missing assets', async () => {
    const user = mediumFactory.userInsert();
    const asset = mediumFactory.assetInsert({ ownerId: user.id });
    const orphanAssetId = randomUUID();
    const runId = randomUUID();
    const healthId = randomUUID();
    const candidateId = randomUUID();
    const checkedAt = new Date('2026-07-15T01:02:03.456Z');
    const createdAt = new Date('2026-07-15T02:03:04.567Z');
    const updatedAt = new Date('2026-07-15T03:04:05.678Z');
    await db.insertInto('user').values(user).execute();
    await db.insertInto('asset').values(asset).execute();
    await sql`
      INSERT INTO public.asset_health_run
        (id, category, status, "startedAt", "finishedAt", "totalAssets", "checkedAssets", "foundAssets", error)
      VALUES (${runId}::uuid, 'missing', 'completed', ${createdAt}, ${updatedAt}, 4, 3, 2, NULL)
    `.execute(db);
    await sql`
      INSERT INTO public.asset_health
        (id, "assetId", "runId", category, status, severity, "originalPath", "originalFileName", evidence,
         resolution, "checkedAt", "dismissedAt", "resolvedAt", "createdAt", "updatedAt")
      VALUES (${healthId}::uuid, ${asset.id}::uuid, ${runId}::uuid, 'missing', 'open', 'warning', '/legacy/a.jpg',
        'a.jpg', ${JSON.stringify({ z: 1, a: ['exact'] })}::jsonb, ${JSON.stringify({ action: 'restore' })}::jsonb,
        ${checkedAt}, NULL, NULL, ${createdAt}, ${updatedAt})
    `.execute(db);
    await sql`
      INSERT INTO public.asset_health_candidate
        (id, "healthId", "candidatePath", status, "visualMatchScore", evidence, resolution, "checkedAt", "createdAt", "updatedAt")
      VALUES (${candidateId}::uuid, ${healthId}::uuid, '/candidate/a.jpg', 'open', 0.75,
        ${JSON.stringify({ match: true })}::jsonb, ${JSON.stringify({})}::jsonb, ${checkedAt}, ${createdAt}, ${updatedAt})
    `.execute(db);
    await sql`
      INSERT INTO public.asset_best_photo_score
        ("assetId", "ownerId", score, "aestheticScore", "technicalScore", "subjectScore", "diversityScore",
         "scoreVersion", "computedAt", metadata, "bestFrameTimestampMs", "frameScore", "frameMetadata", "createdAt", "updatedAt")
      VALUES (${asset.id}::uuid, ${user.id}::uuid, 0.91, 0.8, 0.7, 0.6, 0.5, 7, ${checkedAt},
        ${JSON.stringify({ source: 'legacy' })}::jsonb, 1234, 0.88, ${JSON.stringify({ frame: 3 })}::jsonb,
        ${createdAt}, ${updatedAt})
    `.execute(db);
    await sql`
      INSERT INTO public.asset_video_duplicate_frame
        ("assetId", "frameIndex", "timestampMs", path, embedding, "createdAt", "updatedAt")
      VALUES (${asset.id}::uuid, 3, 1234, '/frames/a-3.jpg', ${vector}::vector, ${createdAt}, ${updatedAt})
    `.execute(db);

    await sql`SET session_replication_role = replica`.execute(db);
    try {
      await sql`
        INSERT INTO public.asset_best_photo_score
          ("assetId", "ownerId", score, "scoreVersion", "computedAt")
        VALUES (${orphanAssetId}::uuid, ${user.id}::uuid, 0.2, 1, ${checkedAt})
      `.execute(db);
    } finally {
      await sql`SET session_replication_role = origin`.execute(db);
    }

    const healthRepository = new MediaHealthRepository(db);
    const bestPhotosRepository = new BestPhotosRepository(db);
    const duplicateRepository = new DuplicateRepository(db);
    const first = {
      health: await healthRepository.backfillHealth([asset.id!, orphanAssetId]),
      scores: await bestPhotosRepository.backfillScores([asset.id!, orphanAssetId]),
      frames: await duplicateRepository.backfillVideoDuplicateFrames([asset.id!, orphanAssetId]),
    };
    const second = {
      health: await healthRepository.backfillHealth([orphanAssetId, asset.id!]),
      scores: await bestPhotosRepository.backfillScores([orphanAssetId, asset.id!]),
      frames: await duplicateRepository.backfillVideoDuplicateFrames([orphanAssetId, asset.id!]),
    };

    expect(second).toEqual(first);
    expectVerification(first.health, 2);
    expectVerification(first.scores, 2);
    expectVerification(first.frames, 2);
    expectVerification(first.health.tables.assetHealthRun, 1);
    expectVerification(first.health.tables.assetHealth, 1);
    expectVerification(first.health.tables.assetHealthCandidate, 1);
    expectVerification(first.scores.tables.assetBestPhotoScore, 1);
    expectVerification(first.frames.tables.assetVideoDuplicateFrame, 1);

    const exact = await sql<{ exact: boolean }>`SELECT
      NOT EXISTS (
        SELECT id, category, status, "startedAt", "finishedAt", "totalAssets", "checkedAssets", "foundAssets", error
        FROM public.asset_health_run
        EXCEPT
        SELECT id, category, status, "startedAt", "finishedAt", "totalAssets", "checkedAssets", "foundAssets", error
        FROM immich_fork.asset_health_run
      ) AND NOT EXISTS (
        SELECT id, "assetId", "runId", category, status, severity, "originalPath", "originalFileName", evidence,
          resolution, "checkedAt", "dismissedAt", "resolvedAt", "createdAt", "updatedAt"
        FROM public.asset_health WHERE "assetId" = ${asset.id}::uuid
        EXCEPT
        SELECT id, "assetId", "runId", category, status, severity, "originalPath", "originalFileName", evidence,
          resolution, "checkedAt", "dismissedAt", "resolvedAt", "createdAt", "updatedAt"
        FROM immich_fork.asset_health WHERE "assetId" = ${asset.id}::uuid
      ) AND NOT EXISTS (
        SELECT id, "healthId", "candidatePath", status, "visualMatchScore", evidence, resolution, "checkedAt",
          "createdAt", "updatedAt"
        FROM public.asset_health_candidate WHERE "healthId" = ${healthId}::uuid
        EXCEPT
        SELECT id, "healthId", "candidatePath", status, "visualMatchScore", evidence, resolution, "checkedAt",
          "createdAt", "updatedAt"
        FROM immich_fork.asset_health_candidate WHERE "healthId" = ${healthId}::uuid
      ) AND NOT EXISTS (
        SELECT "assetId", "ownerId", score, "aestheticScore", "technicalScore", "subjectScore", "diversityScore",
          "scoreVersion", "computedAt", metadata, "bestFrameTimestampMs", "frameScore", "frameMetadata", "createdAt", "updatedAt"
        FROM public.asset_best_photo_score WHERE "assetId" = ${asset.id}::uuid
        EXCEPT
        SELECT "assetId", "ownerId", score, "aestheticScore", "technicalScore", "subjectScore", "diversityScore",
          "scoreVersion", "computedAt", metadata, "bestFrameTimestampMs", "frameScore", "frameMetadata", "createdAt", "updatedAt"
        FROM immich_fork.asset_best_photo_score WHERE "assetId" = ${asset.id}::uuid
      ) AND NOT EXISTS (
        SELECT "assetId", "frameIndex", "timestampMs", path, embedding, "createdAt", "updatedAt"
        FROM public.asset_video_duplicate_frame WHERE "assetId" = ${asset.id}::uuid
        EXCEPT
        SELECT "assetId", "frameIndex", "timestampMs", path, embedding, "createdAt", "updatedAt"
        FROM immich_fork.asset_video_duplicate_frame WHERE "assetId" = ${asset.id}::uuid
      ) AS exact`.execute(db);
    const orphan = await sql<{ active: number; archived: number }>`SELECT
      (SELECT count(*)::int FROM immich_fork.asset_best_photo_score WHERE "assetId" = ${orphanAssetId}::uuid) AS active,
      (SELECT count(*)::int FROM immich_fork.orphaned_records
        WHERE "sourceTable" = 'asset_best_photo_score' AND "sourceKey" = ${orphanAssetId}) AS archived
    `.execute(db);

    expect(exact.rows[0]?.exact).toBe(true);
    expect(orphan.rows[0]).toEqual({ active: 0, archived: 1 });
  });

  it.each(['dual-write', 'ready', 'active', 'inactive'] as const)(
    'uses phase-aware production writes, reads, and asset cleanup in %s',
    async (phase) => {
      await sql`UPDATE immich_fork.state SET phase = ${phase}, active = ${phase === 'active'} WHERE id = 1`.execute(db);
      const user = mediumFactory.userInsert();
      const asset = mediumFactory.assetInsert({ ownerId: user.id });
      await db.insertInto('user').values(user).execute();
      await db.insertInto('asset').values(asset).execute();
      const healthRepository = new MediaHealthRepository(db);
      const bestPhotosRepository = new BestPhotosRepository(db);
      const duplicateRepository = new DuplicateRepository(db);
      const run = await healthRepository.createRun(MediaHealthCategory.Corrupt);
      const finding = await healthRepository.upsertFinding({
        assetId: asset.id!,
        runId: run.id,
        category: MediaHealthCategory.Corrupt,
        status: MediaHealthStatus.Found,
        severity: MediaHealthSeverity.Warning,
        originalPath: '/asset.jpg',
        originalFileName: 'asset.jpg',
        evidence: { exact: true },
        resolution: {},
        checkedAt: new Date('2026-07-15T04:05:06.789Z'),
      });
      await bestPhotosRepository.upsertScore({
        assetId: asset.id!,
        ownerId: user.id,
        score: 0.9,
        aestheticScore: null,
        technicalScore: null,
        subjectScore: null,
        diversityScore: null,
        scoreVersion: 1,
        computedAt: new Date('2026-07-15T04:05:06.789Z'),
        metadata: null,
        bestFrameTimestampMs: null,
        frameScore: null,
        frameMetadata: null,
      });
      await duplicateRepository.replaceVideoDuplicateFrames(asset.id!, [
        { assetId: asset.id!, frameIndex: 0, timestampMs: 0, path: '/frame.jpg', embedding: vector },
      ]);

      await expect(healthRepository.getByIds([finding.id])).resolves.toHaveLength(1);
      await expect(bestPhotosRepository.getScore(asset.id!)).resolves.toMatchObject({ score: 0.9 });
      await expect(duplicateRepository.getVideoDuplicateFrames([asset.id!])).resolves.toHaveLength(1);
      const legacy = await sql<{ count: number }>`SELECT
        (SELECT count(*) FROM public.asset_health WHERE "assetId" = ${asset.id}::uuid) +
        (SELECT count(*) FROM public.asset_best_photo_score WHERE "assetId" = ${asset.id}::uuid) +
        (SELECT count(*) FROM public.asset_video_duplicate_frame WHERE "assetId" = ${asset.id}::uuid) AS count
      `.execute(db);
      expect(Number(legacy.rows[0]?.count)).toBe(phase === 'dual-write' ? 3 : 0);

      await new AssetRepository(db).remove({ id: asset.id! });
      const remaining = await sql<{ count: number }>`SELECT
        (SELECT count(*) FROM immich_fork.asset_health WHERE "assetId" = ${asset.id}::uuid) +
        (SELECT count(*) FROM immich_fork.asset_best_photo_score WHERE "assetId" = ${asset.id}::uuid) +
        (SELECT count(*) FROM immich_fork.asset_video_duplicate_frame WHERE "assetId" = ${asset.id}::uuid) AS count
      `.execute(db);
      expect(Number(remaining.rows[0]?.count)).toBe(0);
    },
  );

  it('uses the Task 4 claim token fence for the real health handler', async () => {
    const user = mediumFactory.userInsert();
    const asset = mediumFactory.assetInsert({ ownerId: user.id });
    await db.insertInto('user').values(user).execute();
    await db.insertInto('asset').values(asset).execute();
    await sql`UPDATE immich_fork.state SET phase = 'dual-write' WHERE id = 1`.execute(db);
    const { sut, mocks } = newTestService(ForkSchemaMigrationService);
    (sut as unknown as { db: Kysely<DB> }).db = db;
    sut.onModuleInit();
    mocks.forkSchema.getState.mockResolvedValue({
      active: false,
      phase: 'dual-write',
      schemaVersion: '1',
      upstreamVersion: '3.0.3',
    });
    mocks.forkSchema.claimBatch.mockResolvedValue({ ids: [asset.id!], cursor: 'health-claim-token' });
    mocks.forkSchema.getProgress.mockResolvedValue([]);

    await expect(sut.runBatch('health', 100)).resolves.toBe(JobStatus.Success);
    expect(mocks.forkSchema.completeBatch).toHaveBeenCalledWith(
      'health',
      'health-claim-token',
      1,
      expect.stringMatching(/^[0-9a-f]{64}$/),
    );
    expect(mocks.forkSchema.failBatch).not.toHaveBeenCalled();
  });

  it('removes every derived sidecar through the user-owned asset cleanup path', async () => {
    await sql`UPDATE immich_fork.state SET phase = 'ready' WHERE id = 1`.execute(db);
    const user = mediumFactory.userInsert();
    const assets = [mediumFactory.assetInsert({ ownerId: user.id }), mediumFactory.assetInsert({ ownerId: user.id })];
    await db.insertInto('user').values(user).execute();
    await db.insertInto('asset').values(assets).execute();
    const healthRepository = new MediaHealthRepository(db);
    const bestPhotosRepository = new BestPhotosRepository(db);
    const duplicateRepository = new DuplicateRepository(db);
    const run = await healthRepository.createRun(MediaHealthCategory.Missing);
    for (const asset of assets) {
      await healthRepository.upsertFinding({
        assetId: asset.id!,
        runId: run.id,
        category: MediaHealthCategory.Missing,
        status: MediaHealthStatus.Missing,
        severity: MediaHealthSeverity.Warning,
        originalPath: asset.originalPath,
        originalFileName: asset.originalFileName,
        evidence: {},
        resolution: {},
        checkedAt: new Date(),
      });
      await bestPhotosRepository.upsertScore({
        assetId: asset.id!,
        ownerId: user.id,
        score: 0.5,
        aestheticScore: null,
        technicalScore: null,
        subjectScore: null,
        diversityScore: null,
        scoreVersion: 1,
        computedAt: new Date(),
        metadata: null,
        bestFrameTimestampMs: null,
        frameScore: null,
        frameMetadata: null,
      });
      await duplicateRepository.replaceVideoDuplicateFrames(asset.id!, [
        { assetId: asset.id!, frameIndex: 0, timestampMs: 0, path: `/frame-${asset.id}.jpg`, embedding: vector },
      ]);
    }

    await new AssetRepository(db).deleteAll(user.id);
    const assetIds = assets.map(({ id }) => id);
    const remaining = await sql<{ count: number }>`SELECT
      (SELECT count(*) FROM immich_fork.asset_health WHERE "assetId" = ANY(${assetIds}::uuid[])) +
      (SELECT count(*) FROM immich_fork.asset_best_photo_score WHERE "assetId" = ANY(${assetIds}::uuid[])) +
      (SELECT count(*) FROM immich_fork.asset_video_duplicate_frame WHERE "assetId" = ANY(${assetIds}::uuid[])) AS count
    `.execute(db);
    expect(Number(remaining.rows[0]?.count)).toBe(0);
  });

  it('fails closed when sidecar writes reference missing public or fork parents', async () => {
    await sql`UPDATE immich_fork.state SET phase = 'ready' WHERE id = 1`.execute(db);
    const user = mediumFactory.userInsert();
    await db.insertInto('user').values(user).execute();
    const missingAssetId = randomUUID();
    const missingHealthId = randomUUID();
    const run = await new MediaHealthRepository(db).createRun(MediaHealthCategory.Missing);
    const healthRepository = new MediaHealthRepository(db);

    await expect(
      new BestPhotosRepository(db).upsertScore({
        assetId: missingAssetId,
        ownerId: user.id,
        score: 0.5,
        aestheticScore: null,
        technicalScore: null,
        subjectScore: null,
        diversityScore: null,
        scoreVersion: 1,
        computedAt: new Date(),
        metadata: null,
        bestFrameTimestampMs: null,
        frameScore: null,
        frameMetadata: null,
      }),
    ).rejects.toThrow();
    await expect(
      new DuplicateRepository(db).replaceVideoDuplicateFrames(missingAssetId, [
        { assetId: missingAssetId, frameIndex: 0, timestampMs: 0, path: '/missing.jpg', embedding: vector },
      ]),
    ).rejects.toThrow();
    await expect(
      healthRepository.upsertFinding({
        assetId: missingAssetId,
        runId: run.id,
        category: MediaHealthCategory.Missing,
        status: MediaHealthStatus.Missing,
        severity: MediaHealthSeverity.Warning,
        originalPath: '/missing.jpg',
        originalFileName: 'missing.jpg',
        evidence: {},
        resolution: {},
        checkedAt: new Date(),
      }),
    ).rejects.toThrow();
    await expect(
      healthRepository.replaceCandidates(missingHealthId, [
        {
          healthId: missingHealthId,
          candidatePath: '/missing-candidate.jpg',
          status: MediaHealthStatus.Candidate,
          visualMatchScore: 0.5,
          evidence: {},
          resolution: {},
          checkedAt: new Date(),
        },
      ]),
    ).rejects.toThrow();

    const active = await sql<{ count: number }>`SELECT
      (SELECT count(*) FROM immich_fork.asset_health WHERE "assetId" = ${missingAssetId}::uuid) +
      (SELECT count(*) FROM immich_fork.asset_health_candidate WHERE "healthId" = ${missingHealthId}::uuid) +
      (SELECT count(*) FROM immich_fork.asset_best_photo_score WHERE "assetId" = ${missingAssetId}::uuid) +
      (SELECT count(*) FROM immich_fork.asset_video_duplicate_frame WHERE "assetId" = ${missingAssetId}::uuid) AS count
    `.execute(db);
    expect(Number(active.rows[0]?.count)).toBe(0);
  });

  it.each(['single', 'bulk'] as const)(
    'serializes %s asset deletion against concurrent sidecar writes',
    async (mode) => {
      await sql`UPDATE immich_fork.state SET phase = 'ready' WHERE id = 1`.execute(db);
      const user = mediumFactory.userInsert();
      const asset = mediumFactory.assetInsert({ ownerId: user.id });
      await db.insertInto('user').values(user).execute();
      await db.insertInto('asset').values(asset).execute();
      const advisoryKey = mode === 'single' ? 730_071 : 730_072;
      const functionName = `task7_block_${mode}_derived_cleanup`;
      const triggerName = `task7_block_${mode}_derived_cleanup`;
      await sql
        .raw(
          `
        CREATE FUNCTION public.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          PERFORM pg_advisory_xact_lock(${advisoryKey});
          RETURN NULL;
        END $$
      `,
        )
        .execute(db);
      await sql
        .raw(
          `
        CREATE TRIGGER ${triggerName}
        BEFORE DELETE ON immich_fork.asset_health
        FOR EACH STATEMENT EXECUTE FUNCTION public.${functionName}()
      `,
        )
        .execute(db);
      let deleting!: Promise<void>;
      let writing!: Promise<{ status: 'fulfilled' } | { status: 'rejected'; error: unknown }>;
      try {
        await db.transaction().execute(async (controller) => {
          await sql`SELECT pg_advisory_lock(${advisoryKey})`.execute(controller);
          try {
            const assetRepository = new AssetRepository(db);
            deleting = mode === 'single' ? assetRepository.remove(asset) : assetRepository.deleteAll(user.id);
            await vi.waitFor(async () => {
              const waiting = await sql<{ count: number }>`
                SELECT count(*)::int AS count FROM pg_locks
                WHERE locktype = 'advisory' AND objid = ${advisoryKey} AND NOT granted
              `.execute(db);
              expect(waiting.rows[0]?.count).toBe(1);
            });
            writing = new BestPhotosRepository(db)
              .upsertScore({
                assetId: asset.id!,
                ownerId: user.id,
                score: 0.9,
                aestheticScore: null,
                technicalScore: null,
                subjectScore: null,
                diversityScore: null,
                scoreVersion: 1,
                computedAt: new Date(),
                metadata: null,
                bestFrameTimestampMs: null,
                frameScore: null,
                frameMetadata: null,
              })
              .then(
                () => ({ status: 'fulfilled' as const }),
                (error: unknown) => ({ status: 'rejected' as const, error }),
              );
          } finally {
            await sql`SELECT pg_advisory_unlock(${advisoryKey})`.execute(controller);
          }
        });
        await deleting;
        expect(await writing).toMatchObject({ status: 'rejected' });
        const remaining = await sql<{ count: number }>`
          SELECT count(*)::int AS count FROM immich_fork.asset_best_photo_score
          WHERE "assetId" = ${asset.id}::uuid
        `.execute(db);
        expect(remaining.rows[0]?.count).toBe(0);
      } finally {
        await sql.raw(`DROP TRIGGER IF EXISTS ${triggerName} ON immich_fork.asset_health`).execute(db);
        await sql.raw(`DROP FUNCTION IF EXISTS public.${functionName}()`).execute(db);
      }
    },
  );

  it('reconciles every derived table in both directions and removes stale health trees', async () => {
    const user = mediumFactory.userInsert();
    const asset = mediumFactory.assetInsert({ ownerId: user.id });
    await db.insertInto('user').values(user).execute();
    await db.insertInto('asset').values(asset).execute();
    const runId = randomUUID();
    const healthId = randomUUID();
    const candidateId = randomUUID();
    await sql`INSERT INTO public.asset_health_run (id, category, status) VALUES (${runId}::uuid, 'missing', 'completed')`.execute(
      db,
    );
    await sql`
      INSERT INTO public.asset_health
        (id, "assetId", "runId", category, status, severity, "originalPath", "originalFileName", evidence, resolution, "checkedAt")
      VALUES (${healthId}::uuid, ${asset.id}::uuid, ${runId}::uuid, 'missing', 'missing', 'warning', '/a.jpg', 'a.jpg', '{}'::jsonb, '{}'::jsonb, now())
    `.execute(db);
    await sql`
      INSERT INTO public.asset_health_candidate
        (id, "healthId", "candidatePath", status, evidence, resolution, "checkedAt")
      VALUES (${candidateId}::uuid, ${healthId}::uuid, '/candidate.jpg', 'candidate', '{}'::jsonb, '{}'::jsonb, now())
    `.execute(db);
    await sql`
      INSERT INTO public.asset_best_photo_score
        ("assetId", "ownerId", score, "scoreVersion", "computedAt")
      VALUES (${asset.id}::uuid, ${user.id}::uuid, 0.8, 1, now())
    `.execute(db);
    await sql`
      INSERT INTO public.asset_video_duplicate_frame
        ("assetId", "frameIndex", "timestampMs", path, embedding)
      VALUES (${asset.id}::uuid, 0, 0, '/frame.jpg', ${vector}::vector)
    `.execute(db);
    const healthRepository = new MediaHealthRepository(db);
    const bestPhotosRepository = new BestPhotosRepository(db);
    const duplicateRepository = new DuplicateRepository(db);
    await healthRepository.backfillHealth([asset.id!]);
    await bestPhotosRepository.backfillScores([asset.id!]);
    await duplicateRepository.backfillVideoDuplicateFrames([asset.id!]);

    const staleRunId = randomUUID();
    const staleHealthId = randomUUID();
    await sql`INSERT INTO immich_fork.asset_health_run (id, category, status) VALUES (${staleRunId}::uuid, 'corrupt', 'completed')`.execute(
      db,
    );
    await sql`
      INSERT INTO immich_fork.asset_health
        (id, "assetId", "runId", category, status, severity, "originalPath", "originalFileName", evidence, resolution, "checkedAt")
      VALUES (${staleHealthId}::uuid, ${asset.id}::uuid, ${staleRunId}::uuid, 'corrupt', 'corrupt_suspect', 'warning', '/stale.jpg', 'stale.jpg', '{}'::jsonb, '{}'::jsonb, now())
    `.execute(db);
    await sql`
      INSERT INTO immich_fork.asset_health_candidate
        ("healthId", "candidatePath", status, evidence, resolution, "checkedAt")
      VALUES (${staleHealthId}::uuid, '/stale-candidate.jpg', 'candidate', '{}'::jsonb, '{}'::jsonb, now())
    `.execute(db);
    const reconciled = await healthRepository.backfillHealth([asset.id!]);

    const differences = await sql<{ tableName: string; count: number }>`
      SELECT 'asset_health_run' AS "tableName", count(*)::int AS count FROM (
        (SELECT * FROM public.asset_health_run EXCEPT SELECT * FROM immich_fork.asset_health_run)
        UNION ALL
        (SELECT * FROM immich_fork.asset_health_run EXCEPT SELECT * FROM public.asset_health_run)
      ) difference
      UNION ALL SELECT 'asset_health', count(*)::int FROM (
        (SELECT * FROM public.asset_health EXCEPT SELECT * FROM immich_fork.asset_health)
        UNION ALL
        (SELECT * FROM immich_fork.asset_health EXCEPT SELECT * FROM public.asset_health)
      ) difference
      UNION ALL SELECT 'asset_health_candidate', count(*)::int FROM (
        (SELECT * FROM public.asset_health_candidate EXCEPT SELECT * FROM immich_fork.asset_health_candidate)
        UNION ALL
        (SELECT * FROM immich_fork.asset_health_candidate EXCEPT SELECT * FROM public.asset_health_candidate)
      ) difference
      UNION ALL SELECT 'asset_best_photo_score', count(*)::int FROM (
        (SELECT * FROM public.asset_best_photo_score EXCEPT SELECT * FROM immich_fork.asset_best_photo_score)
        UNION ALL
        (SELECT * FROM immich_fork.asset_best_photo_score EXCEPT SELECT * FROM public.asset_best_photo_score)
      ) difference
      UNION ALL SELECT 'asset_video_duplicate_frame', count(*)::int FROM (
        (SELECT * FROM public.asset_video_duplicate_frame EXCEPT SELECT * FROM immich_fork.asset_video_duplicate_frame)
        UNION ALL
        (SELECT * FROM immich_fork.asset_video_duplicate_frame EXCEPT SELECT * FROM public.asset_video_duplicate_frame)
      ) difference
      ORDER BY "tableName"
    `.execute(db);
    expect(differences.rows).toEqual([
      { tableName: 'asset_best_photo_score', count: 0 },
      { tableName: 'asset_health', count: 0 },
      { tableName: 'asset_health_candidate', count: 0 },
      { tableName: 'asset_health_run', count: 0 },
      { tableName: 'asset_video_duplicate_frame', count: 0 },
    ]);
    expectVerification(reconciled.tables.assetHealthRun, 1);
    expectVerification(reconciled.tables.assetHealth, 1);
    expectVerification(reconciled.tables.assetHealthCandidate, 1);

    await sql`DELETE FROM public.asset_health_candidate WHERE "healthId" = ${healthId}::uuid`.execute(db);
    await sql`DELETE FROM public.asset_health WHERE id = ${healthId}::uuid`.execute(db);
    await sql`DELETE FROM public.asset_health_run WHERE id = ${runId}::uuid`.execute(db);
    const empty = await healthRepository.backfillHealth([asset.id!]);
    expectVerification(empty.tables.assetHealthRun, 0);
    expectVerification(empty.tables.assetHealth, 0);
    expectVerification(empty.tables.assetHealthCandidate, 0);
    const stale = await sql<{ count: number }>`SELECT
      (SELECT count(*) FROM immich_fork.asset_health_run WHERE id = ANY(${[runId, staleRunId]}::uuid[])) +
      (SELECT count(*) FROM immich_fork.asset_health WHERE id = ANY(${[healthId, staleHealthId]}::uuid[])) +
      (SELECT count(*) FROM immich_fork.asset_health_candidate WHERE "healthId" = ANY(${[healthId, staleHealthId]}::uuid[])) AS count
    `.execute(db);
    expect(Number(stale.rows[0]?.count)).toBe(0);
  });
});
