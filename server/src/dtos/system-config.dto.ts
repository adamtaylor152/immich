import { createZodDto } from 'nestjs-zod';
import { defaults, type SystemConfig } from 'src/config';
import {
  CLIPConfigSchema,
  DuplicateDetectionConfigSchema,
  FacialRecognitionConfigSchema,
  ImageDescriptionConfigSchema,
  NsfwDetectionConfigSchema,
  OcrConfigSchema,
} from 'src/dtos/model-config.dto';
import {
  AudioCodecSchema,
  ColorspaceSchema,
  CQModeSchema,
  ImageFormatSchema,
  LogLevelSchema,
  MachineLearningHardwareAccelerationSchema,
  OAuthTokenEndpointAuthMethodSchema,
  ToneMappingSchema,
  TranscodeHardwareAccelerationSchema,
  TranscodePolicySchema,
  VideoCodecSchema,
  VideoContainerSchema,
} from 'src/enum';
import { isValidTime } from 'src/validation';
import z from 'zod';

/** Coerces 'true'/'false' strings to boolean, but also allows booleans. */
const configBool = z
  .preprocess((val) => {
    if (val === 'true') {
      return true;
    }
    if (val === 'false') {
      return false;
    }
    return val;
  }, z.boolean())
  .meta({ type: 'boolean' });

const JobSettingsSchema = z
  .object({
    concurrency: z.int().min(1).describe('Concurrency'),
  })
  .meta({ id: 'JobSettingsDto' });

const cronExpressionSchema = z
  .string()
  .regex(/(((\d+,)+\d+|(\d+(\/|-)\d+)|\d+|\*) ?){5,7}/, 'Invalid cron expression')
  .describe('Cron expression');

const DatabaseBackupSchema = z
  .object({
    enabled: configBool.describe('Enabled'),
    cronExpression: cronExpressionSchema,
    keepLastAmount: z.int().min(1).describe('Keep last amount'),
  })
  .meta({ id: 'DatabaseBackupConfig' });

const SystemConfigBackupsSchema = z.object({ database: DatabaseBackupSchema }).meta({ id: 'SystemConfigBackupsDto' });

const SystemConfigFFmpegSchema = z
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
  })
  .meta({ id: 'SystemConfigFFmpegDto' });

const SystemConfigJobSchema = z
  .object({
    thumbnailGeneration: JobSettingsSchema,
    metadataExtraction: JobSettingsSchema,
    videoConversion: JobSettingsSchema,
    faceDetection: JobSettingsSchema,
    smartSearch: JobSettingsSchema,
    videoDuplicateDetection: JobSettingsSchema,
    backgroundTask: JobSettingsSchema,
    migration: JobSettingsSchema,
    search: JobSettingsSchema,
    sidecar: JobSettingsSchema,
    library: JobSettingsSchema,
    notifications: JobSettingsSchema,
    ocr: JobSettingsSchema,
    imageEnrichment: JobSettingsSchema.default(defaults.job.imageEnrichment),
    imageDescription: JobSettingsSchema.default(defaults.job.imageDescription),
    nsfwDetection: JobSettingsSchema.default(defaults.job.nsfwDetection),
    mediaHealth: JobSettingsSchema.default(defaults.job.mediaHealth),
    workflow: JobSettingsSchema,
    editor: JobSettingsSchema,
  })
  .meta({ id: 'SystemConfigJobDto' });

const SystemConfigLibraryScanSchema = z
  .object({
    enabled: configBool.describe('Enabled'),
    cronExpression: cronExpressionSchema,
  })
  .meta({ id: 'SystemConfigLibraryScanDto' });

const SystemConfigLibraryWatchSchema = z
  .object({ enabled: configBool.describe('Enabled') })
  .meta({ id: 'SystemConfigLibraryWatchDto' });

const SystemConfigLibrarySchema = z
  .object({ scan: SystemConfigLibraryScanSchema, watch: SystemConfigLibraryWatchSchema })
  .meta({ id: 'SystemConfigLibraryDto' });

const SystemConfigLoggingSchema = z
  .object({
    enabled: configBool.describe('Enabled'),
    level: LogLevelSchema,
  })
  .meta({ id: 'SystemConfigLoggingDto' });

const MachineLearningAvailabilityChecksSchema = z
  .object({
    enabled: configBool.describe('Enabled'),
    timeout: z.int(),
    interval: z.int(),
  })
  .meta({ id: 'MachineLearningAvailabilityChecksDto' });

