<script lang="ts">
  import SearchCameraSection from '$lib/components/shared-components/search-bar/SearchCameraSection.svelte';
  import SearchDateSection from '$lib/components/shared-components/search-bar/SearchDateSection.svelte';
  import SearchDisplaySection from '$lib/components/shared-components/search-bar/SearchDisplaySection.svelte';
  import SearchImageEnrichmentSection from '$lib/components/shared-components/search-bar/SearchImageEnrichmentSection.svelte';
  import SearchLocationSection from '$lib/components/shared-components/search-bar/SearchLocationSection.svelte';
  import SearchMediaSection from '$lib/components/shared-components/search-bar/SearchMediaSection.svelte';
  import SearchPeopleSection from '$lib/components/shared-components/search-bar/SearchPeopleSection.svelte';
  import SearchRatingsSection from '$lib/components/shared-components/search-bar/SearchRatingsSection.svelte';
  import SearchTagsSection from '$lib/components/shared-components/search-bar/SearchTagsSection.svelte';
  import SearchTextSection from '$lib/components/shared-components/search-bar/SearchTextSection.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { searchManager } from '$lib/managers/search-manager.svelte';
  import { generateId } from '$lib/utils/generate-id';
  import type { MetadataSearchDto, SmartSearchDto } from '@immich/sdk';
  import { Button, HStack, Modal, ModalBody, ModalFooter } from '@immich/ui';
  import { mdiTune } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    searchQuery: MetadataSearchDto | SmartSearchDto;
    onClose: (search?: SmartSearchDto | MetadataSearchDto) => void;
  };

  let { searchQuery, onClose }: Props = $props();

  const formId = generateId();

  searchManager.setQuery(searchQuery);

  function storeQueryType(type: string) {
    localStorage.setItem('searchQueryType', type);
  }

  const onreset = (event: Event) => {
    event.preventDefault();
    searchManager.reset();
  };

  const onsubmit = (event: Event) => {
    event.preventDefault();
    storeQueryType(searchManager.filter.queryType);
    onClose(searchManager.toQuery());
  };
</script>

<Modal icon={mdiTune} size="giant" title={$t('search_options')} {onClose}>
  <ModalBody>
    <form id={formId} autocomplete="off" {onsubmit} {onreset}>
      <div class="flex flex-col gap-5 pb-10" tabindex="-1">
        <!-- PEOPLE -->
        <SearchPeopleSection title={undefined} parentPromise={undefined} />

        <!-- TEXT -->
        <SearchTextSection />

        <!-- TAGS -->
        <SearchTagsSection title={undefined} parentPromise={undefined} />

        <!-- LOCATION -->
        <SearchLocationSection />

        <!-- CAMERA MODEL -->
        <SearchCameraSection />

        <!-- DATE RANGE -->
        <SearchDateSection />

        <!-- RATING -->
        {#if authManager.authenticated && authManager.preferences.ratings?.enabled}
          <SearchRatingsSection />
        {/if}

        {#if authManager.authenticated && authManager.user.isAdmin}
          <SearchImageEnrichmentSection bind:imageEnrichment={searchManager.filter.imageEnrichment} />
        {/if}

        <div class="grid gap-x-5 gap-y-10 md:grid-cols-2">
          <!-- MEDIA TYPE -->
          <SearchMediaSection />

          <!-- DISPLAY OPTIONS -->
          <SearchDisplaySection />
        </div>
      </div>
    </form>
  </ModalBody>

  <ModalFooter>
    <HStack fullWidth>
      <Button shape="round" size="large" type="reset" color="secondary" fullWidth form={formId}
        >{$t('clear_all')}</Button
      >
      <Button shape="round" size="large" type="submit" fullWidth form={formId}>{$t('search')}</Button>
    </HStack>
  </ModalFooter>
</Modal>
