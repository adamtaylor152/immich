<script lang="ts">
  import { invalidate } from '$app/navigation';
  import { scrollMemory } from '$lib/actions/scroll-memory';
  import AlbumsControls from './AlbumsControls.svelte';
  import Albums from '$lib/components/album-page/AlbumsList.svelte';
  import UserPageLayout, { headerId } from '$lib/components/layouts/UserPageLayout.svelte';
  import EmptyPlaceholder from '$lib/components/shared-components/EmptyPlaceholder.svelte';
  import TreeItems from '$lib/components/shared-components/tree/TreeItems.svelte';
  import Sidebar from '$lib/components/sidebar/Sidebar.svelte';
  import GroupTab from '$lib/elements/GroupTab.svelte';
  import SearchBar from '$lib/elements/SearchBar.svelte';
  import SkipLink from '$lib/elements/SkipLink.svelte';
  import { Route } from '$lib/route';
  import { handleUpdateAlbum } from '$lib/services/album.service';
  import { AlbumFilter, albumViewSettings } from '$lib/stores/preferences.store';
  import { computeSiblingSortOrder, getAlbumDragData, getAlbumSubtreeIds, isAlbumDrag } from '$lib/utils/album-drag';
  import { albumIconPath, DEFAULT_ALBUM_ICON_PATH } from '$lib/utils/album-icons';
  import { createAlbumAndRedirect } from '$lib/utils/album-utils';
  import { getLastIdSegment, TreeNode } from '$lib/utils/tree-utils';
  import { Icon, Text } from '@immich/ui';
  import { mdiFolderHome } from '@mdi/js';
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
  let rootDropHover = $state(false);

  const ownedAlbums = $derived(data.albums);
  const topLevelOwnedAlbums = $derived(ownedAlbums.filter((album) => !album.parentId));
  const displayedOwnedAlbums = $derived($albumViewSettings.showAllAlbums ? ownedAlbums : topLevelOwnedAlbums);
  const tree = $derived(TreeNode.fromAlbums(ownedAlbums));
  const subtreeOfDragged = $derived(draggedId ? getAlbumSubtreeIds(ownedAlbums, draggedId) : new Set<string>());
  const iconByAlbumId = $derived(
    Object.fromEntries(ownedAlbums.map((a) => [a.id, albumIconPath(a.icon)])) as Record<string, string>,
  );
  const getNodeIcons = (node: import('$lib/utils/tree-utils').TreeNode) => {
    const path = (node.id && iconByAlbumId[node.id]) ?? DEFAULT_ALBUM_ICON_PATH;
    return { default: path, active: path };
  };

  const getLink = (path: string) => Route.viewAlbum({ id: getLastIdSegment(path) });

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

  const handleCardDrop = (dropped: string, target: AlbumResponseDto) => reparent(dropped, target.id);
  const canDropOnCard = (dropped: string, target: AlbumResponseDto) =>
    dropped !== target.id && !subtreeOfDragged.has(target.id);

  const handleTreeDrop = (dropped: string, targetPath: string, position: 'before' | 'inside' | 'after') => {
    const targetId = getLastIdSegment(targetPath);
    if (!targetId) {
      return;
    }
    const target = ownedAlbums.find((a) => a.id === targetId);
    if (!target) {
      return;
    }

    if (position === 'inside') {
      void reparent(dropped, targetId);
      return;
    }

    // Insert as a sibling of `target`. parentId follows the target's parent;
    // sortOrder is the midpoint between target and its neighbor in the chosen
    // direction. Exclude the dragged album from the sibling set so it isn't
    // treated as its own neighbor when it's already in this folder.
    const siblings = ownedAlbums.filter((a) => a.parentId === target.parentId && a.id !== dropped);
    const newSortOrder = computeSiblingSortOrder(siblings, target, position);
    void applyUpdate(dropped, { parentId: target.parentId, sortOrder: newSortOrder });
  };
  const canDropOnTree = (dropped: string, targetPath: string) => {
    const targetId = getLastIdSegment(targetPath);
    if (!targetId) {
      return false;
    }
    // Self-drop is always invalid for nesting; sibling reorder onto self is
    // also a no-op so reject it for cleaner UX.
    if (dropped === targetId) {
      return false;
    }
    // Reject descendants for every position. A before/after drop reparents the
    // dragged album to `target.parentId`; if the target is inside the dragged
    // subtree, that new parent is also inside it, creating a self/cycle.
    if (subtreeOfDragged.has(targetId)) {
      return false;
    }
    return true;
  };

  const handleRootDragOver = (event: DragEvent) => {
    if (!isAlbumDrag(event) || !draggedId) {
      return;
    }
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'move';
    rootDropHover = true;
  };
  const handleRootDragLeave = () => {
    rootDropHover = false;
  };
  const handleRootDrop = (event: DragEvent) => {
    event.preventDefault();
    rootDropHover = false;
    const dropped = getAlbumDragData(event);
    if (dropped) {
      void reparent(dropped, null);
    }
  };
</script>

<UserPageLayout title={data.meta.title} use={[[scrollMemory, { routeStartsWith: Route.albums() }]]}>
  {#snippet sidebar()}
    <Sidebar>
      <SkipLink target={`#${headerId}`} text={$t('skip_to_albums')} breakpoint="md" />
      <section>
        <Text class="mb-4 ps-4" size="small">{$t('albums')}</Text>
        <div
          class={`mb-1 flex items-center gap-2 rounded-lg py-1 ps-2 text-lg transition-colors ${rootDropHover ? 'bg-primary/10 ring-2 ring-primary' : 'text-gray-500 dark:text-gray-400'} ${draggedId ? 'opacity-100' : 'opacity-60'}`}
          ondragover={handleRootDragOver}
          ondragleave={handleRootDragLeave}
          ondrop={handleRootDrop}
          role="presentation"
        >
          <Icon icon={mdiFolderHome} size="20" />
          <span>{$t('top_level_no_parent')}</span>
        </div>
        <div class="h-full">
          <TreeItems
            icons={{ default: DEFAULT_ALBUM_ICON_PATH, active: DEFAULT_ALBUM_ICON_PATH }}
            {tree}
            active=""
            {getLink}
            onDrop={handleTreeDrop}
            canAcceptDrop={canDropOnTree}
            {draggedId}
            getIcons={getNodeIcons}
            labelClass="overflow-hidden ps-1 pt-1 text-lg text-nowrap text-ellipsis whitespace-pre-wrap"
            enableDrag
            onDragStart={(id) => (draggedId = id)}
            onDragEnd={() => (draggedId = null)}
          />
        </div>
      </section>
    </Sidebar>
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
