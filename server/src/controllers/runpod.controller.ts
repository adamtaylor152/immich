import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import {
  RunPodBackfillResultDto,
  RunPodConnectionResultDto,
  RunPodConnectionTestDto,
  RunPodGpuTypeDto,
  RunPodProvisionDto,
  RunPodStateDto,
} from 'src/dtos/runpod.dto';
import { ApiTag, Permission } from 'src/enum';
import { Authenticated } from 'src/middleware/auth.guard';
import { RunPodService } from 'src/services/runpod.service';

@ApiTags(ApiTag.RunPod)
@Controller('runpod')
export class RunPodController {
  constructor(private service: RunPodService) {}

  @Post('connect')
  @HttpCode(HttpStatus.OK)
  @Authenticated({ permission: Permission.SystemConfigUpdate, admin: true })
  @Endpoint({
    summary: 'Test RunPod connection',
    description: 'Verify that a RunPod API key works. Pass `apiKey` to test a candidate key without saving.',
    history: new HistoryBuilder().added('v2'),
  })
  testConnection(@Body() dto: RunPodConnectionTestDto): Promise<RunPodConnectionResultDto> {
    return this.service.testConnection(dto.apiKey);
  }

  @Get('gpus')
  @Authenticated({ permission: Permission.SystemConfigRead, admin: true })
  @Endpoint({
    summary: 'List RunPod GPU types',
    description: 'Returns the GPU types currently offered by RunPod, with pricing.',
    history: new HistoryBuilder().added('v2'),
  })
  listGpus(): Promise<RunPodGpuTypeDto[]> {
    return this.service.listGpuTypes();
  }

  @Get('pods/current')
  @Authenticated({ permission: Permission.SystemConfigRead, admin: true })
  @Endpoint({
    summary: 'Get current RunPod state',
    description: 'Returns the current managed RunPod pod state (idle / provisioning / running / etc).',
    history: new HistoryBuilder().added('v2'),
  })
  getCurrent(): Promise<RunPodStateDto> {
    return this.service.getCurrentState();
  }

  @Post('pods')
  @Authenticated({ permission: Permission.SystemConfigUpdate, admin: true })
  @Endpoint({
    summary: 'Provision a RunPod pod',
    description: 'Launch the ML container on RunPod and inject the proxy URL into the live ML config.',
    history: new HistoryBuilder().added('v2'),
  })
  provision(@Body() dto: RunPodProvisionDto): Promise<RunPodStateDto> {
    return this.service.provision(dto);
  }

  @Post('pods/current/stop')
  @HttpCode(HttpStatus.OK)
  @Authenticated({ permission: Permission.SystemConfigUpdate, admin: true })
  @Endpoint({
    summary: 'Stop the current RunPod pod',
    description: 'Stops the pod but keeps the model-cache volume so a future start is fast.',
    history: new HistoryBuilder().added('v2'),
  })
  stop(): Promise<RunPodStateDto> {
    return this.service.stop();
  }

  @Post('pods/current/start')
  @HttpCode(HttpStatus.OK)
  @Authenticated({ permission: Permission.SystemConfigUpdate, admin: true })
  @Endpoint({
    summary: 'Resume the current RunPod pod',
    description: 'Start a previously stopped pod, reusing its model cache.',
    history: new HistoryBuilder().added('v2'),
  })
  start(): Promise<RunPodStateDto> {
    return this.service.start();
  }

  @Delete('pods/current')
  @Authenticated({ permission: Permission.SystemConfigUpdate, admin: true })
  @Endpoint({
    summary: 'Terminate the current RunPod pod',
    description: 'Destroys the pod and its persistent volume. Next launch is a full cold-start.',
    history: new HistoryBuilder().added('v2'),
  })
  terminate(): Promise<RunPodStateDto> {
    return this.service.terminate();
  }

  @Post('backfill')
  @HttpCode(HttpStatus.OK)
  @Authenticated({ permission: Permission.SystemConfigUpdate, admin: true })
  @Endpoint({
    summary: 'Enqueue all ML backfill jobs',
    description: 'Queues smart-search, face detection, duplicates, OCR, image description, and NSFW detection.',
    history: new HistoryBuilder().added('v2'),
  })
  backfill(): Promise<RunPodBackfillResultDto> {
    return this.service.runBackfill();
  }
}
