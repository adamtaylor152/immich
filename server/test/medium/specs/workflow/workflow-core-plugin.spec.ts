import { WorkflowStepConfig } from '@immich/plugin-sdk';
import { Kysely } from 'kysely';
import { existsSync, readFileSync } from 'node:fs';
import { PluginManifestDto } from 'src/dtos/plugin-manifest.dto';
import { AssetMetadataKey, AssetVisibility, JobStatus, LogLevel, WorkflowTrigger } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AlbumRepository } from 'src/repositories/album.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { CryptoRepository } from 'src/repositories/crypto.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PluginRepository } from 'src/repositories/plugin.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { WorkflowRepository } from 'src/repositories/workflow.repository';
import { DB } from 'src/schema';
import { WorkflowExecutionService } from 'src/services/workflow-execution.service';
import { resolveMethod } from 'src/utils/workflow';
import { MediumTestContext } from 'test/medium.factory';
import { mockEnvData } from 'test/repositories/config.repository.mock';
import { getKyselyDB } from 'test/utils';

let initialized = false;

class WorkflowTestContext extends MediumTestContext<WorkflowExecutionService> {
  constructor(database: Kysely<DB>) {
    super(WorkflowExecutionService, {
      database,
      real: [
        AccessRepository,
        AlbumRepository,
        AssetRepository,
        CryptoRepository,
        DatabaseRepository,
        LoggingRepository,
        StorageRepository,
        PluginRepository,
        WorkflowRepository,
      ],
      mock: [ConfigRepository, SystemMetadataRepository],
    });
  }

  async init() {
    if (initialized) {
      return;
    }

    const mockData = mockEnvData({});
    mockData.resourcePaths.corePlugin = '../packages/plugin-core';
    mockData.plugins.external.allow = false;
    this.getMock(ConfigRepository).getEnv.mockReturnValue(mockData);
    // `BaseService.getConfig` calls `SystemMetadataRepository.get(SystemConfig)`
    // and merges over defaults. Returning null makes the merge a no-op so the
    // workflow handler sees the default machineLearning config.
    this.getMock(SystemMetadataRepository).get.mockResolvedValue(null);
    this.get(LoggingRepository).setLogLevel(LogLevel.Verbose);

    await this.sut.onPluginSync();
    await this.sut.onPluginLoad();

    initialized = true;
  }
}

type WorkflowTemplate = {
  ownerId: string;
  trigger: WorkflowTrigger;
  steps: WorkflowTemplateStep[];
};

type WorkflowTemplateStep = {
  method: string;
  config?: WorkflowStepConfig;
};

const createWorkflow = async (template: WorkflowTemplate) => {
  const workflowRepo = ctx.get(WorkflowRepository);
  const pluginRepo = ctx.get(PluginRepository);

  const methods = await pluginRepo.getForValidation();
  const steps = template.steps.map((step) => {
    const pluginMethod = resolveMethod(methods, step.method);
    if (!pluginMethod) {
      throw new Error(`Plugin method not found: ${step.method}`);
    }

    return { ...step, pluginMethod };
  });

  return workflowRepo.create(
    {
      enabled: true,
      name: 'Test workflow',
      description: 'A workflow to test the core plugin',
      ownerId: template.ownerId,
      trigger: template.trigger,
    },
    steps.map((step) => ({
      enabled: true,
      pluginMethodId: step.pluginMethod.id,
      config: step.config,
    })),
  );
};

let ctx: WorkflowTestContext;

// The fork's workflow eligibility gate (`isWorkflowEligible`) requires an asset
// to be enrichment-complete before plugins may observe it whenever NSFW
// detection OR image description is enabled — and `imageDescription.enabled`
// defaults to true (see `defaults` in src/config.ts), so the gate is active
// under the medium context's default ML config. In production this is never a
// problem because workflows trigger on `AssetMetadataExtracted`, which only
// fires after enrichment lands. These execution tests call `handleAssetCreate`
// directly, so they must reproduce that realistic post-extraction state by
// attaching a (non-NSFW) ml-enrichment metadata row. `newMetadata` also keeps
// `asset.is_nsfw` in sync via `syncIsNsfwForItems`, so a `result.isNsfw=false`
// row leaves the asset both enriched and not-NSFW → eligible.
const newEligibleAsset = async (dto: Parameters<WorkflowTestContext['newAsset']>[0] = {}) => {
  const { asset } = await ctx.newAsset(dto);
  await ctx.newMetadata({
    assetId: asset.id,
    key: AssetMetadataKey.MlEnrichment,
    value: { nsfwDetection: { status: 'success', result: { isNsfw: false } } },
  });
  return { asset };
};

