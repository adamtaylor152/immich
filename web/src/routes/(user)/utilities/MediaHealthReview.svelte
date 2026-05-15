<script lang="ts">
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { Route } from '$lib/route';
  import { getAssetMediaUrl } from '$lib/utils';
  import { handleError } from '$lib/utils/handle-error';
  import {
    AssetMediaSize,
    deleteCorrupt,
    dismiss as dismissMediaHealth,
    getAuthStatus,
    list as listMediaHealth,
    locateMissing,
    MediaHealthCategory,
    MediaHealthSeverity,
    MediaHealthStatus,
    relinkMissing,
    startCorruptScan,
    startMissingScan,
    type MediaHealthItemDto,
    type MediaHealthListResponseDto,
  } from '@immich/sdk';
  import { Button, Icon, LoadingSpinner, Text, toastManager } from '@immich/ui';
  import {
    mdiAlertOctagonOutline,
    mdiCheckCircleOutline,
    mdiCloseCircleOutline,
    mdiLinkVariant,
    mdiMagnify,
    mdiRefresh,
    mdiTrashCanOutline,
  } from '@mdi/js';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { t } from 'svelte-i18n';

  const DELETE_CONFIRM_TEXT = 'MOVE CORRUPT MEDIA TO TRASH';
  const PAGE_SIZE = 200;

  interface Props {
    category: MediaHealthCategory;
    initial: MediaHealthListResponseDto;
    initialStatus?: MediaHealthStatus;
    title: string;
  }

  let { category, initial, initialStatus, title }: Props = $props();

  let mediaHealth = $state(initial);
  let statusFilter = $state<MediaHealthStatus | ''>(initialStatus ?? '');
  let selectedIds = $state<string[]>([]);
  let isBusy = $state(false);
  let showDeleteDialog = $state(false);
  let deleteConfirmationText = $state('');

  const isMissing = $derived(category === MediaHealthCategory.Missing);
  const isCorrupt = $derived(category === MediaHealthCategory.Corrupt);
  const selectedCount = $derived(selectedIds.length);
  const allItems = $derived(mediaHealth.buckets.flatMap((bucket) => bucket.items));
  const selectableIds = $derived(allItems.map((item) => item.id));
  const allSelected = $derived(selectableIds.length > 0 && selectedIds.length === selectableIds.length);
  const hasFindings = $derived(mediaHealth.total > 0);
  const selectedDeleteCount = $derived(
    allItems.filter((item) => selectedIds.includes(item.id) && item.status === MediaHealthStatus.CorruptConfirmed)
      .length,
  );

  const statusOptions = $derived(
    isMissing
      ? [
          MediaHealthStatus.Missing,
          MediaHealthStatus.Candidate,
          MediaHealthStatus.Found,
          MediaHealthStatus.Relinked,
          MediaHealthStatus.Resolved,
          MediaHealthStatus.Dismissed,
        ]
      : [
          MediaHealthStatus.CorruptConfirmed,
          MediaHealthStatus.CorruptSuspect,
          MediaHealthStatus.UnsupportedRaw,
          MediaHealthStatus.TrashQueued,
          MediaHealthStatus.Trashed,
          MediaHealthStatus.DeleteQueued,
          MediaHealthStatus.Deleted,
          MediaHealthStatus.Resolved,
          MediaHealthStatus.Dismissed,
        ],
  );

  const refresh = async () => {
    mediaHealth = await listMediaHealth({
      category,
      size: PAGE_SIZE,
      status: statusFilter || undefined,
    });
    const available = new Set(mediaHealth.buckets.flatMap((bucket) => bucket.items.map((item) => item.id)));
    selectedIds = selectedIds.filter((id) => available.has(id));
  };

  const runAction = async (action: () => Promise<unknown>, successMessage: string) => {
    isBusy = true;
    try {
      await action();
      toastManager.primary(successMessage);
      await refresh();
    } catch (error) {
      handleError(error, $t('errors.something_went_wrong'));
    } finally {
      isBusy = false;
    }
  };

  const handleScan = () =>
    runAction(
      () => (isMissing ? startMissingScan() : startCorruptScan()),
      isMissing ? $t('media_health_missing_scan_started') : $t('media_health_corrupt_scan_started'),
    );

  const handleLocate = () =>
    runAction(
      () => locateMissing({ mediaHealthBulkActionDto: { ids: selectedIds } }),
      $t('media_health_locate_started'),
    );

  const handleRelink = () =>
    runAction(
      () => relinkMissing({ mediaHealthBulkActionDto: { ids: selectedIds } }),
      $t('media_health_relink_started'),
    );

  const handleDismiss = () =>
    runAction(
      () => dismissMediaHealth({ mediaHealthBulkActionDto: { ids: selectedIds } }),
      $t('media_health_dismissed'),
    );

  const beginDelete = async () => {
    const status = await getAuthStatus();
    if (status.pinCode && !status.isElevated) {
      await goto(Route.pinPrompt({ continue: page.url.pathname + page.url.search }));
      return;
    }

    deleteConfirmationText = '';
    showDeleteDialog = true;
  };

  const confirmDelete = async () => {
    if (deleteConfirmationText !== DELETE_CONFIRM_TEXT) {
      return;
    }

    showDeleteDialog = false;
    await runAction(
      () =>
        deleteCorrupt({
          mediaHealthDeleteCorruptDto: {
            ids: selectedIds,
            confirmText: DELETE_CONFIRM_TEXT,
          },
        }),
      $t('media_health_delete_queued'),
    );
  };

  const handleStatusChange = () => refresh();

  const toggle = (id: string) => {
    selectedIds = selectedIds.includes(id)
      ? selectedIds.filter((selectedId) => selectedId !== id)
      : [...selectedIds, id];
  };

  const toggleAll = () => {
    selectedIds = allSelected ? [] : selectableIds;
  };

  const statusLabel = (status: MediaHealthStatus) => {
    switch (status) {
      case MediaHealthStatus.Candidate: {
        return $t('media_health_status_candidate');
      }
      case MediaHealthStatus.CorruptConfirmed: {
        return $t('media_health_status_corrupt_confirmed');
      }
      case MediaHealthStatus.CorruptSuspect: {
        return $t('media_health_status_corrupt_suspect');
      }
      case MediaHealthStatus.Trashed: {
        return $t('media_health_status_trashed');
      }
      case MediaHealthStatus.TrashQueued: {
        return $t('media_health_status_trash_queued');
      }
      case MediaHealthStatus.Deleted: {
        return $t('media_health_status_deleted');
      }
      case MediaHealthStatus.DeleteQueued: {
        return $t('media_health_status_delete_queued');
      }
      case MediaHealthStatus.Dismissed: {
        return $t('media_health_status_dismissed');
      }
      case MediaHealthStatus.Found: {
        return $t('media_health_status_found');
      }
      case MediaHealthStatus.Missing: {
        return $t('media_health_status_missing');
      }
      case MediaHealthStatus.Relinked: {
        return $t('media_health_status_relinked');
      }
      case MediaHealthStatus.Resolved: {
        return $t('media_health_status_resolved');
      }
      case MediaHealthStatus.UnsupportedRaw: {
        return $t('media_health_status_unsupported_raw');
      }
    }
  };

  const severityClass = (severity: MediaHealthSeverity) => {
    switch (severity) {
      case MediaHealthSeverity.Critical: {
        return 'bg-danger/10 text-danger border-danger/30';
      }
      case MediaHealthSeverity.Warning: {
        return 'bg-warning/10 text-warning border-warning/40';
      }
      default: {
        return 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600';
      }
    }
  };

  const evidenceText = (item: MediaHealthItemDto) => {
    const reason = item.evidence.reason;
    const error = item.evidence.error;
    if (typeof error === 'string') {
      return error;
    }
    return typeof reason === 'string' ? reason : JSON.stringify(item.evidence);
  };

  const candidateSummary = (item: MediaHealthItemDto) => {
    const found = item.candidates.filter((candidate) => candidate.status === MediaHealthStatus.Found).length;
    if (found > 0) {
      return $t('media_health_candidate_found_count', { values: { count: found } });
    }
    return item.candidates.length > 0
      ? $t('media_health_candidate_count', { values: { count: item.candidates.length } })
      : $t('media_health_no_candidates');
  };

  const formatScore = (score: number | null) => (score === null ? $t('none') : `${Math.round(score * 100)}%`);
