import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaults } from 'src/config';
import { MachineLearningHardwareAcceleration } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { MachineLearningRepository, ModelTask, ModelType } from 'src/repositories/machine-learning.repository';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const qwenModelName = 'Qwen/Qwen2.5-VL-3B-Instruct';
const florenceModelName = 'microsoft/Florence-2-base-ft';
const cleanFlorenceModelName = 'Florence-2-base-ft';

describe(MachineLearningRepository.name, () => {
  let sut: MachineLearningRepository;
  let imagePath: string;

  beforeEach(async () => {
    imagePath = join(tmpdir(), `immich-machine-learning-${randomUUID()}.webp`);
    await writeFile(imagePath, Buffer.from([0]));

    sut = new MachineLearningRepository(LoggingRepository.create());
    sut.setup({
      ...defaults.machineLearning,
      urls: ['http://immich-machine-learning:3003'],
      availabilityChecks: { ...defaults.machineLearning.availabilityChecks, enabled: false },
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(imagePath, { force: true });
  });

  it('should not retry Florence fallback models unless CUDA acceleration is selected', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('error', { status: 500, statusText: 'Internal Error' }));
    vi.stubGlobal('fetch', fetch);

    await expect(
      sut.describeImage(imagePath, {
        modelName: qwenModelName,
        fallbackModelName: florenceModelName,
        acceleration: MachineLearningHardwareAcceleration.OpenVino,
        device: 'AUTO',
      }),
    ).rejects.toThrow('Machine learning request');

    expect(fetch).toHaveBeenCalledTimes(1);
    const formData = fetch.mock.calls[0][1].body as FormData;
    const entries = JSON.parse(String(formData.get('entries')));
    expect(entries[ModelTask.IMAGE_DESCRIPTION][ModelType.VISUAL].modelName).toBe(qwenModelName);
  });

  it('should not retry clean Florence fallback model names unless CUDA acceleration is selected', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('error', { status: 500, statusText: 'Internal Error' }));
    vi.stubGlobal('fetch', fetch);

    await expect(
      sut.describeImage(imagePath, {
        modelName: qwenModelName,
        fallbackModelName: cleanFlorenceModelName,
        acceleration: MachineLearningHardwareAcceleration.OpenVino,
        device: 'AUTO',
      }),
    ).rejects.toThrow('Machine learning request');

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('should retry Florence fallback models with CUDA acceleration', async () => {
    const result = {
      imageHeight: 120,
      imageWidth: 160,
      [ModelTask.IMAGE_DESCRIPTION]: {
        description: 'A beach scene.',
        people: [],
        environment: 'beach',
        objects: ['sand'],
        visible_text: [],
        context: 'outdoor',
        tags: ['beach'],
      },
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('error', { status: 500, statusText: 'Internal Error' }))
      .mockResolvedValueOnce(Response.json(result));
    vi.stubGlobal('fetch', fetch);

    await expect(
      sut.describeImage(imagePath, {
        modelName: qwenModelName,
        fallbackModelName: florenceModelName,
        acceleration: MachineLearningHardwareAcceleration.Cuda,
        device: 'AUTO',
      }),
    ).resolves.toEqual(result[ModelTask.IMAGE_DESCRIPTION]);

    expect(fetch).toHaveBeenCalledTimes(2);
    const formData = fetch.mock.calls[1][1].body as FormData;
    const entries = JSON.parse(String(formData.get('entries')));
    expect(entries[ModelTask.IMAGE_DESCRIPTION][ModelType.VISUAL].modelName).toBe(florenceModelName);
  });

  it('should NOT retry the fallback model on the managed (RunPod) URL', async () => {
    // Two URLs in priority order: managed (RunPod) first, then a local fallback.
    // Primary fails on managed → we skip the Florence retry on managed and
    // move straight to the local URL, where the fallback IS allowed.
    sut.setManagedUrl('https://endpoint.api.runpod.ai/', 'rpa_test_key');

    const fetch = vi
      .fn()
      // 1) managed URL, primary model → 500
      .mockResolvedValueOnce(new Response('error', { status: 500, statusText: 'Internal Error' }))
      // 2) local URL, primary model → 500
      .mockResolvedValueOnce(new Response('error', { status: 500, statusText: 'Internal Error' }))
      // 3) local URL, fallback model → 200
      .mockResolvedValueOnce(
        Response.json({
          imageHeight: 64,
          imageWidth: 64,
          [ModelTask.IMAGE_DESCRIPTION]: {
            description: 'cat',
            people: [],
            environment: '',
            objects: ['cat'],
            visible_text: [],
            context: '',
            tags: ['cat'],
          },
        }),
      );
    vi.stubGlobal('fetch', fetch);

    await sut.describeImage(imagePath, {
      modelName: qwenModelName,
      fallbackModelName: florenceModelName,
      acceleration: MachineLearningHardwareAcceleration.Cuda,
      device: 'AUTO',
    });

    expect(fetch).toHaveBeenCalledTimes(3);

    // First call: managed URL, primary model
    expect(String(fetch.mock.calls[0][0])).toMatch(/endpoint\.api\.runpod\.ai/);
    const managedEntries = JSON.parse(String((fetch.mock.calls[0][1].body as FormData).get('entries')));
    expect(managedEntries[ModelTask.IMAGE_DESCRIPTION][ModelType.VISUAL].modelName).toBe(qwenModelName);

    // Second call: local URL, primary model (NOT fallback — primary always tried first)
    expect(String(fetch.mock.calls[1][0])).toMatch(/immich-machine-learning:3003/);
    const localPrimaryEntries = JSON.parse(String((fetch.mock.calls[1][1].body as FormData).get('entries')));
    expect(localPrimaryEntries[ModelTask.IMAGE_DESCRIPTION][ModelType.VISUAL].modelName).toBe(qwenModelName);

    // Third call: local URL, fallback model
    expect(String(fetch.mock.calls[2][0])).toMatch(/immich-machine-learning:3003/);
    const localFallbackEntries = JSON.parse(String((fetch.mock.calls[2][1].body as FormData).get('entries')));
    expect(localFallbackEntries[ModelTask.IMAGE_DESCRIPTION][ModelType.VISUAL].modelName).toBe(florenceModelName);
  });

  it('should never call the fallback model when only the managed URL is configured', async () => {
    // Tear down the URL list so the managed URL is the only candidate.
    sut.setup({
      ...defaults.machineLearning,
      urls: [],
      availabilityChecks: { ...defaults.machineLearning.availabilityChecks, enabled: false },
    });
    sut.setManagedUrl('https://endpoint.api.runpod.ai/', 'rpa_test_key');

    const fetch = vi.fn().mockResolvedValue(new Response('error', { status: 500, statusText: 'Internal Error' }));
    vi.stubGlobal('fetch', fetch);

    await expect(
      sut.describeImage(imagePath, {
        modelName: qwenModelName,
        fallbackModelName: florenceModelName,
        acceleration: MachineLearningHardwareAcceleration.Cuda,
        device: 'AUTO',
      }),
    ).rejects.toThrow('failed for all URLs');

    expect(fetch).toHaveBeenCalledTimes(1);
    const formData = fetch.mock.calls[0][1].body as FormData;
    const entries = JSON.parse(String(formData.get('entries')));
    expect(entries[ModelTask.IMAGE_DESCRIPTION][ModelType.VISUAL].modelName).toBe(qwenModelName);
  });

  it('should sort configured URLs healthy-first while keeping the managed URL pinned to the front', async () => {
    // Two configured URLs: A unhealthy, B healthy. Plus a managed RunPod URL.
    // Expected iteration order: managed, B (healthy), A (unhealthy).
    // The managed URL is ALWAYS first regardless of its /ping health, but
    // among the configured URLs the live one moves up so we don't sit on a
    // TCP timeout to the dead box.
    sut.setup({
      ...defaults.machineLearning,
      urls: ['http://dead-box:3003', 'http://live-box:3003'],
      availabilityChecks: { ...defaults.machineLearning.availabilityChecks, enabled: false },
    });
    // Mark health AFTER setup() so the values survive (setup also clears stale entries).
    (sut as unknown as { healthyMap: Record<string, boolean> }).healthyMap = {
      'http://dead-box:3003': false,
      'http://live-box:3003': true,
    };
    sut.setManagedUrl('https://endpoint.api.runpod.ai/', 'rpa_test_key');

    // First request: managed URL succeeds → only one fetch needed, but we want
    // to assert the FULL iteration order, so make everything 500 and inspect calls.
    const fetch = vi.fn().mockResolvedValue(new Response('error', { status: 500, statusText: 'Internal Error' }));
    vi.stubGlobal('fetch', fetch);

    await expect(
      sut.describeImage(imagePath, {
        modelName: qwenModelName,
        fallbackModelName: '', // no fallback so iteration is one model per URL
        acceleration: MachineLearningHardwareAcceleration.Cuda,
        device: 'AUTO',
      }),
    ).rejects.toThrow('failed for all URLs');

    // Three calls in expected order: managed, live, dead.
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(String(fetch.mock.calls[0][0])).toMatch(/endpoint\.api\.runpod\.ai/);
    expect(String(fetch.mock.calls[1][0])).toMatch(/live-box/);
    expect(String(fetch.mock.calls[2][0])).toMatch(/dead-box/);
  });

  it('should NOT demote the managed URL even when its /ping is failing', async () => {
    // Codex's PR #52 review surfaced the previous-but-now-fixed bug where
    // a cold-starting RunPod worker would be demoted because /ping timed out.
    // This test guards against any future regression that tries to apply the
    // configured-URL reorder logic to the managed URL.
    sut.setup({
      ...defaults.machineLearning,
      urls: ['http://local:3003'],
      availabilityChecks: { ...defaults.machineLearning.availabilityChecks, enabled: false },
    });
    sut.setManagedUrl('https://endpoint.api.runpod.ai/', 'rpa_test_key');
    (sut as unknown as { healthyMap: Record<string, boolean> }).healthyMap = {
      'http://local:3003': true, // local IS healthy
      'https://endpoint.api.runpod.ai/': false, // managed reports unhealthy (cold start)
    };

    const fetch = vi.fn().mockResolvedValue(new Response('error', { status: 500, statusText: 'Internal Error' }));
    vi.stubGlobal('fetch', fetch);

    await expect(
      sut.describeImage(imagePath, {
        modelName: qwenModelName,
        fallbackModelName: '',
        acceleration: MachineLearningHardwareAcceleration.Cuda,
        device: 'AUTO',
      }),
    ).rejects.toThrow('failed for all URLs');

    // Managed URL must still be tried first even with healthyMap reporting it unhealthy.
    expect(String(fetch.mock.calls[0][0])).toMatch(/endpoint\.api\.runpod\.ai/);
    expect(String(fetch.mock.calls[1][0])).toMatch(/local:3003/);
  });
});
