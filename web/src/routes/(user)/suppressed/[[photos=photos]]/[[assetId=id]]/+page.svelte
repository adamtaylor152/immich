<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import ActionMenuItem from '$lib/components/ActionMenuItem.svelte';
  import Albums from '$lib/components/album-page/AlbumsList.svelte';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import EmptyPlaceholder from '$lib/components/shared-components/EmptyPlaceholder.svelte';
  import ArchiveAction from '$lib/components/timeline/actions/ArchiveAction.svelte';
  import ChangeDate from '$lib/components/timeline/actions/ChangeDateAction.svelte';
  import ChangeDescription from '$lib/components/timeline/actions/ChangeDescriptionAction.svelte';
  import ChangeLocation from '$lib/components/timeline/actions/ChangeLocationAction.svelte';
  import CreateSharedLink from '$lib/components/timeline/actions/CreateSharedLinkAction.svelte';
  import DeleteAssets from '$lib/components/timeline/actions/DeleteAssetsAction.svelte';
  import DownloadAction from '$lib/components/timeline/actions/DownloadAction.svelte';
  import FavoriteAction from '$lib/components/timeline/actions/FavoriteAction.svelte';
  import LinkLivePhotoAction from '$lib/components/timeline/actions/LinkLivePhotoAction.svelte';
  import SelectAllAssets from '$lib/components/timeline/actions/SelectAllAction.svelte';
  import SetVisibilityAction from '$lib/components/timeline/actions/SetVisibilityAction.svelte';
  import StackAction from '$lib/components/timeline/actions/StackAction.svelte';
  import TagAction from '$lib/components/timeline/actions/TagAction.svelte';
  import AssetSelectControlBar from '$lib/components/timeline/AssetSelectControlBar.svelte';
  import Timeline from '$lib/components/timeline/Timeline.svelte';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
  import AssetAddToAlbumModal from '$lib/modals/AssetAddToAlbumModal.svelte';
  import { Route } from '$lib/route';
  import { getAssetBulkActions } from '$lib/services/asset.service';
  import { albumViewSettings } from '$lib/stores/preferences.store';
  import {
    updateStackedAssetInTimeline,
    updateUnstackedAssetInTimeline,
    type OnLink,
    type OnUnlink,
  } from '$lib/utils/actions';
  import { AssetVisibility, getAuthStatus } from '@immich/sdk';
  import { ActionButton, CommandPaletteDefaultProvider, modalManager, type ActionItem } from '@immich/ui';
  import { mdiDotsVertical } from '@mdi/js';
  import { t, type MessageFormatter } from 'svelte-i18n';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
  let timelineManager = $state<TimelineManager>() as TimelineManager;
  let pendingTab: 'timeline' | 'albums' | undefined = $state();
  let activeTab: 'timeline' | 'albums' = $derived(pendingTab ?? (data.tab === 'albums' ? 'albums' : 'timeline'));
  let searchQuery = $state('');
  let albumGroups: string[] = $state([]);
  let selectedAssets = $derived(assetMultiSelectManager.assets);
  let isAssetStackSelected = $derived(selectedAssets.length === 1 && !!selectedAssets[0].stack);
  let isLinkActionAvailable = $derived.by(() => {
    const isLivePhoto = selectedAssets.length === 1 && !!selectedAssets[0].livePhotoVideoId;
    const isLivePhotoCandidate =
      selectedAssets.length === 2 &&
      selectedAssets.some((asset) => asset.isImage) &&
      selectedAssets.some((asset) => asset.isVideo);

    return assetMultiSelectManager.isAllUserOwned && (isLivePhoto || isLivePhotoCandidate);
  });

  const options = {
    visibility: AssetVisibility.Timeline,
    withStacked: true,
    withPartners: true,
    suppressedOnly: true,
  };

  const setTab = async (tab: 'timeline' | 'albums') => {
    pendingTab = tab;
    try {
      await goto(Route.suppressed({ tab }), { keepFocus: true, noScroll: true, replaceState: true });
    } finally {
      pendingTab = undefined;
    }
  };

  const handleEscape = () => {
    if (assetMultiSelectManager.selectionActive) {
      assetMultiSelectManager.clear();
    }
  };

  const handleLink: OnLink = ({ still, motion }) => {
    timelineManager.removeAssets([motion.id]);
    timelineManager.upsertAssets([still]);
  };

  const handleUnlink: OnUnlink = ({ still, motion }) => {
    timelineManager.upsertAssets([motion]);
    timelineManager.upsertAssets([still]);
  };

  const handleSetVisibility = (assetIds: string[]) => {
    timelineManager.removeAssets(assetIds);
    assetMultiSelectManager.clear();
  };

  const ensureElevatedSession = async () => {
    const { isElevated, pinCode } = await getAuthStatus();
    if (isElevated && pinCode) {
      return true;
    }

    await goto(Route.pinPrompt({ continue: page.url.pathname + page.url.search }));
    return false;
  };

  const getSuppressedAssetBulkActions = ($t: MessageFormatter) => {
    const actions = getAssetBulkActions($t);
    const AddToAlbum: ActionItem = {
      ...actions.AddToAlbum,
      onAction: async () => {
        if (!(await ensureElevatedSession())) {
          return;
        }

        void modalManager.show(AssetAddToAlbumModal, {
          assetIds: assetMultiSelectManager.assets.map((asset) => asset.id),
        });
      },
    };

    return { ...actions, AddToAlbum };
  };
