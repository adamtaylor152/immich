import { getAlbumInfo, getAllAlbums } from '@immich/sdk';
import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ params, url, depends }) => {
  await authenticate(url);

  depends('album:data');

  const [album, ownedAlbums] = await Promise.all([
    getAlbumInfo({ id: params.albumId }),
    getAllAlbums({ isOwned: true }),
  ]);

  return {
    album,
    ownedAlbums,
    meta: {
      title: album.albumName,
    },
  };
}) satisfies PageLoad;
