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
    (mocks.systemMetadata.get as ReturnType<typeof vi.fn>).mockImplementation((key: SystemMetadataKey) =>
      Promise.resolve(key === SystemMetadataKey.RunPodState ? state : null),
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
    (mocks.runPod.buildProxyUrl as ReturnType<typeof vi.fn>).mockImplementation(
      (podId: string) => `https://${podId}-3003.proxy.runpod.net/`,
    );
    stubConfig();
    setState({ status: 'idle' });
  });

  afterEach(() => {
    // Defensive: if any setInterval did leak through, clear all timers.
    vi.useRealTimers();
  });

  describe('testConnection', () => {
    it('returns ok=true when the key works', async () => {
      (mocks.runPod.testApiKey as ReturnType<typeof vi.fn>).mockImplementation(() => Promise.resolve());
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
      // The DTO schema enforces acknowledgeDataPrivacy: literal(true), but the
      // service keeps an explicit runtime guard. Cast through never to force
      // a `false` past the type system and verify the runtime guard still trips.
      await expect(
        sut.provision({ gpuTypeId: 'NVIDIA RTX A5000', acknowledgeDataPrivacy: false } as never),
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
      (mocks.runPod.listPods as ReturnType<typeof vi.fn>).mockResolvedValue([]);
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

    it('terminates an orphan pod from a previous ambiguous failure before creating a fresh one', async () => {
      stubConfig({ apiKey: 'rp_test', dataPrivacyAcknowledged: true, imageName: 'ghcr.io/x/y:z' });
      // Previous attempt errored but left state with instanceTag; the user retries.
      setState({
        status: 'error',
        message: 'Failed to create pod: timeout',
        errorAt: new Date(Date.now() - 60_000).toISOString(),
        instanceTag: 'aaaa1111-2222-3333-4444-555566667777',
      });
      // RunPod returns a pod whose name matches our instanceTag prefix — this is the orphan.
      (mocks.runPod.listPods as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'pod_orphan',
          name: 'immich-aaaa1111-1748000000',
          desiredStatus: 'RUNNING',
          imageName: 'x',
          gpuTypeIds: ['x'],
        },
        { id: 'pod_other_user', name: 'something-else', desiredStatus: 'RUNNING', imageName: 'x', gpuTypeIds: ['x'] },
      ]);
      (mocks.runPod.terminatePod as ReturnType<typeof vi.fn>).mockImplementation(() => Promise.resolve());
      (mocks.runPod.createPod as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'pod_new',
        name: 'immich-aaaa1111-1748000123',
        desiredStatus: 'CREATED',
        imageName: 'x',
        gpuTypeIds: ['x'],
      } as RunPodPodSummary);

      const result = await sut.provision({ gpuTypeId: 'NVIDIA RTX A5000', acknowledgeDataPrivacy: true });

      expect(mocks.runPod.terminatePod).toHaveBeenCalledWith('rp_test', 'pod_orphan');
      // The unrelated pod (different name prefix) must not be touched.
      expect(mocks.runPod.terminatePod).not.toHaveBeenCalledWith('rp_test', 'pod_other_user');
      expect(result.podId).toBe('pod_new');
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

    it('syncs the managed URL on JobStart for ML jobs (catches non-API workers)', async () => {
      setState({
        status: 'running',
        podId: 'pod_abc',
        podCreatedAt: '2026-05-22T18:50:00.000Z',
        gpuTypeId: 'NVIDIA RTX A5000',
        imageName: 'ghcr.io/x/y:z',
        authToken: 'tok-xyz',
        mlUrl: PROXY_URL,
        runningSince: '2026-05-22T18:55:00.000Z',
        lastBusyAt: '2026-05-22T19:00:00.000Z',
        maxRuntimeHours: 24,
        instanceTag: 'tag-1',
      });
      (mocks.machineLearning.getManagedUrl as ReturnType<typeof vi.fn>).mockReturnValue(null);

      sut.onJobStart('smartSearch' as never, { name: JobName.SmartSearch, data: { id: 'asset-1' } } as never);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mocks.machineLearning.setManagedUrl).toHaveBeenCalledWith(PROXY_URL, 'tok-xyz');
    });

    it('does NOT sync the managed URL on JobStart for non-ML jobs', async () => {
      setState({
        status: 'running',
        podId: 'pod_abc',
        podCreatedAt: '2026-05-22T18:50:00.000Z',
        gpuTypeId: 'NVIDIA RTX A5000',
        imageName: 'ghcr.io/x/y:z',
        authToken: 'tok-xyz',
        mlUrl: PROXY_URL,
        runningSince: '2026-05-22T18:55:00.000Z',
        lastBusyAt: '2026-05-22T19:00:00.000Z',
        maxRuntimeHours: 24,
        instanceTag: 'tag-1',
      });
      (mocks.machineLearning.getManagedUrl as ReturnType<typeof vi.fn>).mockReturnValue(null);

      sut.onJobStart(
        'thumbnailGeneration' as never,
        { name: JobName.AssetGenerateThumbnails, data: { id: 'asset-1' } } as never,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mocks.machineLearning.setManagedUrl).not.toHaveBeenCalled();
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
      (mocks.systemMetadata.get as ReturnType<typeof vi.fn>).mockImplementation((key: SystemMetadataKey) =>
        Promise.resolve(key === SystemMetadataKey.RunPodState ? current : null),
      );
      (mocks.systemMetadata.set as ReturnType<typeof vi.fn>).mockImplementation(
        (key: SystemMetadataKey, value: RunPodPersistedState) => {
          if (key === SystemMetadataKey.RunPodState) {
            current = value;
          }
          return Promise.resolve();
        },
      );
      (mocks.machineLearning.getManagedUrl as ReturnType<typeof vi.fn>).mockReturnValue(PROXY_URL);
      (mocks.runPod.stopPod as ReturnType<typeof vi.fn>).mockImplementation(() => Promise.resolve());

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

  describe('start (resume)', () => {
    it('resets podCreatedAt so the provisioning timeout applies to the resume, not the original launch', async () => {
      // Original launch was hours ago — reusing it would immediately exceed
      // PROVISION_TIMEOUT_MS on the next reconcile and mark the pod as errored.
      const longAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
      setState({
        status: 'stopped',
        podId: 'pod_abc',
        podCreatedAt: longAgo,
        gpuTypeId: 'NVIDIA RTX A5000',
        imageName: 'ghcr.io/x/y:z',
        authToken: 'tok',
        stoppedAt: new Date().toISOString(),
        instanceTag: 'tag-1',
      });
      (mocks.runPod.startPod as ReturnType<typeof vi.fn>).mockImplementation(() => Promise.resolve());

      const result = await sut.start();
      expect(result.status).toBe('starting');

      const [, written] = (mocks.systemMetadata.set as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
      const writtenState = written as { status: string; podCreatedAt: string };
      expect(writtenState.status).toBe('starting');
      expect(Date.parse(writtenState.podCreatedAt)).toBeGreaterThan(Date.parse(longAgo));
      // and it should be recent — within 5 seconds of "now"
      expect(Math.abs(Date.now() - Date.parse(writtenState.podCreatedAt))).toBeLessThan(5000);
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

  describe('serverless mode', () => {
    const ENDPOINT_URL = 'https://ep_xyz.api.runpod.ai/';

    // Nested closure intentional — `stubConfig` references the outer `sut`
    // that beforeEach re-creates per test, so this can't be hoisted.
    // eslint-disable-next-line unicorn/consistent-function-scoping
    const stubServerlessConfig = (overrides: Partial<SystemConfig['machineLearning']['runpod']> = {}): SystemConfig =>
      stubConfig({ mode: 'serverless', ...overrides });

    beforeEach(() => {
      (mocks.runPod.buildEndpointUrl as ReturnType<typeof vi.fn>).mockImplementation(
        (endpointId: string) => `https://${endpointId}.api.runpod.ai/`,
      );
    });

    it('ensureServerlessEndpoint creates template + endpoint and writes ready state', async () => {
      stubServerlessConfig();
      // Make the get/set mocks behave like a real key/value store so that the
      // post-write syncManagedUrl() observes the freshly written state.
      let currentState: RunPodPersistedState = { status: 'idle' };
      (mocks.systemMetadata.get as ReturnType<typeof vi.fn>).mockImplementation((key: SystemMetadataKey) =>
        Promise.resolve(key === SystemMetadataKey.RunPodState ? currentState : null),
      );
      (mocks.systemMetadata.set as ReturnType<typeof vi.fn>).mockImplementation(
        (_key: SystemMetadataKey, value: RunPodPersistedState) => {
          currentState = value;
          return Promise.resolve();
        },
      );
      (mocks.machineLearning.getManagedUrl as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (mocks.runPod.listEndpoints as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (mocks.runPod.createTemplate as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'tmpl_abc',
        name: 'immich-aaaaaaaa-template',
        imageName: 'ghcr.io/x/y:z',
      });
      (mocks.runPod.createEndpoint as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'ep_xyz',
        name: 'immich-aaaaaaaa-endpoint',
        templateId: 'tmpl_abc',
      });

      const result = await sut.ensureServerlessEndpoint();

      expect(result.status).toBe('serverless-ready');
      expect(result.endpointId).toBe('ep_xyz');
      expect(result.endpointUrl).toBe(ENDPOINT_URL);
      expect(mocks.runPod.createTemplate).toHaveBeenCalledTimes(1);
      // The template MUST NOT include IMMICH_ML_AUTH_TOKEN — RunPod's proxy already auth-gates
      // and adding our middleware would double-bearer.
      const templatePayload = (mocks.runPod.createTemplate as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(templatePayload.env).toEqual({ MACHINE_LEARNING_CACHE_FOLDER: '/cache' });
      expect(mocks.runPod.createEndpoint).toHaveBeenCalledTimes(1);
      expect(mocks.systemMetadata.set).toHaveBeenCalledWith(
        SystemMetadataKey.RunPodState,
        expect.objectContaining({ status: 'serverless-ready', endpointId: 'ep_xyz' }),
      );
      // The managed URL must be set with the RunPod API key as the bearer.
      expect(mocks.machineLearning.setManagedUrl).toHaveBeenCalledWith(ENDPOINT_URL, 'rp_test');
    });

    it('ensureServerlessEndpoint adopts an existing endpoint instead of creating a duplicate', async () => {
      const config = stubServerlessConfig();
      setState({ status: 'idle', instanceTag: 'aaaaaaaa-1234' });
      // Listing returns a matching endpoint — the service should reuse it.
      (mocks.runPod.listEndpoints as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'ep_existing',
          name: `immich-${config.machineLearning.runpod.imageName.slice(0, 8)}-endpoint`,
          templateId: 'tmpl_existing',
        },
        // Add an entry with our actual prefix
        { id: 'ep_existing_real', name: 'immich-aaaaaaaa-endpoint', templateId: 'tmpl_existing' },
      ]);

      await sut.ensureServerlessEndpoint();

      expect(mocks.runPod.createTemplate).not.toHaveBeenCalled();
      expect(mocks.runPod.createEndpoint).not.toHaveBeenCalled();
      expect(mocks.systemMetadata.set).toHaveBeenCalledWith(
        SystemMetadataKey.RunPodState,
        expect.objectContaining({ status: 'serverless-ready', endpointId: 'ep_existing_real' }),
      );
    });

    it('ensureServerlessEndpoint verifies an already-ready endpoint and returns it unchanged', async () => {
      stubServerlessConfig();
      setState({
        status: 'serverless-ready',
        instanceTag: 'aaaaaaaa-1234',
        templateId: 'tmpl_existing',
        endpointId: 'ep_existing',
        endpointUrl: ENDPOINT_URL,
        imageName: 'ghcr.io/x/y:z',
        gpuTypeIds: ['NVIDIA RTX A5000'],
        workersMin: 0,
        workersMax: 3,
        idleTimeoutSeconds: 30,
        createdAt: '2026-05-22T20:00:00.000Z',
      });
      (mocks.runPod.getEndpoint as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'ep_existing',
        name: 'immich-aaaaaaaa-endpoint',
        templateId: 'tmpl_existing',
      });

      const result = await sut.ensureServerlessEndpoint();
      expect(result.status).toBe('serverless-ready');
      expect(mocks.runPod.createTemplate).not.toHaveBeenCalled();
      expect(mocks.runPod.createEndpoint).not.toHaveBeenCalled();
    });

    it('teardownServerlessEndpoint deletes endpoint + template and returns idle', async () => {
      stubServerlessConfig();
      setState({
        status: 'serverless-ready',
        instanceTag: 'aaaaaaaa-1234',
        templateId: 'tmpl_existing',
        endpointId: 'ep_existing',
        endpointUrl: ENDPOINT_URL,
        imageName: 'ghcr.io/x/y:z',
        gpuTypeIds: ['NVIDIA RTX A5000'],
        workersMin: 0,
        workersMax: 3,
        idleTimeoutSeconds: 30,
        createdAt: '2026-05-22T20:00:00.000Z',
      });

      const result = await sut.teardownServerlessEndpoint();
      expect(result.status).toBe('idle');
      expect(mocks.runPod.deleteEndpoint).toHaveBeenCalledWith('rp_test', 'ep_existing');
      expect(mocks.runPod.deleteTemplate).toHaveBeenCalledWith('rp_test', 'tmpl_existing');
      expect(mocks.machineLearning.clearManagedUrl).toHaveBeenCalled();
    });

    it('teardownServerlessEndpoint soft-fails when the endpoint is already gone', async () => {
      stubServerlessConfig();
      setState({
        status: 'serverless-ready',
        instanceTag: 'aaaaaaaa-1234',
        templateId: 'tmpl_existing',
        endpointId: 'ep_existing',
        endpointUrl: ENDPOINT_URL,
        imageName: 'ghcr.io/x/y:z',
        gpuTypeIds: ['NVIDIA RTX A5000'],
        workersMin: 0,
        workersMax: 3,
        idleTimeoutSeconds: 30,
        createdAt: '2026-05-22T20:00:00.000Z',
      });
      (mocks.runPod.deleteEndpoint as ReturnType<typeof vi.fn>).mockRejectedValue(new RunPodNotFoundError('gone'));
      (mocks.runPod.deleteTemplate as ReturnType<typeof vi.fn>).mockRejectedValue(new RunPodNotFoundError('gone'));

      const result = await sut.teardownServerlessEndpoint();
      expect(result.status).toBe('idle');
    });

    it('provision is refused in serverless mode', async () => {
      stubServerlessConfig();
      setState({ status: 'idle' });
      await expect(
        sut.provision({ gpuTypeId: 'NVIDIA RTX A5000', acknowledgeDataPrivacy: true }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('syncManagedUrl injects the endpoint URL with the API key as bearer in serverless-ready', async () => {
      stubServerlessConfig();
      setState({
        status: 'serverless-ready',
        instanceTag: 'aaaaaaaa-1234',
        templateId: 'tmpl_existing',
        endpointId: 'ep_xyz',
        endpointUrl: ENDPOINT_URL,
        imageName: 'ghcr.io/x/y:z',
        gpuTypeIds: ['NVIDIA RTX A5000'],
        workersMin: 0,
        workersMax: 3,
        idleTimeoutSeconds: 30,
        createdAt: '2026-05-22T20:00:00.000Z',
      });
      (mocks.machineLearning.getManagedUrl as ReturnType<typeof vi.fn>).mockReturnValue(null);

      await sut.onConfigInit({ newConfig: _systemConfigWithRunPod({ mode: 'serverless' }) } as never);

      expect(mocks.machineLearning.setManagedUrl).toHaveBeenCalledWith(ENDPOINT_URL, 'rp_test');
    });
  });
});
