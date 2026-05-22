import { ImageDescriptionPromptAssembler } from 'src/services/prompt-assembler.service';
import type { ImageDescriptionPromptConfig } from 'src/services/prompt-assembler.service';
import { describe, expect, it } from 'vitest';

const baseConfig = (overrides: Partial<ImageDescriptionPromptConfig> = {}): ImageDescriptionPromptConfig => ({
  style: 'balanced',
  sentenceCountTarget: 3,
  lookFor: [],
  customVocabulary: [],
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
