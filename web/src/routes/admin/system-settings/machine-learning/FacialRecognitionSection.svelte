<script lang="ts">
  import SettingAccordion from '$lib/components/shared-components/settings/SettingAccordion.svelte';
  import SettingInputField from '$lib/components/shared-components/settings/SettingInputField.svelte';
  import SettingSwitch from '$lib/components/shared-components/settings/SettingSwitch.svelte';
  import { SettingInputFieldType } from '$lib/constants';
  import type { SystemConfigMachineLearningDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';
  import SettingSelect from '../SettingSelect.svelte';

  interface Props {
    workingConfig: SystemConfigMachineLearningDto;
    savedConfig: SystemConfigMachineLearningDto;
    disabled: boolean;
  }

  let { workingConfig, savedConfig, disabled }: Props = $props();
</script>

<SettingAccordion
  key="facial-recognition"
  title={$t('admin.machine_learning_facial_recognition')}
  subtitle={$t('admin.machine_learning_facial_recognition_description')}
>
  <div class="ms-4 mt-4 flex flex-col gap-4">
    <SettingSwitch
      title={$t('admin.machine_learning_facial_recognition_setting')}
      subtitle={$t('admin.machine_learning_facial_recognition_setting_description')}
      bind:checked={workingConfig.facialRecognition.enabled}
      disabled={disabled || !workingConfig.enabled}
    />

    <hr />

    <SettingSelect
      label={$t('admin.machine_learning_facial_recognition_model')}
      desc={$t('admin.machine_learning_facial_recognition_model_description')}
      name="facial-recognition-model"
      bind:value={workingConfig.facialRecognition.modelName}
      options={[
        { value: 'antelopev2', text: 'antelopev2' },
        { value: 'buffalo_l', text: 'buffalo_l' },
        { value: 'buffalo_m', text: 'buffalo_m' },
        { value: 'buffalo_s', text: 'buffalo_s' },
      ]}
      disabled={disabled || !workingConfig.enabled || !workingConfig.facialRecognition.enabled}
      isEdited={workingConfig.facialRecognition.modelName !== savedConfig.facialRecognition.modelName}
    />

    <SettingInputField
      inputType={SettingInputFieldType.NUMBER}
      label={$t('admin.machine_learning_min_detection_score')}
      description={$t('admin.machine_learning_min_detection_score_description')}
      bind:value={workingConfig.facialRecognition.minScore}
      step="0.01"
      min={0.1}
      max={1}
      disabled={disabled || !workingConfig.enabled || !workingConfig.facialRecognition.enabled}
      isEdited={workingConfig.facialRecognition.minScore !== savedConfig.facialRecognition.minScore}
    />

    <SettingInputField
      inputType={SettingInputFieldType.NUMBER}
      label={$t('admin.machine_learning_max_recognition_distance')}
      description={$t('admin.machine_learning_max_recognition_distance_description')}
      bind:value={workingConfig.facialRecognition.maxDistance}
      step="0.01"
      min={0.1}
      max={2}
      disabled={disabled || !workingConfig.enabled || !workingConfig.facialRecognition.enabled}
      isEdited={workingConfig.facialRecognition.maxDistance !== savedConfig.facialRecognition.maxDistance}
    />

    <SettingInputField
      inputType={SettingInputFieldType.NUMBER}
      label={$t('admin.machine_learning_min_recognized_faces')}
      description={$t('admin.machine_learning_min_recognized_faces_description')}
      bind:value={workingConfig.facialRecognition.minFaces}
      step="1"
      min={1}
      disabled={disabled || !workingConfig.enabled || !workingConfig.facialRecognition.enabled}
      isEdited={workingConfig.facialRecognition.minFaces !== savedConfig.facialRecognition.minFaces}
    />
  </div>
</SettingAccordion>
