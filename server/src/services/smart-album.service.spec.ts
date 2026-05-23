import { defaults } from 'src/config';
import { SmartAlbumService } from 'src/services/smart-album.service';
import { newUuid } from 'test/small.factory';
import { newTestService, ServiceMocks } from 'test/utils';
import { vi } from 'vitest';

// Build an albumIdByKind map for the given kinds.
const albumMap = (entries: Record<string, string>) => new Map(Object.entries(entries));

describe(SmartAlbumService.name, () => {
  let sut: SmartAlbumService;
  let mocks: ServiceMocks;

  const ownerId = newUuid();
  const assetId = newUuid();
  const travelAlbumId = newUuid();
  const foodAlbumId = newUuid();
  const natureAlbumId = newUuid();

  beforeEach(() => {
    ({ sut, mocks } = newTestService(SmartAlbumService));

    // Default: smartAlbums enabled, all built-in kinds enabled (relying on
    // SystemConfig defaults loaded via getConfig).
    mocks.systemMetadata.get.mockResolvedValue({
      smartAlbums: { enabled: true },
    });

    // Default repo state: no smart albums bootstrapped, no exclusions, no
    // existing memberships.
    mocks.smartAlbum.getAllSmartAlbumIdsForOwner.mockResolvedValue(new Map());
    mocks.smartAlbum.getExcludedSmartAlbumIds.mockResolvedValue(new Set());
    mocks.smartAlbum.getMatchingKinds.mockResolvedValue([]);
    mocks.smartAlbum.isExcluded.mockResolvedValue(false);
    mocks.smartAlbum.getSmartAlbumIdForOwnerAndKind.mockResolvedValue(null);
    mocks.smartAlbum.addAssetToSmartAlbum.mockResolvedValue();
    mocks.smartAlbum.removeAssetFromSmartAlbum.mockResolvedValue();
  });

  describe('evaluate', () => {
    it('should add asset to matching kinds based on tags', async () => {
      mocks.smartAlbum.getAllSmartAlbumIdsForOwner.mockResolvedValue(albumMap({ travel: travelAlbumId }));

      await sut.evaluate({ assetId, ownerId, tags: ['beach', 'sunset'] });

      expect(mocks.smartAlbum.addAssetToSmartAlbum).toHaveBeenCalledWith(travelAlbumId, assetId, 'tag');
      expect(mocks.smartAlbum.addAssetToSmartAlbum).toHaveBeenCalledTimes(1);
    });

    it('should skip when master smartAlbums.enabled is false', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        smartAlbums: { enabled: false },
      });

      await sut.evaluate({ assetId, ownerId, tags: ['beach', 'airport'] });

      expect(mocks.smartAlbum.getAllSmartAlbumIdsForOwner).not.toHaveBeenCalled();
      expect(mocks.smartAlbum.getMatchingKinds).not.toHaveBeenCalled();
      expect(mocks.smartAlbum.addAssetToSmartAlbum).not.toHaveBeenCalled();
    });

    it('should skip kinds whose builtIn[kind].enabled is false', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        smartAlbums: {
          enabled: true,
          builtIn: { travel: { enabled: false } },
        },
      });
      mocks.smartAlbum.getAllSmartAlbumIdsForOwner.mockResolvedValue(albumMap({ travel: travelAlbumId }));

      await sut.evaluate({ assetId, ownerId, tags: ['beach', 'airport'] });

      // travel is disabled, no other kinds have a bootstrapped album
      expect(mocks.smartAlbum.addAssetToSmartAlbum).not.toHaveBeenCalled();
    });

    it('should skip when exclusion exists for the asset in that smart album', async () => {
      mocks.smartAlbum.getAllSmartAlbumIdsForOwner.mockResolvedValue(albumMap({ travel: travelAlbumId }));
      mocks.smartAlbum.getExcludedSmartAlbumIds.mockResolvedValue(new Set([travelAlbumId]));

      await sut.evaluate({ assetId, ownerId, tags: ['beach', 'airport'] });

      expect(mocks.smartAlbum.addAssetToSmartAlbum).not.toHaveBeenCalled();
    });

    it('should remove asset from previously-matched kinds when tags no longer match', async () => {
      // Asset is currently in 'travel'.
      mocks.smartAlbum.getMatchingKinds.mockResolvedValue(['travel']);
      mocks.smartAlbum.getAllSmartAlbumIdsForOwner.mockResolvedValue(albumMap({ travel: travelAlbumId }));

      // 'sunset' matches nature, not travel, and nature has no bootstrapped album.
      await sut.evaluate({ assetId, ownerId, tags: ['sunset'] });

      expect(mocks.smartAlbum.removeAssetFromSmartAlbum).toHaveBeenCalledWith(travelAlbumId, assetId);
    });

    it('should be idempotent when called twice (relies on addAssetToSmartAlbum ON CONFLICT)', async () => {
      mocks.smartAlbum.getAllSmartAlbumIdsForOwner.mockResolvedValue(albumMap({ food: foodAlbumId }));

      await sut.evaluate({ assetId, ownerId, tags: ['food', 'meal'] });
      await sut.evaluate({ assetId, ownerId, tags: ['food', 'meal'] });

      // addAssetToSmartAlbum called twice — repo layer handles ON CONFLICT DO NOTHING
      expect(mocks.smartAlbum.addAssetToSmartAlbum).toHaveBeenCalledTimes(2);
    });

    it('should match case-insensitively (tag "Beach" matches trigger "beach")', async () => {
      mocks.smartAlbum.getAllSmartAlbumIdsForOwner.mockResolvedValue(albumMap({ travel: travelAlbumId }));

      // Tag is mixed-case, trigger in config is lowercase
      await sut.evaluate({ assetId, ownerId, tags: ['Beach', 'Sunset'] });

      expect(mocks.smartAlbum.addAssetToSmartAlbum).toHaveBeenCalledWith(travelAlbumId, assetId, 'tag');
    });

    it('should skip when no kinds have a bootstrapped album (user not yet bootstrapped)', async () => {
      mocks.smartAlbum.getAllSmartAlbumIdsForOwner.mockResolvedValue(new Map());

      await sut.evaluate({ assetId, ownerId, tags: ['beach', 'airport', 'food', 'meal', 'dog', 'cat'] });

      expect(mocks.smartAlbum.addAssetToSmartAlbum).not.toHaveBeenCalled();
    });

    it('should produce no false matches from the CLIP stub (only tag matching fires)', async () => {
      mocks.smartAlbum.getAllSmartAlbumIdsForOwner.mockResolvedValue(albumMap({ travel: travelAlbumId }));

      // Empty tags — no tag matches; CLIP stub must not add anything
      await sut.evaluate({ assetId, ownerId, tags: [] });

      expect(mocks.smartAlbum.addAssetToSmartAlbum).not.toHaveBeenCalled();
    });

    it('should match multiple kinds when tags overlap multiple triggers', async () => {
      mocks.smartAlbum.getAllSmartAlbumIdsForOwner.mockResolvedValue(
        albumMap({ travel: travelAlbumId, food: foodAlbumId }),
      );

      // 'beach' matches travel, 'food' matches food
      await sut.evaluate({ assetId, ownerId, tags: ['beach', 'food'] });

      expect(mocks.smartAlbum.addAssetToSmartAlbum).toHaveBeenCalledWith(travelAlbumId, assetId, 'tag');
      expect(mocks.smartAlbum.addAssetToSmartAlbum).toHaveBeenCalledWith(foodAlbumId, assetId, 'tag');
    });

    it('should batch repo lookups: one getAllSmartAlbumIdsForOwner + one getExcludedSmartAlbumIds per evaluate', async () => {
      mocks.smartAlbum.getAllSmartAlbumIdsForOwner.mockResolvedValue(
        albumMap({ travel: travelAlbumId, food: foodAlbumId, nature: natureAlbumId }),
      );

      await sut.evaluate({ assetId, ownerId, tags: ['beach'] });

      expect(mocks.smartAlbum.getAllSmartAlbumIdsForOwner).toHaveBeenCalledTimes(1);
      expect(mocks.smartAlbum.getExcludedSmartAlbumIds).toHaveBeenCalledTimes(1);
      // Per-kind isExcluded MUST NOT be called; we batched it.
      expect(mocks.smartAlbum.isExcluded).not.toHaveBeenCalled();
      // Per-kind getSmartAlbumIdForOwnerAndKind MUST NOT be called either.
      expect(mocks.smartAlbum.getSmartAlbumIdForOwnerAndKind).not.toHaveBeenCalled();
    });
  });

  describe('ensureBuiltInAlbumsForUser', () => {
    it('should call ensureForUser with all 6 kinds and their names', async () => {
      mocks.smartAlbum.ensureForUser.mockResolvedValue();

      await sut.ensureBuiltInAlbumsForUser(ownerId);

      expect(mocks.smartAlbum.ensureForUser).toHaveBeenCalledWith(
        ownerId,
        expect.arrayContaining([
          expect.objectContaining({ kind: 'travel' }),
          expect.objectContaining({ kind: 'documents' }),
          expect.objectContaining({ kind: 'screenshots' }),
          expect.objectContaining({ kind: 'food' }),
          expect.objectContaining({ kind: 'pets' }),
          expect.objectContaining({ kind: 'nature' }),
        ]),
      );
      const [, kinds] = (mocks.smartAlbum.ensureForUser as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(kinds).toHaveLength(6);
    });

    it('should not call ensureForUser when smartAlbums.enabled is false', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        smartAlbums: { enabled: false },
      });

      await sut.ensureBuiltInAlbumsForUser(ownerId);

      expect(mocks.smartAlbum.ensureForUser).not.toHaveBeenCalled();
    });
  });

  describe('handleReevaluateAll', () => {
    it('should return Skipped when smartAlbums.enabled is false', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        smartAlbums: { enabled: false },
      });

      const { JobStatus } = await import('src/enum');
      const result = await sut.handleReevaluateAll({});

      expect(result).toBe(JobStatus.Skipped);
      expect(mocks.assetJob.streamForSmartAlbumReevaluation).not.toHaveBeenCalled();
    });

    it('should call evaluate for each streamed asset', async () => {
      const asset1Id = newUuid();
      const asset2Id = newUuid();
      const ownerId = newUuid();
      mocks.assetJob.streamForSmartAlbumReevaluation.mockReturnValue(
        (async function* () {
          yield { id: asset1Id, ownerId, tags: ['beach'] };
          yield { id: asset2Id, ownerId, tags: ['food'] };
        })(),
      );
      mocks.smartAlbum.getAllSmartAlbumIdsForOwner.mockResolvedValue(new Map());

      const { JobStatus } = await import('src/enum');
      const result = await sut.handleReevaluateAll({});

      expect(result).toBe(JobStatus.Success);
      expect(mocks.assetJob.streamForSmartAlbumReevaluation).toHaveBeenCalledTimes(1);
      // evaluate() is called for each asset (we call getAllSmartAlbumIdsForOwner per evaluate call)
      expect(mocks.smartAlbum.getAllSmartAlbumIdsForOwner).toHaveBeenCalledTimes(2);
    });

    it('should continue to next asset if one evaluate throws', async () => {
      const asset1Id = newUuid();
      const asset2Id = newUuid();
      const ownerId = newUuid();
      mocks.assetJob.streamForSmartAlbumReevaluation.mockReturnValue(
        (async function* () {
          yield { id: asset1Id, ownerId, tags: ['beach'] };
          yield { id: asset2Id, ownerId, tags: ['food'] };
        })(),
      );
      // First call throws, second succeeds
      mocks.smartAlbum.getAllSmartAlbumIdsForOwner
        .mockRejectedValueOnce(new Error('db error'))
        .mockResolvedValueOnce(new Map());

      const { JobStatus } = await import('src/enum');
      const result = await sut.handleReevaluateAll({});

      expect(result).toBe(JobStatus.Success);
      expect(mocks.logger.warn).toHaveBeenCalledTimes(1);
      // Both assets attempted — second one got the successful mock call
      expect(mocks.smartAlbum.getAllSmartAlbumIdsForOwner).toHaveBeenCalledTimes(2);
    });
  });

  describe('backfillAllUsers', () => {
    it('should call ensureBuiltInAlbumsForUser for each user', async () => {
      const userId1 = newUuid();
      const userId2 = newUuid();
      mocks.user.getList.mockResolvedValue([{ id: userId1 }, { id: userId2 }] as never);
      mocks.smartAlbum.ensureForUser.mockResolvedValue();

      await sut.backfillAllUsers();

      expect(mocks.smartAlbum.ensureForUser).toHaveBeenCalledTimes(2);
    });

    it('should continue if one user backfill fails', async () => {
      const userId1 = newUuid();
      const userId2 = newUuid();
      mocks.user.getList.mockResolvedValue([{ id: userId1 }, { id: userId2 }] as never);
      mocks.smartAlbum.ensureForUser.mockRejectedValueOnce(new Error('db error')).mockResolvedValueOnce();

      await expect(sut.backfillAllUsers()).resolves.not.toThrow();

      expect(mocks.smartAlbum.ensureForUser).toHaveBeenCalledTimes(2);
      expect(mocks.logger.warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('onConfigUpdate', () => {
    it('should backfill all users when smartAlbums.enabled flips from false to true', async () => {
      const userId1 = newUuid();
      mocks.user.getList.mockResolvedValue([{ id: userId1 }] as never);
      mocks.smartAlbum.ensureForUser.mockResolvedValue();

      await sut.onConfigUpdate({
        oldConfig: { ...defaults, smartAlbums: { ...defaults.smartAlbums, enabled: false } },
        newConfig: { ...defaults, smartAlbums: { ...defaults.smartAlbums, enabled: true } },
      });

      expect(mocks.user.getList).toHaveBeenCalledTimes(1);
      expect(mocks.smartAlbum.ensureForUser).toHaveBeenCalledTimes(1);
    });

    it('should not backfill when smartAlbums.enabled remains true', async () => {
      await sut.onConfigUpdate({
        oldConfig: { ...defaults, smartAlbums: { ...defaults.smartAlbums, enabled: true } },
        newConfig: { ...defaults, smartAlbums: { ...defaults.smartAlbums, enabled: true } },
      });

      expect(mocks.user.getList).not.toHaveBeenCalled();
      expect(mocks.smartAlbum.ensureForUser).not.toHaveBeenCalled();
    });

    it('should not backfill when smartAlbums.enabled remains false', async () => {
      await sut.onConfigUpdate({
        oldConfig: { ...defaults, smartAlbums: { ...defaults.smartAlbums, enabled: false } },
        newConfig: { ...defaults, smartAlbums: { ...defaults.smartAlbums, enabled: false } },
      });

      expect(mocks.user.getList).not.toHaveBeenCalled();
      expect(mocks.smartAlbum.ensureForUser).not.toHaveBeenCalled();
    });

    it('should not backfill when smartAlbums.enabled flips from true to false', async () => {
      await sut.onConfigUpdate({
        oldConfig: { ...defaults, smartAlbums: { ...defaults.smartAlbums, enabled: true } },
        newConfig: { ...defaults, smartAlbums: { ...defaults.smartAlbums, enabled: false } },
      });

      expect(mocks.user.getList).not.toHaveBeenCalled();
      expect(mocks.smartAlbum.ensureForUser).not.toHaveBeenCalled();
    });
  });

  describe('onBootstrap', () => {
    it('should call ensureBuiltInAlbumsForUser for each active user', async () => {
      const userId1 = newUuid();
      const userId2 = newUuid();
      mocks.user.getList.mockResolvedValue([{ id: userId1 }, { id: userId2 }] as never);
      mocks.smartAlbum.ensureForUser.mockResolvedValue();

      await sut.onBootstrap();

      expect(mocks.smartAlbum.ensureForUser).toHaveBeenCalledTimes(2);
    });

    it('should continue bootstrapping other users if one fails', async () => {
      const userId1 = newUuid();
      const userId2 = newUuid();
      mocks.user.getList.mockResolvedValue([{ id: userId1 }, { id: userId2 }] as never);
      mocks.smartAlbum.ensureForUser.mockRejectedValueOnce(new Error('db error')).mockResolvedValueOnce();

      await expect(sut.onBootstrap()).resolves.not.toThrow();

      expect(mocks.smartAlbum.ensureForUser).toHaveBeenCalledTimes(2);
    });

    it('should not enumerate users when smartAlbums.enabled is false', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        smartAlbums: { enabled: false },
      });

      await sut.onBootstrap();

      expect(mocks.user.getList).not.toHaveBeenCalled();
      expect(mocks.smartAlbum.ensureForUser).not.toHaveBeenCalled();
    });
  });
});
