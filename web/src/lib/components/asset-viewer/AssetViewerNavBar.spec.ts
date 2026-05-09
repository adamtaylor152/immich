import { AssetTypeEnum } from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent } from '@testing-library/svelte';
import { getResizeObserverMock } from '$lib/__mocks__/resize-observer.mock';
import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { renderWithTooltips } from '$tests/helpers';
import { assetFactory } from '@test-data/factories/asset-factory';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';
import AssetViewerNavBar from './AssetViewerNavBar.svelte';

describe('AssetViewerNavBar component', () => {
  const additionalProps = {
    preAction: () => {},
    onAction: () => {},
    onPlaySlideshow: () => {},
    onClose: () => {},
    playOriginalVideo: false,
    setPlayOriginalVideo: () => Promise.resolve(),
  };

  beforeAll(() => {
    Element.prototype.animate = vi.fn().mockImplementation(function () {
      return {
        cancel: () => {},
      };
    });
    vi.stubGlobal('ResizeObserver', getResizeObserverMock());
    vi.mock(import('$lib/managers/feature-flags-manager.svelte'), function () {
      return {
        featureFlagsManager: {
          init: vi.fn(),
          loadFeatureFlags: vi.fn(),
          value: { smartSearch: true, trash: true },
        } as never,
      };
    });
  });

  afterEach(() => {
    assetViewerManager.closeEditor();
    authManager.reset();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('shows back button', () => {
    const preferences = preferencesFactory.build({ cast: { gCastEnabled: false } });
    authManager.setPreferences(preferences);

    const asset = assetFactory.build({ isTrashed: false });
    const { getByLabelText } = renderWithTooltips(AssetViewerNavBar, { asset, ...additionalProps });
    expect(getByLabelText('go_back')).toBeInTheDocument();
  });

  describe('if the current user owns the asset', () => {
    it('shows delete button', () => {
      const ownerId = 'id-of-the-user';
      const user = userAdminFactory.build({ id: ownerId });
      const asset = assetFactory.build({ ownerId, isTrashed: false });
      authManager.setUser(user);

      const preferences = preferencesFactory.build({ cast: { gCastEnabled: false } });
      authManager.setPreferences(preferences);

      const { getByLabelText } = renderWithTooltips(AssetViewerNavBar, { asset, ...additionalProps });
      expect(getByLabelText('delete')).toBeInTheDocument();
    });

    it('shows NSFW review actions for a full-size owned image', () => {
      const ownerId = 'id-of-the-user';
      const user = userAdminFactory.build({ id: ownerId });
      const asset = assetFactory.build({ ownerId, isTrashed: false, type: AssetTypeEnum.Image });
      authManager.setUser(user);

      const preferences = preferencesFactory.build({ cast: { gCastEnabled: false } });
      authManager.setPreferences(preferences);

      const { getByRole } = renderWithTooltips(AssetViewerNavBar, { asset, ...additionalProps });
      expect(getByRole('menuitem', { name: 'mark_nsfw' })).toBeInTheDocument();
      expect(getByRole('menuitem', { name: 'mark_safe' })).toBeInTheDocument();
    });

    it('shows the editor action for a full-size owned video even when client metadata is missing', async () => {
      const ownerId = 'id-of-the-user';
      const user = userAdminFactory.build({ id: ownerId });
      const asset = assetFactory.build({
        ownerId,
        isTrashed: false,
        type: AssetTypeEnum.Video,
        originalPath: '/upload/video.mp4',
        originalFileName: 'video.mp4',
        width: null,
        height: null,
        duration: null,
      });
      authManager.setUser(user);

      const preferences = preferencesFactory.build({ cast: { gCastEnabled: false } });
      authManager.setPreferences(preferences);

      const { getByLabelText } = renderWithTooltips(AssetViewerNavBar, { asset, ...additionalProps });
      await fireEvent.click(getByLabelText('editor'));

      expect(assetViewerManager.isShowEditor).toBe(true);
    });
  });
});
