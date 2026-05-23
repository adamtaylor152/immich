import { Injectable } from '@nestjs/common';
import { ImageDescriptionPromptSchema } from 'src/dtos/model-config.dto';
import { z } from 'zod';

export type ImageDescriptionPromptConfig = z.infer<typeof ImageDescriptionPromptSchema>;

export interface KnownPerson {
  name: string;
  /**
   * Per-face confidence score in [0,1]. Currently always 1.0 because Immich's
   * schema does not store a per-face recognition score; named faces are taken
   * as user-curated ground truth. The minFaceConfidence config still acts as
   * an enable/disable knob (set to >1.0 to suppress all identity hints
   * without disabling identityInjection.enabled).
   */
  faceConfidence: number;
  boxCenter: [number, number]; // normalized [0,1] x/y
}

export interface AssembledPrompt {
  prompt: string;
  expectedSchemaVersion: string;
  warnings: string[];
}

const SCHEMA_VERSION = '2026-05-22';

// KEEP IN SYNC WITH: machine-learning/immich_ml/models/image_description.py
// (the JSON schema portion of IMAGE_DESCRIPTION_PROMPT)
const JSON_SCHEMA_BLOCK = `Return valid JSON with this schema:

{
  "description": "Two or three factual sentences about the main subject, activity, environment, and visible objects.",
  "people": [
    {
      "count": 1,
      "apparent_age_group": "adult | young adult | teenager | child | older adult | unknown",
      "activity": "visible activity",
      "confidence": "low | medium | high"
    }
  ],
  "environment": "indoor office, outdoor street, kitchen, store, vehicle interior, etc.",
  "objects": ["object1", "object2", "object3"],
  "visible_text": ["text visible in image, if any"],
  "context": "brief inferred context, only if visually supported",
  "tags": ["tag1", "tag2", "tag3"],
  "safety": {
    "is_nsfw_likely": false,
    "confidence": "low | medium | high",
    "indicators": ["visible adult nudity, sexual activity, restraint, etc."],
    "reason": "brief visual evidence for the NSFW assessment"
  },
  "medical": {
    "is_medical_likely": false,
    "confidence": "low | medium | high",
    "indicators": ["visible medical setting, device, object, or body state"],
    "reason": "brief visual evidence for the medical assessment"
  }
}`;

@Injectable()
export class ImageDescriptionPromptAssembler {
  build(input: {
    config: ImageDescriptionPromptConfig;
    knownPersons: KnownPerson[];
    nsfw?: { isNsfw: boolean } | null;
  }): AssembledPrompt {
    const { config, knownPersons, nsfw } = input;

    if (config.advanced.enabled) {
      return this.buildFromTemplate(config, knownPersons, nsfw);
    }

    const sections: string[] = [this.roleLine()];

    const identityHint = this.identityHint(config, knownPersons);
    if (identityHint) {
      sections.push(identityHint);
    }

    sections.push(this.styleHint(config));

    if (config.lookFor.length > 0) {
      sections.push(this.lookForHint(config.lookFor));
    }
    if (config.customVocabulary.length > 0) {
      sections.push(this.vocabularyHint(config.customVocabulary));
    }

    sections.push(
      JSON_SCHEMA_BLOCK,
      this.safetyRules(config.nsfwIndicators),
      this.medicalRules(config.medicalIndicators, config.forbiddenInferences),
      this.standardRules(),
    );

    if (nsfw?.isNsfw) {
      sections.push(this.nsfwReinforcement(config.nsfwIndicators));
    }

    return { prompt: sections.join('\n\n'), expectedSchemaVersion: SCHEMA_VERSION, warnings: [] };
  }

