import { SmartAlbumService } from 'src/services/smart-album.service';
import { newUuid } from 'test/small.factory';
import { newTestService, ServiceMocks } from 'test/utils';
import { vi } from 'vitest';

describe(SmartAlbumService.name, () => {
  let sut: SmartAlbumService;
  let mocks: ServiceMocks;

  const ownerId = newUuid();
  const assetId = newUuid();
  const travelAlbumId = newUuid();
  const foodAlbumId = newUuid();

  beforeEach(() => {
    ({ sut, mocks } = newTestService(SmartAlbumService));

    // Default: smartAlbums enabled, all built-in kinds enabled.
    mocks.systemMetadata.get.mockResolvedValue({
      smartAlbums: { enabled: true },
    });

    // Default: asset not currently in any smart albums.
    mocks.smartAlbum.getMatchingKinds.mockResolvedValue([]);

    // Default: not excluded.
    mocks.smartAlbum.isExcluded.mockResolvedValue(false);

    // Default: null album IDs (not bootstrapped).
    mocks.smartAlbum.getSmartAlbumIdForOwnerAndKind.mockResolvedValue(null);

    // Default: add/remove succeed silently.
    mocks.smartAlbum.addAssetToSmartAlbum.mockResolvedValue();
    mocks.smartAlbum.removeAssetFromSmartAlbum.mockResolvedValue();
  });

  describe('evaluate', () => {
    it('should add asset to matching kinds based on tags', async () => {
      mocks.smartAlbum.getSmartAlbumIdForOwnerAndKind.mockImplementation((_ownerId, kind) => {
        if (kind === 'travel') {return Promise.resolve(travelAlbumId);}
        return Promise.resolve(null);
      });

      await sut.evaluate({ assetId, ownerId, tags: ['beach', 'sunset'] });

      expect(mocks.smartAlbum.addAssetToSmartAlbum).toHaveBeenCalledWith(travelAlbumId, assetId, 'tag');
      expect(mocks.smartAlbum.addAssetToSmartAlbum).toHaveBeenCalledTimes(1);
    });

    it('should skip when master smartAlbums.enabled is false', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        smartAlbums: { enabled: false },
      });

      await sut.evaluate({ assetId, ownerId, tags: ['beach', 'airport'] });

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
      mocks.smartAlbum.getSmartAlbumIdForOwnerAndKind.mockImplementation((_ownerId, kind) => {
        if (kind === 'travel') {return Promise.resolve(travelAlbumId);}
        return Promise.resolve(null);
      });

      await sut.evaluate({ assetId, ownerId, tags: ['beach', 'airport'] });

      // travel is disabled, no other kinds have a bootstrapped album
      expect(mocks.smartAlbum.addAssetToSmartAlbum).not.toHaveBeenCalled();
    });

    it('should skip when exclusion exists for the asset in that smart album', async () => {
      mocks.smartAlbum.getSmartAlbumIdForOwnerAndKind.mockImplementation((_ownerId, kind) => {
        if (kind === 'travel') {return Promise.resolve(travelAlbumId);}
        return Promise.resolve(null);
      });
      mocks.smartAlbum.isExcluded.mockResolvedValue(true);

      await sut.evaluate({ assetId, ownerId, tags: ['beach', 'airport'] });

      expect(mocks.smartAlbum.addAssetToSmartAlbum).not.toHaveBeenCalled();
    });

    it('should remove asset from previously-matched kinds when tags no longer match', async () => {
      // Asset is currently in 'travel'.
      mocks.smartAlbum.getMatchingKinds.mockResolvedValue(['travel']);
      // But current tags don't match travel triggers.
      mocks.smartAlbum.getSmartAlbumIdForOwnerAndKind.mockImplementation((_ownerId, kind) => {
        if (kind === 'travel') {return Promise.resolve(travelAlbumId);}
        return Promise.resolve(null);
      });

      await sut.evaluate({ assetId, ownerId, tags: ['sunset'] }); // 'sunset' matches nature, not travel

      // travel should be removed (sunset matches nature but nature has no album bootstrapped)
      expect(mocks.smartAlbum.removeAssetFromSmartAlbum).toHaveBeenCalledWith(travelAlbumId, assetId);
    });

    it('should be idempotent when called twice (relies on addAssetToSmartAlbum ON CONFLICT)', async () => {
      mocks.smartAlbum.getSmartAlbumIdForOwnerAndKind.mockImplementation((_ownerId, kind) => {
        if (kind === 'food') {return Promise.resolve(foodAlbumId);}
        return Promise.resolve(null);
      });

      await sut.evaluate({ assetId, ownerId, tags: ['food', 'meal'] });
      await sut.evaluate({ assetId, ownerId, tags: ['food', 'meal'] });

      // addAssetToSmartAlbum called twice — repo layer handles ON CONFLICT DO NOTHING
      expect(mocks.smartAlbum.addAssetToSmartAlbum).toHaveBeenCalledTimes(2);
    });

    it('should match case-insensitively (tag "Beach" matches trigger "beach")', async () => {
      mocks.smartAlbum.getSmartAlbumIdForOwnerAndKind.mockImplementation((_ownerId, kind) => {
        if (kind === 'travel') {return Promise.resolve(travelAlbumId);}
        return Promise.resolve(null);
      });

      // Tag is mixed-case, trigger in config is lowercase
      await sut.evaluate({ assetId, ownerId, tags: ['Beach', 'Sunset'] });

      expect(mocks.smartAlbum.addAssetToSmartAlbum).toHaveBeenCalledWith(travelAlbumId, assetId, 'tag');
    });

    it('should skip when getSmartAlbumIdForOwnerAndKind returns null (user not bootstrapped)', async () => {
      mocks.smartAlbum.getSmartAlbumIdForOwnerAndKind.mockResolvedValue(null);

      await sut.evaluate({ assetId, ownerId, tags: ['beach', 'airport', 'food', 'meal', 'dog', 'cat'] });

      expect(mocks.smartAlbum.addAssetToSmartAlbum).not.toHaveBeenCalled();
    });

    it('should produce no false matches from the CLIP stub (only tag matching fires)', async () => {
      mocks.smartAlbum.getSmartAlbumIdForOwnerAndKind.mockImplementation((_ownerId, kind) => {
        if (kind === 'travel') {return Promise.resolve(travelAlbumId);}
        return Promise.resolve(null);
      });

      // Empty tags — no tag matches; CLIP stub must not add anything
      await sut.evaluate({ assetId, ownerId, tags: [] });

      expect(mocks.smartAlbum.addAssetToSmartAlbum).not.toHaveBeenCalled();
    });

    it('should match multiple kinds when tags overlap multiple triggers', async () => {
      mocks.smartAlbum.getSmartAlbumIdForOwnerAndKind.mockImplementation((_ownerId, kind) => {
        if (kind === 'travel') {return Promise.resolve(travelAlbumId);}
        if (kind === 'food') {return Promise.resolve(foodAlbumId);}
        return Promise.resolve(null);
      });

      // 'beach' matches travel, 'food' matches food
      await sut.evaluate({ assetId, ownerId, tags: ['beach', 'food'] });

      expect(mocks.smartAlbum.addAssetToSmartAlbum).toHaveBeenCalledWith(travelAlbumId, assetId, 'tag');
      expect(mocks.smartAlbum.addAssetToSmartAlbum).toHaveBeenCalledWith(foodAlbumId, assetId, 'tag');
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
      mocks.smartAlbum.ensureForUser
        .mockRejectedValueOnce(new Error('db error'))
        .mockResolvedValueOnce();

      await expect(sut.onBootstrap()).resolves.not.toThrow();

      expect(mocks.smartAlbum.ensureForUser).toHaveBeenCalledTimes(2);
    });
  });
});
