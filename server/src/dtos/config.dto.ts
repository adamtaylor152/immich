import { CronExpression } from '@nestjs/schedule';
import { validateCronExpression } from 'cron';
import { createZodDto } from 'nestjs-zod';
import {
  AudioCodec,
  AudioCodecSchema,
  Colorspace,
  ColorspaceSchema,
  ConfigVisibility,
  CQMode,
  CQModeSchema,
  HlsVideoResolution,
  HlsVideoResolutionSchema,
  ImageFormat,
  ImageFormatSchema,
  LogLevel,
  LogLevelSchema,
  MachineLearningHardwareAcceleration,
  MachineLearningHardwareAccelerationSchema,
  OAuthTokenEndpointAuthMethod,
  OAuthTokenEndpointAuthMethodSchema,
  ReleaseChannel,
  ReleaseChannelSchema,
  ToneMapping,
  ToneMappingSchema,
  TranscodeHardwareAcceleration,
  TranscodeHardwareAccelerationSchema,
  TranscodePolicy,
  TranscodePolicySchema,
  VideoCodec,
  VideoCodecSchema,
  VideoContainer,
  VideoContainerSchema,
} from 'src/enum';
import { DeepPartial } from 'src/types';
import z from 'zod';

const { Admin, User, Public } = ConfigVisibility;

const configBool = z
  .preprocess(
    (val) => z.stringbool({ truthy: ['true'], falsy: ['false'], case: 'sensitive' }).safeParse(val).data ?? val,
    z.boolean(),
  )

  .nonoptional()
  .meta({ type: 'boolean' });

const cronExpressionSchema = z
  .string()
  .superRefine((value, ctx) => {
    const validated = validateCronExpression(value);
    if (!validated.valid) {
      ctx.addIssue({
        code: 'custom',
        message: `Invalid cron expression. ${validated.error?.message ?? ''}`,
        input: value,
      });
    }
  })
  .describe('Cron expression');

const emptyOrUrl = (error: string) =>
  z.string().refine((url) => url.length === 0 || z.url().safeParse(url).success, { error });

const AdminConfigIntegrityJobSchema = z
  .object({
    enabled: z.boolean().describe('Enabled'),
    cronExpression: cronExpressionSchema.describe('Cron expression for when the integrity check should run'),
  })
  .describe('Integrity job config')
  .meta({ id: 'AdminConfigIntegrityJobDto' });

const AdminConfigJobSettingsSchema = z
  .object({ concurrency: z.int().min(1).describe('Concurrency') })
  .meta({ id: 'AdminConfigJobSettingsDto' });

const AdminConfigMachineLearningTaskSchema = z.object({
  enabled: z.boolean().describe('Whether the task is enabled').meta({ visibility: User }),
});

const AdminConfigMachineLearningModelSchema = AdminConfigMachineLearningTaskSchema.extend({
  modelName: z.string().describe('Name of the model to use'),
});

// Fork defaults that are also used as schema-level `.default()` values. They
// are hoisted as standalone constants (instead of referencing `defaults`)
// because `defaults` is typed by the schema itself — referencing it from a
// schema initializer would make the SystemConfig type circular.
const imageDescriptionDefaults = {
  enabled: true,
  acceleration: MachineLearningHardwareAcceleration.Auto,
  modelName: 'Qwen/Qwen2.5-VL-3B-Instruct',
  fallbackModelName: 'microsoft/Florence-2-base-ft',
  device: 'AUTO',
  prompt: {
    style: 'balanced' as const,
    sentenceCountTarget: 3,
    lookFor: [
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
    ],
    customVocabulary: [],
    customInstructions: '',
    nsfwIndicators: [
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
    ],
    medicalIndicators: [
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
    ],
    forbiddenInferences: ['diagnoses', 'medication names', 'procedures', 'pregnancy', 'disability'],
    identityInjection: { enabled: true, maxNames: 5, minFaceConfidence: 0.7 },
    advanced: { enabled: false, rawPromptTemplate: '', placeholderValidation: 'strict' as const },
  },
  pendingRequeueAt: null,
  lastConfigChangeAt: null,
};

const nsfwDetectionDefaults = {
  enabled: false,
  modelName: 'onnx-community/nsfw_image_detection-ONNX',
  threshold: 0.85,
  device: 'AUTO',
  hideFromLibrary: false,
};

const runpodServerlessDefaults = {
  // GPU **pool IDs** (not specific types). RunPod's serverless API
  // accepts AMPERE_16, AMPERE_24, ADA_24, AMPERE_48, ADA_48_PRO,
  // AMPERE_80, ADA_80_PRO, HOPPER_141, ADA_32_PRO, BLACKWELL_96,
  // BLACKWELL_180.
  //
  // Defaults target Qwen2.5-VL-9B image description at fp16 (~24 GB
  // weights + activations). 48 GB pools (A40/A6000, L40/L40S) leave
  // headroom; 80 GB (A100, H100) is the fallback for availability.
  // Smaller pools work for CLIP/face/OCR but Qwen 9B will OOM there.
  // See https://docs.runpod.io/references/gpu-types#gpu-pools.
  gpuTypeIds: ['AMPERE_48', 'ADA_48_PRO', 'AMPERE_80'],
  workersMin: 0,
  workersMax: 3,
  idleTimeoutSeconds: 30,
  executionTimeoutMs: 600_000,
  // LB endpoints have no queue, so REQUEST_COUNT is the only meaningful
  // scaler. RunPod silently accepts QUEUE_DELAY for LB but it's a no-op.
  scalerType: 'REQUEST_COUNT' as const,
  scalerValue: 4,
};

