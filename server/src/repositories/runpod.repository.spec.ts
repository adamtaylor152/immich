import { LoggingRepository } from 'src/repositories/logging.repository';
import {
  RunPodApiError,
  RunPodNotFoundError,
  RunPodRepository,
} from 'src/repositories/runpod.repository';
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

  it('parses GPU type list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json([
        { id: 'NVIDIA RTX A5000', displayName: 'RTX A5000', memoryInGb: 24, pricePerHour: 0.16 },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const gpus = await sut.listGpuTypes(apiKey);
    expect(gpus).toHaveLength(1);
    expect(gpus[0]?.id).toBe('NVIDIA RTX A5000');
    expect(gpus[0]?.pricePerHour).toBe(0.16);
  });

  it('accepts {data: [...]} wrapper from GPU list endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        data: [{ id: 'NVIDIA RTX 4090', displayName: '4090', memoryInGb: 24, pricePerHour: 0.34 }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const gpus = await sut.listGpuTypes(apiKey);
    expect(gpus[0]?.displayName).toBe('4090');
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
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      signal = init.signal!;
      return new Response('[]', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await sut.testApiKey(apiKey);
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('builds a deterministic proxy URL', () => {
    expect(sut.buildProxyUrl('pod_xyz')).toBe('https://pod_xyz-3003.proxy.runpod.net/');
    expect(sut.buildProxyUrl('pod_xyz', 8888)).toBe('https://pod_xyz-8888.proxy.runpod.net/');
  });
});