// `dist/plugin.wasm` is produced by `pnpm --filter @immich/plugin-core build:wasm`,
// which shells out to the `extism-js` Rust CLI. The binary is not part of any
// npm install; environments without it (CI without the install step, local
// machines without an extism-js install) cannot load the core plugin. Skip
// the suite cleanly so the failure is informative rather than a long
// "Plugin method not found" cascade for every step type.
const corePluginWasmPath = '../packages/plugin-core/dist/plugin.wasm';
const corePluginAvailable = existsSync(corePluginWasmPath);

beforeAll(async () => {
  if (!corePluginAvailable) {
    return;
  }
  const db = await getKyselyDB();
  ctx = new WorkflowTestContext(db);
  await ctx.init();
}, 30_000);

const describeIfPluginBuilt = corePluginAvailable ? describe : describe.skip;

describe('core plugin', () => {
  describe('validation', () => {
    it('should have a valid manifest.json', () => {
      const buffer = readFileSync('../packages/plugin-core/manifest.json');
      const result = PluginManifestDto.schema.safeParse(JSON.parse(buffer.toString()));
      if (!result.success) {
        const issues =
          'error' in result
            ? result.error.issues.map((issue) => `  - [${issue.path.join('.')}] ${issue.message}`).join('\n')
            : '';
        const message = `Invalid packages/plugin-core/manifest.json:\n${issues}`;
        expect(result.success, message).toBe(true);
      }

      expect(result.success).toBe(true);
    });
  });

  describeIfPluginBuilt('assetArchive', () => {
    it('should archive an asset', async () => {
      const { user } = await ctx.newUser();
      const { asset } = await newEligibleAsset({ ownerId: user.id });

      const workflow = await createWorkflow({
        ownerId: user.id,
        trigger: WorkflowTrigger.AssetCreate,
        steps: [{ method: 'immich-plugin-core#assetArchive' }],
      });

      await expect(ctx.sut.handleAssetCreate({ workflowId: workflow.id, assetId: asset.id })).resolves.toBeUndefined();

      await expect(ctx.get(AssetRepository).getById(asset.id)).resolves.toMatchObject({
        visibility: AssetVisibility.Archive,
      });
    });

    it('should unarchive an asset', async () => {
      const { user } = await ctx.newUser();
      const { asset } = await newEligibleAsset({ ownerId: user.id, visibility: AssetVisibility.Archive });

      const workflow = await createWorkflow({
        ownerId: user.id,
        trigger: WorkflowTrigger.AssetCreate,
        steps: [{ method: 'immich-plugin-core#assetArchive', config: { inverse: true } }],
      });

      await expect(ctx.sut.handleAssetCreate({ workflowId: workflow.id, assetId: asset.id })).resolves.toBeUndefined();

      await expect(ctx.get(AssetRepository).getById(asset.id)).resolves.toMatchObject({
        visibility: AssetVisibility.Timeline,
      });
    });
  });

  describeIfPluginBuilt('assetLock', () => {
    it('should lock an asset', async () => {
      const { user } = await ctx.newUser();
      const { asset } = await newEligibleAsset({ ownerId: user.id });

      const workflow = await createWorkflow({
        ownerId: user.id,
        trigger: WorkflowTrigger.AssetCreate,
        steps: [{ method: 'immich-plugin-core#assetLock' }],
      });

      await expect(ctx.sut.handleAssetCreate({ workflowId: workflow.id, assetId: asset.id })).resolves.toBeUndefined();

      await expect(ctx.get(AssetRepository).getById(asset.id)).resolves.toMatchObject({
        visibility: AssetVisibility.Locked,
      });
    });

    it('should refuse to unlock a Locked asset (fork privacy gate)', async () => {
      // Fork policy: the workflow eligibility gate (isWorkflowEligible) filters
      // out Locked assets so plugins can never observe them. Upstream's
      // assetLock(inverse: true) method therefore has no asset to transition
      // and the job exits as Skipped without modifying the row. This is a
      // deliberate divergence from upstream's behavior — see FORK_FOLLOWUPS.md.
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });

      const workflow = await createWorkflow({
        ownerId: user.id,
        trigger: WorkflowTrigger.AssetCreate,
        steps: [{ method: 'immich-plugin-core#assetLock', config: { inverse: true } }],
      });

      await expect(ctx.sut.handleAssetCreate({ workflowId: workflow.id, assetId: asset.id })).resolves.toBe(
        JobStatus.Skipped,
      );

      await expect(ctx.get(AssetRepository).getById(asset.id)).resolves.toMatchObject({
        visibility: AssetVisibility.Locked,
      });
    });
  });

  describeIfPluginBuilt('assetFavorite', () => {
    it('should favorite an asset', async () => {
      const { user } = await ctx.newUser();
      const { asset } = await newEligibleAsset({ ownerId: user.id });

      const workflow = await createWorkflow({
        ownerId: user.id,
        trigger: WorkflowTrigger.AssetCreate,
        steps: [{ method: 'immich-plugin-core#assetFavorite' }],
      });

      await expect(ctx.sut.handleAssetCreate({ workflowId: workflow.id, assetId: asset.id })).resolves.toBeUndefined();

      await expect(ctx.get(AssetRepository).getById(asset.id)).resolves.toMatchObject({ isFavorite: true });
    });

    it('should unfavorite an asset', async () => {
      const { user } = await ctx.newUser();
      const { asset } = await newEligibleAsset({ ownerId: user.id, isFavorite: true });

      const workflow = await createWorkflow({
        ownerId: user.id,
        trigger: WorkflowTrigger.AssetCreate,
        steps: [{ method: 'immich-plugin-core#assetFavorite', config: { inverse: true } }],
      });

      await expect(ctx.sut.handleAssetCreate({ workflowId: workflow.id, assetId: asset.id })).resolves.toBeUndefined();

      await expect(ctx.get(AssetRepository).getById(asset.id)).resolves.toMatchObject({ isFavorite: false });
    });
  });

  describeIfPluginBuilt('assetAddToAlbums', () => {
    it('should add an asset to an album', async () => {
      const { user } = await ctx.newUser();
      const { asset } = await newEligibleAsset({ ownerId: user.id, isFavorite: true });
      const { album } = await ctx.newAlbum({ ownerId: user.id });

      const workflow = await createWorkflow({
        ownerId: user.id,
        trigger: WorkflowTrigger.AssetCreate,
        steps: [{ method: 'immich-plugin-core#assetAddToAlbums', config: { albumIds: [album.id] } }],
      });

      await expect(ctx.sut.handleAssetCreate({ workflowId: workflow.id, assetId: asset.id })).resolves.toBeUndefined();

      await expect(ctx.get(AlbumRepository).getAssetIds(album.id, [asset.id])).resolves.toContain(asset.id);
    });

    it('should add an asset to multiple albums', async () => {
      const { user } = await ctx.newUser();
      const [{ asset }, { album: album1 }, { album: album2 }] = await Promise.all([
        newEligibleAsset({ ownerId: user.id, isFavorite: true }),
        ctx.newAlbum({ ownerId: user.id }),
        ctx.newAlbum({ ownerId: user.id }),
      ]);

      const workflow = await createWorkflow({
        ownerId: user.id,
        trigger: WorkflowTrigger.AssetCreate,
        steps: [{ method: 'immich-plugin-core#assetAddToAlbums', config: { albumIds: [album1.id, album2.id] } }],
      });

      await expect(ctx.sut.handleAssetCreate({ workflowId: workflow.id, assetId: asset.id })).resolves.toBeUndefined();

      await expect(ctx.get(AlbumRepository).getAssetIds(album1.id, [asset.id])).resolves.toContain(asset.id);
      await expect(ctx.get(AlbumRepository).getAssetIds(album2.id, [asset.id])).resolves.toContain(asset.id);
    });

    it('should require album access', async () => {
      const { user: user1 } = await ctx.newUser();
      const { user: user2 } = await ctx.newUser();
      const { asset } = await newEligibleAsset({ ownerId: user1.id, isFavorite: true });
      const { album } = await ctx.newAlbum({ ownerId: user2.id });

      const workflow = await createWorkflow({
        ownerId: user1.id,
        trigger: WorkflowTrigger.AssetCreate,
        steps: [{ method: 'immich-plugin-core#assetAddToAlbums', config: { albumIds: [album.id] } }],
      });

      await expect(ctx.sut.handleAssetCreate({ workflowId: workflow.id, assetId: asset.id })).resolves.toBeTruthy();

      await expect(ctx.get(AlbumRepository).getAssetIds(album.id, [asset.id])).resolves.not.toContain(asset.id);
    });
  });
});
