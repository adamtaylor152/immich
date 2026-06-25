<script lang="ts">
  import { invalidate } from '$app/navigation';
  import { scrollMemory } from '$lib/actions/scroll-memory';
  import AlbumsControls from './AlbumsControls.svelte';
  import Albums from '$lib/components/album-page/AlbumsList.svelte';
  import UserPageLayout, { headerId } from '$lib/components/layouts/UserPageLayout.svelte';
  import EmptyPlaceholder from '$lib/components/shared-components/EmptyPlaceholder.svelte';
  import UserSidebar from '$lib/components/shared-components/side-bar/UserSidebar.svelte';
  import GroupTab from '$lib/elements/GroupTab.svelte';
  import SearchBar from '$lib/elements/SearchBar.svelte';
  import SkipLink from '$lib/elements/SkipLink.svelte';
  import { Route } from '$lib/route';
  import { handleUpdateAlbum } from '$lib/services/album.service';
  import { AlbumFilter, albumViewSettings } from '$lib/stores/preferences.store';
  import { getAlbumSubtreeIds } from '$lib/utils/album-drag';
  import { createAlbumAndRedirect } from '$lib/utils/album-utils';
  import { t } from 'svelte-i18n';
  import type { AlbumResponseDto } from '@immich/sdk';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  let searchQuery = $state('');
  let albumGroups: string[] = $state([]);
  let draggedId: string | null = $state(null);

  const ownedAlbums = $derived(data.albums);
  const topLevelOwnedAlbums = $derived(ownedAlbums.filter((album) => !album.parentId));
  const displayedOwnedAlbums = $derived($albumViewSettings.showAllAlbums ? ownedAlbums : topLevelOwnedAlbums);

  const applyUpdate = async (draggedAlbumId: string, update: { parentId?: string | null; sortOrder?: number }) => {
    const album = ownedAlbums.find((a) => a.id === draggedAlbumId);
    if (!album) {
      return;
    }
    if (
      ('parentId' in update ? update.parentId === album.parentId : true) &&
      ('sortOrder' in update ? update.sortOrder === album.sortOrder : true)
    ) {
      return; // nothing actually changed
    }
    const ok = await handleUpdateAlbum(album, update);
    if (ok) {
      await invalidate('album:data');
    }
  };

  const reparent = (draggedAlbumId: string, newParentId: string | null) =>
    applyUpdate(draggedAlbumId, { parentId: newParentId });

  // Album reparenting is driven by dragging album cards onto each other in the
  // grid; the nested tree lives in the global left nav (AlbumNavigationTree).
  const handleCardDrop = (dropped: string, target: AlbumResponseDto) => reparent(dropped, target.id);
  // Reject self/descendant targets using the subtree of the dropped album itself,
  // not the mutable `draggedId` state, so a stale drag id can't slip an invalid drop through.
  const canDropOnCard = (dropped: string, target: AlbumResponseDto) =>
    dropped !== target.id && !getAlbumSubtreeIds(ownedAlbums, dropped).has(target.id);
</script>

<UserPageLayout title={data.meta.title} use={[[scrollMemory, { routeStartsWith: Route.albums() }]]}>
  {#snippet sidebar()}
    <UserSidebar>
      <SkipLink target={`#${headerId}`} text={$t('skip_to_albums')} breakpoint="md" />
    </UserSidebar>
  {/snippet}

  {#snippet buttons()}
    <div class="flex place-items-center gap-2">
      <AlbumsControls {albumGroups} bind:searchQuery />
    </div>
  {/snippet}

  <div class="xl:hidden">
    <div class="h-14 w-fit py-2 dark:text-immich-dark-fg">
      <GroupTab
        label={$t('show_albums')}
        filters={Object.keys(AlbumFilter)}
        selected={$albumViewSettings.filter}
        onSelect={(selected) => ($albumViewSettings.filter = selected)}
      />
    </div>
    <div class="w-60">
      <SearchBar placeholder={$t('search_albums')} bind:name={searchQuery} showLoadingSpinner={false} />
    </div>
  </div>

  <Albums
    ownedAlbums={displayedOwnedAlbums}
    sharedAlbums={data.sharedAlbums}
    userSettings={$albumViewSettings}
    allowEdit
    {searchQuery}
    bind:albumGroupIds={albumGroups}
    onAlbumDrop={handleCardDrop}
    canAcceptDrop={canDropOnCard}
    bind:draggedId
  >
    {#snippet empty()}
      <EmptyPlaceholder text={$t('no_albums_message')} onClick={() => createAlbumAndRedirect()} class="mx-auto mt-10" />
    {/snippet}
  </Albums>
</UserPageLayout>