const runpodDefaults = {
  enabled: false,
  mode: 'disabled' as const,
  apiKey: '',
  hfToken: '',
  imageName: 'ghcr.io/adamtaylor152/immich-machine-learning:fork-main-cuda-runpod',
  dataPrivacyAcknowledged: false,
  defaultGpuTypeId: 'NVIDIA RTX A5000',
  containerDiskGb: 50,
  volumeGb: 20,
  autoStopEnabled: true,
  autoStopGraceMinutes: 15,
  autoBackfillOnLaunch: false,
  maxRuntimeHours: 24,
  provisionTimeoutMinutes: 5,
  serverless: runpodServerlessDefaults,
};

const smartAlbumsDefaults = {
  enabled: false,
  builtIn: {
    travel: {
      enabled: true,
      name: 'Travel',
      tagTriggers: ['airport', 'beach', 'mountain', 'landmark', 'hotel', 'passport', 'suitcase', 'tourist'],
      clipQueries: ['vacation travel landscape', 'tourist destination'],
      threshold: 0.28,
    },
    documents: {
      enabled: true,
      name: 'Documents & Receipts',
      tagTriggers: ['receipt', 'document', 'invoice', 'paperwork', 'scan', 'id-card'],
      clipQueries: ['paper document', 'receipt or invoice'],
      threshold: 0.28,
    },
    screenshots: {
      enabled: true,
      name: 'Screenshots',
      tagTriggers: ['screenshot', 'ui', 'screen-capture', 'user-interface'],
      clipQueries: ['phone or computer screenshot'],
      threshold: 0.28,
    },
    food: {
      enabled: true,
      name: 'Food',
      tagTriggers: ['food', 'meal', 'dish', 'restaurant', 'plate', 'cooking'],
      clipQueries: ['plated food meal', 'restaurant dish'],
      threshold: 0.28,
    },
    pets: {
      enabled: true,
      name: 'Pets',
      tagTriggers: ['pet', 'dog', 'cat', 'puppy', 'kitten'],
      clipQueries: ['domestic pet animal'],
      threshold: 0.28,
    },
    nature: {
      enabled: true,
      name: 'Nature',
      tagTriggers: ['nature', 'forest', 'mountain', 'ocean', 'sunset', 'wildlife', 'flower'],
      clipQueries: ['natural landscape', 'wildlife'],
      threshold: 0.28,
    },
  },
};

const AdminConfigZeroShotTaggingSchema = z
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
  .meta({ id: 'AdminConfigZeroShotTaggingDto' });

export const CLIPConfigSchema = AdminConfigMachineLearningModelSchema.extend({
  zeroShotTagging: AdminConfigZeroShotTaggingSchema,
}).meta({ id: 'AdminConfigClipDto' });

export const DuplicateDetectionConfigSchema = AdminConfigMachineLearningTaskSchema.extend({
  maxDistance: z
    .number()
    .min(0.001)
    .max(0.1)
    .describe('Maximum distance threshold for duplicate detection')
    .meta({ format: 'double' }),
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
    .meta({ id: 'AdminConfigEnhancedVideoDuplicateDetectionDto' })
    .refine(({ frameCount, minMatchingFrames }) => minMatchingFrames <= frameCount, {
      message: 'Minimum matching frames cannot exceed frame count',
      path: ['minMatchingFrames'],
    }),
}).meta({ id: 'AdminConfigDuplicateDetectionDto' });

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
  .meta({ id: 'AdminConfigIdentityInjectionDto' });

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
  .meta({ id: 'AdminConfigAdvancedPromptDto' });

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
  .meta({ id: 'AdminConfigImageDescriptionPromptDto' });

export const ImageDescriptionConfigSchema = AdminConfigMachineLearningModelSchema.extend({
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
}).meta({ id: 'AdminConfigImageDescriptionDto' });

export const NsfwDetectionConfigSchema = AdminConfigMachineLearningModelSchema.extend({
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
}).meta({ id: 'AdminConfigNsfwDetectionDto' });

const AdminConfigRunPodServerlessSchema = z
  .object({
    gpuTypeIds: z
      .array(z.string())
      .min(1)
      .describe('Ranked GPU pool IDs the endpoint can use (cheapest first). At least one required.'),
    workersMin: z.int().min(0).max(10).describe('Always-warm workers (0 = scale to zero)'),
    workersMax: z.int().min(1).max(20).describe('Max concurrent workers'),
    idleTimeoutSeconds: z.int().min(5).max(3600).describe('Seconds before an idle worker scales down'),
    executionTimeoutMs: z.int().min(5000).max(3_600_000).describe('Max time per request (ms)'),
    scalerType: z.enum(['QUEUE_DELAY', 'REQUEST_COUNT']).describe('Worker autoscaler strategy'),
    scalerValue: z.int().min(1).max(60).describe('Scaler threshold (queue seconds or request count)'),
  })
  .meta({ id: 'AdminConfigRunPodServerlessDto' })
  // Cross-field guard — reject configs where workersMin > workersMax instead
  // of letting RunPod's endpoint create fail at provisioning time with a less
  // obvious error.
  .refine((data) => data.workersMax >= data.workersMin, {
    message: 'workersMax must be greater than or equal to workersMin',
    path: ['workersMax'],
  });

