import { ForkStorageNormalizationService } from 'src/services/fork-storage-normalization.service';

describe(ForkStorageNormalizationService.name, () => {
  it('returns a deterministic count and digest independent of input ordering', async () => {
    const results = [
      { assetId: 'asset-b', sha1: 'b'.repeat(40), sha256: '2'.repeat(64), linkCount: 2, verifiedPaths: ['/b'] },
      { assetId: 'asset-a', sha1: 'a'.repeat(40), sha256: '1'.repeat(64), linkCount: 2, verifiedPaths: ['/a'] },
    ];
    const service = Object.create(ForkStorageNormalizationService.prototype) as ForkStorageNormalizationService;
    vi.spyOn(service, 'normalizeAsset').mockImplementation((assetId) =>
      Promise.resolve(results.find((item) => item.assetId === assetId)!),
    );

    const forward = await service.normalizeBatch(['asset-b', 'asset-a']);
    const reverse = await service.normalizeBatch(['asset-a', 'asset-b']);

    expect(forward).toEqual(reverse);
    expect(forward.count).toBe(2);
    expect(forward.digest).toMatch(/^[0-9a-f]{64}$/);
  });
});
