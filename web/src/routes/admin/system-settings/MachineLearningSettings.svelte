<script lang="ts">
  import SettingButtonsRow from '$lib/components/shared-components/settings/SystemConfigButtonRow.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { systemConfigManager } from '$lib/managers/system-config-manager.svelte';
  import { getMachineLearningHardware, MachineLearningHardwareAcceleration } from '@immich/sdk';
  import { isEqual } from 'lodash-es';
  import { onDestroy, onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import AvailabilityChecksSection from './machine-learning/AvailabilityChecksSection.svelte';
  import DuplicateDetectionSection from './machine-learning/DuplicateDetectionSection.svelte';
  import FacialRecognitionSection from './machine-learning/FacialRecognitionSection.svelte';
  import ImageDescriptionSection from './machine-learning/ImageDescriptionSection.svelte';
  import {
    hardwareAcceleration,
    imageEnrichmentHardwarePresets,
    isImageEnrichmentHardwareAcceleration,
  } from './machine-learning/machine-learning-helpers';
  import MlUrlsSection from './machine-learning/MlUrlsSection.svelte';
  import NsfwDetectionSection from './machine-learning/NsfwDetectionSection.svelte';
  import OcrSection from './machine-learning/OcrSection.svelte';
  import RunPodSection from './machine-learning/RunPodSection.svelte';
  import SmartSearchSection from './machine-learning/SmartSearchSection.svelte';

  const disabled = $derived(featureFlagsManager.value.configFile);
  const config = $derived(systemConfigManager.value);
  let configToEdit = $state(systemConfigManager.cloneValue());
  // Optional-with-default zod fields land in the generated DTO as
  // `string | undefined`. The server always materialises them, but the
  // password bindings below need a plain string. Backfill on load so the
  // bind targets are never undefined.
  if (configToEdit.machineLearning.runpod) {
    configToEdit.machineLearning.runpod.hfToken ??= '';
  }

  // Detected hardware preference, used to seed the "Auto" hardware
  // dropdown and apply matching preset model names.
  let detectedAcceleration = $state<MachineLearningHardwareAcceleration>();

  // Convenience slices into the live config. Zod's `.default(...)` makes
  // these optional in the generated DTO type even though the server
  // always materialises them — non-null assertions mirror the pre-refactor
  // behavior.
  const imageDescription = $derived(configToEdit.machineLearning.imageDescription!);
  const savedImageDescription = $derived(config.machineLearning.imageDescription!);
  const nsfwDetection = $derived(configToEdit.machineLearning.nsfwDetection!);
  const savedNsfwDetection = $derived(config.machineLearning.nsfwDetection!);
  const runpod = $derived(configToEdit.machineLearning.runpod!);
  const savedRunpod = $derived(config.machineLearning.runpod!);
  const runpodServerless = $derived(runpod.serverless!);
  const savedRunpodServerless = $derived(savedRunpod.serverless!);

  // Clamp minMatchingFrames to frameCount at save time, NOT in a $effect.
  // The previous `$effect` reactively clamped on every keystroke, so typing
  // a two-digit number in `frameCount` clobbered `minMatchingFrames` between
  // digits. The SettingInputField `max={frameCount}` already gives a visible
  // UI bound; this `onBeforeSave` hook just enforces it once at submit.
  // Marked async to satisfy SystemConfigButtonRow's onBeforeSave: () => Promise<boolean>.
  const validateBeforeSave = (): Promise<boolean> => {
    const enhancedVideo = configToEdit.machineLearning.duplicateDetection.enhancedVideo;
    if (enhancedVideo.minMatchingFrames > enhancedVideo.frameCount) {
      enhancedVideo.minMatchingFrames = enhancedVideo.frameCount;
    }
    return Promise.resolve(true);
  };

  // Managed RunPod URL polling. Surfaces "Pod state: <URL>" chip when the
  // admin has launched a pod via the Quick Actions panel.
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

  const detectMachineLearningHardware = async () => {
    try {
      const hardware = await getMachineLearningHardware();
      const preferredAcceleration = hardware.preferredAcceleration;

      if (isImageEnrichmentHardwareAcceleration(preferredAcceleration)) {
        detectedAcceleration = preferredAcceleration;
        if (imageDescription.acceleration === hardwareAcceleration.Auto) {
          // Apply the detected preset to the image-description and NSFW
          // slices, matching pre-refactor onMount behavior.
          applyDetectedPreset(preferredAcceleration);
        }
      }
    } catch {
      detectedAcceleration = undefined;
    }
  };

  const applyDetectedPreset = (acceleration: MachineLearningHardwareAcceleration) => {
    if (!isImageEnrichmentHardwareAcceleration(acceleration)) {
      return;
    }
    const preset = imageEnrichmentHardwarePresets[acceleration];
    imageDescription.modelName = preset.imageDescriptionModelName;
    imageDescription.fallbackModelName = preset.imageDescriptionFallbackModelName;
    imageDescription.device = preset.imageDescriptionDevice;
    nsfwDetection.modelName = preset.nsfwDetectionModelName;
    nsfwDetection.device = preset.nsfwDetectionDevice;
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

  // Track whether the ML config has unsaved edits — used by the "auto"
  // hardware select's `isEdited` flag in ImageDescriptionSection.
  const isMachineLearningConfigEdited = $derived(!isEqual(configToEdit.machineLearning, config.machineLearning));
</script>

<div class="mt-2">
  <div in:fade={{ duration: 500 }}>
    <form autocomplete="off" class="mx-4 mt-4" onsubmit={(event) => event.preventDefault()}>
      <MlUrlsSection
        bind:workingConfig={configToEdit.machineLearning}
        savedConfig={config.machineLearning}
        {disabled}
        {managedRunPodUrl}
      />

      <RunPodSection
        workingConfig={configToEdit.machineLearning}
        {runpod}
        {savedRunpod}
        {runpodServerless}
        {savedRunpodServerless}
        {disabled}
      />

      <AvailabilityChecksSection
        workingConfig={configToEdit.machineLearning}
        savedConfig={config.machineLearning}
        {disabled}
      />

      <SmartSearchSection
        workingConfig={configToEdit.machineLearning}
        savedConfig={config.machineLearning}
        {disabled}
      />

      <DuplicateDetectionSection
        workingConfig={configToEdit.machineLearning}
        savedConfig={config.machineLearning}
        {disabled}
      />

      <FacialRecognitionSection
        workingConfig={configToEdit.machineLearning}
        savedConfig={config.machineLearning}
        {disabled}
      />

      <OcrSection workingConfig={configToEdit.machineLearning} savedConfig={config.machineLearning} {disabled} />

      <ImageDescriptionSection
        workingConfig={configToEdit.machineLearning}
        {imageDescription}
        {savedImageDescription}
        {nsfwDetection}
        {runpodServerless}
        {detectedAcceleration}
        {isMachineLearningConfigEdited}
        {disabled}
      />

      <NsfwDetectionSection
        workingConfig={configToEdit.machineLearning}
        {nsfwDetection}
        {savedNsfwDetection}
        {disabled}
      />

      <SettingButtonsRow bind:configToEdit keys={['machineLearning']} {disabled} onBeforeSave={validateBeforeSave} />
    </form>
  </div>
</div>
