import { CronExpression } from '@nestjs/schedule';
import {
  AudioCodec,
  Colorspace,
  CQMode,
  ImageFormat,
  LogLevel,
  MachineLearningHardwareAcceleration,
  OAuthTokenEndpointAuthMethod,
  QueueName,
  ToneMapping,
  TranscodeHardwareAcceleration,
  TranscodePolicy,
  VideoCodec,
  VideoContainer,
} from 'src/enum';
import { ConcurrentQueueName, FullsizeImageOptions, ImageOptions } from 'src/types';

export type SystemConfig = {
  backup: {
    database: {
      enabled: boolean;
      cronExpression: string;
      keepLastAmount: number;
    };
  };
  ffmpeg: {
    crf: number;
    threads: number;
    preset: string;
    targetVideoCodec: VideoCodec;
    acceptedVideoCodecs: VideoCodec[];
    targetAudioCodec: AudioCodec;
    acceptedAudioCodecs: AudioCodec[];
    acceptedContainers: VideoContainer[];
    targetResolution: string;
    maxBitrate: string;
    bframes: number;
    refs: number;
    gopSize: number;
    temporalAQ: boolean;
    cqMode: CQMode;
    twoPass: boolean;
    preferredHwDevice: string;
    transcode: TranscodePolicy;
    accel: TranscodeHardwareAcceleration;
    accelDecode: boolean;
    tonemap: ToneMapping;
  };
  job: Record<ConcurrentQueueName, { concurrency: number }>;
  logging: {
    enabled: boolean;
    level: LogLevel;
  };
  machineLearning: {
    enabled: boolean;
    urls: string[];
    availabilityChecks: {
      enabled: boolean;
      timeout: number;
      interval: number;
    };
    clip: {
      enabled: boolean;
      modelName: string;
      zeroShotTagging: {
        enabled: boolean;
        minSimilarity: number;
        maxTags: number;
      };
    };
    duplicateDetection: {
      enabled: boolean;
      maxDistance: number;
      enhancedVideo: {
        enabled: boolean;
        frameCount: number;
        minMatchingFrames: number;
        maxDistance: number;
      };
    };
    facialRecognition: {
      enabled: boolean;
      modelName: string;
      minScore: number;
      minFaces: number;
      maxDistance: number;
    };
    ocr: {
      enabled: boolean;
      modelName: string;
      minDetectionScore: number;
      minRecognitionScore: number;
      maxResolution: number;
    };
    imageDescription: {
      enabled: boolean;
      acceleration: MachineLearningHardwareAcceleration;
      modelName: string;
      fallbackModelName: string;
      device: string;
      prompt: {
        style: 'terse' | 'balanced' | 'rich';
        sentenceCountTarget: number;
        lookFor: string[];
        customVocabulary: string[];
        nsfwIndicators: string[];
        medicalIndicators: string[];
        forbiddenInferences: string[];
        identityInjection: { enabled: boolean; maxNames: number; minFaceConfidence: number };
        advanced: { enabled: boolean; rawPromptTemplate: string; placeholderValidation: 'strict' | 'warn' };
      };
      pendingRequeueAt: string | null;
      lastConfigChangeAt: string | null;
    };
    nsfwDetection: {
      enabled: boolean;
      modelName: string;
      threshold: number;
      device: string;
      hideFromLibrary: boolean;
    };
    runpod: {
      enabled: boolean;
      // Selects between Pod mode (manually-launched dedicated GPU) and
      // Serverless mode (auto-managed endpoint that scales workers 0→N on
      // demand). When 'disabled' the rest of the block is inert. When the
      // value is missing (old configs), the runtime infers 'pod' if
      // `enabled` is true, else 'disabled' — see mapConfig.
      mode: 'disabled' | 'pod' | 'serverless';
      apiKey: string;
      imageName: string;
      dataPrivacyAcknowledged: boolean;
      // Pod-mode settings (unchanged from PR #37)
      defaultGpuTypeId: string;
      containerDiskGb: number;
      volumeGb: number;
      autoStopEnabled: boolean;
      autoStopGraceMinutes: number;
      autoBackfillOnLaunch: boolean;
      maxRuntimeHours: number;
      // Serverless-mode settings (new)
      serverless: {
        // Ranked list of GPU type IDs RunPod can pick from. Cheapest first.
        gpuTypeIds: string[];
        // 0 = true scale-to-zero; 1+ = keep that many warm at all times.
        workersMin: number;
        // Hard concurrency / cost ceiling.
        workersMax: number;
        // Seconds a worker stays warm after the last request.
        idleTimeoutSeconds: number;
        // Max time a single request can take before the worker kills it.
        executionTimeoutMs: number;
        scalerType: 'QUEUE_DELAY' | 'REQUEST_COUNT';
        scalerValue: number;
      };
    };
  };
  map: {
    enabled: boolean;
    lightStyle: string;
    darkStyle: string;
  };
  reverseGeocoding: {
    enabled: boolean;
  };
  metadata: {
    faces: {
      import: boolean;
    };
  };
  oauth: {
    autoLaunch: boolean;
    autoRegister: boolean;
    buttonText: string;
    clientId: string;
    clientSecret: string;
    defaultStorageQuota: number | null;
    enabled: boolean;
    issuerUrl: string;
    endSessionEndpoint: string;
    mobileOverrideEnabled: boolean;
    mobileRedirectUri: string;
    prompt: string;
    scope: string;
    signingAlgorithm: string;
    profileSigningAlgorithm: string;
    tokenEndpointAuthMethod: OAuthTokenEndpointAuthMethod;
    timeout: number;
    allowInsecureRequests: boolean;
    storageLabelClaim: string;
    storageQuotaClaim: string;
    roleClaim: string;
  };
  passwordLogin: {
    enabled: boolean;
  };
  physicalDeduplication: {
    enabled: boolean;
    masterUserId: string | null;
  };
  localFeatures: {
    askSearch: {
      enabled: boolean;
      maxResults: number;
    };
  };
  storageTemplate: {
    enabled: boolean;
    hashVerificationEnabled: boolean;
    template: string;
  };
  image: {
    thumbnail: ImageOptions;
    preview: ImageOptions;
    colorspace: Colorspace;
    extractEmbedded: boolean;
    enhancedRaw: {
      enabled: boolean;
    };
    fullsize: FullsizeImageOptions;
  };
  newVersionCheck: {
    enabled: boolean;
  };
  nightlyTasks: {
    startTime: string;
    databaseCleanup: boolean;
    missingThumbnails: boolean;
    clusterNewFaces: boolean;
    generateMemories: boolean;
    syncQuotaUsage: boolean;
  };
  trash: {
    enabled: boolean;
    days: number;
  };
  theme: {
    customCss: string;
  };
  library: {
    scan: {
      enabled: boolean;
      cronExpression: string;
    };
    watch: {
      enabled: boolean;
    };
  };
  notifications: {
    smtp: {
      enabled: boolean;
      from: string;
      replyTo: string;
      transport: {
        ignoreCert: boolean;
        host: string;
        port: number;
        secure: boolean;
        username: string;
        password: string;
      };
    };
  };
  templates: {
    email: {
      welcomeTemplate: string;
      albumInviteTemplate: string;
      albumUpdateTemplate: string;
    };
  };
  server: {
    externalDomain: string;
    loginPageMessage: string;
    publicUsers: boolean;
  };
  user: {
    deleteDelay: number;
  };
  smartAlbums: {
    enabled: boolean;
    builtIn: {
      travel: { enabled: boolean; name: string; tagTriggers: string[]; clipQueries: string[]; threshold: number };
      documents: { enabled: boolean; name: string; tagTriggers: string[]; clipQueries: string[]; threshold: number };
      screenshots: { enabled: boolean; name: string; tagTriggers: string[]; clipQueries: string[]; threshold: number };
      food: { enabled: boolean; name: string; tagTriggers: string[]; clipQueries: string[]; threshold: number };
      pets: { enabled: boolean; name: string; tagTriggers: string[]; clipQueries: string[]; threshold: number };
      nature: { enabled: boolean; name: string; tagTriggers: string[]; clipQueries: string[]; threshold: number };
    };
  };
};