const AdminConfigRunPodSchema = z
  .object({
    enabled: configBool.describe('Enabled'),
    // Optional in the wire DTO so older clients that don't know about the
    // discriminator can still PUT the legacy shape. Server back-compat
    // infers the effective mode from `enabled` when this is undefined or
    // 'disabled' (see `effectiveMode` in runpod.service.ts).
    mode: z
      .enum(['disabled', 'pod', 'serverless'])
      .default('disabled')
      .describe(
        'disabled = off, pod = manually launched dedicated GPU, serverless = auto-managed scale-to-zero endpoint. Optional for back-compat with legacy clients.',
      ),
    // apiKey is a billing credential. mapAdminConfig() redacts it to '' on
    // every GET response, and updateAdminConfig() interprets an empty incoming
    // value as "preserve the stored key" (rather than "wipe it"). Net effect:
    // the secret is never returned by the API once set, and admin form
    // round-trips don't accidentally erase it. To rotate, send a new
    // non-empty value.
    //
    // We intentionally do NOT use `.meta({ writeOnly: true })`: although the
    // OpenAPI semantics are correct, oazapfts removes write-only fields from
    // the generated TypeScript type entirely, which breaks the admin form's
    // ability to bind to the field as an input. The masking + preserve
    // pattern above achieves the same security guarantee at the application
    // layer.
    apiKey: z.string().describe('RunPod API key (write-only; empty preserves the existing key)'),
    apiKeyConfigured: z
      .boolean()
      .optional()
      .describe('Read-only indicator that a key is currently stored. Set by the server; ignored on write.'),
    // Same redact/preserve pattern as apiKey. Forwarded to the ML worker as
    // HF_TOKEN so it can pull gated/large HuggingFace models (Qwen-VL etc.)
    // without rate-limit hits. Optional — empty string disables forwarding.
    hfToken: z
      .string()
      .default('')
      .describe('HuggingFace token forwarded to worker as HF_TOKEN (write-only; empty preserves the existing token)'),
    hfTokenConfigured: z
      .boolean()
      .optional()
      .describe('Read-only indicator that an HF token is currently stored. Set by the server; ignored on write.'),
    imageName: z.string().min(1).describe('Container image to launch'),
    dataPrivacyAcknowledged: configBool.describe('User accepted that image previews leave the network'),
    // Pod-mode settings
    defaultGpuTypeId: z.string().min(1).describe('Preferred GPU type ID (Pod mode)'),
    containerDiskGb: z.int().min(10).max(2000).describe('Container disk size (GB) (Pod mode)'),
    volumeGb: z.int().min(0).max(2000).describe('Persistent volume size (GB) (Pod mode)'),
    autoStopEnabled: configBool.describe('Auto-stop when idle (Pod mode)'),
    autoStopGraceMinutes: z.int().min(1).max(1440).describe('Idle minutes before auto-stop (Pod mode)'),
    autoBackfillOnLaunch: configBool.describe('Auto-run ML backfill on pod ready (Pod mode)'),
    maxRuntimeHours: z.int().min(1).max(168).describe('Hard runtime ceiling (hours) (Pod mode)'),
    provisionTimeoutMinutes: z
      .int()
      .min(1)
      .max(60)
      .default(5)
      .describe('How long to wait for the pod to reach RUNNING + healthy /ping before giving up (Pod mode)'),
    // Serverless-mode settings
    serverless: AdminConfigRunPodServerlessSchema.default(runpodServerlessDefaults),
  })
  .meta({ id: 'AdminConfigRunPodDto' });

// Admin-controlled but unbounded strings flow into background-job log lines
// and the smart-album evaluator. Cap to 256 chars and reject control characters
// (CWE-117 log injection hardening + general defensive bound).
// eslint-disable-next-line no-control-regex
const SMART_ALBUM_STRING_CONTROL_PATTERN = /[\u{0000}-\u{001F}\u{007F}]/u;
const smartAlbumString = z
  .string()
  .max(256, { error: 'String must be 256 characters or fewer' })
  .refine((value) => !SMART_ALBUM_STRING_CONTROL_PATTERN.test(value), {
    error: 'String cannot contain control characters or newlines',
  });

const SmartAlbumKindSchema = z
  .object({
    enabled: configBool.describe('Whether this smart album is active'),
    name: smartAlbumString.describe('User-visible album name'),
    tagTriggers: z.array(smartAlbumString).describe('Tags that mark an asset as belonging to this album'),
    clipQueries: z.array(smartAlbumString).describe('CLIP query phrases used when no tag trigger matches'),
    threshold: z.number().meta({ format: 'double' }).min(0).max(1).describe('CLIP similarity threshold'),
  })
  .meta({ id: 'AdminConfigSmartAlbumKindDto' });

const AdminConfigSmartAlbumsSchema = z
  .object({
    enabled: configBool.describe('Master smart-album enabled toggle'),
    builtIn: z
      .object({
        travel: SmartAlbumKindSchema,
        documents: SmartAlbumKindSchema,
        screenshots: SmartAlbumKindSchema,
        food: SmartAlbumKindSchema,
        pets: SmartAlbumKindSchema,
        nature: SmartAlbumKindSchema,
      })
      .meta({ id: 'AdminConfigSmartAlbumBuiltInDto' }),
  })
  .meta({ id: 'AdminConfigSmartAlbumsDto' });

const AdminConfigGeneratedImageSchema = z
  .object({
    format: ImageFormatSchema,
    quality: z.int().min(1).max(100).describe('Quality'),
    size: z.int().min(1).describe('Size').meta({ visibility: User }),
    progressive: configBool.default(false).optional().describe('Progressive'),
  })
  .meta({ id: 'AdminConfigGeneratedImageDto' });

