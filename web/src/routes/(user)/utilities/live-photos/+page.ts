import { getLivePhotoCandidates } from '@immich/sdk';
import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

export const load = (async ({ url }) => {
  await authenticate(url);
  const $t = await getFormatter();

  return {
    candidates: await getLivePhotoCandidates(),
    meta: {
      title: $t('relink_live_photos'),
    },
  };
}) satisfies PageLoad;
