<script lang="ts">
  import SettingAccordion from '$lib/components/shared-components/settings/SettingAccordion.svelte';
  import SettingInputField from '$lib/components/shared-components/settings/SettingInputField.svelte';
  import SettingSwitch from '$lib/components/shared-components/settings/SettingSwitch.svelte';
  import { SettingInputFieldType } from '$lib/constants';
  import ImageDescriptionRequeueModal from '$lib/modals/ImageDescriptionRequeueModal.svelte';
  import {
    getImageDescriptionRequeueEstimate,
    MachineLearningHardwareAcceleration,
    Mode2 as RunPodMode,
    type ImageDescriptionConfig,
    type ImageDescriptionRequeueEstimateDto,
    type NsfwDetectionConfig,
    type SystemConfigMachineLearningDto,
    type SystemConfigRunPodServerlessDto,
  } from '@immich/sdk';
  import { Button, modalManager, toastManager } from '@immich/ui';
  import { mdiRefresh } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import SettingSelect from '../SettingSelect.svelte';
  import ImageDescriptionPromptSection from './ImageDescriptionPromptSection.svelte';
  import {
    CUSTOM_MODEL,
    DESCRIPTION_MODEL_PROFILES,
    FALLBACK_MODEL_PROFILES,
    computeRunpodMode,
    findDescriptionProfile,
    formatDuration,
    formatTimestamp,
    hardwareAcceleration,
    imageEnrichmentHardwarePresets,
    isImageEnrichmentHardwareAcceleration,
    type ImageEnrichmentHardwareAcceleration,
  } from './machine-learning-helpers';

  interface Props {
    workingConfig: SystemConfigMachineLearningDto;
    imageDescription: ImageDescriptionConfig;
    savedImageDescription: ImageDescriptionConfig;
    nsfwDetection: NsfwDetectionConfig;
    runpodServerless: SystemConfigRunPodServerlessDto;
    detectedAcceleration: MachineLearningHardwareAcceleration | undefined;
    isMachineLearningConfigEdited: boolean;
    disabled: boolean;
  }

  let {
    workingConfig,
    imageDescription,
    savedImageDescription,
    nsfwDetection,
    runpodServerless,
    detectedAcceleration,
    isMachineLearningConfigEdited,
    disabled,
  }: Props = $props();

  // Curated dropdown model selection ─────────────────────────────────────

  let descriptionModelChoice = $state<string>(CUSTOM_MODEL);
  let fallbackModelChoice = $state<string>(CUSTOM_MODEL);

  // Sync the dropdown selection FROM the underlying config on init / mode change.
  // We never write back to imageDescription.modelName from this effect — only
  // user interaction (the onSelect handlers below) edits the model name.
  $effect(() => {
    const current = imageDescription.modelName;
    descriptionModelChoice = findDescriptionProfile(current) ? current : CUSTOM_MODEL;
  });

  $effect(() => {
    const current = imageDescription.fallbackModelName;
    fallbackModelChoice = FALLBACK_MODEL_PROFILES.some((p) => p.value === current) ? current : CUSTOM_MODEL;
  });

  const onDescriptionModelChange = (next: string | number) => {
    const selected = String(next);
    descriptionModelChoice = selected;
    if (selected !== CUSTOM_MODEL) {
      imageDescription.modelName = selected;
    }
  };

  const onFallbackModelChange = (next: string | number) => {
    const selected = String(next);
    fallbackModelChoice = selected;
    if (selected !== CUSTOM_MODEL) {
      imageDescription.fallbackModelName = selected;
    }
  };

  const descriptionModelOptions = $derived([
    ...DESCRIPTION_MODEL_PROFILES.map((p) => ({
      value: p.value,
      text: `${p.label} — ${p.vramHint}`,
    })),
    { value: CUSTOM_MODEL, text: $t('admin.machine_learning_runpod_custom_model_option') },
  ]);

  const fallbackModelOptions = $derived([
    ...FALLBACK_MODEL_PROFILES.map((p) => ({ value: p.value, text: p.label })),
    { value: CUSTOM_MODEL, text: $t('admin.machine_learning_runpod_custom_model_option') },
  ]);

  // Hardware acceleration ─────────────────────────────────────────────────

  const hardwareAccelerationText = (acceleration: MachineLearningHardwareAcceleration) =>
    acceleration === hardwareAcceleration.Cuda
      ? $t('admin.machine_learning_image_enrichment_hardware_cuda')
      : $t('admin.machine_learning_image_enrichment_hardware_openvino');

  const hardwareAccelerationOptions = $derived([
    {
      value: hardwareAcceleration.Auto,
      text: detectedAcceleration
        ? `${$t('admin.machine_learning_image_enrichment_hardware_auto')} (${hardwareAccelerationText(detectedAcceleration)})`
        : $t('admin.machine_learning_image_enrichment_hardware_auto'),
    },
    {
      value: hardwareAcceleration.OpenVino,
      text: $t('admin.machine_learning_image_enrichment_hardware_openvino'),
    },
    {
      value: hardwareAcceleration.Cuda,
      text: $t('admin.machine_learning_image_enrichment_hardware_cuda'),
    },
  ]);

  const applyImageEnrichmentHardware = (acceleration: MachineLearningHardwareAcceleration | string | number) => {
    const selectedAcceleration = acceleration as MachineLearningHardwareAcceleration;
    const presetAcceleration: ImageEnrichmentHardwareAcceleration | MachineLearningHardwareAcceleration =
      selectedAcceleration === hardwareAcceleration.Auto && detectedAcceleration
        ? detectedAcceleration
        : selectedAcceleration;

    imageDescription.acceleration = selectedAcceleration;

    if (!isImageEnrichmentHardwareAcceleration(presetAcceleration)) {
      return;
    }

    const preset = imageEnrichmentHardwarePresets[presetAcceleration];
    imageDescription.modelName = preset.imageDescriptionModelName;
    imageDescription.fallbackModelName = preset.imageDescriptionFallbackModelName;
    imageDescription.device = preset.imageDescriptionDevice;
    nsfwDetection.modelName = preset.nsfwDetectionModelName;
    nsfwDetection.device = preset.nsfwDetectionDevice;
  };

  // Recommended GPU pools hint ────────────────────────────────────────────

  const runpodMode = $derived<RunPodMode>(
    computeRunpodMode(workingConfig.runpod?.mode, workingConfig.runpod?.enabled ?? false),
  );
  const recommendedPoolsForCurrentModel = $derived(findDescriptionProfile(imageDescription.modelName)?.gpuPoolIds);

  const currentPoolsMatchRecommended = $derived.by(() => {
    const recommended = recommendedPoolsForCurrentModel;
    if (!recommended) {
      return false;
    }
    const current = runpodServerless?.gpuTypeIds ?? [];
    return current.length === recommended.length && current.every((id: string, idx: number) => id === recommended[idx]);
  });

  const applyRecommendedPools = () => {
    const recommended = recommendedPoolsForCurrentModel;
    if (!recommended || !runpodServerless) {
      return;
    }
    runpodServerless.gpuTypeIds = [...recommended];
  };

  // Description status panel state ────────────────────────────────────────

  let descriptionStats = $state<ImageDescriptionRequeueEstimateDto | undefined>(undefined);
  let descriptionStatsError = $state<string | undefined>(undefined);
  let descriptionStatsLoading = $state(false);

  const loadDescriptionStats = async () => {
    descriptionStatsLoading = true;
    descriptionStatsError = undefined;
    try {
      descriptionStats = await getImageDescriptionRequeueEstimate();
    } catch {
      descriptionStatsError = $t('admin.machine_learning_image_description_requeue_modal_error');
    } finally {
      descriptionStatsLoading = false;
    }
  };

  onMount(() => {
    void loadDescriptionStats();
  });

  const handleRequeueClick = async () => {
    const result = await modalManager.show(ImageDescriptionRequeueModal, {});
    if (!result) {
      return;
    }
    if ('deferred' in result && result.deferred) {
      toastManager.primary($t('admin.image_description_requeue_deferred_toast'));
    } else if ('queued' in result) {
      toastManager.primary(
        result.queued
          ? $t('admin.machine_learning_image_description_requeue_started')
          : $t('admin.machine_learning_image_description_requeue_already_in_flight'),
      );
    } else {
      return;
    }
    // Refresh the stats panel so pendingRequeueAt + counts update without a
    // page reload, regardless of whether the prior fetch completed.
    void loadDescriptionStats();
  };
