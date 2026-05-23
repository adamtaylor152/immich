import { BadRequestException, Injectable } from '@nestjs/common';
import _ from 'lodash';
import { defaults } from 'src/config';
import { OnEvent } from 'src/decorators';
import { mapConfig, SystemConfigDto } from 'src/dtos/system-config.dto';
import { BootstrapEventPriority, SystemMetadataKey } from 'src/enum';
import { ArgOf } from 'src/repositories/event.repository';
import { MachineLearningHardwareResponse } from 'src/repositories/machine-learning.repository';
import { BaseService } from 'src/services/base.service';
import { clearConfigCache } from 'src/utils/config';
import { toPlainObject } from 'src/utils/object';

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

    const oldRunpod = oldConfig.machineLearning.runpod;
    const newRunpod = newConfig.machineLearning.runpod;
    if (oldRunpod.apiKey !== newRunpod.apiKey || oldRunpod.imageName !== newRunpod.imageName) {
      const runpodState = await this.systemMetadataRepository.get(SystemMetadataKey.RunPodState);
      const inFlight = runpodState && ['provisioning', 'starting', 'stopping'].includes(runpodState.status);
      if (inFlight) {
        throw new Error(
          `Cannot change RunPod API key or image while a pod is ${runpodState!.status}. Wait for the transition to settle, then retry.`,
        );
      }
    }
  }

  async updateSystemConfig(dto: SystemConfigDto): Promise<SystemConfigDto> {
    const { configFile } = this.configRepository.getEnv();
    if (configFile) {
      throw new BadRequestException('Cannot update configuration while IMMICH_CONFIG_FILE is in use');
    }

    const oldConfig = await this.getConfig({ withCache: false });

    // mapConfig redacts machineLearning.runpod.apiKey to '' on read. Mirror
    // the convention on write: an empty incoming apiKey means "preserve the
    // existing value" (the user didn't intend to rotate the key), not "wipe
    // the stored key". The user can clear the key by toggling RunPod off, or
    // by sending a different non-empty placeholder; sending the redacted
    // sentinel back unchanged must not destroy the real secret.
    const incomingRunpodKey = dto.machineLearning?.runpod?.apiKey;
    if (incomingRunpodKey === '' && oldConfig.machineLearning.runpod.apiKey !== '') {
      dto.machineLearning.runpod.apiKey = oldConfig.machineLearning.runpod.apiKey;
    }

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
}
