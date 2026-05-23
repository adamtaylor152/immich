import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { ApiBody, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import {
  ImageDescriptionRequeueEstimateDto,
  ImageDescriptionRequeueResponseDto,
  MachineLearningHardwareResponseDto,
  SmartAlbumReevaluateEstimateDto,
  SmartAlbumReevaluateRequestDto,
  SmartAlbumReevaluateResponseDto,
  SystemConfigDto,
  SystemConfigTemplateStorageOptionDto,
} from 'src/dtos/system-config.dto';
import { ApiTag, Permission } from 'src/enum';
import { Authenticated } from 'src/middleware/auth.guard';
import { StorageTemplateService } from 'src/services/storage-template.service';
import { SystemConfigService } from 'src/services/system-config.service';

@ApiTags(ApiTag.SystemConfig)
@Controller('system-config')
export class SystemConfigController {
  constructor(
    private service: SystemConfigService,
    private storageTemplateService: StorageTemplateService,
  ) {}

  @Get()
  @Authenticated({ permission: Permission.SystemConfigRead, admin: true })
  @Endpoint({
    summary: 'Get system configuration',
    description: 'Retrieve the current system configuration.',
    history: new HistoryBuilder().added('v1').beta('v1').stable('v2'),
  })
  getConfig(): Promise<SystemConfigDto> {
    return this.service.getSystemConfig();
  }

  @Get('defaults')
  @Authenticated({ permission: Permission.SystemConfigRead, admin: true })
  @Endpoint({
    summary: 'Get system configuration defaults',
    description: 'Retrieve the default values for the system configuration.',
    history: new HistoryBuilder().added('v1').beta('v1').stable('v2'),
  })
  getConfigDefaults(): SystemConfigDto {
    return this.service.getDefaults();
  }

  @Get('machine-learning/hardware')
  @Authenticated({ permission: Permission.SystemConfigRead, admin: true })
  @Endpoint({
    summary: 'Get machine learning hardware',
    description: 'Retrieve available hardware acceleration providers from the machine learning service.',
    history: new HistoryBuilder().added('v1').beta('v1').stable('v2'),
  })
  getMachineLearningHardware(): Promise<MachineLearningHardwareResponseDto> {
    return this.service.getMachineLearningHardware();
  }

  @Put()
  @Authenticated({ permission: Permission.SystemConfigUpdate, admin: true })
  @Endpoint({
    summary: 'Update system configuration',
    description: 'Update the system configuration with a new system configuration.',
    history: new HistoryBuilder().added('v1').beta('v1').stable('v2'),
  })
  updateConfig(@Body() dto: SystemConfigDto): Promise<SystemConfigDto> {
    return this.service.updateSystemConfig(dto);
  }

  @Get('storage-template-options')
  @Authenticated({ permission: Permission.SystemConfigRead, admin: true })
  @Endpoint({
    summary: 'Get storage template options',
    description: 'Retrieve exemplary storage template options.',
    history: new HistoryBuilder().added('v1').beta('v1').stable('v2'),
  })
  getStorageTemplateOptions(): SystemConfigTemplateStorageOptionDto {
    return this.storageTemplateService.getStorageTemplateOptions();
  }

  @Get('image-description/requeue-estimate')
  @Authenticated({ permission: Permission.SystemConfigRead, admin: true })
  @Endpoint({
    summary: 'Estimate image description re-queue cost',
    description:
      'Returns asset counts and a rough time estimate for re-running the image description pipeline over all eligible assets.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  getImageDescriptionRequeueEstimate(): Promise<ImageDescriptionRequeueEstimateDto> {
    return this.service.estimateDescriptionRequeue();
  }

  @Post('image-description/requeue')
  @Authenticated({ permission: Permission.SystemConfigUpdate, admin: true })
  @Endpoint({
    summary: 'Trigger image description re-queue',
    description:
      'Enqueues a bulk re-queue of the image description pipeline for all eligible assets. Idempotent: if image-description work is already active or waiting, the call returns without re-enqueuing.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  @ApiResponse({ status: 400, description: 'Image description is not enabled.' })
  triggerImageDescriptionRequeue(): Promise<ImageDescriptionRequeueResponseDto> {
    return this.service.triggerDescriptionRequeue();
  }

  @Post('image-description/defer-requeue')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Authenticated({ permission: Permission.SystemConfigUpdate, admin: true })
  @Endpoint({
    summary: 'Defer image description re-queue',
    description:
      'Marks the image description config as having a pending re-queue. The persistent banner on the admin Image Description settings page will surface a reminder until the actual re-queue is triggered.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  @ApiResponse({ status: 400, description: 'Image description is not enabled.' })
  async deferImageDescriptionRequeue(): Promise<void> {
    await this.service.deferDescriptionRequeue();
  }

  @Get('smart-albums/reevaluate-estimate')
  @Authenticated({ permission: Permission.SystemConfigRead, admin: true })
  @Endpoint({
    summary: 'Estimate smart-album re-evaluate cost',
    description:
      'Returns the number of image assets that have a completed description and will be re-evaluated by the re-evaluate job.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  getSmartAlbumReevaluateEstimate(): Promise<SmartAlbumReevaluateEstimateDto> {
    return this.service.estimateSmartAlbumReevaluate();
  }

  @Post('smart-albums/reevaluate')
  @Authenticated({ permission: Permission.SystemConfigUpdate, admin: true })
  @Endpoint({
    summary: 'Trigger smart-album re-evaluate',
    description:
      'Enqueues a bulk re-evaluation of all described image assets against the smart-album tag rules. Pass an optional `kind` body field to scope the re-evaluation to a single built-in kind. Idempotent via BullMQ deduplication (kind-scoped dispatches use their own dedup namespace).',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  @ApiResponse({ status: 400, description: 'Smart albums are not enabled, or invalid kind.' })
  @ApiBody({ required: false, type: SmartAlbumReevaluateRequestDto })
  triggerSmartAlbumReevaluate(
    @Body() dto?: SmartAlbumReevaluateRequestDto,
  ): Promise<SmartAlbumReevaluateResponseDto> {
    return this.service.triggerSmartAlbumReevaluate(dto ?? ({} as SmartAlbumReevaluateRequestDto));
  }
}
