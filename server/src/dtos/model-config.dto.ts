import { createZodDto } from 'nestjs-zod';
import { MachineLearningHardwareAcceleration, MachineLearningHardwareAccelerationSchema } from 'src/enum';
import z from 'zod';

const TaskConfigSchema = z
  .object({
    enabled: z.boolean().describe('Whether the task is enabled'),
  })
  .meta({ id: 'TaskConfig' });

const ModelConfigSchema = TaskConfigSchema.extend({
  modelName: z.string().describe('Name of the model to use'),
});

const ZeroShotTaggingConfigSchema = z
  .object({
    enabled: z.boolean().describe('Whether zero-shot auto-tagging is enabled'),
    minSimilarity: z
      .number()
      .meta({ format: 'double' })
      .min(0)
      .max(1)
      .describe('Cosine similarity above which a label is applied as a tag'),
    maxTags: z.int().min(1).max(20).describe('Maximum number of zero-shot tags applied per asset'),
  })
  .meta({ id: 'ZeroShotTaggingConfig' });

export const CLIPConfigSchema = ModelConfigSchema.extend({
  zeroShotTagging: ZeroShotTaggingConfigSchema,
}).meta({ id: 'CLIPConfig' });

export const DuplicateDetectionConfigSchema = TaskConfigSchema.extend({
  maxDistance: z
    .number()
    .meta({ format: 'double' })
    .min(0.001)
    .max(0.1)
    .describe('Maximum distance threshold for duplicate detection'),
  preferOriginalFormat: z
    .boolean()
    .describe(
      'When suggesting which duplicate to keep, prefer native camera originals (RAW, then HEIC/HEIF) over re-encoded formats such as JPG, regardless of file size',
    ),
  enhancedVideo: z
    .object({
      enabled: z.boolean().describe('Whether enhanced video duplicate detection is enabled'),
      frameCount: z.int().min(2).max(8).describe('Number of video frames to sample for duplicate confirmation'),
      minMatchingFrames: z
        .int()
        .min(1)
        .max(8)
        .describe('Minimum matching sampled frames required to confirm a video duplicate'),
      maxDistance: z
        .number()
        .meta({ format: 'double' })
        .min(0.001)
        .max(0.1)
        .describe('Maximum distance threshold for enhanced video duplicate frame matching'),
    })
    .refine(({ frameCount, minMatchingFrames }) => minMatchingFrames <= frameCount, {
      message: 'Minimum matching frames cannot exceed frame count',
      path: ['minMatchingFrames'],
    }),
}).meta({ id: 'DuplicateDetectionConfig' });

export const FacialRecognitionConfigSchema = ModelConfigSchema.extend({
  minScore: z
    .number()
    .meta({ format: 'double' })
    .min(0.1)
    .max(1)
    .describe('Minimum confidence score for face detection'),
  maxDistance: z
    .number()
    .meta({ format: 'double' })
    .min(0.1)
    .max(2)
    .describe('Maximum distance threshold for face recognition'),
  minFaces: z.int().min(1).describe('Minimum number of faces required for recognition'),
}).meta({ id: 'FacialRecognitionConfig' });

export const OcrConfigSchema = ModelConfigSchema.extend({
  maxResolution: z.int().min(1).describe('Maximum resolution for OCR processing'),
  minDetectionScore: z
    .number()
    .meta({ format: 'double' })
    .min(0.1)
    .max(1)
    .describe('Minimum confidence score for text detection'),
  minRecognitionScore: z
    .number()
    .meta({ format: 'double' })
    .min(0.1)
    .max(1)
    .describe('Minimum confidence score for text recognition'),
}).meta({ id: 'OcrConfig' });

const IdentityInjectionSchema = z
  .object({
    enabled: z.boolean().default(true).describe('Inject named-face data into description prompts'),
    maxNames: z.int().min(1).max(20).default(5).describe('Maximum named persons to inject into a single prompt'),
    minFaceConfidence: z
      .number()
      .meta({ format: 'double' })
      .min(0)
      .max(1)
      .default(0.7)
      .describe('Minimum face-recognition confidence required to inject a name'),
  })
  .meta({ id: 'IdentityInjectionConfig' });

