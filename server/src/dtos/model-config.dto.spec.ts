import { ImageDescriptionConfigSchema } from 'src/dtos/model-config.dto';
import { describe, expect, it } from 'vitest';

describe('ImageDescriptionConfigSchema', () => {
  it('parses default config with prompt block', () => {
    const parsed = ImageDescriptionConfigSchema.parse({
      enabled: true,
      modelName: 'Qwen/Qwen2.5-VL-3B-Instruct',
      fallbackModelName: 'microsoft/Florence-2-base-ft',
      acceleration: 'auto',
      device: 'AUTO',
      prompt: {
        style: 'balanced',
        sentenceCountTarget: 3,
        lookFor: [],
        customVocabulary: [],
        nsfwIndicators: ['naked', 'nudity'],
        medicalIndicators: ['hospital'],
        forbiddenInferences: ['diagnoses'],
        identityInjection: { enabled: true, maxNames: 5, minFaceConfidence: 0.7 },
        advanced: { enabled: false, rawPromptTemplate: '', placeholderValidation: 'strict' },
      },
    });
    expect(parsed.prompt.style).toBe('balanced');
    expect(parsed.prompt.identityInjection.enabled).toBe(true);
  });

  it('hydrates prompt defaults when prompt is omitted', () => {
    const parsed = ImageDescriptionConfigSchema.parse({
      enabled: true,
      modelName: 'Qwen/Qwen2.5-VL-3B-Instruct',
      fallbackModelName: 'microsoft/Florence-2-base-ft',
      acceleration: 'auto',
      device: 'AUTO',
    });
    // Defaults must hydrate so existing stored configs upgrade cleanly.
    expect(parsed.prompt.style).toBe('balanced');
    expect(parsed.prompt.sentenceCountTarget).toBe(3);
    expect(parsed.prompt.identityInjection.enabled).toBe(true);
    expect(parsed.prompt.advanced.enabled).toBe(false);
    expect(parsed.prompt.nsfwIndicators).toContain('naked');
    expect(parsed.prompt.medicalIndicators).toContain('hospital');
    expect(parsed.prompt.lookFor).toContain('brands');
  });

  it('rejects invalid style enum', () => {
    expect(() =>
      ImageDescriptionConfigSchema.parse({
        enabled: true,
        modelName: 'x',
        fallbackModelName: 'y',
        acceleration: 'auto',
        device: 'AUTO',
        prompt: {
          style: 'florid',
          sentenceCountTarget: 3,
          lookFor: [],
          customVocabulary: [],
          nsfwIndicators: [],
          medicalIndicators: [],
          forbiddenInferences: [],
          identityInjection: { enabled: false, maxNames: 5, minFaceConfidence: 0.7 },
          advanced: { enabled: false, rawPromptTemplate: '', placeholderValidation: 'strict' },
        },
      }),
    ).toThrow();
  });

  it('clamps sentenceCountTarget min/max', () => {
    expect(() =>
      ImageDescriptionConfigSchema.parse({
        enabled: true,
        modelName: 'x',
        fallbackModelName: 'y',
        acceleration: 'auto',
        device: 'AUTO',
        prompt: { sentenceCountTarget: 0 },
      } as any),
    ).toThrow();
    expect(() =>
      ImageDescriptionConfigSchema.parse({
        enabled: true,
        modelName: 'x',
        fallbackModelName: 'y',
        acceleration: 'auto',
        device: 'AUTO',
        prompt: { sentenceCountTarget: 99 },
      } as any),
    ).toThrow();
  });

  it('clamps identity confidence to [0,1]', () => {
    expect(() =>
      ImageDescriptionConfigSchema.parse({
        enabled: true,
        modelName: 'x',
        fallbackModelName: 'y',
        acceleration: 'auto',
        device: 'AUTO',
        prompt: { identityInjection: { enabled: true, maxNames: 5, minFaceConfidence: 1.5 } },
      } as any),
    ).toThrow();
  });
});
