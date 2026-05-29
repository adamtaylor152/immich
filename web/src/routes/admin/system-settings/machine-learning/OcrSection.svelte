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

<SettingAccordion key="ocr" title={$t('admin.machine_learning_ocr')} subtitle={$t('admin.machine_learning_ocr_description')}>
  <div class="mt-4 ml-4 flex flex-col gap-4">
    <SettingSwitch
      title={$t('admin.machine_learning_ocr_enabled')}
      subtitle={$t('admin.machine_learning_ocr_enabled_description')}
      bind:checked={workingConfig.ocr.enabled}
      disabled={disabled || !workingConfig.enabled}
    />

    <hr />

    <SettingSelect
      label={$t('admin.machine_learning_ocr_model')}
      desc={$t('admin.machine_learning_ocr_model_description')}
      name="ocr-model"
      bind:value={workingConfig.ocr.modelName}
      options={[
        { text: 'PP-OCRv5_server (Chinese, Japanese and English)', value: 'PP-OCRv5_server' },
        { text: 'PP-OCRv5_mobile (Chinese, Japanese and English)', value: 'PP-OCRv5_mobile' },
        { text: 'PP-OCRv5_mobile (English-only)', value: 'EN__PP-OCRv5_mobile' },
        { text: 'PP-OCRv5_mobile (Greek and English)', value: 'EL__PP-OCRv5_mobile' },
        { text: 'PP-OCRv5_mobile (Korean and English)', value: 'KOREAN__PP-OCRv5_mobile' },
        { text: 'PP-OCRv5_mobile (Latin script languages)', value: 'LATIN__PP-OCRv5_mobile' },
        { text: 'PP-OCRv5_mobile (Russian, Belarusian, Ukrainian and English)', value: 'ESLAV__PP-OCRv5_mobile' },
        { text: 'PP-OCRv5_mobile (Thai and English)', value: 'TH__PP-OCRv5_mobile' },
      ]}
      disabled={disabled || !workingConfig.enabled || !workingConfig.ocr.enabled}
      isEdited={workingConfig.ocr.modelName !== savedConfig.ocr.modelName}
    />

    <SettingInputField
      inputType={SettingInputFieldType.NUMBER}
      label={$t('admin.machine_learning_ocr_min_detection_score')}
      description={$t('admin.machine_learning_ocr_min_detection_score_description')}
      bind:value={workingConfig.ocr.minDetectionScore}
      step="0.1"
      min={0.1}
      max={1}
      disabled={disabled || !workingConfig.enabled || !workingConfig.ocr.enabled}
      isEdited={workingConfig.ocr.minDetectionScore !== savedConfig.ocr.minDetectionScore}
    />

    <SettingInputField
      inputType={SettingInputFieldType.NUMBER}
      label={$t('admin.machine_learning_ocr_min_recognition_score')}
      description={$t('admin.machine_learning_ocr_min_score_recognition_description')}
      bind:value={workingConfig.ocr.minRecognitionScore}
      step="0.1"
      min={0.1}
      max={1}
      disabled={disabled || !workingConfig.enabled || !workingConfig.ocr.enabled}
      isEdited={workingConfig.ocr.minRecognitionScore !== savedConfig.ocr.minRecognitionScore}
    />

    <SettingInputField
      inputType={SettingInputFieldType.NUMBER}
      label={$t('admin.machine_learning_ocr_max_resolution')}
      description={$t('admin.machine_learning_ocr_max_resolution_description')}
      bind:value={workingConfig.ocr.maxResolution}
      min={1}
      disabled={disabled || !workingConfig.enabled || !workingConfig.ocr.enabled}
      isEdited={workingConfig.ocr.maxResolution !== savedConfig.ocr.maxResolution}
    />
  </div>
</SettingAccordion>