</script>

<UserPageLayout title={data.meta.title} hideNavbar={assetMultiSelectManager.selectionActive} scrollbar={false}>
  {#snippet buttons()}
    <div class="inline-flex rounded-full border border-gray-300 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-900">
      <button
        type="button"
        class="rounded-full px-4 py-1.5 text-sm transition-colors"
        class:bg-primary={activeTab === 'timeline'}
        class:text-white={activeTab === 'timeline'}
        class:dark:text-immich-dark-gray={activeTab === 'timeline'}
        onclick={() => setTab('timeline')}
      >
        {$t('timeline')}
      </button>
      <button
        type="button"
        class="rounded-full px-4 py-1.5 text-sm transition-colors"
        class:bg-primary={activeTab === 'albums'}
        class:text-white={activeTab === 'albums'}
        class:dark:text-immich-dark-gray={activeTab === 'albums'}
        onclick={() => setTab('albums')}
      >
        {$t('albums')}
      </button>
    </div>
  {/snippet}

  {#if activeTab === 'timeline'}
    <Timeline
      enableRouting={true}
      bind:timelineManager
      {options}
      assetInteraction={assetMultiSelectManager}
      onEscape={handleEscape}
      withStacked
    >
      {#snippet empty()}
        <EmptyPlaceholder
          text={$t('no_suppressed_content_message')}
          title={$t('nothing_here_yet')}
          class="mx-auto mt-10"
        />
      {/snippet}
    </Timeline>
  {:else}
    <div class="h-full overflow-y-auto p-4 md:px-6">
      <Albums
        ownedAlbums={data.ownedAlbums}
        sharedAlbums={data.sharedAlbums}
        userSettings={$albumViewSettings}
        showOwner
        showContextMenu={false}
        {searchQuery}
        getAlbumHref={Route.suppressedAlbum}
        bind:albumGroupIds={albumGroups}
      >
        {#snippet empty()}
          <EmptyPlaceholder
            text={$t('no_suppressed_albums_message')}
            title={$t('nothing_here_yet')}
            class="mx-auto mt-10"
          />
        {/snippet}
      </Albums>
    </div>
  {/if}
</UserPageLayout>

{#if assetMultiSelectManager.selectionActive}
  <AssetSelectControlBar>
    {@const Actions = getSuppressedAssetBulkActions($t)}
    <CommandPaletteDefaultProvider name={$t('assets')} actions={Object.values(Actions)} />

    <CreateSharedLink />
    <SelectAllAssets {timelineManager} assetInteraction={assetMultiSelectManager} />
    <ActionButton action={Actions.AddToAlbum} />
    {#if assetMultiSelectManager.isAllUserOwned}
      <FavoriteAction
        removeFavorite={assetMultiSelectManager.isAllFavorite}
        onFavorite={(ids, isFavorite) => timelineManager.update(ids, (asset) => (asset.isFavorite = isFavorite))}
      />

      <ButtonContextMenu icon={mdiDotsVertical} title={$t('menu')}>
        <ActionMenuItem action={Actions.AddToAlbum} />
        <DownloadAction menuItem />
        {#if assetMultiSelectManager.assets.length > 1 || isAssetStackSelected}
          <StackAction
            unstack={isAssetStackSelected}
            onStack={(result) => updateStackedAssetInTimeline(timelineManager, result)}
            onUnstack={(assets) => updateUnstackedAssetInTimeline(timelineManager, assets)}
          />
        {/if}
        {#if isLinkActionAvailable}
          <LinkLivePhotoAction
            menuItem
            unlink={assetMultiSelectManager.assets.length === 1}
            onLink={handleLink}
            onUnlink={handleUnlink}
          />
        {/if}
        <ChangeDate menuItem />
        <ChangeDescription menuItem />
        <ChangeLocation menuItem />
        <ArchiveAction
          menuItem
          onArchive={(ids, visibility) => timelineManager.update(ids, (asset) => (asset.visibility = visibility))}
        />
        {#if authManager.preferences.tags.enabled}
          <TagAction menuItem />
        {/if}
        <DeleteAssets
          menuItem
          onAssetDelete={(assetIds) => timelineManager.removeAssets(assetIds)}
          onUndoDelete={(assets) => timelineManager.upsertAssets(assets)}
        />
        <SetVisibilityAction menuItem onVisibilitySet={handleSetVisibility} />
        <hr />
        <ActionMenuItem action={Actions.RegenerateThumbnailJob} />
        <ActionMenuItem action={Actions.RefreshMetadataJob} />
        <ActionMenuItem action={Actions.TranscodeVideoJob} />
      </ButtonContextMenu>
    {:else}
      <DownloadAction />
    {/if}
  </AssetSelectControlBar>
{/if}
