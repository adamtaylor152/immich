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
      markResolved: vi.fn(),
      markResolvedCategories: vi.fn(),
      replaceCandidates: vi.fn(),
      relinkExternalAsset: vi.fn(),
      streamAssets: vi.fn(),
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

  describe('startMissingScan', () => {
    it('queues one combined scan for missing and corrupt media', async () => {
      vi.mocked(mediaHealthRepository.createRun)
        .mockResolvedValueOnce({ id: 'missing-run' } as never)
        .mockResolvedValueOnce({ id: 'corrupt-run' } as never);

      await expect(sut.startMissingScan()).resolves.toEqual({ runId: 'missing-run' });

      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.MediaHealthScanMissing,
        data: { missingRunId: 'missing-run', corruptRunId: 'corrupt-run', force: undefined },
      });
    });

    it('marks both runs failed when queueing the scan throws', async () => {
      vi.mocked(mediaHealthRepository.createRun)
        .mockResolvedValueOnce({ id: 'missing-run' } as never)
        .mockResolvedValueOnce({ id: 'corrupt-run' } as never);
      vi.mocked(mocks.job.queue).mockRejectedValueOnce(new Error('queue down'));

      await expect(sut.startMissingScan()).rejects.toThrow('queue down');

      expect(mediaHealthRepository.finishRun).toHaveBeenCalledWith(
        'missing-run',
        expect.objectContaining({ status: 'failed' }),
      );
      expect(mediaHealthRepository.finishRun).toHaveBeenCalledWith(
        'corrupt-run',
        expect.objectContaining({ status: 'failed' }),
      );
    });
  });

  describe('startCorruptScan', () => {
    it('returns the corrupt run id from the queued scan', async () => {
      vi.mocked(mediaHealthRepository.createRun)
        .mockResolvedValueOnce({ id: 'missing-run' } as never)
        .mockResolvedValueOnce({ id: 'corrupt-run' } as never);

      await expect(sut.startCorruptScan()).resolves.toEqual({ runId: 'corrupt-run' });

      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.MediaHealthScanMissing,
        data: { missingRunId: 'missing-run', corruptRunId: 'corrupt-run', force: undefined },
      });
    });
  });

  describe('handleMissingScan', () => {
    it.each([
      [MediaHealthStatus.CorruptConfirmed, MediaHealthSeverity.Critical],
      [MediaHealthStatus.UnsupportedRaw, MediaHealthSeverity.Info],
      [MediaHealthStatus.CorruptSuspect, MediaHealthSeverity.Warning],
    ])('maps integrity status %s to severity %s', async (status, severity) => {
      vi.mocked(mediaHealthRepository.streamAssets).mockReturnValue(
        (async function* () {
          await Promise.resolve();
          yield {
            id: 'asset-x',
            originalPath: '/library/x.jpg',
            originalFileName: 'x.jpg',
            type: AssetType.Image,
            isExternal: false,
            libraryId: null,
          };
        })() as never,
      );
      vi.mocked(mocks.storage.checkFileExists).mockResolvedValue(true);
      vi.spyOn(sut as never, 'validateReadableAssetIntegrity').mockResolvedValue({
        status,
        score: null,
        evidence: {},
        resolution: {},
      });

      await expect(sut.handleMissingScan({ missingRunId: 'm', corruptRunId: 'c' })).resolves.toBe(JobStatus.Success);

      expect(mediaHealthRepository.upsertFinding).toHaveBeenCalledWith(
        expect.objectContaining({ runId: 'c', status, severity }),
      );
    });

    it('marks both categories resolved when an asset is healthy and never records a finding', async () => {
      vi.mocked(mediaHealthRepository.streamAssets).mockReturnValue(
        (async function* () {
          await Promise.resolve();
          yield {
            id: 'healthy-asset',
            originalPath: '/library/healthy.jpg',
            originalFileName: 'healthy.jpg',
            type: AssetType.Image,
            isExternal: false,
            libraryId: null,
          };
        })() as never,
      );
      vi.mocked(mocks.storage.checkFileExists).mockResolvedValue(true);
      vi.spyOn(sut as never, 'validateReadableAssetIntegrity').mockResolvedValue(null);

      await expect(sut.handleMissingScan({ missingRunId: 'm', corruptRunId: 'c' })).resolves.toBe(JobStatus.Success);

      expect(mediaHealthRepository.markResolvedCategories).toHaveBeenCalledWith(
        [MediaHealthCategory.Missing, MediaHealthCategory.Corrupt],
        'healthy-asset',
      );
      expect(mediaHealthRepository.markResolved).not.toHaveBeenCalled();
      expect(mediaHealthRepository.upsertFinding).not.toHaveBeenCalled();
    });

    it('continues finishing the second run when the first finishRun rejects on failure', async () => {
      vi.mocked(mediaHealthRepository.streamAssets).mockReturnValue(
        // eslint-disable-next-line require-yield
        (async function* () {
          await Promise.resolve();
          throw new Error('stream blew up');
        })() as never,
      );
      vi.mocked(mediaHealthRepository.finishRun)
        .mockRejectedValueOnce(new Error('missing finish failed'))
        .mockResolvedValueOnce(undefined as never);

      await expect(sut.handleMissingScan({ missingRunId: 'm', corruptRunId: 'c' })).rejects.toThrow('stream blew up');

      expect(mediaHealthRepository.finishRun).toHaveBeenCalledTimes(2);
      expect(mediaHealthRepository.finishRun).toHaveBeenCalledWith('m', expect.objectContaining({ status: 'failed' }));
      expect(mediaHealthRepository.finishRun).toHaveBeenCalledWith('c', expect.objectContaining({ status: 'failed' }));
    });

    it('runs only the missing-asset check for legacy runId-only jobs', async () => {
      vi.mocked(mediaHealthRepository.streamAssets).mockReturnValue(
        (async function* () {
          await Promise.resolve();
          yield {
            id: 'asset-1',
            originalPath: '/library/file.jpg',
            originalFileName: 'file.jpg',
            type: AssetType.Image,
            isExternal: false,
            libraryId: null,
          };
        })() as never,
      );
      vi.mocked(mocks.storage.checkFileExists).mockResolvedValue(true);
      const validateSpy = vi.spyOn(sut as never, 'validateReadableAssetIntegrity');

      await expect(sut.handleMissingScan({ runId: 'legacy-run' })).resolves.toBe(JobStatus.Success);

      expect(mediaHealthRepository.createRun).not.toHaveBeenCalled();
      expect(validateSpy).not.toHaveBeenCalled();
      expect(mediaHealthRepository.markResolved).toHaveBeenCalledWith(MediaHealthCategory.Missing, 'asset-1');
      expect(mediaHealthRepository.finishRun).toHaveBeenCalledTimes(1);
      expect(mediaHealthRepository.finishRun).toHaveBeenCalledWith(
        'legacy-run',
        expect.objectContaining({ status: 'completed' }),
      );
    });

    it('checks each asset once and records missing or corrupt findings', async () => {
      const assets = [
        {
          id: 'missing-asset',
          originalPath: '/library/missing.jpg',
          originalFileName: 'missing.jpg',
          type: AssetType.Image,
          isExternal: true,
          libraryId: 'library-1',
        },
        {
          id: 'corrupt-asset',
          originalPath: '/library/corrupt.jpg',
          originalFileName: 'corrupt.jpg',
          type: AssetType.Image,
          isExternal: false,
          libraryId: null,
        },
      ];
      vi.mocked(mediaHealthRepository.streamAssets).mockReturnValue(
        (async function* () {
          for (const asset of assets) {
            await Promise.resolve();
            yield asset;
          }
        })() as never,
      );
      vi.mocked(mocks.storage.checkFileExists).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      vi.spyOn(sut as never, 'validateReadableAssetIntegrity').mockResolvedValue({
        status: MediaHealthStatus.CorruptConfirmed,
        score: null,
        evidence: { reason: 'image_decode_failed' },
        resolution: { reuploadRecommended: true },
      });

      await expect(sut.handleMissingScan({ missingRunId: 'missing-run', corruptRunId: 'corrupt-run' })).resolves.toBe(
        JobStatus.Success,
      );

      expect(mediaHealthRepository.upsertFinding).toHaveBeenCalledWith({
        runId: 'missing-run',
        assetId: 'missing-asset',
        category: MediaHealthCategory.Missing,
        status: MediaHealthStatus.Missing,
        severity: MediaHealthSeverity.Critical,
        originalPath: '/library/missing.jpg',
        originalFileName: 'missing.jpg',
        evidence: { reason: 'source_file_missing_or_unreadable' },
        resolution: { autoRelinkable: true },
        checkedAt: expect.any(Date),
      });
      expect(mediaHealthRepository.upsertFinding).toHaveBeenCalledWith({
        runId: 'corrupt-run',
        assetId: 'corrupt-asset',
        category: MediaHealthCategory.Corrupt,
        status: MediaHealthStatus.CorruptConfirmed,
        severity: MediaHealthSeverity.Critical,
        originalPath: '/library/corrupt.jpg',
        originalFileName: 'corrupt.jpg',
        evidence: { reason: 'image_decode_failed' },
        resolution: { reuploadRecommended: true },
        checkedAt: expect.any(Date),
      });
      expect(mediaHealthRepository.markResolved).toHaveBeenCalledWith(MediaHealthCategory.Corrupt, 'missing-asset');
      expect(mediaHealthRepository.markResolved).toHaveBeenCalledWith(MediaHealthCategory.Missing, 'corrupt-asset');
      expect(mediaHealthRepository.finishRun).toHaveBeenCalledWith(
        'missing-run',
        expect.objectContaining({ status: 'completed', checkedAssets: 2, foundAssets: 1 }),
      );
      expect(mediaHealthRepository.finishRun).toHaveBeenCalledWith(
        'corrupt-run',
        expect.objectContaining({ status: 'completed', checkedAssets: 2, foundAssets: 1 }),
      );
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
