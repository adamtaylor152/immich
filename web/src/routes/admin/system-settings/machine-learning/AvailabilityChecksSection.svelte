<script lang="ts">
  import SettingAccordion from '$lib/components/shared-components/settings/SettingAccordion.svelte';
  import SettingInputField from '$lib/components/shared-components/settings/SettingInputField.svelte';
  import SettingSwitch from '$lib/components/shared-components/settings/SettingSwitch.svelte';
  import { SettingInputFieldType } from '$lib/constants';
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
  key="availability-checks"
  title={$t('admin.machine_learning_availability_checks')}
  subtitle={$t('admin.machine_learning_availability_checks_description')}
>
  <div class="ms-4 mt-4 flex flex-col gap-4">
    <SettingSwitch
      title={$t('admin.machine_learning_availability_checks_enabled')}
      bind:checked={workingConfig.availabilityChecks.enabled}
      disabled={disabled || !workingConfig.enabled}
    />

    <hr />

    <SettingInputField
      inputType={SettingInputFieldType.NUMBER}
      label={$t('admin.machine_learning_availability_checks_interval')}
      bind:value={workingConfig.availabilityChecks.interval}
      description={$t('admin.machine_learning_availability_checks_interval_description')}
      disabled={disabled || !workingConfig.enabled || !workingConfig.availabilityChecks.enabled}
      isEdited={workingConfig.availabilityChecks.interval !== savedConfig.availabilityChecks.interval}
    />

    <SettingInputField
      inputType={SettingInputFieldType.NUMBER}
      label={$t('admin.machine_learning_availability_checks_timeout')}
      bind:value={workingConfig.availabilityChecks.timeout}
      description={$t('admin.machine_learning_availability_checks_timeout_description')}
      disabled={disabled || !workingConfig.enabled || !workingConfig.availabilityChecks.enabled}
      isEdited={workingConfig.availabilityChecks.timeout !== savedConfig.availabilityChecks.timeout}
    />
  </div>
</SettingAccordion>
