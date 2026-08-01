import { CurrentPlugin } from '@extism/extism';
import { WorkflowChanges, WorkflowEventData, WorkflowEventPayload, WorkflowResponse } from '@immich/plugin-sdk';
import { HttpException, UnauthorizedException } from '@nestjs/common';
import _ from 'lodash';
import { join } from 'node:path';
import { OnEvent, OnJob } from 'src/decorators';
import { AlbumsAddAssetsDto, CreateAlbumDto, GetAlbumsDto } from 'src/dtos/album.dto';
import { BulkIdsDto } from 'src/dtos/asset-ids.response.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { PluginManifestDto } from 'src/dtos/plugin-manifest.dto';
import {
  BootstrapEventPriority,
  DatabaseLock,
  ImmichWorker,
  JobName,
  JobStatus,
  QueueName,
  WorkflowTrigger,
  WorkflowType,
} from 'src/enum';
import { ArgOf } from 'src/repositories/event.repository';
import { AlbumService } from 'src/services/album.service';
import { BaseService } from 'src/services/base.service';
import { JobOf } from 'src/types';

const dummy = () => {
  throw new Error(
    `Calling host functions is not allowed without setting methods[].hostFunctions=true in the plugin manifest`,
  );
};

type ExecuteOptions<T extends WorkflowType> = {
  read: (type: T) => Promise<{ authUserId: string; data: WorkflowEventData<T> }>;
  write: (changes: WorkflowChanges<T>) => Promise<void>;
};

type HostContext = {
  allowedHosts: string[];
};

export class WorkflowExecutionService extends BaseService {
  private jwtSecret!: string;

  @OnEvent({ name: 'AppBootstrap', priority: BootstrapEventPriority.PluginSync, workers: [ImmichWorker.Microservices] })
  async onPluginSync() {
    await this.databaseRepository.withLock(DatabaseLock.PluginImport, async () => {
      // TODO avoid importing plugins in each worker
      // Can this use system metadata similar to geocoding?

      const { resourcePaths, plugins } = this.configRepository.getEnv();
      await this.importFolder(resourcePaths.corePlugin, { force: true });

      if (plugins.external.allow && plugins.external.installFolder) {
        await this.importFolders(plugins.external.installFolder);
      }
    });
  }

