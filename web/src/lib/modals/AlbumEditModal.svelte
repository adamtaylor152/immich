<script lang="ts">
  import AlbumCover from '$lib/components/album-page/AlbumCover.svelte';
  import AlbumIconPickerModal from '$lib/modals/AlbumIconPickerModal.svelte';
  import { handleUpdateAlbum } from '$lib/services/album.service';
  import { albumIconPath } from '$lib/utils/album-icons';
  import { type AlbumResponseDto } from '@immich/sdk';
  import { Button, Field, FormModal, Icon, Input, modalManager, Textarea } from '@immich/ui';
  import { mdiPencilOutline, mdiRenameOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    album: AlbumResponseDto;
    onClose: () => void;
  };

  let { album, onClose }: Props = $props();

  let albumName = $state(album.albumName);
  let description = $state(album.description);
  let iconKey = $state<string | null>(album.icon);

  const iconPath = $derived(albumIconPath(iconKey));

  const onSubmit = async () => {
    const success = await handleUpdateAlbum(album, { albumName, description, icon: iconKey });
    if (success) {
      onClose();
    }
  };

  const openIconPicker = async () => {
    const result = await modalManager.show(AlbumIconPickerModal, { currentIconKey: iconKey });
    if (result) {
      iconKey = result.iconKey;
    }
  };
</script>

<FormModal icon={mdiRenameOutline} title={$t('edit_album')} size="medium" {onClose} {onSubmit}>
  <div class="m-4 flex items-center gap-8">
    <AlbumCover {album} class="hidden size-50 shadow-lg sm:flex" />

    <div class="flex grow flex-col gap-4">
      <Field label={$t('name')}>
        <Input bind:value={albumName} />
      </Field>

      <Field label={$t('description')}>
        <Textarea bind:value={description} />
      </Field>

      <Field label={$t('icon')}>
        <div class="flex items-center gap-3">
          <span
            class="flex size-10 items-center justify-center rounded-lg border border-gray-200 text-gray-700 dark:border-gray-700 dark:text-gray-200"
          >
            <Icon icon={iconPath} size="24" />
          </span>
          <Button
            type="button"
            size="small"
            color="secondary"
            variant="ghost"
            leadingIcon={mdiPencilOutline}
            onclick={openIconPicker}
          >
            {$t('change_icon')}
          </Button>
        </div>
      </Field>
    </div>
  </div>
</FormModal>
