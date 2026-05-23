<script lang="ts">
  import RunPodPanel from '$lib/components/admin-page/settings/machine-learning/RunPodPanel.svelte';
  import RunPodReferralBanner from '$lib/components/admin-page/settings/machine-learning/RunPodReferralBanner.svelte';
  import SettingAccordion from '$lib/components/shared-components/settings/SettingAccordion.svelte';
  import SettingInputField from '$lib/components/shared-components/settings/SettingInputField.svelte';
  import SettingSelect from './SettingSelect.svelte';
  import SettingTextarea from './SettingTextarea.svelte';
  import SettingSwitch from '$lib/components/shared-components/settings/SettingSwitch.svelte';
  import SettingButtonsRow from '$lib/components/shared-components/settings/SystemConfigButtonRow.svelte';
  import { SettingInputFieldType } from '$lib/constants';
  import FormatMessage from '$lib/elements/FormatMessage.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { systemConfigManager } from '$lib/managers/system-config-manager.svelte';
  import ImageDescriptionRequeueModal from '$lib/modals/ImageDescriptionRequeueModal.svelte';
  import { Button, IconButton, modalManager, toastManager } from '@immich/ui';
  import { mdiPlus, mdiRefresh, mdiTrashCanOutline } from '@mdi/js';
  import {
    getMachineLearningHardware,
    MachineLearningHardwareAcceleration,
    Mode2 as RunPodMode,
    PlaceholderValidation,
    Style,
    type SystemConfigMachineLearningDto,
  } from '@immich/sdk';
  import { isEqual } from 'lodash-es';
  import { t } from 'svelte-i18n';
  import { onDestroy, onMount } from 'svelte';
  import { fade } from 'svelte/transition';

  const disabled = $derived(featureFlagsManager.value.configFile);
  const config = $derived(systemConfigManager.value);
  let configToEdit = $state(systemConfigManager.cloneValue());
  let detectedAcceleration = $state<MachineLearningHardwareAcceleration>();
  const imageDescription = $derived(configToEdit.machineLearning.imageDescription!);
  const savedImageDescription = $derived(config.machineLearning.imageDescription!);
  const nsfwDetection = $derived(configToEdit.machineLearning.nsfwDetection!);
  const savedNsfwDetection = $derived(config.machineLearning.nsfwDetection!);
  // Zod's `.default(...)` on runpod makes it optional in the generated DTO
  // type even though the server always materialises it. Mirror the
  // imageDescription/nsfwDetection pattern above so the template doesn't
  // need to repeat the non-null assertion everywhere.
  const runpod = $derived(configToEdit.machineLearning.runpod!);
  const savedRunpod = $derived(config.machineLearning.runpod!);
  // Effective UI mode. Older configs may have `mode` undefined while
  // `enabled === true`; treat that as legacy pod mode so the form doesn't
  // surprise the admin.
  const runpodMode = $derived<RunPodMode>(
    runpod.mode && runpod.mode !== RunPodMode.Disabled
      ? runpod.mode
      : runpod.enabled
        ? RunPodMode.Pod
        : RunPodMode.Disabled,
  );

  const applyRunpodMode = (next: string | number) => {
    const mode = String(next) as RunPodMode;
    runpod.mode = mode;
    // Keep the legacy `enabled` flag in sync so older code paths (and the
    // server's back-compat inference) still see a consistent picture.
    runpod.enabled = mode !== RunPodMode.Disabled;
  };

  const runpodModeOptions = [
    {
      value: RunPodMode.Disabled,
      text: 'Disabled — use only the local URLs above',
    },
    {
      value: RunPodMode.Pod,
      text: 'Dedicated Pod — cheapest active rate; admin stops it manually',
    },
    {
      value: RunPodMode.Serverless,
      text: 'On-demand Serverless — scales to zero; higher per-second cost but $0 idle',
    },
  ];

  const runpodServerless = $derived(runpod.serverless!);
  const savedRunpodServerless = $derived(savedRunpod.serverless!);
  const runpodGpuTypeIdsText = $derived((runpod.serverless?.gpuTypeIds ?? []).join('\n'));
  const savedRunpodGpuTypeIdsText = $derived((savedRunpod.serverless?.gpuTypeIds ?? []).join('\n'));

  $effect(() => {
    const enhancedVideo = configToEdit.machineLearning.duplicateDetection.enhancedVideo;
    if (enhancedVideo.minMatchingFrames > enhancedVideo.frameCount) {
      enhancedVideo.minMatchingFrames = enhancedVideo.frameCount;
    }
  });

  const hardwareAcceleration = {
    Auto: MachineLearningHardwareAcceleration.Auto,
    OpenVino: MachineLearningHardwareAcceleration.Openvino,
    Cuda: MachineLearningHardwareAcceleration.Cuda,
  } as const;

  type ImageEnrichmentHardwareAcceleration =
    | MachineLearningHardwareAcceleration.Openvino
    | MachineLearningHardwareAcceleration.Cuda;

  const isImageEnrichmentHardwareAcceleration = (
    acceleration: MachineLearningHardwareAcceleration,
  ): acceleration is ImageEnrichmentHardwareAcceleration =>
    acceleration === hardwareAcceleration.OpenVino || acceleration === hardwareAcceleration.Cuda;

  const hardwareAccelerationText = (acceleration: MachineLearningHardwareAcceleration) =>
    acceleration === hardwareAcceleration.Cuda
      ? $t('admin.machine_learning_image_enrichment_hardware_cuda')
      : $t('admin.machine_learning_image_enrichment_hardware_openvino');

  const imageEnrichmentHardwarePresets: Record<
    ImageEnrichmentHardwareAcceleration,
    {
      imageDescriptionModelName: string;
      imageDescriptionFallbackModelName: string;
      imageDescriptionDevice: string;
      nsfwDetectionModelName: string;
      nsfwDetectionDevice: string;
    }
  > = {
    [hardwareAcceleration.OpenVino]: {
      imageDescriptionModelName: 'Qwen/Qwen2.5-VL-3B-Instruct',
      imageDescriptionFallbackModelName: 'microsoft/Florence-2-base-ft',
      imageDescriptionDevice: 'AUTO',
      nsfwDetectionModelName: 'onnx-community/nsfw_image_detection-ONNX',
      nsfwDetectionDevice: 'AUTO',
    },
    [hardwareAcceleration.Cuda]: {
      imageDescriptionModelName: 'Qwen/Qwen2.5-VL-3B-Instruct',
      imageDescriptionFallbackModelName: 'microsoft/Florence-2-base-ft',
      imageDescriptionDevice: 'AUTO',
      nsfwDetectionModelName: 'onnx-community/nsfw_image_detection-ONNX',
      nsfwDetectionDevice: 'AUTO',
    },
  };

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

  let managedRunPodUrl = $state<string>('');
  let managedUrlTimer: ReturnType<typeof setInterval> | undefined;

  const refreshManagedUrl = async () => {
    try {
      const response = await fetch('/api/runpod/pods/current', { credentials: 'include' });
      if (!response.ok) {
        // Pod state endpoint failed — assume nothing is managed rather than
        // leaving a stale URL in the chip.
        managedRunPodUrl = '';
        return;
      }
      const state = (await response.json()) as { status?: string; mlUrl?: string };
      managedRunPodUrl = state.status === 'running' && state.mlUrl ? state.mlUrl : '';
    } catch {
      managedRunPodUrl = '';
    }
  };

  onMount(() => {
    void detectMachineLearningHardware();
    void refreshManagedUrl();
    managedUrlTimer = setInterval(() => void refreshManagedUrl(), 10_000);
  });

  onDestroy(() => {
    if (managedUrlTimer) {
      clearInterval(managedUrlTimer);
    }
  });

  const detectMachineLearningHardware = async () => {
    try {
      const hardware = await getMachineLearningHardware();
      const preferredAcceleration = hardware.preferredAcceleration;

      if (isImageEnrichmentHardwareAcceleration(preferredAcceleration)) {
        detectedAcceleration = preferredAcceleration;
        if (imageDescription.acceleration === hardwareAcceleration.Auto) {
          applyImageEnrichmentHardware(preferredAcceleration);
        }
      }
    } catch {
      detectedAcceleration = undefined;
    }
  };

  const applyImageEnrichmentHardware = (acceleration: MachineLearningHardwareAcceleration | string | number) => {
    const selectedAcceleration = acceleration as MachineLearningHardwareAcceleration;
    const presetAcceleration =
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

  const isMachineLearningConfigEdited = (machineLearning: SystemConfigMachineLearningDto) =>
    !isEqual(machineLearning, config.machineLearning);

  // List-type prompt fields are displayed as newline-joined text and parsed back on input.
  // Using $derived (not $state) ensures the textareas always reflect the live config — including
  // after a Reset (which replaces configToEdit wholesale via SystemConfigButtonRow).
  const parseLines = (text: string): string[] =>
    text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

  const lookForText = $derived((imageDescription.prompt?.lookFor ?? []).join('\n'));
  const customVocabularyText = $derived((imageDescription.prompt?.customVocabulary ?? []).join('\n'));
  const nsfwIndicatorsText = $derived((imageDescription.prompt?.nsfwIndicators ?? []).join('\n'));
  const medicalIndicatorsText = $derived((imageDescription.prompt?.medicalIndicators ?? []).join('\n'));
  const forbiddenInferencesText = $derived((imageDescription.prompt?.forbiddenInferences ?? []).join('\n'));
  const rawPromptTemplateText = $derived(imageDescription.prompt?.advanced?.rawPromptTemplate ?? '');

  const handleRequeueClick = async () => {
    const result = await modalManager.show(ImageDescriptionRequeueModal, {});
    if (result) {
      toastManager.primary(
        result.queued
          ? $t('admin.machine_learning_image_description_requeue_started')
          : $t('admin.machine_learning_image_description_requeue_already_in_flight'),
      );
    }
  };
</script>

<div class="mt-2">
  <div in:fade={{ duration: 500 }}>
    <form autocomplete="off" class="mx-4 mt-4" onsubmit={(event) => event.preventDefault()}>
      <div class="flex flex-col gap-4">
        <SettingSwitch
          title={$t('admin.machine_learning_enabled')}
          subtitle={$t('admin.machine_learning_enabled_description')}
          {disabled}
          bind:checked={configToEdit.machineLearning.enabled}
        />

        <hr />

        {#if managedRunPodUrl}
          <div class="rounded-sm border border-immich-gray/30 bg-immich-bg/30 p-2 font-mono text-xs break-all">
            <span class="font-sans text-immich-gray not-italic">Managed by RunPod (auto):</span>
            {managedRunPodUrl}
          </div>
        {/if}

        <div>
          {#each configToEdit.machineLearning.urls as _, i (i)}
            <SettingInputField
              inputType={SettingInputFieldType.TEXT}
              label={i === 0 ? $t('url') : undefined}
              description={i === 0 ? $t('admin.machine_learning_url_description') : undefined}
              bind:value={configToEdit.machineLearning.urls[i]}
              required={i === 0}
              disabled={disabled || !configToEdit.machineLearning.enabled}
              isEdited={i === 0 && !isEqual(configToEdit.machineLearning.urls, config.machineLearning.urls)}
            >
              {#snippet trailingSnippet()}
                {#if configToEdit.machineLearning.urls.length > 1}
                  <IconButton
                    aria-label=""
                    onclick={() => configToEdit.machineLearning.urls.splice(i, 1)}
                    icon={mdiTrashCanOutline}
                    color="danger"
                  />
                {/if}
              {/snippet}
            </SettingInputField>
          {/each}
        </div>

        <div class="flex justify-end">
          <Button
            class="mb-2"
            size="small"
            shape="round"
            leadingIcon={mdiPlus}
            onclick={() => configToEdit.machineLearning.urls.push('')}
            disabled={disabled || !configToEdit.machineLearning.enabled}>{$t('add_url')}</Button
          >
        </div>
      </div>

      <SettingAccordion
        key="runpod"
        title="Cloud GPU (RunPod)"
        subtitle="Provision the ML container on RunPod when local hardware can't keep up. Choose Pod for cheap active rates, or Serverless for scale-to-zero billing."
      >
        <div class="ms-4 mt-4 flex flex-col gap-4">
          <RunPodReferralBanner />

          <SettingSelect
            label="Mode"
            desc="Pod = a dedicated GPU pod you stop manually (cheapest while active). Serverless = an on-demand endpoint that scales to zero (~4× per-second cost but $0 when idle)."
            name="runpod-mode"
            value={runpodMode}
            options={runpodModeOptions}
            disabled={disabled || !configToEdit.machineLearning.enabled}
            isEdited={runpodMode !==
              (savedRunpod.mode && savedRunpod.mode !== RunPodMode.Disabled
                ? savedRunpod.mode
                : savedRunpod.enabled
                  ? RunPodMode.Pod
                  : RunPodMode.Disabled)}
            onSelect={applyRunpodMode}
          />

          <hr />

          <SettingInputField
            inputType={SettingInputFieldType.PASSWORD}
            label="API key"
            description="Anyone with admin access to Immich (or database read access) can spend money with this key. Generate one with pod + serverless scope."
            bind:value={runpod.apiKey}
            disabled={disabled || !configToEdit.machineLearning.enabled || runpodMode === 'disabled'}
            isEdited={runpod.apiKey !== savedRunpod.apiKey}
          />

          <SettingInputField
            inputType={SettingInputFieldType.TEXT}
            label="Container image"
            description="The ML container image to run on RunPod. Defaults to the fork's RunPod-tuned CUDA build."
            bind:value={runpod.imageName}
            disabled={disabled || !configToEdit.machineLearning.enabled || runpodMode === 'disabled'}
            isEdited={runpod.imageName !== savedRunpod.imageName}
          />

          {#if runpodMode === 'pod'}
            <SettingInputField
              inputType={SettingInputFieldType.TEXT}
              label="Default GPU type"
              description="Pre-fill for the launch dialog (e.g. 'NVIDIA RTX A5000')."
              bind:value={runpod.defaultGpuTypeId}
              disabled={disabled || !configToEdit.machineLearning.enabled}
              isEdited={runpod.defaultGpuTypeId !== savedRunpod.defaultGpuTypeId}
            />

            <SettingInputField
              inputType={SettingInputFieldType.NUMBER}
              label="Container disk (GB)"
              bind:value={runpod.containerDiskGb}
              disabled={disabled || !configToEdit.machineLearning.enabled}
              isEdited={runpod.containerDiskGb !== savedRunpod.containerDiskGb}
            />

            <SettingInputField
              inputType={SettingInputFieldType.NUMBER}
              label="Persistent volume (GB)"
              description="Mounted at /cache for model weight reuse across stop/start. 0 disables the volume."
              bind:value={runpod.volumeGb}
              disabled={disabled || !configToEdit.machineLearning.enabled}
              isEdited={runpod.volumeGb !== savedRunpod.volumeGb}
            />

            <SettingSwitch
              title="Auto-stop when idle"
              subtitle="Stop the pod when no ML jobs have run for the grace window. Strongly recommended."
              bind:checked={runpod.autoStopEnabled}
              disabled={disabled || !configToEdit.machineLearning.enabled}
            />

            <SettingInputField
              inputType={SettingInputFieldType.NUMBER}
              label="Idle grace (minutes)"
              description="How long the pod can stay idle before auto-stop fires."
              bind:value={runpod.autoStopGraceMinutes}
              disabled={disabled || !configToEdit.machineLearning.enabled || !runpod.autoStopEnabled}
              isEdited={runpod.autoStopGraceMinutes !== savedRunpod.autoStopGraceMinutes}
            />

            <SettingSwitch
              title="Auto-backfill on launch"
              subtitle="When the pod reaches Running, queue smart search, face detection, OCR, duplicates, image description, and NSFW for every eligible asset."
              bind:checked={runpod.autoBackfillOnLaunch}
              disabled={disabled || !configToEdit.machineLearning.enabled}
            />

            <SettingInputField
              inputType={SettingInputFieldType.NUMBER}
              label="Max runtime (hours)"
              description="Hard ceiling — pod is force-stopped if it runs longer than this, regardless of activity. Default 24."
              bind:value={runpod.maxRuntimeHours}
              disabled={disabled || !configToEdit.machineLearning.enabled}
              isEdited={runpod.maxRuntimeHours !== savedRunpod.maxRuntimeHours}
            />
          {:else if runpodMode === 'serverless'}
            <SettingTextarea
              label="GPU type IDs (one per line, in priority order)"
              description="RunPod tries each ID in order until one is available. Example: 'NVIDIA RTX A5000'"
              value={runpodGpuTypeIdsText}
              onChange={(text) =>
                (runpodServerless.gpuTypeIds = text
                  .split('\n')
                  .map((l) => l.trim())
                  .filter(Boolean))}
              disabled={disabled || !configToEdit.machineLearning.enabled}
              isEdited={runpodGpuTypeIdsText !== savedRunpodGpuTypeIdsText}
            />

            <SettingInputField
              inputType={SettingInputFieldType.NUMBER}
              label="Min workers"
              description="Keep at least this many workers warm. 0 = true scale-to-zero (cold start ~30–60s on first request)."
              bind:value={runpodServerless.workersMin}
              min={0}
              max={10}
              disabled={disabled || !configToEdit.machineLearning.enabled}
              isEdited={runpodServerless.workersMin !== savedRunpodServerless.workersMin}
            />

            <SettingInputField
              inputType={SettingInputFieldType.NUMBER}
              label="Max workers"
              description="Upper bound on concurrent workers. RunPod's scaler will burst up to this when queues build."
              bind:value={runpodServerless.workersMax}
              min={1}
              max={20}
              disabled={disabled || !configToEdit.machineLearning.enabled}
              isEdited={runpodServerless.workersMax !== savedRunpodServerless.workersMax}
            />

            <SettingInputField
              inputType={SettingInputFieldType.NUMBER}
              label="Idle timeout (seconds)"
              description="How long a worker keeps running after its last request before scaling down."
              bind:value={runpodServerless.idleTimeoutSeconds}
              min={5}
              max={3600}
              disabled={disabled || !configToEdit.machineLearning.enabled}
              isEdited={runpodServerless.idleTimeoutSeconds !== savedRunpodServerless.idleTimeoutSeconds}
            />

            <SettingInputField
              inputType={SettingInputFieldType.NUMBER}
              label="Execution timeout (ms)"
              description="Per-request timeout. ML jobs typically take seconds; the default 10 min ceiling is forgiving."
              bind:value={runpodServerless.executionTimeoutMs}
              min={5000}
              max={3_600_000}
              disabled={disabled || !configToEdit.machineLearning.enabled}
              isEdited={runpodServerless.executionTimeoutMs !== savedRunpodServerless.executionTimeoutMs}
            />

            <SettingSelect
              label="Scaler type"
              desc="QUEUE_DELAY scales on queued requests; REQUEST_COUNT on absolute throughput."
              name="runpod-scaler-type"
              bind:value={runpodServerless.scalerType}
              options={[
                { value: 'QUEUE_DELAY', text: 'QUEUE_DELAY (recommended)' },
                { value: 'REQUEST_COUNT', text: 'REQUEST_COUNT' },
              ]}
              disabled={disabled || !configToEdit.machineLearning.enabled}
              isEdited={runpodServerless.scalerType !== savedRunpodServerless.scalerType}
            />

            <SettingInputField
              inputType={SettingInputFieldType.NUMBER}
              label="Scaler value"
              description="Threshold for the scaler. For QUEUE_DELAY, scales when delay exceeds this many seconds."
              bind:value={runpodServerless.scalerValue}
              min={1}
              max={300}
              disabled={disabled || !configToEdit.machineLearning.enabled}
              isEdited={runpodServerless.scalerValue !== savedRunpodServerless.scalerValue}
            />
          {/if}

          <hr />

          <RunPodPanel />
        </div>
      </SettingAccordion>

      <SettingAccordion
        key="availability-checks"
        title={$t('admin.machine_learning_availability_checks')}
        subtitle={$t('admin.machine_learning_availability_checks_description')}
      >
        <div class="ms-4 mt-4 flex flex-col gap-4">
          <SettingSwitch
            title={$t('admin.machine_learning_availability_checks_enabled')}
            bind:checked={configToEdit.machineLearning.availabilityChecks.enabled}
            disabled={disabled || !configToEdit.machineLearning.enabled}
          />

          <hr />

          <SettingInputField
            inputType={SettingInputFieldType.NUMBER}
            label={$t('admin.machine_learning_availability_checks_interval')}
            bind:value={configToEdit.machineLearning.availabilityChecks.interval}
            description={$t('admin.machine_learning_availability_checks_interval_description')}
            disabled={disabled ||
              !configToEdit.machineLearning.enabled ||
              !configToEdit.machineLearning.availabilityChecks.enabled}
            isEdited={configToEdit.machineLearning.availabilityChecks.interval !==
              config.machineLearning.availabilityChecks.interval}
          />

          <SettingInputField
            inputType={SettingInputFieldType.NUMBER}
            label={$t('admin.machine_learning_availability_checks_timeout')}
            bind:value={configToEdit.machineLearning.availabilityChecks.timeout}
            description={$t('admin.machine_learning_availability_checks_timeout_description')}
            disabled={disabled ||
              !configToEdit.machineLearning.enabled ||
              !configToEdit.machineLearning.availabilityChecks.enabled}
            isEdited={configToEdit.machineLearning.availabilityChecks.timeout !==
              config.machineLearning.availabilityChecks.timeout}
          />
        </div>
      </SettingAccordion>

      <SettingAccordion
        key="smart-search"
        title={$t('admin.machine_learning_smart_search')}
        subtitle={$t('admin.machine_learning_smart_search_description')}
      >
        <div class="ms-4 mt-4 flex flex-col gap-4">
          <SettingSwitch
            title={$t('admin.machine_learning_smart_search_enabled')}
            subtitle={$t('admin.machine_learning_smart_search_enabled_description')}
            bind:checked={configToEdit.machineLearning.clip.enabled}
            disabled={disabled || !configToEdit.machineLearning.enabled}
          />

          <hr />

          <SettingInputField
            inputType={SettingInputFieldType.TEXT}
            label={$t('admin.machine_learning_clip_model')}
            bind:value={configToEdit.machineLearning.clip.modelName}
            required={true}
            disabled={disabled || !configToEdit.machineLearning.enabled || !configToEdit.machineLearning.clip.enabled}
            isEdited={configToEdit.machineLearning.clip.modelName !== config.machineLearning.clip.modelName}
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

      <SettingAccordion
        key="duplicate-detection"
        title={$t('admin.machine_learning_duplicate_detection')}
        subtitle={$t('admin.machine_learning_duplicate_detection_setting_description')}
      >
        <div class="ms-4 mt-4 flex flex-col gap-4">
          <SettingSwitch
            title={$t('admin.machine_learning_duplicate_detection_enabled')}
            subtitle={$t('admin.machine_learning_duplicate_detection_enabled_description')}
            bind:checked={configToEdit.machineLearning.duplicateDetection.enabled}
            disabled={disabled || !configToEdit.machineLearning.enabled || !configToEdit.machineLearning.clip.enabled}
          />

          <hr />

          <SettingInputField
            inputType={SettingInputFieldType.NUMBER}
            label={$t('admin.machine_learning_max_detection_distance')}
            bind:value={configToEdit.machineLearning.duplicateDetection.maxDistance}
            step="0.0005"
            min={0.001}
            max={0.1}
            description={$t('admin.machine_learning_max_detection_distance_description')}
            disabled={disabled || !featureFlagsManager.value.duplicateDetection}
            isEdited={configToEdit.machineLearning.duplicateDetection.maxDistance !==
              config.machineLearning.duplicateDetection.maxDistance}
          />

          <hr />

          <SettingSwitch
            title={$t('admin.enhanced_video_duplicate_detection_enabled')}
            subtitle={$t('admin.enhanced_video_duplicate_detection_enabled_description')}
            bind:checked={configToEdit.machineLearning.duplicateDetection.enhancedVideo.enabled}
            disabled={disabled || !featureFlagsManager.value.duplicateDetection}
          />

          <SettingInputField
            inputType={SettingInputFieldType.NUMBER}
            label={$t('admin.enhanced_video_duplicate_detection_frame_count')}
            bind:value={configToEdit.machineLearning.duplicateDetection.enhancedVideo.frameCount}
            step="1"
            min={2}
            max={8}
            description={$t('admin.enhanced_video_duplicate_detection_frame_count_description')}
            disabled={disabled || !featureFlagsManager.value.duplicateDetection}
            isEdited={configToEdit.machineLearning.duplicateDetection.enhancedVideo.frameCount !==
              config.machineLearning.duplicateDetection.enhancedVideo.frameCount}
          />

          <SettingInputField
            inputType={SettingInputFieldType.NUMBER}
            label={$t('admin.enhanced_video_duplicate_detection_min_matching_frames')}
            bind:value={configToEdit.machineLearning.duplicateDetection.enhancedVideo.minMatchingFrames}
            step="1"
            min={1}
            max={configToEdit.machineLearning.duplicateDetection.enhancedVideo.frameCount}
            description={$t('admin.enhanced_video_duplicate_detection_min_matching_frames_description')}
            disabled={disabled || !featureFlagsManager.value.duplicateDetection}
            isEdited={configToEdit.machineLearning.duplicateDetection.enhancedVideo.minMatchingFrames !==
              config.machineLearning.duplicateDetection.enhancedVideo.minMatchingFrames}
          />

          <SettingInputField
            inputType={SettingInputFieldType.NUMBER}
            label={$t('admin.enhanced_video_duplicate_detection_max_distance')}
            bind:value={configToEdit.machineLearning.duplicateDetection.enhancedVideo.maxDistance}
            step="0.0005"
            min={0.001}
            max={0.1}
            description={$t('admin.enhanced_video_duplicate_detection_max_distance_description')}
            disabled={disabled || !featureFlagsManager.value.duplicateDetection}
            isEdited={configToEdit.machineLearning.duplicateDetection.enhancedVideo.maxDistance !==
              config.machineLearning.duplicateDetection.enhancedVideo.maxDistance}
          />
        </div>
      </SettingAccordion>

      <SettingAccordion
        key="facial-recognition"
        title={$t('admin.machine_learning_facial_recognition')}
        subtitle={$t('admin.machine_learning_facial_recognition_description')}
      >
        <div class="ms-4 mt-4 flex flex-col gap-4">
          <SettingSwitch
            title={$t('admin.machine_learning_facial_recognition_setting')}
            subtitle={$t('admin.machine_learning_facial_recognition_setting_description')}
            bind:checked={configToEdit.machineLearning.facialRecognition.enabled}
            disabled={disabled || !configToEdit.machineLearning.enabled}
          />

          <hr />

          <SettingSelect
            label={$t('admin.machine_learning_facial_recognition_model')}
            desc={$t('admin.machine_learning_facial_recognition_model_description')}
            name="facial-recognition-model"
            bind:value={configToEdit.machineLearning.facialRecognition.modelName}
            options={[
              { value: 'antelopev2', text: 'antelopev2' },
              { value: 'buffalo_l', text: 'buffalo_l' },
              { value: 'buffalo_m', text: 'buffalo_m' },
              { value: 'buffalo_s', text: 'buffalo_s' },
            ]}
            disabled={disabled ||
              !configToEdit.machineLearning.enabled ||
              !configToEdit.machineLearning.facialRecognition.enabled}
            isEdited={configToEdit.machineLearning.facialRecognition.modelName !==
              config.machineLearning.facialRecognition.modelName}
          />

          <SettingInputField
            inputType={SettingInputFieldType.NUMBER}
            label={$t('admin.machine_learning_min_detection_score')}
            description={$t('admin.machine_learning_min_detection_score_description')}
            bind:value={configToEdit.machineLearning.facialRecognition.minScore}
            step="0.01"
            min={0.1}
            max={1}
            disabled={disabled ||
              !configToEdit.machineLearning.enabled ||
              !configToEdit.machineLearning.facialRecognition.enabled}
            isEdited={configToEdit.machineLearning.facialRecognition.minScore !==
              config.machineLearning.facialRecognition.minScore}
          />

          <SettingInputField
            inputType={SettingInputFieldType.NUMBER}
            label={$t('admin.machine_learning_max_recognition_distance')}
            description={$t('admin.machine_learning_max_recognition_distance_description')}
            bind:value={configToEdit.machineLearning.facialRecognition.maxDistance}
            step="0.01"
            min={0.1}
            max={2}
            disabled={disabled ||
              !configToEdit.machineLearning.enabled ||
              !configToEdit.machineLearning.facialRecognition.enabled}
            isEdited={configToEdit.machineLearning.facialRecognition.maxDistance !==
              config.machineLearning.facialRecognition.maxDistance}
          />

          <SettingInputField
            inputType={SettingInputFieldType.NUMBER}
            label={$t('admin.machine_learning_min_recognized_faces')}
            description={$t('admin.machine_learning_min_recognized_faces_description')}
            bind:value={configToEdit.machineLearning.facialRecognition.minFaces}
            step="1"
            min={1}
            disabled={disabled ||
              !configToEdit.machineLearning.enabled ||
              !configToEdit.machineLearning.facialRecognition.enabled}
            isEdited={configToEdit.machineLearning.facialRecognition.minFaces !==
              config.machineLearning.facialRecognition.minFaces}
          />
        </div>
      </SettingAccordion>

      <SettingAccordion
        key="ocr"
        title={$t('admin.machine_learning_ocr')}
        subtitle={$t('admin.machine_learning_ocr_description')}
      >
        <div class="mt-4 ml-4 flex flex-col gap-4">
          <SettingSwitch
            title={$t('admin.machine_learning_ocr_enabled')}
            subtitle={$t('admin.machine_learning_ocr_enabled_description')}
            bind:checked={configToEdit.machineLearning.ocr.enabled}
            disabled={disabled || !configToEdit.machineLearning.enabled}
          />

          <hr />

          <SettingSelect
            label={$t('admin.machine_learning_ocr_model')}
            desc={$t('admin.machine_learning_ocr_model_description')}
            name="ocr-model"
            bind:value={configToEdit.machineLearning.ocr.modelName}
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
            disabled={disabled || !configToEdit.machineLearning.enabled || !configToEdit.machineLearning.ocr.enabled}
            isEdited={configToEdit.machineLearning.ocr.modelName !== config.machineLearning.ocr.modelName}
          />

          <SettingInputField
            inputType={SettingInputFieldType.NUMBER}
            label={$t('admin.machine_learning_ocr_min_detection_score')}
            description={$t('admin.machine_learning_ocr_min_detection_score_description')}
            bind:value={configToEdit.machineLearning.ocr.minDetectionScore}
            step="0.1"
            min={0.1}
            max={1}
            disabled={disabled || !configToEdit.machineLearning.enabled || !configToEdit.machineLearning.ocr.enabled}
            isEdited={configToEdit.machineLearning.ocr.minDetectionScore !==
              config.machineLearning.ocr.minDetectionScore}
          />

          <SettingInputField
            inputType={SettingInputFieldType.NUMBER}
            label={$t('admin.machine_learning_ocr_min_recognition_score')}
            description={$t('admin.machine_learning_ocr_min_score_recognition_description')}
            bind:value={configToEdit.machineLearning.ocr.minRecognitionScore}
            step="0.1"
            min={0.1}
            max={1}
            disabled={disabled || !configToEdit.machineLearning.enabled || !configToEdit.machineLearning.ocr.enabled}
            isEdited={configToEdit.machineLearning.ocr.minRecognitionScore !==
              config.machineLearning.ocr.minRecognitionScore}
          />

          <SettingInputField
            inputType={SettingInputFieldType.NUMBER}
            label={$t('admin.machine_learning_ocr_max_resolution')}
            description={$t('admin.machine_learning_ocr_max_resolution_description')}
            bind:value={configToEdit.machineLearning.ocr.maxResolution}
            min={1}
            disabled={disabled || !configToEdit.machineLearning.enabled || !configToEdit.machineLearning.ocr.enabled}
            isEdited={configToEdit.machineLearning.ocr.maxResolution !== config.machineLearning.ocr.maxResolution}
          />
        </div>
      </SettingAccordion>

      <SettingAccordion
        key="image-description"
        title={$t('admin.machine_learning_image_description')}
        subtitle={$t('admin.machine_learning_image_description_description')}
      >
        <div class="mt-4 ml-4 flex flex-col gap-4">
          <SettingSelect
            label={$t('admin.machine_learning_image_enrichment_hardware')}
            desc={$t('admin.machine_learning_image_enrichment_hardware_description')}
            name="image-enrichment-hardware"
            bind:value={imageDescription.acceleration}
            options={hardwareAccelerationOptions}
            disabled={disabled || !configToEdit.machineLearning.enabled}
            isEdited={isMachineLearningConfigEdited(configToEdit.machineLearning)}
            onSelect={applyImageEnrichmentHardware}
          />

          <SettingSwitch
            title={$t('admin.machine_learning_image_description_enabled')}
            subtitle={$t('admin.machine_learning_image_description_enabled_description')}
            bind:checked={imageDescription.enabled}
            disabled={disabled || !configToEdit.machineLearning.enabled}
          />

          <hr />

          <SettingInputField
            inputType={SettingInputFieldType.TEXT}
            label={$t('admin.machine_learning_image_description_model')}
            bind:value={imageDescription.modelName}
            required={true}
            disabled={disabled || !configToEdit.machineLearning.enabled || !imageDescription.enabled}
            isEdited={imageDescription.modelName !== savedImageDescription.modelName}
          />

          <SettingInputField
            inputType={SettingInputFieldType.TEXT}
            label={$t('admin.machine_learning_image_description_fallback_model')}
            bind:value={imageDescription.fallbackModelName}
            required={true}
            disabled={disabled || !configToEdit.machineLearning.enabled || !imageDescription.enabled}
            isEdited={imageDescription.fallbackModelName !== savedImageDescription.fallbackModelName}
          />

          <SettingInputField
            inputType={SettingInputFieldType.TEXT}
            label={$t('admin.machine_learning_hardware_device')}
            bind:value={imageDescription.device}
            required={true}
            disabled={disabled || !configToEdit.machineLearning.enabled || !imageDescription.enabled}
            isEdited={imageDescription.device !== savedImageDescription.device}
          />

          <SettingAccordion
            key="image-description-prompt"
            title={$t('admin.machine_learning_image_description_prompt')}
            subtitle={$t('admin.machine_learning_image_description_prompt_description')}
          >
            <div class="ms-4 mt-4 flex flex-col gap-4">
              <SettingSelect
                label={$t('admin.machine_learning_image_description_style')}
                desc={$t('admin.machine_learning_image_description_style_description')}
                name="image-description-style"
                bind:value={imageDescription.prompt!.style}
                options={[
                  { value: Style.Terse, text: $t('admin.machine_learning_image_description_style_terse') },
                  { value: Style.Balanced, text: $t('admin.machine_learning_image_description_style_balanced') },
                  { value: Style.Rich, text: $t('admin.machine_learning_image_description_style_rich') },
                ]}
                disabled={disabled || !configToEdit.machineLearning.enabled || !imageDescription.enabled}
                isEdited={imageDescription.prompt?.style !== savedImageDescription.prompt?.style}
              />

              <SettingInputField
                inputType={SettingInputFieldType.NUMBER}
                label={$t('admin.machine_learning_image_description_sentence_count')}
                description={$t('admin.machine_learning_image_description_sentence_count_description')}
                bind:value={imageDescription.prompt!.sentenceCountTarget}
                step="1"
                min={1}
                max={6}
                disabled={disabled || !configToEdit.machineLearning.enabled || !imageDescription.enabled}
                isEdited={imageDescription.prompt?.sentenceCountTarget !==
                  savedImageDescription.prompt?.sentenceCountTarget}
              />

              <SettingTextarea
                label={$t('admin.machine_learning_image_description_look_for')}
                description={$t('admin.machine_learning_image_description_look_for_description')}
                value={lookForText}
                onChange={(text) => (imageDescription.prompt!.lookFor = parseLines(text))}
                disabled={disabled || !configToEdit.machineLearning.enabled || !imageDescription.enabled}
                isEdited={JSON.stringify(imageDescription.prompt?.lookFor) !==
                  JSON.stringify(savedImageDescription.prompt?.lookFor)}
              />

              <SettingTextarea
                label={$t('admin.machine_learning_image_description_custom_vocabulary')}
                description={$t('admin.machine_learning_image_description_custom_vocabulary_description')}
                value={customVocabularyText}
                onChange={(text) => (imageDescription.prompt!.customVocabulary = parseLines(text))}
                disabled={disabled || !configToEdit.machineLearning.enabled || !imageDescription.enabled}
                isEdited={JSON.stringify(imageDescription.prompt?.customVocabulary) !==
                  JSON.stringify(savedImageDescription.prompt?.customVocabulary)}
              />

              <SettingTextarea
                label={$t('admin.machine_learning_image_description_forbidden_inferences')}
                description={$t('admin.machine_learning_image_description_forbidden_inferences_description')}
                value={forbiddenInferencesText}
                onChange={(text) => (imageDescription.prompt!.forbiddenInferences = parseLines(text))}
                disabled={disabled || !configToEdit.machineLearning.enabled || !imageDescription.enabled}
                isEdited={JSON.stringify(imageDescription.prompt?.forbiddenInferences) !==
                  JSON.stringify(savedImageDescription.prompt?.forbiddenInferences)}
              />

              <SettingAccordion
                key="image-description-nsfw-indicators"
                title={$t('admin.machine_learning_image_description_nsfw_indicators')}
                subtitle={$t('admin.machine_learning_image_description_nsfw_indicators_description')}
              >
                <div class="ms-4 mt-4">
                  <SettingTextarea
                    label={$t('admin.machine_learning_image_description_nsfw_indicators')}
                    value={nsfwIndicatorsText}
                    onChange={(text) => (imageDescription.prompt!.nsfwIndicators = parseLines(text))}
                    disabled={disabled || !configToEdit.machineLearning.enabled || !imageDescription.enabled}
                    isEdited={JSON.stringify(imageDescription.prompt?.nsfwIndicators) !==
                      JSON.stringify(savedImageDescription.prompt?.nsfwIndicators)}
                  />
                </div>
              </SettingAccordion>

              <SettingAccordion
                key="image-description-medical-indicators"
                title={$t('admin.machine_learning_image_description_medical_indicators')}
                subtitle={$t('admin.machine_learning_image_description_medical_indicators_description')}
              >
                <div class="ms-4 mt-4">
                  <SettingTextarea
                    label={$t('admin.machine_learning_image_description_medical_indicators')}
                    value={medicalIndicatorsText}
                    onChange={(text) => (imageDescription.prompt!.medicalIndicators = parseLines(text))}
                    disabled={disabled || !configToEdit.machineLearning.enabled || !imageDescription.enabled}
                    isEdited={JSON.stringify(imageDescription.prompt?.medicalIndicators) !==
                      JSON.stringify(savedImageDescription.prompt?.medicalIndicators)}
                  />
                </div>
              </SettingAccordion>

              <SettingAccordion
                key="image-description-identity-injection"
                title={$t('admin.machine_learning_image_description_identity_injection')}
                subtitle={$t('admin.machine_learning_image_description_identity_injection_description')}
              >
                <div class="ms-4 mt-4 flex flex-col gap-4">
                  <SettingSwitch
                    title={$t('admin.machine_learning_image_description_identity_injection_enabled')}
                    bind:checked={imageDescription.prompt!.identityInjection!.enabled}
                    disabled={disabled || !configToEdit.machineLearning.enabled || !imageDescription.enabled}
                    isEdited={imageDescription.prompt?.identityInjection?.enabled !==
                      savedImageDescription.prompt?.identityInjection?.enabled}
                  />

                  <SettingInputField
                    inputType={SettingInputFieldType.NUMBER}
                    label={$t('admin.machine_learning_image_description_identity_injection_max_names')}
                    description={$t(
                      'admin.machine_learning_image_description_identity_injection_max_names_description',
                    )}
                    bind:value={imageDescription.prompt!.identityInjection!.maxNames}
                    step="1"
                    min={1}
                    max={20}
                    disabled={disabled ||
                      !configToEdit.machineLearning.enabled ||
                      !imageDescription.enabled ||
                      !imageDescription.prompt?.identityInjection?.enabled}
                    isEdited={imageDescription.prompt?.identityInjection?.maxNames !==
                      savedImageDescription.prompt?.identityInjection?.maxNames}
                  />

                  <SettingInputField
                    inputType={SettingInputFieldType.NUMBER}
                    label={$t('admin.machine_learning_image_description_identity_injection_min_confidence')}
                    description={$t(
                      'admin.machine_learning_image_description_identity_injection_min_confidence_description',
                    )}
                    bind:value={imageDescription.prompt!.identityInjection!.minFaceConfidence}
                    step="0.05"
                    min={0}
                    max={1}
                    disabled={disabled ||
                      !configToEdit.machineLearning.enabled ||
                      !imageDescription.enabled ||
                      !imageDescription.prompt?.identityInjection?.enabled}
                    isEdited={imageDescription.prompt?.identityInjection?.minFaceConfidence !==
                      savedImageDescription.prompt?.identityInjection?.minFaceConfidence}
                  />
                </div>
              </SettingAccordion>

              <SettingAccordion
                key="image-description-advanced"
                title={$t('admin.machine_learning_image_description_advanced')}
                subtitle={$t('admin.machine_learning_image_description_advanced_description')}
              >
                <div class="ms-4 mt-4 flex flex-col gap-4">
                  <SettingSwitch
                    title={$t('admin.machine_learning_image_description_advanced_enabled')}
                    bind:checked={imageDescription.prompt!.advanced!.enabled}
                    disabled={disabled || !configToEdit.machineLearning.enabled || !imageDescription.enabled}
                    isEdited={imageDescription.prompt?.advanced?.enabled !==
                      savedImageDescription.prompt?.advanced?.enabled}
                  />

                  {#if imageDescription.prompt?.advanced?.enabled}
                    <SettingTextarea
                      label={$t('admin.machine_learning_image_description_advanced_raw_prompt')}
                      description={$t('admin.machine_learning_image_description_advanced_raw_prompt_description')}
                      value={rawPromptTemplateText}
                      onChange={(text) => (imageDescription.prompt!.advanced!.rawPromptTemplate = text)}
                      disabled={disabled || !configToEdit.machineLearning.enabled || !imageDescription.enabled}
                      isEdited={imageDescription.prompt?.advanced?.rawPromptTemplate !==
                        savedImageDescription.prompt?.advanced?.rawPromptTemplate}
                    />

                    <SettingSelect
                      label={$t('admin.machine_learning_image_description_advanced_placeholder_validation')}
                      name="image-description-placeholder-validation"
                      bind:value={imageDescription.prompt!.advanced!.placeholderValidation}
                      options={[
                        {
                          value: PlaceholderValidation.Strict,
                          text: $t('admin.machine_learning_image_description_advanced_placeholder_validation_strict'),
                        },
                        {
                          value: PlaceholderValidation.Warn,
                          text: $t('admin.machine_learning_image_description_advanced_placeholder_validation_warn'),
                        },
                      ]}
                      disabled={disabled || !configToEdit.machineLearning.enabled || !imageDescription.enabled}
                      isEdited={imageDescription.prompt?.advanced?.placeholderValidation !==
                        savedImageDescription.prompt?.advanced?.placeholderValidation}
                    />
                  {/if}
                </div>
              </SettingAccordion>
            </div>
          </SettingAccordion>

          <div class="mt-4 flex justify-end">
            <Button
              shape="round"
              size="small"
              leadingIcon={mdiRefresh}
              onclick={handleRequeueClick}
              disabled={disabled || !configToEdit.machineLearning.enabled || !imageDescription.enabled}
            >
              {$t('admin.machine_learning_image_description_requeue')}
            </Button>
          </div>
        </div>
      </SettingAccordion>

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
            disabled={disabled || !configToEdit.machineLearning.enabled}
          />

          <SettingSwitch
            title={$t('admin.machine_learning_nsfw_detection_hide_from_library')}
            subtitle={$t('admin.machine_learning_nsfw_detection_hide_from_library_description')}
            bind:checked={nsfwDetection.hideFromLibrary}
            disabled={disabled || !configToEdit.machineLearning.enabled}
            isEdited={nsfwDetection.hideFromLibrary !== savedNsfwDetection.hideFromLibrary}
          />

          <hr />

          <SettingInputField
            inputType={SettingInputFieldType.TEXT}
            label={$t('admin.machine_learning_nsfw_detection_model')}
            bind:value={nsfwDetection.modelName}
            required={true}
            disabled={disabled || !configToEdit.machineLearning.enabled || !nsfwDetection.enabled}
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
            disabled={disabled || !configToEdit.machineLearning.enabled || !nsfwDetection.enabled}
            isEdited={nsfwDetection.threshold !== savedNsfwDetection.threshold}
          />

          <SettingInputField
            inputType={SettingInputFieldType.TEXT}
            label={$t('admin.machine_learning_hardware_device')}
            bind:value={nsfwDetection.device}
            required={true}
            disabled={disabled || !configToEdit.machineLearning.enabled || !nsfwDetection.enabled}
            isEdited={nsfwDetection.device !== savedNsfwDetection.device}
          />
        </div>
      </SettingAccordion>
      <SettingButtonsRow bind:configToEdit keys={['machineLearning']} {disabled} />
    </form>
  </div>
</div>