  @OnEvent({ name: 'AppBootstrap', priority: BootstrapEventPriority.PluginLoad, workers: [ImmichWorker.Microservices] })
  async onPluginLoad() {
    this.jwtSecret = this.cryptoRepository.randomBytesAsText(32);

    const albumService = BaseService.create(AlbumService, this);

    const searchAlbums = this.wrap<[dto: GetAlbumsDto]>((authDto, _context, args) =>
      albumService.getAll(authDto, ...args),
    );
    const createAlbum = this.wrap<[dto: CreateAlbumDto]>((authDto, _context, args) =>
      albumService.create(authDto, ...args),
    );
    const addAssetsToAlbum = this.wrap<[id: string, dto: BulkIdsDto]>((authDto, _context, args) =>
      albumService.addAssets(authDto, ...args),
    );
    // ponytail: legacy host-function name — the packages/plugin-core wasm still imports
    // albumAddAssets, and wasm instantiation fails (hanging plugin load) if any import is
    // missing. Drop when plugin-core/plugin-sdk are ported to the upstream host API.
    const albumAddAssets = addAssetsToAlbum;
    const addAssetsToAlbums = this.wrap<[dto: AlbumsAddAssetsDto]>((authDto, _context, args) =>
      albumService.addAssetsToAlbums(authDto, ...args),
    );
    const httpRequest = this.wrap<
      [
        url: string,
        options?: {
          method?: string;
          headers?: Record<string, string>;
          body?: string;
        },
      ]
    >(async (_authDto, context, args) => {
      const hostname = new URL(args[0]).hostname;

      for (const pattern of context.allowedHosts) {
        const regex = new RegExp(pattern.replaceAll('.', String.raw`\.`).replaceAll('*', '.*'));
        if (regex.test(hostname)) {
          const res = await fetch(...args);

          return {
            ok: res.ok,
            status: res.status,
            body: await res.text(),
          };
        }
      }

      throw new Error('Hostname did not match any listed in methods[].allowedHosts in the plugin manifest');
    });

    const functions = {
      searchAlbums,
      createAlbum,
      addAssetsToAlbum,
      albumAddAssets,
      addAssetsToAlbums,
      httpRequest,
    };

    const stubs: typeof functions = {
      searchAlbums: dummy,
      createAlbum: dummy,
      addAssetsToAlbum: dummy,
      albumAddAssets: dummy,
      addAssetsToAlbums: dummy,
      httpRequest: dummy,
    };

    const plugins = await this.pluginRepository.getForLoad();
    for (const { id, name, version, wasmBytes, methods } of plugins) {
      const method = methods.some(({ hostFunctions }) => !hostFunctions);
      if (method) {
        const label = `${name}@${version}`;
        const key = this.getPluginKey({ id, hostFunctions: false });
        try {
          await this.pluginRepository.load({ key, label, wasmBytes }, { runInWorker: false, functions: stubs });
          this.logger.log(`Loaded plugin: ${label}`);
        } catch (error) {
          this.logger.error(`Unable to load plugin ${label} (${id})`, error);
        }
      }

      const methodWithFunction = methods.some(({ hostFunctions }) => hostFunctions);
      if (methodWithFunction) {
        const label = `${name}@${version}/worker`;
        const key = this.getPluginKey({ id, hostFunctions: true });
        try {
          await this.pluginRepository.load({ key, label, wasmBytes }, { runInWorker: true, functions });
          this.logger.log(`Loaded plugin with host functions: ${label}`);
        } catch (error) {
          this.logger.error(`Unable to load plugin with host functions ${label} (${id})`, error);
        }
      }
    }
  }

  private getPluginKey({ id, hostFunctions }: { id: string; hostFunctions: boolean }) {
    return id + (hostFunctions ? '/worker' : '');
  }

  private wrap<T>(fn: (authDto: AuthDto, context: HostContext, args: T) => Promise<unknown>) {
    return async (plugin: CurrentPlugin, offset: bigint) => {
      try {
        const handle = plugin.read(offset);
        if (!handle) {
          return plugin.store(
            JSON.stringify({ success: false, status: 400, message: 'Called host function without input' }),
          );
        }

        const { authToken, args } = handle.json() as { authToken: string; args: T };
        if (!authToken) {
          throw new Error('authToken is required');
        }

        const context = plugin.hostContext<HostContext>();
        const authDto = this.validate(authToken);
        const response = await fn(authDto, context, args);

        return plugin.store(JSON.stringify({ success: true, response }));
      } catch (error: any) {
        if (error instanceof HttpException) {
          this.logger.error(`Plugin host exception: ${error}`);
          return plugin.store(
            JSON.stringify({ success: false, status: error.getStatus(), message: error.getResponse() }),
          );
        }

        this.logger.error(`Plugin host exception: ${error}`, error?.stack);

        return plugin.store(
          JSON.stringify({
            success: false,
            status: 500,
            message: `Internal server error: ${error}`,
          }),
        );
      }
    };
  }

