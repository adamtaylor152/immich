import { Kysely, sql } from 'kysely';
import { createHash, randomUUID } from 'node:crypto';
import { AssetMetadataKey, AssetVisibility, WorkflowType } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PluginRepository } from 'src/repositories/plugin.repository';
import { WorkflowRepository } from 'src/repositories/workflow.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getActiveForkKyselyDB as getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(WorkflowRepository) };
};

const pluginDto = (id: string) => ({
  enabled: true,
  name: `schema-stage-${id}`,
  title: 'Schema stage plugin',
  description: 'Schema stage fixture',
  author: 'Immich',
  version: '1.0.0',
  wasmBytes: Buffer.from('fixture'),
  sha256hash: createHash('sha256').update('fixture').digest(),
  templates: [],
});
const methodDto = (allowedHosts: string[]) => ({
  name: 'webhook',
  title: 'Webhook',
  description: 'Webhook fixture',
  types: [WorkflowType.AssetV1],
  allowedHosts,
});

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(WorkflowRepository.name, () => {
  it('upserts plugin methods on the legacy no-column schema before handoff', async () => {
    const database = await getKyselyDB();
    // The migrated template already owns the column; recreate the legacy shape.
    await sql`ALTER TABLE public.plugin_method DROP COLUMN "allowedHosts"`.execute(database);
    const sut = new PluginRepository(database, { setContext: vi.fn() } as never);

    await expect(sut.upsert(pluginDto(randomUUID()), [methodDto(['hooks.example.test'])])).resolves.toEqual(
      expect.objectContaining({ methods: [expect.objectContaining({ name: 'webhook' })] }),
    );
  });

  it('updates allowedHosts after the official upstream migration owns the column', async () => {
    // The migrated template already reflects the upstream migration.
    const database = await getKyselyDB();
    const sut = new PluginRepository(database, { setContext: vi.fn() } as never);
    const dto = pluginDto(randomUUID());
    await sut.upsert(dto, [methodDto(['first.example.test'])]);

    await sut.upsert(dto, [methodDto(['second.example.test'])]);

    const method = await database.selectFrom('plugin_method').select('allowedHosts').executeTakeFirstOrThrow();
    expect(method.allowedHosts).toEqual(['second.example.test']);
  });

  it('returns legacy defaults before handoff and official allowedHosts after the upstream migration', async () => {
    const database = await getKyselyDB();
    // The migrated template already owns the column; recreate the legacy shape
    // so the test can walk through the upstream migration itself.
    await sql`ALTER TABLE public.plugin_method DROP COLUMN "allowedHosts"`.execute(database);
    const { ctx, sut } = setup(database);
    const { user } = await ctx.newUser();
    const pluginId = randomUUID();
    const methodId = randomUUID();
    const workflowId = randomUUID();
    await sql`
      INSERT INTO public.plugin
        (id, enabled, name, version, title, description, author, "wasmBytes", templates, "sha256hash")
      VALUES (${pluginId}::uuid, true, ${`allowed-hosts-${pluginId}`}, '1.0.0', 'Allowed hosts',
        'Allowed hosts fixture', 'Immich', decode('00', 'hex'), '[]'::jsonb, sha256(decode('00', 'hex')))
    `.execute(database);
    await sql`
      INSERT INTO public.plugin_method
        (id, "pluginId", name, title, description, types, "hostFunctions", "uiHints", schema)
      VALUES (${methodId}::uuid, ${pluginId}::uuid, 'webhook', 'Webhook', 'Webhook fixture',
        ARRAY['asset']::varchar[], true, ARRAY[]::varchar[], NULL)
    `.execute(database);
    await sql`
      INSERT INTO public.workflow (id, "ownerId", trigger, name, description, "updateId", enabled)
      VALUES (${workflowId}::uuid, ${user.id}::uuid, 'asset.uploaded', 'Allowed hosts workflow', NULL,
        ${randomUUID()}::uuid, true)
    `.execute(database);
    await sql`
      INSERT INTO public.workflow_step (id, enabled, "workflowId", "pluginMethodId", config, "order")
      VALUES (${randomUUID()}::uuid, true, ${workflowId}::uuid, ${methodId}::uuid, '{}'::jsonb, 0)
    `.execute(database);

    const legacyWorkflow = await sut.getForWorkflowRun(workflowId);
    expect(legacyWorkflow?.steps[0]).toEqual(expect.objectContaining({ allowedHosts: [] }));

    await sql`
      ALTER TABLE public.plugin_method
      ADD COLUMN "allowedHosts" varchar[] NOT NULL DEFAULT '{}'
    `.execute(database);
    await sql`
      UPDATE public.plugin_method
      SET "allowedHosts" = ARRAY['hooks.example.test', '*.trusted.example']::varchar[]
      WHERE id = ${methodId}::uuid
    `.execute(database);
    const officialWorkflow = await setup(database).sut.getForWorkflowRun(workflowId);

    expect(officialWorkflow?.steps[0]).toEqual(
      expect.objectContaining({ allowedHosts: ['hooks.example.test', '*.trusted.example'] }),
    );
  });

  describe('isWorkflowEligible', () => {
    /**
     * Regression test for R1: the NSFW EXISTS subquery in `utils/database.ts`
     * was self-shadowed because the inner `FROM asset` reused the outer alias.
     * Both `asset.id` references resolved to the inner table → the EXISTS
     * effectively asked "is ANY asset NSFW in the DB" instead of "is THIS
     * asset NSFW." Effect: any deployment with ≥1 NSFW asset reported
     * isNsfw=true for every isWorkflowEligible call and ALL workflows were
     * blocked for ALL assets.
     *
     * This test creates two assets, marks one NSFW, and asserts that the
     * other one is still reported as eligible. Without the alias fix, the
     * second assertion would (incorrectly) return false.
     */
    it('reports only the NSFW asset as ineligible when the DB contains a mix', async () => {
      const { ctx, sut } = setup(await getKyselyDB());
      const { user } = await ctx.newUser();

      const { asset: nsfwAsset } = await ctx.newAsset({ ownerId: user.id });
      const { asset: safeAsset } = await ctx.newAsset({ ownerId: user.id });

      // Mark only nsfwAsset as NSFW. This row triggers the inner-table
      // shadowing bug because the broken EXISTS would match for ANY asset
      // having is_nsfw=true.
      await defaultDatabase.updateTable('asset').set({ is_nsfw: true }).where('id', '=', nsfwAsset.id).execute();

      await ctx.newMetadata({
        assetId: nsfwAsset.id,
        key: AssetMetadataKey.MlEnrichment,
        value: { nsfwDetection: { status: 'success', result: { isNsfw: true } } },
      });
      await ctx.newMetadata({
        assetId: safeAsset.id,
        key: AssetMetadataKey.MlEnrichment,
        value: { nsfwDetection: { status: 'success', result: { isNsfw: false } } },
      });

      await expect(sut.isWorkflowEligible(nsfwAsset.id, { requireEnrichment: false })).resolves.toBe(false);
      await expect(sut.isWorkflowEligible(safeAsset.id, { requireEnrichment: false })).resolves.toBe(true);
    });

    it('returns false when the asset does not exist', async () => {
      const { sut } = setup(await getKyselyDB());
      await expect(
        sut.isWorkflowEligible('00000000-0000-4000-a000-000000000000', { requireEnrichment: false }),
      ).resolves.toBe(false);
    });

    it('returns false for Hidden and Locked assets', async () => {
      const { ctx, sut } = setup(await getKyselyDB());
      const { user } = await ctx.newUser();
      const { asset: hidden } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Hidden });
      const { asset: locked } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });

      await expect(sut.isWorkflowEligible(hidden.id, { requireEnrichment: false })).resolves.toBe(false);
      await expect(sut.isWorkflowEligible(locked.id, { requireEnrichment: false })).resolves.toBe(false);
    });

    it('respects requireEnrichment when ml-enrichment metadata is absent', async () => {
      const { ctx, sut } = setup(await getKyselyDB());
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      await expect(sut.isWorkflowEligible(asset.id, { requireEnrichment: true })).resolves.toBe(false);
      await expect(sut.isWorkflowEligible(asset.id, { requireEnrichment: false })).resolves.toBe(true);
    });

    it('returns true when requireEnrichment is set and ml-enrichment metadata is present', async () => {
      const { ctx, sut } = setup(await getKyselyDB());
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      await ctx.newMetadata({
        assetId: asset.id,
        key: AssetMetadataKey.MlEnrichment,
        value: { nsfwDetection: { status: 'success', result: { isNsfw: false } } },
      });

      await expect(sut.isWorkflowEligible(asset.id, { requireEnrichment: true })).resolves.toBe(true);
    });
  });
});
