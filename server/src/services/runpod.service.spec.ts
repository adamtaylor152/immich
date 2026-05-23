import { BadRequestException } from '@nestjs/common';
import { defaults, SystemConfig } from 'src/config';
import { ImmichWorker, JobName, SystemMetadataKey } from 'src/enum';
import { RunPodNotFoundError, RunPodPodSummary } from 'src/repositories/runpod.repository';
import { RunPodService } from 'src/services/runpod.service';
import { RunPodPersistedState } from 'src/types';
import { newTestService, ServiceMocks } from 'test/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const _systemConfigWithRunPod = (overrides: Partial<SystemConfig['machineLearning']['runpod']> = {}): SystemConfig => ({
  ...defaults,
  machineLearning: {
    ...defaults.machineLearning,
    runpod: {
      ...defaults.machineLearning.runpod,
      enabled: true,
      apiKey: 'rp_test',
      ...overrides,
    },
  },
});

describe(RunPodService.name, () => {
  let sut: RunPodService;
  let mocks: ServiceMocks;
  const PROXY_URL = 'https://pod_abc-3003.proxy.runpod.net/';

  const setState = (state: RunPodPersistedState) => {
    (mocks.systemMetadata.get as ReturnType<typeof vi.fn>).mockImplementation(async (key: SystemMetadataKey) =>
      key === SystemMetadataKey.RunPodState ? state : null,
    );
  };

  const stubConfig = (overrides: Partial<SystemConfig['machineLearning']['runpod']> = {}) => {
    const config = _systemConfigWithRunPod(overrides);
    (sut as unknown as { getConfig: () => Promise<SystemConfig> }).getConfig = vi.fn().mockResolvedValue(config);
    return config;
  };

  beforeEach(() => {
    ({ sut, mocks } = newTestService(RunPodService));
    // Pin to a non-Api worker so onConfigInit doesn't spin up a real interval timer
    (mocks.config.getWorker as ReturnType<typeof vi.fn>).mockReturnValue(ImmichWorker.Microservices);
    (mocks.runPod.buildProxyUrl as ReturnType<typeof vi.fn>).mockImplementation((podId: string) => `https://${podId}-3003.proxy.runpod.net/`);
    stubConfig();
    setState({ status: 'idle' });
  });

  afterEach(() => {
    // Defensive: if any setInterval did leak through, clear all timers.
    vi.useRealTimers();
  });

  describe('testConnection', () => {
    it('returns ok=true when the key works', async () => {
      (mocks.runPod.testApiKey as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      await expect(sut.testConnection('rp_override')).resolves.toEqual({ ok: true });
      expect(mocks.runPod.testApiKey).toHaveBeenCalledWith('rp_override');
    });

    it('returns ok=false with the API error message on failure', async () => {
      (mocks.runPod.testApiKey as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('401 Unauthorized'));
      await expect(sut.testConnection('bad_key')).resolves.toEqual({ ok: false, message: '401 Unauthorized' });
    });
  });

  describe('provision', () => {
    it('refuses without privacy acknowledgement', async () => {
      await expect(
        sut.provision({ gpuTypeId: 'NVIDIA RTX A5000', acknowledgeDataPrivacy: false }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses when runpod.enabled is false', async () => {
      stubConfig({ enabled: false });
      await expect(
        sut.provision({ gpuTypeId: 'NVIDIA RTX A5000', acknowledgeDataPrivacy: true }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses when a pod is already provisioning', async () => {
      setState({
        status: 'provisioning',
        podId: 'pod_busy',
        podCreatedAt: new Date().toISOString(),
        gpuTypeId: 'NVIDIA RTX A5000',
        imageName: 'ghcr.io/x/y:z',
        authToken: 'tok',
        instanceTag: 'tag-1',
      });
      await expect(
        sut.provision({ gpuTypeId: 'NVIDIA RTX A5000', acknowledgeDataPrivacy: true }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates the pod and writes provisioning state', async () => {
      stubConfig({ apiKey: 'rp_test', dataPrivacyAcknowledged: true, imageName: 'ghcr.io/x/y:z' });
      (mocks.runPod.createPod as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'pod_abc',
        name: 'immich-aaaa-0',
        desiredStatus: 'CREATED',
        imageName: 'ghcr.io/x/y:z',
        gpuTypeIds: ['NVIDIA RTX A5000'],
      } as RunPodPodSummary);

      const result = await sut.provision({ gpuTypeId: 'NVIDIA RTX A5000', acknowledgeDataPrivacy: true });

      expect(result.status).toBe('provisioning');
      expect(result.podId).toBe('pod_abc');
      expect(mocks.runPod.createPod).toHaveBeenCalledOnce();
      const [, payload] = (mocks.runPod.createPod as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(payload.imageName).toBe('ghcr.io/x/y:z');
      expect(payload.gpuTypeIds).toEqual(['NVIDIA RTX A5000']);
      expect(payload.env.IMMICH_ML_AUTH_TOKEN).toMatch(/^[0-9a-f]{64}$/);
      expect(payload.env.MACHINE_LEARNING_CACHE_FOLDER).toBe('/cache');
      expect(payload.ports).toEqual(['3003/http']);

      expect(mocks.systemMetadata.set).toHaveBeenCalledWith(
        SystemMetadataKey.RunPodState,
        expect.objectContaining({ status: 'provisioning', podId: 'pod_abc' }),
      );
    });
  });

  describe('idle detection', () => {
    it('updates lastBusyAt when an ML job finishes', async () => {
      const before = new Date('2026-05-22T19:00:00.000Z').toISOString();
      setState({
        status: 'running',
        podId: 'pod_abc',
        podCreatedAt: '2026-05-22T18:50:00.000Z',
        gpuTypeId: 'NVIDIA RTX A5000',
        imageName: 'ghcr.io/x/y:z',
        authToken: 'tok',
        mlUrl: PROXY_URL,
        runningSince: '2026-05-22T18:55:00.000Z',
        lastBusyAt: before,
        maxRuntimeHours: 24,
        instanceTag: 'tag-1',
      });

      sut.onJobSuccess({ job: { name: JobName.SmartSearch, data: { id: 'asset-1' } } } as never);
      // recordBusy is async — wait a tick
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mocks.systemMetadata.set).toHaveBeenCalledWith(
        SystemMetadataKey.RunPodState,
        expect.objectContaining({ status: 'running', lastBusyAt: expect.any(String) }),
      );
      const [, written] = (mocks.systemMetadata.set as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
      expect(Date.parse((written as { lastBusyAt: string }).lastBusyAt)).toBeGreaterThan(Date.parse(before));
    });

    it('does NOT update lastBusyAt for non-ML jobs', async () => {
      setState({
        status: 'running',
        podId: 'pod_abc',
        podCreatedAt: '2026-05-22T18:50:00.000Z',
        gpuTypeId: 'NVIDIA RTX A5000',
        imageName: 'ghcr.io/x/y:z',
        authToken: 'tok',
        mlUrl: PROXY_URL,
        runningSince: '2026-05-22T18:55:00.000Z',
        lastBusyAt: '2026-05-22T19:00:00.000Z',
        maxRuntimeHours: 24,
        instanceTag: 'tag-1',
      });

      sut.onJobSuccess({ job: { name: JobName.AssetEditThumbnailGeneration, data: {} } } as never);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mocks.systemMetadata.set).not.toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('throws when there is no pod', async () => {
      await expect(sut.stop()).rejects.toBeInstanceOf(BadRequestException);
    });

    it('flips state to stopping and triggers the API stop call', async () => {
      const initial: RunPodPersistedState = {
        status: 'running',
        podId: 'pod_abc',
        podCreatedAt: '2026-05-22T18:50:00.000Z',
        gpuTypeId: 'NVIDIA RTX A5000',
        imageName: 'ghcr.io/x/y:z',
        authToken: 'tok',
        mlUrl: PROXY_URL,
        runningSince: '2026-05-22T18:55:00.000Z',
        lastBusyAt: '2026-05-22T19:00:00.000Z',
        maxRuntimeHours: 24,
        instanceTag: 'tag-1',
      };
      // get returns the running state initially, then whatever was last `set` (so syncManagedUrl sees the new state).
      let current: RunPodPersistedState = initial;
      (mocks.systemMetadata.get as ReturnType<typeof vi.fn>).mockImplementation(
        async (key: SystemMetadataKey) => (key === SystemMetadataKey.RunPodState ? current : null),
      );
      (mocks.systemMetadata.set as ReturnType<typeof vi.fn>).mockImplementation(
        async (key: SystemMetadataKey, value: RunPodPersistedState) => {
          if (key === SystemMetadataKey.RunPodState) {
            current = value;
          }
        },
      );
      (mocks.machineLearning.getManagedUrl as ReturnType<typeof vi.fn>).mockReturnValue(PROXY_URL);
      (mocks.runPod.stopPod as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const result = await sut.stop();
      expect(result.status).toBe('stopping');
      expect(mocks.systemMetadata.set).toHaveBeenCalledWith(
        SystemMetadataKey.RunPodState,
        expect.objectContaining({ status: 'stopping', podId: 'pod_abc' }),
      );
      // Clearing the managed URL on the local ML repo
      expect(mocks.machineLearning.clearManagedUrl).toHaveBeenCalled();
    });
  });

  describe('terminate', () => {
    it('returns idle even when the pod is already gone on RunPod', async () => {
      setState({
        status: 'stopped',
        podId: 'pod_abc',
        podCreatedAt: '2026-05-22T18:50:00.000Z',
        gpuTypeId: 'NVIDIA RTX A5000',
        imageName: 'ghcr.io/x/y:z',
        authToken: 'tok',
        stoppedAt: '2026-05-22T19:30:00.000Z',
        instanceTag: 'tag-1',
      });
      (mocks.runPod.terminatePod as ReturnType<typeof vi.fn>).mockRejectedValue(new RunPodNotFoundError('gone'));

      const result = await sut.terminate();
      expect(result.status).toBe('idle');
      expect(mocks.systemMetadata.set).toHaveBeenCalledWith(
        SystemMetadataKey.RunPodState,
        expect.objectContaining({ status: 'idle' }),
      );
    });
  });

  describe('syncManagedUrl via ConfigInit', () => {
    it('injects the managed URL when state is running', async () => {
      setState({
        status: 'running',
        podId: 'pod_abc',
        podCreatedAt: '2026-05-22T18:50:00.000Z',
        gpuTypeId: 'NVIDIA RTX A5000',
        imageName: 'ghcr.io/x/y:z',
        authToken: 'tok-123',
        mlUrl: PROXY_URL,
        runningSince: '2026-05-22T18:55:00.000Z',
        lastBusyAt: '2026-05-22T18:55:00.000Z',
        maxRuntimeHours: 24,
        instanceTag: 'tag-1',
      });
      (mocks.machineLearning.getManagedUrl as ReturnType<typeof vi.fn>).mockReturnValue(null);

      await sut.onConfigInit({ newConfig: _systemConfigWithRunPod() } as never);

      expect(mocks.machineLearning.setManagedUrl).toHaveBeenCalledWith(PROXY_URL, 'tok-123');
    });

    it('clears the managed URL when state is idle', async () => {
      setState({ status: 'idle' });
      (mocks.machineLearning.getManagedUrl as ReturnType<typeof vi.fn>).mockReturnValue(PROXY_URL);

      await sut.onConfigInit({ newConfig: _systemConfigWithRunPod() } as never);

      expect(mocks.machineLearning.clearManagedUrl).toHaveBeenCalled();
    });
  });
});
