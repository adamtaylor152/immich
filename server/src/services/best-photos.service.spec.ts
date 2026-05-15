import { BEST_PHOTO_SCORE_VERSION } from 'src/dtos/best-photos.dto';
import { AssetStatus, AssetType, AssetVisibility, JobName, JobStatus } from 'src/enum';
import { BestPhotosService } from 'src/services/best-photos.service';
import { factory } from 'test/small.factory';
import { vitest } from 'vitest';

describe(BestPhotosService.name, () => {
  const logger = { setContext: vitest.fn(), warn: vitest.fn() };
  const assetJobRepository = {
    getForBestPhotoScoring: vitest.fn(),
    streamForBestPhotosScoring: vitest.fn(),
  };
  const bestPhotosRepository = {
    getBestPhotos: vitest.fn(),
    upsertScore: vitest.fn(),
  };
  const jobRepository = { queueAll: vitest.fn() };
  const mediaRepository = { scoreThumbnailCandidate: vitest.fn() };

  let sut: BestPhotosService;

  beforeEach(() => {
    vitest.resetAllMocks();
    sut = new BestPhotosService(
      logger as never,
      assetJobRepository as never,
      bestPhotosRepository as never,
      jobRepository as never,
      mediaRepository as never,
    );
  });

  it('should map an empty Best Photos response', async () => {
    bestPhotosRepository.getBestPhotos.mockResolvedValue({ hasNextPage: false, items: [] });

    await expect(
      sut.getBestPhotos(factory.auth(), { page: 1, limit: 100, includeArchived: false, includeVideos: false }),
    ).resolves.toEqual({
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
      expect.objectContaining({ scoreVersion: BEST_PHOTO_SCORE_VERSION }),
    );
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
