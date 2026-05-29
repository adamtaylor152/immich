<script lang="ts">
  import { getAllAlbums, type AlbumResponseDto } from '@immich/sdk';
  import { Button, Modal, ModalBody, ModalFooter } from '@immich/ui';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  type ParentSelection = { parentId: string | null };

  type Props = {
    albumId: string;
    currentParentId: string | null;
    onClose: (selection?: ParentSelection) => void;
  };

  let { albumId, currentParentId, onClose }: Props = $props();

  let albums: AlbumResponseDto[] = $state([]);
  let loading = $state(true);
  let search = $state('');
  let selectedParentId: string | null = $state(currentParentId);

  // Albums that cannot be the parent: the album itself + every descendant
  // (otherwise we'd create a cycle).
  const computeForbiddenIds = (rootId: string, list: AlbumResponseDto[]) => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const blocked = new Set<string>([rootId]);
    let added = true;
    while (added) {
      added = false;
      for (const album of list) {
        if (album.parentId && blocked.has(album.parentId) && !blocked.has(album.id)) {
          blocked.add(album.id);
          added = true;
        }
      }
    }
    return blocked;
  };
  const forbiddenIds = $derived(computeForbiddenIds(albumId, albums));

  const candidates = $derived(
    albums
      .filter((album) => !forbiddenIds.has(album.id))
      .filter((album) => (search.trim() ? album.albumName.toLowerCase().includes(search.toLowerCase().trim()) : true))
      .sort((a, b) => a.albumName.localeCompare(b.albumName)),
  );

  onMount(async () => {
    try {
      albums = await getAllAlbums({ isOwned: true });
    } finally {
      loading = false;
    }
  });

  const handleSubmit = () => onClose({ parentId: selectedParentId });
</script>

<Modal title={$t('move_to_folder')} {onClose} size="small">
  <ModalBody>
    <div class="flex max-h-100 flex-col">
      <input
        type="search"
        class="border-b-4 border-immich-bg px-6 py-2 text-lg focus:border-immich-primary dark:border-immich-dark-gray dark:focus:border-immich-dark-primary"
        placeholder={$t('search_albums')}
        bind:value={search}
      />

      <div class="overflow-y-auto immich-scrollbar">
        {#if loading}
          <p class="px-5 py-3 text-sm">{$t('loading')}</p>
        {:else}
          <label class="flex cursor-pointer items-center gap-3 px-5 py-3 hover:bg-slate-100 dark:hover:bg-slate-800">
            <input type="radio" name="parent" value={null} bind:group={selectedParentId} />
            <span class="text-sm italic">{$t('top_level_no_parent')}</span>
          </label>

          {#each candidates as album (album.id)}
            <label class="flex cursor-pointer items-center gap-3 px-5 py-3 hover:bg-slate-100 dark:hover:bg-slate-800">
              <input type="radio" name="parent" value={album.id} bind:group={selectedParentId} />
              <span class="text-sm">{album.albumName}</span>
            </label>
          {/each}

          {#if candidates.length === 0 && !loading}
            <p class="px-5 py-3 text-sm text-gray-500">{$t('no_albums_message')}</p>
          {/if}
        {/if}
      </div>
    </div>
  </ModalBody>

  <ModalFooter>
    <div class="flex w-full justify-end gap-2">
      <Button color="secondary" size="small" onclick={() => onClose()}>{$t('cancel')}</Button>
      <Button size="small" onclick={handleSubmit} disabled={loading}>{$t('save')}</Button>
    </div>
  </ModalFooter>
</Modal>
