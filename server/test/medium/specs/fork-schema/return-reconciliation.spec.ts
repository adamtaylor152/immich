import { Kysely, sql } from 'kysely';
import supportedVersions from 'src/fork-schema/supported-versions.json';
import { ForkHandoffRepository } from 'src/repositories/fork-handoff.repository';
import { DB } from 'src/schema';
import { getKyselyDB } from 'test/utils';

describe('certified fork return evidence', () => {
  let db: Kysely<DB>;
  let repository: ForkHandoffRepository;

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
});
