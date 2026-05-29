<script lang="ts">
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import EmptyPlaceholder from '$lib/components/shared-components/EmptyPlaceholder.svelte';
  import GalleryViewer from '$lib/components/shared-components/gallery-viewer/GalleryViewer.svelte';
  import ArchiveAction from '$lib/components/timeline/actions/ArchiveAction.svelte';
  import ChangeDate from '$lib/components/timeline/actions/ChangeDateAction.svelte';
  import ChangeDescription from '$lib/components/timeline/actions/ChangeDescriptionAction.svelte';
  import ChangeLocation from '$lib/components/timeline/actions/ChangeLocationAction.svelte';
  import CreateSharedLink from '$lib/components/timeline/actions/CreateSharedLinkAction.svelte';
  import DeleteAssets from '$lib/components/timeline/actions/DeleteAssetsAction.svelte';
  import DownloadAction from '$lib/components/timeline/actions/DownloadAction.svelte';
  import FavoriteAction from '$lib/components/timeline/actions/FavoriteAction.svelte';
  import MarkNsfwAction from '$lib/components/timeline/actions/MarkNsfwAction.svelte';
  import SetVisibilityAction from '$lib/components/timeline/actions/SetVisibilityAction.svelte';
  import TagAction from '$lib/components/timeline/actions/TagAction.svelte';
  import AssetSelectControlBar from '$lib/components/timeline/AssetSelectControlBar.svelte';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import type { Viewport } from '$lib/managers/timeline-manager/types';
  import { getAssetBulkActions } from '$lib/services/asset.service';
  import { handleError } from '$lib/utils/handle-error';
  import { toTimelineAsset } from '$lib/utils/timeline-util';
  import { getBestPhotos, type BestPhotoAssetResponseDto } from '@immich/sdk';
  import { ActionButton, CommandPaletteDefaultProvider, IconButton, LoadingSpinner } from '@immich/ui';
  import { mdiDotsVertical, mdiSelectAll } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  const viewport: Viewport = $state({ width: 0, height: 0 });
  let page = $state(1);
  let isLoading = $state(true);
  let assets: BestPhotoAssetResponseDto[] = $state([]);
  let resultsElement: HTMLElement | undefined = $state();

  const onAssetDelete = (assetIds: string[]) => {
    const deleted = new Set(assetIds);
    assets = assets.filter((asset) => !deleted.has(asset.id));
  };

  const reload = async () => {
    page = 1;
    assets = [];
    await loadNextPage(true);
  };

  // eslint-disable-next-line svelte/valid-prop-names-in-kit-pages
  export const loadNextPage = async (force?: boolean) => {
    if (!page || (isLoading && !force)) {
      return;
    }

    isLoading = true;

    try {
      const response = await getBestPhotos({ page, limit: 100 });
      assets.push(...response.items);
      page = Number(response.nextPage) || 0;
    } catch (error) {
      handleError(error, $t('failed_to_load_assets'));
    } finally {
      isLoading = false;
    }
  };

  const handleSelectAll = () => {
    assetMultiSelectManager.selectAssets(assets.map((asset) => toTimelineAsset(asset)));
  };

  const handleSetVisibility = (assetIds: string[]) => {
    assetMultiSelectManager.clear();
    onAssetDelete(assetIds);
  };

  onMount(() => {
    void reload();
  });
</script>

<UserPageLayout hideNavbar={assetMultiSelectManager.selectionActive} title={data.meta.title} scrollbar={false}>
  <section
    class="m-4 mb-12 bg-immich-bg dark:bg-immich-dark-bg"
    bind:clientHeight={viewport.height}
    bind:clientWidth={viewport.width}
    bind:this={resultsElement}
  >
    {#if assets.length > 0}
      <GalleryViewer
        {assets}
        assetInteraction={assetMultiSelectManager}
        onIntersected={loadNextPage}
        showArchiveIcon={true}
        {viewport}
        onReload={reload}
        slidingWindowOffset={resultsElement?.offsetTop ?? 0}
      />
    {:else if !isLoading}
      <div class="flex min-h-[calc(66vh-11rem)] w-full place-content-center items-center">
        <EmptyPlaceholder text={$t('no_best_photos_scored')} />
      </div>
    {/if}

    {#if isLoading}
      <div class="flex items-center justify-center py-16">
        <LoadingSpinner size="giant" />
      </div>
    {/if}
  </section>
</UserPageLayout>

{#if assetMultiSelectManager.selectionActive}
  <AssetSelectControlBar>
    {@const Actions = getAssetBulkActions($t)}
    <CommandPaletteDefaultProvider name={$t('assets')} actions={Object.values(Actions)} />
    <CreateSharedLink />
    <IconButton
      shape="round"
      color="secondary"
      variant="ghost"
      aria-label={$t('select_all')}
      icon={mdiSelectAll}
      onclick={handleSelectAll}
    />
    <ActionButton action={Actions.AddToAlbum} />
    {#if assetMultiSelectManager.isAllUserOwned}
      <FavoriteAction
        removeFavorite={assetMultiSelectManager.isAllFavorite}
        onFavorite={(ids, isFavorite) => {
          for (const id of ids) {
            const asset = assets.find((asset) => asset.id === id);
            if (asset) {
              asset.isFavorite = isFavorite;
            }
          }
        }}
      />

      <ButtonContextMenu icon={mdiDotsVertical} title={$t('menu')}>
        <DownloadAction menuItem />
        <ChangeDate menuItem />
        <ChangeDescription menuItem />
        <ChangeLocation menuItem />
        <ArchiveAction menuItem unarchive={assetMultiSelectManager.isAllArchived} />
        {#if assetMultiSelectManager.ownedAssets.length > 0}
          <MarkNsfwAction menuItem />
          <MarkNsfwAction menuItem markSafe />
        {/if}
        <SetVisibilityAction menuItem onVisibilitySet={handleSetVisibility} />
        {#if authManager.preferences.tags.enabled}
          <TagAction menuItem />
        {/if}
        <DeleteAssets menuItem {onAssetDelete} onUndoDelete={reload} />
      </ButtonContextMenu>
    {:else}
      <DownloadAction />
    {/if}
  </AssetSelectControlBar>
{/if}