const MachineLearningHardwareResponseSchema = z
  .object({
    providers: z.array(z.string()).describe('Available ONNX Runtime providers'),
    openvinoDeviceIds: z.array(z.string()).describe('Available OpenVINO device IDs'),
    torchCudaAvailable: z.boolean().describe('Whether PyTorch CUDA is available'),
    cudaDeviceCount: z.int().min(0).describe('Available PyTorch CUDA device count'),
    preferredAcceleration: MachineLearningHardwareAccelerationSchema.describe(
      'Detected preferred hardware acceleration',
    ),
  })
  .meta({ id: 'MachineLearningHardwareResponseDto' });

const SmartAlbumKindSchema = z
  .object({
    enabled: configBool.describe('Whether this smart album is active'),
    name: z.string().describe('User-visible album name'),
    tagTriggers: z.array(z.string()).describe('Tags that mark an asset as belonging to this album'),
    clipQueries: z.array(z.string()).describe('CLIP query phrases used when no tag trigger matches'),
    threshold: z.number().meta({ format: 'double' }).min(0).max(1).describe('CLIP similarity threshold'),
  })
  .meta({ id: 'SmartAlbumKindConfig' });

const SystemConfigSmartAlbumsSchema = z
  .object({
    enabled: configBool.describe('Master smart-album enabled toggle'),
    builtIn: z.object({
      travel: SmartAlbumKindSchema,
      documents: SmartAlbumKindSchema,
      screenshots: SmartAlbumKindSchema,
      food: SmartAlbumKindSchema,
      pets: SmartAlbumKindSchema,
      nature: SmartAlbumKindSchema,
    }),
  })
  .meta({ id: 'SystemConfigSmartAlbumsDto' });

const SystemConfigMachineLearningSchema = z
  .object({
    enabled: configBool.describe('Enabled'),
    urls: z.array(z.string()).min(1).describe('ML service URLs'),
    availabilityChecks: MachineLearningAvailabilityChecksSchema,
    clip: CLIPConfigSchema,
    duplicateDetection: DuplicateDetectionConfigSchema,
    facialRecognition: FacialRecognitionConfigSchema,
    ocr: OcrConfigSchema,
    imageDescription: ImageDescriptionConfigSchema.default(defaults.machineLearning.imageDescription),
    nsfwDetection: NsfwDetectionConfigSchema.default(defaults.machineLearning.nsfwDetection),
  })
  .meta({ id: 'SystemConfigMachineLearningDto' });

const SystemConfigMapSchema = z
  .object({
    enabled: configBool.describe('Enabled'),
    lightStyle: z.url().describe('Light map style URL'),
    darkStyle: z.url().describe('Dark map style URL'),
  })
  .meta({ id: 'SystemConfigMapDto' });

const SystemConfigNewVersionCheckSchema = z
  .object({ enabled: configBool.describe('Enabled') })
  .meta({ id: 'SystemConfigNewVersionCheckDto' });

const SystemConfigNightlyTasksSchema = z
  .object({
    startTime: isValidTime.describe('Start time'),
    databaseCleanup: configBool.describe('Database cleanup'),
    missingThumbnails: configBool.describe('Missing thumbnails'),
    clusterNewFaces: configBool.describe('Cluster new faces'),
    generateMemories: configBool.describe('Generate memories'),
    syncQuotaUsage: configBool.describe('Sync quota usage'),
  })
  .meta({ id: 'SystemConfigNightlyTasksDto' });

