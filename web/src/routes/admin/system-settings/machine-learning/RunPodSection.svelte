<script lang="ts">
  import RunPodPanel from '$lib/components/admin-page/settings/machine-learning/RunPodPanel.svelte';
  import RunPodReferralBanner from '$lib/components/admin-page/settings/machine-learning/RunPodReferralBanner.svelte';
  import SettingAccordion from '$lib/components/shared-components/settings/SettingAccordion.svelte';
  import SettingInputField from '$lib/components/shared-components/settings/SettingInputField.svelte';
  import SettingSwitch from '$lib/components/shared-components/settings/SettingSwitch.svelte';
  import { SettingInputFieldType } from '$lib/constants';
  import {
    Mode2 as RunPodMode,
    type SystemConfigMachineLearningDto,
    type SystemConfigRunPodDto,
    type SystemConfigRunPodServerlessDto,
  } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiCheck, mdiOpenInNew } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import SettingSelect from '../SettingSelect.svelte';
  import SettingTextarea from '../SettingTextarea.svelte';
  import { computeRunpodMode } from './machine-learning-helpers';

  interface Props {
    workingConfig: SystemConfigMachineLearningDto;
    runpod: SystemConfigRunPodDto;
    savedRunpod: SystemConfigRunPodDto;
    runpodServerless: SystemConfigRunPodServerlessDto;
    savedRunpodServerless: SystemConfigRunPodServerlessDto;
    disabled: boolean;
  }

  let { workingConfig, runpod, savedRunpod, runpodServerless, savedRunpodServerless, disabled }: Props = $props();

  const runpodMode = $derived<RunPodMode>(computeRunpodMode(runpod.mode, runpod.enabled));
  const savedRunpodMode = $derived<RunPodMode>(computeRunpodMode(savedRunpod.mode, savedRunpod.enabled));

  const applyRunpodMode = (next: string | number) => {
    const mode = String(next) as RunPodMode;
    runpod.mode = mode;
    // Keep the legacy `enabled` flag in sync so older code paths (and the
    // server's back-compat inference) still see a consistent picture.
    runpod.enabled = mode !== RunPodMode.Disabled;
  };

  const runpodModeOptions = $derived([
    {
      value: RunPodMode.Disabled,
      text: $t('admin.machine_learning_runpod_mode_disabled'),
    },
    {
      value: RunPodMode.Pod,
      text: $t('admin.machine_learning_runpod_mode_pod'),
    },
    {
      value: RunPodMode.Serverless,
      text: $t('admin.machine_learning_runpod_mode_serverless'),
    },
  ]);

  const runpodGpuTypeIdsText = $derived((runpodServerless?.gpuTypeIds ?? []).join('\n'));
  const savedRunpodGpuTypeIdsText = $derived((savedRunpodServerless?.gpuTypeIds ?? []).join('\n'));
</script>

<SettingAccordion
  key="runpod"
  title={$t('admin.machine_learning_runpod_pod_accordion_title')}
  subtitle={$t('admin.machine_learning_runpod_pod_accordion_subtitle')}