const AdminConfigFFmpegSchema = z
  .object({
    crf: z.coerce.number().int().min(0).max(51).describe('CRF'),
    threads: z.coerce.number().int().min(0).describe('Threads'),
    preset: z.string().describe('Preset'),
    targetVideoCodec: VideoCodecSchema,
    acceptedVideoCodecs: z.array(VideoCodecSchema).describe('Accepted video codecs'),
    targetAudioCodec: AudioCodecSchema,
    acceptedAudioCodecs: z.array(AudioCodecSchema).describe('Accepted audio codecs'),
    acceptedContainers: z.array(VideoContainerSchema).describe('Accepted containers'),
    targetResolution: z.string().describe('Target resolution'),
    maxBitrate: z.string().describe('Max bitrate'),
    bframes: z.coerce.number().int().min(-1).max(16).describe('B-frames'),
    refs: z.coerce.number().int().min(0).max(6).describe('References'),
    gopSize: z.coerce.number().int().min(0).describe('GOP size'),
    temporalAQ: configBool.describe('Temporal AQ'),
    cqMode: CQModeSchema,
    twoPass: configBool.describe('Two pass'),
    preferredHwDevice: z.string().describe('Preferred hardware device'),
    transcode: TranscodePolicySchema,
    accel: TranscodeHardwareAccelerationSchema,
    accelDecode: configBool.describe('Accelerated decode'),
    tonemap: ToneMappingSchema,
    realtime: z
      .object({
        enabled: configBool.describe('Enable real-time HLS transcoding (alpha)').meta({ visibility: User }),
        videoCodecs: z
          .array(VideoCodecSchema)
          .describe('Video codecs to use for real-time HLS transcoding')
          .meta({ visibility: User }),
        resolutions: z
          .array(HlsVideoResolutionSchema)
          .describe('Resolutions to use for real-time HLS transcoding')
          .meta({ visibility: User }),
      })
      .meta({ id: 'AdminConfigFFmpegRealtimeDto' }),
  })
  .meta({ id: 'AdminConfigFFmpegDto' });

const AdminConfigSmtpSchema = z
  .object({
    enabled: configBool.describe('Whether SMTP email notifications are enabled'),
    from: z.string().describe('Email address to send from'),
    replyTo: z.string().describe('Email address for replies'),
    transport: z
      .object({
        ignoreCert: configBool.describe('Whether to ignore SSL certificate errors'),
        host: z.string().describe('SMTP server hostname'),
        port: z.int().min(0).max(65_535).describe('SMTP server port'),
        secure: configBool.describe('Whether to use secure connection (TLS/SSL)'),
        username: z.string().describe('SMTP username'),
        password: z.string().describe('SMTP password'),
      })
      .meta({ id: 'AdminConfigSmtpTransportDto' }),
  })
  .meta({ id: 'AdminConfigSmtpDto' });

