import { BadRequestException } from '@nestjs/common';
import { defaults, SystemConfig } from 'src/config';
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
import { SystemConfigService } from 'src/services/system-config.service';
import { DeepPartial } from 'src/types';
import { mockEnvData } from 'test/repositories/config.repository.mock';
import { newTestService, ServiceMocks } from 'test/utils';
import { vi } from 'vitest';

const partialConfig = {
  ffmpeg: { crf: 30 },
  oauth: { autoLaunch: true },
  trash: { days: 10 },
  user: { deleteDelay: 15 },
} satisfies DeepPartial<SystemConfig>;

const updatedConfig = Object.freeze<SystemConfig>({
  job: {
    [QueueName.BackgroundTask]: { concurrency: 5 },
    [QueueName.SmartSearch]: { concurrency: 2 },
    [QueueName.VideoDuplicateDetection]: { concurrency: 1 },
    [QueueName.MediaHealth]: { concurrency: 2 },
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
    [QueueName.Workflow]: { concurrency: 5 },
    [QueueName.Editor]: { concurrency: 2 },
  },
  backup: {
    database: {
      enabled: true,
      cronExpression: '0 02 * * *',
      keepLastAmount: 14,
    },
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
  ffmpeg: {
    crf: 30,
    threads: 0,
    preset: 'ultrafast',
    targetAudioCodec: AudioCodec.Aac,
    acceptedAudioCodecs: [AudioCodec.Aac, AudioCodec.Mp3, AudioCodec.Opus],
    targetResolution: '720',
    targetVideoCodec: VideoCodec.H264,
    acceptedVideoCodecs: [VideoCodec.H264],
    acceptedContainers: [VideoContainer.Mov, VideoContainer.Ogg, VideoContainer.Webm],
    maxBitrate: '0',
    bframes: -1,
    refs: 0,
    gopSize: 0,
    temporalAQ: false,
    cqMode: CQMode.Auto,
    twoPass: false,
    preferredHwDevice: 'auto',
    transcode: TranscodePolicy.Required,
    accel: TranscodeHardwareAcceleration.Disabled,
    accelDecode: true,
    tonemap: ToneMapping.Hable,
  },
  logging: {
    enabled: true,
    level: LogLevel.Log,
  },
  metadata: {
    faces: {
      import: false,
    },
  },
  machineLearning: {
    enabled: true,
    urls: ['http://immich-machine-learning:3003'],
    availabilityChecks: {
      enabled: true,
      interval: 30_000,
      timeout: 2000,
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
        gpuTypeIds: ['AMPERE_48', 'ADA_48_PRO', 'AMPERE_80'],
        workersMin: 0,
        workersMax: 3,
        idleTimeoutSeconds: 30,
        executionTimeoutMs: 600_000,
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
  nightlyTasks: {
    startTime: '00:00',
    databaseCleanup: true,
    clusterNewFaces: true,
    missingThumbnails: true,
    generateMemories: true,
    syncQuotaUsage: true,
  },
  reverseGeocoding: {
    enabled: true,
  },
  oauth: {
    autoLaunch: true,
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
    tokenEndpointAuthMethod: OAuthTokenEndpointAuthMethod.ClientSecretPost,
    timeout: 30_000,
    allowInsecureRequests: false,
    storageLabelClaim: 'preferred_username',
    storageQuotaClaim: 'immich_quota',
    roleClaim: 'immich_role',
  },
  passwordLogin: {
    enabled: true,
  },
  server: {
    externalDomain: '',
    loginPageMessage: '',
    publicUsers: true,
  },
  storageTemplate: {
    enabled: false,
    hashVerificationEnabled: true,
    template: '{{y}}/{{y}}-{{MM}}-{{dd}}/{{filename}}',
  },
  image: {
    thumbnail: {
      size: 250,
      format: ImageFormat.Webp,
      quality: 80,
      progressive: false,
    },
    preview: {
      size: 1440,
      format: ImageFormat.Jpeg,
      quality: 80,
      progressive: false,
    },
    fullsize: { enabled: false, format: ImageFormat.Jpeg, quality: 80, progressive: false },
    colorspace: Colorspace.P3,
    extractEmbedded: false,
    enhancedRaw: {
      enabled: true,
    },
  },
  newVersionCheck: {
    enabled: true,
  },
  trash: {
    enabled: true,
    days: 10,
  },
  theme: {
    customCss: '',
  },
  library: {
    scan: {
      enabled: true,
      cronExpression: '0 0 * * *',
    },
    watch: {
      enabled: false,
    },
  },
  user: {
    deleteDelay: 15,
  },
  notifications: {
    smtp: {
      enabled: false,
      from: '',
      replyTo: '',
      transport: {
        host: '',
        port: 587,
        secure: false,
        username: '',
        password: '',
        ignoreCert: false,
      },
    },
  },
  templates: {
    email: {
      albumInviteTemplate: '',
      welcomeTemplate: '',
      albumUpdateTemplate: '',
    },
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

describe(SystemConfigService.name, () => {
  let sut: SystemConfigService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(SystemConfigService));
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('getDefaults', () => {
    it('should return the default config', () => {
      mocks.systemMetadata.get.mockResolvedValue(partialConfig);

      expect(sut.getDefaults()).toEqual(defaults);
      expect(mocks.systemMetadata.get).not.toHaveBeenCalled();
    });
  });

  describe('getConfig', () => {
    it('should return the default config', async () => {
      mocks.systemMetadata.get.mockResolvedValue({});

      await expect(sut.getSystemConfig()).resolves.toEqual(defaults);
    });

    it('should merge the overrides', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        ffmpeg: { crf: 30 },
        oauth: { autoLaunch: true },
        trash: { days: 10 },
        user: { deleteDelay: 15 },
      });

      await expect(sut.getSystemConfig()).resolves.toEqual(updatedConfig);
    });

    it('should load the config from a json file', async () => {
      mocks.config.getEnv.mockReturnValue(mockEnvData({ configFile: 'immich-config.json' }));
      mocks.systemMetadata.readFile.mockResolvedValue(JSON.stringify(partialConfig));

      await expect(sut.getSystemConfig()).resolves.toEqual(updatedConfig);

      expect(mocks.systemMetadata.readFile).toHaveBeenCalledWith('immich-config.json');
    });

    it('should transform booleans', async () => {
      mocks.config.getEnv.mockReturnValue(mockEnvData({ configFile: 'immich-config.json' }));
      mocks.systemMetadata.readFile.mockResolvedValue(JSON.stringify({ ffmpeg: { twoPass: 'false' } }));

      await expect(sut.getSystemConfig()).resolves.toMatchObject({
        ffmpeg: expect.objectContaining({ twoPass: false }),
      });
    });

    it('should transform numbers', async () => {
      mocks.config.getEnv.mockReturnValue(mockEnvData({ configFile: 'immich-config.json' }));
      mocks.systemMetadata.readFile.mockResolvedValue(JSON.stringify({ ffmpeg: { threads: '42' } }));

      await expect(sut.getSystemConfig()).resolves.toMatchObject({
        ffmpeg: expect.objectContaining({ threads: 42 }),
      });
    });

    it('should accept valid cron expressions', async () => {
      mocks.config.getEnv.mockReturnValue(mockEnvData({ configFile: 'immich-config.json' }));
      mocks.systemMetadata.readFile.mockResolvedValue(
        JSON.stringify({ library: { scan: { cronExpression: '0 0 * * *' } } }),
      );

      await expect(sut.getSystemConfig()).resolves.toMatchObject({
        library: {
          scan: {
            enabled: true,
            cronExpression: '0 0 * * *',
          },
        },
      });
    });

    it('should reject an invalid issuer URL', async () => {
      mocks.config.getEnv.mockReturnValue(mockEnvData({ configFile: 'immich-config.json' }));
      mocks.systemMetadata.readFile.mockResolvedValue(JSON.stringify({ oauth: { issuerUrl: 'accounts.google.com' } }));

      await expect(sut.getSystemConfig()).rejects.toThrow(
        '[oauth.issuerUrl] Issuer URL must be an empty string or a valid URL',
      );
    });

    it('should reject invalid cron expressions', async () => {
      mocks.config.getEnv.mockReturnValue(mockEnvData({ configFile: 'immich-config.json' }));
      mocks.systemMetadata.readFile.mockResolvedValue(JSON.stringify({ library: { scan: { cronExpression: 'foo' } } }));

      await expect(sut.getSystemConfig()).rejects.toThrow('[library.scan.cronExpression] Invalid cron expression');
    });

    it('should log errors with the config file', async () => {
      mocks.config.getEnv.mockReturnValue(mockEnvData({ configFile: 'immich-config.json' }));

      mocks.systemMetadata.readFile.mockResolvedValue(`{ "ffmpeg2": true, "ffmpeg2": true }`);

      await expect(sut.getSystemConfig()).rejects.toBeInstanceOf(Error);

      expect(mocks.systemMetadata.readFile).toHaveBeenCalledWith('immich-config.json');
      expect(mocks.logger.error).toHaveBeenCalledTimes(2);
      expect(mocks.logger.error.mock.calls[0][0]).toEqual('Unable to load configuration file: immich-config.json');
      expect(mocks.logger.error.mock.calls[1][0].toString()).toEqual(
        expect.stringContaining('YAMLException: duplicated mapping key (1:20)'),
      );
    });

    it('should load the config from a yaml file', async () => {
      mocks.config.getEnv.mockReturnValue(mockEnvData({ configFile: 'immich-config.yaml' }));
      const partialConfig = `
        ffmpeg:
          crf: 30
        oauth:
          autoLaunch: true
        trash:
          days: 10
        user:
          deleteDelay: 15
      `;
      mocks.systemMetadata.readFile.mockResolvedValue(partialConfig);

      await expect(sut.getSystemConfig()).resolves.toEqual(updatedConfig);

      expect(mocks.systemMetadata.readFile).toHaveBeenCalledWith('immich-config.yaml');
    });

    it('should accept an empty configuration file', async () => {
      mocks.config.getEnv.mockReturnValue(mockEnvData({ configFile: 'immich-config.json' }));
      mocks.systemMetadata.readFile.mockResolvedValue(JSON.stringify({}));

      await expect(sut.getSystemConfig()).resolves.toEqual(defaults);

      expect(mocks.systemMetadata.readFile).toHaveBeenCalledWith('immich-config.json');
    });

    it('should allow underscores in the machine learning url', async () => {
      mocks.config.getEnv.mockReturnValue(mockEnvData({ configFile: 'immich-config.json' }));
      const partialConfig = { machineLearning: { urls: ['immich_machine_learning'] } };
      mocks.systemMetadata.readFile.mockResolvedValue(JSON.stringify(partialConfig));

      const config = await sut.getSystemConfig();
      expect(config.machineLearning.urls).toEqual(['immich_machine_learning']);
    });

    const externalDomainTests = [
      { should: 'with a trailing slash', externalDomain: 'https://demo.immich.app/' },
      { should: 'without a trailing slash', externalDomain: 'https://demo.immich.app' },
      { should: 'with a port', externalDomain: 'https://demo.immich.app:42', result: 'https://demo.immich.app:42' },
      {
        should: 'with basic auth',
        externalDomain: 'https://user:password@example.com:123',
        result: 'https://user:password@example.com:123',
      },
    ];

    for (const { should, externalDomain, result } of externalDomainTests) {
      it(`should normalize an external domain ${should}`, async () => {
        mocks.config.getEnv.mockReturnValue(mockEnvData({ configFile: 'immich-config.json' }));
        const partialConfig = { server: { externalDomain } };
        mocks.systemMetadata.readFile.mockResolvedValue(JSON.stringify(partialConfig));

        const config = await sut.getSystemConfig();
        expect(config.server.externalDomain).toEqual(result ?? 'https://demo.immich.app');
      });
    }

    it('should warn for unknown options in yaml', async () => {
      mocks.config.getEnv.mockReturnValue(mockEnvData({ configFile: 'immich-config.yaml' }));
      const partialConfig = `
        unknownOption: true
      `;
      mocks.systemMetadata.readFile.mockResolvedValue(partialConfig);

      await sut.getSystemConfig();
      expect(mocks.logger.warn).toHaveBeenCalled();
    });

    const tests = [
      {
        should: 'validate numbers',
        config: { ffmpeg: { crf: 'not-a-number' } },
        throws: '[ffmpeg.crf] Invalid input: expected number, received NaN',
      },
      {
        should: 'validate booleans',
        config: { oauth: { enabled: 'invalid' } },
        throws: '[oauth.enabled] Invalid input: expected boolean, received string',
      },
      {
        should: 'validate enums',
        config: { ffmpeg: { transcode: 'unknown' } },
        throws: '[ffmpeg.transcode] Invalid option: expected one of',
      },
      {
        should: 'validate required oauth fields',
        config: { oauth: { enabled: true } },
        check: (c: SystemConfig) => expect(c.oauth.enabled).toBe(true),
      },
      { should: 'warn for top level unknown options', warn: true, config: { unknownOption: true } },
      { should: 'warn for nested unknown options', warn: true, config: { ffmpeg: { unknownOption: true } } },
    ];

    for (const test of tests) {
      it(`should ${test.should}`, async () => {
        mocks.config.getEnv.mockReturnValue(mockEnvData({ configFile: 'immich-config.json' }));
        mocks.systemMetadata.readFile.mockResolvedValue(JSON.stringify(test.config));

        if (test.throws) {
          await expect(sut.getSystemConfig()).rejects.toThrow(test.throws);
        } else if (test.warn) {
          await sut.getSystemConfig();
          expect(mocks.logger.warn).toHaveBeenCalled();
        } else {
          const config = await sut.getSystemConfig();
          test.check!(config);
        }
      });
    }
  });

  describe('updateConfig', () => {
    it('should reject physical deduplication without a master user', async () => {
      await expect(
        sut.onConfigValidate({
          newConfig: { ...defaults, physicalDeduplication: { enabled: true, masterUserId: null } },
          oldConfig: defaults,
        }),
      ).rejects.toThrow('Physical deduplication requires a master user.');
    });

    it('should reject physical deduplication with a missing master user', async () => {
      mocks.user.get.mockResolvedValue(null as never);

      await expect(
        sut.onConfigValidate({
          newConfig: { ...defaults, physicalDeduplication: { enabled: true, masterUserId: 'missing-user-id' } },
          oldConfig: defaults,
        }),
      ).rejects.toThrow('Physical deduplication master user must exist and be active.');
    });

    it('should allow physical deduplication with an active master user', async () => {
      mocks.user.get.mockResolvedValue({ id: 'master-user-id', deletedAt: null } as never);

      await expect(
        sut.onConfigValidate({
          newConfig: { ...defaults, physicalDeduplication: { enabled: true, masterUserId: 'master-user-id' } },
          oldConfig: defaults,
        }),
      ).resolves.toBeUndefined();
    });

    it('should reject runpod api key changes while pod is provisioning', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ status: 'provisioning' } as never);
      await expect(
        sut.onConfigValidate({
          oldConfig: defaults,
          newConfig: {
            ...defaults,
            machineLearning: {
              ...defaults.machineLearning,
              runpod: { ...defaults.machineLearning.runpod, apiKey: 'new-key' },
            },
          },
        }),
      ).rejects.toThrow(
        /Cannot change RunPod API key, image, or mode while a transition is in flight \(status=provisioning\)/,
      );
    });

    it('should reject runpod image changes while pod is stopping', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ status: 'stopping' } as never);
      await expect(
        sut.onConfigValidate({
          oldConfig: defaults,
          newConfig: {
            ...defaults,
            machineLearning: {
              ...defaults.machineLearning,
              runpod: { ...defaults.machineLearning.runpod, imageName: 'ghcr.io/x/y:new-tag' },
            },
          },
        }),
      ).rejects.toThrow(
        /Cannot change RunPod API key, image, or mode while a transition is in flight \(status=stopping\)/,
      );
    });

    it('should allow runpod api key changes when no pod transition is in flight', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ status: 'running' } as never);
      await expect(
        sut.onConfigValidate({
          oldConfig: defaults,
          newConfig: {
            ...defaults,
            machineLearning: {
              ...defaults.machineLearning,
              runpod: { ...defaults.machineLearning.runpod, apiKey: 'new-key' },
            },
          },
        }),
      ).resolves.toBeUndefined();
    });

    it('should allow runpod api key changes when there is no runpod state at all', async () => {
      mocks.systemMetadata.get.mockResolvedValue(null);
      await expect(
        sut.onConfigValidate({
          oldConfig: defaults,
          newConfig: {
            ...defaults,
            machineLearning: {
              ...defaults.machineLearning,
              runpod: { ...defaults.machineLearning.runpod, apiKey: 'new-key' },
            },
          },
        }),
      ).resolves.toBeUndefined();
    });

    it('should reject mode changes while serverless setup is in flight', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ status: 'serverless-provisioning' } as never);
      await expect(
        sut.onConfigValidate({
          oldConfig: {
            ...defaults,
            machineLearning: {
              ...defaults.machineLearning,
              runpod: { ...defaults.machineLearning.runpod, mode: 'serverless' },
            },
          },
          newConfig: {
            ...defaults,
            machineLearning: {
              ...defaults.machineLearning,
              runpod: { ...defaults.machineLearning.runpod, mode: 'disabled' },
            },
          },
        }),
      ).rejects.toThrow(
        /Cannot change RunPod API key, image, or mode while a transition is in flight \(status=serverless-provisioning\)/,
      );
    });

    it('should reject switching away from pod mode while a pod is running', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ status: 'running' } as never);
      await expect(
        sut.onConfigValidate({
          oldConfig: {
            ...defaults,
            machineLearning: {
              ...defaults.machineLearning,
              runpod: { ...defaults.machineLearning.runpod, mode: 'pod' },
            },
          },
          newConfig: {
            ...defaults,
            machineLearning: {
              ...defaults.machineLearning,
              runpod: { ...defaults.machineLearning.runpod, mode: 'serverless' },
            },
          },
        }),
      ).rejects.toThrow(/Terminate the running pod before switching modes/);
    });

    it('should update the config and emit an event', async () => {
      mocks.systemMetadata.get.mockResolvedValue(partialConfig);
      await expect(sut.updateSystemConfig(updatedConfig)).resolves.toEqual(updatedConfig);
      expect(mocks.event.emit).toHaveBeenCalledWith(
        'ConfigUpdate',
        expect.objectContaining({ oldConfig: expect.any(Object), newConfig: updatedConfig }),
      );
    });

    it('should throw an error if a config file is in use', async () => {
      mocks.config.getEnv.mockReturnValue(mockEnvData({ configFile: 'immich-config.json' }));
      mocks.systemMetadata.readFile.mockResolvedValue(JSON.stringify({}));
      await expect(sut.updateSystemConfig(defaults)).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.systemMetadata.set).not.toHaveBeenCalled();
    });

    it('should redact runpod.apiKey on read via mapConfig', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { runpod: { apiKey: 'rp_secret_value', enabled: true } },
      });

      const result = await sut.getSystemConfig();

      expect(result.machineLearning.runpod.apiKey).toBe('');
    });

    it('should preserve stored runpod.apiKey when an empty value is written back', async () => {
      const storedConfig = {
        machineLearning: { runpod: { apiKey: 'rp_secret_value', enabled: true } },
      };
      mocks.systemMetadata.get.mockResolvedValue(storedConfig);

      // The admin reads the config (apiKey: ''), edits some other field, and saves.
      // The empty apiKey in the submitted DTO must not wipe the stored secret.
      const newConfig = {
        ...defaults,
        machineLearning: {
          ...defaults.machineLearning,
          runpod: { ...defaults.machineLearning.runpod, apiKey: '', enabled: true },
        },
      };

      await sut.updateSystemConfig(newConfig);

      // updateConfig is called with the dto we mutated in-place; verify the
      // preserved-key value is what gets persisted.
      const persisted = (mocks.systemMetadata.set as ReturnType<typeof vi.fn>).mock.calls.find(
        ([key]) => key === 'system-config',
      );
      expect(persisted).toBeDefined();
      // The persisted partial config should include the preserved key.
      const partial = persisted![1] as { machineLearning?: { runpod?: { apiKey?: string } } };
      expect(partial.machineLearning?.runpod?.apiKey).toBe('rp_secret_value');
    });

    describe('imageDescription lastConfigChangeAt bump', () => {
      const baselineDescription = defaults.machineLearning.imageDescription;

      it('should bump lastConfigChangeAt when an imageDescription field changes', async () => {
        // Old config has the baseline.
        mocks.systemMetadata.get.mockResolvedValue({});

        const newConfig: SystemConfig = {
          ...defaults,
          machineLearning: {
            ...defaults.machineLearning,
            imageDescription: {
              ...baselineDescription,
              modelName: 'some-new-model',
            },
          },
        };

        const before = Date.now();
        await sut.updateSystemConfig(newConfig);
        const after = Date.now();

        const persisted = (mocks.systemMetadata.set as ReturnType<typeof vi.fn>).mock.calls.find(
          ([key]) => key === 'system-config',
        );
        expect(persisted).toBeDefined();
        const partial = persisted![1] as {
          machineLearning?: { imageDescription?: { lastConfigChangeAt?: string | null } };
        };
        const bumped = partial.machineLearning?.imageDescription?.lastConfigChangeAt;
        expect(bumped).toBeTypeOf('string');
        const bumpedTime = Date.parse(bumped!);
        expect(bumpedTime).toBeGreaterThanOrEqual(before);
        expect(bumpedTime).toBeLessThanOrEqual(after);
      });

      it('should NOT bump lastConfigChangeAt when only non-imageDescription fields change', async () => {
        const initialLastChange = '2024-01-01T00:00:00.000Z';
        mocks.systemMetadata.get.mockResolvedValue({
          machineLearning: {
            imageDescription: { lastConfigChangeAt: initialLastChange },
          },
        });

        // Change only an FFmpeg setting.
        const newConfig: SystemConfig = {
          ...defaults,
          machineLearning: {
            ...defaults.machineLearning,
            imageDescription: {
              ...baselineDescription,
              // Client sends an empty/null pendingRequeueAt; server must
              // overwrite with the stored value (null in defaults).
              lastConfigChangeAt: initialLastChange,
            },
          },
          ffmpeg: { ...defaults.ffmpeg, crf: 42 },
        };

        const before = Date.now();
        await sut.updateSystemConfig(newConfig);

        // The persisted partial config should NOT include a new
        // imageDescription.lastConfigChangeAt different from the stored one
        // (updateConfig diffs against defaults, so the existing 2024 value
        // would be persisted only if it differs from null — which it does).
        const persisted = (mocks.systemMetadata.set as ReturnType<typeof vi.fn>).mock.calls.find(
          ([key]) => key === 'system-config',
        );
        const partial = persisted![1] as {
          machineLearning?: { imageDescription?: { lastConfigChangeAt?: string | null } };
        };
        const lastChange = partial.machineLearning?.imageDescription?.lastConfigChangeAt;
        // The stored value must NOT have moved forward in time. The persisted
        // partial must either omit the field (filtered out by updateConfig's
        // diff because it equals the default) or carry the exact original
        // ISO string — never a fresh "now" timestamp.
        if (lastChange === undefined || lastChange === null) {
          // Field was filtered out — no fresh bump persisted. Pass.
        } else {
          expect(lastChange).toBe(initialLastChange);
          expect(Date.parse(lastChange)).toBeLessThan(before);
        }
      });

      it('should NOT ratchet on bare timestamp-only diffs (pendingRequeueAt/lastConfigChangeAt are ignored in the compare)', async () => {
        // Old config has timestamps set; client sends back the exact same
        // imageDescription block but with different timestamp values.
        const initialLastChange = '2023-12-31T00:00:00.000Z';
        const initialPendingRequeue = '2024-01-01T00:00:00.000Z';
        mocks.systemMetadata.get.mockResolvedValue({
          machineLearning: {
            imageDescription: {
              pendingRequeueAt: initialPendingRequeue,
              lastConfigChangeAt: initialLastChange,
            },
          },
        });

        // Client tries to send different timestamps — the service must ignore
        // them on input AND must not bump again because the rest of the block
        // is unchanged.
        const newConfig: SystemConfig = {
          ...defaults,
          machineLearning: {
            ...defaults.machineLearning,
            imageDescription: {
              ...baselineDescription,
              pendingRequeueAt: null,
              lastConfigChangeAt: null,
            },
          },
        };

        const before = Date.now();
        await sut.updateSystemConfig(newConfig);

        const persisted = (mocks.systemMetadata.set as ReturnType<typeof vi.fn>).mock.calls.find(
          ([key]) => key === 'system-config',
        );
        const partial = persisted![1] as {
          machineLearning?: {
            imageDescription?: { lastConfigChangeAt?: string | null; pendingRequeueAt?: string | null };
          };
        };
        // The pre-existing stored timestamps must be preserved (server is the
        // source of truth for these two fields). The persisted partial must
        // either omit the field (filtered out by updateConfig diff) or carry
        // the exact original ISO string — never a fresh "now" timestamp.
        const persistedLastChange = partial.machineLearning?.imageDescription?.lastConfigChangeAt;
        if (persistedLastChange === undefined || persistedLastChange === null) {
          // Filtered out — no fresh bump persisted. Pass.
        } else {
          expect(persistedLastChange).toBe(initialLastChange);
          expect(Date.parse(persistedLastChange)).toBeLessThan(before);
        }
        const persistedPendingRequeue = partial.machineLearning?.imageDescription?.pendingRequeueAt;
        if (persistedPendingRequeue === undefined || persistedPendingRequeue === null) {
          // Filtered out — no fresh ratchet persisted. Pass.
        } else {
          expect(persistedPendingRequeue).toBe(initialPendingRequeue);
          expect(Date.parse(persistedPendingRequeue)).toBeLessThan(before);
        }
      });
    });

    it('should accept a non-empty new runpod.apiKey on write (rotation)', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { runpod: { apiKey: 'rp_old_value', enabled: true } },
      });

      const newConfig = {
        ...defaults,
        machineLearning: {
          ...defaults.machineLearning,
          runpod: { ...defaults.machineLearning.runpod, apiKey: 'rp_NEW_value', enabled: true },
        },
      };

      await sut.updateSystemConfig(newConfig);

      const persisted = (mocks.systemMetadata.set as ReturnType<typeof vi.fn>).mock.calls.find(
        ([key]) => key === 'system-config',
      );
      const partial = persisted![1] as { machineLearning?: { runpod?: { apiKey?: string } } };
      expect(partial.machineLearning?.runpod?.apiKey).toBe('rp_NEW_value');
    });
  });

  describe('getCustomCss', () => {
    it('should return the default theme', async () => {
      await expect(sut.getCustomCss()).resolves.toEqual(defaults.theme.customCss);
    });
  });

  describe('estimateDescriptionRequeue', () => {
    it('should fall back to the default rolling average when no telemetry is available', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: {
          imageDescription: {
            enabled: true,
            modelName: 'Qwen/Qwen2.5-VL-3B-Instruct',
            acceleration: MachineLearningHardwareAcceleration.Auto,
          },
        },
      });
      mocks.asset.getDescriptionStats.mockResolvedValue({
        totalAssets: 100,
        withDescription: 40,
        withoutDescription: 60,
      });
      mocks.job.getRollingAvgMs.mockReturnValue(null);

      const result = await sut.estimateDescriptionRequeue();

      expect(result).toMatchObject({
        totalAssets: 100,
        withDescription: 40,
        withoutDescription: 60,
        rollingAvgSeconds: 1.5,
        estimatedTotalSeconds: 100 * 1.5,
        activeModel: 'Qwen/Qwen2.5-VL-3B-Instruct',
      });
      expect(typeof result.activeBackend).toBe('string');
    });

    it('should use the real rolling average when telemetry is available', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: {
          imageDescription: {
            enabled: true,
            modelName: 'Qwen/Qwen2.5-VL-3B-Instruct',
            acceleration: MachineLearningHardwareAcceleration.Auto,
          },
        },
      });
      mocks.asset.getDescriptionStats.mockResolvedValue({
        totalAssets: 50,
        withDescription: 10,
        withoutDescription: 40,
      });
      // 2500 ms / job → 2.5 s
      mocks.job.getRollingAvgMs.mockReturnValue(2500);

      const result = await sut.estimateDescriptionRequeue();

      expect(result.rollingAvgSeconds).toBe(2.5);
      expect(result.estimatedTotalSeconds).toBe(50 * 2.5);
    });
  });

  describe('triggerDescriptionRequeue', () => {
    it('should enqueue the queue-all job and return queued=true when the queue is idle', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { imageDescription: { enabled: true } },
      });
      mocks.job.getJobCounts.mockResolvedValue({
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        waiting: 0,
        paused: 0,
      });

      await expect(sut.triggerDescriptionRequeue()).resolves.toEqual({ queued: true });

      expect(mocks.job.queue).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'ImageDescriptionQueueAll',
          data: { force: true },
        }),
      );
    });

    it('should clear pendingRequeueAt when the requeue successfully enqueues', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: {
          imageDescription: { enabled: true, pendingRequeueAt: '2024-01-01T00:00:00.000Z' },
        },
      });
      mocks.job.getJobCounts.mockResolvedValue({
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        waiting: 0,
        paused: 0,
      });

      await sut.triggerDescriptionRequeue();

      // The system-config write that clears pendingRequeueAt should be the
      // most-recent persist call.
      const persistCalls = (mocks.systemMetadata.set as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([key]) => key === 'system-config',
      );
      expect(persistCalls.length).toBeGreaterThan(0);
      const latest = persistCalls.at(-1)![1] as {
        machineLearning?: { imageDescription?: { pendingRequeueAt?: string | null } };
      };
      // Confirm the cleared value made it into the persisted partial diff.
      expect(latest.machineLearning?.imageDescription?.pendingRequeueAt ?? null).toBeNull();
    });

    it('should return queued=false and not re-enqueue when the queue is already active', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { imageDescription: { enabled: true } },
      });
      mocks.job.getJobCounts.mockResolvedValue({
        active: 1,
        completed: 0,
        failed: 0,
        delayed: 0,
        waiting: 50,
        paused: 0,
      });

      await expect(sut.triggerDescriptionRequeue()).resolves.toEqual({ queued: false });

      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when image description is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { imageDescription: { enabled: false } },
      });

      await expect(sut.triggerDescriptionRequeue()).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when global machine learning is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { enabled: false, imageDescription: { enabled: true } },
      });

      await expect(sut.triggerDescriptionRequeue()).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });
  });

  describe('deferDescriptionRequeue', () => {
    it('should set pendingRequeueAt to an ISO timestamp', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { imageDescription: { enabled: true } },
      });

      const before = Date.now();
      await sut.deferDescriptionRequeue();
      const after = Date.now();

      const persistCalls = (mocks.systemMetadata.set as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([key]) => key === 'system-config',
      );
      const latest = persistCalls.at(-1)![1] as {
        machineLearning?: { imageDescription?: { pendingRequeueAt?: string | null } };
      };
      const written = latest.machineLearning?.imageDescription?.pendingRequeueAt;
      expect(written).toBeTypeOf('string');
      const parsed = Date.parse(written!);
      expect(parsed).toBeGreaterThanOrEqual(before);
      expect(parsed).toBeLessThanOrEqual(after);
    });

    it('should throw BadRequestException when image description is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { imageDescription: { enabled: false } },
      });

      await expect(sut.deferDescriptionRequeue()).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('estimateSmartAlbumReevaluate', () => {
    it('should return the count of assets with a completed description', async () => {
      mocks.asset.getDescriptionStats.mockResolvedValue({
        totalAssets: 200,
        withDescription: 80,
        withoutDescription: 120,
      });

      const result = await sut.estimateSmartAlbumReevaluate();

      expect(result).toEqual({ totalAssets: 80, withDescription: 80 });
    });
  });

  describe('triggerSmartAlbumReevaluate', () => {
    it('should enqueue the re-evaluate job and return queued=true when no dedup job is in flight', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        smartAlbums: { enabled: true },
      });
      mocks.job.hasDedupJob.mockResolvedValue(false);

      const result = await sut.triggerSmartAlbumReevaluate();

      expect(result).toEqual({ queued: true });
      expect(mocks.job.queue).toHaveBeenCalledWith(expect.objectContaining({ name: 'SmartAlbumReevaluateAll' }));
    });

    it('should return queued=false and not re-enqueue when a dedup job is already in flight', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        smartAlbums: { enabled: true },
      });
      mocks.job.hasDedupJob.mockResolvedValue(true);

      const result = await sut.triggerSmartAlbumReevaluate();

      expect(result).toEqual({ queued: false });
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('should enqueue with kind-scoped dedup when a kind is provided', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ smartAlbums: { enabled: true } });
      mocks.job.hasDedupJob.mockResolvedValue(false);

      const result = await sut.triggerSmartAlbumReevaluate({ kind: 'food' });

      expect(result).toEqual({ queued: true });
      expect(mocks.job.hasDedupJob).toHaveBeenCalledWith(QueueName.BackgroundTask, 'SmartAlbumReevaluateAll:food');
      expect(mocks.job.queue).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'SmartAlbumReevaluateAll', data: { kind: 'food' } }),
      );
    });

    it('should reject an unknown kind', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ smartAlbums: { enabled: true } });

      await expect(sut.triggerSmartAlbumReevaluate({ kind: 'not-a-real-kind' as never })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when smartAlbums is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        smartAlbums: { enabled: false },
      });

      await expect(sut.triggerSmartAlbumReevaluate()).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });
  });
});
