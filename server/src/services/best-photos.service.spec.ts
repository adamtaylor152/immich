import { BEST_PHOTO_SCORE_VERSION } from 'src/dtos/best-photos.dto';
import { AssetStatus, AssetType, AssetVisibility, JobName, JobStatus } from 'src/enum';
import { BestPhotosService } from 'src/services/best-photos.service';
import { probeStub } from 'test/fixtures/media.stub';
import { factory } from 'test/small.factory';
import { vitest } from 'vitest';

describe(BestPhotosService.name, () => {
  const logger = { setContext: vitest.fn(), warn: vitest.fn(), debug: vitest.fn(), error: vitest.fn() };
  const assetJobRepository = {
    getForBestPhotoScoring: vitest.fn(),
    getForVideoDuplicateFrameJob: vitest.fn(),
    streamForBestPhotosScoring: vitest.fn(),
  };
  const bestPhotosRepository = {
    getBestPhotos: vitest.fn(),
    upsertScore: vitest.fn(),
  };
  const jobRepository = { queueAll: vitest.fn() };
  const mediaRepository = { scoreThumbnailCandidate: vitest.fn(), transcode: vitest.fn() };
  const configRepository = { getEnv: vitest.fn() };
  const systemMetadataRepository = { get: vitest.fn(), readFile: vitest.fn() };

  let sut: BestPhotosService;

  beforeEach(() => {
    vitest.resetAllMocks();
    configRepository.getEnv.mockReturnValue({});
    sut = new BestPhotosService(
      logger as never,
      assetJobRepository as never,
      bestPhotosRepository as never,
      jobRepository as never,
      mediaRepository as never,
      configRepository as never,
      systemMetadataRepository as never,
    );
  });

  it('should map an empty Best Photos response', async () => {
    bestPhotosRepository.getBestPhotos.mockResolvedValue({ hasNextPage: false, items: [], total: 0 });

    await expect(sut.getBestPhotos(factory.auth(), { page: 1, limit: 100, includeArchived: false })).resolves.toEqual({
      total: 0,
      count: 0,
      items: [],
      nextPage: null,
    });
  });

  it('should score good images higher than low-quality images', async () => {
    const asset = {
      id: 'asset-1',
      ownerId: 'user-1',
      type: AssetType.Image,
      status: AssetStatus.Active,
      deletedAt: null,
      visibility: AssetVisibility.Timeline,
      originalFileName: 'vacation.jpg',
      width: 4000,
      height: 3000,
      previewFile: '/preview.jpg',
      faceCount: 1,
    };
    assetJobRepository.getForBestPhotoScoring.mockResolvedValue(asset);
    mediaRepository.scoreThumbnailCandidate.mockResolvedValueOnce(150).mockResolvedValueOnce(-30);

    await expect(sut.handleScore({ id: asset.id })).resolves.toBe(JobStatus.Success);
    const goodScore = bestPhotosRepository.upsertScore.mock.calls[0][0].score;

    assetJobRepository.getForBestPhotoScoring.mockResolvedValue({
      ...asset,
      originalFileName: 'screenshot.png',
      width: 200,
      height: 200,
      faceCount: 0,
    });
    await expect(sut.handleScore({ id: asset.id })).resolves.toBe(JobStatus.Success);
    const badScore = bestPhotosRepository.upsertScore.mock.calls[1][0].score;

    expect(goodScore).toBeGreaterThan(badScore);
    expect(bestPhotosRepository.upsertScore).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scoreVersion: BEST_PHOTO_SCORE_VERSION,
        bestFrameTimestampMs: null,
        frameScore: null,
        frameMetadata: null,
      }),
    );
  });

  describe('video scoring', () => {
    const videoAsset = {
      id: 'video-1',
      ownerId: 'user-1',
      type: AssetType.Video,
      status: AssetStatus.Active,
      deletedAt: null,
      visibility: AssetVisibility.Timeline,
      originalFileName: 'clip.mp4',
      width: 3840,
      height: 2160,
      previewFile: '/preview.jpg',
      faceCount: 0,
    };

    const videoJob = (durationMs: number) => ({
      id: videoAsset.id,
      ownerId: videoAsset.ownerId,
      originalPath: '/data/library/clip.mp4',
      visibility: AssetVisibility.Timeline,
      videoStream: probeStub.videoStream2160p.videoStream!,
      format: { ...probeStub.videoStream2160p.format, duration: durationMs },
    });

    it('should score a video by its best sampled frame and persist frame columns', async () => {
      assetJobRepository.getForBestPhotoScoring.mockResolvedValue(videoAsset);
      assetJobRepository.getForVideoDuplicateFrameJob.mockResolvedValue(videoJob(60_000));
      mediaRepository.transcode.mockResolvedValue(void 0);
      mediaRepository.scoreThumbnailCandidate
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(80)
        .mockResolvedValueOnce(50)
        .mockResolvedValueOnce(20)
        .mockResolvedValueOnce(5);

      await expect(sut.handleScore({ id: videoAsset.id })).resolves.toBe(JobStatus.Success);

      // 60s clip sampled at 10s/20s/30s/40s/50s; best raw score (80) is at 20s
      expect(mediaRepository.transcode).toHaveBeenCalledTimes(5);
      expect(bestPhotosRepository.upsertScore).toHaveBeenCalledWith(
        expect.objectContaining({
          assetId: videoAsset.id,
          ownerId: videoAsset.ownerId,
          scoreVersion: BEST_PHOTO_SCORE_VERSION,
          bestFrameTimestampMs: 20_000,
          frameScore: (80 + 40) / 220,
          frameMetadata: expect.objectContaining({
            durationMs: 60_000,
            sampledFrameCount: 5,
            frames: expect.arrayContaining([expect.objectContaining({ timestampMs: 20_000, thumbnailScore: 80 })]),
          }),
        }),
      );
    });

    it('should skip a video over the duration cap without extracting frames', async () => {
      assetJobRepository.getForBestPhotoScoring.mockResolvedValue(videoAsset);
      assetJobRepository.getForVideoDuplicateFrameJob.mockResolvedValue(videoJob(3_600_000));

      await expect(sut.handleScore({ id: videoAsset.id })).resolves.toBe(JobStatus.Skipped);
      expect(mediaRepository.transcode).not.toHaveBeenCalled();
      expect(bestPhotosRepository.upsertScore).not.toHaveBeenCalled();
    });

    it('should skip a video without probed metadata', async () => {
      assetJobRepository.getForBestPhotoScoring.mockResolvedValue(videoAsset);
      assetJobRepository.getForVideoDuplicateFrameJob.mockResolvedValue(void 0);

      await expect(sut.handleScore({ id: videoAsset.id })).resolves.toBe(JobStatus.Skipped);
      expect(bestPhotosRepository.upsertScore).not.toHaveBeenCalled();
    });

    it('should skip gracefully when every frame extraction fails', async () => {
      assetJobRepository.getForBestPhotoScoring.mockResolvedValue(videoAsset);
      assetJobRepository.getForVideoDuplicateFrameJob.mockResolvedValue(videoJob(60_000));
      mediaRepository.transcode.mockRejectedValue(new Error('ffmpeg failed'));

      await expect(sut.handleScore({ id: videoAsset.id })).resolves.toBe(JobStatus.Skipped);
      expect(bestPhotosRepository.upsertScore).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should pick the best frame among the frames that extract successfully', async () => {
      assetJobRepository.getForBestPhotoScoring.mockResolvedValue(videoAsset);
      assetJobRepository.getForVideoDuplicateFrameJob.mockResolvedValue(videoJob(60_000));
      mediaRepository.transcode
        .mockResolvedValueOnce(void 0)
        .mockRejectedValueOnce(new Error('dead zone'))
        .mockResolvedValueOnce(void 0)
        .mockResolvedValueOnce(void 0)
        .mockResolvedValueOnce(void 0);
      mediaRepository.scoreThumbnailCandidate
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(60)
        .mockResolvedValueOnce(20)
        .mockResolvedValueOnce(5);

      await expect(sut.handleScore({ id: videoAsset.id })).resolves.toBe(JobStatus.Success);

      // frame at 20s failed to extract; best of the remaining (60) is at 30s
      expect(bestPhotosRepository.upsertScore).toHaveBeenCalledWith(
        expect.objectContaining({
          bestFrameTimestampMs: 30_000,
          frameMetadata: expect.objectContaining({ sampledFrameCount: 5 }),
        }),
      );
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  it('should queue single asset scoring jobs for a backfill', async () => {
    assetJobRepository.streamForBestPhotosScoring.mockReturnValue([{ id: 'asset-1' }, { id: 'asset-2' }]);

    await expect(sut.handleQueueAll({ force: true })).resolves.toBe(JobStatus.Success);
    expect(jobRepository.queueAll).toHaveBeenCalledWith([
      { name: JobName.BestPhotosScore, data: { id: 'asset-1' } },
      { name: JobName.BestPhotosScore, data: { id: 'asset-2' } },
    ]);
  });
});