const AdminConfigSchemaWithVisibility = z
  .object({
    backup: z
      .object({
        database: z
          .object({
            enabled: configBool.describe('Enabled'),
            cronExpression: cronExpressionSchema,
            keepLastAmount: z.int().min(1).describe('Keep last amount'),
          })
          .meta({ id: 'AdminConfigDatabaseBackupDto' }),
      })
      .meta({ id: 'AdminConfigBackupsDto' }),
    ffmpeg: AdminConfigFFmpegSchema,
    integrityChecks: z
      .object({
        missingFiles: AdminConfigIntegrityJobSchema,
        untrackedFiles: AdminConfigIntegrityJobSchema,
        checksumFiles: AdminConfigIntegrityJobSchema.extend({
          timeLimit: z.int().nonnegative().describe('How long the integrity checksum job may run for'),
          percentageLimit: z
            .float32()
            .nonnegative()
            .max(1)
            .describe('Percentage limit of the integrity checksum job')
            .meta({ format: 'double' }),
        })
          .describe('Integrity checksum job config')
          .meta({ id: 'AdminConfigIntegrityChecksumJobDto' }),
      })
      .describe('Integrity checks config')
      .meta({ id: 'AdminConfigIntegrityChecksDto' }),
    job: z
      .object({
        thumbnailGeneration: AdminConfigJobSettingsSchema,
        metadataExtraction: AdminConfigJobSettingsSchema,
        videoConversion: AdminConfigJobSettingsSchema,
        faceDetection: AdminConfigJobSettingsSchema,
        smartSearch: AdminConfigJobSettingsSchema,
        videoDuplicateDetection: AdminConfigJobSettingsSchema,
        backgroundTask: AdminConfigJobSettingsSchema,
        migration: AdminConfigJobSettingsSchema,
        search: AdminConfigJobSettingsSchema,
        sidecar: AdminConfigJobSettingsSchema,
        library: AdminConfigJobSettingsSchema,
        notifications: AdminConfigJobSettingsSchema,
        ocr: AdminConfigJobSettingsSchema,
        imageEnrichment: AdminConfigJobSettingsSchema.default({ concurrency: 2 }),
        imageDescription: AdminConfigJobSettingsSchema.default({ concurrency: 2 }),
        nsfwDetection: AdminConfigJobSettingsSchema.default({ concurrency: 2 }),
        mediaHealth: AdminConfigJobSettingsSchema.default({ concurrency: 2 }),
        workflow: AdminConfigJobSettingsSchema,
        editor: AdminConfigJobSettingsSchema,
        integrityCheck: AdminConfigJobSettingsSchema,
      })
      .meta({ id: 'AdminConfigJobDto' }),
    logging: z
      .object({
        enabled: configBool.describe('Enabled'),
        level: LogLevelSchema,
      })
      .meta({ id: 'AdminConfigLoggingDto' }),
    machineLearning: z
      .object({
        enabled: configBool.describe('Enabled').meta({ visibility: User }),
        urls: z.array(z.string()).min(1).describe('ML service URLs'),
        availabilityChecks: z
          .object({
            enabled: configBool.describe('Enabled'),
            timeout: z.int(),
            interval: z.int(),
          })
          .meta({ id: 'AdminConfigMachineLearningAvailabilityChecksDto' }),
        clip: CLIPConfigSchema,
        duplicateDetection: DuplicateDetectionConfigSchema,
        facialRecognition: AdminConfigMachineLearningModelSchema.extend({
          minScore: z
            .number()
            .min(0.1)
            .max(1)
            .describe('Minimum confidence score for face detection')
            .meta({ format: 'double' }),
          maxDistance: z
            .number()
            .min(0.1)
            .max(2)
            .describe('Maximum distance threshold for face recognition')
            .meta({ format: 'double' }),
          minFaces: z
            .int()
            .min(1)
            .describe('Minimum number of faces required for recognition')
            .meta({ visibility: User }),
        }).meta({ id: 'AdminConfigFacialRecognitionDto' }),
        ocr: AdminConfigMachineLearningModelSchema.extend({
          maxResolution: z.int().min(1).describe('Maximum resolution for OCR processing'),
          minDetectionScore: z
            .number()
            .min(0.1)
            .max(1)
            .describe('Minimum confidence score for text detection')
            .meta({ format: 'double' }),
          minRecognitionScore: z
            .number()
            .min(0.1)
            .max(1)
            .describe('Minimum confidence score for text recognition')
            .meta({ format: 'double' }),
        }).meta({ id: 'AdminConfigOcrDto' }),
        imageDescription: ImageDescriptionConfigSchema.default(imageDescriptionDefaults),
        nsfwDetection: NsfwDetectionConfigSchema.default(nsfwDetectionDefaults),
        runpod: AdminConfigRunPodSchema.default(runpodDefaults),
      })
      .meta({ id: 'AdminConfigMachineLearningDto' }),
    map: z
      .object({
        enabled: configBool.describe('Enabled').meta({ visibility: User }),
        lightStyle: z.url().describe('Light map style URL').meta({ visibility: User }),
        darkStyle: z.url().describe('Dark map style URL').meta({ visibility: User }),
      })
      .meta({ id: 'AdminConfigMapDto' }),
    reverseGeocoding: z
      .object({ enabled: configBool.describe('Enabled').meta({ visibility: User }) })
      .meta({ id: 'AdminConfigReverseGeocodingDto' }),
    metadata: z
      .object({
        faces: z.object({ import: configBool.describe('Import') }).meta({ id: 'AdminConfigFacesDto' }),
      })
      .meta({ id: 'AdminConfigMetadataDto' }),
    oauth: z
      .object({
        autoLaunch: configBool.describe('Auto launch').meta({ visibility: Public }),
        autoRegister: configBool.describe('Auto register'),
        buttonText: z.string().describe('Button text').meta({ visibility: Public }),
        clientId: z.string().describe('Client ID'),
        clientSecret: z.string().describe('Client secret'),
        tokenEndpointAuthMethod: OAuthTokenEndpointAuthMethodSchema,
        timeout: z.int().min(1).describe('Timeout'),
        allowInsecureRequests: configBool.describe('Allow insecure requests'),
        defaultStorageQuota: z.int().min(0).nullable().describe('Default storage quota'),
        enabled: configBool.describe('Enabled').meta({ visibility: Public }),
        issuerUrl: emptyOrUrl('Issuer URL must be an empty string or a valid URL').describe('Issuer URL'),
        accountManagementUrl: emptyOrUrl('Account management URL must be an empty string or a valid URL')
          .describe('Account management URL')
          .optional()
          .default(''),
        scope: z.string().describe('Scope'),
        prompt: z.string().describe('OAuth prompt parameter (e.g. select_account, login, consent)'),
        endSessionEndpoint: emptyOrUrl('endSessionEndpoint must be an empty string or a valid URL').describe(
          'End session endpoint',
        ),
        signingAlgorithm: z.string().describe('Signing algorithm'),
        profileSigningAlgorithm: z.string().describe('Profile signing algorithm'),
        storageLabelClaim: z.string().describe('Storage label claim'),
        storageQuotaClaim: z.string().describe('Storage quota claim'),
        roleClaim: z.string().describe('Role claim'),
        mobileOverrideEnabled: configBool.describe('Mobile override enabled'),
        mobileRedirectUri: z.string().describe('Mobile redirect URI (set to empty string to disable)'),
      })
      .transform((value, ctx) => {
        if (!value.mobileOverrideEnabled || value.mobileRedirectUri === '') {
          return value;
        }

        if (!z.url().safeParse(value.mobileRedirectUri).success) {
          ctx.issues.push({
            code: 'custom',
            message: 'Mobile redirect URI must be an empty string or a valid URL',
            input: value.mobileRedirectUri,
          });
          return z.NEVER;
        }

        return value;
      })
      .meta({ id: 'AdminConfigOAuthDto' }),
    passwordLogin: z
      .object({ enabled: configBool.describe('Enabled').meta({ visibility: Public }) })
      .meta({ id: 'AdminConfigPasswordLoginDto' }),
    physicalDeduplication: z
      .object({
        enabled: configBool.describe('Enabled'),
        masterUserId: z.uuidv4().nullable().describe('Master user ID'),
      })
      .meta({ id: 'AdminConfigPhysicalDeduplicationDto' })
      .default({ enabled: false, masterUserId: null }),
    localFeatures: z
      .object({
        askSearch: z
          .object({
            enabled: configBool.describe('Enable local Ask Photos-style search'),
            maxResults: z.int().min(1).max(1000).describe('Maximum number of Ask Search results'),
          })
          .meta({ id: 'AdminConfigAskSearchDto' }),
      })
      .meta({ id: 'AdminConfigLocalFeaturesDto' })
      .default({ askSearch: { enabled: true, maxResults: 100 } }),
    storageTemplate: z
      .object({
        enabled: configBool.describe('Enabled'),
        hashVerificationEnabled: configBool.describe('Hash verification enabled'),
        template: z.string().describe('Template'),
      })
      .meta({ id: 'AdminConfigStorageTemplateDto' }),
    image: z
      .object({
        thumbnail: AdminConfigGeneratedImageSchema,
        preview: AdminConfigGeneratedImageSchema,
        fullsize: z
          .object({
            enabled: configBool.describe('Enabled').meta({ visibility: User }),
            format: ImageFormatSchema,
            quality: z.int().min(1).max(100).describe('Quality'),
            progressive: configBool.default(false).optional().describe('Progressive'),
          })
          .meta({ id: 'AdminConfigGeneratedFullsizeImageDto' }),
        colorspace: ColorspaceSchema,
        extractEmbedded: configBool.describe('Extract embedded'),
        enhancedRaw: z
          .object({
            enabled: configBool.describe('Enhanced RAW rendering'),
          })
          .meta({ id: 'AdminConfigEnhancedRawImageDto' })
          .default({ enabled: true }),
      })
      .meta({ id: 'AdminConfigImageDto' }),
    newVersionCheck: z
      .object({ enabled: configBool.describe('Enabled'), channel: ReleaseChannelSchema })
      .meta({ id: 'AdminConfigNewVersionCheckDto' }),
    nightlyTasks: z
      .object({
        startTime: z.iso
          .time({
            precision: -1,
            error: (iss) => `Invalid input: expected string in HH:MM format, received ${typeof iss.input}`,
          })
          .describe('Start time (HH:MM)'),
        databaseCleanup: configBool.describe('Database cleanup'),
        missingThumbnails: configBool.describe('Missing thumbnails'),
        clusterNewFaces: configBool.describe('Cluster new faces'),
        generateMemories: configBool.describe('Generate memories'),
        syncQuotaUsage: configBool.describe('Sync quota usage'),
      })
      .meta({ id: 'AdminConfigNightlyTasksDto' }),
    trash: z
      .object({
        enabled: configBool.describe('Enabled').meta({ visibility: User }),
        days: z.int().min(0).describe('Days').meta({ visibility: User }),
      })
      .meta({ id: 'AdminConfigTrashDto' }),
    theme: z
      .object({ customCss: z.string().describe('Custom CSS for theming').meta({ visibility: Public }) })
      .meta({ id: 'AdminConfigThemeDto' }),
    library: z
      .object({
        scan: z
          .object({
            enabled: configBool.describe('Enabled'),
            cronExpression: cronExpressionSchema,
          })
          .meta({ id: 'AdminConfigLibraryScanDto' }),
        watch: z.object({ enabled: configBool.describe('Enabled') }).meta({ id: 'AdminConfigLibraryWatchDto' }),
      })
      .meta({ id: 'AdminConfigLibraryDto' }),
    notifications: z.object({ smtp: AdminConfigSmtpSchema }).meta({ id: 'AdminConfigNotificationsDto' }),
    templates: z
      .object({
        email: z
          .object({
            welcomeTemplate: z.string().describe('Welcome template'),
            albumInviteTemplate: z.string().describe('Album invite template'),
            albumUpdateTemplate: z.string().describe('Album update template'),
          })
          .meta({ id: 'AdminConfigTemplateEmailsDto' }),
      })
      .meta({ id: 'AdminConfigTemplatesDto' }),
    server: z
      .object({
        externalDomain: emptyOrUrl('External domain must be an empty string or a valid URL')
          .describe('External domain')
          .meta({ visibility: User }),
        loginPageMessage: z.string().describe('Login page message').meta({ visibility: Public }),
        publicUsers: configBool.describe('Public users').meta({ visibility: User }),
      })
      .meta({ id: 'AdminConfigServerDto' }),
    user: z
      .object({ deleteDelay: z.int().min(1).describe('Delete delay').meta({ visibility: User }) })
      .meta({ id: 'AdminConfigUserDto' }),
    smartAlbums: AdminConfigSmartAlbumsSchema.default(smartAlbumsDefaults),
  })
  .describe('Configuration properties that are visible to the admin')
  .meta({ id: 'AdminConfigDto' });

