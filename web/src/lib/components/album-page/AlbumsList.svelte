<script lang="ts">
  import AlbumCardGroup from '$lib/components/album-page/AlbumCardGroup.svelte';
  import AlbumsTable from '$lib/components/album-page/AlbumsTable.svelte';
  import OnEvents from '$lib/components/OnEvents.svelte';
  import MenuOption from '$lib/components/shared-components/context-menu/MenuOption.svelte';
  import RightClickContextMenu from '$lib/components/shared-components/context-menu/RightClickContextMenu.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import AlbumEditModal from '$lib/modals/AlbumEditModal.svelte';
  import AlbumOptionsModal from '$lib/modals/AlbumOptionsModal.svelte';
  import AlbumParentPickerModal from '$lib/modals/AlbumParentPickerModal.svelte';
  import { Route } from '$lib/route';
  import { handleDeleteAlbum, handleDownloadAlbum, handleUpdateAlbum } from '$lib/services/album.service';
  import {
    AlbumFilter,
    AlbumGroupBy,
    AlbumSortBy,
    AlbumViewMode,
    locale,
    SortOrder,
    type AlbumViewSettings,
  } from '$lib/stores/preferences.store';
  import { getSelectedAlbumGroupOption, sortAlbums, stringToSortOrder, type AlbumGroup } from '$lib/utils/album-utils';
  import type { ContextMenuPosition } from '$lib/utils/context-menu';
  import { normalizeSearchString } from '$lib/utils/string-utils';
  import { AlbumUserRole, type AlbumResponseDto, type SharedLinkResponseDto } from '@immich/sdk';
  import { modalManager } from '@immich/ui';
  import { mdiDeleteOutline, mdiDownload, mdiFolderMoveOutline, mdiRenameOutline, mdiShareVariantOutline } from '@mdi/js';
  import { groupBy } from 'lodash-es';
  import { onMount, type Snippet } from 'svelte';
  import { t } from 'svelte-i18n';

  interface Props {
    ownedAlbums?: AlbumResponseDto[];
    sharedAlbums?: AlbumResponseDto[];
    searchQuery?: string;
    userSettings: AlbumViewSettings;
    allowEdit?: boolean;
    showOwner?: boolean;
    showContextMenu?: boolean;
    albumGroupIds?: string[];
    getAlbumHref?: (album: AlbumResponseDto) => string;
    onAlbumDrop?: (draggedId: string, targetAlbum: AlbumResponseDto) => void;
    canAcceptDrop?: (draggedId: string, targetAlbum: AlbumResponseDto) => boolean;
    draggedId?: string | null;
    empty?: Snippet;
  }

  let {
    ownedAlbums = $bindable([]),
    sharedAlbums = $bindable([]),
    searchQuery = '',
    userSettings,
    allowEdit = false,
    showOwner = false,
    showContextMenu = true,
    // eslint-disable-next-line no-useless-assignment
    albumGroupIds = $bindable([]),
    getAlbumHref = Route.viewAlbum,
    onAlbumDrop = undefined,
    canAcceptDrop = undefined,
    draggedId = $bindable(null),
    empty,
  }: Props = $props();

  interface AlbumGroupOption {
    [option: string]: (order: SortOrder, albums: AlbumResponseDto[]) => AlbumGroup[];
  }

  const groupOptions: AlbumGroupOption = {
    /** No grouping */
    [AlbumGroupBy.None]: (order, albums): AlbumGroup[] => {
      return [
        {
          id: $t('albums'),
          name: $t('albums'),
          albums,
        },
      ];
    },

    /** Group by year */
    [AlbumGroupBy.Year]: (order, albums): AlbumGroup[] => {
      const unknownYear = $t('unknown_year');
      const useStartDate = userSettings.sortBy === AlbumSortBy.OldestPhoto;

      const groupedByYear = groupBy(albums, (album) => {
        const date = useStartDate ? album.startDate : album.endDate;
        return date ? new Date(date).getFullYear() : unknownYear;
      });

      const sortSign = order === SortOrder.Desc ? -1 : 1;
      const sortedByYear = Object.entries(groupedByYear).sort(([a], [b]) => {
        // We make sure empty albums stay at the end of the list
        if (a === unknownYear) {
          return 1;
        } else if (b === unknownYear) {
          return -1;
        } else {
          return (Number.parseInt(a) - Number.parseInt(b)) * sortSign;
        }
      });

      return sortedByYear.map(([year, albums]) => ({
        id: year,
        name: year,
        albums,
      }));
    },

    /** Group by owner */
    [AlbumGroupBy.Owner]: (order, albums): AlbumGroup[] => {
      const currentUserId = authManager.user.id;
      const groupedByOwnerIds = groupBy(albums, (album) => album.albumUsers[0].user.id);

      const sortSign = order === SortOrder.Desc ? -1 : 1;
      const sortedByOwnerNames = Object.entries(groupedByOwnerIds).sort(([ownerIdA, albumsA], [ownerIdB, albumsB]) => {
        // We make sure owned albums stay either at the beginning or the end
        // of the list
        if (ownerIdA === currentUserId) {
          return -sortSign;
        } else if (ownerIdB === currentUserId) {
          return sortSign;
        } else {
          const ownerA = albumsA[0].albumUsers[0].user;
          const ownerB = albumsB[0].albumUsers[0].user;
          return ownerA.name.localeCompare(ownerB.name, $locale) * sortSign;
        }
      });

      return sortedByOwnerNames.map(([ownerId, albums]) => ({
        id: ownerId,
        name: ownerId === currentUserId ? $t('my_albums') : albums[0].albumUsers[0].user.name,
        albums,
      }));
    },
  };

  let albums = $derived.by(() => {
    switch (userSettings.filter) {
      case AlbumFilter.Owned: {
        return ownedAlbums;
      }
      case AlbumFilter.Shared: {
        return sharedAlbums;
      }
      default: {
        const nonOwnedAlbums = sharedAlbums.filter(
          (album) =>
            album.albumUsers.find(({ user: { id } }) => id === authManager.user.id)?.role !== AlbumUserRole.Owner,
        );
        return nonOwnedAlbums.length > 0 ? ownedAlbums.concat(nonOwnedAlbums) : ownedAlbums;
      }
    }
  });
  const normalizedSearchQuery = $derived(normalizeSearchString(searchQuery));
  let filteredAlbums = $derived(
    normalizedSearchQuery
      ? albums.filter(
          ({ albumName, description }) =>
            normalizeSearchString(albumName).includes(normalizedSearchQuery) ||
            normalizeSearchString(description).includes(normalizedSearchQuery),
        )
      : albums,
  );

  let albumGroupOption = $derived(getSelectedAlbumGroupOption(userSettings));
  let groupedAlbums = $derived.by(() => {
    const groupFunc = groupOptions[albumGroupOption] ?? groupOptions[AlbumGroupBy.None];
    const groupedAlbums = groupFunc(stringToSortOrder(userSettings.groupOrder), filteredAlbums);

    return groupedAlbums.map((group) => ({
      id: group.id,
      name: group.name,
      albums: sortAlbums(group.albums, { sortBy: userSettings.sortBy, orderBy: userSettings.sortOrder }),
    }));
  });

  let contextMenuPosition: ContextMenuPosition = $state({ x: 0, y: 0 });
  let selectedAlbum: AlbumResponseDto | undefined = $state();
  let isOpen = $state(false);

  // TODO get rid of this
  $effect(() => {
    albumGroupIds = groupedAlbums.map(({ id }) => id);
  });

  let showFullContextMenu = $derived(
    allowEdit && selectedAlbum && selectedAlbum.albumUsers[0].user.id === authManager.user.id,
  );

  onMount(async () => {
    if (allowEdit) {
      await removeAlbumsIfEmpty();
    }
  });

  const showAlbumContextMenu = (contextMenuDetail: ContextMenuPosition, album: AlbumResponseDto) => {
    selectedAlbum = album;
    contextMenuPosition = {
      x: contextMenuDetail.x,
      y: contextMenuDetail.y,
    };
    isOpen = true;
  };

  let albumContextMenuHandler = $derived(showContextMenu ? showAlbumContextMenu : undefined);

  const closeAlbumContextMenu = () => {
    isOpen = false;
  };

  const handleSelect = async (action: 'edit' | 'share' | 'download' | 'delete' | 'move') => {
    closeAlbumContextMenu();

    if (!selectedAlbum) {
      return;
    }

    switch (action) {
      case 'edit': {
        await modalManager.show(AlbumEditModal, { album: selectedAlbum });
        break;
      }

      case 'share': {
        await modalManager.show(AlbumOptionsModal, { album: selectedAlbum });
        break;
      }

      case 'download': {
        await handleDownloadAlbum(selectedAlbum);
        break;
      }

      case 'delete': {
        await handleDeleteAlbum(selectedAlbum);
        break;
      }

      case 'move': {
        const result = await modalManager.show(AlbumParentPickerModal, {
          albumId: selectedAlbum.id,
          currentParentId: selectedAlbum.parentId,
        });
        if (result && result.parentId !== selectedAlbum.parentId) {
          await handleUpdateAlbum(selectedAlbum, { parentId: result.parentId });
        }
        break;
      }
    }
  };

  const removeAlbumsIfEmpty = async () => {
    const albumsToRemove = ownedAlbums.filter((album) => album.assetCount === 0 && !album.albumName);
    await Promise.allSettled(albumsToRemove.map((album) => handleDeleteAlbum(album, { prompt: false, notify: false })));
  };

  const findAndUpdate = (albums: AlbumResponseDto[], album: AlbumResponseDto) => {
    const target = albums.find(({ id }) => id === album.id);
    if (target) {
      Object.assign(target, album);
    }

    return albums;
  };

  const onAlbumUpdate = (album: AlbumResponseDto) => {
    ownedAlbums = findAndUpdate(ownedAlbums, album);
    sharedAlbums = findAndUpdate(sharedAlbums, album);
  };

  const onAlbumDelete = (album: AlbumResponseDto) => {
    ownedAlbums = ownedAlbums.filter(({ id }) => id !== album.id);
    sharedAlbums = sharedAlbums.filter(({ id }) => id !== album.id);
  };

  const onSharedLinkCreate = (sharedLink: SharedLinkResponseDto) => {
    if (sharedLink.album) {
      onAlbumUpdate(sharedLink.album);
    }
  };