  private async importFolders(installFolder: string): Promise<void> {
    try {
      const entries = await this.storageRepository.readdirWithTypes(installFolder);
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        await this.importFolder(join(installFolder, entry.name));
      }
    } catch (error) {
      this.logger.error(`Failed to import plugins folder ${installFolder}:`, error);
    }
  }

  private async importFolder(folder: string, options?: { force?: boolean }) {
    try {
      const manifestPath = join(folder, 'manifest.json');
      const dto = await this.storageRepository.readJsonFile(manifestPath);
      const result = PluginManifestDto.schema.safeParse(dto);
      if (!result.success) {
        const issues = result.error.issues.map((issue) => `  - [${issue.path.join('.')}] ${issue.message}`).join('\n');
        this.logger.warn(`Invalid plugin manifest at ${manifestPath}:\n${issues}`);
        return;
      }
      const manifest = result.data;

      const existing = await this.pluginRepository.getByName(manifest.name);
      if (existing && existing.version === manifest.version && options?.force !== true) {
        return;
      }

      const wasmPath = `${folder}/${manifest.wasmPath}`;
      const wasmBytes = await this.storageRepository.readFile(wasmPath);

      const plugin = await this.pluginRepository.upsert(
        {
          enabled: true,
          name: manifest.name,
          title: manifest.title,
          description: manifest.description,
          author: manifest.author,
          version: manifest.version,
          wasmBytes,
        },
        manifest.methods,
      );

      if (existing) {
        this.logger.log(
          `Upgraded plugin ${manifest.name} (${plugin.methods.length} methods) from ${existing.version} to ${manifest.version} `,
        );
      } else {
        this.logger.log(
          `Imported plugin ${manifest.name}@${manifest.version} (${plugin.methods.length} methods) from ${folder}`,
        );
      }

      return manifest;
    } catch {
      this.logger.warn(`Failed to import plugin from ${folder}:`);
    }
  }

  private validate(authToken: string): AuthDto {
    try {
      const jwt = this.cryptoRepository.verifyJwt<{ userId: string }>(authToken, this.jwtSecret);
      if (!jwt.userId) {
        throw new UnauthorizedException('Invalid token: missing userId');
      }

      // Synthesized plugin auth always denies access to suppressed content.
      // Without this, host functions like albumAddAssets would let a plugin
      // move an owner's NSFW/hidden asset into a shared album, bypassing the
      // per-job workflow eligibility gate.
      return {
        user: {
          id: jwt.userId,
        },
        hideNsfwAssets: true,
      } as AuthDto;
    } catch (error) {
      this.logger.error('Token validation failed:', error);
      throw new UnauthorizedException('Invalid token');
    }
  }

  private sign(userId: string) {
    return this.cryptoRepository.signJwt({ userId }, this.jwtSecret);
  }

  /**
   * Workflows trigger off `AssetMetadataExtracted` rather than `AssetCreate`.
   * `AssetCreate` fires before metadata extraction and (when NSFW detection is
   * configured) before classification. Triggering at extraction time avoids a
   * fail-open window where a freshly-uploaded NSFW asset could reach plugins
   * before its `asset_metadata.MlEnrichment` row exists.
   */
  @OnEvent({ name: 'AssetMetadataExtracted' })
  async onAssetMetadataExtracted({ assetId, userId }: ArgOf<'AssetMetadataExtracted'>) {
    const dto = { ownerId: userId, trigger: WorkflowTrigger.AssetCreate };
    const items = await this.workflowRepository.search(dto);
    if (items.length === 0) {
      return;
    }

    // Compute eligibility once per asset rather than once per (workflow × asset).
    const { machineLearning } = await this.getConfig({ withCache: true });
    // Either NSFW detection OR image-description can flag an asset as NSFW
    // (description.safety.is_nsfw_likely flows through nsfwAssetIdExists). If
    // EITHER is enabled, require the asset to be enriched so the workflow gate
    // never fires before the NSFW signal lands.
    const requireEnrichment = machineLearning.nsfwDetection.enabled || machineLearning.imageDescription.enabled;
    if (!(await this.workflowRepository.isWorkflowEligible(assetId, { requireEnrichment }))) {
      return;
    }

    await this.jobRepository.queueAll(
      items.map((workflow) => ({
        name: JobName.WorkflowAssetCreate,
        data: { workflowId: workflow.id, assetId },
      })),
    );
  }

  @OnJob({ name: JobName.WorkflowAssetCreate, queue: QueueName.Workflow })
  async handleAssetCreate({ workflowId, assetId }: JobOf<JobName.WorkflowAssetCreate>) {
    return this.execute(workflowId, [assetId], (type) => {
      switch (type) {
        case WorkflowType.AssetV1: {
          return {
            read: async () => {
              const asset = await this.workflowRepository.getForAssetV1(assetId);
              // Kysely returns timestamp columns from `jsonObjectFrom` as ISO strings,
              // but the SDK declares them as Date. The runtime contract is fine for
              // plugin authors (Date constructors accept ISO strings); this cast just
              // bridges the type mismatch in upstream's `AssetV1` declaration.
              return {
                data: { asset } as WorkflowEventData<typeof type>,
                authUserId: asset.ownerId,
              };
            },
            write: async (changes) => {
              if (!changes.asset) {
                return;
              }
              // Explicit allow-list of writable fields. Adding a new key here is
              // a deliberate decision — never spread `changes.asset` directly.
              // `visibility` is writable so upstream's core plugin
              // archive/unarchive/lock methods continue to work; un-hiding
              // Hidden/Locked assets is prevented by the read-side eligibility
              // gate (`isWorkflowEligible`), which never lets a plugin observe
              // such an asset in the first place. `status` and `deletedAt`
              // MUST stay out — those would let a plugin resurrect a trashed
              // asset.
              const update = _.omitBy(
                {
                  isFavorite: changes.asset.isFavorite,
                  visibility: changes.asset.visibility,
                },
                _.isUndefined,
              );
              if (_.isEmpty(update)) {
                return;
              }
              await this.assetRepository.update({ id: assetId, ...update });
            },
          } satisfies ExecuteOptions<typeof type>;
        }
      }
    });
  }

  /**
   * Central choke point for every workflow trigger handler. Any new
   * `WorkflowTrigger` value with an `@OnJob` handler MUST route through here,
   * passing the set of asset ids whose data will be exposed to the plugin.
   * The privacy gate (`isWorkflowEligible`) runs once per asset before any
   * read/write callback is invoked, so individual handlers can't forget it.
   */
  private async execute<T extends WorkflowType>(
    workflowId: string,
    assetIds: string[],
    getHandler: (type: T) => ExecuteOptions<T> | undefined,
  ): Promise<JobStatus | undefined> {
    const workflow = await this.workflowRepository.getForWorkflowRun(workflowId);
    if (!workflow) {
      return;
    }

    const { machineLearning } = await this.getConfig({ withCache: true });
    // Match `onAssetMetadataExtracted` — either NSFW OR description can flag NSFW.
    const requireEnrichment = machineLearning.nsfwDetection.enabled || machineLearning.imageDescription.enabled;
    for (const assetId of assetIds) {
      if (!(await this.workflowRepository.isWorkflowEligible(assetId, { requireEnrichment }))) {
        return JobStatus.Skipped;
      }
    }

    // TODO infer from steps
    const type = 'AssetV1' as T;
    const handler = getHandler(type);
    if (!handler) {
      this.logger.error(`Misconfigured workflow ${workflowId}: no handler for type ${type}`);
      return;
    }

    try {
      const { read, write } = handler;
      const readResult = await read(type);
      let data = readResult.data;
      for (const step of workflow.steps) {
        const payload: WorkflowEventPayload = {
          trigger: workflow.trigger,
          type,
          config: step.config ?? {},
          workflow: {
            id: workflowId,
            authToken: this.sign(readResult.authUserId),
            stepId: step.id,
          },
          data,
        };
        const context: HostContext = {
          allowedHosts: step.allowedHosts,
        };

        if (step.methodName.startsWith('noop')) {
          continue;
        }

        const result = await this.pluginRepository.callMethod<WorkflowResponse<T>>(
          {
            pluginKey: this.getPluginKey({ id: step.pluginId, hostFunctions: step.hostFunctions }),
            methodName: step.methodName,
          },
          payload,
          context,
        );
        if (result?.changes) {
          await write(result.changes);
          ({ data } = await read(type));
        }

        const shouldContinue = result?.workflow?.continue ?? true;
        if (!shouldContinue) {
          break;
        }
      }

      this.logger.debug(`Workflow ${workflowId} executed successfully`);
    } catch (error) {
      this.logger.error(`Error executing workflow ${workflowId}:`, error);
      return JobStatus.Failed;
    }
  }
}
