import { LoggingRepository } from 'src/repositories/logging.repository';
import { RunPodApiError, RunPodNotFoundError, RunPodRepository } from 'src/repositories/runpod.repository';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe(RunPodRepository.name, () => {
  let sut: RunPodRepository;
  const apiKey = 'rp_test_key';

  beforeEach(() => {
    sut = new RunPodRepository(LoggingRepository.create());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('throws when no API key is provided', async () => {
    await expect(sut.testApiKey('')).rejects.toBeInstanceOf(RunPodApiError);
  });

  it('sends bearer token on requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await sut.testApiKey(apiKey);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe(`Bearer ${apiKey}`);
  });

  it('parses GPU type list from GraphQL', async () => {
    // RunPod's REST API doesn't expose GPU types — we have to hit the GraphQL
    // endpoint. Mock the GraphQL response shape (data.gpuTypes[]).
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        data: {
          gpuTypes: [
            {
              id: 'NVIDIA RTX A5000',
              displayName: 'RTX A5000',
              memoryInGb: 24,
              secureCloud: true,
              communityCloud: true,
              lowestPrice: { uninterruptablePrice: 0.16, minimumBidPrice: 0.16 },
            },
          ],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const gpus = await sut.listGpuTypes(apiKey);
    expect(gpus).toHaveLength(1);
    expect(gpus[0]?.id).toBe('NVIDIA RTX A5000');
    expect(gpus[0]?.pricePerHour).toBe(0.16);
    // The request must have been a POST to the GraphQL endpoint, not REST /gputypes.
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.runpod.io/graphql');
    expect(init.method).toBe('POST');
  });

  it('falls back to minimumBidPrice when uninterruptablePrice is null', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        data: {
          gpuTypes: [
            {
              id: 'NVIDIA L4',
              displayName: 'L4',
              memoryInGb: 24,
              secureCloud: true,
              communityCloud: false,
              lowestPrice: { uninterruptablePrice: null, minimumBidPrice: 0.44 },
            },
          ],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const gpus = await sut.listGpuTypes(apiKey);
    expect(gpus[0]?.pricePerHour).toBe(0.44);
  });

  it('surfaces GraphQL errors as RunPodApiError', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ errors: [{ message: 'Unauthorized' }] }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(sut.listGpuTypes(apiKey)).rejects.toBeInstanceOf(RunPodApiError);
  });

  it('creates a pod with the expected payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        id: 'pod_abc',
        name: 'immich-aaaa-1234',
        desiredStatus: 'CREATED',
        imageName: 'ghcr.io/x/y:z',
        gpuTypeIds: ['NVIDIA RTX A5000'],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await sut.createPod(apiKey, {
      name: 'immich-aaaa-1234',
      imageName: 'ghcr.io/x/y:z',
      gpuTypeIds: ['NVIDIA RTX A5000'],
      containerDiskInGb: 50,
      volumeInGb: 20,
      ports: ['3003/http'],
      env: { IMMICH_ML_AUTH_TOKEN: 'secret' },
    });

    expect(result.id).toBe('pod_abc');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.imageName).toBe('ghcr.io/x/y:z');
    expect(body.ports).toEqual(['3003/http']);
    expect(body.env.IMMICH_ML_AUTH_TOKEN).toBe('secret');
  });

  it('maps 404 to RunPodNotFoundError', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('gone', { status: 404, statusText: 'Not Found' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sut.getPod(apiKey, 'pod_missing')).rejects.toBeInstanceOf(RunPodNotFoundError);
  });

  it('maps 410 to RunPodNotFoundError', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('gone', { status: 410, statusText: 'Gone' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sut.terminatePod(apiKey, 'pod_gone')).rejects.toBeInstanceOf(RunPodNotFoundError);
  });

  it('translates network errors into RunPodApiError', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sut.getPod(apiKey, 'pod_x')).rejects.toBeInstanceOf(RunPodApiError);
  });

  it('attaches an AbortSignal with a timeout', async () => {
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      signal = init.signal!;
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    await sut.testApiKey(apiKey);
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('builds a deterministic proxy URL', () => {
    expect(sut.buildProxyUrl('pod_xyz')).toBe('https://pod_xyz-3003.proxy.runpod.net/');
    expect(sut.buildProxyUrl('pod_xyz', 8888)).toBe('https://pod_xyz-8888.proxy.runpod.net/');
  });

  describe('serverless', () => {
    it('createTemplate posts an env array of key/value pairs', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(Response.json({ id: 'tmpl_abc', name: 'immich-aaaa-template', imageName: 'ghcr.io/x/y:z' }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await sut.createTemplate(apiKey, {
        name: 'immich-aaaa-template',
        imageName: 'ghcr.io/x/y:z',
        containerDiskInGb: 50,
        ports: ['3003/http'],
        env: { MACHINE_LEARNING_CACHE_FOLDER: '/cache' },
      });
      expect(result.id).toBe('tmpl_abc');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://rest.runpod.io/v1/templates');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body);
      expect(body.imageName).toBe('ghcr.io/x/y:z');
      // RunPod's REST template API wants ports as a comma-separated string, not an array.
      expect(body.ports).toBe('3003/http');
      // Env must be an array of {key, value} pairs — RunPod's REST API rejects map-shaped env.
      expect(body.env).toEqual([{ key: 'MACHINE_LEARNING_CACHE_FOLDER', value: '/cache' }]);
    });

    it('createEndpoint serialises scaling config into the payload', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        Response.json({
          id: 'ep_abc',
          name: 'immich-aaaa-endpoint',
          templateId: 'tmpl_abc',
          workersMin: 0,
          workersMax: 3,
        }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const result = await sut.createEndpoint(apiKey, {
        name: 'immich-aaaa-endpoint',
        templateId: 'tmpl_abc',
        gpuTypeIds: ['NVIDIA RTX A5000'],
        workersMin: 0,
        workersMax: 3,
        idleTimeout: 30,
        executionTimeoutMs: 600_000,
        scalerType: 'QUEUE_DELAY',
        scalerValue: 4,
      });
      expect(result.id).toBe('ep_abc');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://rest.runpod.io/v1/endpoints');
      const body = JSON.parse(init.body);
      expect(body.templateId).toBe('tmpl_abc');
      expect(body.gpuTypeIds).toEqual(['NVIDIA RTX A5000']);
      expect(body.workersMin).toBe(0);
      expect(body.workersMax).toBe(3);
      expect(body.idleTimeout).toBe(30);
      expect(body.scalerType).toBe('QUEUE_DELAY');
    });

    it('deleteEndpoint accepts 404 as success via NotFoundError', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('gone', { status: 404, statusText: 'Not Found' }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(sut.deleteEndpoint(apiKey, 'ep_missing')).rejects.toBeInstanceOf(RunPodNotFoundError);
    });

    it('listEndpoints returns an array of summaries', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        Response.json([
          { id: 'ep_1', name: 'immich-aaaa-endpoint', templateId: 'tmpl_1' },
          { id: 'ep_2', name: 'someone-else', templateId: 'tmpl_2' },
        ]),
      );
      vi.stubGlobal('fetch', fetchMock);
      const result = await sut.listEndpoints(apiKey);
      expect(result).toHaveLength(2);
      expect(result[0]?.id).toBe('ep_1');
    });

    it('buildEndpointUrl returns the per-endpoint api.runpod.ai URL', () => {
      expect(sut.buildEndpointUrl('ep_xyz')).toBe('https://ep_xyz.api.runpod.ai/');
    });
  });
});
