<script lang="ts">
  import SettingAccordion from '$lib/components/shared-components/settings/SettingAccordion.svelte';
  import SettingInputField from '$lib/components/shared-components/settings/SettingInputField.svelte';
  import SettingSwitch from '$lib/components/shared-components/settings/SettingSwitch.svelte';
  import SettingButtonsRow from '$lib/components/shared-components/settings/SystemConfigButtonRow.svelte';
  import SettingTextarea from './SettingTextarea.svelte';
  import { SettingInputFieldType } from '$lib/constants';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { systemConfigManager } from '$lib/managers/system-config-manager.svelte';
  import SmartAlbumReevaluateModal from '$lib/modals/SmartAlbumReevaluateModal.svelte';
  import { Button, modalManager, toastManager } from '@immich/ui';
  import { mdiRefresh } from '@mdi/js';
  import { Kind, type SmartAlbumKindConfig } from '@immich/sdk';
  import { t } from 'svelte-i18n';
  import { fade } from 'svelte/transition';

  const disabled = $derived(featureFlagsManager.value.configFile);
  const config = $derived(systemConfigManager.value);
  let configToEdit = $state(systemConfigManager.cloneValue());

  const smartAlbums = $derived(configToEdit.smartAlbums!);
  const savedSmartAlbums = $derived(config.smartAlbums!);

  // List-type fields are displayed as newline-joined text and parsed back on input.
  // Using $derived ensures textareas always reflect the live config — including after a Reset.
  const parseLines = (text: string): string[] =>
    text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

  const kindKeys = [Kind.Travel, Kind.Documents, Kind.Screenshots, Kind.Food, Kind.Pets, Kind.Nature] as const;
  type KindKey = (typeof kindKeys)[number];

  const kindTitle = (kind: KindKey): string => {
    const key = `admin.smart_albums_kind_${kind}` as const;
    return $t(key);
  };

  const getKind = (kind: KindKey): SmartAlbumKindConfig => smartAlbums.builtIn[kind];
  const getSavedKind = (kind: KindKey): SmartAlbumKindConfig => savedSmartAlbums.builtIn[kind];

  const tagTriggersText = $derived(
    Object.fromEntries(kindKeys.map((k) => [k, getKind(k).tagTriggers.join('\n')])) as Record<KindKey, string>,
  );

  const clipQueriesText = $derived(
    Object.fromEntries(kindKeys.map((k) => [k, getKind(k).clipQueries.join('\n')])) as Record<KindKey, string>,
  );

  const handleReevaluateClick = async (kind?: KindKey) => {
    const props = kind ? { kind, kindLabel: kindTitle(kind) } : {};
    const result = await modalManager.show(SmartAlbumReevaluateModal, props);
    if (result?.queued) {
      if (kind) {
        toastManager.primary($t('admin.smart_albums_kind_reevaluate_started', { values: { kind: kindTitle(kind) } }));
      } else {
        toastManager.primary($t('admin.smart_albums_reevaluate_started'));
      }
    } else if (result) {
      toastManager.primary($t('admin.smart_albums_reevaluate_already_in_flight'));
    }
  };
</script>

<div>
  <div in:fade={{ duration: 500 }}>
    <form autocomplete="off" onsubmit={(event) => event.preventDefault()}>
      <div class="ms-4 mt-4 flex flex-col gap-4">
        <SettingSwitch
          title={$t('admin.smart_albums_enabled')}
          subtitle={$t('admin.smart_albums_enabled_description')}
          {disabled}
          bind:checked={smartAlbums.enabled}
          isEdited={smartAlbums.enabled !== savedSmartAlbums.enabled}
        />

        <hr />

        {#each kindKeys as kind (kind)}
          {@const kindConfig = getKind(kind)}
          {@const savedKindConfig = getSavedKind(kind)}
          {@const kindToggleDisabled = disabled || !smartAlbums.enabled}
          {@const kindFieldsDisabled = disabled || !smartAlbums.enabled || !kindConfig.enabled}
          <SettingAccordion key={`smart-albums-${kind}`} title={kindTitle(kind)} subtitle="">
            <div class="ms-4 mt-4 flex flex-col gap-4">
              <SettingSwitch
                title={$t('admin.smart_albums_kind_enabled')}
                disabled={kindToggleDisabled}
                bind:checked={kindConfig.enabled}
                isEdited={kindConfig.enabled !== savedKindConfig.enabled}
              />

              <SettingInputField
                inputType={SettingInputFieldType.TEXT}
                label={$t('admin.smart_albums_kind_name')}
                description={$t('admin.smart_albums_kind_name_description')}
                bind:value={kindConfig.name}
                disabled={kindFieldsDisabled}
                isEdited={kindConfig.name !== savedKindConfig.name}
              />

              <SettingTextarea
                label={$t('admin.smart_albums_kind_tag_triggers')}
                description={$t('admin.smart_albums_kind_tag_triggers_description')}
                value={tagTriggersText[kind]}
                disabled={kindFieldsDisabled}
                isEdited={kindConfig.tagTriggers.join('\n') !== savedKindConfig.tagTriggers.join('\n')}
                onChange={(text) => (kindConfig.tagTriggers = parseLines(text))}
              />

              <SettingTextarea
                label={$t('admin.smart_albums_kind_clip_queries')}
                description={$t('admin.smart_albums_kind_clip_queries_description')}
                value={clipQueriesText[kind]}
                disabled={kindFieldsDisabled}
                isEdited={kindConfig.clipQueries.join('\n') !== savedKindConfig.clipQueries.join('\n')}
                onChange={(text) => (kindConfig.clipQueries = parseLines(text))}
              />

              <SettingInputField
                inputType={SettingInputFieldType.NUMBER}
                label={$t('admin.smart_albums_kind_threshold')}
                description={$t('admin.smart_albums_kind_threshold_description')}
                bind:value={kindConfig.threshold}
                step="0.01"
                min={0.2}
                max={0.4}
                disabled={kindFieldsDisabled}
                isEdited={kindConfig.threshold !== savedKindConfig.threshold}
              />

              <div class="flex justify-end">
                <Button
                  size="small"
                  shape="round"
                  color="secondary"
                  leadingIcon={mdiRefresh}
                  onclick={() => handleReevaluateClick(kind)}
                  disabled={kindFieldsDisabled}
                >
                  {$t('admin.smart_albums_kind_reevaluate_button')}
                </Button>
              </div>
            </div>
          </SettingAccordion>
        {/each}

        <hr />

        <div class="flex justify-end">
          <Button
            size="small"
            shape="round"
            color="secondary"
            leadingIcon={mdiRefresh}
            onclick={() => handleReevaluateClick()}
            disabled={disabled || !smartAlbums.enabled}
          >
            {$t('admin.smart_albums_reevaluate_button')}
          </Button>
        </div>

        <SettingButtonsRow bind:configToEdit keys={['smartAlbums']} {disabled} />
      </div>
    </form>
  </div>
</div>
