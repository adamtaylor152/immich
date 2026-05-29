<script lang="ts">
  import { ALBUM_ICONS, DEFAULT_ALBUM_ICON_KEY } from '$lib/utils/album-icons';
  import { Button, Icon, Modal, ModalBody, ModalFooter } from '@immich/ui';
  import { mdiClose } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    currentIconKey: string | null;
    onClose: (result?: { iconKey: string | null }) => void;
  };

  let { currentIconKey, onClose }: Props = $props();

  let selected = $state<string | null>(currentIconKey);

  const iconEntries = Object.entries(ALBUM_ICONS);
  const handleSubmit = () => onClose({ iconKey: selected });
  const handleClear = () => onClose({ iconKey: null });
</script>

<Modal title={$t('choose_album_icon')} {onClose} size="small">
  <ModalBody>
    <p class="mb-4 px-1 text-sm text-gray-600 dark:text-gray-300">
      {$t('choose_album_icon_description')}
    </p>

    <div class="grid grid-cols-6 gap-2">
      {#each iconEntries as [key, path] (key)}
        {@const isActive = selected === key || (selected === null && key === DEFAULT_ALBUM_ICON_KEY)}
        <button
          type="button"
          aria-pressed={isActive}
          aria-label={key.replaceAll('-', ' ')}
          onclick={() => (selected = key === DEFAULT_ALBUM_ICON_KEY ? null : key)}
          class={`flex aspect-square items-center justify-center rounded-lg border transition-colors ${
            isActive
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-gray-200 text-gray-700 hover:border-primary hover:text-primary dark:border-gray-700 dark:text-gray-200'
          }`}
        >
          <Icon icon={path} size="24" />
        </button>
      {/each}
    </div>
  </ModalBody>

  <ModalFooter>
    <div class="flex w-full justify-between gap-2">
      <Button color="secondary" size="small" leadingIcon={mdiClose} onclick={handleClear}>
        {$t('reset_to_default')}
      </Button>
      <div class="flex gap-2">
        <Button color="secondary" size="small" onclick={() => onClose()}>{$t('cancel')}</Button>
        <Button size="small" onclick={handleSubmit}>{$t('save')}</Button>
      </div>
    </div>
  </ModalFooter>
</Modal>