</script>

<OnEvents {onAlbumUpdate} {onAlbumDelete} {onSharedLinkCreate} />

{#if albums.length > 0}
  {#if userSettings.view === AlbumViewMode.Cover}
    <!-- Album Cards -->
    {#if albumGroupOption === AlbumGroupBy.None}
      <AlbumCardGroup
        albums={groupedAlbums[0].albums}
        {showOwner}
        showDateRange
        showItemCount
        {getAlbumHref}
        onShowContextMenu={albumContextMenuHandler}
        {onAlbumDrop}
        {canAcceptDrop}
        bind:draggedId
      />
    {:else}
      {#each groupedAlbums as albumGroup (albumGroup.id)}
        <AlbumCardGroup
          albums={albumGroup.albums}
          group={albumGroup}
          {showOwner}
          showDateRange
          showItemCount
          {getAlbumHref}
          onShowContextMenu={albumContextMenuHandler}
          {onAlbumDrop}
          {canAcceptDrop}
        />
      {/each}
    {/if}
  {:else if userSettings.view === AlbumViewMode.List}
    <!-- Album Table -->
    <AlbumsTable {groupedAlbums} {albumGroupOption} onShowContextMenu={albumContextMenuHandler} />
  {/if}
{:else}
  <!-- Empty Message -->
  {@render empty?.()}
{/if}

<!-- Context Menu -->
{#if showContextMenu}
  <RightClickContextMenu title={$t('album_options')} {...contextMenuPosition} {isOpen} onClose={closeAlbumContextMenu}>
    {#if showFullContextMenu}
      <MenuOption icon={mdiRenameOutline} text={$t('edit_album')} onClick={() => handleSelect('edit')} />
      <MenuOption icon={mdiFolderMoveOutline} text={$t('move_to_folder')} onClick={() => handleSelect('move')} />
      <MenuOption icon={mdiShareVariantOutline} text={$t('share')} onClick={() => handleSelect('share')} />
    {/if}
    <MenuOption icon={mdiDownload} text={$t('download')} onClick={() => handleSelect('download')} />
    {#if showFullContextMenu}
      <MenuOption icon={mdiDeleteOutline} text={$t('delete')} onClick={() => handleSelect('delete')} />
    {/if}
  </RightClickContextMenu>
{/if}
