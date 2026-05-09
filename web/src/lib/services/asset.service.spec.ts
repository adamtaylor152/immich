import { AssetTypeEnum, getAssetInfo } from '@immich/sdk';
import { toastManager } from '@immich/ui';
import { mdiTune } from '@mdi/js';
import { vitest } from 'vitest';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { getAssetActions, handleDownloadAsset } from '$lib/services/asset.service';
import { setSharedLink } from '$lib/utils';
import { getFormatter } from '$lib/utils/i18n';
import { assetFactory } from '@test-data/factories/asset-factory';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { sharedLinkFactory } from '@test-data/factories/shared-link-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';

vitest.mock('@immich/ui', () => ({
  toastManager: {
    primary: vitest.fn(),
  },
}));

vitest.mock('$lib/utils/i18n', () => ({
  getFormatter: vitest.fn(),
  getPreferredLocale: vitest.fn(),
}));

vitest.mock('@immich/sdk');

vitest.mock('$lib/utils', async () => {
  const originalModule = await vitest.importActual('$lib/utils');
  return {
    ...originalModule,
    sleep: vitest.fn(),
  };
});

describe('AssetService', () => {
  describe('getAssetActions', () => {
    beforeEach(() => {
      authManager.reset();
      authManager.setPreferences(preferencesFactory.build());
      setSharedLink(undefined);
    });

    const ownerId = 'owner';

    const setOwnerUser = () => {
      authManager.setUser(userAdminFactory.build({ id: ownerId }));
    };

    const buildEditableVideo = (overrides = {}) =>
      assetFactory.build({
        ownerId,
        type: AssetTypeEnum.Video,
        originalPath: '/upload/video.mp4',
        originalFileName: 'video.mp4',
        width: 1920,
        height: 1080,
        duration: 10_000,
        ...overrides,
      });

    it('should allow shared link downloads if the user owns the asset and shared link downloads are disabled', () => {
      const ownerId = 'owner';
      const user = userAdminFactory.build({ id: ownerId });
      const asset = assetFactory.build({ ownerId });
      authManager.setUser(user);
      setSharedLink(sharedLinkFactory.build({ allowDownload: false }));
      const assetActions = getAssetActions(() => '', asset);
      expect(assetActions.SharedLinkDownload.$if?.()).toStrictEqual(true);
    });

    it('should not allow shared link downloads if the user does not own the asset and shared link downloads are disabled', () => {
      const ownerId = 'owner';
      const user = userAdminFactory.build({ id: 'non-owner' });
      const asset = assetFactory.build({ ownerId });
      authManager.setUser(user);
      setSharedLink(sharedLinkFactory.build({ allowDownload: false }));
      const assetActions = getAssetActions(() => '', asset);
      expect(assetActions.SharedLinkDownload.$if?.()).toStrictEqual(false);
    });

    it('should allow shared link downloads if shared link downloads are enabled regardless of user', () => {
      const asset = assetFactory.build();
      setSharedLink(sharedLinkFactory.build({ allowDownload: true }));
      const assetActions = getAssetActions(() => '', asset);
      expect(assetActions.SharedLinkDownload.$if?.()).toStrictEqual(true);
    });

    it('should allow editing owned videos with dimensions and duration', () => {
      setOwnerUser();
      const asset = buildEditableVideo();
      const assetActions = getAssetActions(() => '', asset);
      expect(assetActions.Edit.$if?.()).toStrictEqual(true);
    });

    it.each([{ width: null }, { height: null }, { duration: null }, { width: 0 }, { height: 0 }, { duration: 0 }])(
      'should still show the video editor action when client metadata is missing: %o',
      (overrides) => {
        setOwnerUser();
        const asset = buildEditableVideo(overrides);
        const assetActions = getAssetActions(() => '', asset);
        expect(assetActions.Edit.$if?.()).toStrictEqual(true);
      },
    );

    it('should use the tuning icon for image and video editing', () => {
      setOwnerUser();
      const video = buildEditableVideo();
      const image = assetFactory.build({
        ownerId,
        type: AssetTypeEnum.Image,
        originalPath: '/upload/photo.jpg',
        originalFileName: 'photo.jpg',
      });

      expect(getAssetActions(() => '', video).Edit.icon).toBe(mdiTune);
      expect(getAssetActions(() => '', image).Edit.icon).toBe(mdiTune);
    });

    it('should not allow editing videos from shared links', () => {
      setOwnerUser();
      setSharedLink(sharedLinkFactory.build({ allowDownload: true }));
      const asset = buildEditableVideo();
      const assetActions = getAssetActions(() => '', asset);
      expect(assetActions.Edit.$if?.()).toStrictEqual(false);
    });

    it('should not allow editing trashed videos', () => {
      setOwnerUser();
      const asset = buildEditableVideo({ isTrashed: true });
      const assetActions = getAssetActions(() => '', asset);
      expect(assetActions.Edit.$if?.()).toStrictEqual(false);
    });

    it('should not allow editing live-photo companion videos', () => {
      setOwnerUser();
      const asset = buildEditableVideo({ livePhotoVideoId: 'live-photo-video-id' });
      const assetActions = getAssetActions(() => '', asset);
      expect(assetActions.Edit.$if?.()).toStrictEqual(false);
    });
  });

  describe('handleDownloadAsset', () => {
    it('should use the asset originalFileName when showing toasts', async () => {
      const $t = vitest.fn().mockReturnValue('formatter');
      vitest.mocked(getFormatter).mockResolvedValue($t);
      const asset = assetFactory.build({ originalFileName: 'asset.heic' });
      await handleDownloadAsset(asset, { edited: false });
      expect($t).toHaveBeenNthCalledWith(1, 'downloading_asset_filename', { values: { filename: 'asset.heic' } });
      expect(toastManager.primary).toHaveBeenCalledWith('formatter');
    });

    it('should use the motion asset originalFileName when showing toasts', async () => {
      const $t = vitest.fn().mockReturnValue('formatter');
      vitest.mocked(getFormatter).mockResolvedValue($t);
      const motionAsset = assetFactory.build({ originalFileName: 'asset.mov' });
      vitest.mocked(getAssetInfo).mockResolvedValue(motionAsset);
      const asset = assetFactory.build({ originalFileName: 'asset.heic', livePhotoVideoId: '1' });
      await handleDownloadAsset(asset, { edited: false });
      expect($t).toHaveBeenNthCalledWith(1, 'downloading_asset_filename', { values: { filename: 'asset.heic' } });
      expect($t).toHaveBeenNthCalledWith(2, 'downloading_asset_filename', { values: { filename: 'asset-motion.mov' } });
      expect(toastManager.primary).toHaveBeenCalledWith('formatter');
    });
  });
});
