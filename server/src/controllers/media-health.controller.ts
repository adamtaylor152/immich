import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  MediaHealthBulkActionDto,
  MediaHealthBulkResponseDto,
  MediaHealthDeleteCorruptDto,
  MediaHealthListQueryDto,
  MediaHealthListResponseDto,
  MediaHealthScanResponseDto,
} from 'src/dtos/media-health.dto';
import { ApiTag } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { MediaHealthService } from 'src/services/media-health.service';

@ApiTags(ApiTag.MediaHealth)
@Controller('media-health')
export class MediaHealthController {
  constructor(private service: MediaHealthService) {}

  @Get()
  @Authenticated()
  @Endpoint({
    summary: 'List media health findings',
    description: 'List missing and corrupt media health findings in timeline buckets.',
    history: new HistoryBuilder().added('v3.0.0').alpha('v3.0.0'),
  })
  list(@Auth() auth: AuthDto, @Query() dto: MediaHealthListQueryDto): Promise<MediaHealthListResponseDto> {
    return this.service.list(auth, dto);
  }

  @Post('missing/scan')
  @Authenticated()
  @Endpoint({
    summary: 'Start missing media scan',
    description: 'Queue an owner-scoped scan that identifies missing files and restores supported untracked media.',
    history: new HistoryBuilder().added('v3.0.0').alpha('v3.0.0'),
  })
  startMissingScan(@Auth() auth: AuthDto): Promise<MediaHealthScanResponseDto> {
    return this.service.startMissingScan(auth);
  }

  @Post('missing/locate')
  @Authenticated()
  @Endpoint({
    summary: 'Locate missing media',
    description: 'Queue exact-checksum candidate discovery across managed user storage.',
    history: new HistoryBuilder().added('v3.0.0').alpha('v3.0.0'),
  })
  locateMissing(@Auth() auth: AuthDto, @Body() dto: MediaHealthBulkActionDto): Promise<MediaHealthScanResponseDto> {
    return this.service.locateMissing(auth, dto);
  }

  @Post('missing/relink')
  @Authenticated()
  @Endpoint({
    summary: 'Relink missing media',
    description: 'Relink owned missing assets to validated candidate files.',
    history: new HistoryBuilder().added('v3.0.0').alpha('v3.0.0'),
  })
  relinkMissing(@Auth() auth: AuthDto, @Body() dto: MediaHealthBulkActionDto): Promise<MediaHealthBulkResponseDto> {
    return this.service.relinkMissing(auth, dto);
  }

  @Post('corrupt/scan')
  @Authenticated()
  @Endpoint({
    summary: 'Start corrupt media scan',
    description: 'Queue an explicit scan that validates source media integrity.',
    history: new HistoryBuilder().added('v3.0.0').alpha('v3.0.0'),
  })
  startCorruptScan(@Auth() auth: AuthDto): Promise<MediaHealthScanResponseDto> {
    return this.service.startCorruptScan(auth);
  }

  @Post('dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Authenticated()
  @Endpoint({
    summary: 'Dismiss media health findings',
    description: 'Dismiss selected media health findings without modifying assets.',
    history: new HistoryBuilder().added('v3.0.0').alpha('v3.0.0'),
  })
  dismiss(@Auth() auth: AuthDto, @Body() dto: MediaHealthBulkActionDto): Promise<void> {
    return this.service.dismiss(auth, dto);
  }

  @Delete('corrupt')
  @Authenticated()
  @Endpoint({
    summary: 'Move confirmed corrupt media to trash',
    description: 'Move recently confirmed corrupt media findings to trash after revalidation.',
    history: new HistoryBuilder().added('v3.0.0').alpha('v3.0.0'),
  })
  deleteCorrupt(@Auth() auth: AuthDto, @Body() dto: MediaHealthDeleteCorruptDto): Promise<MediaHealthBulkResponseDto> {
    return this.service.deleteCorrupt(auth, dto);
  }
}
