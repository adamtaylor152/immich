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
import { AssetFactory } from 'test/factories/asset.factory';
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
      getAssetChecksums: vi.fn(),
      getCandidatesByHealthIds: vi.fn(),
      getLatestRun: vi.fn(),
      getInternalAssetByOriginalPath: vi.fn(),
      getTrackedPaths: vi.fn(),
      list: vi.fn(),
      markStatus: vi.fn(),
      markDismissed: vi.fn(),
      markResolved: vi.fn(),
      markResolvedCategories: vi.fn(),
      replaceCandidates: vi.fn(),
      relinkManagedAsset: vi.fn(),
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
      mocks.forkSchema as never,
      mocks.job as never,
      mocks.library as never,
      mediaHealthRepository,
      mocks.media as never,
      mocks.physicalFile as never,
      mocks.storage as never,
      mocks.systemMetadata as never,
      mocks.user as never,
    );
    vi.mocked(mediaHealthRepository.getAssetChecksums).mockResolvedValue([]);
    vi.mocked(mocks.user.getList).mockResolvedValue([]);
  });

  it('lists and dismisses only findings owned by the authenticated user', async () => {
    vi.mocked(mediaHealthRepository.list).mockResolvedValue([]);
    vi.mocked(mediaHealthRepository.getLatestRun).mockResolvedValue(undefined);
    vi.mocked(mediaHealthRepository.getAssets).mockResolvedValue([]);
    vi.mocked(mediaHealthRepository.getCandidatesByHealthIds).mockResolvedValue([]);
    vi.mocked(mediaHealthRepository.getByIds).mockResolvedValue([]);

    await expect(sut.list(authStub.admin, { size: 10 })).resolves.toEqual({ buckets: [], total: 0, run: null });
    await sut.dismiss(authStub.admin, { ids: ['health-1'] });

    expect(mediaHealthRepository.list).toHaveBeenCalledWith({
      category: undefined,
      ownerId: authStub.admin.user.id,
      privacy: {},
      size: 10,
      status: undefined,
    });
    expect(mediaHealthRepository.getLatestRun).toHaveBeenCalledWith(undefined, authStub.admin.user.id);
    expect(mediaHealthRepository.getByIds).toHaveBeenCalledWith(['health-1'], authStub.admin.user.id, {});
    expect(mediaHealthRepository.markDismissed).toHaveBeenCalledWith([], authStub.admin.user.id);
  });

  it('queues candidate lookup only for the authenticated user', async () => {
    vi.mocked(mediaHealthRepository.createRun).mockResolvedValue({ id: 'run-1' } as never);
    vi.mocked(mediaHealthRepository.getByIds).mockResolvedValue([{ id: 'health-1' }] as never);

    await expect(sut.locateMissing(authStub.admin, { ids: ['health-1'] })).resolves.toEqual({ runId: 'run-1' });

    expect(mocks.job.queue).toHaveBeenCalledWith({
      name: JobName.MediaHealthLocateMissing,
      data: { runId: 'run-1', ids: ['health-1'], userId: authStub.admin.user.id },
    });
    expect(mediaHealthRepository.createRun).toHaveBeenCalledWith(MediaHealthCategory.Missing, authStub.admin.user.id);
    expect(mediaHealthRepository.getByIds).toHaveBeenCalledWith(['health-1'], authStub.admin.user.id, {});
  });

  it('does not queue hidden findings from a non-elevated privacy session', async () => {
    const auth = { ...authStub.admin, hideNsfwAssets: true };
    vi.mocked(mediaHealthRepository.createRun).mockResolvedValue({ id: 'run-1' } as never);
    vi.mocked(mediaHealthRepository.getByIds).mockResolvedValue([{ id: 'visible-health' }] as never);

    await sut.locateMissing(auth, { ids: ['visible-health', 'hidden-health'] });

    expect(mediaHealthRepository.getByIds).toHaveBeenCalledWith(['visible-health', 'hidden-health'], auth.user.id, {
      excludeNsfw: true,
    });
    expect(mocks.job.queue).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ids: ['visible-health'] }) }),
    );
  });

  it('redacts candidates found in another user directory', () => {
    const mapped = (
      sut as never as { mapCandidateForRoots: (candidate: unknown, roots: string[]) => unknown }
    ).mapCandidateForRoots(
      {
        id: 'candidate-1',
        healthId: 'health-1',
        candidatePath: '/data/upload/user-2/private.jpg',
        status: MediaHealthStatus.Found,
        visualMatchScore: 1,
        evidence: { path: '/data/upload/user-2/private.jpg', reason: 'checksum_match' },
        resolution: { autoRelinkable: true },
        checkedAt: new Date('2026-09-04T00:00:00Z'),
      },
      ['/data/upload/user-1', '/data/library/user-1'],
    );

    expect(mapped).toEqual(
      expect.objectContaining({
        candidatePath: 'Exact checksum match in another user directory',
        evidence: { reason: 'checksum_match' },
      }),
    );
    expect(JSON.stringify(mapped)).not.toContain('user-2');
  });

  it('keeps external-library candidate paths visible', () => {
    const candidate = {
      id: 'candidate-1',
      healthId: 'health-1',
      candidatePath: '/external/photos/found.jpg',
      status: MediaHealthStatus.Found,
      evidence: { path: '/external/photos/found.jpg' },
      checkedAt: new Date('2026-09-04T00:00:00Z'),
    };

    const mapped = (
      sut as never as {
        mapCandidateForRoots: (candidate: unknown, roots: string[] | null) => { candidatePath: string };
      }
    ).mapCandidateForRoots(candidate, null);

    expect(mapped.candidatePath).toBe(candidate.candidatePath);
  });

  it('redacts a relinked foreign path from the finding and mapped asset', async () => {
    const asset = AssetFactory.create({
      id: 'asset-1',
      ownerId: authStub.admin.user.id,
      originalPath: '/data/upload/user-2/private.jpg',
      originalFileName: 'private.jpg',
    });
    vi.mocked(mediaHealthRepository.list).mockResolvedValue([
      {
        id: 'health-1',
        assetId: asset.id,
        category: MediaHealthCategory.Missing,
        status: MediaHealthStatus.Relinked,
        severity: MediaHealthSeverity.Info,
        originalPath: asset.originalPath,
        originalFileName: asset.originalFileName,
        evidence: {},
        resolution: {},
        checkedAt: new Date('2026-09-04T00:00:00Z'),
        dismissedAt: null,
        resolvedAt: new Date('2026-09-04T00:00:00Z'),
      },
    ] as never);
    vi.mocked(mediaHealthRepository.getLatestRun).mockResolvedValue(undefined);
    vi.mocked(mediaHealthRepository.getAssets).mockResolvedValue([asset] as never);
    vi.mocked(mediaHealthRepository.getCandidatesByHealthIds).mockResolvedValue([]);
    vi.mocked(mocks.user.get).mockResolvedValue({ id: authStub.admin.user.id, storageLabel: null } as never);

    const result = await sut.list(authStub.admin, { size: 10 });

    expect(result.buckets[0].items[0]).toEqual(
      expect.objectContaining({
        originalPath: 'Managed file in another user directory',
        asset: expect.objectContaining({ originalPath: 'Managed file in another user directory' }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain('user-2');
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

  describe('relinkMissing', () => {
    it('keeps the missing asset filename when relinking to another user file', async () => {
      const sha1 = Buffer.alloc(20, 1);
      const sha256 = Buffer.alloc(32, 2);
      vi.mocked(mediaHealthRepository.getByIds).mockResolvedValue([
        { id: 'health-1', assetId: 'asset-1', category: MediaHealthCategory.Missing },
      ] as never);
      vi.mocked(mediaHealthRepository.getAssets).mockResolvedValue([
        {
          id: 'asset-1',
          ownerId: authStub.admin.user.id,
          checksum: sha1,
          originalPath: '/data/upload/admin_id/missing.jpg',
          originalFileName: 'missing.jpg',
          type: AssetType.Image,
          isExternal: false,
          libraryId: null,
        },
      ] as never);
      vi.mocked(mediaHealthRepository.getCandidatesByHealthIds).mockResolvedValue([
        {
          id: 'candidate-1',
          healthId: 'health-1',
          candidatePath: '/data/upload/user-2/private-name.jpg',
          status: MediaHealthStatus.Found,
        },
      ] as never);
      vi.mocked(mediaHealthRepository.getAssetChecksums).mockResolvedValue([
        { assetId: 'asset-1', sha1, sha256, sizeInBytes: 10 },
      ]);
      vi.mocked(mocks.crypto.hashFileDigests).mockResolvedValue({ sha1, sha256, sizeInBytes: 10 });
      vi.mocked(mocks.storage.stat).mockResolvedValue({ mtime: new Date('2026-09-04T00:00:00Z') } as never);
      vi.mocked(mediaHealthRepository.relinkManagedAsset).mockResolvedValue(true);

      await sut.relinkMissing(authStub.admin, { ids: ['health-1'] });

      expect(mediaHealthRepository.relinkManagedAsset).toHaveBeenCalledWith(
        expect.objectContaining({
          assetId: 'asset-1',
          candidateId: 'candidate-1',
          ownerId: authStub.admin.user.id,
          healthId: 'health-1',
          expectedOriginalPath: '/data/upload/admin_id/missing.jpg',
          originalPath: '/data/upload/user-2/private-name.jpg',
          originalFileName: 'missing.jpg',
        }),
      );
    });

    it('links an owned missing asset to a foreign-user exact match without deleting the source', async () => {
      const sha1 = Buffer.alloc(20, 1);
      const sha256 = Buffer.alloc(32, 2);
      vi.mocked(mediaHealthRepository.getByIds).mockResolvedValue([
        { id: 'health-1', assetId: 'asset-1', category: MediaHealthCategory.Missing },
      ] as never);
      vi.mocked(mediaHealthRepository.getAssets).mockResolvedValue([
        {
          id: 'asset-1',
          ownerId: authStub.admin.user.id,
          checksum: sha1,
          originalPath: '/data/upload/admin_id/missing.jpg',
          originalFileName: 'missing.jpg',
          type: AssetType.Image,
          isExternal: false,
          libraryId: null,
        },
      ] as never);
      vi.mocked(mediaHealthRepository.getCandidatesByHealthIds).mockResolvedValue([
        {
          id: 'candidate-1',
          healthId: 'health-1',
          candidatePath: '/data/upload/user-2/found.jpg',
          status: MediaHealthStatus.Found,
        },
      ] as never);
      vi.mocked(mediaHealthRepository.getAssetChecksums).mockResolvedValue([
        { assetId: 'asset-1', sha1, sha256, sizeInBytes: 10 },
      ]);
      vi.mocked(mediaHealthRepository.getInternalAssetByOriginalPath).mockResolvedValue({ id: 'asset-2' });
      vi.mocked(mocks.crypto.hashFileDigests).mockResolvedValue({ sha1, sha256, sizeInBytes: 10 });
      vi.mocked(mocks.storage.stat).mockResolvedValue({ mtime: new Date('2026-09-04T00:00:00Z') } as never);
      vi.mocked(mediaHealthRepository.relinkManagedAsset).mockResolvedValue(true);
      vi.mocked(mocks.physicalFile.ensureOriginalPhysicalFile).mockResolvedValue({
        id: 'physical-1',
        path: '/data/upload/user-2/found.jpg',
      } as never);

      await expect(sut.relinkMissing(authStub.admin, { ids: ['health-1'] })).resolves.toEqual({
        results: [{ id: 'health-1', success: true, status: MediaHealthStatus.Relinked }],
      });

      expect(mediaHealthRepository.relinkManagedAsset).toHaveBeenCalledWith(
        expect.objectContaining({ assetId: 'asset-1', sha1, sha256, sizeInBytes: 10 }),
      );
      expect(mocks.job.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.FileDelete }));
    });

    it('registers and links an exact foreign-user file that is not already an asset', async () => {
      const sha1 = Buffer.alloc(20, 1);
      const sha256 = Buffer.alloc(32, 2);
      vi.mocked(mediaHealthRepository.getByIds).mockResolvedValue([
        { id: 'health-1', assetId: 'asset-1', category: MediaHealthCategory.Missing },
      ] as never);
      vi.mocked(mediaHealthRepository.getAssets).mockResolvedValue([
        {
          id: 'asset-1',
          ownerId: authStub.admin.user.id,
          checksum: sha1,
          originalPath: '/data/upload/admin_id/missing.jpg',
          originalFileName: 'missing.jpg',
          type: AssetType.Image,
          isExternal: false,
          libraryId: null,
        },
      ] as never);
      vi.mocked(mediaHealthRepository.getCandidatesByHealthIds).mockResolvedValue([
        {
          id: 'candidate-1',
          healthId: 'health-1',
          candidatePath: '/data/upload/user-2/untracked.jpg',
          status: MediaHealthStatus.Found,
        },
      ] as never);
      vi.mocked(mediaHealthRepository.getAssetChecksums).mockResolvedValue([]);
      vi.mocked(mediaHealthRepository.getInternalAssetByOriginalPath).mockResolvedValue(undefined);
      vi.mocked(mocks.crypto.hashFileDigests).mockResolvedValue({ sha1, sha256, sizeInBytes: 10 });
      vi.mocked(mocks.storage.stat).mockResolvedValue({ mtime: new Date('2026-09-04T00:00:00Z') } as never);
      vi.mocked(mediaHealthRepository.relinkManagedAsset).mockResolvedValue(true);
      const linkRecovered = vi.fn().mockResolvedValue({
        id: 'physical-1',
        path: '/data/upload/user-2/untracked.jpg',
      });
      (
        mocks.physicalFile as never as { linkAssetToRecoveredOriginal: typeof linkRecovered }
      ).linkAssetToRecoveredOriginal = linkRecovered;

      await expect(sut.relinkMissing(authStub.admin, { ids: ['health-1'] })).resolves.toEqual({
        results: [{ id: 'health-1', success: true, status: MediaHealthStatus.Relinked }],
      });

      expect(mediaHealthRepository.relinkManagedAsset).toHaveBeenCalledWith(
        expect.objectContaining({
          assetId: 'asset-1',
          originalPath: '/data/upload/user-2/untracked.jpg',
          sha256,
          sizeInBytes: 10,
        }),
      );
      expect(mocks.job.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.FileDelete }));
    });
  });

  describe('startMissingScan', () => {
    it('queues one owner-scoped combined scan for missing and corrupt media', async () => {
      vi.mocked(mediaHealthRepository.createRun)
        .mockResolvedValueOnce({ id: 'missing-run' } as never)
        .mockResolvedValueOnce({ id: 'corrupt-run' } as never);

      await expect(sut.startMissingScan(authStub.admin)).resolves.toEqual({ runId: 'missing-run' });

      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.MediaHealthScanMissing,
        data: {
          missingRunId: 'missing-run',
          corruptRunId: 'corrupt-run',
          force: undefined,
          userId: authStub.admin.user.id,
        },
      });
    });

    it('marks both runs failed when queueing the scan throws', async () => {
      vi.mocked(mediaHealthRepository.createRun)
        .mockResolvedValueOnce({ id: 'missing-run' } as never)
        .mockResolvedValueOnce({ id: 'corrupt-run' } as never);
      vi.mocked(mocks.job.queue).mockRejectedValueOnce(new Error('queue down'));

      await expect(sut.startMissingScan(authStub.admin)).rejects.toThrow('queue down');

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

      await expect(sut.startCorruptScan(authStub.admin)).resolves.toEqual({ runId: 'corrupt-run' });

      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.MediaHealthScanMissing,
        data: {
          missingRunId: 'missing-run',
          corruptRunId: 'corrupt-run',
          force: undefined,
          userId: authStub.admin.user.id,
        },
      });
    });
  });

  it('scans only assets owned by the queued user', async () => {
    vi.mocked(mediaHealthRepository.streamAssets).mockReturnValue(
      // eslint-disable-next-line require-yield
      (async function* () {
        await Promise.resolve();
      })() as never,
    );

    await expect(
      sut.handleMissingScan({ missingRunId: 'missing-run', corruptRunId: 'corrupt-run', userId: 'user-1' }),
    ).resolves.toBe(JobStatus.Success);

    expect(mediaHealthRepository.streamAssets).toHaveBeenCalledWith({ assetIds: undefined, ownerId: 'user-1' });
  });

  describe('handleMissingScan', () => {
    it('restores supported untracked media from only the queued user roots', async () => {
      const sha1 = Buffer.alloc(20, 1);
      const sha256 = Buffer.alloc(32, 2);
      vi.mocked(mediaHealthRepository.streamAssets).mockReturnValue(
        // eslint-disable-next-line require-yield
        (async function* () {
          await Promise.resolve();
        })() as never,
      );
      vi.mocked(mocks.user.get).mockResolvedValue({
        id: 'user-1',
        storageLabel: 'owner',
        quotaSizeInBytes: null,
        quotaUsageInBytes: 0,
      } as never);
      vi.mocked(mocks.storage.walk).mockReturnValue(
        (async function* () {
          await Promise.resolve();
          yield ['/data/library/owner/restored.jpg', '/data/library/owner/restored.xmp'];
        })() as never,
      );
      vi.mocked(mediaHealthRepository.getTrackedPaths).mockResolvedValue(new Set());
      vi.mocked(mocks.crypto.hashFileDigests).mockResolvedValue({ sha1, sha256, sizeInBytes: 10 });
      vi.mocked(mocks.asset.getByChecksums).mockResolvedValue([]);
      vi.mocked(mocks.forkSchema.hasAssetChecksum).mockResolvedValue(false);
      vi.mocked(mocks.storage.stat).mockResolvedValue({ mtime: new Date('2026-09-04T00:00:00Z') } as never);
      vi.mocked(mocks.asset.create).mockResolvedValue({ id: 'restored-asset' } as never);

      await expect(
        sut.handleMissingScan({ missingRunId: 'missing-run', corruptRunId: 'corrupt-run', userId: 'user-1' }),
      ).resolves.toBe(JobStatus.Success);

      expect(mocks.crypto.hashFileDigests).toHaveBeenCalledTimes(1);
      expect(mocks.asset.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: 'user-1',
          originalPath: '/data/library/owner/restored.jpg',
          checksum: sha256,
        }),
      );
      expect(mocks.forkSchema.recordAssetChecksums).toHaveBeenCalledWith(
        expect.objectContaining({ assetId: 'restored-asset', sha1, sha256, source: 'recovery' }),
      );
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.AssetExtractMetadata,
        data: { id: 'restored-asset', source: 'upload' },
      });
      expect(mocks.job.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.FileDelete }));
    });

    it('does not restore an untracked path when either digest already belongs to the user', async () => {
      vi.mocked(mediaHealthRepository.streamAssets).mockReturnValue(
        // eslint-disable-next-line require-yield
        (async function* () {
          await Promise.resolve();
        })() as never,
      );
      vi.mocked(mocks.user.get).mockResolvedValue({
        id: 'user-1',
        storageLabel: null,
        quotaSizeInBytes: null,
        quotaUsageInBytes: 0,
      } as never);
      vi.mocked(mocks.storage.walk).mockReturnValue(
        (async function* () {
          await Promise.resolve();
          yield ['/data/upload/user-1/duplicate.jpg'];
        })() as never,
      );
      vi.mocked(mediaHealthRepository.getTrackedPaths).mockResolvedValue(new Set());
      vi.mocked(mocks.crypto.hashFileDigests).mockResolvedValue({
        sha1: Buffer.alloc(20, 1),
        sha256: Buffer.alloc(32, 2),
        sizeInBytes: 10,
      });
      vi.mocked(mocks.asset.getByChecksums).mockResolvedValue([]);
      vi.mocked(mocks.forkSchema.hasAssetChecksum).mockResolvedValue(true);

      await sut.handleMissingScan({ missingRunId: 'missing-run', corruptRunId: 'corrupt-run', userId: 'user-1' });

      expect(mocks.asset.create).not.toHaveBeenCalled();
    });

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
    it('matches the public digest when sidecar digest and size evidence disagree', async () => {
      const publicSha1 = Buffer.alloc(20, 1);
      const sidecarSha1 = Buffer.alloc(20, 2);
      const sidecarSha256 = Buffer.alloc(32, 3);
      vi.mocked(mediaHealthRepository.getByIds).mockResolvedValue([
        { id: 'health-1', assetId: 'asset-1', category: MediaHealthCategory.Missing },
      ] as never);
      vi.mocked(mediaHealthRepository.getAssets).mockResolvedValue([
        {
          id: 'asset-1',
          ownerId: 'user-1',
          checksum: publicSha1,
          originalPath: '/data/upload/user-1/missing.jpg',
          originalFileName: 'missing.jpg',
          type: AssetType.Image,
          isExternal: false,
          libraryId: null,
        },
      ] as never);
      vi.mocked(mediaHealthRepository.getAssetChecksums).mockResolvedValue([
        { assetId: 'asset-1', sha1: sidecarSha1, sha256: sidecarSha256, sizeInBytes: 10 },
      ]);
      vi.mocked(mocks.user.getList).mockResolvedValue([{ id: 'user-2', storageLabel: null }] as never);
      vi.mocked(mocks.storage.walk).mockReturnValue(
        (async function* () {
          await Promise.resolve();
          yield ['/data/upload/user-2/found.jpg'];
        })() as never,
      );
      vi.mocked(mocks.storage.stat).mockResolvedValue({ size: 20 } as never);
      vi.mocked(mocks.crypto.hashFileDigests).mockResolvedValue({
        sha1: publicSha1,
        sha256: Buffer.alloc(32, 9),
        sizeInBytes: 20,
      });

      await sut.handleLocateMissing({ runId: 'run-1', ids: ['health-1'], userId: 'user-1' });

      expect(mediaHealthRepository.replaceCandidates).toHaveBeenCalledWith(
        'health-1',
        expect.arrayContaining([
          expect.objectContaining({
            candidatePath: '/data/upload/user-2/found.jpg',
            status: MediaHealthStatus.Found,
          }),
        ]),
      );
    });

    it('finds managed files by either SHA-1 or SHA-256 and skips metadata files', async () => {
      const sha1 = Buffer.alloc(20, 1);
      const sha256 = Buffer.alloc(32, 2);
      vi.mocked(mediaHealthRepository.getByIds).mockResolvedValue([
        { id: 'health-sha1', assetId: 'asset-sha1', category: MediaHealthCategory.Missing },
        { id: 'health-sha256', assetId: 'asset-sha256', category: MediaHealthCategory.Missing },
      ] as never);
      vi.mocked(mediaHealthRepository.getAssets).mockResolvedValue([
        {
          id: 'asset-sha1',
          ownerId: 'user-1',
          checksum: sha1,
          originalPath: '/data/upload/user-1/missing.jpg',
          originalFileName: 'missing.jpg',
          type: AssetType.Image,
          isExternal: false,
          libraryId: null,
        },
        {
          id: 'asset-sha256',
          ownerId: 'user-1',
          checksum: sha256,
          originalPath: '/data/upload/user-1/missing.mp4',
          originalFileName: 'missing.mp4',
          type: AssetType.Video,
          isExternal: false,
          libraryId: null,
        },
      ] as never);
      vi.mocked(mediaHealthRepository.getAssetChecksums).mockResolvedValue([]);
      vi.mocked(mocks.user.getList).mockResolvedValue([
        { id: 'user-1', storageLabel: null },
        { id: 'user-2', storageLabel: 'other' },
      ] as never);
      vi.mocked(mocks.storage.walk).mockReturnValue(
        (async function* () {
          await Promise.resolve();
          yield [
            '/data/upload/user-2/gone.jpg',
            '/data/upload/user-2/found.jpg',
            '/data/library/other/found.mp4',
            '/data/upload/user-2/found.xmp',
          ];
        })() as never,
      );
      vi.mocked(mocks.crypto.hashFileDigests)
        .mockRejectedValueOnce(new Error('file disappeared'))
        .mockResolvedValueOnce({ sha1, sha256: Buffer.alloc(32, 8), sizeInBytes: 10 })
        .mockResolvedValueOnce({ sha1: Buffer.alloc(20, 9), sha256, sizeInBytes: 20 });

      await expect(
        sut.handleLocateMissing({ runId: 'run-1', ids: ['health-sha1', 'health-sha256'], userId: 'user-1' }),
      ).resolves.toBe(JobStatus.Success);

      expect(mocks.crypto.hashFileDigests).toHaveBeenCalledTimes(3);
      expect(mediaHealthRepository.replaceCandidates).toHaveBeenCalledWith(
        'health-sha1',
        expect.arrayContaining([
          expect.objectContaining({
            candidatePath: '/data/upload/user-2/found.jpg',
            status: MediaHealthStatus.Found,
          }),
        ]),
      );
      expect(mediaHealthRepository.replaceCandidates).toHaveBeenCalledWith(
        'health-sha256',
        expect.arrayContaining([
          expect.objectContaining({
            candidatePath: '/data/library/other/found.mp4',
            status: MediaHealthStatus.Found,
          }),
        ]),
      );
    });

    it('does not auto-relink when SHA-1 and SHA-256 evidence points to different files', async () => {
      const sha1 = Buffer.alloc(20, 1);
      const sha256 = Buffer.alloc(32, 2);
      vi.mocked(mediaHealthRepository.getByIds).mockResolvedValue([
        { id: 'health-1', assetId: 'asset-1', category: MediaHealthCategory.Missing },
      ] as never);
      vi.mocked(mediaHealthRepository.getAssets).mockResolvedValue([
        {
          id: 'asset-1',
          ownerId: 'user-1',
          checksum: sha256,
          originalPath: '/data/upload/user-1/missing.jpg',
          originalFileName: 'missing.jpg',
          type: AssetType.Image,
          isExternal: false,
          libraryId: null,
        },
      ] as never);
      vi.mocked(mediaHealthRepository.getAssetChecksums).mockResolvedValue([
        { assetId: 'asset-1', sha1, sha256, sizeInBytes: 10 },
      ]);
      vi.mocked(mocks.user.getList).mockResolvedValue([{ id: 'user-2', storageLabel: null }] as never);
      vi.mocked(mocks.storage.walk).mockReturnValue(
        (async function* () {
          await Promise.resolve();
          yield ['/data/upload/user-2/oversized.jpg', '/data/upload/user-2/sha1.jpg', '/data/upload/user-2/sha256.jpg'];
        })() as never,
      );
      vi.mocked(mocks.storage.stat)
        .mockResolvedValueOnce({ size: 20 } as never)
        .mockResolvedValue({ size: 10 } as never);
      vi.mocked(mocks.crypto.hashFileDigests)
        .mockResolvedValueOnce({ sha1, sha256: Buffer.alloc(32, 8), sizeInBytes: 10 })
        .mockResolvedValueOnce({ sha1: Buffer.alloc(20, 9), sha256, sizeInBytes: 10 });

      await sut.handleLocateMissing({ runId: 'run-1', ids: ['health-1'], userId: 'user-1' });

      expect(mocks.crypto.hashFileDigests).toHaveBeenCalledTimes(2);
      expect(mediaHealthRepository.replaceCandidates).toHaveBeenCalledWith(
        'health-1',
        expect.arrayContaining([
          expect.objectContaining({ status: MediaHealthStatus.Candidate }),
          expect.objectContaining({ status: MediaHealthStatus.Candidate }),
        ]),
      );
      expect(mediaHealthRepository.upsertFinding).toHaveBeenCalledWith(
        expect.objectContaining({
          status: MediaHealthStatus.Candidate,
          resolution: expect.objectContaining({ autoRelinkable: false }),
        }),
      );
    });

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
          isExternal: true,
          libraryId: 'library-1',
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
        resolution: { autoRelinkable: true },
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
