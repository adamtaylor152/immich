<script lang="ts">
  import MenuOption from '$lib/components/shared-components/context-menu/MenuOption.svelte';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { eventManager } from '$lib/managers/event-manager.svelte';
  import { handleError } from '$lib/utils/handle-error';
  import { AssetImageEnrichmentAction, updateAssetImageEnrichment } from '@immich/sdk';
  import { IconButton, toastManager } from '@immich/ui';
  import { mdiShieldAlert, mdiShieldCheck, mdiTimerSand } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    assetIds?: string[];
    clearSelection?: boolean;
    markSafe?: boolean;
    menuItem?: boolean;
    onMark?: (assetIds: string[], action: AssetImageEnrichmentAction) => void | Promise<void>;
  }

  let { assetIds, clearSelection = true, markSafe = false, menuItem = false, onMark }: Props = $props();

  let action = $derived(markSafe ? AssetImageEnrichmentAction.MarkSafe : AssetImageEnrichmentAction.MarkNsfw);
  let text = $derived(markSafe ? $t('mark_safe') : $t('mark_nsfw'));
  let icon = $derived(markSafe ? mdiShieldCheck : mdiShieldAlert);
  let targetAssetIds = $derived(assetIds ?? assetMultiSelectManager.ownedAssets.map(({ id }) => id));
  let loading = $state(false);

  // Cap concurrent requests so a bulk-select of hundreds of assets doesn't
  // hammer the server simultaneously. Aggregate per-asset failures so a few
  // 5xx responses don't sink the whole batch.
  const MAX_CONCURRENCY = 5;

  const runWithConcurrency = async (
    items: readonly string[],
    worker: (id: string) => Promise<unknown>,
  ): Promise<{ succeeded: string[]; failed: string[] }> => {
    const succeeded: string[] = [];
    const failed: string[] = [];
    let cursor = 0;

    const run = async () => {
      while (cursor < items.length) {
        const index = cursor++;
        const id = items[index];
        try {
          await worker(id);
          succeeded.push(id);
        } catch (error) {
          failed.push(id);
          console.warn(`Failed to update enrichment for asset ${id}`, error);
        }
      }
    };

    const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, items.length) }, () => run());
    await Promise.all(workers);
    return { succeeded, failed };
  };

  const handleMark = async () => {
    const ids = targetAssetIds;

    if (ids.length === 0) {
      return;
    }

    loading = true;

    try {
      const { succeeded, failed } = await runWithConcurrency(ids, (id) =>
        updateAssetImageEnrichment({
          id,
          assetImageEnrichmentActionRequestDto: { action },
        }),
      );

      if (action === AssetImageEnrichmentAction.MarkNsfw && succeeded.length > 0) {
        eventManager.emit('AssetsMarkNsfw', succeeded);
      }

      if (succeeded.length > 0) {
        await onMark?.(succeeded, action);
      }

      if (failed.length === 0) {
        toastManager.primary(
          $t(markSafe ? 'mark_safe_action_prompt' : 'mark_nsfw_action_prompt', { values: { count: succeeded.length } }),
        );
      } else if (succeeded.length === 0) {
        handleError(
          new Error(`All ${failed.length} updates failed`),
          $t('errors.unable_to_update_image_enrichment'),
        );
      } else {
        toastManager.primary(
          $t(markSafe ? 'mark_safe_action_partial' : 'mark_nsfw_action_partial', {
            values: { succeeded: succeeded.length, total: ids.length, failed: failed.length },
          }),
        );
      }

      if (clearSelection) {
        assetMultiSelectManager.clear();
      }
    } catch (error) {
      handleError(error, $t('errors.unable_to_update_image_enrichment'));
    } finally {
      loading = false;
    }
  };
</script>

{#if menuItem}
  <MenuOption {text} {icon} onClick={handleMark} />
{/if}

{#if !menuItem}
  {#if loading}
    <IconButton
      shape="round"
      color="secondary"
      variant="ghost"
      aria-label={$t('loading')}
      icon={mdiTimerSand}
      onclick={() => {}}
    />
  {:else}
    <IconButton shape="round" color="secondary" variant="ghost" aria-label={text} {icon} onclick={handleMark} />
  {/if}
{/if}
