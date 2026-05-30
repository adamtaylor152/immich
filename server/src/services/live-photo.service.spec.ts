import { AssetType, AssetVisibility } from 'src/enum';
import { LivePhotoRepository } from 'src/repositories/live-photo.repository';
import { LivePhotoService } from 'src/services/live-photo.service';
import { AssetFactory } from 'test/factories/asset.factory';
import { AuthFactory } from 'test/factories/auth.factory';
import { getMocks, ServiceMocks } from 'test/utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe(LivePhotoService.name, () => {
  let sut: LivePhotoService;
  let mocks: ServiceMocks;
  let livePhotoRepository: LivePhotoRepository;

  beforeEach(() => {
    mocks = getMocks();
    livePhotoRepository = {
      getUnlinkedByContentId: vi.fn().mockResolvedValue([]),
      getUnlinkedByFilename: vi.fn().mockResolvedValue([]),
    } as unknown as LivePhotoRepository;

    sut = new LivePhotoService(
      mocks.logger as never,
      mocks.asset as never,
      mocks.album as never,
      mocks.event as never,
      livePhotoRepository,
    );
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('getCandidates', () => {
    it('returns high-confidence CID pairs and fills gaps with low-confidence filename pairs', async () => {
      const auth = AuthFactory.create();
      const ownerId = auth.user.id;
      const photoA = AssetFactory.from({ id: 'photo-a', ownerId, type: AssetType.Image }).exif().build();
      const videoA = AssetFactory.from({ id: 'video-a', ownerId, type: AssetType.Video }).exif().build();
      const photoB = AssetFactory.from({ id: 'photo-b', ownerId, type: AssetType.Image }).exif().build();
      const videoB = AssetFactory.from({ id: 'video-b', ownerId, type: AssetType.Video }).exif().build();

      vi.mocked(livePhotoRepository.getUnlinkedByContentId).mockResolvedValue([
        { photoId: 'photo-a', videoId: 'video-a' },
      ]);
      // photo-a/video-a is repeated here (already taken by CID) and a fresh low pair is added
      vi.mocked(livePhotoRepository.getUnlinkedByFilename).mockResolvedValue([
        { photoId: 'photo-a', videoId: 'video-a' },
        { photoId: 'photo-b', videoId: 'video-b' },
      ]);
      mocks.asset.getByIdsWithAllRelationsButStacks.mockResolvedValue([photoA, videoA, photoB, videoB] as never);

      const result = await sut.getCandidates(auth);

      expect(result.total).toBe(2);
      expect(result.candidates).toEqual([
        expect.objectContaining({
          confidence: 'high',
          photo: expect.objectContaining({ id: 'photo-a' }),
          video: expect.objectContaining({ id: 'video-a' }),
        }),
        expect.objectContaining({
          confidence: 'low',
          photo: expect.objectContaining({ id: 'photo-b' }),
          video: expect.objectContaining({ id: 'video-b' }),
        }),
      ]);
    });

    it('drops ambiguous low-confidence matches (a photo matching multiple videos)', async () => {
      const auth = AuthFactory.create();
      vi.mocked(livePhotoRepository.getUnlinkedByFilename).mockResolvedValue([
        { photoId: 'photo-x', videoId: 'video-1' },
        { photoId: 'photo-x', videoId: 'video-2' },
      ]);
      mocks.asset.getByIdsWithAllRelationsButStacks.mockResolvedValue([] as never);

      const result = await sut.getCandidates(auth);

      expect(result.total).toBe(0);
      expect(mocks.asset.getByIdsWithAllRelationsButStacks).toHaveBeenCalledWith([]);
    });
  });

  describe('relink', () => {
    it('links the photo, hides the video, removes it from albums, and emits a hide event', async () => {
      const auth = AuthFactory.create();
      const ownerId = auth.user.id;
      const photo = AssetFactory.from({
        id: 'photo-1',
        ownerId,
        type: AssetType.Image,
        livePhotoVideoId: null,
        visibility: AssetVisibility.Timeline,
      }).build();
      const video = AssetFactory.from({
        id: 'video-1',
        ownerId,
        type: AssetType.Video,
        visibility: AssetVisibility.Timeline,
      }).build();
      mocks.asset.getByIds.mockResolvedValue([photo, video] as never);
      mocks.asset.getLivePhotoCount.mockResolvedValue(0);

      const result = await sut.relink(auth, { pairs: [{ photoId: 'photo-1', videoId: 'video-1' }] });

      expect(result.results).toEqual([{ photoId: 'photo-1', videoId: 'video-1', success: true }]);
      expect(mocks.asset.update).toHaveBeenCalledWith({ id: 'photo-1', livePhotoVideoId: 'video-1' });
      expect(mocks.asset.update).toHaveBeenCalledWith({ id: 'video-1', visibility: AssetVisibility.Hidden });
      expect(mocks.album.removeAssetsFromAll).toHaveBeenCalledWith(['video-1']);
      expect(mocks.event.emit).toHaveBeenCalledWith('AssetHide', { assetId: 'video-1', userId: ownerId });
    });

    it('rejects a pair whose image is already linked', async () => {
      const auth = AuthFactory.create();
      const ownerId = auth.user.id;
      const photo = AssetFactory.from({
        id: 'photo-1',
        ownerId,
        type: AssetType.Image,
        livePhotoVideoId: 'already-linked',
        visibility: AssetVisibility.Timeline,
      }).build();
      const video = AssetFactory.from({
        id: 'video-1',
        ownerId,
        type: AssetType.Video,
        visibility: AssetVisibility.Timeline,
      }).build();
      mocks.asset.getByIds.mockResolvedValue([photo, video] as never);

      const result = await sut.relink(auth, { pairs: [{ photoId: 'photo-1', videoId: 'video-1' }] });

      expect(result.results[0].success).toBe(false);
      expect(mocks.asset.update).not.toHaveBeenCalled();
    });

    it('rejects a pair that belongs to another user', async () => {
      const auth = AuthFactory.create();
      const photo = AssetFactory.from({
        id: 'photo-1',
        ownerId: 'someone-else',
        type: AssetType.Image,
        livePhotoVideoId: null,
        visibility: AssetVisibility.Timeline,
      }).build();
      const video = AssetFactory.from({
        id: 'video-1',
        ownerId: 'someone-else',
        type: AssetType.Video,
        visibility: AssetVisibility.Timeline,
      }).build();
      mocks.asset.getByIds.mockResolvedValue([photo, video] as never);

      const result = await sut.relink(auth, { pairs: [{ photoId: 'photo-1', videoId: 'video-1' }] });

      expect(result.results[0].success).toBe(false);
      expect(mocks.asset.update).not.toHaveBeenCalled();
    });
  });
});
