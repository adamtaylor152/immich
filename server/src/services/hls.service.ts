import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { constants } from 'node:fs';
import { join } from 'node:path';
import {
  HLS_SEGMENT_DURATION,
  HLS_VARIANTS,
  HLS_VERSION,
  SEGMENT_FILENAME_REGEX,
  SUPPORTED_HWA_CODECS,
} from 'src/constants';
import { StorageCore } from 'src/cores/storage.core';
import { OnEvent } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import { SystemConfigFFmpegDto } from 'src/dtos/system-config.dto';
import { CacheControl, ImmichWorker, Permission } from 'src/enum';
import { ArgOf } from 'src/repositories/event.repository';
import { BaseService } from 'src/services/base.service';
import { VideoPacketInfo, VideoStreamInfo } from 'src/types';
import { PendingEvents } from 'src/utils/event';
import { ImmichFileResponse } from 'src/utils/file';
import { getOutputSize } from 'src/utils/media';

type AssetWithStreamInfo = { videoStream: VideoStreamInfo & { timeBase: number }; packets: VideoPacketInfo };

@Injectable()
export class HlsService extends BaseService {
  private pendingSegments = new PendingEvents<'HlsSegmentResult'>(15_000);
  private pendingSessions = new PendingEvents<'HlsSessionResult'>(5000);
  private sessions = new Map<string, { lastRequestedSegment: number | null }>();

  @OnEvent({ name: 'HlsSessionResult', server: true, workers: [ImmichWorker.Api] })
  onSessionResult(event: ArgOf<'HlsSessionResult'>) {
    this.pendingSessions.complete(event.sessionId, event);
    if (event.error) {
      this.sessions.delete(event.sessionId);
      this.pendingSegments.rejectByPrefix(`${event.sessionId}:`, event.error);
    }
  }

  @OnEvent({ name: 'HlsSessionEnd', server: true, workers: [ImmichWorker.Api] })
  onSessionEnd({ sessionId }: ArgOf<'HlsSessionEnd'>) {
    this.sessions.delete(sessionId);
    this.pendingSegments.rejectByPrefix(`${sessionId}:`, 'Session ended');
  }

  @OnEvent({ name: 'HlsSegmentResult', server: true, workers: [ImmichWorker.Api] })
  onSegmentResult(event: ArgOf<'HlsSegmentResult'>) {
    this.pendingSegments.complete(this.getSegmentKey(event), event);
  }

  async getMasterPlaylist(auth: AuthDto, assetId: string) {
    await this.requireAccess({ auth, permission: Permission.AssetView, ids: [assetId] });
    const { ffmpeg } = await this.getConfig({ withCache: true });
    if (!ffmpeg.realtime.enabled) {
      throw new BadRequestException('Real-time transcoding is not enabled');
    }

    const asset = await this.videoStreamRepository.getForMasterPlaylist(assetId);
    if (!asset) {
      throw new NotFoundException('Asset is not yet ready for streaming');
    }

    const sessionId = this.cryptoRepository.randomUUID();
    this.websocketRepository.serverSend('HlsSessionRequest', { sessionId, assetId, ownerId: auth.user.id });
    await this.pendingSessions.wait(sessionId);
    this.sessions.set(sessionId, { lastRequestedSegment: null });

    return this.generateMasterPlaylist(sessionId, ffmpeg, asset);
  }

  async getMediaPlaylist(auth: AuthDto, assetId: string, sessionId: string) {
    await this.requireAccess({ auth, permission: Permission.AssetView, ids: [assetId] });

    const asset = await this.videoStreamRepository.getForMediaPlaylist(assetId, sessionId);
    if (!asset) {
      throw new NotFoundException('Asset not found or not yet ready for streaming');
    }

    return this.generateMediaPlaylist(asset);
  }

