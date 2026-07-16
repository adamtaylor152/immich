import { CurrentPlugin } from '@extism/extism';
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

    expect(inProcessOptions.runInWorker).toBe(false);
    expect(Object.keys(inProcessOptions.functions ?? {}).toSorted()).toEqual(officialHostAbi);
    expect(workerOptions.runInWorker).toBe(true);
    expect(Object.keys(workerOptions.functions ?? {}).toSorted()).toEqual(officialHostAbi);
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
});
