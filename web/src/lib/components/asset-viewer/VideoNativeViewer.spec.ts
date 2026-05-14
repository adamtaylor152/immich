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
import VideoNativeViewer from './VideoNativeViewer.svelte';

vi.mock('media-chrome/media-control-bar', () => ({}));
vi.mock('media-chrome/media-controller', () => ({}));
vi.mock('media-chrome/media-fullscreen-button', () => ({}));
vi.mock('media-chrome/media-mute-button', () => ({}));
vi.mock('media-chrome/media-play-button', () => ({}));
vi.mock('media-chrome/media-playback-rate-button', () => ({}));
vi.mock('media-chrome/media-time-display', () => ({}));
vi.mock('media-chrome/media-time-range', () => ({}));
vi.mock('media-chrome/media-volume-range', () => ({}));
vi.mock('media-chrome/menu/media-playback-rate-menu', () => ({}));
vi.mock('media-chrome/menu/media-settings-menu', () => ({}));
vi.mock('media-chrome/menu/media-settings-menu-button', () => ({}));
vi.mock('media-chrome/menu/media-settings-menu-item', () => ({}));

describe('VideoNativeViewer component', () => {
  beforeAll(() => {
    vi.stubGlobal('ResizeObserver', getResizeObserverMock());
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  afterEach(() => {
    assetViewerManager.closeEditor();
    authManager.reset();
    vi.clearAllMocks();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('shows the editor control for editable owned videos and opens the editor drawer', async () => {
    const ownerId = 'owner-id';
    const asset = assetFactory.build({
      ownerId,
      type: AssetTypeEnum.Video,
      originalPath: '/upload/video.mp4',
      originalFileName: 'video.mp4',
      width: 1920,
      height: 1080,
      duration: 10_000,
    });

    authManager.setUser(userAdminFactory.build({ id: ownerId }));
    authManager.setPreferences(preferencesFactory.build());

    const { findByLabelText } = renderWithTooltips(VideoNativeViewer, {
      asset,
      assetId: asset.id,
      loopVideo: false,
      cacheKey: null,
      playOriginalVideo: false,
      extendedControls: true,
    });

    const editButton = await findByLabelText('editor_video_edit');
    await fireEvent.click(editButton);

    expect(assetViewerManager.isShowEditor).toBe(true);
  });
});