const SystemConfigOAuthSchema = z
  .object({
    autoLaunch: configBool.describe('Auto launch'),
    autoRegister: configBool.describe('Auto register'),
    buttonText: z.string().describe('Button text'),
    clientId: z.string().describe('Client ID'),
    clientSecret: z.string().describe('Client secret'),
    tokenEndpointAuthMethod: OAuthTokenEndpointAuthMethodSchema,
    timeout: z.int().min(1).describe('Timeout'),
    allowInsecureRequests: configBool.describe('Allow insecure requests'),
    defaultStorageQuota: z.int().min(0).nullable().describe('Default storage quota'),
    enabled: configBool.describe('Enabled'),
    issuerUrl: z
      .string()
      .refine((url) => url.length === 0 || z.url().safeParse(url).success, {
        error: 'Issuer URL must be an empty string or a valid URL',
      })
      .describe('Issuer URL'),
    scope: z.string().describe('Scope'),
    prompt: z.string().describe('OAuth prompt parameter (e.g. select_account, login, consent)'),
    endSessionEndpoint: z
      .string()
      .refine((url) => url.length === 0 || z.url().safeParse(url).success, {
        error: 'endSessionEndpoint must be an empty string or a valid URL',
      })
      .describe('End session endpoint'),
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
  .meta({
    id: 'SystemConfigOAuthDto',
  });

const SystemConfigPasswordLoginSchema = z
  .object({ enabled: configBool.describe('Enabled') })
  .meta({ id: 'SystemConfigPasswordLoginDto' });

const SystemConfigPhysicalDeduplicationSchema = z
  .object({
    enabled: configBool.describe('Enabled'),
    masterUserId: z.uuidv4().nullable().describe('Master user ID'),
  })
  .meta({ id: 'SystemConfigPhysicalDeduplicationDto' });

const SystemConfigLocalFeaturesSchema = z
  .object({
    askSearch: z.object({
      enabled: configBool.describe('Enable local Ask Photos-style search'),
      maxResults: z.int().min(1).max(1000).describe('Maximum number of Ask Search results'),
    }),
  })
  .meta({ id: 'SystemConfigLocalFeaturesDto' });

const SystemConfigReverseGeocodingSchema = z
  .object({ enabled: configBool.describe('Enabled') })
  .meta({ id: 'SystemConfigReverseGeocodingDto' });

const SystemConfigFacesSchema = z
  .object({ import: configBool.describe('Import') })
  .meta({ id: 'SystemConfigFacesDto' });
const SystemConfigMetadataSchema = z.object({ faces: SystemConfigFacesSchema }).meta({ id: 'SystemConfigMetadataDto' });

const SystemConfigServerSchema = z
  .object({
    externalDomain: z
      .string()
      .refine((url) => url.length === 0 || z.url().safeParse(url).success, {
        error: 'External domain must be an empty string or a valid URL',
      })
      .describe('External domain'),
    loginPageMessage: z.string().describe('Login page message'),
    publicUsers: configBool.describe('Public users'),
  })
  .meta({ id: 'SystemConfigServerDto' });

const SystemConfigSmtpTransportSchema = z
  .object({
    ignoreCert: configBool.describe('Whether to ignore SSL certificate errors'),
    host: z.string().describe('SMTP server hostname'),
    port: z.int().min(0).max(65_535).describe('SMTP server port'),
    secure: configBool.describe('Whether to use secure connection (TLS/SSL)'),
    username: z.string().describe('SMTP username'),
    password: z.string().describe('SMTP password'),
  })
  .meta({ id: 'SystemConfigSmtpTransportDto' });

const SystemConfigSmtpSchema = z
  .object({
    enabled: configBool.describe('Whether SMTP email notifications are enabled'),
    from: z.string().describe('Email address to send from'),
    replyTo: z.string().describe('Email address for replies'),
    transport: SystemConfigSmtpTransportSchema,
  })
  .meta({ id: 'SystemConfigSmtpDto' });

const SystemConfigNotificationsSchema = z
  .object({ smtp: SystemConfigSmtpSchema })
  .meta({ id: 'SystemConfigNotificationsDto' });

const SystemConfigTemplateEmailsSchema = z
  .object({
    albumInviteTemplate: z.string().describe('Album invite template'),
    welcomeTemplate: z.string().describe('Welcome template'),
    albumUpdateTemplate: z.string().describe('Album update template'),
  })
  .meta({ id: 'SystemConfigTemplateEmailsDto' });
const SystemConfigTemplatesSchema = z
  .object({ email: SystemConfigTemplateEmailsSchema })
  .meta({ id: 'SystemConfigTemplatesDto' });

const SystemConfigStorageTemplateSchema = z
  .object({
    enabled: configBool.describe('Enabled'),
    hashVerificationEnabled: configBool.describe('Hash verification enabled'),
    template: z.string().describe('Template'),
  })
  .meta({ id: 'SystemConfigStorageTemplateDto' });

const SystemConfigTemplateStorageOptionSchema = z
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

const SystemConfigThemeSchema = z
  .object({ customCss: z.string().describe('Custom CSS for theming') })
  .meta({ id: 'SystemConfigThemeDto' });

const SystemConfigGeneratedImageSchema = z
  .object({
    format: ImageFormatSchema,
    quality: z.int().min(1).max(100).describe('Quality'),
    size: z.int().min(1).describe('Size'),
    progressive: configBool.default(false).optional().describe('Progressive'),
  })
  .meta({ id: 'SystemConfigGeneratedImageDto' });

const SystemConfigGeneratedFullsizeImageSchema = z
  .object({
    enabled: configBool.describe('Enabled'),
    format: ImageFormatSchema,
    quality: z.int().min(1).max(100).describe('Quality'),
    progressive: configBool.default(false).optional().describe('Progressive'),
  })
  .meta({ id: 'SystemConfigGeneratedFullsizeImageDto' });

const SystemConfigEnhancedRawImageSchema = z
  .object({
    enabled: configBool.describe('Enhanced RAW rendering'),
  })
  .meta({ id: 'SystemConfigEnhancedRawImageDto' });

const SystemConfigImageSchema = z
  .object({
    thumbnail: SystemConfigGeneratedImageSchema,
    preview: SystemConfigGeneratedImageSchema,
    fullsize: SystemConfigGeneratedFullsizeImageSchema,
    colorspace: ColorspaceSchema,
    extractEmbedded: configBool.describe('Extract embedded'),
    enhancedRaw: SystemConfigEnhancedRawImageSchema.default(defaults.image.enhancedRaw),
  })
  .meta({ id: 'SystemConfigImageDto' });

const SystemConfigTrashSchema = z
  .object({
    enabled: configBool.describe('Enabled'),
    days: z.int().min(0).describe('Days'),
  })
  .meta({ id: 'SystemConfigTrashDto' });

const SystemConfigUserSchema = z
  .object({
    deleteDelay: z.int().min(1).describe('Delete delay'),
  })
  .meta({ id: 'SystemConfigUserDto' });

export const SystemConfigSchema = z
  .object({
    backup: SystemConfigBackupsSchema,
    ffmpeg: SystemConfigFFmpegSchema,
    logging: SystemConfigLoggingSchema,
    machineLearning: SystemConfigMachineLearningSchema,
    map: SystemConfigMapSchema,
    newVersionCheck: SystemConfigNewVersionCheckSchema,
    nightlyTasks: SystemConfigNightlyTasksSchema,
    oauth: SystemConfigOAuthSchema,
    passwordLogin: SystemConfigPasswordLoginSchema,
    physicalDeduplication: SystemConfigPhysicalDeduplicationSchema.default(defaults.physicalDeduplication),
    localFeatures: SystemConfigLocalFeaturesSchema.default(defaults.localFeatures),
    reverseGeocoding: SystemConfigReverseGeocodingSchema,
    metadata: SystemConfigMetadataSchema,
    storageTemplate: SystemConfigStorageTemplateSchema,
    job: SystemConfigJobSchema,
    image: SystemConfigImageSchema,
    trash: SystemConfigTrashSchema,
    theme: SystemConfigThemeSchema,
    library: SystemConfigLibrarySchema,
    notifications: SystemConfigNotificationsSchema,
    templates: SystemConfigTemplatesSchema,
    server: SystemConfigServerSchema,
    user: SystemConfigUserSchema,
    smartAlbums: SystemConfigSmartAlbumsSchema.default(defaults.smartAlbums),
  })
  .describe('System configuration')
  .meta({ id: 'SystemConfigDto' });

export class SystemConfigFFmpegDto extends createZodDto(SystemConfigFFmpegSchema) {}
export class MachineLearningHardwareResponseDto extends createZodDto(MachineLearningHardwareResponseSchema) {}
export class SystemConfigSmtpDto extends createZodDto(SystemConfigSmtpSchema) {}
export class SystemConfigTemplateStorageOptionDto extends createZodDto(SystemConfigTemplateStorageOptionSchema) {}
export class SystemConfigDto extends createZodDto(SystemConfigSchema) {}

const ImageDescriptionRequeueEstimateSchema = z
  .object({
    totalAssets: z.int().min(0).describe('Total eligible image assets'),
    withDescription: z
      .int()
      .min(0)
      .describe('Number of eligible assets that currently have a description (will be re-run on force-requeue).'),
    withoutDescription: z.int().min(0).describe('Number of eligible assets that currently have no description.'),
    rollingAvgSeconds: z
      .number()
      .meta({ format: 'double' })
      .min(0)
      .describe(
        'Estimated seconds per asset. Currently a fixed placeholder value (1.5s) until rolling per-job duration metrics are implemented.',
      ),
    estimatedTotalSeconds: z
      .number()
      .meta({ format: 'double' })
      .min(0)
      .describe(
        'Estimated wall-clock time to re-describe every eligible asset (force mode: every asset is re-processed, not just those without descriptions).',
      ),
    activeBackend: z.string().describe('Configured hardware acceleration backend (e.g. "auto", "cuda")'),
    activeModel: z.string().describe('Configured image description model name'),
  })
  .meta({ id: 'ImageDescriptionRequeueEstimateDto' });

export class ImageDescriptionRequeueEstimateDto extends createZodDto(ImageDescriptionRequeueEstimateSchema) {}

const ImageDescriptionRequeueResponseSchema = z
  .object({
    queued: z.boolean().describe('Whether the queue-all job was newly enqueued (false = already in-flight)'),
  })
  .meta({ id: 'ImageDescriptionRequeueResponseDto' });

export class ImageDescriptionRequeueResponseDto extends createZodDto(ImageDescriptionRequeueResponseSchema) {}

export function mapConfig(config: SystemConfig): SystemConfigDto {
  return config;
}
