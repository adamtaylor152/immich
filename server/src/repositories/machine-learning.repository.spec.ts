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
});
