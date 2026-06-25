<script lang="ts">
  import { page } from '$app/state';
  import TreeItems from '$lib/components/shared-components/tree/TreeItems.svelte';
  import { Route } from '$lib/route';
  import { getAssetMediaUrl } from '$lib/utils';
  import { albumIconPath, DEFAULT_ALBUM_ICON_PATH } from '$lib/utils/album-icons';
  import { handleError } from '$lib/utils/handle-error';
  import { getAlbumIdPath, getLastIdSegment, TreeNode } from '$lib/utils/tree-utils';
  import { getAllAlbums, type AlbumResponseDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';

  let albums: AlbumResponseDto[] = $state([]);

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
</script>

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
/>
