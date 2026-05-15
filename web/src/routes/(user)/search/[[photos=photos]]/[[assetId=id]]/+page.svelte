<script lang="ts">
  import { afterNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import ActionMenuItem from '$lib/components/ActionMenuItem.svelte';
  import OnEvents from '$lib/components/OnEvents.svelte';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import ControlAppBar from '$lib/components/shared-components/ControlAppBar.svelte';
  import GalleryViewer from '$lib/components/shared-components/gallery-viewer/GalleryViewer.svelte';
  import SearchBar from '$lib/components/shared-components/search-bar/SearchBar.svelte';
  import ArchiveAction from '$lib/components/timeline/actions/ArchiveAction.svelte';
  import ChangeDate from '$lib/components/timeline/actions/ChangeDateAction.svelte';
  import ChangeDescription from '$lib/components/timeline/actions/ChangeDescriptionAction.svelte';
  import ChangeLocation from '$lib/components/timeline/actions/ChangeLocationAction.svelte';
  import CreateSharedLink from '$lib/components/timeline/actions/CreateSharedLinkAction.svelte';
  import DeleteAssets from '$lib/components/timeline/actions/DeleteAssetsAction.svelte';
  import DownloadAction from '$lib/components/timeline/actions/DownloadAction.svelte';
  import FavoriteAction from '$lib/components/timeline/actions/FavoriteAction.svelte';
  import SetVisibilityAction from '$lib/components/timeline/actions/SetVisibilityAction.svelte';
  import TagAction from '$lib/components/timeline/actions/TagAction.svelte';
  import AssetSelectControlBar from '$lib/components/timeline/AssetSelectControlBar.svelte';
  import { QueryParameter } from '$lib/constants';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import type { Viewport } from '$lib/managers/timeline-manager/types';
  import { Route } from '$lib/route';
  import { getAssetBulkActions } from '$lib/services/asset.service';
  import { lang, locale } from '$lib/stores/preferences.store';
  import { handlePromiseError } from '$lib/utils';
  import { parseUtcDate } from '$lib/utils/date-time';
  import { handleError } from '$lib/utils/handle-error';
  import { isAlbumsRoute, isPeopleRoute } from '$lib/utils/navigation';
  import { toTimelineAsset } from '$lib/utils/timeline-util';
  import {
    type AlbumResponseDto,
    type AssetResponseDto,
    askSearch,
    type AskSearchResponseDto,
    getPerson,
    getTagById,
    ImageEnrichmentFilter,
    type MetadataSearchDto,
    searchAssets,
    searchSmart,
    type SmartSearchDto,
  } from '@immich/sdk';
  import { ActionButton, Button, CommandPaletteDefaultProvider, Icon, IconButton, LoadingSpinner } from '@immich/ui';
  import {
    mdiAccountMultipleOutline,
    mdiArrowLeft,
    mdiCalendarHeart,
    mdiClose,
    mdiDotsVertical,
    mdiFileDocumentOutline,
    mdiImageAlbum,
    mdiImageOffOutline,
    mdiMapMarkerOutline,
    mdiSelectAll,
  } from '@mdi/js';
  import { tick, untrack } from 'svelte';
  import { t } from 'svelte-i18n';

  const viewport: Viewport = $state({ width: 0, height: 0 });
  const ASK_QUERY_PARAMETER = 'ask';
  let searchResultsElement: HTMLElement | undefined = $state();

  // The GalleryViewer pushes it's own history state, which causes weird
  // behavior for history.back(). To prevent that we store the previous page
  // manually and navigate back to that.
  let previousRoute = $state<string>(Route.explore());

  let nextPage = $state(1);
  let searchResultAlbums: AlbumResponseDto[] = $state([]);
  let searchResultAssets: AssetResponseDto[] = $state([]);
  let isLoading = $state(true);
  let askQuery = $state('');
  let askResponse = $state<AskSearchResponseDto>();
  let askNextPage = $state<number | null>(null);
  let isAskLoading = $state(false);
  let askSearchRequestId = 0;
  let scrollY = $state(0);
  let scrollYHistory = 0;

  type SearchTerms = MetadataSearchDto & Pick<SmartSearchDto, 'query' | 'queryAssetId'>;
  let searchQuery = $derived(page.url.searchParams.get(QueryParameter.QUERY));
  let askSearchQuery = $derived(page.url.searchParams.get(ASK_QUERY_PARAMETER) ?? '');
  let smartSearchEnabled = $derived(featureFlagsManager.value.smartSearch);
  let terms = $derived<SearchTerms>(searchQuery ? JSON.parse(searchQuery) : {});
  let hasSearchQuery = $derived(Object.keys(terms).length > 0);
  let canUseAskSearch = $derived(featureFlagsManager.value.search && featureFlagsManager.value.smartSearch);

  $effect(() => {
    // we want this to *only* be reactive on `terms`
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    terms;
    untrack(() => handlePromiseError(onSearchQueryUpdate()));
  });

  $effect(() => {
    // we want this to *only* be reactive on `askSearchQuery` and `hasSearchQuery`
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    askSearchQuery;
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    hasSearchQuery;
    untrack(() => {
      if (hasSearchQuery) {
        return;
      }

      if (!askSearchQuery.trim()) {
        resetAskSearch();
        return;
      }

      askQuery = askSearchQuery;
      handlePromiseError(runAskSearch(askSearchQuery, { force: true }));
    });
  });

  $effect(() => {
    if (scrollY) {
      scrollYHistory = scrollY;
    }
  });

  afterNavigate(({ from }) => {
    // Prevent setting previousRoute to the current page.
    if (from?.url && from.route.id !== page.route.id) {
      previousRoute = from.url.href;
    }
    const route = from?.route?.id;

    if (isPeopleRoute(route)) {
      previousRoute = Route.photos();
    }

    if (isAlbumsRoute(route)) {
      previousRoute = Route.explore();
    }

    tick()
      .then(() => {
        window.scrollTo(0, scrollYHistory);
      })
      .catch(() => {
        // do nothing
      });
  });

  const onAssetDelete = (assetIds: string[]) => {
    const assetIdSet = new Set(assetIds);
    searchResultAssets = searchResultAssets.filter((asset: AssetResponseDto) => !assetIdSet.has(asset.id));
  };

  const handleSetVisibility = (assetIds: string[]) => {
    assetMultiSelectManager.clear();
    onAssetDelete(assetIds);
  };

  const handleSelectAll = () => {
    assetMultiSelectManager.selectAssets(searchResultAssets.map((asset) => toTimelineAsset(asset)));
  };

  async function onSearchQueryUpdate() {
    nextPage = 1;
    searchResultAssets = [];
    searchResultAlbums = [];
    resetAskSearch(false);
    if (!hasSearchQuery) {
      isLoading = false;
      return;
    }
    await loadNextPage(true);
  }

  // eslint-disable-next-line svelte/valid-prop-names-in-kit-pages
  export const loadNextPage = async (force?: boolean) => {
    if (!nextPage || (isLoading && !force)) {
      return;
    }
    isLoading = true;

    const searchDto: SearchTerms = {
      page: nextPage,
      withExif: true,
      ...terms,
    };

    try {
      const { albums, assets } =
        ('query' in searchDto || 'queryAssetId' in searchDto) && smartSearchEnabled
          ? await searchSmart({ smartSearchDto: { ...searchDto, language: $lang } })
          : await searchAssets({ metadataSearchDto: searchDto });

      searchResultAlbums.push(...albums.items);
      searchResultAssets.push(...assets.items);

      nextPage = Number(assets.nextPage) || 0;
    } catch (error) {
      handleError(error, $t('loading_search_results_failed'));
    } finally {
      isLoading = false;
    }
  };

  function getHumanReadableDate(dateString: string) {
    const date = parseUtcDate(dateString).startOf('day');
    return date.toLocaleString(
      {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      },
      { locale: $locale },
    );
  }

  function getHumanReadableSearchKey(key: keyof SearchTerms): string {
    const keyMap: Partial<Record<keyof SearchTerms, string>> = {
      takenAfter: $t('start_date'),
      takenBefore: $t('end_date'),
      visibility: $t('in_archive'),
      isFavorite: $t('favorite'),
      isNotInAlbum: $t('not_in_any_album'),
      type: $t('media_type'),
      query: $t('context'),
      city: $t('city'),
      country: $t('country'),
      state: $t('state'),
      make: $t('camera_brand'),
      model: $t('camera_model'),
      lensModel: $t('lens_model'),
      personIds: $t('people'),
      tagIds: $t('tags'),
      originalFileName: $t('file_name_text'),
      originalPath: $t('full_path_or_folder'),
      description: $t('description'),
      queryAssetId: $t('query_asset_id'),
      ocr: $t('ocr'),
      imageEnrichment: $t('image_enrichment'),
    };
    return keyMap[key] || key;
  }

  function getHumanReadableImageEnrichmentFilter(filter: string) {
    switch (filter) {
      case ImageEnrichmentFilter.Nsfw: {
        return $t('image_enrichment_filter_nsfw');
      }
      case ImageEnrichmentFilter.NsfwReview: {
        return $t('image_enrichment_filter_nsfw_review');
      }
      case ImageEnrichmentFilter.NsfwReviewed: {
        return $t('image_enrichment_filter_nsfw_reviewed');
      }
      case ImageEnrichmentFilter.NsfwOverridden: {
        return $t('image_enrichment_filter_nsfw_overridden');
      }
      case ImageEnrichmentFilter.ImageDescriptionFailed: {
        return $t('image_enrichment_filter_description_failed');
      }
      case ImageEnrichmentFilter.NsfwDetectionFailed: {
        return $t('image_enrichment_filter_nsfw_failed');
      }
      case ImageEnrichmentFilter.MissingImageDescription: {
        return $t('image_enrichment_filter_missing_description');
      }
      case ImageEnrichmentFilter.MissingNsfwDetection: {
        return $t('image_enrichment_filter_missing_nsfw');
      }
      default: {
        return filter;
      }
    }
  }

  async function getPersonName(personIds: string[]) {
    const personNames = await Promise.all(
      personIds.map(async (personId) => {
        const person = await getPerson({ id: personId });

        if (person.name == '') {
          return $t('no_name');
        }

        return person.name;
      }),
    );

    return personNames.join(', ');
  }

  async function getTagNames(tagIds: string[] | null) {
    if (tagIds === null) {
      return $t('untagged');
    }
    const tagNames = await Promise.all(
      tagIds.map(async (tagId) => {
        const tag = await getTagById({ id: tagId });

        return tag.value;
      }),
    );

    return tagNames.join(', ');
  }

  const onAlbumAddAssets = ({ assetIds }: { assetIds: string[] }) => {
    assetMultiSelectManager.clear();

    if (terms.isNotInAlbum) {
      const assetIdSet = new Set(assetIds);
      searchResultAssets = searchResultAssets.filter((asset) => !assetIdSet.has(asset.id));
    }
  };

  function getObjectKeys<T extends object>(obj: T): (keyof T)[] {
    return Object.keys(obj) as (keyof T)[];
  }

  function removeFilter(key: keyof SearchTerms) {
    const nextTerms = { ...terms };
    delete nextTerms[key];
    void goto(Route.search(nextTerms));
  }

  function resetAskSearch(clearInput = true) {
    askSearchRequestId++;
    askResponse = undefined;
    askNextPage = null;
    isAskLoading = false;

    if (clearInput) {
      askQuery = '';
      searchResultAssets = [];
      searchResultAlbums = [];
    }
  }

  async function updateAskSearchUrl(query: string) {
    const normalizedQuery = query.trim();
    if (!normalizedQuery || isAskLoading) {
      return;
    }

    const url = new URL(page.url);
    url.searchParams.delete(QueryParameter.QUERY);
    url.searchParams.set(ASK_QUERY_PARAMETER, normalizedQuery);

    if (url.href === page.url.href) {
      await runAskSearch(normalizedQuery, { force: true });
      return;
    }

    await goto(url, { keepFocus: true, noScroll: true });
  }

  async function runAskSearch(query = askQuery, options: { force?: boolean; append?: boolean } = {}) {
    const normalizedQuery = query.trim();
    if (!normalizedQuery || (isAskLoading && !options.force) || !canUseAskSearch) {
      return;
    }

    const requestId = ++askSearchRequestId;
    const pageToLoad = options.append ? askNextPage : 1;
    if (!pageToLoad) {
      return;
    }

    isAskLoading = true;
    askQuery = normalizedQuery;

    if (!options.append) {
      askResponse = undefined;
      askNextPage = null;
      searchResultAssets = [];
      searchResultAlbums = [];
    }

    try {
      const response = await askSearch({ askSearchDto: { query: normalizedQuery, page: pageToLoad, language: $lang } });
      if (requestId !== askSearchRequestId) {
        return;
      }

      askResponse = response;
      askNextPage = Number(response.results.assets.nextPage) || null;
      if (options.append) {
        searchResultAlbums.push(...response.results.albums.items);
        searchResultAssets.push(...response.results.assets.items);
      } else {
        searchResultAlbums = response.results.albums.items;
        searchResultAssets = response.results.assets.items;
      }
    } catch (error) {
      if (requestId === askSearchRequestId) {
        handleError(error, $t('loading_search_results_failed'));
      }
    } finally {
      if (requestId === askSearchRequestId) {
        isAskLoading = false;
      }
    }
  }

  async function loadNextAskPage() {
    await runAskSearch(askResponse?.query ?? askQuery, { append: true });
  }

  function onAskSubmit(event: SubmitEvent) {
    event.preventDefault();
    handlePromiseError(updateAskSearchUrl(askQuery));
  }

  const suggestedSearches = [
    { icon: mdiAccountMultipleOutline, title: $t('people'), query: 'photos of Alice last summer' },
    { icon: mdiMapMarkerOutline, title: $t('places'), query: 'photos in Banff from April 2024' },
    { icon: mdiFileDocumentOutline, title: $t('documents'), query: 'receipts from last year' },
    { icon: mdiCalendarHeart, title: $t('memories'), query: 'favorite videos since 2020' },
    { icon: mdiImageAlbum, title: $t('albums'), query: 'screenshots from last month' },
  ];
</script>

<svelte:window bind:scrollY />

<OnEvents {onAlbumAddAssets} />

{#if hasSearchQuery}
  <section
    id="search-chips"
    class="mt-24 flex w-full flex-wrap place-content-center place-items-center gap-5 px-24 text-center"
  >
    {#each getObjectKeys(terms) as searchKey (searchKey)}
      {@const value = terms[searchKey]}
      <div class="flex place-content-center place-items-center items-stretch text-xs">
        <div
          class="flex items-center justify-center rounded-s-full bg-immich-primary px-4 py-2 text-white dark:bg-immich-dark-primary dark:text-black"
        >
          {getHumanReadableSearchKey(searchKey as keyof SearchTerms)}
        </div>

        {#if value !== true}
          <div class="bg-gray-300 px-4 py-2 dark:bg-gray-800 dark:text-white">
            {#if (searchKey === 'takenAfter' || searchKey === 'takenBefore') && typeof value === 'string'}
              {getHumanReadableDate(value)}
            {:else if searchKey === 'personIds' && Array.isArray(value)}
              {#await getPersonName(value) then personName}
                {personName}
              {/await}
            {:else if searchKey === 'tagIds' && (Array.isArray(value) || value === null)}
              {#await getTagNames(value) then tagNames}
                {tagNames}
              {/await}
            {:else if searchKey === 'rating'}
              {$t('rating_count', { values: { count: value ?? 0 } })}
            {:else if searchKey === 'imageEnrichment' && typeof value === 'string'}
              {getHumanReadableImageEnrichmentFilter(value)}
            {:else if value === null || value === ''}
              {$t('unknown')}
            {:else}
              {value}
            {/if}
          </div>
        {/if}
        <button
          type="button"
          class="flex items-center justify-center rounded-e-full bg-gray-300 px-3 text-gray-700 transition hover:text-immich-primary dark:bg-gray-800 dark:text-white dark:hover:text-immich-dark-primary"
          aria-label={$t('remove_filter')}
          title={$t('remove_filter')}
          onclick={() => removeFilter(searchKey as keyof SearchTerms)}
        >
          <Icon icon={mdiClose} size="16" />
        </button>
      </div>
    {/each}
  </section>
{/if}

<section
  class="m-4 mb-12 max-h-screen bg-immich-bg dark:bg-immich-dark-bg"
  bind:clientHeight={viewport.height}
  bind:clientWidth={viewport.width}
  bind:this={searchResultsElement}
>
  <section id="search-content">
    {#if !hasSearchQuery && canUseAskSearch}
      <div class="mx-auto mt-24 flex w-full max-w-5xl flex-col gap-8 px-6 text-gray-700 dark:text-gray-200">
        <form class="mx-auto flex w-full max-w-3xl gap-2" onsubmit={onAskSubmit}>
          <label for="ask-search-input" class="sr-only">{$t('search_your_photos')}</label>
          <input
            id="ask-search-input"
            type="search"
            class="h-12 min-w-0 flex-1 rounded-full border border-gray-300 bg-white px-5 text-base outline-none focus:border-immich-primary dark:border-gray-700 dark:bg-gray-900"
            bind:value={askQuery}
            disabled={isAskLoading}
            placeholder={$t('search_your_photos')}
          />
          <Button type="submit" disabled={isAskLoading || !askQuery.trim()}>
            {isAskLoading ? $t('searching') : $t('ask')}
          </Button>
        </form>

        {#if askResponse}
          <div
            class="rounded-lg border border-gray-200 bg-white p-4 text-sm shadow-sm dark:border-gray-800 dark:bg-gray-900"
          >
            <p class="font-medium">{askResponse.explanation}</p>
            {#if askResponse.warnings.length > 0}
              <p class="mt-2 text-gray-500 dark:text-gray-400">{askResponse.warnings.join(' ')}</p>
            {/if}
          </div>
        {/if}

        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {#each suggestedSearches as item (item.query)}
            <button
              type="button"
              disabled={isAskLoading}
              class="flex min-h-28 flex-col justify-between rounded-lg border border-gray-200 bg-white p-4 text-start shadow-sm transition hover:border-immich-primary hover:text-immich-primary dark:border-gray-800 dark:bg-gray-900 dark:hover:border-immich-dark-primary dark:hover:text-immich-dark-primary"
              onclick={() => {
                askQuery = item.query;
                handlePromiseError(updateAskSearchUrl(item.query));
              }}
            >
              <Icon icon={item.icon} size="1.7em" />
              <span class="text-base font-medium">{item.title}</span>
              <span class="text-sm text-gray-500 dark:text-gray-400">{item.query}</span>
            </button>
          {/each}
        </div>

        {#if askResponse && searchResultAssets.length > 0}
          <GalleryViewer
            assets={searchResultAssets}
            assetInteraction={assetMultiSelectManager}
            showArchiveIcon={true}
            {viewport}
            onReload={runAskSearch}
            onIntersected={loadNextAskPage}
            slidingWindowOffset={searchResultsElement.offsetTop}
          />
        {:else if askResponse && !isAskLoading}
          <div class="flex min-h-56 w-full place-content-center items-center dark:text-white">
            <div class="flex flex-col content-center items-center text-center">
              <Icon icon={mdiImageOffOutline} size="3.5em" />
              <p class="mt-5 text-3xl font-medium">{$t('no_results')}</p>
              <p class="text-base font-normal">{$t('no_results_description')}</p>
            </div>
          </div>
        {/if}
      </div>
    {:else if hasSearchQuery && searchResultAssets.length > 0}
      <GalleryViewer
        assets={searchResultAssets}
        assetInteraction={assetMultiSelectManager}
        onIntersected={loadNextPage}
        showArchiveIcon={true}
        {viewport}
        onReload={onSearchQueryUpdate}
        slidingWindowOffset={searchResultsElement.offsetTop}
      />
    {:else if hasSearchQuery && !isLoading}
      <div class="flex min-h-[calc(66vh-11rem)] w-full place-content-center items-center dark:text-white">
        <div class="flex flex-col content-center items-center text-center">
          <Icon icon={mdiImageOffOutline} size="3.5em" />
          <p class="mt-5 text-3xl font-medium">{$t('no_results')}</p>
          <p class="text-base font-normal">{$t('no_results_description')}</p>
        </div>
      </div>
    {/if}

    {#if isLoading}
      <div class="flex items-center justify-center py-16">
        <LoadingSpinner size="giant" />
      </div>
    {/if}
  </section>

  <section>
    {#if assetMultiSelectManager.selectionActive}
      <div class="fixed inset-s-0 top-0 z-2 w-full">
        <AssetSelectControlBar>
          {@const Actions = getAssetBulkActions($t)}
          <CommandPaletteDefaultProvider name={$t('assets')} actions={Object.values(Actions)} />

          <CreateSharedLink />
          <IconButton
            shape="round"
            color="secondary"
            variant="ghost"
            aria-label={$t('select_all')}
            icon={mdiSelectAll}
            onclick={handleSelectAll}
          />
          <ActionButton action={Actions.AddToAlbum} />
          {#if assetMultiSelectManager.isAllUserOwned}
            <FavoriteAction
              removeFavorite={assetMultiSelectManager.isAllFavorite}
              onFavorite={(ids, isFavorite) => {
                for (const id of ids) {
                  const asset = searchResultAssets.find((asset) => asset.id === id);
                  if (asset) {
                    asset.isFavorite = isFavorite;
                  }
                }
              }}
            />

            <ButtonContextMenu icon={mdiDotsVertical} title={$t('menu')}>
              <ActionMenuItem action={Actions.AddToAlbum} />
              <DownloadAction menuItem />
              <ChangeDate menuItem />
              <ChangeDescription menuItem />
              <ChangeLocation menuItem />
              <ArchiveAction menuItem unarchive={assetMultiSelectManager.isAllArchived} />
              <SetVisibilityAction menuItem onVisibilitySet={handleSetVisibility} />
              {#if authManager.preferences.tags.enabled}
                <TagAction menuItem />
              {/if}
              <DeleteAssets menuItem {onAssetDelete} onUndoDelete={onSearchQueryUpdate} />
              <hr />
              <ActionMenuItem action={Actions.RegenerateThumbnailJob} />
              <ActionMenuItem action={Actions.RefreshMetadataJob} />
              <ActionMenuItem action={Actions.TranscodeVideoJob} />
            </ButtonContextMenu>
          {:else}
            <DownloadAction />
          {/if}
        </AssetSelectControlBar>
      </div>
    {:else}
      <div class="fixed inset-s-0 top-0 z-2 w-full">
        <ControlAppBar onClose={() => goto(previousRoute)} backIcon={mdiArrowLeft}>
          <div class="absolute bg-light"></div>
          <div class="w-full flex-1 ps-4">
            <SearchBar grayTheme={false} value={terms?.query ?? ''} searchQuery={terms} />
          </div>
        </ControlAppBar>
      </div>
    {/if}
  </section>
</section>
