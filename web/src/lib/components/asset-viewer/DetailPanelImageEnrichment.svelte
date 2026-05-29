<script lang="ts">
  import { handlePromiseError } from '$lib/utils';
  import { handleError } from '$lib/utils/handle-error';
  import {
    AssetImageEnrichmentAction,
    AssetTypeEnum,
    getAssetImageEnrichment,
    getAssetInfo,
    isHttpError,
    updateAssetImageEnrichment,
    type AssetImageEnrichmentResponseDto,
    type AssetResponseDto,
  } from '@immich/sdk';
  import { Button, LoadingSpinner, Text, toastManager } from '@immich/ui';
  import { mdiBroom, mdiCheckCircleOutline, mdiRefresh, mdiShieldAlert, mdiShieldCheck, mdiTagRemove } from '@mdi/js';
  import { onDestroy } from 'svelte';
  import { t } from 'svelte-i18n';

  interface Props {
    asset: AssetResponseDto;
    isOwner: boolean;
    isAdmin: boolean;
    onAssetRefresh?: (asset: AssetResponseDto) => void;
    onAssetSuppressed?: (asset: AssetResponseDto) => void | Promise<void>;
  }

  let { asset, isOwner, isAdmin, onAssetRefresh, onAssetSuppressed }: Props = $props();

  let enrichment = $state<AssetImageEnrichmentResponseDto>();
  let isLoading = $state(false);
  let activeAction = $state<AssetImageEnrichmentAction | null>(null);
  let canReview = $derived(isOwner && isAdmin && asset.type === AssetTypeEnum.Image);
  // Track the in-flight enrichment fetch so we can abort it when the user
  // swipes to a new asset before the previous request resolved.
  let enrichmentController: AbortController | undefined;

  const loadEnrichment = async (assetId: string) => {
    // Cancel any previous in-flight enrichment request — when the user
    // rapidly swipes through assets, the previous fetch should be aborted
    // rather than allowed to run to completion and consume bandwidth.
    enrichmentController?.abort();
    const controller = new AbortController();
    enrichmentController = controller;
    isLoading = true;
    try {
      const result = await getAssetImageEnrichment({ id: assetId }, { signal: controller.signal });
      if (asset.id === assetId && !controller.signal.aborted) {
        enrichment = result;
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        handleError(error, $t('errors.unable_to_load_image_enrichment'));
      }
    } finally {
      if (asset.id === assetId && enrichmentController === controller) {
        isLoading = false;
        enrichmentController = undefined;
      }
    }
  };

  const refreshAsset = async () => {
    const updatedAsset = await getAssetInfo({ id: asset.id });
    onAssetRefresh?.(updatedAsset);
  };

  const getHttpStatus = (error: unknown) => (isHttpError(error) ? (error.status ?? error.data?.statusCode) : undefined);

  const handleExpectedSuppressedAsset = async (action: AssetImageEnrichmentAction, error: unknown) => {
    if (!onAssetSuppressed || !enrichment?.nsfwDetection.effectiveIsNsfw) {
      return false;
    }

    if (
      action !== AssetImageEnrichmentAction.MarkNsfw &&
      action !== AssetImageEnrichmentAction.AcceptNsfwResult &&
      action !== AssetImageEnrichmentAction.RerunNsfwDetection
    ) {
      return false;
    }

    const status = getHttpStatus(error);
    if (status !== 400 && status !== 403 && status !== 404) {
      return false;
    }

    await onAssetSuppressed(asset);
    return true;
  };

  const refreshVisibleAsset = async (action: AssetImageEnrichmentAction) => {
    try {
      await refreshAsset();
    } catch (error) {
      if (await handleExpectedSuppressedAsset(action, error)) {
        return;
      }

      throw error;
    }
  };

  const runAction = async (action: AssetImageEnrichmentAction) => {
    activeAction = action;
    try {
      enrichment = await updateAssetImageEnrichment({
        id: asset.id,
        assetImageEnrichmentActionRequestDto: { action },
      });

      if (
        action === AssetImageEnrichmentAction.ClearGeneratedDescription ||
        action === AssetImageEnrichmentAction.ClearGeneratedTags ||
        action === AssetImageEnrichmentAction.RerunNsfwDetection ||
        action === AssetImageEnrichmentAction.MarkSafe ||
        action === AssetImageEnrichmentAction.MarkNsfw ||
        action === AssetImageEnrichmentAction.AcceptNsfwResult
      ) {
        await refreshVisibleAsset(action);
      }

      toastManager.primary($t('image_enrichment_updated'));
    } catch (error) {
      handleError(error, $t('errors.unable_to_update_image_enrichment'));
    } finally {
      activeAction = null;
    }
  };

  const statusText = (status: string) => {
    switch (status) {
      case 'success': {
        return $t('success');
      }
      case 'failed': {
        return $t('failed');
      }
      default: {
        return $t('missing');
      }
    }
  };

  const formatPercent = (value?: number) => (value === undefined ? undefined : `${Math.round(value * 100)}%`);

  const safeNsfwLabels = new Set(['normal', 'safe', 'sfw', 'neutral']);

  const labelSummary = (labels?: Record<string, number>, nsfwOnly = false) => {
    if (!labels) {
      return;
    }

    const entries = Object.entries(labels)
      .filter(([label]) => !nsfwOnly || !safeNsfwLabels.has(label.toLowerCase()))
      .sort(([, left], [, right]) => right - left)
      .slice(0, 3);

    if (entries.length === 0) {
      return;
    }

    return entries.map(([label, score]) => `${label} ${formatPercent(score)}`).join(', ');
  };

  const nsfwStatusText = () => {
    if (!enrichment || enrichment.nsfwDetection.status !== 'success') {
      return statusText(enrichment?.nsfwDetection.status ?? 'missing');
    }

    const summary =
      labelSummary(enrichment.nsfwDetection.labels, enrichment.nsfwDetection.effectiveIsNsfw) ??
      labelSummary(enrichment.nsfwDetection.labels);

    return summary ?? statusText(enrichment.nsfwDetection.status);
  };

  $effect(() => {
    if (canReview) {
      handlePromiseError(loadEnrichment(asset.id));
    }
  });

  // Abort any in-flight enrichment fetch when the panel unmounts. Without
  // this, the request runs to completion (defeating the bandwidth-saving
  // intent of the AbortController) and writes back into a destroyed component.
  onDestroy(() => {
    enrichmentController?.abort();
    enrichmentController = undefined;
  });
