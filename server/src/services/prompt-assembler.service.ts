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

export interface VideoContext {
  cols: number;
  rows: number;
  timestampsMs: number[];
  durationMs?: number;
}

export interface AssembledPrompt {
  prompt: string;
  expectedSchemaVersion: string;
  warnings: string[];
}

const SCHEMA_VERSION = '2026-05-22';

const ROLE_LINE =
  'You are generating a concise searchable image record from computer vision outputs.\n\nUse only visible evidence from the image. If estimating age, use broad apparent age groups only, such as baby, child, teenager, young adult, adult, older adult, or unknown.';

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

const STANDARD_RULES = [
  'Rules:',
  '- Return only JSON. Do not wrap the response in markdown or explanatory text.',
  '- Keep the description factual, searchable, and user-friendly. Never put raw JSON or schema text in the description.',
  '- Prefer concrete nouns over vague adjectives.',
  '- Use 8 to 20 tags.',
  '- Tags should be lowercase, short, and useful for search.',
  '- Preserve uncertainty in people fields when needed.',
  '- Avoid moralizing language.',
].join('\n');

const safetyRulesText = (indicators: string[]) =>
  `If visible evidence supports adult nudity or sexual content, say so factually with terms like ${indicators.join(', ')}. Do not treat bare chest, bed, swimwear, underwear, or ambiguous partial clothing as explicit by itself.`;

const medicalRulesText = (indicators: string[], forbidden: string[]) =>
  `If visible evidence supports a medical context, describe visible items such as ${indicators.join(', ')}. Do not infer ${forbidden.join(', ')} unless plainly visible as generic text or objects.`;

const DEFAULT_NSFW_INDICATORS = [
  'adult-nudity',
  'bare-buttocks',
  'bondage',
  'explicit',
  'exposed-genitals',
  'naked',
  'nsfw',
  'nudity',
  'restraint',
  'sex-toy',
  'sexual-activity',
];

const DEFAULT_MEDICAL_INDICATORS = [
  'bandage',
  'cast',
  'crutches',
  'exam-table',
  'hospital',
  'iv-line',
  'lab-result',
  'medical',
  'medical-monitor',
  'medical-paperwork',
  'mobility-aid',
  'pill-organizer',
  'prescription',
  'syringe',
  'ultrasound',
  'wheelchair',
  'wound',
  'x-ray',
];

const DEFAULT_FORBIDDEN_INFERENCES = ['diagnoses', 'medication names', 'procedures', 'pregnancy', 'disability'];

/**
 * Canonical default raw-prompt template. Surfaced to the admin UI as the
 * pre-fill payload when an admin enables advanced (raw template) mode, so they
 * have a working starting point instead of an empty box. Uses defaults for the
 * configurable indicator lists — admins editing the raw template are
 * intentionally bypassing the structured fields.
 */
export const DEFAULT_RAW_PROMPT_TEMPLATE = [
  ROLE_LINE,
  '{names}',
  '{style_hint}',
  '{vocabulary}',
  JSON_SCHEMA_BLOCK,
  safetyRulesText(DEFAULT_NSFW_INDICATORS),
  medicalRulesText(DEFAULT_MEDICAL_INDICATORS, DEFAULT_FORBIDDEN_INFERENCES),
  STANDARD_RULES,
].join('\n\n');

const formatTimestamp = (ms: number): string => {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toFixed(1).padStart(4, '0')}`;
};

const videoContextHint = (ctx: VideoContext): string => {
  const cellCount = ctx.cols * ctx.rows;
  const timestamps = ctx.timestampsMs.map(formatTimestamp).join(', ');
  const durationFragment = ctx.durationMs ? ` of length ${formatTimestamp(ctx.durationMs)}` : '';
  return [
    `This image is a composite ${ctx.cols}x${ctx.rows} grid of ${cellCount} frames sampled from a video${durationFragment}.`,
    `The grid is read left-to-right, top-to-bottom; cell timestamps in order are: ${timestamps}.`,
    'Treat each cell as a frame from the same video, not as separate scenes. Describe the overall video — its subject, activity over time, and continuity between frames — not each frame in isolation. When motion or change is visible across cells, mention it.',
  ].join(' ');
};

@Injectable()
export class ImageDescriptionPromptAssembler {
  build(input: {
    config: ImageDescriptionPromptConfig;
    knownPersons: KnownPerson[];
    nsfw?: { isNsfw: boolean } | null;
    videoContext?: VideoContext;
  }): AssembledPrompt {
    const { config, knownPersons, nsfw, videoContext } = input;

    if (config.advanced.enabled) {
      return this.buildFromTemplate(config, knownPersons, nsfw, videoContext);
    }

    const sections: string[] = [ROLE_LINE];

    if (videoContext) {
      sections.push(videoContextHint(videoContext));
    }

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
    if (config.customInstructions.trim().length > 0) {
      sections.push(this.customInstructionsHint(config.customInstructions));
    }

    sections.push(
      JSON_SCHEMA_BLOCK,
      safetyRulesText(config.nsfwIndicators),
      medicalRulesText(config.medicalIndicators, config.forbiddenInferences),
      STANDARD_RULES,
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
    videoContext?: VideoContext,
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

    if (videoContext) {
      prompt = `${videoContextHint(videoContext)}\n\n${prompt}`;
    }

    if (nsfw?.isNsfw) {
      prompt = `${prompt}\n\n${this.nsfwReinforcement(config.nsfwIndicators)}`;
    }

    return { prompt, expectedSchemaVersion: SCHEMA_VERSION, warnings };
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
    return [
      'Identity (REQUIRED — failure to follow this is a top error):',
      'Known people detected in this image. You MUST refer to each of these people by name at least once in the description. Do NOT replace them with generic group nouns such as "a family", "a group", "people", "everyone", or "the kids" — use the listed names instead. Do not invent names not in this list.',
      lines.join('\n'),
    ].join('\n');
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

  private customInstructionsHint(text: string): string {
    return `Additional instructions:\n${text.trim()}`;
  }

  private nsfwReinforcement(indicators: string[]): string {
    return `The dedicated NSFW classifier flagged this image. Re-check the image visually. If visible evidence supports it, include specific factual NSFW reasons in the description, tags, and safety.indicators, such as ${indicators.join(', ')}. If apparent age is uncertain around NSFW content, use conservative tags such as nsfw_review rather than explicit age claims.`;
  }
}