export type SystemConfig = z.infer<typeof AdminConfigSchemaWithVisibility>;
export type MachineLearningConfig = SystemConfig['machineLearning'];

const visibilities = [Public, User, Admin];

const isVisible = (property: ConfigVisibility, visibility: ConfigVisibility) =>
  visibilities.indexOf(property) <= visibilities.indexOf(visibility);

const getMeta = (schema: z.ZodType) =>
  (z.globalRegistry.get(schema) ?? {}) as { id?: string; description?: string; visibility?: ConfigVisibility };

const unwrap = (schema: z.ZodType) => (schema instanceof z.ZodPipe ? (schema.def.in as z.ZodType) : schema);

const visibleSchemas = new Map<z.ZodType, Map<ConfigVisibility, z.ZodType | undefined>>();

const applyVisibility = (visibility: ConfigVisibility): z.ZodType | undefined => {
  const map: Record<ConfigVisibility, string> = {
    [Admin]: 'Configuration properties that are visible to the admin',
    [User]: 'Configuration properties that are visible to a logged user',
    [Public]: 'Configuration properties that are visible to everyone',
  };

  return applyVisibilityRecursive(AdminConfigSchemaWithVisibility, visibility, map[visibility]);
};

const applyVisibilityRecursive = (
  schema: z.ZodType,
  visibility: ConfigVisibility,
  override?: string,
): z.ZodType | undefined => {
  const object = unwrap(schema);
  const { id, description, visibility: property } = getMeta(schema);

  if (!(object instanceof z.ZodObject)) {
    return isVisible(property ?? Admin, visibility) ? schema : undefined;
  }

  let cache = visibleSchemas.get(schema);
  if (!cache) {
    cache = new Map();
    visibleSchemas.set(schema, cache);
  }

  if (cache.has(visibility)) {
    return cache.get(visibility);
  }

  const shape: Record<string, z.ZodType> = {};
  for (const [key, value] of Object.entries(object.shape as Record<string, z.ZodType>)) {
    const visible = applyVisibilityRecursive(value, visibility);
    if (visible) {
      shape[key] = visible;
    }
  }

  let visible: z.ZodType | undefined;
  if (Object.keys(shape).length > 0) {
    visible = z.object(shape).meta({
      ...(id && { id: `${visibility}${id.slice(Admin.length)}` }),
      ...((override ?? description) && { description: override ?? description }),
    });
  }

  cache.set(visibility, visible);

  return visible;
};