</script>

{#if canReview}
  <section class="mt-4 px-4">
    <div class="flex h-10 w-full items-center justify-between text-sm">
      <Text color="muted">{$t('image_enrichment')}</Text>
      {#if isLoading}
        <LoadingSpinner />
      {/if}
    </div>

    {#if enrichment}
      <div class="space-y-4 text-sm">
        <div class="space-y-2 rounded-md border border-gray-200 p-3 dark:border-gray-700">
          <div class="flex items-start justify-between gap-2">
            <div>
              <p class="font-medium">{$t('image_description')}</p>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {statusText(enrichment.description.status)}
              </p>
            </div>
          </div>

          {#if enrichment.description.error}
            <p class="text-xs text-red-600 dark:text-red-400">{enrichment.description.error}</p>
          {/if}

          <div class="flex flex-wrap gap-2">
            <Button
              size="small"
              color="secondary"
              variant="ghost"
              leadingIcon={mdiRefresh}
              loading={activeAction === AssetImageEnrichmentAction.RerunImageDescription}
              onclick={() => runAction(AssetImageEnrichmentAction.RerunImageDescription)}
            >
              {$t('rerun')}
            </Button>
            <Button
              size="small"
              color="secondary"
              variant="ghost"
              leadingIcon={mdiBroom}
              disabled={!enrichment.description.appliedDescription}
              loading={activeAction === AssetImageEnrichmentAction.ClearGeneratedDescription}
              onclick={() => runAction(AssetImageEnrichmentAction.ClearGeneratedDescription)}
            >
              {$t('clear_description')}
            </Button>
            <Button
              size="small"
              color="secondary"
              variant="ghost"
              leadingIcon={mdiTagRemove}
              disabled={!enrichment.description.appliedTags && !enrichment.nsfwDetection.appliedTags}
              loading={activeAction === AssetImageEnrichmentAction.ClearGeneratedTags}
              onclick={() => runAction(AssetImageEnrichmentAction.ClearGeneratedTags)}
            >
              {$t('clear_tags')}
            </Button>
          </div>
        </div>

        <div class="space-y-2 rounded-md border border-gray-200 p-3 dark:border-gray-700">
          <div>
            <p class="font-medium">{$t('admin.machine_learning_nsfw_detection')}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {nsfwStatusText()}
            </p>
          </div>

          <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-gray-300">
            <span>
              {$t('nsfw')}: {enrichment.nsfwDetection.effectiveIsNsfw ? $t('yes') : $t('no')}
            </span>
            {#if enrichment.nsfwDetection.score !== undefined}
              <span>{$t('score')}: {formatPercent(enrichment.nsfwDetection.score)}</span>
            {/if}
            {#if enrichment.nsfwDetection.review}
              <span>{$t('reviewed')}</span>
            {/if}
          </div>

          {#if enrichment.nsfwDetection.error}
            <p class="text-xs text-red-600 dark:text-red-400">{enrichment.nsfwDetection.error}</p>
          {/if}

          {#if enrichment.nsfwDetection.labels}
            <div class="flex flex-wrap gap-1">
              {#each Object.entries(enrichment.nsfwDetection.labels).slice(0, 5) as [label, score] (label)}
                <span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-700">
                  {label}
                  {formatPercent(score)}
                </span>
              {/each}
            </div>
          {/if}

          <div class="flex flex-wrap gap-2">
            <Button
              size="small"
              color="secondary"
              variant="ghost"
              leadingIcon={mdiRefresh}
              loading={activeAction === AssetImageEnrichmentAction.RerunNsfwDetection}
              onclick={() => runAction(AssetImageEnrichmentAction.RerunNsfwDetection)}
            >
              {$t('rerun')}
            </Button>
            <Button
              size="small"
              color="secondary"
              variant="ghost"
              leadingIcon={mdiCheckCircleOutline}
              disabled={enrichment.nsfwDetection.status === 'missing'}
              loading={activeAction === AssetImageEnrichmentAction.AcceptNsfwResult}
              onclick={() => runAction(AssetImageEnrichmentAction.AcceptNsfwResult)}
            >
              {$t('accept')}
            </Button>
            <Button
              size="small"
              color="secondary"
              variant="ghost"
              leadingIcon={mdiShieldCheck}
              loading={activeAction === AssetImageEnrichmentAction.MarkSafe}
              onclick={() => runAction(AssetImageEnrichmentAction.MarkSafe)}
            >
              {$t('mark_safe')}
            </Button>
            <Button
              size="small"
              color="secondary"
              variant="ghost"
              leadingIcon={mdiShieldAlert}
              loading={activeAction === AssetImageEnrichmentAction.MarkNsfw}
              onclick={() => runAction(AssetImageEnrichmentAction.MarkNsfw)}
            >
              {$t('mark_nsfw')}
            </Button>
          </div>
        </div>
      </div>
    {/if}
  </section>
{/if}
