import { list as listMediaHealth, MediaHealthCategory, MediaHealthStatus } from '@immich/sdk';
import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

export const load = (async ({ url }) => {
  await authenticate(url, { admin: true });
  const $t = await getFormatter();
  const requestedStatus = url.searchParams.get('status');
  const status = Object.values(MediaHealthStatus).includes(requestedStatus as MediaHealthStatus)
    ? (requestedStatus as MediaHealthStatus)
    : undefined;

  return {
    mediaHealth: await listMediaHealth({ category: MediaHealthCategory.Corrupt, status, size: 200 }),
    status,
    meta: {
      title: $t('review_corrupt_media'),
    },
  };
}) satisfies PageLoad;
