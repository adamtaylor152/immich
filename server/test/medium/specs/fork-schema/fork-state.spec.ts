import { Kysely, sql } from 'kysely';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import {
  BACKFILL_KINDS,
  ForkSchemaRepository,
  type BackfillKind,
  type ForkSchemaPhase,
} from 'src/repositories/fork-schema.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { mediumFactory } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

describe(ForkSchemaRepository.name, () => {
  const digest = 'a'.repeat(64);
  let db: Kysely<DB>;
  let repository: ForkSchemaRepository;

  beforeAll(async () => {
    db = await getKyselyDB('fork_state');
    const databaseRepository = new DatabaseRepository(db, LoggingRepository.create(), new ConfigRepository());
    await databaseRepository.runForkMigrations();
  });

  beforeEach(async () => {
    await sql`DELETE FROM immich_fork.backfill_progress`.execute(db);
    await db.deleteFrom('asset').execute();
    await db.deleteFrom('user').execute();
    await sql`
      INSERT INTO immich_fork.state (id, active, "schemaVersion", "upstreamVersion", phase)
      VALUES (1, false, '1', '3.0.3', 'inactive')
      ON CONFLICT (id) DO UPDATE
      SET active = false, phase = 'inactive', "updatedAt" = now()
    `.execute(db);
    repository = new ForkSchemaRepository(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  const seedAssets = async (count: number) => {
    const user = mediumFactory.userInsert();
    await db.insertInto('user').values(user).execute();
    const assets = Array.from({ length: count }, () => mediumFactory.assetInsert({ ownerId: user.id }));
    await db.insertInto('asset').values(assets).execute();
    return assets.map(({ id }) => id).sort();
  };

  it('reads and updates the singleton state', async () => {
    await expect(repository.getState()).resolves.toEqual({
      active: false,
      phase: 'inactive',
      schemaVersion: '1',
      upstreamVersion: '3.0.3',
    });

    await repository.setPhase('legacy');

    await expect(repository.getState()).resolves.toEqual({
      active: false,
      phase: 'legacy',
      schemaVersion: '1',
      upstreamVersion: '3.0.3',
    });
  });

  it('rejects phase changes when singleton state is missing', async () => {
    await sql`DELETE FROM immich_fork.state WHERE id = 1`.execute(db);

    await expect(repository.setPhase('legacy')).rejects.toThrow('Fork schema state is not initialized');
  });

  it('atomically allows only one matching phase transition', async () => {
    await repository.setPhase('legacy');

    const transitions = await Promise.all([
      repository.transitionPhase('legacy', 'dual-write'),
      repository.transitionPhase('legacy', 'dual-write'),
    ]);

    expect(transitions.sort()).toEqual([false, true]);
    await expect(repository.getState()).resolves.toMatchObject({ phase: 'dual-write' });
  });

  it('rejects atomic phase transitions when singleton state is missing', async () => {
    await sql`DELETE FROM immich_fork.state WHERE id = 1`.execute(db);

    await expect(repository.transitionPhase('legacy', 'dual-write')).rejects.toThrow(
      'Fork schema state is not initialized',
    );
  });

  it('durably reserves one batch per kind and reclaims an expired reservation after reconstruction', async () => {
    const assetIds = await seedAssets(3);
    await repository.setPhase('dual-write');

    const claims = await Promise.all([repository.claimBatch('privacy', 2), repository.claimBatch('privacy', 2)]);
    const claimed = claims.find((claim) => claim !== null)!;
    const skipped = claims.find((claim) => claim === null);

    expect(claimed.ids).toEqual(assetIds.slice(0, 2));
    expect(claimed.cursor).toMatch(/^[0-9a-f-]{36}$/);
    expect(skipped).toBeNull();

    const reservedProgress = await sql<{
      claimedCursor: string | null;
      claimToken: string | null;
      cursor: string | null;
      processed: number;
      remaining: number;
    }>`
      SELECT cursor, processed, remaining, "claimedCursor", "claimToken"
      FROM immich_fork.backfill_progress
      WHERE kind = 'privacy'
    `.execute(db);
    expect(reservedProgress.rows[0]).toEqual({
      claimedCursor: claimed.ids.at(-1),
      claimToken: claimed.cursor,
      cursor: null,
      processed: 0,
      remaining: 3,
    });

    const reconstructed = new ForkSchemaRepository(db);
    await expect(reconstructed.claimBatch('privacy', 2)).resolves.toBeNull();

    await sql`
      UPDATE immich_fork.backfill_progress
      SET "claimExpiresAt" = now() - interval '1 second'
      WHERE kind = 'privacy'
    `.execute(db);
    const reclaimed = await reconstructed.claimBatch('privacy', 2);
    expect(reclaimed?.ids).toEqual(claimed.ids);
    expect(reclaimed?.cursor).not.toBe(claimed.cursor);

    await reconstructed.completeBatch('privacy', reclaimed!.cursor, reclaimed!.ids.length, digest);

    const completedProgress = await sql<{
      claimedCursor: string | null;
      cursor: string | null;
      digest: string | null;
      processed: number;
      remaining: number;
    }>`
      SELECT cursor, processed, remaining, digest, "claimedCursor"
      FROM immich_fork.backfill_progress
      WHERE kind = 'privacy'
    `.execute(db);
    expect(completedProgress.rows[0]).toEqual({
      claimedCursor: null,
      cursor: claimed.ids.at(-1),
      digest,
      processed: 2,
      remaining: 1,
    });

    const resumed = new ForkSchemaRepository(db);
    await expect(resumed.claimBatch('privacy', 2)).resolves.toEqual(
      expect.objectContaining({ ids: assetIds.slice(2), cursor: expect.any(String) }),
    );
  });

  it('clears the final source cursor atomically without making the completed batch claimable again', async () => {
    await seedAssets(1);
    await repository.setPhase('dual-write');
    const claim = await repository.claimBatch('privacy', 1);

    await repository.completeBatch('privacy', claim!.cursor, claim!.ids.length, digest);

    const completed = await sql<{
      claimToken: string | null;
      claimedCursor: string | null;
      claimedIds: string[];
      cursor: string | null;
      digest: string | null;
      processed: number;
      remaining: number;
    }>`
      SELECT cursor, processed, remaining, digest, "claimedCursor", "claimedIds", "claimToken"
      FROM immich_fork.backfill_progress
      WHERE kind = 'privacy'
    `.execute(db);
    expect(completed.rows[0]).toEqual({
      claimToken: null,
      claimedCursor: null,
      claimedIds: [],
      cursor: null,
      digest,
      processed: 1,
      remaining: 0,
    });
    await expect(repository.claimBatch('privacy', 1)).resolves.toBeNull();
  });

  it('fences a stale worker after an expired reservation is reclaimed', async () => {
    await seedAssets(1);
    await repository.setPhase('dual-write');
    const staleClaim = await repository.claimBatch('privacy', 1);
    await sql`
      UPDATE immich_fork.backfill_progress
      SET "claimExpiresAt" = now() - interval '1 second'
      WHERE kind = 'privacy'
    `.execute(db);
    const currentClaim = await repository.claimBatch('privacy', 1);

    expect(currentClaim?.ids).toEqual(staleClaim?.ids);
    expect(currentClaim?.cursor).not.toBe(staleClaim?.cursor);
    await expect(repository.completeBatch('privacy', staleClaim!.cursor, 1, digest)).rejects.toThrow(
      'Backfill reservation does not match completion cursor',
    );
    await expect(repository.completeBatch('privacy', currentClaim!.cursor, 1, digest)).resolves.toBeUndefined();
  });

  it.each([0, 1, 3])('rejects a non-exact processed count of %s without advancing progress', async (count) => {
    await seedAssets(2);
    await repository.setPhase('dual-write');
    const claim = await repository.claimBatch('privacy', 2);

    await expect(repository.completeBatch('privacy', claim!.cursor, count, digest)).rejects.toThrow(
      'Backfill processed count must equal the reserved batch size',
    );
    const progress = await sql<{
      claimedIds: string[];
      cursor: string | null;
      digest: string | null;
      processed: number;
    }>`
      SELECT "claimedIds", cursor, digest, processed
      FROM immich_fork.backfill_progress
      WHERE kind = 'privacy'
    `.execute(db);
    expect(progress.rows[0]).toEqual({ claimedIds: claim!.ids, cursor: null, digest: null, processed: 0 });
  });

  it.each(['', 'abc', 'A'.repeat(64), `${'a'.repeat(63)}g`])(
    'rejects a non-canonical digest without advancing progress: %s',
    async (invalidDigest) => {
      await seedAssets(1);
      await repository.setPhase('dual-write');
      const claim = await repository.claimBatch('privacy', 1);

      await expect(repository.completeBatch('privacy', claim!.cursor, 1, invalidDigest)).rejects.toThrow(
        'Backfill digest must be a canonical SHA-256 hex string',
      );
      const progress = await sql<{ cursor: string | null; digest: string | null; processed: number }>`
        SELECT cursor, digest, processed
        FROM immich_fork.backfill_progress
        WHERE kind = 'privacy'
      `.execute(db);
      expect(progress.rows[0]).toEqual({ cursor: null, digest: null, processed: 0 });
    },
  );

  it('records a batch failure, releases its lease, and preserves the completed cursor', async () => {
    await seedAssets(1);
    await repository.setPhase('dual-write');
    const failedClaim = await repository.claimBatch('privacy', 1);

    await repository.failBatch('privacy', failedClaim!.cursor, 'sidecar write failed');

    const progress = await sql<{
      claimToken: string | null;
      claimedIds: string[];
      cursor: string | null;
      lastError: string | null;
    }>`
      SELECT cursor, "lastError", "claimToken", "claimedIds"
      FROM immich_fork.backfill_progress
      WHERE kind = 'privacy'
    `.execute(db);
    expect(progress.rows[0]).toEqual({
      claimToken: null,
      claimedIds: [],
      cursor: null,
      lastError: 'sidecar write failed',
    });

    await sql`UPDATE immich_fork.backfill_progress SET remaining = 0 WHERE kind = 'privacy'`.execute(db);
    await sql`
      INSERT INTO immich_fork.backfill_progress (kind, remaining)
      SELECT kind, 0
      FROM unnest(${BACKFILL_KINDS.filter((kind) => kind !== 'privacy')}::text[]) AS kind
    `.execute(db);
    await repository.setPhase('inactive');
    await expect(repository.activateAfterReturnReconciliation()).rejects.toThrow(
      'Cannot activate fork schema with incomplete backfills',
    );

    await repository.setPhase('dual-write');
    const retryClaim = await repository.claimBatch('privacy', 1);
    expect(retryClaim?.ids).toEqual(failedClaim?.ids);
    expect(retryClaim?.cursor).not.toBe(failedClaim?.cursor);
  });

  it.each<ForkSchemaPhase>(['legacy', 'ready', 'inactive', 'active', 'failed'])(
    'rejects batch claims in the %s phase',
    async (phase) => {
      await sql`
        UPDATE immich_fork.state
        SET phase = ${phase}, active = ${phase === 'active'}
        WHERE id = 1
      `.execute(db);

      await expect(repository.claimBatch('privacy', 1)).rejects.toThrow(
        'Fork schema backfills can only run in dual-write phase',
      );
    },
  );

  it('rejects activation until every backfill kind reports no remaining work', async () => {
    await sql`
      INSERT INTO immich_fork.backfill_progress (kind, remaining)
      SELECT kind, CASE WHEN kind = 'privacy' THEN 1 ELSE 0 END
      FROM unnest(${[...BACKFILL_KINDS]}::text[]) AS kind
    `.execute(db);

    await expect(repository.activateAfterReturnReconciliation()).rejects.toThrow(
      'Cannot activate fork schema with incomplete backfills',
    );
    await expect(repository.transitionPhase('inactive', 'active')).rejects.toThrow(
      'Fork schema activation requires return reconciliation',
    );
    await expect(repository.getState()).resolves.toMatchObject({ active: false, phase: 'inactive' });

    await sql`UPDATE immich_fork.backfill_progress SET remaining = 0 WHERE kind = 'privacy'`.execute(db);
    await repository.activateAfterReturnReconciliation();

    await expect(repository.getState()).resolves.toMatchObject({ active: true, phase: 'active' });
  });

  it('rejects completion for a cursor that does not own the active reservation', async () => {
    await seedAssets(1);
    await repository.setPhase('dual-write');
    await repository.claimBatch('privacy', 1);

    await expect(
      repository.completeBatch('privacy', '00000000-0000-0000-0000-000000000000', 1, digest),
    ).rejects.toThrow('Backfill reservation does not match completion cursor');
  });

  it.each(BACKFILL_KINDS)('accepts the %s backfill kind', async (kind: BackfillKind) => {
    await repository.setPhase('dual-write');
    await expect(repository.claimBatch(kind, 1)).resolves.toBeNull();
  });
});
