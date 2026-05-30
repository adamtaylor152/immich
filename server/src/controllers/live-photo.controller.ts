import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  LivePhotoCandidatesResponseDto,
  LivePhotoRelinkDto,
  LivePhotoRelinkResponseDto,
} from 'src/dtos/live-photo.dto';
import { ApiTag } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { LivePhotoService } from 'src/services/live-photo.service';

@ApiTags(ApiTag.LivePhoto)
@Controller('live-photo')
export class LivePhotoController {
  constructor(private service: LivePhotoService) {}

  @Get('candidates')
  @Authenticated()
  @Endpoint({
    summary: 'List live photo relink candidates',
    description:
      'Find separated live photos (a still image and its motion video that are not linked) that can be reassembled.',
    history: new HistoryBuilder().added('v3.0.0').alpha('v3.0.0'),
  })
  getLivePhotoCandidates(@Auth() auth: AuthDto): Promise<LivePhotoCandidatesResponseDto> {
    return this.service.getCandidates(auth);
  }

  @Post('relink')
  @Authenticated()
  @Endpoint({
    summary: 'Relink live photos',
    description: 'Reassemble the selected still + video pairs into live photos, hiding the standalone videos.',
    history: new HistoryBuilder().added('v3.0.0').alpha('v3.0.0'),
  })
  relinkLivePhotos(@Auth() auth: AuthDto, @Body() dto: LivePhotoRelinkDto): Promise<LivePhotoRelinkResponseDto> {
    return this.service.relink(auth, dto);
  }
}