</script>

<UserPageLayout title={`${title} (${mediaHealth.total})`} scrollbar={true}>
  {#snippet buttons()}
    <div class="flex flex-wrap items-center justify-end gap-2">
      <label class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
        <span class="hidden sm:inline">{$t('status')}</span>
        <select
          class="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-immich-dark-gray dark:bg-immich-dark-gray"
          bind:value={statusFilter}
          onchange={handleStatusChange}
          disabled={isBusy}
        >
          <option value="">{$t('all')}</option>
          {#each statusOptions as status (status)}
            <option value={status}>{statusLabel(status)}</option>
          {/each}
        </select>
      </label>

      <Button
        size="small"
        color="secondary"
        variant="ghost"
        leadingIcon={mdiRefresh}
        onclick={handleScan}
        disabled={isBusy}
      >
        <Text class="hidden sm:inline-block">{$t('scan')}</Text>
      </Button>

      {#if hasFindings}
        <Button size="small" color="secondary" variant="ghost" onclick={toggleAll} disabled={isBusy}>
          <Text class="hidden sm:inline-block">{allSelected ? $t('unselect_all') : $t('select_all')}</Text>
        </Button>
      {/if}

      {#if isMissing}
        <Button
          size="small"
          color="secondary"
          variant="ghost"
          leadingIcon={mdiMagnify}
          onclick={handleLocate}
          disabled={isBusy || selectedCount === 0}
        >
          <Text class="hidden sm:inline-block">{$t('media_health_locate')}</Text>
        </Button>
        <Button
          size="small"
          color="primary"
          variant="ghost"
          leadingIcon={mdiLinkVariant}
          onclick={handleRelink}
          disabled={isBusy || selectedCount === 0}
        >
          <Text class="hidden sm:inline-block">{$t('media_health_relink')}</Text>
        </Button>
      {/if}

      {#if isCorrupt}
        <Button
          size="small"
          color="danger"
          variant="ghost"
          leadingIcon={mdiTrashCanOutline}
          onclick={beginDelete}
          disabled={isBusy || selectedDeleteCount === 0}
        >
          <Text class="hidden sm:inline-block">{$t('media_health_delete_corrupt')}</Text>
        </Button>
      {/if}

      <Button
        size="small"
        color="secondary"
        variant="ghost"
        leadingIcon={mdiCloseCircleOutline}
        onclick={handleDismiss}
        disabled={isBusy || selectedCount === 0}
      >
        <Text class="hidden sm:inline-block">{$t('media_health_dismiss')}</Text>
      </Button>
    </div>
  {/snippet}

  {#if isCorrupt}
    <div class="mx-auto mb-5 max-w-6xl rounded-lg border border-danger/30 bg-danger/10 p-4 text-danger">
      <div class="flex items-start gap-3">
        <Icon icon={mdiAlertOctagonOutline} size="24" />
        <div>
          <Text fontWeight="bold">{$t('media_health_corrupt_warning_title')}</Text>
          <p class="mt-1 text-sm text-gray-700 dark:text-gray-200">{$t('media_health_corrupt_warning_body')}</p>
        </div>
      </div>
    </div>
  {/if}

  {#if mediaHealth.run}
    <div
      class="mx-auto mb-5 flex max-w-6xl flex-wrap gap-3 rounded-lg border border-gray-200 p-4 text-sm dark:border-immich-dark-gray"
    >
      <span>{$t('media_health_last_run')}: {mediaHealth.run.startedAt}</span>
      <span>{$t('status')}: {mediaHealth.run.status}</span>
      <span>{$t('media_health_checked_count', { values: { count: mediaHealth.run.checkedAssets } })}</span>
      <span>{$t('media_health_found_count', { values: { count: mediaHealth.run.foundAssets } })}</span>
    </div>
  {/if}

  {#if isBusy}
    <div class="flex h-32 items-center justify-center">
      <LoadingSpinner size="large" />
    </div>
  {/if}

  {#if !hasFindings}
    <div class="mx-auto mt-20 max-w-xl text-center">
      <Icon
        icon={isMissing ? mdiCheckCircleOutline : mdiAlertOctagonOutline}
        size="48"
        class="mx-auto mb-4 text-primary"
      />
      <Text size="large" fontWeight="bold">{$t('media_health_empty_title')}</Text>
      <p class="mt-2 text-sm text-gray-600 dark:text-gray-300">
        {isMissing ? $t('media_health_missing_empty_body') : $t('media_health_corrupt_empty_body')}
      </p>
    </div>
  {:else}
    <div class="mx-auto max-w-6xl space-y-8 pb-16">
      {#each mediaHealth.buckets as bucket (bucket.timeBucket)}
        <section>
          <div class="sticky top-0 z-10 mb-3 flex items-center gap-3 bg-immich-bg/95 py-2 dark:bg-immich-dark-bg/95">
            <Text fontWeight="bold">{bucket.timeBucket}</Text>
            <Text size="tiny" color="muted">{$t('media_health_bucket_count', { values: { count: bucket.count } })}</Text
            >
          </div>

          <div class="space-y-3">
            {#each bucket.items as item (item.id)}
              <article
                class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm dark:border-immich-dark-gray dark:bg-gray-800"
              >
                <div class="flex gap-3">
                  <label class="mt-1">
                    <input
                      type="checkbox"
                      class="size-4"
                      checked={selectedIds.includes(item.id)}
                      onchange={() => toggle(item.id)}
                      aria-label={$t('media_health_select_finding')}
                    />
                  </label>

                  <a
                    href={Route.viewAsset({ id: item.assetId })}
                    class="block size-24 shrink-0 overflow-hidden rounded-md bg-gray-100 dark:bg-gray-700"
                  >
                    <img
                      src={getAssetMediaUrl({
                        id: item.assetId,
                        size: AssetMediaSize.Thumbnail,
                        cacheKey: item.asset.thumbhash,
                      })}
                      alt={item.originalFileName}
                      class="size-full object-cover"
                      loading="lazy"
                    />
                  </a>

                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <Text fontWeight="bold" class="truncate">{item.originalFileName}</Text>
                      <span class="rounded-full border px-2 py-0.5 text-xs {severityClass(item.severity)}">
                        {statusLabel(item.status)}
                      </span>
                    </div>

                    <p
                      class="mt-1 truncate font-mono text-xs text-gray-500 dark:text-gray-300"
                      title={item.originalPath}
                    >
                      {item.originalPath}
                    </p>

                    <p class="mt-2 line-clamp-2 text-sm text-gray-700 dark:text-gray-200">
                      {evidenceText(item)}
                    </p>

                    {#if isMissing}
                      <div class="mt-3 text-sm text-gray-600 dark:text-gray-300">
                        {candidateSummary(item)}
                      </div>
                      {#if item.candidates.length > 0}
                        <div class="mt-2 space-y-1">
                          {#each item.candidates.slice(0, 3) as candidate (candidate.id)}
                            <div class="flex flex-wrap gap-2 rounded-md bg-gray-50 px-2 py-1 text-xs dark:bg-gray-700">
                              <span class="font-mono">{candidate.candidatePath}</span>
                              <span>{statusLabel(candidate.status)}</span>
                              <span>{$t('media_health_match_score')}: {formatScore(candidate.visualMatchScore)}</span>
                            </div>
                          {/each}
                        </div>
                      {/if}
                    {/if}
                  </div>
                </div>
              </article>
            {/each}
          </div>
        </section>
      {/each}
    </div>
  {/if}

  {#if showDeleteDialog}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <section class="w-full max-w-xl rounded-lg bg-white p-6 shadow-xl dark:bg-immich-dark-bg">
        <div class="flex items-start gap-3 text-danger">
          <Icon icon={mdiAlertOctagonOutline} size="28" />
          <div>
            <Text size="large" fontWeight="bold">{$t('media_health_delete_dialog_title')}</Text>
            <p class="mt-2 text-sm text-gray-700 dark:text-gray-200">
              {$t('media_health_delete_dialog_body', { values: { count: selectedDeleteCount } })}
            </p>
          </div>
        </div>

        <label class="mt-5 block text-sm font-medium">
          {$t('media_health_type_confirm', { values: { phrase: DELETE_CONFIRM_TEXT } })}
          <input
            class="mt-2 w-full rounded-lg border border-gray-300 bg-white p-3 font-mono dark:border-immich-dark-gray dark:bg-immich-dark-gray"
            bind:value={deleteConfirmationText}
            autocomplete="off"
          />
        </label>

        <div class="mt-6 flex justify-end gap-2">
          <Button variant="ghost" color="secondary" onclick={() => (showDeleteDialog = false)}>{$t('cancel')}</Button>
          <Button
            color="danger"
            leadingIcon={mdiTrashCanOutline}
            onclick={confirmDelete}
            disabled={deleteConfirmationText !== DELETE_CONFIRM_TEXT || selectedDeleteCount === 0}
          >
            {$t('media_health_confirm_delete')}
          </Button>
        </div>
      </section>
    </div>
  {/if}
</UserPageLayout>