const AdvancedPromptSchema = z
  .object({
    enabled: z.boolean().default(false).describe('Use a raw prompt template instead of the structured fields'),
    rawPromptTemplate: z
      .string()
      .default('')
      .describe('Raw prompt template with {names}, {schema}, {vocabulary}, {style_hint} placeholders'),
    placeholderValidation: z
      .enum(['strict', 'warn'])
      .default('strict')
      .describe('Whether missing {schema} placeholder fails save (strict) or warns (warn)'),
  })
  .meta({ id: 'AdvancedPromptConfig' });

export const ImageDescriptionPromptSchema = z
  .object({
    style: z.enum(['terse', 'balanced', 'rich']).default('balanced').describe('Description verbosity preset'),
    sentenceCountTarget: z.int().min(1).max(6).default(3).describe('Target number of sentences in the description'),
    lookFor: z
      .array(z.string())
      .default([
        'brands',
        'signage',
        'screens',
        'documents',
        'uniforms',
        'tools',
        'vehicles',
        'animals',
        'food',
        'landmarks',
      ])
      .describe('Additional categories the model should note when visibly supported (brands, sports equipment, etc.)'),
    customVocabulary: z.array(z.string()).default([]).describe('Tag values the model should prefer when applicable'),
    customInstructions: z
      .string()
      .max(2000)
      .default('')
      .describe(
        'Free-form additional natural-language instructions appended to the description prompt. Example: "If you see a car, identify the make and model. If people are playing a sport, name the sport."',
      ),
    nsfwIndicators: z
      .array(z.string())
      .default([
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
      ])
      .describe('Allow-list of explicit NSFW indicator terms permitted in the description'),
    medicalIndicators: z
      .array(z.string())
      .default([
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
      ])
      .describe('Allow-list of medical indicator terms permitted in the description'),
    forbiddenInferences: z
      .array(z.string())
      .default(['diagnoses', 'medication names', 'procedures', 'pregnancy', 'disability'])
      .describe('Categories the model must not infer (diagnoses, medications, etc.)'),
    identityInjection: IdentityInjectionSchema.default(() => IdentityInjectionSchema.parse({})).describe(
      'Named-face injection configuration',
    ),
    advanced: AdvancedPromptSchema.default(() => AdvancedPromptSchema.parse({})).describe(
      'Advanced raw-prompt-editor configuration',
    ),
  })
  .meta({ id: 'ImageDescriptionPromptConfig' });

export const ImageDescriptionConfigSchema = ModelConfigSchema.extend({
  acceleration: MachineLearningHardwareAccelerationSchema.default(MachineLearningHardwareAcceleration.Auto).describe(
    'Hardware acceleration backend to use',
  ),
  fallbackModelName: z.string().describe('Name of the fallback model to use'),
  device: z.string().describe('Hardware device to use'),
  prompt: ImageDescriptionPromptSchema.default(() => ImageDescriptionPromptSchema.parse({})),
  pendingRequeueAt: z
    .string()
    .nullable()
    .default(null)
    .describe(
      'ISO timestamp set when an admin defers a re-queue from the cost modal. Cleared when the re-queue actually dispatches. Drives the persistent "re-queue pending" banner.',
    ),
  lastConfigChangeAt: z
    .string()
    .nullable()
    .default(null)
    .describe(
      'ISO timestamp of the last meaningful imageDescription config change. Set server-side; ignored on inbound writes (server is the source of truth).',
    ),
}).meta({ id: 'ImageDescriptionConfig' });

export const NsfwDetectionConfigSchema = ModelConfigSchema.extend({
  threshold: z
    .number()
    .meta({ format: 'double' })
    .min(0.01)
    .max(1)
    .describe('Minimum score required to mark an image as NSFW'),
  device: z.string().describe('Hardware device to use'),
  hideFromLibrary: z
    .boolean()
    .describe('Hide NSFW assets from library views unless the session has PIN-elevated access'),
}).meta({ id: 'NsfwDetectionConfig' });

export class CLIPConfig extends createZodDto(CLIPConfigSchema) {}
