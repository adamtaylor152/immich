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
      danger: vi.fn(),
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

  it('does nothing when there are no assets to mark', async () => {
    assetMultiSelectManager.clear();

    render(MarkNsfwAction, { menuItem: true, assetIds: [] });

    await fireEvent.click(screen.getByRole('menuitem', { name: 'mark_nsfw' }));

    // No work scheduled — no SDK calls, no toasts.
    expect(updateAssetImageEnrichment).not.toHaveBeenCalled();
    expect(toastManager.primary).not.toHaveBeenCalled();
    expect(toastManager.danger).not.toHaveBeenCalled();
  });

  it('caps concurrent in-flight requests at 5 (MAX_CONCURRENCY)', async () => {
    // 8 assets, manually-controlled deferred mock: at any moment, only 5
    // worker promises should be in flight before earlier ones resolve.
    const ids = Array.from({ length: 8 }, (_, i) => `asset-${i}`);
    let inFlight = 0;
    let peakInFlight = 0;
    const deferreds: { resolve: () => void }[] = [];
    vi.mocked(updateAssetImageEnrichment).mockImplementation(() => {
      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);
      return new Promise<void>((resolve) => {
        deferreds.push({
          resolve: () => {
            inFlight--;
            resolve();
          },
        });
      }) as never;
    });

    render(MarkNsfwAction, { menuItem: true, assetIds: ids, clearSelection: false });
    await fireEvent.click(screen.getByRole('menuitem', { name: 'mark_nsfw' }));

    // After the first batch is scheduled, exactly 5 should be running.
    await waitFor(() => expect(deferreds.length).toBe(5));
    expect(inFlight).toBe(5);

    // Resolve the first 3 — workers should pick up new items, staying capped at 5.
    for (let i = 0; i < 3; i++) {
      deferreds[i].resolve();
    }
    await waitFor(() => expect(deferreds.length).toBe(8));
    expect(inFlight).toBe(5);

    // Drain the rest.
    for (let i = 3; i < 8; i++) {
      deferreds[i].resolve();
    }

    await waitFor(() => expect(updateAssetImageEnrichment).toHaveBeenCalledTimes(8));
    expect(peakInFlight).toBe(5);
  });

  it('emits the partial-success toast with succeeded/total/failed counts', async () => {
    const ids = ['ok-1', 'ok-2', 'fail-3'];
    vi.mocked(updateAssetImageEnrichment).mockImplementation(({ id }) => {
      if (id.startsWith('fail')) {
        return Promise.reject(new Error('boom')) as never;
      }
      return Promise.resolve(undefined as never);
    });
    const onAssetsMarkNsfw = vi.fn();
    const unsubscribe = eventManager.on({ AssetsMarkNsfw: onAssetsMarkNsfw });

    render(MarkNsfwAction, { menuItem: true, assetIds: ids, clearSelection: false });

    await fireEvent.click(screen.getByRole('menuitem', { name: 'mark_nsfw' }));

    await waitFor(() => expect(updateAssetImageEnrichment).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(toastManager.primary).toHaveBeenCalled());

    // The partial-success toast key is used (not the all-succeed key).
    const callArgs = vi.mocked(toastManager.primary).mock.calls.at(-1);
    // The first arg is the localized string. With fallbackLocale=dev,
    // svelte-i18n returns either the key or the substituted message — the
    // key prefix is the stable assertion.
    expect(callArgs?.[0]).toContain('mark_nsfw_action_partial');

    // Only succeeded ids are emitted (failed are dropped).
    expect(onAssetsMarkNsfw).toHaveBeenCalledWith(['ok-1', 'ok-2']);
    unsubscribe();
  });

  it('shows the partial-success toast for mark-safe failures too', async () => {
    const ids = ['ok-1', 'fail-2'];
    vi.mocked(updateAssetImageEnrichment).mockImplementation(({ id }) => {
      if (id.startsWith('fail')) {
        return Promise.reject(new Error('boom')) as never;
      }
      return Promise.resolve(undefined as never);
    });

    render(MarkNsfwAction, { menuItem: true, markSafe: true, assetIds: ids, clearSelection: false });

    await fireEvent.click(screen.getByRole('menuitem', { name: 'mark_safe' }));

    await waitFor(() => expect(updateAssetImageEnrichment).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(toastManager.primary).toHaveBeenCalled());

    const callArgs = vi.mocked(toastManager.primary).mock.calls.at(-1);
    expect(callArgs?.[0]).toContain('mark_safe_action_partial');
  });

  it('routes through handleError when every asset fails', async () => {
    const ids = ['fail-1', 'fail-2'];
    vi.mocked(updateAssetImageEnrichment).mockRejectedValue(new Error('boom') as never);

    render(MarkNsfwAction, { menuItem: true, assetIds: ids, clearSelection: false });

    await fireEvent.click(screen.getByRole('menuitem', { name: 'mark_nsfw' }));

    await waitFor(() => expect(updateAssetImageEnrichment).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(toastManager.danger).toHaveBeenCalled());
    // Partial-success toast should NOT fire.
    expect(toastManager.primary).not.toHaveBeenCalled();
  });

  it('does not touch UI state after unmount mid-batch', async () => {
    // 6 assets, hold all requests open. Unmount before any resolve. After
    // resolving, no toast/event should fire because the abort signal fired
    // in onDestroy short-circuits the post-batch block.
    const ids = Array.from({ length: 6 }, (_, i) => `asset-${i}`);
    const deferreds: { resolve: () => void }[] = [];
    vi.mocked(updateAssetImageEnrichment).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          deferreds.push({ resolve });
        }) as never,
    );
    const onAssetsMarkNsfw = vi.fn();
    const unsubscribe = eventManager.on({ AssetsMarkNsfw: onAssetsMarkNsfw });

    const { unmount } = render(MarkNsfwAction, { menuItem: true, assetIds: ids, clearSelection: false });
    await fireEvent.click(screen.getByRole('menuitem', { name: 'mark_nsfw' }));

    // 5 workers go out (concurrency cap).
    await waitFor(() => expect(deferreds.length).toBe(5));

    // Unmount mid-flight — onDestroy aborts the controller.
    unmount();

    // Resolve everything that was in flight. Workers should observe the
    // abort signal and short-circuit before pushing into succeeded[].
    for (const d of deferreds) {
      d.resolve();
    }

    // Give microtasks a chance to drain.
    await new Promise((resolve) => setTimeout(resolve, 10));

    // No event / toast should be emitted after unmount.
    expect(onAssetsMarkNsfw).not.toHaveBeenCalled();
    expect(toastManager.primary).not.toHaveBeenCalled();
    expect(toastManager.danger).not.toHaveBeenCalled();

    unsubscribe();
  });
});
