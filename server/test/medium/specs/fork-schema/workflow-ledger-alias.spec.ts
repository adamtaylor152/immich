import { Kysely, sql } from 'kysely';
import {
  ADD_PLUGIN_METHOD_ALLOWED_HOSTS_MIGRATION,
  ADD_PLUGIN_TEMPLATES_MIGRATION,
  aliasLegacyWorkflowMigration,
  classifyWorkflowCompatibility,
  getWorkflowCompatibilityEvidence,
  LEGACY_WORKFLOW_MIGRATION,
  OFFICIAL_WORKFLOW_MIGRATION,
} from 'src/fork-schema/workflow-compatibility';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { mediumFactory } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

const markerTimestamp = '2026-07-15T00:00:00.000Z';
const reportDigest = 'a'.repeat(64);
const workflowMarkers = [
  LEGACY_WORKFLOW_MIGRATION,
  OFFICIAL_WORKFLOW_MIGRATION,
  ADD_PLUGIN_TEMPLATES_MIGRATION,
  ADD_PLUGIN_METHOD_ALLOWED_HOSTS_MIGRATION,
];

describe('workflow migration ledger alias', () => {
  let db: Kysely<DB>;

  beforeAll(async () => {
    db = await getKyselyDB('workflow_ledger_alias');
  });

  afterAll(async () => db.destroy());

  beforeEach(async () => {
    await sql`TRUNCATE public.workflow_step, public.workflow, public.plugin_method, public.plugin CASCADE`.execute(db);
    await db.deleteFrom('user').execute();
    await sql`DELETE FROM public.kysely_migrations WHERE name = ANY(${workflowMarkers})`.execute(db);
    await sql`DELETE FROM immich_fork.migration_audit WHERE phase = 'workflow-alias'`.execute(db);
    await sql`ALTER TABLE public.workflow ENABLE TRIGGER "workflow_updatedAt"`.execute(db);

    const user = mediumFactory.userInsert();
    await db.insertInto('user').values(user).execute();
    await sql`
      INSERT INTO public.plugin
        (id, enabled, name, version, title, description, author, "wasmBytes", "createdAt", "updatedAt")
      VALUES
        ('10000000-0000-4000-8000-000000000001', true, 'fixture.plugin', '1.0.0', 'Fixture',
         'binary and json digest fixture', 'Immich', decode('00ff1020', 'hex'),
         '2026-07-15T01:02:03.000Z', '2026-07-15T01:02:04.000Z')
    `.execute(db);
    await sql`
      INSERT INTO public.plugin_method
        (id, "pluginId", name, title, description, types, "hostFunctions", "uiHints", schema)
      VALUES
        ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'process',
         'Process', 'Fixture method', ARRAY['asset']::varchar[], true, ARRAY['hidden', 'batch']::varchar[],
         ${JSON.stringify({ type: 'object', properties: { quality: { type: 'number', default: 0.75 } } })}::jsonb)
    `.execute(db);
    await sql`
      INSERT INTO public.workflow
        (id, "ownerId", trigger, name, description, "createdAt", "updatedAt", "updateId", enabled)
      VALUES
        ('30000000-0000-4000-8000-000000000003', ${user.id}::uuid, 'asset.uploaded', 'Fixture workflow',
         'Preserved through alias', '2026-07-15T02:03:04.000Z', '2026-07-15T02:03:05.000Z',
         '40000000-0000-4000-8000-000000000004', true)
    `.execute(db);
    await sql`
      INSERT INTO public.workflow_step
        (id, enabled, "workflowId", "pluginMethodId", config, "order")
      VALUES
        ('50000000-0000-4000-8000-000000000005', true, '30000000-0000-4000-8000-000000000003',
         '20000000-0000-4000-8000-000000000002',
         ${JSON.stringify({ quality: 0.75, nested: { preserve: ['bytes', 'json', 7] } })}::jsonb, 3)
    `.execute(db);
  });

  const useMarker = async (name: string) => {
    await sql`INSERT INTO public.kysely_migrations (name, timestamp) VALUES (${name}, ${markerTimestamp})`.execute(db);
  };

  it('aliases a current-fork workflow marker without touching schema or rows', async () => {
    await useMarker(LEGACY_WORKFLOW_MIGRATION);
    const beforeEvidence = await getWorkflowCompatibilityEvidence(db);
    const compatibility = classifyWorkflowCompatibility(beforeEvidence);

    await db
      .transaction()
      .execute((transaction) => aliasLegacyWorkflowMigration(transaction, compatibility, reportDigest));

    const after = await getWorkflowCompatibilityEvidence(db);
    expect(after.schemaDigest).toBe(beforeEvidence.schemaDigest);
    expect(after.rowDigests).toEqual(beforeEvidence.rowDigests);
    expect(after.rowDigests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: 'public.plugin', count: 1, digest: expect.stringMatching(/^[0-9a-f]{64}$/) }),
        expect.objectContaining({ table: 'public.workflow_step', count: 1 }),
      ]),
    );
    expect(after.ledger).toContainEqual({ name: OFFICIAL_WORKFLOW_MIGRATION, timestamp: markerTimestamp });
    expect(after.ledger).not.toContainEqual(expect.objectContaining({ name: LEGACY_WORKFLOW_MIGRATION }));
    const audit = await sql<{ details: Record<string, unknown> }>`
      SELECT details FROM immich_fork.migration_audit
      WHERE name = ${LEGACY_WORKFLOW_MIGRATION} AND phase = 'workflow-alias'
    `.execute(db);
    expect(audit.rows[0]?.details).toMatchObject({
      legacyName: LEGACY_WORKFLOW_MIGRATION,
      officialName: OFFICIAL_WORKFLOW_MIGRATION,
      originalTimestamp: markerTimestamp,
      reportDigest,
      rowDigests: beforeEvidence.rowDigests,
      schemaFingerprint: beforeEvidence.schemaDigest,
    });
  });

  it('leaves an original-Immich workflow ledger and rows byte-equivalent', async () => {
    await useMarker(OFFICIAL_WORKFLOW_MIGRATION);
    const before = await getWorkflowCompatibilityEvidence(db);
    const compatibility = classifyWorkflowCompatibility(before);

    await db
      .transaction()
      .execute((transaction) => aliasLegacyWorkflowMigration(transaction, compatibility, reportDigest));

    expect(await getWorkflowCompatibilityEvidence(db)).toEqual(before);
  });

  it.each([
    ['legacy alias', LEGACY_WORKFLOW_MIGRATION, OFFICIAL_WORKFLOW_MIGRATION],
    ['original official', OFFICIAL_WORKFLOW_MIGRATION, OFFICIAL_WORKFLOW_MIGRATION],
  ])(
    'preserves the workflow catalog, rows, and trigger state through the full cutover for %s',
    async (_, marker, finalMarker) => {
      await useMarker(marker);
      const repository = new DatabaseRepository(db, LoggingRepository.create(), new ConfigRepository());
      const before = await getWorkflowCompatibilityEvidence(db);
      const triggerBefore = await sql<{ enabled: string }>`
      SELECT tgenabled::text AS enabled
      FROM pg_catalog.pg_trigger
      WHERE tgrelid = 'public.workflow'::regclass AND tgname = 'workflow_updatedAt'
      `.execute(db);

      await sql`UPDATE immich_fork.state SET active = false, phase = 'ready' WHERE id = 1`.execute(db);

      await repository.commitForkSchemaCutover(reportDigest, async () => {});

      const after = await getWorkflowCompatibilityEvidence(db);
      const triggerAfter = await sql<{ enabled: string }>`
      SELECT tgenabled::text AS enabled
      FROM pg_catalog.pg_trigger
      WHERE tgrelid = 'public.workflow'::regclass AND tgname = 'workflow_updatedAt'
    `.execute(db);
      expect(after.schemaDigest).toBe(before.schemaDigest);
      expect(after.rowDigests).toEqual(before.rowDigests);
      expect(after.ledger).toContainEqual({ name: finalMarker, timestamp: markerTimestamp });
      expect(triggerAfter.rows).toEqual(triggerBefore.rows);
    },
  );

  it('rolls ledger, audit, schema, and seeded rows back after an alias transaction failure', async () => {
    await useMarker(LEGACY_WORKFLOW_MIGRATION);
    const before = await getWorkflowCompatibilityEvidence(db);
    const compatibility = classifyWorkflowCompatibility(before);

    await expect(
      db.transaction().execute(async (transaction) => {
        await aliasLegacyWorkflowMigration(transaction, compatibility, reportDigest);
        throw new Error('synthetic failure after legacy marker deletion');
      }),
    ).rejects.toThrow('synthetic failure after legacy marker deletion');

    expect(await getWorkflowCompatibilityEvidence(db)).toEqual(before);
    const audit = await sql`SELECT * FROM immich_fork.migration_audit WHERE phase = 'workflow-alias'`.execute(db);
    expect(audit.rows).toHaveLength(0);
  });
});
