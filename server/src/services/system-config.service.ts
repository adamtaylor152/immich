import { BadRequestException, Injectable } from '@nestjs/common';
import _ from 'lodash';
import { defaults } from 'src/config';
import { OnEvent } from 'src/decorators';
import {
  ImageDescriptionRequeueEstimateDto,
  ImageDescriptionRequeueResponseDto,
  mapConfig,
  SystemConfigDto,
} from 'src/dtos/system-config.dto';
import { BootstrapEventPriority, JobName, QueueName } from 'src/enum';
import { ArgOf } from 'src/repositories/event.repository';
import { MachineLearningHardwareResponse } from 'src/repositories/machine-learning.repository';
import { BaseService } from 'src/services/base.service';
import { clearConfigCache } from 'src/utils/config';
import { toPlainObject } from 'src/utils/object';

/** Default per-asset estimate when no telemetry data is available. */
const DEFAULT_SECONDS_PER_ASSET = 1.5;

@Injectable()
export class SystemConfigService extends BaseService {
  @OnEvent({ name: 'AppBootstrap', priority: BootstrapEventPriority.SystemConfig })
  async onBootstrap() {
    const config = await this.getConfig({ withCache: false });
    await this.eventRepository.emit('ConfigInit', { newConfig: config });
  }

  @OnEvent({ name: 'AppShutdown' })
  onShutdown() {
    this.machineLearningRepository.teardown();
  }

  async getSystemConfig(): Promise<SystemConfigDto> {
    const config = await this.getConfig({ withCache: false });
    return mapConfig(config);
  }

  getDefaults(): SystemConfigDto {
    return mapConfig(defaults);
  }

  getMachineLearningHardware(): Promise<MachineLearningHardwareResponse> {
    return this.machineLearningRepository.getHardware();
  }

  @OnEvent({ name: 'ConfigInit', priority: -100 })
  onConfigInit({ newConfig: { logging, machineLearning } }: ArgOf<'ConfigInit'>) {
    const { logLevel: envLevel } = this.configRepository.getEnv();
    const configLevel = logging.enabled ? logging.level : false;
    const level = envLevel ?? configLevel;
    this.logger.setLogLevel(level);
    this.logger.log(`LogLevel=${level} ${envLevel ? '(set via IMMICH_LOG_LEVEL)' : '(set via system config)'}`);

    this.machineLearningRepository.setup(machineLearning);
  }

  @OnEvent({ name: 'ConfigUpdate', server: true })
  onConfigUpdate({ newConfig }: ArgOf<'ConfigUpdate'>) {
    this.onConfigInit({ newConfig });
    clearConfigCache();
  }

  @OnEvent({ name: 'ConfigValidate' })
  async onConfigValidate({ newConfig, oldConfig }: ArgOf<'ConfigValidate'>) {
    const { logLevel } = this.configRepository.getEnv();
    if (!_.isEqual(toPlainObject(newConfig.logging), oldConfig.logging) && logLevel) {
      throw new Error('Logging cannot be changed while the environment variable IMMICH_LOG_LEVEL is set.');
    }

    const { physicalDeduplication } = newConfig;
    if (physicalDeduplication.enabled) {
      if (!physicalDeduplication.masterUserId) {
        throw new Error('Physical deduplication requires a master user.');
      }

      const masterUser = await this.userRepository.get(physicalDeduplication.masterUserId, {});
      if (!masterUser || masterUser.deletedAt) {
        throw new Error('Physical deduplication master user must exist and be active.');
      }
    }
  }

  async updateSystemConfig(dto: SystemConfigDto): Promise<SystemConfigDto> {
    const { configFile } = this.configRepository.getEnv();
    if (configFile) {
      throw new BadRequestException('Cannot update configuration while IMMICH_CONFIG_FILE is in use');
    }

    const oldConfig = await this.getConfig({ withCache: false });

    try {
      await this.eventRepository.emit('ConfigValidate', { newConfig: toPlainObject(dto), oldConfig });
    } catch (error) {
      this.logger.warn(`Unable to save system config due to a validation error: ${error}`);
      throw new BadRequestException(error instanceof Error ? error.message : error);
    }

    const newConfig = await this.updateConfig(dto);

    await this.eventRepository.emit('ConfigUpdate', { newConfig, oldConfig });

    return mapConfig(newConfig);
  }

  async getCustomCss(): Promise<string> {
    const { theme } = await this.getConfig({ withCache: false });
    return theme.customCss;
  }

  async estimateDescriptionRequeue(): Promise<ImageDescriptionRequeueEstimateDto> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    const stats = await this.assetRepository.getDescriptionStats();

    // TODO(PR 4a): replace with a real rolling-average query over job completion
    // telemetry once per-job duration tracking is added. For now, use a
    // conservative default that is clearly labelled as an estimate.
    const rollingAvgSeconds = DEFAULT_SECONDS_PER_ASSET;
    const estimatedTotalSeconds = stats.totalAssets * rollingAvgSeconds;

    return {
      totalAssets: stats.totalAssets,
      withDescription: stats.withDescription,
      withoutDescription: stats.withoutDescription,
      rollingAvgSeconds,
      estimatedTotalSeconds,
      activeBackend: machineLearning.imageDescription.acceleration,
      activeModel: machineLearning.imageDescription.modelName,
    };
  }

  async triggerDescriptionRequeue(): Promise<ImageDescriptionRequeueResponseDto> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    if (!machineLearning.imageDescription.enabled) {
      throw new BadRequestException('Image description is not enabled');
    }

    // BullMQ deduplication (set up in job.repository.ts) prevents double-enqueueing
    // the queue-all job. We surface the result to the caller so the UI can react.
    const counts = await this.jobRepository.getJobCounts(QueueName.ImageDescription);
    const alreadyInFlight = (counts.active ?? 0) + (counts.waiting ?? 0) > 0;

    if (!alreadyInFlight) {
      await this.jobRepository.queue({ name: JobName.ImageDescriptionQueueAll, data: { force: true } });
    }

    return { queued: !alreadyInFlight };
  }
}
