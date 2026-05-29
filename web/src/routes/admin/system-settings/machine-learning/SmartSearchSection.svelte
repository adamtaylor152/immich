<script lang="ts">
  import SettingAccordion from '$lib/components/shared-components/settings/SettingAccordion.svelte';
  import SettingInputField from '$lib/components/shared-components/settings/SettingInputField.svelte';
  import SettingSwitch from '$lib/components/shared-components/settings/SettingSwitch.svelte';
  import { SettingInputFieldType } from '$lib/constants';
  import FormatMessage from '$lib/elements/FormatMessage.svelte';
  import type { SystemConfigMachineLearningDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';

  interface Props {
    workingConfig: SystemConfigMachineLearningDto;
    savedConfig: SystemConfigMachineLearningDto;
    disabled: boolean;
  }

  let { workingConfig, savedConfig, disabled }: Props = $props();
</script>

<SettingAccordion
  key="smart-search"
  title={$t('admin.machine_learning_smart_search')}
  subtitle={$t('admin.machine_learning_smart_search_description')}
>
  <div class="ms-4 mt-4 flex flex-col gap-4">
    <SettingSwitch
      title={$t('admin.machine_learning_smart_search_enabled')}
      subtitle={$t('admin.machine_learning_smart_search_enabled_description')}
      bind:checked={workingConfig.clip.enabled}
      disabled={disabled || !workingConfig.enabled}
    />

    <hr />

    <SettingInputField
      inputType={SettingInputFieldType.TEXT}
      label={$t('admin.machine_learning_clip_model')}
      bind:value={workingConfig.clip.modelName}
      required={true}
      disabled={disabled || !workingConfig.enabled || !workingConfig.clip.enabled}
      isEdited={workingConfig.clip.modelName !== savedConfig.clip.modelName}
    >
      {#snippet descriptionSnippet()}
        <p class="pb-2 text-sm immich-form-label">
          <FormatMessage key="admin.machine_learning_clip_model_description">
            {#snippet children({ message })}
              <a target="_blank" href="https://huggingface.co/immich-app"><u>{message}</u></a>
            {/snippet}
          </FormatMessage>
        </p>
      {/snippet}
    </SettingInputField>
  </div>
</SettingAccordion>
