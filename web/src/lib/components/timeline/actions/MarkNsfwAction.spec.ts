import { AssetImageEnrichmentAction, updateAssetImageEnrichment } from '@immich/sdk';
import { toastManager } from '@immich/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { eventManager } from '$lib/managers/event-manager.svelte';
import type { TimelineAsset } from '$lib/managers/timeline-manager/types';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';
import MarkNsfwAction from './MarkNsfwAction.svelte';

vi.mock('@immich/sdk', async () => {
  const sdk = await vi.importActual<typeof import('@immich/sdk')>('@immich/sdk');
  return {
    ...sdk,
    updateAssetImageEnrichment: vi.fn(),
  };
});

vi.mock('@immich/ui', async () => {
  const { default: Icon } = await import('@test-data/components/MockIcon.svelte');
  const { default: IconButton } = await import('@test-data/components/MockIconButton.svelte');

  return {
    Icon,
    IconButton,
    toastManager: {
      primary: vi.fn(),
    },
  };
});

describe('MarkNsfwAction', () => {
  const timelineAsset = (id: string, ownerId: string) => ({ id, ownerId }) as TimelineAsset;

  beforeEach(() => {
    const user = userAdminFactory.build();
    authManager.setUser(user);
    authManager.setPreferences(preferencesFactory.build());
    assetMultiSelectManager.clear();
    vi.mocked(updateAssetImageEnrichment).mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    authManager.reset();
    assetMultiSelectManager.clear();
    vi.clearAllMocks();
  });

  it('marks selected owned assets as NSFW', async () => {
    const assets = [timelineAsset('asset-1', authManager.user.id), timelineAsset('asset-2', authManager.user.id)];
    const onMark = vi.fn();
    const onAssetsMarkNsfw = vi.fn();
    const unsubscribe = eventManager.on({ AssetsMarkNsfw: onAssetsMarkNsfw });
    assetMultiSelectManager.selectAssets(assets);

    render(MarkNsfwAction, { menuItem: true, onMark });

    await fireEvent.click(screen.getByRole('menuitem', { name: 'mark_nsfw' }));

    await waitFor(() => expect(updateAssetImageEnrichment).toHaveBeenCalledTimes(2));
    expect(updateAssetImageEnrichment).toHaveBeenCalledWith({
      id: assets[0].id,
      assetImageEnrichmentActionRequestDto: { action: AssetImageEnrichmentAction.MarkNsfw },
    });
    expect(updateAssetImageEnrichment).toHaveBeenCalledWith({
      id: assets[1].id,
      assetImageEnrichmentActionRequestDto: { action: AssetImageEnrichmentAction.MarkNsfw },
    });
    expect(onAssetsMarkNsfw).toHaveBeenCalledWith(assets.map(({ id }) => id));
    expect(onMark).toHaveBeenCalledWith(
      assets.map(({ id }) => id),
      AssetImageEnrichmentAction.MarkNsfw,
    );
    expect(toastManager.primary).toHaveBeenCalled();
    expect(assetMultiSelectManager.selectionActive).toBe(false);
    unsubscribe();
  });

  it('marks selected owned assets as safe', async () => {
    const assets = [timelineAsset('asset-1', authManager.user.id), timelineAsset('asset-2', authManager.user.id)];
    const onAssetsMarkNsfw = vi.fn();
    const unsubscribe = eventManager.on({ AssetsMarkNsfw: onAssetsMarkNsfw });
    assetMultiSelectManager.selectAssets(assets);

    render(MarkNsfwAction, { menuItem: true, markSafe: true });

    await fireEvent.click(screen.getByRole('menuitem', { name: 'mark_safe' }));

    await waitFor(() => expect(updateAssetImageEnrichment).toHaveBeenCalledTimes(2));
    expect(updateAssetImageEnrichment).toHaveBeenCalledWith({
      id: assets[0].id,
      assetImageEnrichmentActionRequestDto: { action: AssetImageEnrichmentAction.MarkSafe },
    });
    expect(updateAssetImageEnrichment).toHaveBeenCalledWith({
      id: assets[1].id,
      assetImageEnrichmentActionRequestDto: { action: AssetImageEnrichmentAction.MarkSafe },
    });
    expect(onAssetsMarkNsfw).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('marks explicit asset ids without clearing timeline selection', async () => {
    assetMultiSelectManager.selectAsset(timelineAsset('selected-asset', authManager.user.id));

    render(MarkNsfwAction, {
      menuItem: true,
      assetIds: ['open-asset'],
      clearSelection: false,
    });

    await fireEvent.click(screen.getByRole('menuitem', { name: 'mark_nsfw' }));

    await waitFor(() => expect(updateAssetImageEnrichment).toHaveBeenCalledTimes(1));
    expect(updateAssetImageEnrichment).toHaveBeenCalledWith({
      id: 'open-asset',
      assetImageEnrichmentActionRequestDto: { action: AssetImageEnrichmentAction.MarkNsfw },
    });
    expect(assetMultiSelectManager.selectionActive).toBe(true);
  });
});
