import type { ImageDescriptionPromptConfig } from 'src/services/prompt-assembler.service';
import { ImageDescriptionPromptAssembler } from 'src/services/prompt-assembler.service';
import { describe, expect, it } from 'vitest';

const baseConfig = (overrides: Partial<ImageDescriptionPromptConfig> = {}): ImageDescriptionPromptConfig => ({
  style: 'balanced',
  sentenceCountTarget: 3,
  lookFor: [],
  customVocabulary: [],
  customInstructions: '',
  nsfwIndicators: ['naked', 'nudity', 'exposed-genitals'],
  medicalIndicators: ['hospital', 'bandage', 'iv-line'],
  forbiddenInferences: ['diagnoses', 'medication names'],
  identityInjection: { enabled: true, maxNames: 5, minFaceConfidence: 0.7 },
  advanced: { enabled: false, rawPromptTemplate: '', placeholderValidation: 'strict' },
  ...overrides,
});

describe('ImageDescriptionPromptAssembler', () => {
  const assembler = new ImageDescriptionPromptAssembler();

  it('produces a prompt with the standard role line and JSON schema', () => {
    const { prompt } = assembler.build({ config: baseConfig(), knownPersons: [] });
    expect(prompt).toContain('searchable image record');
    expect(prompt).toContain('"description"');
    expect(prompt).toContain('"tags"');
    expect(prompt).toContain('"safety"');
    expect(prompt).toContain('"medical"');
  });

  it('omits identity hint section when no known persons supplied', () => {
    const { prompt } = assembler.build({ config: baseConfig(), knownPersons: [] });
    expect(prompt).not.toContain('Known people detected');
  });

  it('omits look-for section when lookFor is empty', () => {
    const { prompt } = assembler.build({ config: baseConfig({ lookFor: [] }), knownPersons: [] });
    expect(prompt).not.toContain('When relevant and visibly supported');
  });

  it('includes look-for section when lookFor is non-empty', () => {
    const { prompt } = assembler.build({
      config: baseConfig({ lookFor: ['brands', 'sports equipment'] }),
      knownPersons: [],
    });
    expect(prompt).toContain('brands');
    expect(prompt).toContain('sports equipment');
  });

  it('includes vocabulary section when customVocabulary is non-empty', () => {
    const { prompt } = assembler.build({
      config: baseConfig({ customVocabulary: ['prescription-bottle', 'surfboard'] }),
      knownPersons: [],
    });
    expect(prompt).toContain('Prefer these tag values');
    expect(prompt).toContain('prescription-bottle');
  });

  it('terse style produces one-sentence instruction', () => {
    const { prompt } = assembler.build({
      config: baseConfig({ style: 'terse', sentenceCountTarget: 1 }),
      knownPersons: [],
    });
    expect(prompt).toMatch(/one factual sentence/i);
  });

  it('rich style produces multi-sentence instruction including mood/season', () => {
    const { prompt } = assembler.build({
      config: baseConfig({ style: 'rich', sentenceCountTarget: 5 }),
      knownPersons: [],
    });
    expect(prompt).toMatch(/mood/i);
    expect(prompt).toMatch(/season/i);
  });

  it('builds forbidden-inferences section from config list', () => {
    const { prompt } = assembler.build({
      config: baseConfig({ forbiddenInferences: ['diagnoses', 'pregnancy'] }),
      knownPersons: [],
    });
    expect(prompt).toContain('diagnoses');
    expect(prompt).toContain('pregnancy');
  });

  describe('identity hint', () => {
    it('includes named persons above min confidence', () => {
      const { prompt } = assembler.build({
        config: baseConfig(),
        knownPersons: [
          { name: 'Conner', faceConfidence: 0.95, boxCenter: [0.3, 0.5] },
          { name: 'Sarah', faceConfidence: 0.92, boxCenter: [0.7, 0.5] },
        ],
      });
      expect(prompt).toContain('Known people detected');
      expect(prompt).toContain('Conner');
      expect(prompt).toContain('Sarah');
    });

    it('strengthened wording requires naming each person and forbids generic group nouns', () => {
      const { prompt } = assembler.build({
        config: baseConfig(),
        knownPersons: [
          { name: 'Kelly', faceConfidence: 1, boxCenter: [0.2, 0.5] },
          { name: 'Connor', faceConfidence: 1, boxCenter: [0.4, 0.5] },
          { name: 'Alexa', faceConfidence: 1, boxCenter: [0.6, 0.5] },
          { name: 'Jeremy', faceConfidence: 1, boxCenter: [0.8, 0.5] },
        ],
      });
      // Strong directive present
      expect(prompt).toContain('MUST refer to each');
      // Explicitly forbids generic group nouns
      expect(prompt).toContain('a family');
      expect(prompt).toContain('a group');
      // All four names still listed
      for (const name of ['Kelly', 'Connor', 'Alexa', 'Jeremy']) {
        expect(prompt).toContain(name);
      }
    });

    it('drops persons below min confidence', () => {
      const { prompt } = assembler.build({
        config: baseConfig({ identityInjection: { enabled: true, maxNames: 5, minFaceConfidence: 0.9 } }),
        knownPersons: [
          { name: 'Conner', faceConfidence: 0.95, boxCenter: [0.3, 0.5] },
          { name: 'Unsure', faceConfidence: 0.6, boxCenter: [0.5, 0.5] },
        ],
      });
      expect(prompt).toContain('Conner');
      expect(prompt).not.toContain('Unsure');
    });

    it('caps at maxNames', () => {
      const { prompt } = assembler.build({
        config: baseConfig({ identityInjection: { enabled: true, maxNames: 2, minFaceConfidence: 0.5 } }),
        knownPersons: [
          { name: 'Alice', faceConfidence: 0.9, boxCenter: [0.1, 0.5] },
          { name: 'Bob', faceConfidence: 0.9, boxCenter: [0.5, 0.5] },
          { name: 'Carol', faceConfidence: 0.9, boxCenter: [0.9, 0.5] },
        ],
      });
      expect(prompt).toContain('Alice');
      expect(prompt).toContain('Bob');
      expect(prompt).not.toContain('Carol');
    });

    it('omits identity section when injection is disabled', () => {
      const { prompt } = assembler.build({
        config: baseConfig({ identityInjection: { enabled: false, maxNames: 5, minFaceConfidence: 0.7 } }),
        knownPersons: [{ name: 'Conner', faceConfidence: 0.95, boxCenter: [0.3, 0.5] }],
      });
      expect(prompt).not.toContain('Conner');
      expect(prompt).not.toContain('Known people');
    });
  });

  describe('NSFW reinforcement', () => {
    it('appends NSFW reinforcement section when nsfw.isNsfw is true', () => {
      const { prompt } = assembler.build({ config: baseConfig(), knownPersons: [], nsfw: { isNsfw: true } });
      expect(prompt).toMatch(/dedicated NSFW classifier flagged/i);
      expect(prompt).toMatch(/nsfw_review/);
    });

    it('does not append NSFW reinforcement when nsfw.isNsfw is false', () => {
      const { prompt } = assembler.build({ config: baseConfig(), knownPersons: [], nsfw: { isNsfw: false } });
      expect(prompt).not.toMatch(/dedicated NSFW classifier flagged/i);
    });

    it('does not append NSFW reinforcement when nsfw is undefined', () => {
      const { prompt } = assembler.build({ config: baseConfig(), knownPersons: [] });
      expect(prompt).not.toMatch(/dedicated NSFW classifier flagged/i);
    });

    it('uses configured nsfwIndicators in reinforcement section', () => {
      const { prompt } = assembler.build({
        config: baseConfig({ nsfwIndicators: ['custom-term-a', 'custom-term-b'] }),
        knownPersons: [],
        nsfw: { isNsfw: true },
      });
      expect(prompt).toContain('custom-term-a');
      expect(prompt).toContain('custom-term-b');
    });

    it('appends NSFW reinforcement in advanced mode too', () => {
      const { prompt } = assembler.build({
        config: baseConfig({
          advanced: { enabled: true, rawPromptTemplate: 'TEMPLATE {schema}', placeholderValidation: 'strict' },
        }),
        knownPersons: [],
        nsfw: { isNsfw: true },
      });
      expect(prompt).toMatch(/^TEMPLATE/);
      expect(prompt).toMatch(/dedicated NSFW classifier flagged/i);
    });
  });

  describe('customInstructions', () => {
    it('injects custom instructions when non-empty', () => {
      const { prompt } = assembler.build({
        config: baseConfig({ customInstructions: 'If you see a vehicle, identify the make and model.' }),
        knownPersons: [],
      });
      expect(prompt).toContain('Additional instructions:');
      expect(prompt).toContain('identify the make and model');
    });

    it('omits the section when customInstructions is empty', () => {
      const { prompt } = assembler.build({ config: baseConfig({ customInstructions: '' }), knownPersons: [] });
      expect(prompt).not.toContain('Additional instructions:');
    });

    it('omits the section when customInstructions is only whitespace', () => {
      const { prompt } = assembler.build({ config: baseConfig({ customInstructions: '   \n  ' }), knownPersons: [] });
      expect(prompt).not.toContain('Additional instructions:');
    });

    it('does not inject customInstructions in advanced (raw template) mode', () => {
      const { prompt } = assembler.build({
        config: baseConfig({
          customInstructions: 'Identify any sport being played.',
          advanced: { enabled: true, rawPromptTemplate: 'CUSTOM {schema}', placeholderValidation: 'strict' },
        }),
        knownPersons: [],
      });
      expect(prompt).not.toContain('Additional instructions:');
      expect(prompt).not.toContain('Identify any sport');
    });
  });

  describe('videoContext', () => {
    it('prefixes the prompt with a composite-grid description when videoContext is supplied', () => {
      const { prompt } = assembler.build({
        config: baseConfig(),
        knownPersons: [],
        videoContext: { cols: 2, rows: 2, timestampsMs: [1000, 5000, 9000, 13_000], durationMs: 15_000 },
      });
      expect(prompt).toContain('composite 2x2 grid of 4 frames');
      expect(prompt).toContain('00:01.0');
      expect(prompt).toContain('00:15.0');
      expect(prompt).toContain('continuity between frames');
    });

    it('omits the duration fragment when durationMs is missing', () => {
      const { prompt } = assembler.build({
        config: baseConfig(),
        knownPersons: [],
        videoContext: { cols: 1, rows: 2, timestampsMs: [500, 4500] },
      });
      expect(prompt).toContain('composite 1x2 grid of 2 frames');
      expect(prompt).not.toContain('of length ');
    });
  });

  describe('advanced mode', () => {
    it('uses raw prompt template verbatim with placeholders substituted', () => {
      const { prompt } = assembler.build({
        config: baseConfig({
          advanced: {
            enabled: true,
            rawPromptTemplate: 'CUSTOM TEMPLATE\n{schema}\n{style_hint}',
            placeholderValidation: 'strict',
          },
        }),
        knownPersons: [],
      });
      expect(prompt).toMatch(/^CUSTOM TEMPLATE/);
      expect(prompt).toContain('"description"');
    });

    it('strict validation: throws when {schema} placeholder is missing', () => {
      expect(() =>
        assembler.build({
          config: baseConfig({
            advanced: {
              enabled: true,
              rawPromptTemplate: 'NO SCHEMA HERE {names}',
              placeholderValidation: 'strict',
            },
          }),
          knownPersons: [],
        }),
      ).toThrow(/schema/);
    });

    it('warn validation: builds and returns warning flag instead of throwing', () => {
      const { prompt, warnings } = assembler.build({
        config: baseConfig({
          advanced: {
            enabled: true,
            rawPromptTemplate: 'NO SCHEMA HERE {names}',
            placeholderValidation: 'warn',
          },
        }),
        knownPersons: [],
      });
      expect(prompt).toContain('NO SCHEMA HERE');
      expect(warnings).toContain('missing-schema-placeholder');
    });
  });
});
