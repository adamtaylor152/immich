import { BadRequestException } from '@nestjs/common';
import { BulkIdErrorReason } from 'src/dtos/asset-ids.response.dto';
import { MapAsset } from 'src/dtos/asset-response.dto';
import { AssetType, AssetVisibility, JobName, JobStatus } from 'src/enum';
import { DuplicateService } from 'src/services/duplicate.service';
import { AssetFactory } from 'test/factories/asset.factory';
import { authStub } from 'test/fixtures/auth.stub';
import { probeStub } from 'test/fixtures/media.stub';
import { getForDuplicate } from 'test/mappers';
import { newUuid } from 'test/small.factory';
import { makeStream, newTestService, ServiceMocks } from 'test/utils';
import { beforeEach, describe, expect, it, vitest } from 'vitest';

vitest.useFakeTimers();

const hasEmbedding = {
  id: 'asset-1',
  ownerId: 'user-id',
  stackId: null,
  type: AssetType.Image,
  duplicateId: null,
  embedding: '[1, 2, 3, 4]',
  visibility: AssetVisibility.Timeline,
};

const hasDupe = {
  ...hasEmbedding,
  id: 'asset-2',
  duplicateId: 'duplicate-id',
};

describe(DuplicateService.name, () => {
  let sut: DuplicateService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(DuplicateService));
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('getDuplicates', () => {
    it('should get duplicates', async () => {
      const asset = AssetFactory.from().exif().build();
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['duplicate-id']));
      mocks.duplicateRepository.cleanupSingletonGroups.mockResolvedValue();
      mocks.duplicateRepository.getAll.mockResolvedValue([
        {
          duplicateId: 'duplicate-id',
          assets: [getForDuplicate(asset), getForDuplicate(asset)],
        },
      ]);
      await expect(sut.getDuplicates(authStub.admin)).resolves.toEqual([
        {
          duplicateId: 'duplicate-id',
          assets: [expect.objectContaining({ id: asset.id }), expect.objectContaining({ id: asset.id })],
          suggestedKeepAssetIds: [asset.id],
        },
      ]);
    });

    it('should hide private NSFW duplicate assets when requested', async () => {
      mocks.duplicateRepository.cleanupSingletonGroups.mockResolvedValue();
      mocks.duplicateRepository.getAll.mockResolvedValue([]);

      await sut.getDuplicates({ ...authStub.admin, hideNsfwAssets: true });

      expect(mocks.duplicateRepository.getAll).toHaveBeenCalledWith(authStub.admin.user.id, { excludeNsfw: true });
    });

    it('should return suggestedKeepAssetIds based on file size', async () => {
      const smallAsset = AssetFactory.from().exif({ fileSizeInByte: 1000 }).build();
      const largeAsset = AssetFactory.from().exif({ fileSizeInByte: 5000 }).build();
      mocks.duplicateRepository.cleanupSingletonGroups.mockResolvedValue();
      mocks.duplicateRepository.getAll.mockResolvedValue([
        {
          duplicateId: 'duplicate-id',
          assets: [getForDuplicate(smallAsset), getForDuplicate(largeAsset)],
        },
      ]);
      const result = await sut.getDuplicates(authStub.admin);
      expect(result[0].suggestedKeepAssetIds).toEqual([largeAsset.id]);
    });
  });

  describe('handleQueueSearchDuplicates', () => {
    beforeEach(() => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: {
          enabled: true,
          duplicateDetection: {
            enabled: true,
          },
        },
      });
    });

    it('should skip if machine learning is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: {
          enabled: false,
          duplicateDetection: {
            enabled: true,
          },
        },
      });

      await expect(sut.handleQueueSearchDuplicates({})).resolves.toBe(JobStatus.Skipped);
      expect(mocks.job.queue).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(mocks.systemMetadata.get).toHaveBeenCalled();
    });

    it('should skip if duplicate detection is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: {
          enabled: true,
          duplicateDetection: {
            enabled: false,
          },
        },
      });

      await expect(sut.handleQueueSearchDuplicates({})).resolves.toBe(JobStatus.Skipped);
      expect(mocks.job.queue).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(mocks.systemMetadata.get).toHaveBeenCalled();
    });

    it('should queue missing assets', async () => {
      const asset = AssetFactory.create();
      mocks.assetJob.streamForSearchDuplicates.mockReturnValue(makeStream([asset]));

      await sut.handleQueueSearchDuplicates({});

      expect(mocks.assetJob.streamForSearchDuplicates).toHaveBeenCalledWith(undefined);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        {
          name: JobName.AssetDetectDuplicates,
          data: { id: asset.id },
        },
      ]);
    });

    it('should queue all assets', async () => {
      const asset = AssetFactory.create();
      mocks.assetJob.streamForSearchDuplicates.mockReturnValue(makeStream([asset]));

      await sut.handleQueueSearchDuplicates({ force: true });

      expect(mocks.assetJob.streamForSearchDuplicates).toHaveBeenCalledWith(true);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        {
          name: JobName.AssetDetectDuplicates,
          data: { id: asset.id },
        },
      ]);
    });
  });

  describe('handleQueueGenerateVideoDuplicateFrames', () => {
    beforeEach(() => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: {
          enabled: true,
          clip: { enabled: true },
          duplicateDetection: {
            enabled: true,
            enhancedVideo: {
              enabled: true,
              frameCount: 4,
              minMatchingFrames: 2,
              maxDistance: 0.01,
            },
          },
        },
      });
    });

    it('should queue videos with missing enhanced frames', async () => {
      const asset = AssetFactory.create({ type: AssetType.Video });
      mocks.assetJob.streamForVideoDuplicateFrames.mockReturnValue(makeStream([asset]));

      await expect(sut.handleQueueGenerateVideoDuplicateFrames({})).resolves.toBe(JobStatus.Success);

      expect(mocks.assetJob.streamForVideoDuplicateFrames).toHaveBeenCalledWith({ force: undefined, frameCount: 4 });
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        {
          name: JobName.AssetGenerateVideoDuplicateFrames,
          data: { id: asset.id },
        },
      ]);
    });

    it('should skip when enhanced video duplicate detection is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: {
          enabled: true,
          clip: { enabled: true },
          duplicateDetection: {
            enabled: true,
            enhancedVideo: {
              enabled: false,
              frameCount: 4,
              minMatchingFrames: 2,
              maxDistance: 0.01,
            },
          },
        },
      });

      await expect(sut.handleQueueGenerateVideoDuplicateFrames({})).resolves.toBe(JobStatus.Skipped);
      expect(mocks.assetJob.streamForVideoDuplicateFrames).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });
  });

  describe('handleGenerateVideoDuplicateFrames', () => {
    beforeEach(() => {
      mocks.systemMetadata.get.mockResolvedValue({
        image: {
          preview: {
            size: 1440,
          },
        },
        ffmpeg: {},
        machineLearning: {
          enabled: true,
          clip: {
            enabled: true,
            modelName: 'ViT-B-16-SigLIP-384__webli',
          },
          duplicateDetection: {
            enabled: true,
            enhancedVideo: {
              enabled: true,
              frameCount: 4,
              minMatchingFrames: 2,
              maxDistance: 0.01,
            },
          },
        },
      });
    });

    it('should generate and persist sampled video duplicate frames', async () => {
      const asset = AssetFactory.create({ type: AssetType.Video });
      mocks.assetJob.getForVideoDuplicateFrameJob.mockResolvedValue({
        id: asset.id,
        ownerId: asset.ownerId,
        originalPath: '/data/library/video.mp4',
        visibility: AssetVisibility.Timeline,
        videoStream: probeStub.videoStream2160p.videoStream!,
        format: { ...probeStub.videoStream2160p.format, duration: 120 },
      });
      mocks.machineLearning.encodeImage.mockResolvedValue('[1, 2, 3, 4]');
      mocks.duplicateRepository.replaceVideoDuplicateFrames.mockResolvedValue(['/data/thumbs/old-frame.jpeg']);

      await expect(sut.handleGenerateVideoDuplicateFrames({ id: asset.id })).resolves.toBe(JobStatus.Success);

      expect(mocks.media.transcode).toHaveBeenCalledTimes(4);
      expect(mocks.machineLearning.encodeImage).toHaveBeenCalledTimes(4);
      expect(mocks.duplicateRepository.replaceVideoDuplicateFrames).toHaveBeenCalledWith(
        asset.id,
        expect.arrayContaining([
          expect.objectContaining({ assetId: asset.id, frameIndex: 0, timestampMs: 24_000 }),
          expect.objectContaining({ assetId: asset.id, frameIndex: 1, timestampMs: 48_000 }),
          expect.objectContaining({ assetId: asset.id, frameIndex: 2, timestampMs: 72_000 }),
          expect.objectContaining({ assetId: asset.id, frameIndex: 3, timestampMs: 96_000 }),
        ]),
      );
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FileDelete,
        data: { files: ['/data/thumbs/old-frame.jpeg'] },
      });
    });

    it('should mark videos too short for at least two sampled frames as detected', async () => {
      const asset = AssetFactory.create({ type: AssetType.Video });
      mocks.assetJob.getForVideoDuplicateFrameJob.mockResolvedValue({
        id: asset.id,
        ownerId: asset.ownerId,
        originalPath: '/data/library/video.mp4',
        visibility: AssetVisibility.Timeline,
        videoStream: probeStub.videoStream2160p.videoStream!,
        format: { ...probeStub.videoStream2160p.format, duration: 2 },
      });

      await expect(sut.handleGenerateVideoDuplicateFrames({ id: asset.id })).resolves.toBe(JobStatus.Skipped);
      expect(mocks.media.transcode).not.toHaveBeenCalled();
      expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith({
        assetId: asset.id,
        duplicatesDetectedAt: expect.any(Date),
      });
    });

    it('should delete generated files and skip when the CLIP model changes before persistence', async () => {
      const asset = AssetFactory.create({ type: AssetType.Video });
      mocks.assetJob.getForVideoDuplicateFrameJob.mockResolvedValue({
        id: asset.id,
        ownerId: asset.ownerId,
        originalPath: '/data/library/video.mp4',
        visibility: AssetVisibility.Timeline,
        videoStream: probeStub.videoStream2160p.videoStream!,
        format: { ...probeStub.videoStream2160p.format, duration: 120 },
      });
      mocks.machineLearning.encodeImage.mockResolvedValue('[1, 2, 3, 4]');
      mocks.systemMetadata.get
        .mockResolvedValueOnce({
          image: {
            preview: {
              size: 1440,
            },
          },
          ffmpeg: {},
          machineLearning: {
            enabled: true,
            clip: {
              enabled: true,
              modelName: 'ViT-B-16-SigLIP-384__webli',
            },
            duplicateDetection: {
              enabled: true,
              enhancedVideo: {
                enabled: true,
                frameCount: 4,
                minMatchingFrames: 2,
                maxDistance: 0.01,
              },
            },
          },
        })
        .mockResolvedValueOnce({
          image: {
            preview: {
              size: 1440,
            },
          },
          ffmpeg: {},
          machineLearning: {
            enabled: true,
            clip: {
              enabled: true,
              modelName: 'ViT-L-14__openai',
            },
            duplicateDetection: {
              enabled: true,
              enhancedVideo: {
                enabled: true,
                frameCount: 4,
                minMatchingFrames: 2,
                maxDistance: 0.01,
              },
            },
          },
        });

      await expect(sut.handleGenerateVideoDuplicateFrames({ id: asset.id })).resolves.toBe(JobStatus.Skipped);

      expect(mocks.duplicateRepository.replaceVideoDuplicateFrames).not.toHaveBeenCalled();
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FileDelete,
        data: {
          files: expect.arrayContaining([
            expect.stringContaining(`${asset.id}_video_duplicate_0.jpeg`),
            expect.stringContaining(`${asset.id}_video_duplicate_1.jpeg`),
            expect.stringContaining(`${asset.id}_video_duplicate_2.jpeg`),
            expect.stringContaining(`${asset.id}_video_duplicate_3.jpeg`),
          ]),
        },
      });
    });
  });

  describe('delete', () => {
    it('should throw for an unknown or unauthorized group id', async () => {
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set());
      await expect(sut.delete(authStub.admin, 'group-1')).rejects.toThrow(BadRequestException);
      expect(mocks.duplicateRepository.delete).not.toHaveBeenCalled();
    });

    it('should dismiss the duplicate group', async () => {
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
      mocks.duplicateRepository.delete.mockResolvedValue();
      await expect(sut.delete(authStub.admin, 'group-1')).resolves.toBeUndefined();
      expect(mocks.duplicateRepository.delete).toHaveBeenCalledWith(authStub.admin.user.id, 'group-1');
    });
  });

  describe('deleteAll', () => {
    it('should throw if any group id is unknown or unauthorized', async () => {
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
      await expect(sut.deleteAll(authStub.admin, { ids: ['group-1', 'group-2'] })).rejects.toThrow(BadRequestException);
      expect(mocks.duplicateRepository.deleteAll).not.toHaveBeenCalled();
    });

    it('should dismiss all duplicate groups', async () => {
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1', 'group-2']));
      mocks.duplicateRepository.deleteAll.mockResolvedValue();
      await expect(sut.deleteAll(authStub.admin, { ids: ['group-1', 'group-2'] })).resolves.toBeUndefined();
      expect(mocks.duplicateRepository.deleteAll).toHaveBeenCalledWith(authStub.admin.user.id, ['group-1', 'group-2']);
    });
  });

  describe('resolve', () => {
    it('should handle mixed success and failure', async () => {
      const asset = AssetFactory.create();
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1', 'group-2']));
      mocks.duplicateRepository.get.mockResolvedValueOnce(void 0);
      mocks.duplicateRepository.get.mockResolvedValueOnce({
        duplicateId: 'group-2',
        assets: [asset as unknown as MapAsset],
      });

      await expect(
        sut.resolve(authStub.admin, {
          groups: [
            { duplicateId: 'group-1', keepAssetIds: [], trashAssetIds: [] },
            { duplicateId: 'group-2', keepAssetIds: [asset.id], trashAssetIds: [] },
          ],
        }),
      ).resolves.toEqual([
        { id: 'group-1', success: false, error: BulkIdErrorReason.NOT_FOUND },
        { id: 'group-2', success: true },
      ]);
    });

    it('should catch and report errors', async () => {
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
      mocks.duplicateRepository.get.mockRejectedValue(new Error('Database error'));

      await expect(
        sut.resolve(authStub.admin, {
          groups: [{ duplicateId: 'group-1', keepAssetIds: [], trashAssetIds: [] }],
        }),
      ).resolves.toEqual([{ id: 'group-1', success: false, error: BulkIdErrorReason.UNKNOWN }]);
    });
  });

  describe('resolveGroup (via resolve)', () => {
    it('should fail if duplicate group not found', async () => {
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['missing-id']));
      mocks.duplicateRepository.get.mockResolvedValue(void 0);

      await expect(
        sut.resolve(authStub.admin, {
          groups: [{ duplicateId: 'missing-id', keepAssetIds: [], trashAssetIds: [] }],
        }),
      ).resolves.toEqual([
        {
          id: 'missing-id',
          success: false,
          error: BulkIdErrorReason.NOT_FOUND,
        },
      ]);
    });

    it('should resolve only visible duplicate assets when NSFW assets are hidden', async () => {
      const asset = AssetFactory.create();
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
      mocks.duplicateRepository.get.mockResolvedValue({
        duplicateId: 'group-1',
        assets: [asset as unknown as MapAsset],
      });

      await expect(
        sut.resolve(
          { ...authStub.admin, hideNsfwAssets: true },
          {
            groups: [{ duplicateId: 'group-1', keepAssetIds: [asset.id], trashAssetIds: [] }],
          },
        ),
      ).resolves.toEqual([{ id: 'group-1', success: true }]);

      expect(mocks.access.duplicate.checkOwnerAccess).toHaveBeenCalledWith(
        authStub.admin.user.id,
        new Set(['group-1']),
        true,
      );
      expect(mocks.duplicateRepository.get).toHaveBeenCalledWith('group-1', { excludeNsfw: true });
    });

    it('should skip when keepAssetIds contains non-member', async () => {
      const asset = AssetFactory.create();
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
      mocks.duplicateRepository.get.mockResolvedValue({
        duplicateId: 'group-1',
        assets: [asset as unknown as MapAsset],
      });

      await expect(
        sut.resolve(authStub.admin, {
          groups: [{ duplicateId: 'group-1', keepAssetIds: ['asset-999', asset.id], trashAssetIds: [] }],
        }),
      ).resolves.toEqual([{ id: 'group-1', success: true }]);
    });

    it('should skip when trashAssetIds contains non-member', async () => {
      const asset = AssetFactory.create();
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
      mocks.duplicateRepository.get.mockResolvedValue({
        duplicateId: 'group-1',
        assets: [asset as unknown as MapAsset],
      });

      await expect(
        sut.resolve(authStub.admin, {
          groups: [{ duplicateId: 'group-1', keepAssetIds: [asset.id], trashAssetIds: ['asset-999'] }],
        }),
      ).resolves.toEqual([{ id: 'group-1', success: true }]);
    });

    it('should fail if keepAssetIds and trashAssetIds overlap', async () => {
      const asset1 = AssetFactory.create();
      const asset2 = AssetFactory.create();
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
      mocks.duplicateRepository.get.mockResolvedValue({
        duplicateId: 'group-1',
        assets: [asset1 as unknown as MapAsset, asset2 as unknown as MapAsset],
      });

      const result = await sut.resolve(authStub.admin, {
        groups: [{ duplicateId: 'group-1', keepAssetIds: [asset1.id], trashAssetIds: [asset1.id] }],
      });

      expect(result[0].success).toBe(false);
      expect(result[0].errorMessage).toContain('An asset cannot be in both keepAssetIds and trashAssetIds');
    });

    it('should fail if keepAssetIds and trashAssetIds do not cover all assets', async () => {
      const asset1 = AssetFactory.create();
      const asset2 = AssetFactory.create();
      const asset3 = AssetFactory.create();
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
      mocks.duplicateRepository.get.mockResolvedValue({
        duplicateId: 'group-1',
        assets: [asset1 as unknown as MapAsset, asset2 as unknown as MapAsset, asset3 as unknown as MapAsset],
      });

      const result = await sut.resolve(authStub.admin, {
        groups: [{ duplicateId: 'group-1', keepAssetIds: [asset1.id], trashAssetIds: [asset2.id] }],
      });

      expect(result[0].success).toBe(false);
      expect(result[0].errorMessage).toContain('Every asset must be in either keepAssetIds or trashAssetIds');
    });

    it('should fail if partial trash without keepers', async () => {
      const asset1 = AssetFactory.create();
      const asset2 = AssetFactory.create();
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
      mocks.duplicateRepository.get.mockResolvedValue({
        duplicateId: 'group-1',
        assets: [asset1 as unknown as MapAsset, asset2 as unknown as MapAsset],
      });

      const result = await sut.resolve(authStub.admin, {
        groups: [{ duplicateId: 'group-1', keepAssetIds: [], trashAssetIds: [asset1.id] }],
      });

      expect(result[0].success).toBe(false);
      expect(result[0].errorMessage).toContain('Every asset must be in either keepAssetIds or trashAssetIds');
    });

    it('should sync merged tags to asset_exif.tags', async () => {
      const asset1 = AssetFactory.create();
      const asset2 = AssetFactory.create();
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-2']));
      mocks.access.tag.checkOwnerAccess.mockResolvedValue(new Set(['tag-1', 'tag-2']));
      mocks.duplicateRepository.get.mockResolvedValue({
        duplicateId: 'group-1',
        assets: [
          {
            ...asset1,
            tags: [
              {
                id: 'tag-1',
                value: 'Work',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                parentId: null,
                color: null,
              },
            ],
          },
          {
            ...asset2,
            tags: [
              {
                id: 'tag-2',
                value: 'Travel',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                parentId: null,
                color: null,
              },
            ],
          },
        ] as any,
      });

      const result = await sut.resolve(authStub.admin, {
        groups: [{ duplicateId: 'group-1', keepAssetIds: [asset1.id], trashAssetIds: [asset2.id] }],
      });

      expect(result[0].success).toBe(true);

      // Verify tags were applied to tag_asset table
      expect(mocks.tag.replaceAssetTags).toHaveBeenCalledWith(asset1.id, ['tag-1', 'tag-2']);

      // Verify merged tag values were written to asset_exif.tags so SidecarWrite preserves them
      expect(mocks.asset.updateAllExif).toHaveBeenCalledWith([asset1.id], { tags: ['Work', 'Travel'] });

      // Verify SidecarWrite was queued (to write tags to sidecar)
      expect(mocks.job.queueAll).toHaveBeenCalledWith([{ name: JobName.SidecarWrite, data: { id: asset1.id } }]);
    });

    // NOTE: The following integration-style tests are covered by E2E tests instead
    // to avoid complex mock setup. The validation and error-handling logic above
    // is thoroughly unit tested.
  });

  describe('handleSearchDuplicates', () => {
    beforeEach(() => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: {
          enabled: true,
          duplicateDetection: {
            enabled: true,
          },
        },
      });
    });

    it('should skip if machine learning is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: {
          enabled: false,
          duplicateDetection: {
            enabled: true,
          },
        },
      });
      const result = await sut.handleSearchDuplicates({ id: newUuid() });

      expect(result).toBe(JobStatus.Skipped);
      expect(mocks.assetJob.getForSearchDuplicatesJob).not.toHaveBeenCalled();
    });

    it('should skip if duplicate detection is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: {
          enabled: true,
          duplicateDetection: {
            enabled: false,
          },
        },
      });
      const result = await sut.handleSearchDuplicates({ id: newUuid() });

      expect(result).toBe(JobStatus.Skipped);
      expect(mocks.assetJob.getForSearchDuplicatesJob).not.toHaveBeenCalled();
    });

    it('should fail if asset is not found', async () => {
      mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue(void 0);

      const asset = AssetFactory.create();
      const result = await sut.handleSearchDuplicates({ id: asset.id });

      expect(result).toBe(JobStatus.Failed);
      expect(mocks.logger.error).toHaveBeenCalledWith(`Asset ${asset.id} not found`);
    });

    it('should skip if asset is part of stack', async () => {
      const asset = AssetFactory.from().stack().build();
      mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue({ ...hasEmbedding, stackId: asset.stackId });

      const result = await sut.handleSearchDuplicates({ id: asset.id });

      expect(result).toBe(JobStatus.Skipped);
      expect(mocks.logger.debug).toHaveBeenCalledWith(`Asset ${asset.id} is part of a stack, skipping`);
    });

    it('should skip if asset is not visible', async () => {
      const asset = AssetFactory.create({ visibility: AssetVisibility.Hidden });
      mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue({ ...hasEmbedding, ...asset });

      const result = await sut.handleSearchDuplicates({ id: asset.id });

      expect(result).toBe(JobStatus.Skipped);
      expect(mocks.logger.debug).toHaveBeenCalledWith(`Asset ${asset.id} is not visible, skipping`);
    });

    it('should fail if asset is missing embedding', async () => {
      mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue({ ...hasEmbedding, embedding: null });

      const asset = AssetFactory.create();
      const result = await sut.handleSearchDuplicates({ id: asset.id });

      expect(result).toBe(JobStatus.Failed);
      expect(mocks.logger.debug).toHaveBeenCalledWith(`Asset ${asset.id} is missing embedding`);
    });

    it('should search for duplicates and update asset with duplicateId', async () => {
      mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue(hasEmbedding);
      const asset = AssetFactory.create();
      mocks.duplicateRepository.search.mockResolvedValue([{ assetId: asset.id, distance: 0.01, duplicateId: null }]);
      mocks.duplicateRepository.merge.mockResolvedValue();
      const expectedAssetIds = [asset.id, hasEmbedding.id];

      const result = await sut.handleSearchDuplicates({ id: hasEmbedding.id });

      expect(result).toBe(JobStatus.Success);
      expect(mocks.duplicateRepository.search).toHaveBeenCalledWith({
        assetId: hasEmbedding.id,
        embedding: hasEmbedding.embedding,
        maxDistance: 0.01,
        type: hasEmbedding.type,
        userIds: [hasEmbedding.ownerId],
      });
      expect(mocks.duplicateRepository.merge).toHaveBeenCalledWith({
        assetIds: expectedAssetIds,
        targetId: expect.any(String),
        sourceIds: [],
      });
      expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith(
        ...expectedAssetIds.map((assetId) => ({ assetId, duplicatesDetectedAt: expect.any(Date) })),
      );
    });

    it('should use existing duplicate ID among matched duplicates', async () => {
      const duplicateId = hasDupe.duplicateId;
      mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue(hasEmbedding);
      mocks.duplicateRepository.search.mockResolvedValue([{ assetId: hasDupe.id, distance: 0.01, duplicateId }]);
      mocks.duplicateRepository.merge.mockResolvedValue();
      const expectedAssetIds = [hasEmbedding.id];

      const result = await sut.handleSearchDuplicates({ id: hasEmbedding.id });

      expect(result).toBe(JobStatus.Success);
      expect(mocks.duplicateRepository.search).toHaveBeenCalledWith({
        assetId: hasEmbedding.id,
        embedding: hasEmbedding.embedding,
        maxDistance: 0.01,
        type: hasEmbedding.type,
        userIds: [hasEmbedding.ownerId],
      });
      expect(mocks.duplicateRepository.merge).toHaveBeenCalledWith({
        assetIds: expectedAssetIds,
        targetId: duplicateId,
        sourceIds: [],
      });
      expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith(
        ...expectedAssetIds.map((assetId) => ({ assetId, duplicatesDetectedAt: expect.any(Date) })),
      );
    });

    it('should queue enhanced frames and defer grouping when frames are missing', async () => {
      const video = { ...hasEmbedding, type: AssetType.Video };
      const duplicate = { assetId: 'asset-2', distance: 0.01, duplicateId: null };
      mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue(video);
      mocks.duplicateRepository.search.mockResolvedValue([duplicate]);
      mocks.duplicateRepository.getVideoDuplicateFrames.mockResolvedValue([]);
      mocks.duplicateRepository.merge.mockResolvedValue();

      const result = await sut.handleSearchDuplicates({ id: video.id });

      expect(result).toBe(JobStatus.Success);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.AssetGenerateVideoDuplicateFrames, data: { id: video.id } },
        { name: JobName.AssetGenerateVideoDuplicateFrames, data: { id: duplicate.assetId } },
      ]);
      expect(mocks.duplicateRepository.merge).not.toHaveBeenCalled();
      expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith({
        assetId: video.id,
        duplicatesDetectedAt: expect.any(Date),
      });
    });

    it('should not group video duplicates when enhanced frames do not match', async () => {
      const video = { ...hasEmbedding, type: AssetType.Video };
      const duplicate = { assetId: 'asset-2', distance: 0.01, duplicateId: null };
      mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue(video);
      mocks.duplicateRepository.search.mockResolvedValue([duplicate]);
      mocks.duplicateRepository.getVideoDuplicateFrames.mockResolvedValue([
        ...[0, 1, 2, 3].map((frameIndex) => ({ assetId: video.id, frameIndex })),
        ...[0, 1, 2, 3].map((frameIndex) => ({ assetId: duplicate.assetId, frameIndex })),
      ] as any);
      mocks.duplicateRepository.getVideoDuplicateFrameMatches.mockResolvedValue([]);

      const result = await sut.handleSearchDuplicates({ id: video.id });

      expect(result).toBe(JobStatus.Success);
      expect(mocks.duplicateRepository.merge).not.toHaveBeenCalled();
      expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith({
        assetId: video.id,
        duplicatesDetectedAt: expect.any(Date),
      });
    });

    it('should group video duplicates when enough enhanced frames match', async () => {
      const video = { ...hasEmbedding, type: AssetType.Video };
      const duplicate = { assetId: 'asset-2', distance: 0.01, duplicateId: null };
      mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue(video);
      mocks.duplicateRepository.search.mockResolvedValue([duplicate]);
      mocks.duplicateRepository.getVideoDuplicateFrames.mockResolvedValue([
        ...[0, 1, 2, 3].map((frameIndex) => ({ assetId: video.id, frameIndex })),
        ...[0, 1, 2, 3].map((frameIndex) => ({ assetId: duplicate.assetId, frameIndex })),
      ] as any);
      mocks.duplicateRepository.getVideoDuplicateFrameMatches.mockResolvedValue([duplicate.assetId]);
      mocks.duplicateRepository.merge.mockResolvedValue();
      const expectedAssetIds = [duplicate.assetId, video.id];

      const result = await sut.handleSearchDuplicates({ id: video.id });

      expect(result).toBe(JobStatus.Success);
      expect(mocks.duplicateRepository.getVideoDuplicateFrameMatches).toHaveBeenCalledWith({
        assetId: video.id,
        candidateAssetIds: [duplicate.assetId],
        maxDistance: 0.01,
        minMatchingFrames: 2,
      });
      expect(mocks.duplicateRepository.merge).toHaveBeenCalledWith({
        assetIds: expectedAssetIds,
        targetId: expect.any(String),
        sourceIds: [],
      });
      expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith(
        ...expectedAssetIds.map((assetId) => ({ assetId, duplicatesDetectedAt: expect.any(Date) })),
      );
    });

    it('should remove duplicateId if no duplicates found and asset has duplicateId', async () => {
      mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue(hasDupe);
      mocks.duplicateRepository.search.mockResolvedValue([]);

      const result = await sut.handleSearchDuplicates({ id: hasDupe.id });

      expect(result).toBe(JobStatus.Success);
      expect(mocks.asset.update).toHaveBeenCalledWith({ id: hasDupe.id, duplicateId: null });
      expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith({
        assetId: hasDupe.id,
        duplicatesDetectedAt: expect.any(Date),
      });
    });
  });
});
