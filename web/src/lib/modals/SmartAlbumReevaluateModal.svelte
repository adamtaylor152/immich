<script lang="ts">
  import { handleError } from '$lib/utils/handle-error';
  import {
    getSmartAlbumReevaluateEstimate,
    triggerSmartAlbumReevaluate,
    type SmartAlbumReevaluateEstimateDto,
  } from '@immich/sdk';
  import { Button, LoadingSpinner, Modal, ModalBody, ModalFooter } from '@immich/ui';
  import { t } from 'svelte-i18n';

  interface Props {
    // Resolves with the trigger response on success. Resolves with undefined
    // when the user cancels or the estimate fetch fails.
    onClose: (result?: { queued: boolean }) => void;
    // Optional built-in kind to scope the re-evaluation to (e.g. "food").
    // When omitted, the job runs against every enabled kind.
    kind?: string;
    // Human-readable name of the scoped kind, shown in the modal title and
    // descriptive copy (e.g. "Food"). Falls back to the raw kind id.
    kindLabel?: string;
  }

  let { onClose, kind, kindLabel }: Props = $props();

  let estimate = $state<SmartAlbumReevaluateEstimateDto | undefined>(undefined);
  let loadError = $state<string | undefined>(undefined);
  let isTriggering = $state(false);

  const loadEstimate = async () => {
    try {
      estimate = await getSmartAlbumReevaluateEstimate();
    } catch (error) {
      loadError = $t('admin.smart_albums_reevaluate_modal_error');
      handleError(error, $t('admin.smart_albums_reevaluate_modal_error'));
    }
  };

  // Hoist out of the markup so Svelte 5 doesn't re-invoke loadEstimate on
  // every reactive update to the await block.
  const estimatePromise = loadEstimate();

  const handleReevaluate = async () => {
    isTriggering = true;
    try {
      const result = await triggerSmartAlbumReevaluate({
        smartAlbumReevaluateRequestDto: kind ? { kind } : {},
      });
      onClose(result);
    } catch (error) {
      handleError(error, $t('admin.smart_albums_reevaluate_modal_trigger_error'));
    } finally {
      isTriggering = false;
    }
  };

  const modalTitle = $derived(
    kind
      ? $t('admin.smart_albums_reevaluate_modal_title_for_kind', { values: { kind: kindLabel ?? kind } })
      : $t('admin.smart_albums_reevaluate_modal_title'),
  );
</script>

<Modal title={modalTitle} {onClose} size="small">
  <ModalBody>
    {#await estimatePromise}
      <div class="flex w-full place-content-center place-items-center py-8">
        <LoadingSpinner />
      </div>
      <p class="text-center text-sm text-immich-fg/60 dark:text-immich-dark-fg/60">
        {$t('admin.smart_albums_reevaluate_modal_loading')}
      </p>
    {:then _}
      {#if loadError}
        <p class="py-4 text-sm text-red-500">{loadError}</p>
      {:else if estimate}
        <dl class="flex flex-col gap-3 text-sm">
          <div class="flex justify-between">
            <dt class="text-immich-fg/70 dark:text-immich-dark-fg/70">
              {$t('admin.smart_albums_reevaluate_modal_eligible_assets')}
            </dt>
            <dd class="font-medium">{estimate.totalAssets.toLocaleString()}</dd>
          </div>
        </dl>
        <p class="mt-4 text-sm text-immich-fg/60 dark:text-immich-dark-fg/60">
          {$t('admin.smart_albums_reevaluate_modal_description')}
        </p>
      {/if}
    {/await}
  </ModalBody>

  <ModalFooter>
    <div class="flex w-full justify-end gap-2">
      <Button shape="round" color="secondary" onclick={() => onClose()} disabled={isTriggering}>
        {$t('cancel')}
      </Button>
      <Button
        shape="round"
        color="primary"
        onclick={handleReevaluate}
        disabled={isTriggering || !!loadError || !estimate}
      >
        {#if isTriggering}
          <LoadingSpinner size="tiny" />
        {/if}
        {$t('admin.smart_albums_reevaluate_modal_confirm')}
      </Button>
    </div>
  </ModalFooter>
</Modal>
