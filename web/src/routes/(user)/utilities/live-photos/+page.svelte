<script lang="ts">
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { getAssetMediaUrl } from '$lib/utils';
  import { handleError } from '$lib/utils/handle-error';
  import { AssetMediaSize, LivePhotoMatchConfidence, relinkLivePhotos, type LivePhotoCandidateDto } from '@immich/sdk';
  import { Button, Icon, Text, toastManager } from '@immich/ui';
  import { mdiInformationOutline, mdiMotionPlayOutline, mdiPlayCircleOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  let candidates = $state<LivePhotoCandidateDto[]>(data.candidates.candidates);
  let isBusy = $state(false);

  const pairKey = (candidate: LivePhotoCandidateDto) => `${candidate.photo.id}:${candidate.video.id}`;
  const highConfidence = $derived(
    candidates.filter((candidate) => candidate.confidence === LivePhotoMatchConfidence.High),
  );

  const relink = async (pairs: LivePhotoCandidateDto[]) => {
    if (pairs.length === 0 || isBusy) {
      return;
    }

    isBusy = true;
    try {
      const { results } = await relinkLivePhotos({
        livePhotoRelinkDto: { pairs: pairs.map(({ photo, video }) => ({ photoId: photo.id, videoId: video.id })) },
      });

      const relinkedKeys = new Set(
        results.filter((result) => result.success).map((result) => `${result.photoId}:${result.videoId}`),
      );

      candidates = candidates.filter((candidate) => !relinkedKeys.has(pairKey(candidate)));

      if (relinkedKeys.size > 0) {
        toastManager.primary($t('live_photos_relinked_count', { values: { count: relinkedKeys.size } }));
      } else {
        handleError(new Error('No pairs were relinked'), $t('errors.something_went_wrong'));
      }
    } catch (error) {
      handleError(error, $t('errors.something_went_wrong'));
    } finally {
      isBusy = false;
    }
  };
</script>

<UserPageLayout title={data.meta.title}>
  <div class="m-auto mt-5 flex w-full max-w-4xl flex-col gap-4 px-2">
    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex flex-col gap-1">
        <Text size="large" fontWeight="bold">{$t('relink_live_photos')}</Text>
        <Text size="small" color="muted">{$t('relink_live_photos_description')}</Text>
      </div>

      {#if highConfidence.length > 0}
        <Button size="small" loading={isBusy} onclick={() => relink(highConfidence)}>
          <Icon icon={mdiMotionPlayOutline} size="20" />
          {$t('live_photos_relink_all', { values: { count: highConfidence.length } })}
        </Button>
      {/if}
    </div>

    {#if candidates.length === 0}
      <div class="rounded-3xl border border-gray-300 p-8 text-center dark:border-immich-dark-gray">
        <Text color="muted">{$t('live_photos_no_candidates')}</Text>
      </div>
    {:else}
      <div class="flex flex-col gap-3">
        {#each candidates as candidate (pairKey(candidate))}
          {@const isHigh = candidate.confidence === LivePhotoMatchConfidence.High}
          <div class="flex items-center gap-4 rounded-2xl border border-gray-300 p-3 dark:border-immich-dark-gray">
            <div class="flex shrink-0 gap-2">
              <img
                src={getAssetMediaUrl({ id: candidate.photo.id, size: AssetMediaSize.Preview })}
                alt={candidate.photo.originalFileName}
                class="size-20 rounded-lg object-cover"
                draggable="false"
              />
              <div class="relative">
                <img
                  src={getAssetMediaUrl({ id: candidate.video.id, size: AssetMediaSize.Preview })}
                  alt={candidate.video.originalFileName}
                  class="size-20 rounded-lg object-cover"
                  draggable="false"
                />
                <div class="absolute inset-0 flex items-center justify-center">
                  <Icon icon={mdiPlayCircleOutline} size="28" class="text-white drop-shadow-sm" />
                </div>
              </div>
            </div>

            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <Text size="small" class="truncate" title={candidate.photo.originalFileName}>
                {candidate.photo.originalFileName}
              </Text>
              <Text size="small" color="muted" class="truncate" title={candidate.video.originalFileName}>
                {candidate.video.originalFileName}
              </Text>
              <span
                class="mt-1 w-fit rounded-full px-2 py-0.5 text-xs {isHigh
                  ? 'bg-success/15 text-success'
                  : 'bg-warning/15 text-warning'}"
              >
                {isHigh ? $t('live_photos_confidence_high') : $t('live_photos_confidence_low')}
              </span>
            </div>

            <Button
              size="small"
              variant={isHigh ? 'filled' : 'outline'}
              loading={isBusy}
              onclick={() => relink([candidate])}
            >
              {$t('live_photos_relink')}
            </Button>
          </div>
        {/each}
      </div>

      {#if candidates.some((candidate) => candidate.confidence === LivePhotoMatchConfidence.Low)}
        <div class="flex items-start gap-2 px-1">
          <Icon icon={mdiInformationOutline} size="18" class="mt-0.5 shrink-0 text-warning" />
          <Text size="small" color="muted">{$t('live_photos_low_confidence_hint')}</Text>
        </div>
      {/if}
    {/if}
  </div>
</UserPageLayout>
