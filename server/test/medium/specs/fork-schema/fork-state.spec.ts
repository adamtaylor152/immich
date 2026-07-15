import { Kysely, sql } from 'kysely';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { BACKFILL_KINDS, ForkSchemaRepository, type BackfillKind } from 'src/repositories/fork-schema.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { mediumFactory } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

describe(ForkSchemaRepository.name, () => {
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
      UPDATE immich_fork.state
      SET active = false, phase = 'inactive', "updatedAt" = now()
      WHERE id = 1
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

  it('durably reserves one batch per kind and reclaims an expired reservation after reconstruction', async () => {
    const assetIds = await seedAssets(3);

    const claims = await Promise.all([repository.claimBatch('privacy', 2), repository.claimBatch('privacy', 2)]);
    const claimed = claims.find((ids) => ids.length > 0) ?? [];
    const skipped = claims.find((ids) => ids.length === 0) ?? [];

    expect(claimed).toEqual(assetIds.slice(0, 2));
    expect(skipped).toEqual([]);
    expect(new Set(claims.flat()).size).toBe(claims.flat().length);

    const reservedProgress = await sql<{
      claimedCursor: string | null;
      cursor: string | null;
      processed: number;
      remaining: number;
    }>`
      SELECT cursor, processed, remaining, "claimedCursor"
      FROM immich_fork.backfill_progress
      WHERE kind = 'privacy'
    `.execute(db);
    expect(reservedProgress.rows[0]).toEqual({
      claimedCursor: claimed.at(-1),
      cursor: null,
      processed: 0,
      remaining: 3,
    });

    const reconstructed = new ForkSchemaRepository(db);
    await expect(reconstructed.claimBatch('privacy', 2)).resolves.toEqual([]);

    await sql`
      UPDATE immich_fork.backfill_progress
      SET "claimExpiresAt" = now() - interval '1 second'
      WHERE kind = 'privacy'
    `.execute(db);
    await expect(reconstructed.claimBatch('privacy', 2)).resolves.toEqual(claimed);

    await reconstructed.completeBatch('privacy', claimed.at(-1)!, claimed.length, 'digest-1');

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
      cursor: claimed.at(-1),
      digest: 'digest-1',
      processed: 2,
      remaining: 1,
    });

    const resumed = new ForkSchemaRepository(db);
    await expect(resumed.claimBatch('privacy', 2)).resolves.toEqual(assetIds.slice(2));
  });

  it('rejects activation until every backfill kind reports no remaining work', async () => {
    await sql`
      INSERT INTO immich_fork.backfill_progress (kind, remaining)
      SELECT kind, CASE WHEN kind = 'privacy' THEN 1 ELSE 0 END
      FROM unnest(${[...BACKFILL_KINDS]}::text[]) AS kind
    `.execute(db);

    await expect(repository.setPhase('active')).rejects.toThrow(
      'Cannot activate fork schema with incomplete backfills',
    );
    await expect(repository.getState()).resolves.toMatchObject({ active: false, phase: 'inactive' });

    await sql`UPDATE immich_fork.backfill_progress SET remaining = 0 WHERE kind = 'privacy'`.execute(db);
    await repository.setPhase('active');

    await expect(repository.getState()).resolves.toMatchObject({ active: true, phase: 'active' });
  });

  it('rejects completion for a cursor that does not own the active reservation', async () => {
    await seedAssets(1);
    await repository.claimBatch('privacy', 1);

    await expect(
      repository.completeBatch('privacy', '00000000-0000-0000-0000-000000000000', 1, 'digest'),
    ).rejects.toThrow('Backfill reservation does not match completion cursor');
  });

  it.each(BACKFILL_KINDS)('accepts the %s backfill kind', async (kind: BackfillKind) => {
    await expect(repository.claimBatch(kind, 1)).resolves.toEqual([]);
  });
});
