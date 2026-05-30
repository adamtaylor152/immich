import { Injectable } from '@nestjs/common';
import { mapAsset } from 'src/dtos/asset-response.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  LivePhotoCandidatesResponseDto,
  LivePhotoRelinkDto,
  LivePhotoRelinkResponseDto,
} from 'src/dtos/live-photo.dto';
import { AssetType, AssetVisibility } from 'src/enum';
import { AlbumRepository } from 'src/repositories/album.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { LivePhotoCandidateRow, LivePhotoRepository } from 'src/repositories/live-photo.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { linkLivePhotoAssets } from 'src/utils/asset.util';

// A live photo's still and motion video are written within the same capture
// instant, so a tight window keeps the filename fallback conservative.
const FILENAME_MATCH_WINDOW_SECONDS = 2;
// Cap returned pairs so a large library cannot produce an unbounded payload.
const MAX_CANDIDATES = 200;

type Confidence = 'high' | 'low';
type CandidatePair = LivePhotoCandidateRow & { confidence: Confidence };

@Injectable()
export class LivePhotoService {
  constructor(
    private logger: LoggingRepository,
    private assetRepository: AssetRepository,
    private albumRepository: AlbumRepository,
    private eventRepository: EventRepository,
    private livePhotoRepository: LivePhotoRepository,
  ) {
    this.logger.setContext(LivePhotoService.name);
  }

  async getCandidates(auth: AuthDto): Promise<LivePhotoCandidatesResponseDto> {
    const ownerId = auth.user.id;
    const [byContentId, byFilename] = await Promise.all([
      this.livePhotoRepository.getUnlinkedByContentId(ownerId),
      this.livePhotoRepository.getUnlinkedByFilename(ownerId, FILENAME_MATCH_WINDOW_SECONDS),
    ]);

    // Cap the pairs before the bulk relational load, so a large library cannot
    // pull every matched asset (with all relations) into memory just to discard
    // most of them while mapping.
    const pairs = this.dedupeCandidates(byContentId, byFilename).slice(0, MAX_CANDIDATES);

    const assetIds = [...new Set(pairs.flatMap(({ photoId, videoId }) => [photoId, videoId]))];
    const assets = await this.assetRepository.getByIdsWithAllRelationsButStacks(assetIds);
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));

    const candidates: LivePhotoCandidatesResponseDto['candidates'] = [];
    for (const { photoId, videoId, confidence } of pairs) {
      const photo = assetById.get(photoId);
      const video = assetById.get(videoId);
      if (!photo || !video) {
        continue;
      }

      candidates.push({
        photo: mapAsset(photo, { auth }),
        video: mapAsset(video, { auth }),
        confidence,
        matchReason:
          confidence === 'high'
            ? 'Matched on the embedded live photo identifier'
            : 'Matched on filename and capture time',
      });
    }

    return { candidates, total: candidates.length };
  }

  async relink(auth: AuthDto, dto: LivePhotoRelinkDto): Promise<LivePhotoRelinkResponseDto> {
    const ownerId = auth.user.id;
    const assetIds = [...new Set(dto.pairs.flatMap(({ photoId, videoId }) => [photoId, videoId]))];
    const assets = await this.assetRepository.getByIds(assetIds);
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));

    const results: LivePhotoRelinkResponseDto['results'] = [];
    // `assetById` is a single snapshot, so guard against a request that reuses the
    // same photo or video across pairs — otherwise a later pair would validate
    // against stale state and overwrite an already-applied link.
    const linkedPhotos = new Set<string>();
    const linkedVideos = new Set<string>();
    for (const { photoId, videoId } of dto.pairs) {
      if (linkedPhotos.has(photoId) || linkedVideos.has(videoId)) {
        results.push({ photoId, videoId, success: false, error: 'Asset already relinked in this request' });
        continue;
      }

      const error = await this.validatePair(ownerId, videoId, assetById.get(photoId), assetById.get(videoId));
      if (error) {
        results.push({ photoId, videoId, success: false, error });
        continue;
      }

      // Re-validated above: photo is owned, unlinked, and the video is a
      // standalone motion asset owned by the same user.
      await linkLivePhotoAssets(
        { asset: this.assetRepository, album: this.albumRepository, event: this.eventRepository },
        { photoAssetId: photoId, motionAssetId: videoId, motionOwnerId: ownerId },
      );
      linkedPhotos.add(photoId);
      linkedVideos.add(videoId);
      results.push({ photoId, videoId, success: true });
    }

    return { results };
  }

  /**
   * Re-validate a client-submitted pair before linking. The candidate query is
   * advisory only; this is the security/consistency check that the assets exist,
   * belong to the user, and are still eligible for relinking.
   */
  private async validatePair(
    ownerId: string,
    videoId: string,
    photo: { ownerId: string; type: AssetType; livePhotoVideoId: string | null; deletedAt: Date | null } | undefined,
    video: { ownerId: string; type: AssetType; deletedAt: Date | null; visibility: AssetVisibility } | undefined,
  ): Promise<string | undefined> {
    if (!photo || !video) {
      return 'Asset not found';
    }
    if (photo.ownerId !== ownerId || video.ownerId !== ownerId) {
      return 'Asset does not belong to the user';
    }
    if (photo.type !== AssetType.Image || video.type !== AssetType.Video) {
      return 'A live photo must be an image paired with a video';
    }
    if (photo.deletedAt || video.deletedAt) {
      return 'Asset has been deleted';
    }
    if (photo.livePhotoVideoId) {
      return 'Image is already linked to a motion video';
    }
    if (video.visibility === AssetVisibility.Hidden) {
      return 'Video is already part of a live photo';
    }
    const existingLinks = await this.assetRepository.getLivePhotoCount(videoId);
    if (existingLinks > 0) {
      return 'Video is already linked to another image';
    }

    return undefined;
  }

  /**
   * Merge high- and low-confidence rows. High-confidence (ContentIdentifier)
   * matches win; low-confidence (filename + time) fills the gaps. Ambiguous
   * low-confidence matches — where a photo or video appears in more than one
   * candidate pair — are dropped to avoid reassembling the wrong live photo.
   */
  private dedupeCandidates(byContentId: LivePhotoCandidateRow[], byFilename: LivePhotoCandidateRow[]): CandidatePair[] {
    const result: CandidatePair[] = [];
    const usedPhotos = new Set<string>();
    const usedVideos = new Set<string>();

    for (const pair of byContentId) {
      if (usedPhotos.has(pair.photoId) || usedVideos.has(pair.videoId)) {
        continue;
      }
      usedPhotos.add(pair.photoId);
      usedVideos.add(pair.videoId);
      result.push({ ...pair, confidence: 'high' });
    }

    const photoCounts = new Map<string, number>();
    const videoCounts = new Map<string, number>();
    for (const pair of byFilename) {
      photoCounts.set(pair.photoId, (photoCounts.get(pair.photoId) ?? 0) + 1);
      videoCounts.set(pair.videoId, (videoCounts.get(pair.videoId) ?? 0) + 1);
    }

    for (const pair of byFilename) {
      if (usedPhotos.has(pair.photoId) || usedVideos.has(pair.videoId)) {
        continue;
      }
      if ((photoCounts.get(pair.photoId) ?? 0) > 1 || (videoCounts.get(pair.videoId) ?? 0) > 1) {
        continue;
      }
      usedPhotos.add(pair.photoId);
      usedVideos.add(pair.videoId);
      result.push({ ...pair, confidence: 'low' });
    }

    return result;
  }
}
