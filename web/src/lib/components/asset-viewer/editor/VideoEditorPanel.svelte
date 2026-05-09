<script lang="ts">
  import { shortcuts } from '$lib/actions/shortcut';
  import { eventManager } from '$lib/managers/event-manager.svelte';
  import { waitForWebsocketEvent } from '$lib/stores/websocket';
  import {
    editAsset,
    getAssetEdits,
    removeAssetEdits,
    type AssetEditsCreateDto,
    type AssetResponseDto,
  } from '@immich/sdk';
  import { Button, ConfirmModal, HStack, IconButton, modalManager, toastManager } from '@immich/ui';
  import { mdiClose, mdiFlipHorizontal, mdiFlipVertical, mdiRotateLeft, mdiRotateRight } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  interface Props {
    asset: AssetResponseDto;
    onClose: () => void;
  }

  type VideoEdit = AssetEditsCreateDto['edits'][number];
  type Tool = 'transform' | 'auto' | 'adjust' | 'look' | 'timeline' | 'text';
  type SpeedMode = 'whole' | 'segment';
  type SpeedSegment = {
    id: string;
    rate: number;
    startSeconds: number;
    endSeconds: number;
  };
  type EditParameters = Record<string, unknown>;
  interface AspectRatioOption {
    label: string;
    value: string;
    width?: number;
    height?: number;
    isFree?: boolean;
  }

  const aspectRatios: AspectRatioOption[] = [
    { label: $t('crop_aspect_ratio_free'), value: 'free', isFree: true },
    { label: $t('crop_aspect_ratio_original'), value: 'original', width: 24, height: 18 },
    { label: '5:4', value: '5:4', width: 22, height: 18 },
    { label: '4:5', value: '4:5', width: 18, height: 22 },
    { label: '4:3', value: '4:3', width: 24, height: 18 },
    { label: '3:4', value: '3:4', width: 18, height: 24 },
    { label: '3:2', value: '3:2', width: 24, height: 16 },
    { label: '2:3', value: '2:3', width: 16, height: 24 },
    { label: '16:9', value: '16:9', width: 24, height: 14 },
    { label: '9:16', value: '9:16', width: 14, height: 24 },
    { label: $t('crop_aspect_ratio_square'), value: '1:1', width: 20, height: 20 },
  ];

  let { asset = $bindable(), onClose }: Props = $props();

  let selectedTool = $state<Tool>('transform');
  let isSaving = $state(false);
  let isLoading = $state(true);
  let isShowingConfirmDialog = $state(false);
  let hasAppliedEdits = $state(false);
  let initialEditKey = $state('');

  let cropEnabled = $state(false);
  let cropX = $state(0);
  let cropY = $state(0);
  let cropWidth = $state(asset.width ?? 0);
  let cropHeight = $state(asset.height ?? 0);
  let cropAspectRatio = $state('');
  let rotation = $state(0);
  let straighten = $state(0);
  let mirrorHorizontal = $state(false);
  let mirrorVertical = $state(false);

  let autoEnhance = $state(false);
  let stabilize = $state(false);

  let brightness = $state(0);
  let contrast = $state(0);
  let whitePoint = $state(0);
  let highlights = $state(0);
  let shadows = $state(0);
  let blackPoint = $state(0);
  let saturation = $state(0);
  let warmth = $state(0);
  let tint = $state(0);
  let skinTone = $state(0);
  let blueTone = $state(0);
  let vignette = $state(0);
  let hdr = $state(0);

  let lookName = $state('none');
  let lookIntensity = $state(100);

  let trimStartSeconds = $state(0);
  let trimEndSeconds = $state(0);
  let speedMode = $state<SpeedMode>('whole');
  let speed = $state(1);
  let speedSegmentId = 0;
  let speedSegments = $state<SpeedSegment[]>([]);
  let muted = $state(false);
  let volume = $state(1);

  let text = $state('');
  let textX = $state(0.5);
  let textY = $state(0.78);
  let textStartSeconds = $state(0);
  let textEndSeconds = $state(0);
  let textSize = $state(0.06);
  let textColor = $state('#ffffff');

  const durationSeconds = $derived(Math.max(0, (asset.duration ?? 0) / 1000));
  const width = $derived(asset.width ?? 0);
  const height = $derived(asset.height ?? 0);
  const normalizedRotation = $derived(((Number(rotation) % 360) + 360) % 360);
  const isRotated = $derived(normalizedRotation % 180 !== 0);
  const hasUnsavedChanges = $derived(!isLoading && !hasAppliedEdits && getCurrentEditKey() !== initialEditKey);

  function getNumberParameter(parameters: EditParameters, key: string, fallback: number) {
    const value = parameters[key];
    return typeof value === 'number' ? value : fallback;
  }

  function getStringParameter(parameters: EditParameters, key: string, fallback: string) {
    const value = parameters[key];
    return typeof value === 'string' ? value : fallback;
  }

  function getBooleanParameter(parameters: EditParameters, key: string, fallback: boolean) {
    const value = parameters[key];
    return typeof value === 'boolean' ? value : fallback;
  }

  onMount(async () => {
    resetControls();
    const { edits } = await getAssetEdits({ id: asset.id });
    for (const edit of edits) {
      const action = edit.action as string;
      const parameters = edit.parameters as EditParameters;

      switch (action) {
        case 'crop': {
          cropEnabled = true;
          cropAspectRatio = 'free';
          cropX = getNumberParameter(parameters, 'x', cropX);
          cropY = getNumberParameter(parameters, 'y', cropY);
          cropWidth = getNumberParameter(parameters, 'width', cropWidth);
          cropHeight = getNumberParameter(parameters, 'height', cropHeight);
          break;
        }
        case 'rotate': {
          rotation = getNumberParameter(parameters, 'angle', rotation);
          break;
        }
        case 'straighten': {
          straighten = getNumberParameter(parameters, 'angle', straighten);
          break;
        }
        case 'mirror': {
          mirrorHorizontal = mirrorHorizontal || parameters.axis === 'horizontal';
          mirrorVertical = mirrorVertical || parameters.axis === 'vertical';
          break;
        }
        case 'trim': {
          trimStartSeconds = getNumberParameter(parameters, 'startMs', 0) / 1000;
          trimEndSeconds = getNumberParameter(parameters, 'endMs', asset.duration ?? 0) / 1000;
          break;
        }
        case 'autoEnhance': {
          autoEnhance = getBooleanParameter(parameters, 'enabled', true);
          break;
        }
        case 'stabilize': {
          stabilize = getBooleanParameter(parameters, 'enabled', true);
          break;
        }
        case 'adjust': {
          brightness = getNumberParameter(parameters, 'brightness', brightness);
          contrast = getNumberParameter(parameters, 'contrast', contrast);
          whitePoint = getNumberParameter(parameters, 'whitePoint', whitePoint);
          highlights = getNumberParameter(parameters, 'highlights', highlights);
          shadows = getNumberParameter(parameters, 'shadows', shadows);
          blackPoint = getNumberParameter(parameters, 'blackPoint', blackPoint);
          saturation = getNumberParameter(parameters, 'saturation', saturation);
          warmth = getNumberParameter(parameters, 'warmth', warmth);
          tint = getNumberParameter(parameters, 'tint', tint);
          skinTone = getNumberParameter(parameters, 'skinTone', skinTone);
          blueTone = getNumberParameter(parameters, 'blueTone', blueTone);
          vignette = getNumberParameter(parameters, 'vignette', vignette);
          hdr = getNumberParameter(parameters, 'hdr', hdr);
          break;
        }
        case 'filter':
        case 'effect': {
          lookName = getStringParameter(parameters, 'name', lookName);
          lookIntensity = getNumberParameter(parameters, 'intensity', lookIntensity);
          break;
        }
        case 'audio': {
          muted = getBooleanParameter(parameters, 'muted', muted);
          volume = getNumberParameter(parameters, 'volume', volume);
          break;
        }
        case 'speed': {
          const startMs = parameters.startMs;
          const endMs = parameters.endMs;
          if (typeof startMs === 'number' && typeof endMs === 'number') {
            speedMode = 'segment';
            speedSegments = [
              ...speedSegments,
              createSpeedSegment(getNumberParameter(parameters, 'rate', 1), startMs / 1000, endMs / 1000),
            ];
          } else {
            speedMode = 'whole';
            speed = getNumberParameter(parameters, 'rate', speed);
          }
          break;
        }
        case 'textOverlay': {
          text = getStringParameter(parameters, 'text', text);
          textX = getNumberParameter(parameters, 'x', textX);
          textY = getNumberParameter(parameters, 'y', textY);
          textStartSeconds = getNumberParameter(parameters, 'startMs', 0) / 1000;
          textEndSeconds = getNumberParameter(parameters, 'endMs', asset.duration ?? 0) / 1000;
          textSize = getNumberParameter(parameters, 'size', textSize);
          textColor = getStringParameter(parameters, 'color', textColor);
          break;
        }
      }
    }

    initialEditKey = getCurrentEditKey();
    isLoading = false;
  });

  function resetControls() {
    cropEnabled = false;
    cropX = 0;
    cropY = 0;
    cropWidth = width;
    cropHeight = height;
    cropAspectRatio = '';
    rotation = 0;
    straighten = 0;
    mirrorHorizontal = false;
    mirrorVertical = false;
    autoEnhance = false;
    stabilize = false;
    brightness = 0;
    contrast = 0;
    whitePoint = 0;
    highlights = 0;
    shadows = 0;
    blackPoint = 0;
    saturation = 0;
    warmth = 0;
    tint = 0;
    skinTone = 0;
    blueTone = 0;
    vignette = 0;
    hdr = 0;
    lookName = 'none';
    lookIntensity = 100;
    trimStartSeconds = 0;
    trimEndSeconds = durationSeconds;
    speedMode = 'whole';
    speed = 1;
    speedSegments = [];
    muted = false;
    volume = 1;
    text = '';
    textX = 0.5;
    textY = 0.78;
    textStartSeconds = 0;
    textEndSeconds = durationSeconds;
    textSize = 0.06;
    textColor = '#ffffff';
  }

  function createSpeedSegment(rate = 1, startSeconds = trimStartSeconds, endSeconds = trimEndSeconds) {
    return { id: `speed-segment-${speedSegmentId++}`, rate, startSeconds, endSeconds };
  }

  function normalizeRotation(value: number) {
    return ((value % 360) + 360) % 360;
  }

  function rotatedRatio(ratio: AspectRatioOption): string {
    if (ratio.value === 'free') {
      return ratio.value;
    }

    if (isRotated) {
      const [ratioWidth, ratioHeight] = ratio.value.split(':');
      return `${ratioHeight}:${ratioWidth}`;
    }

    return ratio.value;
  }

  function ratioSelected(ratio: AspectRatioOption): boolean {
    if (!cropEnabled) {
      return false;
    }

    if (ratio.value === 'original') {
      return cropAspectRatio === `${width}:${height}`;
    }

    return cropAspectRatio === rotatedRatio(ratio);
  }

  function selectAspectRatio(ratio: AspectRatioOption) {
    if (ratio.value === 'free') {
      cropEnabled = true;
      cropAspectRatio = 'free';
      clampCropToFrame();
      return;
    }

    const appliedRatio = ratio.value === 'original' ? `${width}:${height}` : rotatedRatio(ratio);
    setCropAspectRatio(appliedRatio);
  }

  function setCropAspectRatio(aspectRatio: string) {
    cropEnabled = true;
    cropAspectRatio = aspectRatio;

    const [ratioWidth, ratioHeight] = aspectRatio.split(':').map(Number);
    if (!ratioWidth || !ratioHeight || !width || !height) {
      clampCropToFrame();
      return;
    }

    const targetRatio = ratioWidth / ratioHeight;
    const frameRatio = width / height;
    let nextWidth = width;
    let nextHeight = height;

    if (frameRatio > targetRatio) {
      nextWidth = height * targetRatio;
    } else {
      nextHeight = width / targetRatio;
    }

    cropWidth = Math.max(1, Math.round(nextWidth));
    cropHeight = Math.max(1, Math.round(nextHeight));
    cropX = Math.max(0, Math.round((width - cropWidth) / 2));
    cropY = Math.max(0, Math.round((height - cropHeight) / 2));
  }

  function clampCropToFrame() {
    if (!width || !height) {
      return;
    }

    cropWidth = Math.min(Math.max(1, Math.round(cropWidth)), width);
    cropHeight = Math.min(Math.max(1, Math.round(cropHeight)), height);
    cropX = Math.min(Math.max(0, Math.round(cropX)), Math.max(0, width - cropWidth));
    cropY = Math.min(Math.max(0, Math.round(cropY)), Math.max(0, height - cropHeight));
  }

  function rotateVideo(degrees: number) {
    rotation = normalizeRotation(rotation + degrees);
  }

  function mirrorVideo(axis: 'horizontal' | 'vertical') {
    if (axis === 'horizontal') {
      mirrorHorizontal = !mirrorHorizontal;
    } else {
      mirrorVertical = !mirrorVertical;
    }
  }

  function setSpeedMode(mode: SpeedMode) {
    speedMode = mode;
    if (mode === 'segment' && speedSegments.length === 0) {
      speedSegments = [createSpeedSegment()];
    }
  }

  function addSpeedSegment() {
    speedSegments = [...speedSegments, createSpeedSegment()];
  }

  function removeSpeedSegment(id: string) {
    speedSegments = speedSegments.filter((segment) => segment.id !== id);
  }

  function pushEdit(edits: VideoEdit[], action: string, parameters: Record<string, unknown>) {
    edits.push({ action, parameters } as VideoEdit);
  }

  function nonZeroAdjustments() {
    const parameters = {
      brightness,
      contrast,
      whitePoint,
      highlights,
      shadows,
      blackPoint,
      saturation,
      warmth,
      tint,
      skinTone,
      blueTone,
      vignette,
      hdr,
    };

    return Object.fromEntries(Object.entries(parameters).filter(([, value]) => value !== 0));
  }

  function getSpeedSegmentEdits() {
    const segments = speedSegments
      .filter((segment) => segment.rate !== 1)
      .map((segment) => ({
        ...segment,
        startMs: Math.round(segment.startSeconds * 1000),
        endMs: Math.round(segment.endSeconds * 1000),
      }))
      .sort((a, b) => a.startMs - b.startMs);

    for (const segment of segments) {
      if (segment.endMs <= segment.startMs) {
        throw new Error('Speed segment end must be after start');
      }
    }

    for (let index = 1; index < segments.length; index++) {
      if (segments[index].startMs < segments[index - 1].endMs) {
        throw new Error('Speed segments cannot overlap');
      }
    }

    return segments;
  }

  function buildEdits() {
    const edits: VideoEdit[] = [];

    if (cropEnabled) {
      pushEdit(edits, 'crop', {
        x: Math.round(cropX),
        y: Math.round(cropY),
        width: Math.round(cropWidth),
        height: Math.round(cropHeight),
      });
    }

    if (rotation !== 0) {
      pushEdit(edits, 'rotate', { angle: rotation });
    }
    if (straighten !== 0) {
      pushEdit(edits, 'straighten', { angle: straighten });
    }
    if (mirrorHorizontal) {
      pushEdit(edits, 'mirror', { axis: 'horizontal' });
    }
    if (mirrorVertical) {
      pushEdit(edits, 'mirror', { axis: 'vertical' });
    }
    if (autoEnhance) {
      pushEdit(edits, 'autoEnhance', { enabled: true });
    }
    if (stabilize) {
      pushEdit(edits, 'stabilize', { enabled: true });
    }

    const adjustments = nonZeroAdjustments();
    if (Object.keys(adjustments).length > 0) {
      pushEdit(edits, 'adjust', adjustments);
    }

    if (lookName !== 'none') {
      pushEdit(edits, 'filter', { name: lookName, intensity: lookIntensity });
    }

    if (trimStartSeconds > 0 || trimEndSeconds < durationSeconds) {
      pushEdit(edits, 'trim', {
        startMs: Math.round(trimStartSeconds * 1000),
        endMs: Math.round(trimEndSeconds * 1000),
      });
    }
    if (speedMode === 'whole') {
      if (speed !== 1) {
        pushEdit(edits, 'speed', { rate: speed });
      }
    } else {
      for (const segment of getSpeedSegmentEdits()) {
        pushEdit(edits, 'speed', {
          rate: segment.rate,
          startMs: segment.startMs,
          endMs: segment.endMs,
        });
      }
    }
    if (muted || volume !== 1) {
      pushEdit(edits, 'audio', { muted, volume });
    }
    if (text.trim()) {
      pushEdit(edits, 'textOverlay', {
        text: text.trim(),
        x: textX,
        y: textY,
        startMs: Math.round(textStartSeconds * 1000),
        endMs: Math.round(textEndSeconds * 1000),
        size: textSize,
        color: textColor,
      });
    }

    return edits;
  }

  function getCurrentEditKey() {
    try {
      return JSON.stringify(buildEdits());
    } catch {
      return 'invalid';
    }
  }

  async function closeConfirm() {
    if (isShowingConfirmDialog) {
      return false;
    }

    if (!hasUnsavedChanges) {
      return true;
    }

    isShowingConfirmDialog = true;

    const confirmed = await modalManager.show(ConfirmModal, {
      title: $t('editor_discard_edits_title'),
      prompt: $t('editor_discard_edits_prompt'),
      confirmText: $t('editor_discard_edits_confirm'),
    });

    isShowingConfirmDialog = false;

    return confirmed;
  }

  async function closeEditor() {
    if (await closeConfirm()) {
      onClose();
    }
  }

  async function applyEdits() {
    if (isSaving) {
      return;
    }

    isSaving = true;

    try {
      const edits = buildEdits();
      const editCompleted = waitForWebsocketEvent('AssetEditReadyV2', (event) => event.asset.id === asset.id, 600_000)
        .then(() => {
          eventManager.emit('AssetEditsApplied', asset.id);
          if (edits.length > 0) {
            toastManager.primary($t('editor_edits_applied_success'));
          }
        })
        .catch(() => undefined);

      await (edits.length === 0
        ? removeAssetEdits({ id: asset.id })
        : editAsset({ id: asset.id, assetEditsCreateDto: { edits } }));

      eventManager.emit('AssetEditsApplied', asset.id);
      void editCompleted;

      toastManager.primary(edits.length === 0 ? $t('editor_edits_applied_success') : 'Rendering edited video...');
      hasAppliedEdits = true;
      onClose();
    } catch (error) {
      toastManager.danger(error instanceof Error ? error.message : $t('editor_edits_applied_error'));
    } finally {
      isSaving = false;
    }
  }

  function exportFrame() {
    const video = document.querySelector<HTMLVideoElement>('video');
    if (!video || !video.videoWidth || !video.videoHeight) {
      toastManager.danger('Unable to export the current frame');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) {
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${asset.originalFileName.replace(/\.[^.]+$/, '')}.png`;
      link.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }

  const tools: { id: Tool; label: string }[] = [
    { id: 'transform', label: 'Transform' },
    { id: 'auto', label: 'Auto' },
    { id: 'adjust', label: 'Adjust' },
    { id: 'look', label: 'Look' },
    { id: 'timeline', label: 'Timeline' },
    { id: 'text', label: 'Text' },
  ];
</script>

<svelte:document
  use:shortcuts={[
    { shortcut: { key: 'Escape' }, onShortcut: closeEditor },
    { shortcut: { key: 'Enter' }, onShortcut: applyEdits },
    { shortcut: { key: ']' }, onShortcut: () => selectedTool === 'transform' && rotateVideo(90) },
    { shortcut: { key: '[' }, onShortcut: () => selectedTool === 'transform' && rotateVideo(-90) },
  ]}
/>

<section class="dark relative flex h-full flex-col p-2 pt-3 dark:bg-immich-dark-bg dark:text-immich-dark-fg">
  <HStack class="me-4 justify-between">
    <HStack>
      <IconButton
        shape="round"
        variant="ghost"
        color="secondary"
        icon={mdiClose}
        aria-label={$t('close')}
        onclick={closeEditor}
      />
      <p class="text-lg text-immich-fg capitalize dark:text-immich-dark-fg">{$t('editor')}</p>
    </HStack>
    <Button shape="round" size="small" onclick={applyEdits} loading={isSaving} disabled={isLoading}>{$t('save')}</Button
    >
  </HStack>

  <nav class="mt-4 grid grid-cols-3 gap-2 px-2">
    {#each tools as tool (tool.id)}
      <button
        type="button"
        class="rounded-md p-2 text-sm transition {selectedTool === tool.id
          ? 'bg-immich-primary text-white'
          : 'bg-gray-200 text-immich-dark-gray hover:bg-gray-300 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'}"
        onclick={() => (selectedTool = tool.id)}
      >
        {tool.label}
      </button>
    {/each}
  </nav>

  <section class="mt-4 flex-1 overflow-y-auto px-4 pb-4">
    {#if isLoading}
      <p class="text-sm text-gray-500 dark:text-gray-400">Loading...</p>
    {:else if selectedTool === 'transform'}
      <div class="mt-3 px-1">
        <div class="mt-2 flex h-10 w-full items-center justify-between text-sm">
          <h2>{$t('editor_orientation')}</h2>
        </div>
        <HStack>
          <IconButton
            class="w-full"
            size="small"
            aria-label={$t('editor_rotate_left')}
            icon={mdiRotateLeft}
            onclick={() => rotateVideo(-90)}
          />
          <IconButton
            class="w-full"
            size="small"
            aria-label={$t('editor_rotate_right')}
            icon={mdiRotateRight}
            onclick={() => rotateVideo(90)}
          />
          <IconButton
            class="w-full"
            size="small"
            aria-label={$t('editor_flip_horizontal')}
            icon={mdiFlipHorizontal}
            color={mirrorHorizontal ? 'primary' : 'secondary'}
            onclick={() => mirrorVideo('horizontal')}
          />
          <IconButton
            class="w-full"
            size="small"
            aria-label={$t('editor_flip_vertical')}
            icon={mdiFlipVertical}
            color={mirrorVertical ? 'primary' : 'secondary'}
            onclick={() => mirrorVideo('vertical')}
          />
        </HStack>

        <label class="mt-5 grid gap-2 text-sm">
          Straighten {straighten}
          <input type="range" min="-45" max="45" step="0.1" bind:value={straighten} />
        </label>

        <div class="mt-6 flex h-10 w-full items-center justify-between text-sm">
          <h2>{$t('crop')}</h2>
        </div>

        <div class="mb-4 grid grid-cols-2">
          {#each aspectRatios as ratio (ratio.value)}
            <HStack>
              <Button
                class="m-2 size-14"
                shape="round"
                onclick={() => selectAspectRatio(ratio)}
                aria-label={ratio.label}
                color={ratioSelected(ratio) ? 'primary' : 'secondary'}
                variant={ratioSelected(ratio) ? 'filled' : 'outline'}
              >
                {#if ratio.isFree}
                  <div
                    class="size-6 shrink-0 rounded-xs border-2 border-dashed {ratioSelected(ratio)
                      ? 'border-black'
                      : 'border-white'}"
                  ></div>
                {:else}
                  <div
                    class="shrink-0 rounded-xs border-2 {ratioSelected(ratio) ? 'border-black' : 'border-white'}"
                    style="width: {ratio.width}px; height: {ratio.height}px;"
                  ></div>
                {/if}
              </Button>
              <span class="text-sm text-white">{ratio.label}</span>
            </HStack>
          {/each}
        </div>

        {#if cropEnabled}
          <div class="grid grid-cols-2 gap-3 border-t border-gray-700 pt-4">
            <label class="grid gap-1 text-xs"
              >X <input class="editor-input" type="number" min="0" max={width} bind:value={cropX} /></label
            >
            <label class="grid gap-1 text-xs"
              >Y <input class="editor-input" type="number" min="0" max={height} bind:value={cropY} /></label
            >
            <label class="grid gap-1 text-xs"
              >Width <input class="editor-input" type="number" min="1" max={width} bind:value={cropWidth} /></label
            >
            <label class="grid gap-1 text-xs"
              >Height <input class="editor-input" type="number" min="1" max={height} bind:value={cropHeight} /></label
            >
          </div>
        {/if}
      </div>
    {:else if selectedTool === 'auto'}
      <div class="space-y-4 text-sm">
        <label class="flex items-center gap-2"><input type="checkbox" bind:checked={autoEnhance} /> Auto enhance</label>
        <label class="flex items-center gap-2"><input type="checkbox" bind:checked={stabilize} /> Stabilize</label>
      </div>
    {:else if selectedTool === 'adjust'}
      <div class="space-y-4">
        <label class="grid gap-1 text-sm"
          >Brightness {brightness}<input type="range" min="-100" max="100" bind:value={brightness} /></label
        >
        <label class="grid gap-1 text-sm"
          >Contrast {contrast}<input type="range" min="-100" max="100" bind:value={contrast} /></label
        >
        <label class="grid gap-1 text-sm"
          >White point {whitePoint}<input type="range" min="-100" max="100" bind:value={whitePoint} /></label
        >
        <label class="grid gap-1 text-sm"
          >Highlights {highlights}<input type="range" min="-100" max="100" bind:value={highlights} /></label
        >
        <label class="grid gap-1 text-sm"
          >Shadows {shadows}<input type="range" min="-100" max="100" bind:value={shadows} /></label
        >
        <label class="grid gap-1 text-sm"
          >Black point {blackPoint}<input type="range" min="-100" max="100" bind:value={blackPoint} /></label
        >
        <label class="grid gap-1 text-sm"
          >Saturation {saturation}<input type="range" min="-100" max="100" bind:value={saturation} /></label
        >
        <label class="grid gap-1 text-sm"
          >Warmth {warmth}<input type="range" min="-100" max="100" bind:value={warmth} /></label
        >
        <label class="grid gap-1 text-sm"
          >Tint {tint}<input type="range" min="-100" max="100" bind:value={tint} /></label
        >
        <label class="grid gap-1 text-sm"
          >Skin tone {skinTone}<input type="range" min="-100" max="100" bind:value={skinTone} /></label
        >
        <label class="grid gap-1 text-sm"
          >Blue tone {blueTone}<input type="range" min="-100" max="100" bind:value={blueTone} /></label
        >
        <label class="grid gap-1 text-sm"
          >Vignette {vignette}<input type="range" min="-100" max="100" bind:value={vignette} /></label
        >
        <label class="grid gap-1 text-sm"
          >HDR effect {hdr}<input type="range" min="-100" max="100" bind:value={hdr} /></label
        >
      </div>
    {:else if selectedTool === 'look'}
      <div class="space-y-5">
        <label class="grid gap-2 text-sm">
          Filter
          <select class="editor-input" bind:value={lookName}>
            <option value="none">None</option>
            <option value="vivid">Vivid</option>
            <option value="warm">Warm</option>
            <option value="cool">Cool</option>
            <option value="bw">Black and white</option>
            <option value="fade">Fade</option>
            <option value="vignette">Vignette</option>
          </select>
        </label>
        <label class="grid gap-2 text-sm">
          Intensity {lookIntensity}
          <input type="range" min="0" max="100" bind:value={lookIntensity} />
        </label>
      </div>
    {:else if selectedTool === 'timeline'}
      <div class="space-y-5">
        <label class="grid gap-2 text-sm">
          Trim start
          <input
            class="editor-input"
            type="number"
            min="0"
            max={durationSeconds}
            step="0.1"
            bind:value={trimStartSeconds}
          />
        </label>
        <label class="grid gap-2 text-sm">
          Trim end
          <input
            class="editor-input"
            type="number"
            min="0"
            max={durationSeconds}
            step="0.1"
            bind:value={trimEndSeconds}
          />
        </label>
        <label class="grid gap-2 text-sm">
          Speed range
          <select
            class="editor-input"
            value={speedMode}
            onchange={(event) => setSpeedMode(event.currentTarget.value as SpeedMode)}
          >
            <option value="whole">Whole video</option>
            <option value="segment">Segment</option>
          </select>
        </label>

        {#if speedMode === 'whole'}
          <label class="grid gap-2 text-sm">
            Speed {speed}x
            <input type="range" min="0.25" max="4" step="0.25" bind:value={speed} />
          </label>
        {:else}
          <div class="space-y-4">
            {#each speedSegments as segment, index (segment.id)}
              <section class="space-y-3 border-t border-gray-200 pt-4 text-sm dark:border-gray-700">
                <HStack class="justify-between">
                  <p>Segment {index + 1}</p>
                  <Button variant="ghost" shape="round" size="small" onclick={() => removeSpeedSegment(segment.id)}
                    >Remove</Button
                  >
                </HStack>
                <label class="grid gap-2">
                  Speed {segment.rate}x
                  <input type="range" min="0.25" max="4" step="0.25" bind:value={segment.rate} />
                </label>
                <div class="grid grid-cols-2 gap-3">
                  <label class="grid gap-1 text-xs"
                    >Start <input
                      class="editor-input"
                      type="number"
                      min={trimStartSeconds}
                      max={trimEndSeconds}
                      step="0.1"
                      bind:value={segment.startSeconds}
                    /></label
                  >
                  <label class="grid gap-1 text-xs"
                    >End <input
                      class="editor-input"
                      type="number"
                      min={trimStartSeconds}
                      max={trimEndSeconds}
                      step="0.1"
                      bind:value={segment.endSeconds}
                    /></label
                  >
                </div>
              </section>
            {/each}
            <Button variant="outline" shape="round" size="small" onclick={addSpeedSegment}>Add segment</Button>
          </div>
        {/if}
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={muted} /> Mute</label>
        <label class="grid gap-2 text-sm">
          Volume {volume}x
          <input type="range" min="0" max="2" step="0.05" bind:value={volume} disabled={muted} />
        </label>
        <Button variant="outline" shape="round" size="small" onclick={exportFrame}>Export frame</Button>
      </div>
    {:else if selectedTool === 'text'}
      <div class="space-y-5">
        <label class="grid gap-2 text-sm">
          Text
          <input class="editor-input" type="text" maxlength="200" bind:value={text} />
        </label>
        <div class="grid grid-cols-2 gap-3">
          <label class="grid gap-1 text-xs"
            >X <input class="editor-input" type="number" min="0" max="1" step="0.01" bind:value={textX} /></label
          >
          <label class="grid gap-1 text-xs"
            >Y <input class="editor-input" type="number" min="0" max="1" step="0.01" bind:value={textY} /></label
          >
          <label class="grid gap-1 text-xs"
            >Start <input
              class="editor-input"
              type="number"
              min="0"
              max={durationSeconds}
              step="0.1"
              bind:value={textStartSeconds}
            /></label
          >
          <label class="grid gap-1 text-xs"
            >End <input
              class="editor-input"
              type="number"
              min="0"
              max={durationSeconds}
              step="0.1"
              bind:value={textEndSeconds}
            /></label
          >
        </div>
        <label class="grid gap-2 text-sm">
          Size {textSize}
          <input type="range" min="0.02" max="0.2" step="0.01" bind:value={textSize} />
        </label>
        <label class="grid gap-2 text-sm">
          Color
          <input class="h-10 w-20" type="color" bind:value={textColor} />
        </label>
      </div>
    {/if}
  </section>

  <section class="p-4">
    <Button variant="outline" onclick={resetControls} class="self-start" shape="round" size="small">
      {$t('editor_reset_all_changes')}
    </Button>
  </section>
</section>

<style>
  .editor-input {
    border-radius: 0.375rem;
    border: 1px solid rgb(209 213 219);
    background: white;
    padding: 0.45rem 0.6rem;
    color: rgb(17 24 39);
  }

  :global(.dark) .editor-input {
    border-color: rgb(55 65 81);
    background: rgb(31 41 55);
    color: rgb(243 244 246);
  }
</style>
