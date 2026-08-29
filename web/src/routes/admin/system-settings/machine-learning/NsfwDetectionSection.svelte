<script lang="ts">
  import SettingAccordion from '$lib/components/shared-components/settings/SettingAccordion.svelte';
  import SettingInputField from '$lib/components/shared-components/settings/SettingInputField.svelte';
  import SettingSwitch from '$lib/components/shared-components/settings/SettingSwitch.svelte';
  import { SettingInputFieldType } from '$lib/constants';
  import type { AdminConfigNsfwDetectionDto, AdminConfigMachineLearningDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';

  interface Props {
    workingConfig: AdminConfigMachineLearningDto;
    nsfwDetection: AdminConfigNsfwDetectionDto;
    savedNsfwDetection: AdminConfigNsfwDetectionDto;
    disabled: boolean;
  }

  let { workingConfig, nsfwDetection, savedNsfwDetection, disabled }: Props = $props();
</script>

<SettingAccordion
  key="nsfw-detection"
  title={$t('admin.machine_learning_nsfw_detection')}
  subtitle={$t('admin.machine_learning_nsfw_detection_description')}
>
  <div class="mt-4 ml-4 flex flex-col gap-4">
    <SettingSwitch
      title={$t('admin.machine_learning_nsfw_detection_enabled')}
      subtitle={$t('admin.machine_learning_nsfw_detection_enabled_description')}
      bind:checked={nsfwDetection.enabled}
      disabled={disabled || !workingConfig.enabled}
      isEdited={nsfwDetection.enabled !== savedNsfwDetection.enabled}
    />

    <SettingSwitch
      title={$t('admin.machine_learning_nsfw_detection_hide_from_library')}
      subtitle={$t('admin.machine_learning_nsfw_detection_hide_from_library_description')}
      bind:checked={nsfwDetection.hideFromLibrary}
      disabled={disabled || !workingConfig.enabled}
      isEdited={nsfwDetection.hideFromLibrary !== savedNsfwDetection.hideFromLibrary}
    />

    <hr />

    <SettingInputField
      inputType={SettingInputFieldType.TEXT}
      label={$t('admin.machine_learning_nsfw_detection_model')}
      bind:value={nsfwDetection.modelName}
      required={true}
      disabled={disabled || !workingConfig.enabled || !nsfwDetection.enabled}
      isEdited={nsfwDetection.modelName !== savedNsfwDetection.modelName}
    />

    <SettingInputField
      inputType={SettingInputFieldType.NUMBER}
      label={$t('admin.machine_learning_nsfw_detection_threshold')}
      description={$t('admin.machine_learning_nsfw_detection_threshold_description')}
      bind:value={nsfwDetection.threshold}
      step="0.01"
      min={0.01}
      max={1}
      disabled={disabled || !workingConfig.enabled || !nsfwDetection.enabled}
      isEdited={nsfwDetection.threshold !== savedNsfwDetection.threshold}
    />

    <SettingInputField
      inputType={SettingInputFieldType.TEXT}
      label={$t('admin.machine_learning_hardware_device')}
      bind:value={nsfwDetection.device}
      required={true}
      disabled={disabled || !workingConfig.enabled || !nsfwDetection.enabled}
      isEdited={nsfwDetection.device !== savedNsfwDetection.device}
    />
  </div>
</SettingAccordion>