</script>

<SettingAccordion
  key="image-description"
  title={$t('admin.machine_learning_image_description')}
  subtitle={$t('admin.machine_learning_image_description_description')}
>
  <div class="mt-4 ml-4 flex flex-col gap-4">
    {#if savedImageDescription.pendingRequeueAt}
      <div
        class="flex flex-col gap-2 rounded-md border border-yellow-500/50 bg-yellow-100/40 p-3 text-sm sm:flex-row sm:items-center sm:justify-between dark:bg-yellow-900/20"
        data-testid="image-description-pending-banner"
      >
        <span>
          {$t('admin.image_description_pending_banner', {
            values: {
              date: formatTimestamp(savedImageDescription.lastConfigChangeAt),
              count: descriptionStats?.totalAssets?.toLocaleString() ?? '—',
            },
          })}
        </span>
        <Button
          shape="round"
          size="small"
          color="primary"
          leadingIcon={mdiRefresh}
          onclick={handleRequeueClick}
          disabled={disabled || !workingConfig.enabled || !imageDescription.enabled}
        >
          {$t('admin.image_description_pending_banner_action')}
        </Button>
      </div>
    {/if}

    <SettingSelect
      label={$t('admin.machine_learning_image_enrichment_hardware')}
      desc={$t('admin.machine_learning_image_enrichment_hardware_description')}
      name="image-enrichment-hardware"
      bind:value={imageDescription.acceleration}
      options={hardwareAccelerationOptions}
      disabled={disabled || !workingConfig.enabled}
      isEdited={isMachineLearningConfigEdited}
      onSelect={applyImageEnrichmentHardware}
    />

    <SettingSwitch
      title={$t('admin.machine_learning_image_description_enabled')}
      subtitle={$t('admin.machine_learning_image_description_enabled_description')}
      bind:checked={imageDescription.enabled}
      disabled={disabled || !workingConfig.enabled}
    />

    <hr />

    <SettingSelect
      label={$t('admin.machine_learning_image_description_model')}
      value={descriptionModelChoice}
      options={descriptionModelOptions}
      onSelect={onDescriptionModelChange}
      disabled={disabled || !workingConfig.enabled || !imageDescription.enabled}
      isEdited={imageDescription.modelName !== savedImageDescription.modelName}
      name="image-description-model"
    />

    {#if descriptionModelChoice === CUSTOM_MODEL}
      <SettingInputField
        inputType={SettingInputFieldType.TEXT}
        label={$t('admin.machine_learning_custom_model_hf_id')}
        bind:value={imageDescription.modelName}
        required={true}
        disabled={disabled || !workingConfig.enabled || !imageDescription.enabled}
        isEdited={imageDescription.modelName !== savedImageDescription.modelName}
      />
    {/if}

    {#if runpodMode === RunPodMode.Serverless && recommendedPoolsForCurrentModel && !currentPoolsMatchRecommended}
      <div class="-mt-2 mb-4 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:bg-blue-950 dark:text-blue-200">
        <p class="mb-1">
          {$t('admin.machine_learning_image_description_recommended_gpu_pools')}
          <code class="rounded-sm bg-blue-100 px-1 dark:bg-blue-900">
            {recommendedPoolsForCurrentModel.join(', ')}
          </code>
        </p>
        <button
          type="button"
          class="text-xs font-medium underline hover:no-underline disabled:opacity-50"
          onclick={applyRecommendedPools}
          {disabled}
        >
          {$t('admin.machine_learning_image_description_recommended_gpu_apply')}
        </button>
      </div>
    {/if}

    <SettingSelect
      label={$t('admin.machine_learning_image_description_fallback_model')}
      desc={$t('admin.machine_learning_image_description_fallback_model_description')}
      value={fallbackModelChoice}
      options={fallbackModelOptions}
      onSelect={onFallbackModelChange}
      disabled={disabled || !workingConfig.enabled || !imageDescription.enabled}
      isEdited={imageDescription.fallbackModelName !== savedImageDescription.fallbackModelName}
      name="image-description-fallback-model"
    />

    {#if fallbackModelChoice === CUSTOM_MODEL}
      <SettingInputField
        inputType={SettingInputFieldType.TEXT}
        label={$t('admin.machine_learning_custom_fallback_model_hf_id')}
        bind:value={imageDescription.fallbackModelName}
        required={true}
        disabled={disabled || !workingConfig.enabled || !imageDescription.enabled}
        isEdited={imageDescription.fallbackModelName !== savedImageDescription.fallbackModelName}
      />
    {/if}

    <SettingInputField
      inputType={SettingInputFieldType.TEXT}
      label={$t('admin.machine_learning_hardware_device')}
      bind:value={imageDescription.device}
      required={true}
      disabled={disabled || !workingConfig.enabled || !imageDescription.enabled}
      isEdited={imageDescription.device !== savedImageDescription.device}
    />

    <ImageDescriptionPromptSection
      {imageDescription}
      {savedImageDescription}
      workingMlEnabled={workingConfig.enabled}
      {disabled}
    />

    <SettingAccordion
      key="image-description-status-regen"
      title={$t('admin.image_description_status_section')}
      subtitle=""
    >
      <div class="ms-4 mt-4 flex flex-col gap-4">
        {#if descriptionStatsLoading && !descriptionStats}
          <p class="text-sm text-immich-fg/60 dark:text-immich-dark-fg/60">
            {$t('admin.machine_learning_image_description_requeue_modal_loading')}
          </p>
        {:else if descriptionStatsError}
          <p class="text-sm text-red-500">{descriptionStatsError}</p>
        {:else if descriptionStats}
          <dl class="flex flex-col gap-2 text-sm">
            <div class="flex justify-between">
              <dt class="text-immich-fg/70 dark:text-immich-dark-fg/70">
                {$t('admin.image_description_status_last_config_change')}
              </dt>
              <dd class="font-medium">{formatTimestamp(savedImageDescription.lastConfigChangeAt)}</dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-immich-fg/70 dark:text-immich-dark-fg/70">
                {$t('admin.image_description_status_pending_requeue')}
              </dt>
              <dd class="font-medium">{formatTimestamp(savedImageDescription.pendingRequeueAt)}</dd>
            </div>
            <hr class="border-primary/20" />
            <div class="flex justify-between">
              <dt class="text-immich-fg/70 dark:text-immich-dark-fg/70">
                {$t('admin.image_description_status_eligible_assets')}
              </dt>
              <dd class="font-medium">{descriptionStats.totalAssets.toLocaleString()}</dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-immich-fg/70 dark:text-immich-dark-fg/70">
                {$t('admin.image_description_status_with_description')}
              </dt>
              <dd class="font-medium">{descriptionStats.withDescription.toLocaleString()}</dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-immich-fg/70 dark:text-immich-dark-fg/70">
                {$t('admin.image_description_status_pending')}
              </dt>
              <dd class="font-medium">{descriptionStats.withoutDescription.toLocaleString()}</dd>
            </div>
            <hr class="border-primary/20" />
            <div class="flex justify-between">
              <dt class="text-immich-fg/70 dark:text-immich-dark-fg/70">
                {$t('admin.image_description_status_estimated_time')}
              </dt>
              <dd class="font-medium">{formatDuration(descriptionStats.estimatedTotalSeconds)}</dd>
            </div>
          </dl>
        {/if}

        {#if descriptionStatsLoading && descriptionStats}
          <p class="text-xs text-immich-fg/60 dark:text-immich-dark-fg/60">…</p>
        {/if}

        <div class="flex justify-end">
          <Button
            shape="round"
            size="small"
            leadingIcon={mdiRefresh}
            onclick={handleRequeueClick}
            disabled={disabled || !workingConfig.enabled || !imageDescription.enabled}
          >
            {$t('admin.machine_learning_image_description_requeue')}
          </Button>
        </div>
      </div>
    </SettingAccordion>
  </div>
</SettingAccordion>