  private buildFromTemplate(
    config: ImageDescriptionPromptConfig,
    knownPersons: KnownPerson[],
    nsfw?: { isNsfw: boolean } | null,
  ): AssembledPrompt {
    const template = config.advanced.rawPromptTemplate;
    const warnings: string[] = [];

    if (!template.includes('{schema}')) {
      if (config.advanced.placeholderValidation === 'strict') {
        throw new Error('Raw prompt template is missing required {schema} placeholder.');
      }
      warnings.push('missing-schema-placeholder');
    }

    const names = this.identityHint(config, knownPersons) ?? '';
    const styleHint = this.styleHint(config);
    const vocabulary = config.customVocabulary.length > 0 ? this.vocabularyHint(config.customVocabulary) : '';

    let prompt = template
      .replaceAll('{names}', names)
      .replaceAll('{schema}', JSON_SCHEMA_BLOCK)
      .replaceAll('{style_hint}', styleHint)
      .replaceAll('{vocabulary}', vocabulary);

    if (nsfw?.isNsfw) {
      prompt = `${prompt}\n\n${this.nsfwReinforcement(config.nsfwIndicators)}`;
    }

    return { prompt, expectedSchemaVersion: SCHEMA_VERSION, warnings };
  }

  private roleLine(): string {
    return 'You are generating a concise searchable image record from computer vision outputs.\n\nUse only visible evidence from the image. If estimating age, use broad apparent age groups only, such as baby, child, teenager, young adult, adult, older adult, or unknown.';
  }

  private identityHint(config: ImageDescriptionPromptConfig, persons: KnownPerson[]): string | null {
    if (!config.identityInjection.enabled) {
      return null;
    }
    const eligible = persons
      .filter((p) => p.faceConfidence >= config.identityInjection.minFaceConfidence)
      .slice(0, config.identityInjection.maxNames);
    if (eligible.length === 0) {
      return null;
    }
    const lines = eligible.map((p) => `- ${p.name} (${this.positionLabel(p.boxCenter)})`);
    return `Known people detected in this image (use these names when describing them; do not invent names):\n${lines.join('\n')}`;
  }

  private positionLabel(box: [number, number]): string {
    const [x, y] = box;
    const col = x < 1 / 3 ? 'left' : x < 2 / 3 ? 'center' : 'right';
    const row = y < 1 / 3 ? 'top' : y < 2 / 3 ? 'middle' : 'bottom';
    if (row === 'middle' && col === 'center') {
      return 'center';
    }
    return `${row}-${col}`;
  }

  private styleHint(config: ImageDescriptionPromptConfig): string {
    switch (config.style) {
      case 'terse': {
        return 'Write one factual sentence capturing the main subject and activity.';
      }
      case 'rich': {
        return `Write ${config.sentenceCountTarget} factual sentences. Capture mood, season or time-of-day when visibly supported, subject, activity, environment, notable objects, and relationships between people.`;
      }
      case 'balanced': {
        return `Write ${config.sentenceCountTarget} factual sentences capturing subject, activity, environment, and notable objects.`;
      }
    }
  }

  private lookForHint(items: string[]): string {
    return `When relevant and visibly supported, note: ${items.join(', ')}.`;
  }

  private vocabularyHint(items: string[]): string {
    return `Prefer these tag values when applicable: ${items.join(', ')}.`;
  }

  private safetyRules(indicators: string[]): string {
    return `If visible evidence supports adult nudity or sexual content, say so factually with terms like ${indicators.join(', ')}. Do not treat bare chest, bed, swimwear, underwear, or ambiguous partial clothing as explicit by itself.`;
  }

  private medicalRules(indicators: string[], forbidden: string[]): string {
    return `If visible evidence supports a medical context, describe visible items such as ${indicators.join(', ')}. Do not infer ${forbidden.join(', ')} unless plainly visible as generic text or objects.`;
  }

  private nsfwReinforcement(indicators: string[]): string {
    return `The dedicated NSFW classifier flagged this image. Re-check the image visually. If visible evidence supports it, include specific factual NSFW reasons in the description, tags, and safety.indicators, such as ${indicators.join(', ')}. If apparent age is uncertain around NSFW content, use conservative tags such as nsfw_review rather than explicit age claims.`;
  }

  private standardRules(): string {
    return [
      'Rules:',
      '- Return only JSON. Do not wrap the response in markdown or explanatory text.',
      '- Keep the description factual, searchable, and user-friendly. Never put raw JSON or schema text in the description.',
      '- Prefer concrete nouns over vague adjectives.',
      '- Use 8 to 20 tags.',
      '- Tags should be lowercase, short, and useful for search.',
      '- Preserve uncertainty in people fields when needed.',
      '- Avoid moralizing language.',
    ].join('\n');
  }
}
