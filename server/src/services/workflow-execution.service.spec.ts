import { CurrentPlugin } from '@extism/extism';
import { WorkflowTrigger, WorkflowType } from 'src/enum';
import { AlbumService } from 'src/services/album.service';
import { WorkflowExecutionService } from 'src/services/workflow-execution.service';
import { newUuid } from 'test/small.factory';
import { newTestService, ServiceMocks } from 'test/utils';
import { Mocked, vitest } from 'vitest';

describe(WorkflowExecutionService.name, () => {
  let sut: WorkflowExecutionService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(WorkflowExecutionService));
  });

  afterEach(() => {
    vitest.restoreAllMocks();
  });

  it('loads preserved official v3 plugin bytes with the official host ABI in both execution modes', async () => {
    const pluginId = newUuid();
    const officialV3Wasm = Buffer.from('preserved-official-v3.0.3-wasm');
    mocks.plugin.getForLoad.mockResolvedValue([
      {
        id: pluginId,
        name: 'immich-plugin-core',
        version: '2.0.1',
        wasmBytes: officialV3Wasm,
        methods: [
          { name: 'assetFavorite', hostFunctions: false },
          { name: 'webhook', hostFunctions: true },
        ],
      },
    ]);

    await sut.onPluginLoad();

    expect(mocks.plugin.load).toHaveBeenCalledTimes(2);
    for (const [load] of mocks.plugin.load.mock.calls) {
      expect(load.wasmBytes).toBe(officialV3Wasm);
    }

    const [, inProcessOptions] = mocks.plugin.load.mock.calls[0]!;
    const [, workerOptions] = mocks.plugin.load.mock.calls[1]!;
    const officialHostAbi = ['addAssetsToAlbum', 'addAssetsToAlbums', 'createAlbum', 'httpRequest', 'searchAlbums'];
    // albumAddAssets is a fork-legacy alias the un-ported plugin-core wasm still imports.
    // Official plugins only import from the official set, so the superset preserves the ABI.
    const hostFunctions = [...officialHostAbi, 'albumAddAssets'].toSorted();

    expect(inProcessOptions.runInWorker).toBe(false);
    expect(Object.keys(inProcessOptions.functions ?? {}).toSorted()).toEqual(hostFunctions);
    expect(workerOptions.runInWorker).toBe(true);
    expect(Object.keys(workerOptions.functions ?? {}).toSorted()).toEqual(hostFunctions);
  });

  it('preserves the fork privacy auth gate for official host functions', async () => {
    const userId = newUuid();
    const albumId = newUuid();
    const assetId = newUuid();
    const addAssets = vitest.spyOn(AlbumService.prototype, 'addAssets').mockResolvedValue([]);
    mocks.crypto.verifyJwt.mockReturnValue({ userId });
    mocks.plugin.getForLoad.mockResolvedValue([
      {
        id: newUuid(),
        name: 'immich-plugin-core',
        version: '2.0.1',
        wasmBytes: Buffer.from('preserved-official-v3.0.3-wasm'),
        methods: [{ name: 'assetAddToAlbums', hostFunctions: true }],
      },
    ]);

    await sut.onPluginLoad();

    const [, workerOptions] = mocks.plugin.load.mock.calls[0]!;
    const functions = workerOptions.functions as Record<
      string,
      (plugin: CurrentPlugin, offset: bigint) => Promise<bigint>
    >;
    const plugin = {
      hostContext: vitest.fn().mockReturnValue({ allowedHosts: [] }),
      read: vitest.fn().mockReturnValue({
        json: () => ({ authToken: 'official-workflow-token', args: [albumId, { ids: [assetId] }] }),
      }),
      store: vitest.fn().mockReturnValue(1n),
    } as unknown as Mocked<CurrentPlugin>;

    await functions.addAssetsToAlbum!(plugin, 0n);

    expect(addAssets).toHaveBeenCalledWith(
      expect.objectContaining({ user: { id: userId }, hideNsfwAssets: true }),
      albumId,
      { ids: [assetId] },
    );
    expect(plugin.hostContext).toHaveBeenCalled();
  });

  it('passes each workflow method allowedHosts through the Extism call context', async () => {
    const workflowId = newUuid();
    const assetId = newUuid();
    const ownerId = newUuid();
    const allowedHosts = ['hooks.example.test', '*.trusted.example'];
    (sut as unknown as { getConfig: () => Promise<unknown> }).getConfig = vitest.fn().mockResolvedValue({
      machineLearning: { nsfwDetection: { enabled: false }, imageDescription: { enabled: false } },
    });
    mocks.workflow.getForWorkflowRun.mockResolvedValue({
      id: workflowId,
      name: 'webhook workflow',
      trigger: WorkflowTrigger.AssetCreate,
      steps: [
        {
          id: newUuid(),
          config: {},
          pluginId: newUuid(),
          methodName: 'webhook',
          types: [WorkflowType.AssetV1],
          hostFunctions: true,
          allowedHosts,
        },
      ],
    });
    mocks.workflow.isWorkflowEligible.mockResolvedValue(true);
    mocks.workflow.getForAssetV1.mockResolvedValue({ id: assetId, ownerId } as never);
    mocks.plugin.callMethod.mockResolvedValue({});

    await sut.handleAssetCreate({ workflowId, assetId });

    expect(mocks.plugin.callMethod).toHaveBeenCalledWith(
      expect.objectContaining({ methodName: 'webhook' }),
      expect.any(Object),
      { allowedHosts },
    );
  });
});
