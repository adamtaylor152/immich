import { CORRUPT_MEDIA_DELETE_CONFIRM_TEXT } from 'src/dtos/media-health.dto';
import { AssetStatus, AssetType, JobName, JobStatus, MediaHealthCategory, MediaHealthStatus } from 'src/enum';
import { MediaHealthRepository } from 'src/repositories/media-health.repository';
import { MediaHealthService } from 'src/services/media-health.service';
import { authStub } from 'test/fixtures/auth.stub';
import { getMocks, ServiceMocks } from 'test/utils';

describe(MediaHealthService.name, () => {
  let sut: MediaHealthService;
  let mocks: ServiceMocks;
  let mediaHealthRepository: MediaHealthRepository;

  beforeEach(() => {
    mocks = getMocks();
    mediaHealthRepository = {
      getByIds: vi.fn(),
      getAssets: vi.fn(),
      markStatus: vi.fn(),
      upsertFinding: vi.fn(),
    } as unknown as MediaHealthRepository;

    sut = new MediaHealthService(
      mocks.logger as never,
      mocks.asset as never,
      mocks.config as never,
      mocks.crypto as never,
      mocks.event as never,
      mocks.job as never,
      mocks.library as never,
      mediaHealthRepository,
      mocks.media as never,
      mocks.storage as never,
      mocks.systemMetadata as never,
      mocks.user as never,
    );
  });

  describe('deleteCorrupt', () => {
    it('queues a trash move after revalidating confirmed corrupt media', async () => {
      vi.mocked(mocks.user.getForPinCode).mockResolvedValue({ password: '', pinCode: null });
      vi.mocked(mediaHealthRepository.getByIds).mockResolvedValue([
        {
          id: 'health-1',
          assetId: 'asset-1',
          category: MediaHealthCategory.Corrupt,
          status: MediaHealthStatus.CorruptConfirmed,
          checkedAt: new Date(),
        },
      ] as never);
      vi.mocked(mediaHealthRepository.getAssets).mockResolvedValue([
        {
          id: 'asset-1',
          originalPath: '/library/file.jpg',
          originalFileName: 'file.jpg',
          type: AssetType.Image,
        },
      ] as never);
      vi.spyOn(sut as never, 'validateAssetIntegrity').mockResolvedValue({
        status: MediaHealthStatus.CorruptConfirmed,
        score: null,
        evidence: {},
        resolution: {},
      });

      await expect(
        sut.deleteCorrupt(authStub.admin, { ids: ['health-1'], confirmText: CORRUPT_MEDIA_DELETE_CONFIRM_TEXT }),
      ).resolves.toEqual({
        results: [{ id: 'health-1', success: true, status: MediaHealthStatus.TrashQueued, error: undefined }],
      });

      expect(mediaHealthRepository.markStatus).toHaveBeenCalledWith(['health-1'], MediaHealthStatus.TrashQueued);
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.MediaHealthDeleteCorrupt,
        data: { ids: ['health-1'], userId: authStub.admin.user.id },
      });
    });
  });

  describe('handleDeleteCorrupt', () => {
    it('moves revalidated corrupt media to trash without queueing permanent file deletion', async () => {
      vi.mocked(mediaHealthRepository.getByIds).mockResolvedValue([
        {
          id: 'health-1',
          assetId: 'asset-1',
          status: MediaHealthStatus.TrashQueued,
        },
      ] as never);
      vi.mocked(mediaHealthRepository.getAssets).mockResolvedValue([
        {
          id: 'asset-1',
          originalPath: '/library/file.jpg',
          originalFileName: 'file.jpg',
          type: AssetType.Image,
        },
      ] as never);
      vi.spyOn(sut as never, 'validateAssetIntegrity').mockResolvedValue({
        status: MediaHealthStatus.CorruptConfirmed,
        score: null,
        evidence: {},
        resolution: {},
      });

      await expect(sut.handleDeleteCorrupt({ ids: ['health-1'], userId: authStub.admin.user.id })).resolves.toBe(
        JobStatus.Success,
      );

      expect(mocks.asset.updateAll).toHaveBeenCalledWith(['asset-1'], {
        deletedAt: expect.any(Date),
        status: AssetStatus.Trashed,
      });
      expect(mocks.event.emit).toHaveBeenCalledWith('AssetTrashAll', {
        assetIds: ['asset-1'],
        userId: authStub.admin.user.id,
      });
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(mediaHealthRepository.markStatus).toHaveBeenCalledWith(['health-1'], MediaHealthStatus.Trashed);
    });
  });
});
