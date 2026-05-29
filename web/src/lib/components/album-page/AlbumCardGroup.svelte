<script lang="ts">
  import AlbumCard from '$lib/components/album-page/AlbumCard.svelte';
  import { Route } from '$lib/route';
  import { albumViewSettings } from '$lib/stores/preferences.store';
  import { getAlbumDragData, isAlbumDrag, setAlbumDragData } from '$lib/utils/album-drag';
  import { type AlbumGroup, isAlbumGroupCollapsed, toggleAlbumGroupCollapsing } from '$lib/utils/album-utils';
  import type { ContextMenuPosition } from '$lib/utils/context-menu';
  import type { AlbumResponseDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiChevronRight } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import { flip } from 'svelte/animate';
  import { slide } from 'svelte/transition';

  interface Props {
    albums: AlbumResponseDto[];
    group?: AlbumGroup | undefined;
    showOwner?: boolean;
    showDateRange?: boolean;
    showItemCount?: boolean;
    getAlbumHref?: (album: AlbumResponseDto) => string;
    onShowContextMenu?: ((position: ContextMenuPosition, album: AlbumResponseDto) => unknown) | undefined;
    /**
     * Drag-and-drop reparent callback. When supplied, each card becomes a drag
     * source (album id payload) AND a drop target (drop one album onto another
     * to nest the first under the second). `canAcceptDrop` lets the caller
     * filter invalid targets (self, descendants) before the drop indicator
     * appears.
     */
    onAlbumDrop?: (draggedId: string, targetAlbum: AlbumResponseDto) => void;
    canAcceptDrop?: (draggedId: string, targetAlbum: AlbumResponseDto) => boolean;
    /**
     * Bindable so the page can observe the active drag and feed it back into
     * sibling drop targets (e.g. the sidebar tree) for cycle prevention.
     */
    draggedId?: string | null;
  }

  let {
    albums,
    group = undefined,
    showOwner = false,
    showDateRange = false,
    showItemCount = false,
    getAlbumHref = Route.viewAlbum,
    onShowContextMenu = undefined,
    onAlbumDrop = undefined,
    canAcceptDrop = undefined,
    draggedId = $bindable(null),
  }: Props = $props();

  let dragOverAlbumId = $state<string | null>(null);
  const dragEnabled = $derived(onAlbumDrop !== undefined);

  const handleDragOver = (event: DragEvent, album: AlbumResponseDto) => {
    if (!dragEnabled || !isAlbumDrag(event)) {
      return;
    }
    // dragover dataTransfer is locked — read the dragged id by looking up
    // whichever card most recently started a drag via dataTransfer.types alone
    // would be flaky, so we delegate the cycle/self check to canAcceptDrop
    // using the saved-during-dragstart id below.
    if (canAcceptDrop && draggedId && !canAcceptDrop(draggedId, album)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'move';
    dragOverAlbumId = album.id;
  };

  const handleDragLeave = (album: AlbumResponseDto) => {
    if (dragOverAlbumId === album.id) {
      dragOverAlbumId = null;
    }
  };

  const handleDrop = (event: DragEvent, album: AlbumResponseDto) => {
    if (!dragEnabled) {
      return;
    }
    event.preventDefault();
    const draggedAlbumId = getAlbumDragData(event);
    dragOverAlbumId = null;
    draggedId = null;
    if (!draggedAlbumId || draggedAlbumId === album.id) {
      return;
    }
    onAlbumDrop?.(draggedAlbumId, album);
  };

  const handleDragStart = (event: DragEvent, album: AlbumResponseDto) => {
    if (!dragEnabled) {
      return;
    }
    draggedId = album.id;
    setAlbumDragData(event, album.id);
  };

  const handleDragEnd = () => {
    draggedId = null;
    dragOverAlbumId = null;
  };

  let isCollapsed = $derived(!!group && isAlbumGroupCollapsed($albumViewSettings, group.id));

  const showContextMenu = (position: ContextMenuPosition, album: AlbumResponseDto) => {
    onShowContextMenu?.(position, album);
  };

  let iconRotation = $derived(isCollapsed ? 'rotate-0' : 'rotate-90');

  const oncontextmenu = (event: MouseEvent, album: AlbumResponseDto) => {
    event.preventDefault();
    showContextMenu({ x: event.x, y: event.y }, album);
  };
</script>

{#if group}
  <div class="grid">
    <button
      type="button"
      onclick={() => toggleAlbumGroupCollapsing(group.id)}
      class="mt-2 w-full cursor-pointer rounded-md py-2 pe-2 text-start transition-colors hover:bg-subtle hover:text-primary dark:text-immich-dark-fg dark:hover:bg-immich-dark-gray"
      aria-expanded={!isCollapsed}
    >
      <Icon icon={mdiChevronRight} size="24" class="-mt-2.5 inline-block transition-all duration-250 {iconRotation}" />
      <span class="text-3xl font-bold text-black dark:text-white">{group.name}</span>
      <span class="ms-1.5">({$t('albums_count', { values: { count: albums.length } })})</span>
    </button>
    <hr class="dark:border-immich-dark-gray" />
  </div>
{/if}

<div class="mt-4">
  {#if !isCollapsed}
    <div class="grid grid-auto-fill-56 gap-y-4" transition:slide={{ duration: 300 }}>
      {#each albums as album, index (album.id)}
        <a
          href={getAlbumHref(album)}
          class="h-fit rounded-2xl outline-2 outline-transparent transition-[outline-color] {dragOverAlbumId ===
          album.id
            ? 'outline-primary'
            : ''}"
          animate:flip={{ duration: 400 }}
          oncontextmenu={(event) => (onShowContextMenu ? oncontextmenu(event, album) : undefined)}
          draggable={dragEnabled}
          ondragstart={(event) => handleDragStart(event, album)}
          ondragend={handleDragEnd}
          ondragover={(event) => handleDragOver(event, album)}
          ondragleave={() => handleDragLeave(album)}
          ondrop={(event) => handleDrop(event, album)}
        >
          <AlbumCard
            {album}
            {showOwner}
            {showDateRange}
            {showItemCount}
            preload={index < 20}
            onShowContextMenu={onShowContextMenu ? (position) => showContextMenu(position, album) : undefined}
          />
        </a>
      {/each}
    </div>
  {/if}
</div>