>
  <div class="ms-4 mt-4 flex flex-col gap-4">
    <RunPodReferralBanner />

    <SettingSelect
      label={$t('admin.machine_learning_runpod_mode')}
      desc={$t('admin.machine_learning_runpod_mode_description')}
      name="runpod-mode"
      value={runpodMode}
      options={runpodModeOptions}
      disabled={disabled || !workingConfig.enabled}
      isEdited={runpodMode !== savedRunpodMode}
      onSelect={applyRunpodMode}
    />

    <hr />

    <div class="flex flex-col gap-1">
      <SettingInputField
        inputType={SettingInputFieldType.PASSWORD}
        label={$t('admin.machine_learning_runpod_api_key')}
        bind:value={runpod.apiKey}
        disabled={disabled || !workingConfig.enabled || runpodMode === 'disabled'}
        isEdited={runpod.apiKey !== savedRunpod.apiKey}
        placeholder={savedRunpod.apiKeyConfigured ? '••••••••••••' : ''}
      />
      {#if savedRunpod.apiKeyConfigured && !runpod.apiKey}
        <span
          class="inline-flex w-fit items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800"
        >
          <Icon icon={mdiCheck} size="12" />
          {$t('admin.machine_learning_runpod_key_saved')}
        </span>
      {/if}
    </div>

    <div class="flex flex-col gap-1">
      <SettingInputField
        inputType={SettingInputFieldType.PASSWORD}
        label={$t('admin.machine_learning_runpod_hf_token')}
        description={$t('admin.machine_learning_runpod_hf_token_description')}
        bind:value={runpod.hfToken as string}
        disabled={disabled || !workingConfig.enabled || runpodMode === 'disabled'}
        isEdited={runpod.hfToken !== savedRunpod.hfToken}
        placeholder={savedRunpod.hfTokenConfigured ? '••••••••••••' : ''}
      />
      {#if savedRunpod.hfTokenConfigured && !runpod.hfToken}
        <span
          class="inline-flex w-fit items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800"
        >
          <Icon icon={mdiCheck} size="12" />
          {$t('admin.machine_learning_runpod_token_saved')}
        </span>
      {/if}
    </div>

    <SettingInputField
      inputType={SettingInputFieldType.TEXT}
      label={$t('admin.machine_learning_runpod_container_image')}
      description={$t('admin.machine_learning_runpod_container_image_description')}
      bind:value={runpod.imageName}
      disabled={disabled || !workingConfig.enabled || runpodMode === 'disabled'}
      isEdited={runpod.imageName !== savedRunpod.imageName}
    />

    {#if runpodMode === 'pod'}
      <SettingInputField
        inputType={SettingInputFieldType.TEXT}
        label={$t('admin.machine_learning_runpod_default_gpu_type_id')}
        description={$t('admin.machine_learning_runpod_default_gpu_type_id_description')}
        bind:value={runpod.defaultGpuTypeId}
        disabled={disabled || !workingConfig.enabled}
        isEdited={runpod.defaultGpuTypeId !== savedRunpod.defaultGpuTypeId}
      />

      <SettingInputField
        inputType={SettingInputFieldType.NUMBER}
        label={$t('admin.machine_learning_runpod_container_disk_gb')}
        bind:value={runpod.containerDiskGb}
        disabled={disabled || !workingConfig.enabled}
        isEdited={runpod.containerDiskGb !== savedRunpod.containerDiskGb}
      />

      <SettingInputField
        inputType={SettingInputFieldType.NUMBER}
        label={$t('admin.machine_learning_runpod_volume_gb')}
        description={$t('admin.machine_learning_runpod_volume_gb_description')}
        bind:value={runpod.volumeGb}
        disabled={disabled || !workingConfig.enabled}
        isEdited={runpod.volumeGb !== savedRunpod.volumeGb}
      />

      <SettingSwitch
        title={$t('admin.machine_learning_runpod_auto_stop_enabled')}
        subtitle={$t('admin.machine_learning_runpod_auto_stop_enabled_description')}
        bind:checked={runpod.autoStopEnabled}
        disabled={disabled || !workingConfig.enabled}
      />

      <SettingInputField
        inputType={SettingInputFieldType.NUMBER}
        label={$t('admin.machine_learning_runpod_auto_stop_grace_minutes')}
        description={$t('admin.machine_learning_runpod_auto_stop_grace_minutes_description')}
        bind:value={runpod.autoStopGraceMinutes}
        disabled={disabled || !workingConfig.enabled || !runpod.autoStopEnabled}
        isEdited={runpod.autoStopGraceMinutes !== savedRunpod.autoStopGraceMinutes}
      />

      <SettingSwitch
        title={$t('admin.machine_learning_runpod_auto_backfill_on_launch')}
        subtitle={$t('admin.machine_learning_runpod_auto_backfill_on_launch_description')}
        bind:checked={runpod.autoBackfillOnLaunch}
        disabled={disabled || !workingConfig.enabled}
      />

      <SettingInputField
        inputType={SettingInputFieldType.NUMBER}
        label={$t('admin.machine_learning_runpod_max_runtime_hours')}
        description={$t('admin.machine_learning_runpod_max_runtime_hours_description')}
        bind:value={runpod.maxRuntimeHours}
        disabled={disabled || !workingConfig.enabled}
        isEdited={runpod.maxRuntimeHours !== savedRunpod.maxRuntimeHours}
      />

      <SettingInputField
        inputType={SettingInputFieldType.NUMBER}
        label={$t('admin.machine_learning_runpod_provision_timeout_minutes')}
        description={$t('admin.machine_learning_runpod_provision_timeout_minutes_description')}
        bind:value={runpod.provisionTimeoutMinutes}
        min={1}
        max={60}
        disabled={disabled || !workingConfig.enabled}
        isEdited={runpod.provisionTimeoutMinutes !== savedRunpod.provisionTimeoutMinutes}
      />
    {:else if runpodMode === 'serverless'}
      <SettingTextarea
        label={$t('admin.machine_learning_runpod_gpu_pool_ids_label')}
        value={runpodGpuTypeIdsText}
        onChange={(text) =>
          (runpodServerless.gpuTypeIds = text
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean))}
        disabled={disabled || !workingConfig.enabled}
        isEdited={runpodGpuTypeIdsText !== savedRunpodGpuTypeIdsText}
      >
        {#snippet descriptionSnippet()}
          <p class="pb-2 text-sm immich-form-label">
            <a
              href="https://docs.runpod.io/references/gpu-types#gpu-pools"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1 underline hover:no-underline"
            >
              {$t('admin.machine_learning_runpod_gpu_pool_reference')}
              <Icon icon={mdiOpenInNew} size="12" />
            </a>.
          </p>
        {/snippet}
      </SettingTextarea>

      <SettingInputField
        inputType={SettingInputFieldType.NUMBER}
        label={$t('admin.machine_learning_runpod_workers_min')}
        description={$t('admin.machine_learning_runpod_workers_min_description')}
        bind:value={runpodServerless.workersMin}
        min={0}
        max={10}
        disabled={disabled || !workingConfig.enabled}
        isEdited={runpodServerless.workersMin !== savedRunpodServerless.workersMin}
      />

      <SettingInputField
        inputType={SettingInputFieldType.NUMBER}
        label={$t('admin.machine_learning_runpod_workers_max')}
        description={$t('admin.machine_learning_runpod_workers_max_description')}
        bind:value={runpodServerless.workersMax}
        min={1}
        max={20}
        disabled={disabled || !workingConfig.enabled}
        isEdited={runpodServerless.workersMax !== savedRunpodServerless.workersMax}
      />

      <SettingInputField
        inputType={SettingInputFieldType.NUMBER}
        label={$t('admin.machine_learning_runpod_idle_timeout_seconds')}
        description={$t('admin.machine_learning_runpod_idle_timeout_seconds_description')}
        bind:value={runpodServerless.idleTimeoutSeconds}
        min={5}
        max={3600}
        disabled={disabled || !workingConfig.enabled}
        isEdited={runpodServerless.idleTimeoutSeconds !== savedRunpodServerless.idleTimeoutSeconds}
      />

      <SettingInputField
        inputType={SettingInputFieldType.NUMBER}
        label={$t('admin.machine_learning_runpod_execution_timeout_ms')}
        description={$t('admin.machine_learning_runpod_execution_timeout_ms_description')}
        bind:value={runpodServerless.executionTimeoutMs}
        min={5000}
        max={3_600_000}
        disabled={disabled || !workingConfig.enabled}
        isEdited={runpodServerless.executionTimeoutMs !== savedRunpodServerless.executionTimeoutMs}
      />

      <SettingSelect
        label={$t('admin.machine_learning_runpod_scaler_type')}
        desc={$t('admin.machine_learning_runpod_scaler_type_description')}
        name="runpod-scaler-type"
        bind:value={runpodServerless.scalerType}
        options={[
          { value: 'QUEUE_DELAY', text: $t('admin.machine_learning_runpod_scaler_type_queue_delay') },
          { value: 'REQUEST_COUNT', text: $t('admin.machine_learning_runpod_scaler_type_request_count') },
        ]}
        disabled={disabled || !workingConfig.enabled}
        isEdited={runpodServerless.scalerType !== savedRunpodServerless.scalerType}
      />

      <SettingInputField
        inputType={SettingInputFieldType.NUMBER}
        label={$t('admin.machine_learning_runpod_scaler_value')}
        description={$t('admin.machine_learning_runpod_scaler_value_description')}
        bind:value={runpodServerless.scalerValue}
        min={1}
        max={300}
        disabled={disabled || !workingConfig.enabled}
        isEdited={runpodServerless.scalerValue !== savedRunpodServerless.scalerValue}
      />
    {/if}

    <hr />

    <RunPodPanel {workingConfig} />
  </div>
</SettingAccordion>