const stripVisibilityMetadata = <T extends z.ZodType>(schema: T): T => {
  const object = unwrap(schema);
  if (object instanceof z.ZodObject) {
    for (const value of Object.values(object.shape as Record<string, z.ZodType>)) {
      stripVisibilityMetadata(value);
    }

    return schema;
  }

  const { visibility, ...meta } = getMeta(schema);
  if (visibility) {
    z.globalRegistry.add(schema, meta);
  }

  return schema;
};

export const AdminConfigSchema = applyVisibility(Admin)! as z.ZodType<SystemConfig>;
const UserConfigSchema = applyVisibility(User)! as z.ZodType<DeepPartial<SystemConfig>>;
const PublicConfigSchema = applyVisibility(Public)! as z.ZodType<DeepPartial<SystemConfig>>;

// prevent visibility metadata from leaking to openapi spec
// eslint-disable-next-line unicorn/no-top-level-side-effects
stripVisibilityMetadata(AdminConfigSchemaWithVisibility);

const ConfigTemplateStorageOptionSchema = z
  .object({
    yearOptions: z.array(z.string()).describe('Available year format options for storage template'),
    monthOptions: z.array(z.string()).describe('Available month format options for storage template'),
    weekOptions: z.array(z.string()).describe('Available week format options for storage template'),
    dayOptions: z.array(z.string()).describe('Available day format options for storage template'),
    hourOptions: z.array(z.string()).describe('Available hour format options for storage template'),
    minuteOptions: z.array(z.string()).describe('Available minute format options for storage template'),
    secondOptions: z.array(z.string()).describe('Available second format options for storage template'),
    presetOptions: z.array(z.string()).describe('Available preset template options'),
  })
  .meta({ id: 'SystemConfigTemplateStorageOptionDto' });

export class AdminConfigDto extends createZodDto(AdminConfigSchema) {}
export class UserConfigDto extends createZodDto(UserConfigSchema) {}
export class PublicConfigDto extends createZodDto(PublicConfigSchema) {}
export class ConfigFFmpegDto extends createZodDto(AdminConfigFFmpegSchema) {}
export class ConfigSmtpDto extends createZodDto(AdminConfigSmtpSchema) {}
export class ConfigTemplateStorageOptionDto extends createZodDto(ConfigTemplateStorageOptionSchema) {}

/** @deprecated the `/system-config` endpoints these are named after are on their way out */
export { AdminConfigDto as SystemConfigDto, ConfigSmtpDto as SystemConfigSmtpDto };

export class CLIPConfig extends createZodDto(CLIPConfigSchema) {}

export function mapAdminConfig(config: SystemConfig): AdminConfigDto {
  // Redact secrets on read. Writes that come back with an empty string here
  // preserve the stored value (see system-config.service.ts:updateAdminConfig).
  // The `apiKeyConfigured` flag exists so the admin UI can render a "Key
  // Saved" indicator without exposing the actual key.
  return {
    ...config,
    machineLearning: {
      ...config.machineLearning,
      runpod: {
        ...config.machineLearning.runpod,
        apiKey: '',
        apiKeyConfigured: config.machineLearning.runpod.apiKey.length > 0,
        hfToken: '',
        hfTokenConfigured: config.machineLearning.runpod.hfToken.length > 0,
      },
    },
  };
}

export function mapUserConfig(config: SystemConfig): UserConfigDto {
  return UserConfigSchema.parse(config);
}

export function mapPublicConfig(config: SystemConfig): PublicConfigDto {
  return PublicConfigSchema.parse(config);
}