export type MachineLearningConfig = SystemConfig['machineLearning'];

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
  },
  job: {
    [QueueName.BackgroundTask]: { concurrency: 5 },
    [QueueName.SmartSearch]: { concurrency: 2 },
    [QueueName.VideoDuplicateDetection]: { concurrency: 1 },
    [QueueName.MetadataExtraction]: { concurrency: 5 },
    [QueueName.FaceDetection]: { concurrency: 2 },
    [QueueName.Search]: { concurrency: 5 },
    [QueueName.Sidecar]: { concurrency: 5 },
    [QueueName.Library]: { concurrency: 5 },
    [QueueName.Migration]: { concurrency: 5 },
    [QueueName.ThumbnailGeneration]: { concurrency: 3 },
    [QueueName.VideoConversion]: { concurrency: 1 },
    [QueueName.Notification]: { concurrency: 5 },
    [QueueName.Ocr]: { concurrency: 1 },
    [QueueName.ImageEnrichment]: { concurrency: 2 },
    [QueueName.ImageDescription]: { concurrency: 2 },
    [QueueName.NsfwDetection]: { concurrency: 2 },
    [QueueName.MediaHealth]: { concurrency: 2 },
    [QueueName.Workflow]: { concurrency: 5 },
    [QueueName.Editor]: { concurrency: 2 },
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
    imageDescription: {
      enabled: true,
      acceleration: MachineLearningHardwareAcceleration.Auto,
      modelName: 'Qwen/Qwen2.5-VL-3B-Instruct',
      fallbackModelName: 'microsoft/Florence-2-base-ft',
      device: 'AUTO',
      prompt: {
        style: 'balanced',
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
        advanced: { enabled: false, rawPromptTemplate: '', placeholderValidation: 'strict' },
      },
      pendingRequeueAt: null,
      lastConfigChangeAt: null,
    },
    nsfwDetection: {
      enabled: false,
      modelName: 'onnx-community/nsfw_image_detection-ONNX',
      threshold: 0.85,
      device: 'AUTO',
      hideFromLibrary: false,
    },
    runpod: {
      enabled: false,
      mode: 'disabled',
      apiKey: '',
      imageName: 'ghcr.io/adamtaylor152/immich-machine-learning:fork-main-cuda-runpod',
      dataPrivacyAcknowledged: false,
      defaultGpuTypeId: 'NVIDIA RTX A5000',
      containerDiskGb: 50,
      volumeGb: 20,
      autoStopEnabled: true,
      autoStopGraceMinutes: 15,
      autoBackfillOnLaunch: false,
      maxRuntimeHours: 24,
      serverless: {
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
        scalerType: 'REQUEST_COUNT',
        scalerValue: 4,
      },
    },
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
  smartAlbums: {
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
  },
});
