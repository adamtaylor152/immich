<script lang="ts">
  import { invalidate } from '$app/navigation';
  import { page } from '$app/state';
  import TreeItems from '$lib/components/shared-components/tree/TreeItems.svelte';
  import { eventManager } from '$lib/managers/event-manager.svelte';
  import { Route } from '$lib/route';
  import { handleUpdateAlbum } from '$lib/services/album.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { computeSiblingSortOrder, getAlbumDragData, getAlbumSubtreeIds, isAlbumDrag } from '$lib/utils/album-drag';
  import { albumIconPath, DEFAULT_ALBUM_ICON_PATH } from '$lib/utils/album-icons';
  import { handleError } from '$lib/utils/handle-error';
  import { getAlbumIdPath, getLastIdSegment, TreeNode } from '$lib/utils/tree-utils';
  import { getAllAlbums, type AlbumResponseDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiFolderHome } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  let albums: AlbumResponseDto[] = $state([]);
  let draggedId: string | null = $state(null);
  let rootDropHover = $state(false);

  const refreshAlbums = async () => {
    try {
      albums = await getAllAlbums({ isOwned: true });
    } catch (error) {
      handleError(error, $t('failed_to_load_assets'));
    }
  };

  $effect(() => {
    void refreshAlbums();
  });

  onMount(() => {
    // Album cards in the grid can also be dropped onto each other; every
    // mutation path goes through the album service, so refresh off its events.
    const unsubscribe = eventManager.on({
      AlbumCreate: () => void refreshAlbums(),
      AlbumUpdate: () => void refreshAlbums(),
      AlbumDelete: () => void refreshAlbums(),
    });

    // Album drags start either on a tree row or on an album card in the grid.
    // Listening on the document covers both, so the tree can validate drops (and
    // light up the top-level zone) no matter where the drag came from. `getData`
    // is readable during dragstart — only dragover/dragenter lock the payload.
    const onDragStart = (event: DragEvent) => (draggedId = getAlbumDragData(event));
    const onDragEnd = () => {
      draggedId = null;
      rootDropHover = false;
    };
    document.addEventListener('dragstart', onDragStart);
    document.addEventListener('dragend', onDragEnd);

    return () => {
      unsubscribe();
      document.removeEventListener('dragstart', onDragStart);
      document.removeEventListener('dragend', onDragEnd);
    };
  });

  const tree = $derived(TreeNode.fromAlbums(albums));
  const activeAlbumId = $derived(typeof page.params.albumId === 'string' ? page.params.albumId : '');
  const activePath = $derived(activeAlbumId ? getAlbumIdPath(albums, activeAlbumId) : '');
  const iconByAlbumId = $derived(
    Object.fromEntries(albums.map((album) => [album.id, albumIconPath(album.icon)])) as Record<string, string>,
  );
  const thumbnailByAlbumId = $derived(
    Object.fromEntries(
      albums
        .filter((album) => album.albumThumbnailAssetId)
        .map((album) => [album.id, getAssetMediaUrl({ id: album.albumThumbnailAssetId! })]),
    ) as Record<string, string>,
  );

  const getLink = (path: string) => Route.viewAlbum({ id: getLastIdSegment(path) });
  const getNodeIcons = (node: TreeNode) => {
    const path = (node.id && iconByAlbumId[node.id]) ?? DEFAULT_ALBUM_ICON_PATH;
    return { default: path, active: path };
  };
  const getThumbnail = (node: TreeNode) => (node.id ? thumbnailByAlbumId[node.id] : undefined);

  const applyUpdate = async (draggedAlbumId: string, update: { parentId?: string | null; sortOrder?: number }) => {
    const album = albums.find((a) => a.id === draggedAlbumId);
    if (!album) {
      return;
    }
    if (
      ('parentId' in update ? update.parentId === album.parentId : true) &&
      ('sortOrder' in update ? update.sortOrder === album.sortOrder : true)
    ) {
      return; // nothing actually changed
    }
    // The AlbumUpdate event refreshes this tree; invalidate keeps the albums
    // page grid (which loads its own copy) in sync.
    if (await handleUpdateAlbum(album, update)) {
      await invalidate('album:data');
    }
  };

  const reparent = (draggedAlbumId: string, newParentId: string | null) =>
    applyUpdate(draggedAlbumId, { parentId: newParentId });

  const handleDrop = (dropped: string, targetPath: string, position: 'before' | 'inside' | 'after') => {
    const target = albums.find((a) => a.id === getLastIdSegment(targetPath));
    if (!target) {
      return;
    }

    if (position === 'inside') {
      void reparent(dropped, target.id);
      return;
    }

    // Insert as a sibling of `target`. parentId follows the target's parent;
    // sortOrder is the midpoint between target and its neighbor in the chosen
    // direction. Exclude the dragged album from the sibling set so it isn't
    // treated as its own neighbor when it's already in this folder.
    const siblings = albums.filter((a) => a.parentId === target.parentId && a.id !== dropped);
    void applyUpdate(dropped, {
      parentId: target.parentId,
      sortOrder: computeSiblingSortOrder(siblings, target, position),
    });
  };

  const canAcceptDrop = (dropped: string, targetPath: string) => {
    const targetId = getLastIdSegment(targetPath);
    // Self-drop is a no-op for every position; a descendant target would create
    // a cycle, including for before/after (those reparent to target.parentId,
    // which is itself inside the dragged subtree).
    return !!targetId && dropped !== targetId && !getAlbumSubtreeIds(albums, dropped).has(targetId);
  };

  const handleRootDragOver = (event: DragEvent) => {
    if (!isAlbumDrag(event)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'move';
    rootDropHover = true;
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

{#if draggedId}
  <div
    class={`flex items-center gap-4 rounded-e-full py-3 ps-10 text-sm font-medium transition-colors md:px-10 ${rootDropHover ? 'bg-primary/10 text-immich-primary dark:text-immich-dark-primary' : 'text-gray-500 dark:text-gray-400'}`}
    ondragover={handleRootDragOver}
    ondragleave={() => (rootDropHover = false)}
    ondrop={handleRootDrop}
    role="presentation"
  >
    <Icon icon={mdiFolderHome} size="20" />
    <span class="truncate">{$t('top_level_no_parent')}</span>
  </div>
{/if}

<TreeItems
  navStyle
  icons={{ default: DEFAULT_ALBUM_ICON_PATH, active: DEFAULT_ALBUM_ICON_PATH }}
  {tree}
  active={activePath}
  {getLink}
  getIcons={getNodeIcons}
  {getThumbnail}
  labelClass="min-w-0 grow truncate text-sm font-medium"
  listClass="list-none"
  onDrop={handleDrop}
  {canAcceptDrop}
  {draggedId}
  enableDrag
/>
