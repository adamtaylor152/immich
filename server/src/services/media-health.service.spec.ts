import { CORRUPT_MEDIA_DELETE_CONFIRM_TEXT } from 'src/dtos/media-health.dto';
import {
  AssetStatus,
  AssetType,
  JobName,
  JobStatus,
  MediaHealthCategory,
  MediaHealthSeverity,
  MediaHealthStatus,
} from 'src/enum';
import { MediaHealthRepository } from 'src/repositories/media-health.repository';
import { MediaHealthService } from 'src/services/media-health.service';
import { classifyImageDecodeFailure } from 'src/utils/media-health';
import { authStub } from 'test/fixtures/auth.stub';
import { getMocks, ServiceMocks } from 'test/utils';

describe(MediaHealthService.name, () => {
  let sut: MediaHealthService;
  let mocks: ServiceMocks;
  let mediaHealthRepository: MediaHealthRepository;

  beforeEach(() => {
    mocks = getMocks();
    mediaHealthRepository = {
      createRun: vi.fn(),
      finishRun: vi.fn(),
      getByIds: vi.fn(),
      getAssets: vi.fn(),
      markStatus: vi.fn(),
      replaceCandidates: vi.fn(),
      relinkExternalAsset: vi.fn(),
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
        results: [{ id: 'health-1', success: true, status: MediaHealthStatus.TrashQueued }],
      });

      expect(mediaHealthRepository.markStatus).toHaveBeenCalledWith(['health-1'], MediaHealthStatus.TrashQueued);
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.MediaHealthDeleteCorrupt,
        data: { ids: ['health-1'], userId: authStub.admin.user.id },
      });
    });
  });

  describe('handleLocateMissing', () => {
    it('updates findings to found when locate discovers validated candidates', async () => {
      vi.mocked(mediaHealthRepository.getByIds).mockResolvedValue([
        {
          id: 'health-1',
          assetId: 'asset-1',
          category: MediaHealthCategory.Missing,
          originalPath: '/library/missing.jpg',
          originalFileName: 'missing.jpg',
          evidence: { reason: 'source_file_missing_or_unreadable' },
          resolution: { autoRelinkable: true },
        },
      ] as never);
      vi.mocked(mediaHealthRepository.getAssets).mockResolvedValue([
        {
          id: 'asset-1',
          originalPath: '/library/missing.jpg',
          originalFileName: 'missing.jpg',
          type: AssetType.Image,
          isExternal: false,
          libraryId: null,
        },
      ] as never);
      vi.spyOn(sut as never, 'locateCandidates').mockResolvedValue([
        {
          status: MediaHealthStatus.Found,
          score: 0.91,
          evidence: { path: '/library/found.jpg' },
          resolution: { autoRelinkable: false },
        },
      ]);

      await expect(sut.handleLocateMissing({ runId: 'run-1', ids: ['health-1'] })).resolves.toBe(JobStatus.Success);

      expect(mediaHealthRepository.replaceCandidates).toHaveBeenCalledWith('health-1', [
        {
          healthId: 'health-1',
          candidatePath: '/library/found.jpg',
          status: MediaHealthStatus.Found,
          visualMatchScore: 0.91,
          evidence: { path: '/library/found.jpg' },
          resolution: { autoRelinkable: false },
          checkedAt: expect.any(Date),
        },
      ]);
      expect(mediaHealthRepository.upsertFinding).toHaveBeenCalledWith({
        runId: 'run-1',
        assetId: 'asset-1',
        category: MediaHealthCategory.Missing,
        status: MediaHealthStatus.Found,
        severity: MediaHealthSeverity.Warning,
        originalPath: '/library/missing.jpg',
        originalFileName: 'missing.jpg',
        evidence: {
          reason: 'source_file_missing_or_unreadable',
          candidateCount: 1,
          validatedCandidateCount: 1,
        },
        resolution: { autoRelinkable: false },
        checkedAt: expect.any(Date),
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

  describe('handleLocateMissing', () => {
    it('stores validated candidates without relinking during locate', async () => {
      vi.mocked(mediaHealthRepository.createRun).mockResolvedValue({ id: 'run-1' } as never);
      vi.mocked(mediaHealthRepository.getByIds).mockResolvedValue([
        {
          id: 'health-1',
          assetId: 'asset-1',
          category: MediaHealthCategory.Missing,
        },
      ] as never);
      vi.mocked(mediaHealthRepository.getAssets).mockResolvedValue([
        {
          id: 'asset-1',
          originalPath: '/library/file.jpg',
          originalFileName: 'file.jpg',
          type: AssetType.Image,
          isExternal: true,
          libraryId: 'library-1',
        },
      ] as never);

      vi.spyOn(sut as never, 'locateCandidates').mockResolvedValue([
        {
          status: MediaHealthStatus.Found,
          score: 0.98,
          evidence: { path: '/library/relinked/file.jpg' },
          resolution: {},
        },
      ]);
      const relinkSpy = vi.spyOn(sut as never, 'relinkAsset').mockImplementation(() => Promise.resolve());

      await expect(sut.handleLocateMissing({ ids: ['health-1'] })).resolves.toBe(JobStatus.Success);

      expect(mediaHealthRepository.replaceCandidates).toHaveBeenCalledWith(
        'health-1',
        expect.arrayContaining([
          expect.objectContaining({
            candidatePath: '/library/relinked/file.jpg',
            status: MediaHealthStatus.Found,
          }),
        ]),
      );
      expect(relinkSpy).not.toHaveBeenCalled();
      expect(mediaHealthRepository.finishRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'completed', checkedAssets: 1, foundAssets: 1 }),
      );
    });
  });

  describe('classifyImageDecodeFailure', () => {
    it('keeps unsupported raws out of corrupt findings after the libraw fallback fails', () => {
      const error = new Error('Unsupported file format or not RAW file');

      expect(classifyImageDecodeFailure(error, { isRaw: true, enhancedRawAttempted: true })).toBe(
        MediaHealthStatus.UnsupportedRaw,
      );
    });
  });
});