  async getSegment(auth: AuthDto, assetId: string, sessionId: string, variantIndex: number, filename: string) {
    const t0 = performance.now();
    await this.requireAccess({ auth, permission: Permission.AssetView, ids: [assetId] });
    const t1 = performance.now();

    const session = await this.videoStreamRepository.getSession(sessionId);
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    const t2 = performance.now();

    const variantDir = StorageCore.getHlsVariantFolder({ ownerId: auth.user.id, sessionId, variantIndex });
    const path = join(variantDir, filename);
    const response = new ImmichFileResponse({
      path,
      contentType: 'video/mp4',
      cacheControl: CacheControl.PrivateWithCache,
    });

    const segmentIndex = this.getSegmentIndex(sessionId, filename);
    this.websocketRepository.serverSend('HlsHeartbeat', { sessionId, variantIndex, segmentIndex });

    if (await this.storageRepository.checkFileExists(path, constants.R_OK)) {
      this.logger.log(
        `[TIMING] getSegment(cached) session=${sessionId} variant=${variantIndex} file=${filename} ` +
          `auth=${(t1 - t0).toFixed(1)}ms session=${(t2 - t1).toFixed(1)}ms ` +
          `total=${(performance.now() - t0).toFixed(1)}ms`,
      );
      return response;
    }
    const t3 = performance.now();

    this.websocketRepository.serverSend('HlsSegmentRequest', { sessionId, assetId, variantIndex, segmentIndex });
    await this.pendingSegments.wait(this.getSegmentKey({ sessionId, variantIndex, segmentIndex }));
    const t4 = performance.now();

    this.logger.log(
      `[TIMING] getSegment(wait) session=${sessionId} variant=${variantIndex} file=${filename} ` +
        `auth=${(t1 - t0).toFixed(1)}ms session=${(t2 - t1).toFixed(1)}ms ` +
        `existsCheck=${(t3 - t2).toFixed(1)}ms wait=${(t4 - t3).toFixed(1)}ms ` +
        `total=${(t4 - t0).toFixed(1)}ms`,
    );

    return response;
  }

  async endSession(auth: AuthDto, assetId: string, sessionId: string): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.AssetView, ids: [assetId] });

    this.websocketRepository.serverSend('HlsSessionEnd', { sessionId });
  }

  private generateMasterPlaylist(sessionId: string, ffmpeg: SystemConfigFFmpegDto, asset: AssetWithStreamInfo) {
    const fps = ((asset.packets.packetCount * asset.videoStream.timeBase) / asset.packets.totalDuration).toFixed(3);
    const sourceResolution = Math.min(asset.videoStream.height, asset.videoStream.width);
    const lines = ['#EXTM3U', `#EXT-X-VERSION:${HLS_VERSION}`];
    for (let i = 0; i < HLS_VARIANTS.length; i++) {
      const { resolution, bitrate, codec, codecString } = HLS_VARIANTS[i];
      if (resolution > sourceResolution || !SUPPORTED_HWA_CODECS[ffmpeg.accel].includes(codec)) {
        continue;
      }
      const { width, height } = getOutputSize(asset.videoStream, resolution);
      lines.push(
        `#EXT-X-STREAM-INF:BANDWIDTH=${bitrate},RESOLUTION=${width}x${height},CODECS="${codecString},mp4a.40.2",VIDEO-RANGE=SDR,FRAME-RATE=${fps}`,
        `${sessionId}/${i}/playlist.m3u8`,
      );
    }
    lines.push('');

    if (lines.length === 3) {
      throw new NotFoundException('No supported variants for this video');
    }

    return lines.join('\n');
  }

  private generateMediaPlaylist({ videoStream, packets }: AssetWithStreamInfo) {
    const fps = (packets.packetCount * videoStream.timeBase) / packets.totalDuration;
    const framesPerSegment = Math.ceil(HLS_SEGMENT_DURATION * fps);
    const fullSegmentDuration = framesPerSegment / fps;
    const segmentCount = Math.ceil(packets.outputFrames / framesPerSegment);
    const lastSegmentFrames = packets.outputFrames - framesPerSegment * (segmentCount - 1);
    const lastSegmentDuration = lastSegmentFrames / fps;

    const lines = [
      '#EXTM3U',
      `#EXT-X-VERSION:${HLS_VERSION}`,
      `#EXT-X-TARGETDURATION:${HLS_SEGMENT_DURATION}`,
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXT-X-PLAYLIST-TYPE:VOD',
      '#EXT-X-MAP:URI="init.mp4"',
    ];

    for (let i = 0; i < segmentCount - 1; i++) {
      lines.push(`#EXTINF:${fullSegmentDuration.toFixed(6)},`, `seg_${i}.m4s`);
    }
    lines.push(`#EXTINF:${lastSegmentDuration.toFixed(6)},`, `seg_${segmentCount - 1}.m4s`, '#EXT-X-ENDLIST', '');

    return lines.join('\n');
  }

  private getSegmentKey({ sessionId, variantIndex, segmentIndex }: ArgOf<'HlsSegmentResult'>) {
    return `${sessionId}:${variantIndex}:${segmentIndex}`;
  }

  private getSegmentIndex(sessionId: string, filename: string) {
    const existing = this.sessions.get(sessionId);
    if (filename.endsWith('.mp4')) {
      return (existing?.lastRequestedSegment ?? -1) + 1;
    }
    const segmentIndex = Number.parseInt(SEGMENT_FILENAME_REGEX.exec(filename)![1]);
    if (existing) {
      existing.lastRequestedSegment = segmentIndex;
    } else {
      this.sessions.set(sessionId, { lastRequestedSegment: segmentIndex });
    }
    return segmentIndex;
  }
}
