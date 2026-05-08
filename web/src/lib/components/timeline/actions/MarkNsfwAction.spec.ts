import { AssetImageEnrichmentAction, updateAssetImageEnrichment } from '@immich/sdk';
import { toastManager } from '@immich/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { timelineAssetFactory } from '@test-data/factories/asset-factory';
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
  const ui = await vi.importActual<typeof import('@immich/ui')>('@immich/ui');
  return {
    ...ui,
    toastManager: {
      primary: vi.fn(),
    },
  };
});

describe('MarkNsfwAction', () => {
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
    const assets = timelineAssetFactory.buildList(2, { ownerId: authManager.user.id });
    const onMark = vi.fn();
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
    expect(onMark).toHaveBeenCalledWith(
      assets.map(({ id }) => id),
      AssetImageEnrichmentAction.MarkNsfw,
    );
    expect(toastManager.primary).toHaveBeenCalled();
    expect(assetMultiSelectManager.selectionActive).toBe(false);
  });

  it('marks selected owned assets as safe', async () => {
    const assets = timelineAssetFactory.buildList(2, { ownerId: authManager.user.id });
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
  });
});