export const defaults = Object.freeze<SystemConfig>({
  backup: {
    database: {
      enabled: true,
      cronExpression: CronExpression.EVERY_DAY_AT_2AM,
      keepLastAmount: 14,
    },
  },
  ffmpeg: {
    crf: 23,
    threads: 0,
    preset: 'ultrafast',
    targetVideoCodec: VideoCodec.H264,
    acceptedVideoCodecs: [VideoCodec.H264],
    targetAudioCodec: AudioCodec.Aac,
    acceptedAudioCodecs: [AudioCodec.Aac, AudioCodec.Mp3, AudioCodec.Opus],
    acceptedContainers: [VideoContainer.Mov, VideoContainer.Ogg, VideoContainer.Webm],
    targetResolution: '720',
    maxBitrate: '0',
    bframes: -1,
    refs: 0,
    gopSize: 0,
    temporalAQ: false,
    cqMode: CQMode.Auto,
    twoPass: false,
    preferredHwDevice: 'auto',
    transcode: TranscodePolicy.Required,
    tonemap: ToneMapping.Hable,
    accel: TranscodeHardwareAcceleration.Disabled,
    accelDecode: true,
    realtime: {
      enabled: false,
      videoCodecs: [VideoCodec.H264, VideoCodec.Hevc],
      resolutions: [HlsVideoResolution.p480, HlsVideoResolution.p720, HlsVideoResolution.p1080],
    },
  },
  integrityChecks: {
    missingFiles: {
      enabled: true,
      cronExpression: CronExpression.EVERY_DAY_AT_3AM,
    },
    untrackedFiles: {
      enabled: true,
      cronExpression: CronExpression.EVERY_DAY_AT_3AM,
    },
    checksumFiles: {
      enabled: true,
      cronExpression: CronExpression.EVERY_DAY_AT_3AM,
      timeLimit: 60 * 60 * 1000, // 1 hour
      percentageLimit: 1, // 100% of assets
    },
  },
  job: {
    thumbnailGeneration: { concurrency: 3 },
    metadataExtraction: { concurrency: 5 },
    videoConversion: { concurrency: 1 },
    faceDetection: { concurrency: 2 },
    smartSearch: { concurrency: 2 },
    videoDuplicateDetection: { concurrency: 1 },
    backgroundTask: { concurrency: 5 },
    migration: { concurrency: 5 },
    search: { concurrency: 5 },
    sidecar: { concurrency: 5 },
    library: { concurrency: 5 },
    notifications: { concurrency: 5 },
    ocr: { concurrency: 1 },
    imageEnrichment: { concurrency: 2 },
    imageDescription: { concurrency: 2 },
    nsfwDetection: { concurrency: 2 },
    mediaHealth: { concurrency: 2 },
    workflow: { concurrency: 5 },
    editor: { concurrency: 2 },
    integrityCheck: { concurrency: 1 },
  },
  logging: {
    enabled: true,
    level: LogLevel.Log,
  },
  machineLearning: {
    enabled: process.env.IMMICH_MACHINE_LEARNING_ENABLED !== 'false',
    urls: [process.env.IMMICH_MACHINE_LEARNING_URL || 'http://immich-machine-learning:3003'],
    availabilityChecks: {
      enabled: true,
      timeout: 2000,
      interval: 30_000,
    },
    clip: {
      enabled: true,
      modelName: 'ViT-B-16-SigLIP-384__webli',
      zeroShotTagging: {
        enabled: true,
        minSimilarity: 0.25,
        maxTags: 6,
      },
    },
    duplicateDetection: {
      enabled: true,
      maxDistance: 0.01,
      preferOriginalFormat: true,
      enhancedVideo: {
        enabled: true,
        frameCount: 4,
        minMatchingFrames: 2,
        maxDistance: 0.01,
      },
    },
    facialRecognition: {
      enabled: true,
      modelName: 'buffalo_l',
      minScore: 0.7,
      maxDistance: 0.5,
      minFaces: 3,
    },
    ocr: {
      enabled: true,
      modelName: 'PP-OCRv5_mobile',
      minDetectionScore: 0.5,
      minRecognitionScore: 0.8,
      maxResolution: 736,
    },
    imageDescription: imageDescriptionDefaults,
    nsfwDetection: nsfwDetectionDefaults,
    runpod: runpodDefaults,
  },
  map: {
    enabled: true,
    lightStyle: 'https://tiles.immich.cloud/v1/style/light.json',
    darkStyle: 'https://tiles.immich.cloud/v1/style/dark.json',
  },
  reverseGeocoding: {
    enabled: true,
  },
  metadata: {
    faces: {
      import: false,
    },
  },
  oauth: {
    autoLaunch: false,
    autoRegister: true,
    buttonText: 'Login with OAuth',
    clientId: '',
    clientSecret: '',
    defaultStorageQuota: null,
    enabled: false,
    issuerUrl: '',
    accountManagementUrl: '',
    endSessionEndpoint: '',
    mobileOverrideEnabled: false,
    mobileRedirectUri: '',
    prompt: '',
    scope: 'openid email profile',
    signingAlgorithm: 'RS256',
    profileSigningAlgorithm: 'none',
    storageLabelClaim: 'preferred_username',
    storageQuotaClaim: 'immich_quota',
    roleClaim: 'immich_role',
    tokenEndpointAuthMethod: OAuthTokenEndpointAuthMethod.ClientSecretPost,
    timeout: 30_000,
    allowInsecureRequests: false,
  },
  passwordLogin: {
    enabled: true,
  },
  physicalDeduplication: {
    enabled: false,
    masterUserId: null,
  },
  localFeatures: {
    askSearch: {
      enabled: true,
      maxResults: 100,
    },
  },
  storageTemplate: {
    enabled: false,
    hashVerificationEnabled: true,
    template: '{{y}}/{{y}}-{{MM}}-{{dd}}/{{filename}}',
  },
  image: {
    thumbnail: {
      format: ImageFormat.Webp,
      size: 250,
      quality: 80,
      progressive: false,
    },
    preview: {
      format: ImageFormat.Jpeg,
      size: 1440,
      quality: 80,
      progressive: false,
    },
    colorspace: Colorspace.P3,
    extractEmbedded: false,
    enhancedRaw: {
      enabled: true,
    },
    fullsize: {
      enabled: false,
      format: ImageFormat.Jpeg,
      quality: 80,
      progressive: false,
    },
  },
  newVersionCheck: {
    enabled: true,
    channel: ReleaseChannel.Stable,
  },
  nightlyTasks: {
    startTime: '00:00',
    databaseCleanup: true,
    generateMemories: true,
    syncQuotaUsage: true,
    missingThumbnails: true,
    clusterNewFaces: true,
  },
  trash: {
    enabled: true,
    days: 30,
  },
  theme: {
    customCss: '',
  },
  library: {
    scan: {
      enabled: true,
      cronExpression: CronExpression.EVERY_DAY_AT_MIDNIGHT,
    },
    watch: {
      enabled: false,
    },
  },
  server: {
    externalDomain: '',
    loginPageMessage: '',
    publicUsers: true,
  },
  notifications: {
    smtp: {
      enabled: false,
      from: '',
      replyTo: '',
      transport: {
        ignoreCert: false,
        host: '',
        port: 587,
        secure: false,
        username: '',
        password: '',
      },
    },
  },
  templates: {
    email: {
      welcomeTemplate: '',
      albumInviteTemplate: '',
      albumUpdateTemplate: '',
    },
  },
  user: {
    deleteDelay: 7,
  },
  smartAlbums: smartAlbumsDefaults,
});
