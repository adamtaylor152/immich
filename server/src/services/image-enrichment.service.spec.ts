import { createHash } from 'node:crypto';
import { defaults } from 'src/config';
import { AssetImageEnrichmentAction } from 'src/dtos/asset.dto';
import { AssetMetadataKey, AssetStatus, AssetType, AssetVisibility, JobName, JobStatus } from 'src/enum';
import { ImageEnrichmentService } from 'src/services/image-enrichment.service';
import { authStub } from 'test/fixtures/auth.stub';
import { newUuid } from 'test/small.factory';
import { makeStream, newTestService, ServiceMocks } from 'test/utils';

describe(ImageEnrichmentService.name, () => {
  let sut: ImageEnrichmentService;
  let mocks: ServiceMocks;

  const ownerId = newUuid();
  const assetId = newUuid();
  const previewFile = '/data/thumbs/preview.webp';

  beforeEach(() => {
    ({ sut, mocks } = newTestService(ImageEnrichmentService));

    mocks.assetJob.getForImageEnrichment.mockResolvedValue({
      id: assetId,
      ownerId,
      type: AssetType.Image,
      status: AssetStatus.Active,
      deletedAt: null,
      visibility: AssetVisibility.Timeline,
      description: '',
      previewFile,
    });
    mocks.asset.getForUpdateTags.mockResolvedValue({
      tags: [{ value: 'nsfw' }, { value: 'explicit' }, { value: 'beach' }],
    });
    mocks.tag.upsertValue.mockImplementation(({ userId, value }) =>
      Promise.resolve({ id: `${value}-id`, userId, value, parentId: null } as never),
    );
    mocks.tag.upsertAssetIds.mockResolvedValue([{ assetId, tagId: 'nsfw-id' } as never]);
    // Default: no named faces — keeps existing tests unaffected.
    mocks.person.getFaces.mockResolvedValue([]);
  });

  it('should store NSFW results and apply visible NSFW tags when only NSFW detection is enabled', async () => {
    mocks.systemMetadata.get.mockResolvedValue({
      machineLearning: { nsfwDetection: { enabled: true }, imageDescription: { enabled: false } },
    });
    mocks.machineLearning.detectNsfw.mockResolvedValue({
      isNsfw: true,
      score: 0.95,
      labels: { explicit: 0.95, normal: 0.05 },
    });

    await expect(sut.handleNsfwDetection({ id: assetId })).resolves.toBe(JobStatus.Success);

    expect(mocks.machineLearning.detectNsfw).toHaveBeenCalledWith(
      previewFile,
      expect.objectContaining({ modelName: 'onnx-community/nsfw_image_detection-ONNX', threshold: 0.85 }),
    );
    expect(mocks.tag.upsertValue).toHaveBeenCalledWith(expect.objectContaining({ userId: ownerId, value: 'nsfw' }));
    expect(mocks.tag.upsertValue).toHaveBeenCalledWith(expect.objectContaining({ userId: ownerId, value: 'explicit' }));
    expect(mocks.asset.upsertExif).toHaveBeenCalledWith({
      exif: expect.objectContaining({ assetId, tags: ['nsfw', 'explicit', 'beach'] }),
      lockedPropertiesBehavior: 'append',
    });
    expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.SidecarWrite, data: { id: assetId } });
    expect(mocks.asset.upsertMetadata).toHaveBeenCalledWith(
      assetId,
      expect.arrayContaining([expect.objectContaining({ key: AssetMetadataKey.MlEnrichment })]),
      undefined,
    );
  });

  it('should queue description backfill jobs in batches when description generation is enabled', async () => {
    const firstAssetId = newUuid();
    const secondAssetId = newUuid();
    mocks.systemMetadata.get.mockResolvedValue({
      machineLearning: { enabled: true, nsfwDetection: { enabled: false }, imageDescription: { enabled: true } },
    });
    mocks.assetJob.streamForImageDescriptionJob.mockReturnValue(
      makeStream([{ id: firstAssetId }, { id: secondAssetId }]),
    );

    await expect(sut.handleQueueImageDescription({ force: false })).resolves.toBe(JobStatus.Success);

    expect(mocks.assetJob.streamForImageDescriptionJob).toHaveBeenCalledWith(false);
    expect(mocks.job.queueAll).toHaveBeenCalledWith([
      { name: JobName.ImageDescription, data: { id: firstAssetId } },
      { name: JobName.ImageDescription, data: { id: secondAssetId } },
    ]);
  });

  it('should require asset update access when reading private enrichment metadata', async () => {
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    mocks.asset.getMetadataByKey.mockResolvedValue({ value: {} } as never);

    await expect(sut.getAssetEnrichment(authStub.user1, assetId)).resolves.toMatchObject({ assetId });

    expect(mocks.access.asset.checkOwnerAccess).toHaveBeenCalledWith(
      authStub.user1.user.id,
      new Set([assetId]),
      authStub.user1.session?.hasElevatedPermission,
    );
    expect(mocks.access.asset.checkAlbumAccess).not.toHaveBeenCalled();
    expect(mocks.access.asset.checkPartnerAccess).not.toHaveBeenCalled();
  });

  it('should skip NSFW backfill when NSFW detection is disabled', async () => {
    mocks.systemMetadata.get.mockResolvedValue({
      machineLearning: { enabled: true, nsfwDetection: { enabled: false }, imageDescription: { enabled: true } },
    });

    await expect(sut.handleQueueNsfwDetection({ force: false })).resolves.toBe(JobStatus.Skipped);

    expect(mocks.assetJob.streamForNsfwDetectionJob).not.toHaveBeenCalled();
    expect(mocks.job.queueAll).not.toHaveBeenCalled();
  });

  it('should run NSFW detection before image description when both scans are enabled', async () => {
    mocks.systemMetadata.get.mockResolvedValue({
      machineLearning: { nsfwDetection: { enabled: true }, imageDescription: { enabled: true } },
    });
    mocks.assetJob.getForImageEnrichment.mockResolvedValue({
      id: assetId,
      ownerId,
      type: AssetType.Image,
      status: AssetStatus.Active,
      deletedAt: null,
      visibility: AssetVisibility.Timeline,
      description: 'User note',
      previewFile,
    });
    const nsfw = {
      isNsfw: true,
      score: 0.91,
      labels: { sexy: 0.91, normal: 0.03 },
    };
    mocks.machineLearning.detectNsfw.mockResolvedValue(nsfw);
    mocks.machineLearning.describeImage.mockResolvedValue({
      description: 'A person standing on a beach.',
      people: [],
      environment: 'beach',
      objects: ['sand'],
      visible_text: [],
      context: 'beach photo',
      tags: ['Beach', 'Person'],
    });

    await expect(sut.handleImageDescription({ id: assetId })).resolves.toBe(JobStatus.Success);

    expect(mocks.machineLearning.detectNsfw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.machineLearning.describeImage.mock.invocationCallOrder[0],
    );
    expect(mocks.machineLearning.describeImage).toHaveBeenCalledWith(
      previewFile,
      expect.objectContaining({ modelName: 'Qwen/Qwen2.5-VL-3B-Instruct' }),
      nsfw,
      expect.stringMatching(/searchable image record[\s\S]*dedicated NSFW classifier flagged/i),
    );
    expect(mocks.asset.upsertExif).toHaveBeenCalledWith({
      exif: expect.objectContaining({
        assetId,
        description: 'User note\n\nAI description: A person standing on a beach.',
      }),
      lockedPropertiesBehavior: 'append',
    });
    expect(mocks.tag.upsertValue).toHaveBeenCalledWith(expect.objectContaining({ userId: ownerId, value: 'beach' }));
    expect(mocks.tag.upsertValue).toHaveBeenCalledWith(expect.objectContaining({ userId: ownerId, value: 'nsfw' }));
    expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.SidecarWrite, data: { id: assetId } });
  });

  it('should auto-mark NSFW from high-confidence description safety when classifier is safe', async () => {
    mocks.systemMetadata.get.mockResolvedValue({
      machineLearning: { nsfwDetection: { enabled: true }, imageDescription: { enabled: true } },
    });
    mocks.machineLearning.detectNsfw.mockResolvedValue({
      isNsfw: false,
      score: 0.04,
      labels: { normal: 0.96 },
    });
    mocks.machineLearning.describeImage.mockResolvedValue({
      description: 'A naked adult man is lying on a bed under a gray blanket.',
      people: [],
      environment: 'bedroom',
      objects: ['bed', 'blanket'],
      visible_text: [],
      context: 'indoor bedroom photo',
      tags: [],
      safety: {
        is_nsfw_likely: true,
        confidence: 'high',
        indicators: ['nudity', 'naked'],
        reason: 'Adult nudity is visible.',
      },
    });

    await expect(sut.handleImageDescription({ id: assetId })).resolves.toBe(JobStatus.Success);

    expect(mocks.tag.upsertValue).toHaveBeenCalledWith(expect.objectContaining({ userId: ownerId, value: 'nsfw' }));
    expect(mocks.tag.upsertValue).toHaveBeenCalledWith(expect.objectContaining({ userId: ownerId, value: 'nudity' }));
    expect(mocks.tag.upsertValue).toHaveBeenCalledWith(expect.objectContaining({ userId: ownerId, value: 'naked' }));
    // Walk back to the in-lock save that actually persisted the description
    // block; persistAppliedBookkeeping issues a second save with only the
    // tag-application deltas and never carries `description.result`.
    const descriptionCall = mocks.asset.upsertMetadata.mock.calls.find(
      (call) => (call[1][0]?.value as { description?: { result?: unknown } } | undefined)?.description?.result,
    )!;
    const saved = descriptionCall[1][0].value as { description: Record<string, unknown> };
    expect(saved.description.result).toEqual(
      expect.objectContaining({
        safety: expect.objectContaining({ is_nsfw_likely: true, confidence: 'high' }),
      }),
    );
  });

  it('should not auto-mark NSFW from weak description safety cues', async () => {
    mocks.systemMetadata.get.mockResolvedValue({
      machineLearning: { nsfwDetection: { enabled: true }, imageDescription: { enabled: true } },
    });
    mocks.machineLearning.detectNsfw.mockResolvedValue({
      isNsfw: false,
      score: 0.04,
      labels: { normal: 0.96 },
    });
    mocks.machineLearning.describeImage.mockResolvedValue({
      description: 'A bare-chested adult is lying on a bed.',
      people: [],
      environment: 'bedroom',
      objects: ['bed'],
      visible_text: [],
      context: 'indoor bedroom photo',
      tags: ['bedroom', 'nsfw', 'nudity'],
      safety: {
        is_nsfw_likely: true,
        confidence: 'high',
        indicators: ['bare chest', 'bed'],
        reason: 'A bare chest and bed are visible.',
      },
    });

    await expect(sut.handleImageDescription({ id: assetId })).resolves.toBe(JobStatus.Success);

    expect(mocks.tag.upsertValue).toHaveBeenCalledWith(expect.objectContaining({ userId: ownerId, value: 'bedroom' }));
    expect(mocks.tag.upsertValue).not.toHaveBeenCalledWith(expect.objectContaining({ userId: ownerId, value: 'nsfw' }));
    expect(mocks.tag.upsertValue).not.toHaveBeenCalledWith(
      expect.objectContaining({ userId: ownerId, value: 'nudity' }),
    );
  });

  it('should apply medical tags without marking NSFW', async () => {
    mocks.systemMetadata.get.mockResolvedValue({
      machineLearning: { nsfwDetection: { enabled: true }, imageDescription: { enabled: true } },
    });
    mocks.machineLearning.detectNsfw.mockResolvedValue({
      isNsfw: false,
      score: 0.02,
      labels: { normal: 0.98 },
    });
    mocks.machineLearning.describeImage.mockResolvedValue({
      description: 'A person is lying in a hospital bed with an IV line nearby.',
      people: [],
      environment: 'hospital room',
      objects: ['hospital bed', 'iv line'],
      visible_text: [],
      context: 'medical setting',
      tags: [],
      medical: {
        is_medical_likely: true,
        confidence: 'high',
        indicators: ['hospital', 'iv line'],
        reason: 'A hospital bed and IV line are visible.',
      },
    });

    await expect(sut.handleImageDescription({ id: assetId })).resolves.toBe(JobStatus.Success);

    expect(mocks.tag.upsertValue).toHaveBeenCalledWith(expect.objectContaining({ userId: ownerId, value: 'medical' }));
    expect(mocks.tag.upsertValue).toHaveBeenCalledWith(expect.objectContaining({ userId: ownerId, value: 'iv-line' }));
    expect(mocks.tag.upsertValue).not.toHaveBeenCalledWith(expect.objectContaining({ userId: ownerId, value: 'nsfw' }));
  });

  it('should store description failures without applying visible metadata', async () => {
    mocks.systemMetadata.get.mockResolvedValue({
      machineLearning: {
        enabled: true,
        nsfwDetection: { enabled: false },
        imageDescription: { enabled: true, modelName: 'Qwen/Qwen2.5-VL-3B-Instruct' },
      },
    });
    mocks.machineLearning.describeImage.mockRejectedValue(new Error('model unavailable'));

    await expect(sut.handleImageDescription({ id: assetId })).resolves.toBe(JobStatus.Failed);

    expect(mocks.asset.upsertExif).not.toHaveBeenCalled();
    expect(mocks.tag.upsertValue).not.toHaveBeenCalled();
    expect(mocks.job.queue).not.toHaveBeenCalledWith({ name: JobName.SidecarWrite, data: { id: assetId } });
    expect(mocks.asset.upsertMetadata).toHaveBeenCalledWith(
      assetId,
      expect.arrayContaining([
        expect.objectContaining({
          key: AssetMetadataKey.MlEnrichment,
          value: expect.objectContaining({
            description: expect.objectContaining({
              status: 'failed',
              modelName: 'Qwen/Qwen2.5-VL-3B-Instruct',
              error: 'model unavailable',
            }),
          }),
        }),
      ]),
      undefined,
    );
  });

  it('should record a configHash on the description metadata when the job succeeds', async () => {
    // No imageDescription override: the merged prompt config equals defaults,
    // so we can compute the exact expected hash from defaults below.
    mocks.systemMetadata.get.mockResolvedValue({
      machineLearning: {
        enabled: true,
        nsfwDetection: { enabled: false },
      },
    });
    mocks.machineLearning.describeImage.mockResolvedValue({
      description: 'A sunny park.',
      people: [],
      environment: 'outdoors',
      objects: [],
      visible_text: [],
      context: '',
      tags: [],
    });

    await expect(sut.handleImageDescription({ id: assetId })).resolves.toBe(JobStatus.Success);

    const expectedHash = createHash('sha256')
      .update(JSON.stringify(defaults.machineLearning.imageDescription.prompt))
      .digest('hex')
      .slice(0, 8);

    const descriptionCall = mocks.asset.upsertMetadata.mock.calls.find(
      (call) => (call[1][0]?.value as { description?: { result?: unknown } } | undefined)?.description?.result,
    )!;
    const saved = descriptionCall[1][0].value as { description: Record<string, unknown> };
    expect(saved.description.configHash).toBe(expectedHash);
  });

  it('should not record a configHash on failed description metadata', async () => {
    mocks.systemMetadata.get.mockResolvedValue({
      machineLearning: {
        enabled: true,
        nsfwDetection: { enabled: false },
        imageDescription: { enabled: true, modelName: 'Qwen/Qwen2.5-VL-3B-Instruct' },
      },
    });
    mocks.machineLearning.describeImage.mockRejectedValue(new Error('model error'));

    await expect(sut.handleImageDescription({ id: assetId })).resolves.toBe(JobStatus.Failed);

    const failCall = mocks.asset.upsertMetadata.mock.calls.find(
      (call) =>
        (call[1][0]?.value as { description?: { status?: string } } | undefined)?.description?.status === 'failed',
    )!;
    const saved = failCall[1][0].value as { description: Record<string, unknown> };
    expect(saved.description).not.toHaveProperty('configHash');
  });

  it('should not append an existing generated description block again', async () => {
    const description = 'A bright kitchen with a wooden table.';
    mocks.systemMetadata.get.mockResolvedValue({
      machineLearning: {
        enabled: true,
        nsfwDetection: { enabled: false },
        imageDescription: { enabled: true, modelName: 'Qwen/Qwen2.5-VL-3B-Instruct' },
      },
    });
    mocks.assetJob.getForImageEnrichment.mockResolvedValue({
      id: assetId,
      ownerId,
      type: AssetType.Image,
      status: AssetStatus.Active,
      deletedAt: null,
      visibility: AssetVisibility.Timeline,
      description: `User note\n\nAI description: ${description}`,
      previewFile,
    });
    mocks.machineLearning.describeImage.mockResolvedValue({
      description,
      people: [],
      environment: 'kitchen',
      objects: ['table'],
      visible_text: [],
      context: 'indoor home photo',
      tags: [],
    });

    await expect(sut.handleImageDescription({ id: assetId })).resolves.toBe(JobStatus.Success);

    expect(mocks.asset.upsertExif).not.toHaveBeenCalled();
    expect(mocks.job.queue).not.toHaveBeenCalledWith({ name: JobName.SidecarWrite, data: { id: assetId } });
    expect(mocks.asset.upsertMetadata).toHaveBeenCalledWith(
      assetId,
      expect.arrayContaining([
        expect.objectContaining({
          key: AssetMetadataKey.MlEnrichment,
          value: expect.objectContaining({
            description: expect.objectContaining({
              appliedDescriptionHash: expect.any(String),
            }),
          }),
        }),
      ]),
      undefined,
    );
  });

  it('should replace the previous generated description block on rerun', async () => {
    mocks.systemMetadata.get.mockResolvedValue({
      machineLearning: {
        enabled: true,
        nsfwDetection: { enabled: false },
        imageDescription: { enabled: true, modelName: 'Qwen/Qwen2.5-VL-3B-Instruct' },
      },
    });
    mocks.assetJob.getForImageEnrichment.mockResolvedValue({
      id: assetId,
      ownerId,
      type: AssetType.Image,
      status: AssetStatus.Active,
      deletedAt: null,
      visibility: AssetVisibility.Timeline,
      description: 'User note\n\nAI description: A dim kitchen.',
      previewFile,
    });
    mocks.asset.getMetadataByKey.mockResolvedValue({
      key: AssetMetadataKey.MlEnrichment,
      updatedAt: new Date(),
      value: {
        description: {
          status: 'success',
          modelName: 'Qwen/Qwen2.5-VL-3B-Instruct',
          updatedAt: '2026-05-05T00:00:00.000Z',
          appliedDescriptionHash: 'old-hash',
          result: {
            description: 'A dim kitchen.',
            people: [],
            environment: 'kitchen',
            objects: [],
            visible_text: [],
            context: '',
            tags: [],
          },
        },
      },
    });
    mocks.machineLearning.describeImage.mockResolvedValue({
      description: 'A bright kitchen with a wooden table.',
      people: [],
      environment: 'kitchen',
      objects: ['table'],
      visible_text: [],
      context: 'indoor home photo',
      tags: [],
    });

    await expect(sut.handleImageDescription({ id: assetId })).resolves.toBe(JobStatus.Success);

    expect(mocks.asset.upsertExif).toHaveBeenCalledWith({
      exif: expect.objectContaining({
        assetId,
        description: 'User note\n\nAI description: A bright kitchen with a wooden table.',
      }),
      lockedPropertiesBehavior: 'append',
    });
    expect(mocks.asset.upsertExif).not.toHaveBeenCalledWith({
      exif: expect.objectContaining({ description: expect.stringContaining('A dim kitchen.') }),
      lockedPropertiesBehavior: 'append',
    });
    expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.SidecarWrite, data: { id: assetId } });
  });

  it.each([
    ['trashed', AssetStatus.Trashed, new Date()] as const,
    ['deleted', AssetStatus.Deleted, new Date()] as const,
  ])('should skip %s assets for single image enrichment jobs', async (_label, status, deletedAt) => {
    mocks.systemMetadata.get.mockResolvedValue({
      machineLearning: { nsfwDetection: { enabled: true }, imageDescription: { enabled: true } },
    });
    mocks.assetJob.getForImageEnrichment.mockResolvedValue({
      id: assetId,
      ownerId,
      type: AssetType.Image,
      status,
      deletedAt,
      visibility: AssetVisibility.Timeline,
      description: '',
      previewFile,
    });

    await expect(sut.handleImageDescription({ id: assetId })).resolves.toBe(JobStatus.Skipped);

    expect(mocks.machineLearning.detectNsfw).not.toHaveBeenCalled();
    expect(mocks.machineLearning.describeImage).not.toHaveBeenCalled();
    expect(mocks.asset.upsertMetadata).not.toHaveBeenCalled();
  });

  it('should skip locked assets for single image enrichment jobs', async () => {
    mocks.systemMetadata.get.mockResolvedValue({
      machineLearning: { nsfwDetection: { enabled: true }, imageDescription: { enabled: true } },
    });
    mocks.assetJob.getForImageEnrichment.mockResolvedValue({
      id: assetId,
      ownerId,
      type: AssetType.Image,
      status: AssetStatus.Active,
      deletedAt: null,
      visibility: AssetVisibility.Locked,
      description: '',
      previewFile,
    });

    await expect(sut.handleNsfwDetection({ id: assetId })).resolves.toBe(JobStatus.Skipped);

    expect(mocks.machineLearning.detectNsfw).not.toHaveBeenCalled();
    expect(mocks.asset.upsertMetadata).not.toHaveBeenCalled();
  });

  it('should mark an NSFW result as safe and remove generated NSFW tags', async () => {
    mocks.asset.getById.mockResolvedValue({
      id: assetId,
      ownerId,
      exifInfo: { description: '' },
      tags: [],
    } as never);
    mocks.asset.getMetadataByKey.mockResolvedValue({
      key: AssetMetadataKey.MlEnrichment,
      updatedAt: new Date(),
      value: {
        nsfwDetection: {
          status: 'success',
          modelName: 'onnx-community/nsfw_image_detection-ONNX',
          updatedAt: '2026-05-05T00:00:00.000Z',
          appliedTagHash: 'hash',
          appliedTagValues: ['nsfw', 'explicit'],
          result: {
            isNsfw: true,
            score: 0.95,
            labels: { explicit: 0.95 },
          },
        },
      },
    });
    mocks.tag.getByValue
      .mockResolvedValueOnce({
        id: 'nsfw-id',
        value: 'nsfw',
        color: null,
        parentId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .mockResolvedValueOnce({
        id: 'explicit-id',
        value: 'explicit',
        color: null,
        parentId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));

    const result = await sut.updateAssetEnrichment(authStub.admin, assetId, {
      action: AssetImageEnrichmentAction.MarkSafe,
    });

    expect(result.nsfwDetection.effectiveIsNsfw).toBe(false);
    expect(result.nsfwDetection.review).toEqual(
      expect.objectContaining({ action: 'marked-safe', isNsfw: false, reviewedBy: authStub.admin.user.id }),
    );
    expect(mocks.tag.removeAssetIds).toHaveBeenCalledWith('nsfw-id', [assetId]);
    expect(mocks.tag.removeAssetIds).toHaveBeenCalledWith('explicit-id', [assetId]);
    expect(mocks.asset.upsertMetadata).toHaveBeenCalledWith(
      assetId,
      expect.arrayContaining([
        expect.objectContaining({
          value: expect.objectContaining({
            nsfwDetection: expect.objectContaining({
              result: expect.objectContaining({ isNsfw: true }),
              review: expect.objectContaining({ action: 'marked-safe', isNsfw: false }),
            }),
          }),
        }),
      ]),
      undefined,
    );
    expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.SidecarWrite, data: { id: assetId } });
  });

  it('should clear previously applied NSFW tags when a rerun detects the asset as safe', async () => {
    mocks.systemMetadata.get.mockResolvedValue({
      machineLearning: {
        enabled: true,
        nsfwDetection: {
          enabled: true,
          modelName: 'onnx-community/nsfw_image_detection-ONNX',
          threshold: 0.85,
        },
        imageDescription: { enabled: false },
      },
    });
    mocks.asset.getMetadataByKey.mockResolvedValue({
      key: AssetMetadataKey.MlEnrichment,
      updatedAt: new Date(),
      value: {
        nsfwDetection: {
          status: 'success',
          modelName: 'onnx-community/nsfw_image_detection-ONNX',
          updatedAt: '2026-05-05T00:00:00.000Z',
          appliedTagHash: 'old-hash',
          appliedTagValues: ['nsfw', 'explicit'],
          result: {
            isNsfw: true,
            score: 0.95,
            labels: { explicit: 0.95 },
          },
        },
      },
    });
    mocks.machineLearning.detectNsfw.mockResolvedValue({
      isNsfw: false,
      score: 0.04,
      labels: { normal: 0.96 },
    });
    mocks.asset.getForUpdateTags.mockResolvedValue({ tags: [{ value: 'beach' }] });
    mocks.tag.getByValue
      .mockResolvedValueOnce({
        id: 'nsfw-id',
        value: 'nsfw',
        color: null,
        parentId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .mockResolvedValueOnce({
        id: 'explicit-id',
        value: 'explicit',
        color: null,
        parentId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

    await expect(sut.handleNsfwDetection({ id: assetId })).resolves.toBe(JobStatus.Success);

    expect(mocks.tag.removeAssetIds).toHaveBeenCalledWith('nsfw-id', [assetId]);
    expect(mocks.tag.removeAssetIds).toHaveBeenCalledWith('explicit-id', [assetId]);
    expect(mocks.asset.upsertExif).toHaveBeenCalledWith({
      exif: expect.objectContaining({ assetId, tags: ['beach'] }),
      lockedPropertiesBehavior: 'append',
    });
    const lastCall = mocks.asset.upsertMetadata.mock.calls.at(-1)!;
    const saved = lastCall[1][0].value as { nsfwDetection: Record<string, unknown> };
    expect(saved.nsfwDetection.result).toEqual(expect.objectContaining({ isNsfw: false }));
    expect(saved.nsfwDetection).not.toHaveProperty('appliedTagHash');
    expect(saved.nsfwDetection).not.toHaveProperty('appliedTagValues');
    expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.SidecarWrite, data: { id: assetId } });
  });

  it('should clear generated description without removing user text', async () => {
    mocks.asset.getById.mockResolvedValue({
      id: assetId,
      ownerId,
      exifInfo: { description: 'User note\n\nAI description: A generated caption.' },
      tags: [],
    } as never);
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    mocks.asset.getMetadataByKey.mockResolvedValue({
      key: AssetMetadataKey.MlEnrichment,
      updatedAt: new Date(),
      value: {
        description: {
          status: 'success',
          modelName: 'Qwen/Qwen2.5-VL-3B-Instruct',
          updatedAt: '2026-05-05T00:00:00.000Z',
          appliedDescriptionHash: 'hash',
          result: {
            description: 'A generated caption.',
            people: [],
            environment: '',
            objects: [],
            visible_text: [],
            context: '',
            tags: [],
          },
        },
      },
    });

    await sut.updateAssetEnrichment(authStub.admin, assetId, {
      action: AssetImageEnrichmentAction.ClearGeneratedDescription,
    });

    expect(mocks.asset.upsertExif).toHaveBeenCalledWith({
      exif: expect.objectContaining({ assetId, description: 'User note' }),
      lockedPropertiesBehavior: 'append',
    });
    expect(mocks.asset.upsertMetadata).toHaveBeenCalledWith(
      assetId,
      expect.arrayContaining([
        expect.objectContaining({
          value: {
            description: expect.not.objectContaining({ appliedDescriptionHash: expect.any(String) }),
          },
        }),
      ]),
      undefined,
    );
    expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.SidecarWrite, data: { id: assetId } });
  });

  it('should not remove manually-authored tags when clearing generated tags without provenance', async () => {
    mocks.asset.getById.mockResolvedValue({
      id: assetId,
      ownerId,
      exifInfo: { description: '' },
      tags: [],
    } as never);
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    mocks.asset.getMetadataByKey.mockResolvedValue({
      key: AssetMetadataKey.MlEnrichment,
      updatedAt: new Date(),
      value: {
        description: {
          status: 'success',
          modelName: 'Qwen/Qwen2.5-VL-3B-Instruct',
          updatedAt: '2026-05-05T00:00:00.000Z',
          appliedTagHash: 'hash',
          appliedTagValues: [],
          result: {
            description: '',
            people: [],
            environment: '',
            objects: [],
            visible_text: [],
            context: '',
            tags: ['Beach'],
          },
        },
      },
    });

    await sut.updateAssetEnrichment(authStub.admin, assetId, {
      action: AssetImageEnrichmentAction.ClearGeneratedTags,
    });

    expect(mocks.tag.getByValue).not.toHaveBeenCalled();
    expect(mocks.tag.removeAssetIds).not.toHaveBeenCalled();
    const lastCall = mocks.asset.upsertMetadata.mock.calls.at(-1)!;
    const saved = lastCall[1][0].value as { description: Record<string, unknown> };
    expect(saved.description).not.toHaveProperty('appliedTagHash');
    expect(saved.description).not.toHaveProperty('appliedTagValues');
    expect(mocks.job.queue).not.toHaveBeenCalledWith({ name: JobName.SidecarWrite, data: { id: assetId } });
  });

  describe('identity injection — face data wiring', () => {
    const enabledConfig = {
      machineLearning: {
        enabled: true,
        nsfwDetection: { enabled: false },
        imageDescription: { enabled: true },
      },
    };

    beforeEach(() => {
      mocks.systemMetadata.get.mockResolvedValue(enabledConfig);
      mocks.machineLearning.describeImage.mockResolvedValue({
        description: 'Conner is playing baseball.',
        people: [],
        environment: 'outdoor field',
        objects: ['baseball bat'],
        visible_text: [],
        context: 'youth baseball game',
        tags: ['baseball', 'outdoors'],
      });
    });

    it('passes named visible faces to the prompt assembler as knownPersons', async () => {
      mocks.person.getFaces.mockResolvedValue([
        {
          id: newUuid(),
          assetId,
          personId: newUuid(),
          imageWidth: 400,
          imageHeight: 500,
          boundingBoxX1: 100,
          boundingBoxX2: 200,
          boundingBoxY1: 100,
          boundingBoxY2: 200,
          isVisible: true,
          deletedAt: null,
          sourceType: 'machine-learning' as never,
          updatedAt: new Date(),
          updateId: newUuid(),
          person: { id: newUuid(), name: 'Conner', isHidden: false } as never,
        },
      ]);

      await expect(sut.handleImageDescription({ id: assetId })).resolves.toBe(JobStatus.Success);

      expect(mocks.person.getFaces).toHaveBeenCalledWith(assetId, { isVisible: true });
      // The prompt assembler is called with a prompt that includes the known person hint.
      expect(mocks.machineLearning.describeImage).toHaveBeenCalledWith(
        previewFile,
        expect.anything(),
        undefined,
        expect.stringContaining('Conner'),
      );
    });

    it('excludes faces with null personId from knownPersons', async () => {
      mocks.person.getFaces.mockResolvedValue([
        {
          id: newUuid(),
          assetId,
          personId: null,
          imageWidth: 400,
          imageHeight: 500,
          boundingBoxX1: 100,
          boundingBoxX2: 200,
          boundingBoxY1: 100,
          boundingBoxY2: 200,
          isVisible: true,
          deletedAt: null,
          sourceType: 'machine-learning' as never,
          updatedAt: new Date(),
          updateId: newUuid(),
          person: null,
        },
      ]);

      await expect(sut.handleImageDescription({ id: assetId })).resolves.toBe(JobStatus.Success);

      // Prompt should NOT contain any name hint.
      expect(mocks.machineLearning.describeImage).toHaveBeenCalledWith(
        previewFile,
        expect.anything(),
        undefined,
        expect.not.stringContaining('Known people'),
      );
    });

    it('excludes faces linked to persons with an empty name', async () => {
      mocks.person.getFaces.mockResolvedValue([
        {
          id: newUuid(),
          assetId,
          personId: newUuid(),
          imageWidth: 400,
          imageHeight: 500,
          boundingBoxX1: 100,
          boundingBoxX2: 200,
          boundingBoxY1: 100,
          boundingBoxY2: 200,
          isVisible: true,
          deletedAt: null,
          sourceType: 'machine-learning' as never,
          updatedAt: new Date(),
          updateId: newUuid(),
          person: { id: newUuid(), name: '', isHidden: false } as never,
        },
      ]);

      await expect(sut.handleImageDescription({ id: assetId })).resolves.toBe(JobStatus.Success);

      expect(mocks.machineLearning.describeImage).toHaveBeenCalledWith(
        previewFile,
        expect.anything(),
        undefined,
        expect.not.stringContaining('Known people'),
      );
    });

    it('excludes faces linked to hidden persons', async () => {
      mocks.person.getFaces.mockResolvedValue([
        {
          id: newUuid(),
          assetId,
          personId: newUuid(),
          imageWidth: 400,
          imageHeight: 500,
          boundingBoxX1: 100,
          boundingBoxX2: 200,
          boundingBoxY1: 100,
          boundingBoxY2: 200,
          isVisible: true,
          deletedAt: null,
          sourceType: 'machine-learning' as never,
          updatedAt: new Date(),
          updateId: newUuid(),
          person: { id: newUuid(), name: 'HiddenPerson', isHidden: true } as never,
        },
      ]);

      await expect(sut.handleImageDescription({ id: assetId })).resolves.toBe(JobStatus.Success);

      expect(mocks.machineLearning.describeImage).toHaveBeenCalledWith(
        previewFile,
        expect.anything(),
        undefined,
        expect.not.stringContaining('Known people'),
      );
    });

    it('skips faces with zero imageWidth to avoid NaN in boxCenter', async () => {
      mocks.person.getFaces.mockResolvedValue([
        {
          id: newUuid(),
          assetId,
          personId: newUuid(),
          imageWidth: 0,
          imageHeight: 500,
          boundingBoxX1: 100,
          boundingBoxX2: 200,
          boundingBoxY1: 100,
          boundingBoxY2: 200,
          isVisible: true,
          deletedAt: null,
          sourceType: 'machine-learning' as never,
          updatedAt: new Date(),
          updateId: newUuid(),
          person: { id: newUuid(), name: 'ZeroWidth', isHidden: false } as never,
        },
      ]);

      await expect(sut.handleImageDescription({ id: assetId })).resolves.toBe(JobStatus.Success);

      expect(mocks.machineLearning.describeImage).toHaveBeenCalledWith(
        previewFile,
        expect.anything(),
        undefined,
        expect.not.stringContaining('Known people'),
      );
    });

    it('passes through the ML description unchanged when it already contains the known name', async () => {
      mocks.person.getFaces.mockResolvedValue([
        {
          id: newUuid(),
          assetId,
          personId: newUuid(),
          imageWidth: 400,
          imageHeight: 500,
          boundingBoxX1: 100,
          boundingBoxX2: 200,
          boundingBoxY1: 100,
          boundingBoxY2: 200,
          isVisible: true,
          deletedAt: null,
          sourceType: 'machine-learning' as never,
          updatedAt: new Date(),
          updateId: newUuid(),
          person: { id: newUuid(), name: 'Conner', isHidden: false } as never,
        },
      ]);
      // ML returns description already containing the known name — no changes needed.
      mocks.machineLearning.describeImage.mockResolvedValue({
        description: 'Conner is playing baseball.',
        people: [],
        environment: 'outdoor field',
        objects: [],
        visible_text: [],
        context: '',
        tags: [],
      });

      await expect(sut.handleImageDescription({ id: assetId })).resolves.toBe(JobStatus.Success);

      const descriptionCall = mocks.asset.upsertMetadata.mock.calls.find(
        (call) => (call[1][0]?.value as { description?: { result?: unknown } } | undefined)?.description?.result,
      )!;
      const saved = descriptionCall[1][0].value as { description: { result: { description: string } } };
      expect(saved.description.result.description).toBe('Conner is playing baseball.');
    });

    it('still describes the asset when face lookup throws (best-effort identity injection)', async () => {
      mocks.person.getFaces.mockRejectedValueOnce(new Error('db down'));

      await expect(sut.handleImageDescription({ id: assetId })).resolves.toBe(JobStatus.Success);

      // describeImage must still be called, with a prompt that contains no
      // identity hint (knownPersons was empty due to the lookup failure).
      expect(mocks.machineLearning.describeImage).toHaveBeenCalledWith(
        previewFile,
        expect.anything(),
        undefined,
        expect.not.stringContaining('Known people'),
      );
    });

    it('strips hallucinated names before persisting the description', async () => {
      mocks.person.getFaces.mockResolvedValue([
        {
          id: newUuid(),
          assetId,
          personId: newUuid(),
          imageWidth: 400,
          imageHeight: 500,
          boundingBoxX1: 100,
          boundingBoxX2: 200,
          boundingBoxY1: 100,
          boundingBoxY2: 200,
          isVisible: true,
          deletedAt: null,
          sourceType: 'machine-learning' as never,
          updatedAt: new Date(),
          updateId: newUuid(),
          person: { id: newUuid(), name: 'Conner', isHidden: false } as never,
        },
      ]);
      // ML hallucinated "Madison" — not in knownPersons.
      mocks.machineLearning.describeImage.mockResolvedValue({
        description: 'Conner and Madison are playing baseball.',
        people: [],
        environment: 'outdoor field',
        objects: [],
        visible_text: [],
        context: '',
        tags: [],
      });

      await expect(sut.handleImageDescription({ id: assetId })).resolves.toBe(JobStatus.Success);

      const descriptionCall = mocks.asset.upsertMetadata.mock.calls.find(
        (call) => (call[1][0]?.value as { description?: { result?: unknown } } | undefined)?.description?.result,
      )!;
      const saved = descriptionCall[1][0].value as {
        description: { result: { description: string }; identityFlags?: { hallucinatedNames?: string[] } };
      };
      expect(saved.description.result.description).toBe('Conner and Someone are playing baseball.');
      expect(saved.description.identityFlags?.hallucinatedNames).toEqual(['Madison']);
    });
  });
});
