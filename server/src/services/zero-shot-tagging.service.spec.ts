import { CLIP_ZERO_SHOT_LABELS } from 'src/constants/clip-zero-shot-labels';
import { ZERO_SHOT_TAG_NAMESPACE } from 'src/constants/zero-shot-tag';
import { ZeroShotTaggingService } from 'src/services/zero-shot-tagging.service';
import { newTestService, ServiceMocks } from 'test/utils';

const ASSET_ID = 'asset-1';
const OWNER_ID = 'owner-1';
const EMBEDDING = '[1, 0]';

const withConfig = (mocks: ServiceMocks, machineLearning: object) => {
  mocks.systemMetadata.get.mockResolvedValue({ machineLearning });
};

const mockTagUpserts = (mocks: ServiceMocks) => {
  mocks.tag.upsertValue.mockImplementation(({ value }) => Promise.resolve({ id: `tag-${value}`, value } as never));
  mocks.tag.upsertAssetIds.mockImplementation((items) => Promise.resolve(items as never));
};

describe(ZeroShotTaggingService.name, () => {
  it('does nothing when smart search is disabled', async () => {
    const { sut, mocks } = newTestService(ZeroShotTaggingService);
    withConfig(mocks, { enabled: false });

    await expect(sut.tagAsset(ASSET_ID, OWNER_ID, EMBEDDING)).resolves.toBeUndefined();

    expect(mocks.machineLearning.encodeText).not.toHaveBeenCalled();
    expect(mocks.tag.upsertValue).not.toHaveBeenCalled();
  });

  it('does nothing when zero-shot tagging is disabled', async () => {
    const { sut, mocks } = newTestService(ZeroShotTaggingService);
    withConfig(mocks, { clip: { zeroShotTagging: { enabled: false } } });

    await expect(sut.tagAsset(ASSET_ID, OWNER_ID, EMBEDDING)).resolves.toBeUndefined();

    expect(mocks.machineLearning.encodeText).not.toHaveBeenCalled();
  });

  it('memoizes the vocabulary: one ML round-trip per model across calls', async () => {
    const { sut, mocks } = newTestService(ZeroShotTaggingService);
    withConfig(mocks, { clip: { modelName: 'memo-model' } });
    mocks.machineLearning.encodeText.mockResolvedValue(EMBEDDING);
    mockTagUpserts(mocks);

    await sut.tagAsset(ASSET_ID, OWNER_ID, EMBEDDING);
    await sut.tagAsset('asset-2', OWNER_ID, EMBEDDING);

    expect(mocks.machineLearning.encodeText).toHaveBeenCalledTimes(CLIP_ZERO_SHOT_LABELS.length);
    expect(mocks.machineLearning.encodeText).toHaveBeenCalledWith(expect.any(String), { modelName: 'memo-model' });
  });

  it('logs ML failures without throwing, and retries on the next call', async () => {
    const { sut, mocks } = newTestService(ZeroShotTaggingService);
    withConfig(mocks, { clip: { modelName: 'failing-model' } });
    mocks.machineLearning.encodeText.mockRejectedValue(new Error('ml down'));

    await expect(sut.tagAsset(ASSET_ID, OWNER_ID, EMBEDDING)).resolves.toBeUndefined();
    expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('ml down'));
    expect(mocks.tag.upsertValue).not.toHaveBeenCalled();

    // The failed vocabulary promise is evicted, so the next call retries ML.
    await expect(sut.tagAsset(ASSET_ID, OWNER_ID, EMBEDDING)).resolves.toBeUndefined();
    expect(mocks.machineLearning.encodeText).toHaveBeenCalledTimes(2);
  });

  it('upserts matched tags under the zero-shot namespace and emits AssetTag', async () => {
    const { sut, mocks } = newTestService(ZeroShotTaggingService);
    withConfig(mocks, { clip: { modelName: 'namespace-model' } });
    mocks.machineLearning.encodeText.mockResolvedValue(EMBEDDING);
    mockTagUpserts(mocks);

    await sut.tagAsset(ASSET_ID, OWNER_ID, EMBEDDING);

    // hierarchical upsert: namespace root first, then namespaced label
    expect(mocks.tag.upsertValue).toHaveBeenCalledWith({
      userId: OWNER_ID,
      value: ZERO_SHOT_TAG_NAMESPACE,
      parentId: undefined,
    });
    expect(mocks.tag.upsertValue).toHaveBeenCalledWith({
      userId: OWNER_ID,
      value: `${ZERO_SHOT_TAG_NAMESPACE}/${CLIP_ZERO_SHOT_LABELS[0]}`,
      parentId: `tag-${ZERO_SHOT_TAG_NAMESPACE}`,
    });
    // default maxTags caps the number of applied tags
    expect(mocks.tag.upsertAssetIds).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ assetId: ASSET_ID })]),
    );
    expect(mocks.tag.upsertAssetIds.mock.calls[0][0]).toHaveLength(6);
    expect(mocks.event.emit).toHaveBeenCalledWith('AssetTag', { assetId: ASSET_ID, userId: OWNER_ID });
  });

  it('skips tagging for a malformed asset embedding', async () => {
    const { sut, mocks } = newTestService(ZeroShotTaggingService);
    withConfig(mocks, { clip: { modelName: 'malformed-model' } });

    await expect(sut.tagAsset(ASSET_ID, OWNER_ID, 'not-a-vector')).resolves.toBeUndefined();

    expect(mocks.machineLearning.encodeText).not.toHaveBeenCalled();
    expect(mocks.tag.upsertValue).not.toHaveBeenCalled();
  });
});
