<script lang="ts">
  import MenuOption from '$lib/components/shared-components/context-menu/MenuOption.svelte';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
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

  const handleMark = async () => {
    const ids = targetAssetIds;

    if (ids.length === 0) {
      return;
    }

    loading = true;

    try {
      await Promise.all(
        ids.map((id) =>
          updateAssetImageEnrichment({
            id,
            assetImageEnrichmentActionRequestDto: { action },
          }),
        ),
      );

      await onMark?.(ids, action);

      toastManager.primary(
        $t(markSafe ? 'mark_safe_action_prompt' : 'mark_nsfw_action_prompt', { values: { count: ids.length } }),
      );
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
