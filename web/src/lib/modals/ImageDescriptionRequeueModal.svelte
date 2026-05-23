<script lang="ts">
  import { handleError } from '$lib/utils/handle-error';
  import {
    getImageDescriptionRequeueEstimate,
    triggerImageDescriptionRequeue,
    type ImageDescriptionRequeueEstimateDto,
  } from '@immich/sdk';
  import { Button, LoadingSpinner, Modal, ModalBody, ModalFooter } from '@immich/ui';
  import { t } from 'svelte-i18n';

  interface Props {
    // Resolves with the trigger response on success (queued=true → newly enqueued,
    // queued=false → a re-queue job was already in-flight). Resolves with undefined
    // when the user cancels or the estimate fetch fails.
    onClose: (result?: { queued: boolean }) => void;
  }

  let { onClose }: Props = $props();

  let estimate = $state<ImageDescriptionRequeueEstimateDto | undefined>(undefined);
  let loadError = $state<string | undefined>(undefined);
  let isTriggering = $state(false);

  const formatDuration = (seconds: number): string => {
    if (seconds < 60) {
      return `${Math.round(seconds)}s`;
    }
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }
    return `${minutes}m`;
  };

  const loadEstimate = async () => {
    try {
      estimate = await getImageDescriptionRequeueEstimate();
    } catch (error) {
      loadError = $t('admin.machine_learning_image_description_requeue_modal_error');
      handleError(error, $t('admin.machine_learning_image_description_requeue_modal_error'));
    }
  };

  const handleRequeue = async () => {
    isTriggering = true;
    try {
      const result = await triggerImageDescriptionRequeue();
      onClose(result);
    } catch (error) {
      handleError(error, $t('admin.machine_learning_image_description_requeue_modal_error'));
    } finally {
      isTriggering = false;
    }
  };
</script>

<Modal title={$t('admin.machine_learning_image_description_requeue_modal_title')} {onClose} size="small">
  <ModalBody>
    {#await loadEstimate()}
      <div class="flex w-full place-content-center place-items-center py-8">
        <LoadingSpinner />
      </div>
      <p class="text-center text-sm text-immich-fg/60 dark:text-immich-dark-fg/60">
        {$t('admin.machine_learning_image_description_requeue_modal_loading')}
      </p>
    {:then _}
      {#if loadError}
        <p class="py-4 text-sm text-red-500">{loadError}</p>
      {:else if estimate}
        <dl class="flex flex-col gap-3 text-sm">
          <div class="flex justify-between">
            <dt class="text-immich-fg/70 dark:text-immich-dark-fg/70">
              {$t('admin.machine_learning_image_description_requeue_modal_total_assets')}
            </dt>
            <dd class="font-medium">{estimate.totalAssets.toLocaleString()}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-immich-fg/70 dark:text-immich-dark-fg/70">
              {$t('admin.machine_learning_image_description_requeue_modal_with_description')}
            </dt>
            <dd class="font-medium">{estimate.withDescription.toLocaleString()}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-immich-fg/70 dark:text-immich-dark-fg/70">
              {$t('admin.machine_learning_image_description_requeue_modal_without_description')}
            </dt>
            <dd class="font-medium">{estimate.withoutDescription.toLocaleString()}</dd>
          </div>
          <hr class="border-primary/20" />
          <div class="flex justify-between">
            <dt class="text-immich-fg/70 dark:text-immich-dark-fg/70">
              {$t('admin.machine_learning_image_description_requeue_modal_rolling_avg')}
            </dt>
            <dd class="font-medium">{estimate.rollingAvgSeconds.toFixed(1)}s</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-immich-fg/70 dark:text-immich-dark-fg/70">
              {$t('admin.machine_learning_image_description_requeue_modal_estimated_total')}
            </dt>
            <dd class="font-medium">{formatDuration(estimate.estimatedTotalSeconds)}</dd>
          </div>
          <hr class="border-primary/20" />
          <div class="flex justify-between">
            <dt class="text-immich-fg/70 dark:text-immich-dark-fg/70">
              {$t('admin.machine_learning_image_description_requeue_modal_active_backend')}
            </dt>
            <dd class="font-mono text-xs font-medium">{estimate.activeBackend}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-immich-fg/70 dark:text-immich-dark-fg/70">
              {$t('admin.machine_learning_image_description_requeue_modal_active_model')}
            </dt>
            <dd class="font-mono text-xs font-medium">{estimate.activeModel}</dd>
          </div>
        </dl>
      {/if}
    {/await}
  </ModalBody>

  <ModalFooter>
    <div class="flex w-full justify-end gap-2">
      <Button shape="round" color="secondary" onclick={() => onClose()} disabled={isTriggering}>
        {$t('cancel')}
      </Button>
      <Button shape="round" color="primary" onclick={handleRequeue} disabled={isTriggering || !!loadError || !estimate}>
        {#if isTriggering}
          <LoadingSpinner size="tiny" />
        {/if}
        {$t('admin.machine_learning_image_description_requeue_modal_confirm')}
      </Button>
    </div>
  </ModalFooter>
</Modal>
