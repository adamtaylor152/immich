import { Kysely, sql } from 'kysely';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { ForkAlbumMetadataRepository } from 'src/repositories/fork-album-metadata.repository';
import { ForkConfigRepository } from 'src/repositories/fork-config.repository';
import { ForkEnrichmentRepository } from 'src/repositories/fork-enrichment.repository';
import { ForkPrivacyRepository } from 'src/repositories/fork-privacy.repository';
import { BACKFILL_KINDS, ForkSchemaRepository } from 'src/repositories/fork-schema.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SmartAlbumRepository } from 'src/repositories/smart-album.repository';
import { DB } from 'src/schema';
import { mediumFactory } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

describe('fork schema authority cutover', () => {
  let db: Kysely<DB>;

  beforeAll(async () => {
    db = await getKyselyDB('authority_cutover');
    await new DatabaseRepository(db, LoggingRepository.create(), new ConfigRepository()).runForkMigrations();
  });

  beforeEach(async () => {
    await db.deleteFrom('asset').execute();
    await db.deleteFrom('user').execute();
    await sql`TRUNCATE immich_fork.migration_audit, immich_fork.backfill_progress`.execute(db);
    await sql`
      UPDATE immich_fork.state
      SET active = false,
          phase = 'ready',
          "schemaVersion" = '1',
          "checkpointStartedAt" = NULL,
          "checkpointCompletedAt" = NULL,
          "updatedAt" = now()
      WHERE id = 1
    `.execute(db);
  });

  afterAll(async () => db.destroy());

  it('keeps ready writes visible to a previous-fork public projection while dual-writing the sidecar', async () => {
    const user = mediumFactory.userInsert();
    await db.insertInto('user').values(user).execute();

    await new SmartAlbumRepository(db).ensureForUser(user.id, [{ kind: 'travel', name: 'Travel' }]);

    const previousForkProjection = await db
      .selectFrom('smart_album')
      .select(['id', 'kind', 'ownerId'])
      .where('ownerId', '=', user.id)
      .execute();
    const sidecar = await sql<{ id: string; kind: string; ownerId: string }>`
      SELECT id::text AS id, kind, "ownerId"::text AS "ownerId"
      FROM immich_fork.smart_album_rule
      WHERE "ownerId" = ${user.id}::uuid
    `.execute(db);

    expect(previousForkProjection).toEqual([{ id: expect.any(String), kind: 'travel', ownerId: user.id }]);
    expect(sidecar.rows).toEqual([{ id: previousForkProjection[0]!.id, kind: 'travel', ownerId: user.id }]);
  });

  it('uses legacy/public reads through ready and exposes no fork overlays while inactive', async () => {
    const repositories = [
      new ForkPrivacyRepository(db),
      new ForkAlbumMetadataRepository(db),
      new ForkEnrichmentRepository(db),
      new ForkConfigRepository(db),
    ];

    for (const repository of repositories) {
      await expect(repository.shouldReadSidecar()).resolves.toBe(false);
    }

    await sql`UPDATE immich_fork.state SET phase = 'inactive', active = false WHERE id = 1`.execute(db);

    for (const repository of repositories) {
      await expect(repository.shouldReadSidecar()).resolves.toBe(false);
    }
  });

  it('atomically switches ready to inactive, disables legacy triggers, and records the checkpoint', async () => {
    const repository = new DatabaseRepository(db, LoggingRepository.create(), new ConfigRepository());
    const reportDigest = 'a'.repeat(64);

    const checkpoint = await repository.commitForkSchemaCutover(reportDigest, async (transaction) => {
      const locked = await sql<{ active: boolean; phase: string }>`
        SELECT active, phase FROM immich_fork.state WHERE id = 1 FOR UPDATE
      `.execute(transaction);
      expect(locked.rows).toEqual([{ active: false, phase: 'ready' }]);
    });

    const state = await sql<{
      active: boolean;
      checkpointCompletedAt: Date | null;
      phase: string;
      schemaVersion: string;
    }>`
      SELECT active, phase, "schemaVersion", "checkpointCompletedAt"
      FROM immich_fork.state WHERE id = 1
    `.execute(db);
    const trigger = await sql<{ enabled: string }>`
      SELECT tgenabled AS enabled FROM pg_trigger
      WHERE tgname = 'album_parent_cycle_check_trigger'
    `.execute(db);
    const audit = await sql<{ details: { reportDigest: string }; phase: string; status: string }>`
      SELECT phase, status, details FROM immich_fork.migration_audit
      WHERE name = 'fork-schema-cutover'
    `.execute(db);

    expect(checkpoint).toMatchObject({ phase: 'inactive', reportDigest, schemaVersion: '2' });
    expect(state.rows).toEqual([
      {
        active: false,
        checkpointCompletedAt: expect.any(Date),
        phase: 'inactive',
        schemaVersion: '2',
      },
    ]);
    expect(trigger.rows).toEqual([{ enabled: 'D' }]);
    expect(audit.rows).toEqual([{ details: { reportDigest }, phase: 'official-cutover', status: 'applied' }]);
  });

  it('allows activation only as the final inactive-to-active reconciliation transition', async () => {
    const repository = new ForkSchemaRepository(db);
    await sql`
      INSERT INTO immich_fork.backfill_progress (kind, remaining)
      SELECT kind, 0 FROM unnest(${[...BACKFILL_KINDS]}::text[]) AS kind
    `.execute(db);

    await expect(repository.activateAfterReturnReconciliation()).rejects.toThrow(
      'Fork schema activation requires inactive phase',
    );
    await expect(repository.getState()).resolves.toMatchObject({ active: false, phase: 'ready' });

    await sql`UPDATE immich_fork.state SET phase = 'inactive', active = false WHERE id = 1`.execute(db);
    await expect(repository.activateAfterReturnReconciliation()).resolves.toBeUndefined();
    await expect(repository.getState()).resolves.toMatchObject({ active: true, phase: 'active' });
  });
});
