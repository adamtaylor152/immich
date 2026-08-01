<script lang="ts">
  import { shortcuts } from '$lib/actions/shortcut';
  import { eventManager } from '$lib/managers/event-manager.svelte';
  import { waitForWebsocketEvent } from '$lib/stores/websocket';
  import { getAssetMediaUrl } from '$lib/utils';
  import {
    AssetMediaSize,
    editAsset,
    getAssetEdits,
    removeAssetEdits,
    type AssetEditsCreateDto,
    type AssetResponseDto,
  } from '@immich/sdk';
  import { Button, ConfirmModal, HStack, Icon, IconButton, modalManager, toastManager } from '@immich/ui';
  import {
    mdiClockOutline,
    mdiClose,
    mdiCropRotate,
    mdiFlipHorizontal,
    mdiFlipVertical,
    mdiImageOutline,
    mdiPaletteOutline,
    mdiRotateLeft,
    mdiRotateRight,
    mdiText,
    mdiTune,
    mdiVolumeHigh,
  } from '@mdi/js';
  import { onDestroy, onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  interface Props {
    asset: AssetResponseDto;
    onClose: (refreshAsset?: boolean) => void;
  }

  type VideoEdit = AssetEditsCreateDto['edits'][number];
  type Tool = 'auto' | 'crop' | 'adjust' | 'filters' | 'trim' | 'speed' | 'audio' | 'text' | 'frame';
  type SpeedMode = 'whole' | 'segment';
  type SpeedSegment = {
    id: string;
    rate: number;
    startSeconds: number;
    endSeconds: number;
  };
  type EditParameters = Record<string, unknown>;
  type CropHandle =
    'move' | 'top' | 'right' | 'bottom' | 'left' | 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left';
  type TimeDragTarget = 'trim-start' | 'trim-end' | 'text-start' | 'text-end' | 'speed-start' | 'speed-end';
  type AdjustmentKey =
    | 'brightness'
    | 'contrast'
    | 'whitePoint'
    | 'highlights'
    | 'shadows'
    | 'blackPoint'
    | 'saturation'
    | 'warmth'
    | 'tint'
    | 'skinTone'
    | 'blueTone'
    | 'vignette'
    | 'hdr';

  interface CropPreset {
    label: string;
    value: string;
    width?: number;
    height?: number;
    caption?: string;
    isFree?: boolean;
    isOriginal?: boolean;
  }

  interface CropBox {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  const cropPresets: CropPreset[] = [
    { label: $t('crop_aspect_ratio_free'), value: 'free', isFree: true },
    { label: $t('crop_aspect_ratio_original'), value: 'original', width: 24, height: 18, isOriginal: true },
    { label: $t('crop_aspect_ratio_square'), value: '1:1', width: 20, height: 20 },
    { label: '4:5', value: '4:5', width: 18, height: 22, caption: $t('editor_video_social_portrait') },
    { label: '5:4', value: '5:4', width: 22, height: 18 },
    { label: '3:4', value: '3:4', width: 18, height: 24 },
    { label: '4:3', value: '4:3', width: 24, height: 18 },
    { label: '9:16', value: '9:16', width: 14, height: 24, caption: $t('editor_video_social_shorts') },
    { label: '16:9', value: '16:9', width: 24, height: 14, caption: $t('editor_video_social_wide') },
  ];

  const adjustmentControls: { key: AdjustmentKey; label: string }[] = [
    { key: 'brightness', label: $t('editor_video_brightness') },
    { key: 'contrast', label: $t('editor_video_contrast') },
    { key: 'whitePoint', label: $t('editor_video_white_point') },
    { key: 'highlights', label: $t('editor_video_highlights') },
    { key: 'shadows', label: $t('editor_video_shadows') },
    { key: 'blackPoint', label: $t('editor_video_black_point') },
    { key: 'saturation', label: $t('editor_video_saturation') },
    { key: 'warmth', label: $t('editor_video_warmth') },
    { key: 'tint', label: $t('editor_video_tint') },
    { key: 'skinTone', label: $t('editor_video_skin_tone') },
    { key: 'blueTone', label: $t('editor_video_blue_tone') },
    { key: 'vignette', label: $t('editor_video_vignette') },
    { key: 'hdr', label: $t('editor_video_hdr') },
  ];

  const filterOptions = [
    { value: 'none', label: $t('none'), class: 'bg-linear-to-br from-gray-900 to-gray-500' },
    { value: 'vivid', label: $t('editor_video_filter_vivid'), class: 'bg-linear-to-br from-sky-500 to-rose-500' },
    { value: 'warm', label: $t('editor_video_filter_warm'), class: 'bg-linear-to-br from-amber-300 to-red-500' },
    { value: 'cool', label: $t('editor_video_filter_cool'), class: 'bg-linear-to-br from-cyan-300 to-indigo-600' },
    { value: 'bw', label: $t('editor_video_filter_bw'), class: 'bg-linear-to-br from-white to-gray-800' },
    { value: 'fade', label: $t('editor_video_filter_fade'), class: 'bg-linear-to-br from-lime-100 to-slate-500' },
    { value: 'vignette', label: $t('editor_video_filter_vignette'), class: 'bg-radial from-slate-300 to-black' },
  ];

  const speedRates = [0.25, 0.5, 1, 2, 4];
  const minimumTimelineGap = 0.1;
  const minimumCropSize = 32;

  let { asset = $bindable(), onClose }: Props = $props();

  let selectedTool = $state<Tool>('auto');
  let isSaving = $state(false);
  let isRendering = $state(false);
  let isLoading = $state(true);
  let isShowingConfirmDialog = $state(false);
  let hasAppliedEdits = $state(false);
  let initialEditKey = $state('');

  let cropEnabled = $state(false);
  let cropX = $state(0);
  let cropY = $state(0);
  let cropWidth = $state(asset.width ?? 0);
  let cropHeight = $state(asset.height ?? 0);
  let cropAspectRatio = $state('free');
  let rotation = $state(0);
  let straighten = $state(0);
  let mirrorHorizontal = $state(false);
  let mirrorVertical = $state(false);

  let autoEnhance = $state(false);
  let stabilize = $state(false);

  let adjustments = $state<Record<AdjustmentKey, number>>(getDefaultAdjustments());

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

  let cropStageElement = $state<HTMLElement | null>(null);
  let timelineDrag = $state<{ target: TimeDragTarget; segmentId?: string; rect: DOMRect } | null>(null);
  let cropInteraction = $state<{
    handle: CropHandle;
    startClientX: number;
    startClientY: number;
    startCrop: CropBox;
    rect: DOMRect;
  } | null>(null);
  let textDrag = $state<{ rect: DOMRect } | null>(null);

  const durationSeconds = $derived(Math.max(0, (asset.duration ?? 0) / 1000));
  const width = $derived(asset.width ?? 0);
  const height = $derived(asset.height ?? 0);
  const canUseDimensions = $derived(width > 0 && height > 0);
  const canUseTimeline = $derived(durationSeconds > 0);
  const normalizedRotation = $derived(((Number(rotation) % 360) + 360) % 360);
  const hasUnsavedChanges = $derived(!isLoading && !hasAppliedEdits && getCurrentEditKey() !== initialEditKey);
  const saveButtonText = $derived(isRendering ? $t('editor_video_rendering') : $t('save'));
  const previewUrl = $derived(
    getAssetMediaUrl({ id: asset.id, cacheKey: asset.thumbhash, edited: false, size: AssetMediaSize.Preview }),
  );
  const cropFrameStyle = $derived(
    canUseDimensions
      ? `left: ${(cropX / width) * 100}%; top: ${(cropY / height) * 100}%; width: ${(cropWidth / width) * 100}%; height: ${(cropHeight / height) * 100}%;`
      : '',
  );
  const textFrameStyle = $derived(
    `left: ${textX * 100}%; top: ${textY * 100}%; font-size: ${Math.round(textSize * 900)}%; color: ${textColor};`,
  );
  const trimRangeStyle = $derived(getTimelineStyle(trimStartSeconds, trimEndSeconds));
  const textRangeStyle = $derived(getTimelineStyle(textStartSeconds, textEndSeconds));
  const speedSegmentError = $derived(getSpeedSegmentError());

  const tools: { id: Tool; label: string; icon: string }[] = [
    { id: 'auto', label: $t('editor_video_auto'), icon: mdiTune },
    { id: 'crop', label: $t('crop'), icon: mdiCropRotate },
    { id: 'adjust', label: $t('editor_video_adjust'), icon: mdiTune },
    { id: 'filters', label: $t('filters'), icon: mdiPaletteOutline },
    { id: 'trim', label: $t('editor_video_trim'), icon: mdiClockOutline },
    { id: 'speed', label: $t('editor_video_speed'), icon: mdiClockOutline },
    { id: 'audio', label: $t('editor_video_audio'), icon: mdiVolumeHigh },
    { id: 'text', label: $t('editor_video_text'), icon: mdiText },
    { id: 'frame', label: $t('editor_video_frame'), icon: mdiImageOutline },
  ];

  function getDefaultAdjustments(): Record<AdjustmentKey, number> {
    return {
      brightness: 0,
      contrast: 0,
      whitePoint: 0,
      highlights: 0,
      shadows: 0,
      blackPoint: 0,
      saturation: 0,
      warmth: 0,
      tint: 0,
      skinTone: 0,
      blueTone: 0,
      vignette: 0,
      hdr: 0,
    };
  }

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
          clampCropToFrame();
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
          mirrorHorizontal ||= parameters.axis === 'horizontal';
          mirrorVertical ||= parameters.axis === 'vertical';
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
          for (const control of adjustmentControls) {
            adjustments[control.key] = getNumberParameter(parameters, control.key, adjustments[control.key]);
          }
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

    clampTimelineState();
    initialEditKey = getCurrentEditKey();
    isLoading = false;
  });

  onDestroy(() => {
    stopCropInteraction();
    stopTimelineDrag();
    stopTextDrag();
  });

  function resetControls() {
    cropEnabled = false;
    cropX = 0;
    cropY = 0;
    cropWidth = width;
    cropHeight = height;
    cropAspectRatio = 'free';
    rotation = 0;
    straighten = 0;
    mirrorHorizontal = false;
    mirrorVertical = false;
    autoEnhance = false;
    stabilize = false;
    adjustments = getDefaultAdjustments();
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

  function clamp(value: number, min: number, max: number) {
    if (max < min) {
      return min;
    }
    return Math.min(Math.max(value, min), max);
  }

  function roundTime(value: number) {
    return Math.round(value * 10) / 10;
  }

  function normalizeRotation(value: number) {
    return ((value % 360) + 360) % 360;
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

  function parseAspectRatio(aspectRatio = cropAspectRatio) {
    const [ratioWidth, ratioHeight] = aspectRatio.split(':').map(Number);
    return ratioWidth && ratioHeight ? ratioWidth / ratioHeight : undefined;
  }

  function ratioSelected(preset: CropPreset): boolean {
    if (preset.isOriginal) {
      return cropAspectRatio === `${width}:${height}`;
    }
    return cropAspectRatio === preset.value;
  }

  function applyCropPreset(preset: CropPreset) {
    if (!canUseDimensions) {
      return;
    }

    cropEnabled = true;

    if (preset.isFree) {
      cropAspectRatio = 'free';
      clampCropToFrame();
      return;
    }

    const aspectRatio = preset.isOriginal ? `${width}:${height}` : preset.value;
    cropAspectRatio = aspectRatio;
    fitCropToAspectRatio(aspectRatio);
  }

  function clearCrop() {
    cropEnabled = false;
    cropAspectRatio = 'free';
    cropX = 0;
    cropY = 0;
    cropWidth = width;
    cropHeight = height;
  }

  function fitCropToAspectRatio(aspectRatio: string) {
    const ratio = parseAspectRatio(aspectRatio);
    if (!ratio || !width || !height) {
      clampCropToFrame();
      return;
    }

    const frameRatio = width / height;
    let nextWidth = width;
    let nextHeight = height;

    if (frameRatio > ratio) {
      nextWidth = height * ratio;
    } else {
      nextHeight = width / ratio;
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

  function setCropBox(crop: CropBox) {
    if (!canUseDimensions) {
      return;
    }

    const nextWidth = clamp(Math.round(crop.width), 1, width);
    const nextHeight = clamp(Math.round(crop.height), 1, height);
    cropX = clamp(Math.round(crop.x), 0, Math.max(0, width - nextWidth));
    cropY = clamp(Math.round(crop.y), 0, Math.max(0, height - nextHeight));
    cropWidth = nextWidth;
    cropHeight = nextHeight;
  }

  function getCropBox() {
    return { x: cropX, y: cropY, width: cropWidth, height: cropHeight };
  }

  function isFullFrameCrop() {
    return cropX === 0 && cropY === 0 && cropWidth === width && cropHeight === height;
  }

  function startCropInteraction(event: PointerEvent, handle: CropHandle) {
    if (!cropStageElement || !canUseDimensions) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    cropEnabled = true;
    cropInteraction = {
      handle,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startCrop: getCropBox(),
      rect: cropStageElement.getBoundingClientRect(),
    };
    addEventListener('pointermove', handleCropPointerMove);
    addEventListener('pointerup', stopCropInteraction);
  }

  function stopCropInteraction() {
    removeEventListener('pointermove', handleCropPointerMove);
    removeEventListener('pointerup', stopCropInteraction);
    cropInteraction = null;
  }

  function handleCropPointerMove(event: PointerEvent) {
    if (!cropInteraction || !canUseDimensions) {
      return;
    }

    const dx = ((event.clientX - cropInteraction.startClientX) / cropInteraction.rect.width) * width;
    const dy = ((event.clientY - cropInteraction.startClientY) / cropInteraction.rect.height) * height;
    const start = cropInteraction.startCrop;

    if (cropInteraction.handle === 'move') {
      setCropBox({
        ...start,
        x: start.x + dx,
        y: start.y + dy,
      });
      return;
    }

    setCropBox(resizeCropBox(start, cropInteraction.handle, dx, dy));
  }

  function resizeCropBox(start: CropBox, handle: CropHandle, dx: number, dy: number): CropBox {
    const movesLeft = handle.includes('left');
    const movesRight = handle.includes('right');
    const movesTop = handle.includes('top');
    const movesBottom = handle.includes('bottom');
    const ratio = parseAspectRatio();
    let left = start.x;
    let right = start.x + start.width;
    let top = start.y;
    let bottom = start.y + start.height;

    if (movesLeft) {
      left += dx;
    }
    if (movesRight) {
      right += dx;
    }
    if (movesTop) {
      top += dy;
    }
    if (movesBottom) {
      bottom += dy;
    }

    let nextWidth = Math.max(minimumCropSize, right - left);
    let nextHeight = Math.max(minimumCropSize, bottom - top);

    if (ratio && cropAspectRatio !== 'free') {
      const horizontalOnly = (movesLeft || movesRight) && !movesTop && !movesBottom;
      const verticalOnly = (movesTop || movesBottom) && !movesLeft && !movesRight;

      if (horizontalOnly || Math.abs(dx) >= Math.abs(dy)) {
        nextHeight = nextWidth / ratio;
      } else if (verticalOnly || Math.abs(dy) > Math.abs(dx)) {
        nextWidth = nextHeight * ratio;
      }

      if (horizontalOnly) {
        top = start.y + (start.height - nextHeight) / 2;
      } else if (movesTop) {
        top = start.y + start.height - nextHeight;
      }
      if (verticalOnly) {
        left = start.x + (start.width - nextWidth) / 2;
      } else if (movesLeft) {
        left = start.x + start.width - nextWidth;
      }
    }

    if (!movesLeft && !movesRight) {
      left = start.x + (start.width - nextWidth) / 2;
    } else if (!movesLeft) {
      left = start.x;
    }

    if (!movesTop && !movesBottom) {
      top = start.y + (start.height - nextHeight) / 2;
    } else if (!movesTop) {
      top = start.y;
    }

    if (left < 0) {
      left = 0;
    }
    if (top < 0) {
      top = 0;
    }
    if (left + nextWidth > width) {
      nextWidth = width - left;
    }
    if (top + nextHeight > height) {
      nextHeight = height - top;
    }

    if (ratio && cropAspectRatio !== 'free') {
      if (nextWidth / nextHeight > ratio) {
        nextWidth = nextHeight * ratio;
      } else {
        nextHeight = nextWidth / ratio;
      }
    }

    return { x: left, y: top, width: nextWidth, height: nextHeight };
  }

  function formatTime(seconds: number) {
    if (!Number.isFinite(seconds)) {
      return '0:00';
    }

    const safeSeconds = Math.max(0, seconds);
    const minutes = Math.floor(safeSeconds / 60);
    const remainingSeconds = Math.floor(safeSeconds % 60);
    const tenths = Math.round((safeSeconds % 1) * 10);

    return tenths > 0
      ? `${minutes}:${remainingSeconds.toString().padStart(2, '0')}.${tenths}`
      : `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  function percentFromSeconds(seconds: number) {
    return durationSeconds > 0 ? clamp((seconds / durationSeconds) * 100, 0, 100) : 0;
  }

  function getTimelineStyle(startSeconds: number, endSeconds: number) {
    const start = percentFromSeconds(startSeconds);
    const end = percentFromSeconds(endSeconds);
    return `left: ${start}%; width: ${Math.max(0, end - start)}%;`;
  }

  function getSegmentTimelineStyle(segment: SpeedSegment) {
    return getTimelineStyle(segment.startSeconds, segment.endSeconds);
  }

  function getHandleStyle(seconds: number) {
    return `left: ${percentFromSeconds(seconds)}%;`;
  }

  function secondsFromPointer(event: PointerEvent, rect: DOMRect) {
    return roundTime(clamp(((event.clientX - rect.left) / rect.width) * durationSeconds, 0, durationSeconds));
  }

  function startTimelineDrag(event: PointerEvent, target: TimeDragTarget, segmentId?: string) {
    if (!canUseTimeline) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    timelineDrag = { target, segmentId, rect: (event.currentTarget as HTMLElement).getBoundingClientRect() };
    handleTimelinePointerMove(event);
    addEventListener('pointermove', handleTimelinePointerMove);
    addEventListener('pointerup', stopTimelineDrag);
  }

  function stopTimelineDrag() {
    removeEventListener('pointermove', handleTimelinePointerMove);
    removeEventListener('pointerup', stopTimelineDrag);
    timelineDrag = null;
  }

  function handleTimelinePointerMove(event: PointerEvent) {
    if (!timelineDrag || !canUseTimeline) {
      return;
    }

    const seconds = secondsFromPointer(event, timelineDrag.rect);
    switch (timelineDrag.target) {
      case 'trim-start': {
        setTrimStart(seconds);
        break;
      }
      case 'trim-end': {
        setTrimEnd(seconds);
        break;
      }
      case 'text-start': {
        textStartSeconds = clamp(
          seconds,
          trimStartSeconds,
          Math.max(trimStartSeconds, textEndSeconds - minimumTimelineGap),
        );
        break;
      }
      case 'text-end': {
        textEndSeconds = clamp(
          seconds,
          Math.min(trimEndSeconds, textStartSeconds + minimumTimelineGap),
          trimEndSeconds,
        );
        break;
      }
      case 'speed-start': {
        updateSpeedSegmentTime(timelineDrag.segmentId, { startSeconds: seconds });
        break;
      }
      case 'speed-end': {
        updateSpeedSegmentTime(timelineDrag.segmentId, { endSeconds: seconds });
        break;
      }
    }
  }

  function setTrimStart(seconds: number) {
    trimStartSeconds = clamp(seconds, 0, Math.max(0, trimEndSeconds - minimumTimelineGap));
    clampTimelineState();
  }

  function setTrimEnd(seconds: number) {
    trimEndSeconds = clamp(seconds, Math.min(durationSeconds, trimStartSeconds + minimumTimelineGap), durationSeconds);
    clampTimelineState();
  }

  function clampTimelineState() {
    if (!canUseTimeline) {
      trimStartSeconds = 0;
      trimEndSeconds = 0;
      textStartSeconds = 0;
      textEndSeconds = 0;
      speedSegments = [];
      return;
    }

    trimStartSeconds = clamp(trimStartSeconds, 0, Math.max(0, durationSeconds - minimumTimelineGap));
    trimEndSeconds = clamp(trimEndSeconds || durationSeconds, trimStartSeconds + minimumTimelineGap, durationSeconds);
    textStartSeconds = clamp(
      textStartSeconds,
      trimStartSeconds,
      Math.max(trimStartSeconds, trimEndSeconds - minimumTimelineGap),
    );
    textEndSeconds = clamp(textEndSeconds || trimEndSeconds, textStartSeconds + minimumTimelineGap, trimEndSeconds);
    speedSegments = speedSegments.map((segment) => clampSpeedSegment(segment));
  }

  function createSpeedSegment(rate = 0.5, startSeconds?: number, endSeconds?: number) {
    const rangeStart = trimStartSeconds;
    const rangeEnd = trimEndSeconds || durationSeconds;
    const segmentSpan = Math.max(minimumTimelineGap, Math.min(2, (rangeEnd - rangeStart) / 4));
    const previousEnd = Math.max(rangeStart, ...speedSegments.map((segment) => segment.endSeconds));
    const nextStart =
      startSeconds ?? clamp(previousEnd, rangeStart, Math.max(rangeStart, rangeEnd - minimumTimelineGap));
    const nextEnd = endSeconds ?? clamp(nextStart + segmentSpan, nextStart + minimumTimelineGap, rangeEnd);

    return { id: `speed-segment-${speedSegmentId++}`, rate, startSeconds: nextStart, endSeconds: nextEnd };
  }

  function addSpeedSegment() {
    speedMode = 'segment';
    speedSegments = [...speedSegments, createSpeedSegment()];
  }

  function removeSpeedSegment(id: string) {
    speedSegments = speedSegments.filter((segment) => segment.id !== id);
  }

  function updateSpeedSegment(id: string, patch: Partial<SpeedSegment>) {
    speedSegments = speedSegments.map((segment) =>
      segment.id === id ? clampSpeedSegment({ ...segment, ...patch }) : segment,
    );
  }

  function updateSpeedSegmentTime(
    id: string | undefined,
    patch: Partial<Pick<SpeedSegment, 'startSeconds' | 'endSeconds'>>,
  ) {
    if (!id) {
      return;
    }
    updateSpeedSegment(id, patch);
  }

  function clampSpeedSegment(segment: SpeedSegment) {
    const startSeconds = clamp(
      segment.startSeconds,
      trimStartSeconds,
      Math.max(trimStartSeconds, trimEndSeconds - minimumTimelineGap),
    );
    const endSeconds = clamp(
      segment.endSeconds,
      startSeconds + minimumTimelineGap,
      Math.max(startSeconds + minimumTimelineGap, trimEndSeconds),
    );
    return { ...segment, startSeconds, endSeconds };
  }

  function setSpeedMode(mode: SpeedMode) {
    speedMode = mode;
    if (mode === 'segment' && speedSegments.length === 0) {
      speedSegments = [createSpeedSegment()];
    }
  }

  function getSpeedSegmentError() {
    if (speedMode !== 'segment') {
      return '';
    }

    const segments = [...speedSegments].sort((a, b) => a.startSeconds - b.startSeconds);
    for (const segment of segments) {
      if (segment.endSeconds <= segment.startSeconds) {
        return $t('editor_video_speed_segment_invalid');
      }
    }
    for (let index = 1; index < segments.length; index++) {
      if (segments[index].startSeconds < segments[index - 1].endSeconds) {
        return $t('editor_video_speed_segment_overlap');
      }
    }
    return '';
  }

  function getSpeedSegmentEdits() {
    const error = getSpeedSegmentError();
    if (error) {
      throw new Error(error);
    }

    return speedSegments
      .filter((segment) => segment.rate !== 1)
      .map((segment) => ({
        ...segment,
        startMs: Math.round(segment.startSeconds * 1000),
        endMs: Math.round(segment.endSeconds * 1000),
      }))
      .sort((a, b) => a.startMs - b.startMs);
  }

  function updateAdjustment(key: AdjustmentKey, value: number) {
    adjustments[key] = value;
  }

  function startTextDrag(event: PointerEvent) {
    const stage =
      event.currentTarget instanceof HTMLElement ? event.currentTarget.closest<HTMLElement>('.text-preview') : null;
    if (!stage) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    textDrag = { rect: stage.getBoundingClientRect() };
    updateTextPosition(event);
    addEventListener('pointermove', updateTextPosition);
    addEventListener('pointerup', stopTextDrag);
  }

  function stopTextDrag() {
    removeEventListener('pointermove', updateTextPosition);
    removeEventListener('pointerup', stopTextDrag);
    textDrag = null;
  }

  function updateTextPosition(event: PointerEvent) {
    if (!textDrag) {
      return;
    }

    textX = clamp((event.clientX - textDrag.rect.left) / textDrag.rect.width, 0.05, 0.95);
    textY = clamp((event.clientY - textDrag.rect.top) / textDrag.rect.height, 0.08, 0.92);
  }

  function pushEdit(edits: VideoEdit[], action: string, parameters: Record<string, unknown>) {
    edits.push({ action, parameters } as VideoEdit);
  }

  function nonZeroAdjustments() {
    return Object.fromEntries(Object.entries(adjustments).filter(([, value]) => value !== 0));
  }

  function buildEdits() {
    const edits: VideoEdit[] = [];

    if (cropEnabled && canUseDimensions && !isFullFrameCrop()) {
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

    const nextAdjustments = nonZeroAdjustments();
    if (Object.keys(nextAdjustments).length > 0) {
      pushEdit(edits, 'adjust', nextAdjustments);
    }

    if (lookName !== 'none') {
      pushEdit(edits, 'filter', { name: lookName, intensity: lookIntensity });
    }

    if (canUseTimeline && (trimStartSeconds > 0 || trimEndSeconds < durationSeconds)) {
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
      const textParameters: Record<string, unknown> = {
        text: text.trim(),
        x: textX,
        y: textY,
        size: textSize,
        color: textColor,
      };

      if (canUseTimeline) {
        textParameters.startMs = Math.round(textStartSeconds * 1000);
        textParameters.endMs = Math.round(textEndSeconds * 1000);
      }

      pushEdit(edits, 'textOverlay', textParameters);
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
    isRendering = false;

    try {
      const edits = buildEdits();
      const editCompleted =
        edits.length > 0
          ? waitForWebsocketEvent('AssetEditReadyV2', (event) => event.asset.id === asset.id, 600_000)
          : undefined;

      await (edits.length === 0
        ? removeAssetEdits({ id: asset.id })
        : editAsset({ id: asset.id, assetEditsCreateDto: { edits } }));

      eventManager.emit('AssetEditsApplied', asset.id);

      if (editCompleted) {
        isRendering = true;
        toastManager.primary($t('editor_video_rendering_toast'));

        await editCompleted;
        eventManager.emit('AssetEditsApplied', asset.id);
      }

      toastManager.primary($t('editor_edits_applied_success'));
      hasAppliedEdits = true;
      onClose(true);
    } catch (error) {
      toastManager.danger(error instanceof Error ? error.message : $t('editor_edits_applied_error'));
    } finally {
      isSaving = false;
      isRendering = false;
    }
  }

  function exportFrame() {
    const video = document.querySelector<HTMLVideoElement>('video');
    if (!video || !video.videoWidth || !video.videoHeight) {
      toastManager.danger($t('editor_video_export_frame_error'));
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
</script>

<svelte:document
  use:shortcuts={[
    { shortcut: { key: 'Escape' }, onShortcut: closeEditor },
    { shortcut: { key: 'Enter' }, onShortcut: applyEdits },
    { shortcut: { key: ']' }, onShortcut: () => selectedTool === 'crop' && rotateVideo(90) },
    { shortcut: { key: '[' }, onShortcut: () => selectedTool === 'crop' && rotateVideo(-90) },
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
      <p class="text-lg text-immich-fg capitalize dark:text-immich-dark-fg">{$t('editor_video_edit')}</p>
    </HStack>
    <Button shape="round" size="small" onclick={applyEdits} loading={isSaving} disabled={isLoading}>
      {saveButtonText}
    </Button>
  </HStack>

  <nav class="mt-4 flex gap-1 overflow-x-auto px-2 pb-1" aria-label={$t('editor_video_tools')}>
    {#each tools as tool (tool.id)}
      <button
        type="button"
        aria-pressed={selectedTool === tool.id}
        class="tool-tab {selectedTool === tool.id ? 'active' : ''}"
        onclick={() => (selectedTool = tool.id)}
      >
        <Icon icon={tool.icon} size="18" />
        <span>{tool.label}</span>
      </button>
    {/each}
  </nav>

  {#if isRendering}
    <div class="mx-4 mt-4 rounded-md border border-immich-primary/40 bg-immich-primary/10 px-3 py-2 text-sm">
      {$t('editor_video_rendering_toast')}
    </div>
  {/if}

  <section class="mt-4 flex-1 overflow-y-auto px-4 pb-4">
    {#if isLoading}
      <p class="text-sm text-gray-500 dark:text-gray-400">{$t('loading')}...</p>
    {:else if selectedTool === 'auto'}
      <div class="space-y-3">
        <button
          type="button"
          aria-pressed={autoEnhance}
          class="toggle-card {autoEnhance ? 'active' : ''}"
          onclick={() => (autoEnhance = !autoEnhance)}
        >
          <span class="font-medium">{$t('editor_video_auto_enhance')}</span>
          <span>{$t('editor_video_auto_enhance_description')}</span>
        </button>
        <button
          type="button"
          aria-pressed={stabilize}
          class="toggle-card {stabilize ? 'active' : ''}"
          onclick={() => (stabilize = !stabilize)}
        >
          <span class="font-medium">{$t('editor_video_stabilize')}</span>
          <span>{$t('editor_video_stabilize_description')}</span>
        </button>
      </div>
    {:else if selectedTool === 'crop'}
      <div class="space-y-5">
        {#if !canUseDimensions}
          <p class="rounded-md bg-gray-100 p-3 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            {$t('editor_video_dimensions_unavailable')}
          </p>
        {:else}
          <div class="crop-preview" style:aspect-ratio={`${width} / ${height}`} bind:this={cropStageElement}>
            <img src={previewUrl} alt="" draggable="false" />
            <div class="crop-frame" style={cropFrameStyle}>
              <button
                type="button"
                class="crop-grid"
                aria-label={$t('editor_video_move_crop')}
                onpointerdown={(event) => startCropInteraction(event, 'move')}
              ></button>
              {#each ['top', 'right', 'bottom', 'left'] as edge (edge)}
                <button
                  type="button"
                  class="crop-handle edge {edge}"
                  aria-label={$t('editor_handle_edge', { values: { edge } })}
                  onpointerdown={(event) => startCropInteraction(event, edge as CropHandle)}
                ></button>
              {/each}
              {#each ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as corner (corner)}
                <button
                  type="button"
                  class="crop-handle corner {corner}"
                  aria-label={$t('editor_handle_corner', { values: { corner: corner.replace('-', '_') } })}
                  onpointerdown={(event) => startCropInteraction(event, corner as CropHandle)}
                ></button>
              {/each}
            </div>
          </div>

          <div>
            <div class="mb-2 flex items-center justify-between text-sm">
              <h2>{$t('editor_orientation')}</h2>
              {#if normalizedRotation !== 0}
                <span class="rounded-full bg-gray-200 px-2 py-1 text-xs dark:bg-gray-800">{normalizedRotation}°</span>
              {/if}
            </div>
            <HStack>
              <IconButton
                class="w-full"
                size="small"
                aria-label={$t('editor_rotate_left')}
                icon={mdiRotateLeft}
                color={normalizedRotation === 270 ? 'primary' : 'secondary'}
                onclick={() => rotateVideo(-90)}
              />
              <IconButton
                class="w-full"
                size="small"
                aria-label={$t('editor_rotate_right')}
                icon={mdiRotateRight}
                color={normalizedRotation === 90 ? 'primary' : 'secondary'}
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
          </div>

          <label class="slider-row">
            <span>{$t('editor_video_straighten')}</span>
            <span>{straighten}°</span>
            <input type="range" min="-45" max="45" step="0.1" bind:value={straighten} />
          </label>

          <div>
            <div class="mb-2 flex items-center justify-between text-sm">
              <h2>{$t('crop')}</h2>
              <Button variant="ghost" shape="round" size="small" onclick={clearCrop} disabled={!cropEnabled}>
                {$t('editor_video_clear_crop')}
              </Button>
            </div>
            <div class="preset-grid">
              {#each cropPresets as preset (preset.value)}
                <button
                  type="button"
                  class="preset-button {ratioSelected(preset) ? 'active' : ''}"
                  aria-label={preset.caption ? `${preset.label} ${preset.caption}` : preset.label}
                  onclick={() => applyCropPreset(preset)}
                >
                  {#if preset.isFree}
                    <span class="free-crop-icon"></span>
                  {:else}
                    <span class="aspect-icon" style="width: {preset.width}px; height: {preset.height}px;"></span>
                  {/if}
                  <span class="leading-tight">{preset.label}</span>
                  {#if preset.caption}
                    <span class="text-[0.65rem] text-gray-400">{preset.caption}</span>
                  {/if}
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {:else if selectedTool === 'adjust'}
      <div class="space-y-3">
        {#each adjustmentControls as control (control.key)}
          <div class="slider-row">
            <div class="flex items-center justify-between">
              <span>{control.label}</span>
              <button
                type="button"
                class="text-xs text-immich-primary disabled:text-gray-400"
                disabled={adjustments[control.key] === 0}
                onclick={() => updateAdjustment(control.key, 0)}
              >
                {$t('editor_video_reset_value')}
              </button>
            </div>
            <div class="flex items-center gap-3">
              <input
                type="range"
                min="-100"
                max="100"
                value={adjustments[control.key]}
                oninput={(event) => updateAdjustment(control.key, Number(event.currentTarget.value))}
              />
              <span class="w-9 text-end text-xs text-gray-400">{adjustments[control.key]}</span>
            </div>
          </div>
        {/each}
      </div>
    {:else if selectedTool === 'filters'}
      <div class="space-y-5">
        <div class="grid grid-cols-2 gap-3">
          {#each filterOptions as option (option.value)}
            <button
              type="button"
              class="filter-tile {lookName === option.value ? 'active' : ''}"
              aria-pressed={lookName === option.value}
              onclick={() => (lookName = option.value)}
            >
              <span class="h-16 rounded-md {option.class}"></span>
              <span>{option.label}</span>
            </button>
          {/each}
        </div>
        <label class="slider-row">
          <span>{$t('editor_video_intensity')}</span>
          <span>{lookIntensity}</span>
          <input type="range" min="0" max="100" bind:value={lookIntensity} disabled={lookName === 'none'} />
        </label>
      </div>
    {:else if selectedTool === 'trim'}
      <div class="space-y-5">
        {#if !canUseTimeline}
          <p class="rounded-md bg-gray-100 p-3 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            {$t('editor_video_duration_unavailable')}
          </p>
        {:else}
          <div class="time-readout">
            <span>{$t('start')}: {formatTime(trimStartSeconds)}</span>
            <span>{$t('editor_video_end')}: {formatTime(trimEndSeconds)}</span>
          </div>
          <div
            class="timeline-track"
            role="group"
            aria-label={$t('editor_video_trim')}
            onpointerdown={(event) => startTimelineDrag(event, 'trim-start')}
          >
            <div class="timeline-fill" style={trimRangeStyle}></div>
            <button
              type="button"
              class="timeline-handle"
              style={getHandleStyle(trimStartSeconds)}
              aria-label={$t('editor_video_trim_start')}
              onpointerdown={(event) => startTimelineDrag(event, 'trim-start')}
            ></button>
            <button
              type="button"
              class="timeline-handle"
              style={getHandleStyle(trimEndSeconds)}
              aria-label={$t('editor_video_trim_end')}
              onpointerdown={(event) => startTimelineDrag(event, 'trim-end')}
            ></button>
          </div>
        {/if}
      </div>
    {:else if selectedTool === 'speed'}
      <div class="space-y-5">
        <div class="segmented-control">
          <button type="button" class:active={speedMode === 'whole'} onclick={() => setSpeedMode('whole')}>
            {$t('editor_video_whole_video')}
          </button>
          <button type="button" class:active={speedMode === 'segment'} onclick={() => setSpeedMode('segment')}>
            {$t('editor_video_segment')}
          </button>
        </div>

        {#if speedMode === 'whole'}
          <div class="speed-grid">
            {#each speedRates as rate (rate)}
              <button type="button" class:active={speed === rate} onclick={() => (speed = rate)}>{rate}x</button>
            {/each}
          </div>
        {:else if !canUseTimeline}
          <p class="rounded-md bg-gray-100 p-3 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            {$t('editor_video_duration_unavailable')}
          </p>
        {:else}
          <div class="space-y-4">
            {#each speedSegments as segment, index (segment.id)}
              <section class="rounded-md border border-gray-200 p-3 dark:border-gray-700">
                <HStack class="justify-between">
                  <p class="text-sm font-medium">{$t('editor_video_segment')} {index + 1}</p>
                  <Button variant="ghost" shape="round" size="small" onclick={() => removeSpeedSegment(segment.id)}>
                    {$t('remove')}
                  </Button>
                </HStack>
                <div class="speed-grid mt-3">
                  {#each speedRates as rate (rate)}
                    <button
                      type="button"
                      class:active={segment.rate === rate}
                      onclick={() => updateSpeedSegment(segment.id, { rate })}
                    >
                      {rate}x
                    </button>
                  {/each}
                </div>
                <div class="time-readout mt-4">
                  <span>{formatTime(segment.startSeconds)}</span>
                  <span>{formatTime(segment.endSeconds)}</span>
                </div>
                <div
                  class="timeline-track"
                  role="group"
                  aria-label={$t('editor_video_speed_segment_timeline')}
                  onpointerdown={(event) => startTimelineDrag(event, 'speed-start', segment.id)}
                >
                  <div class="timeline-fill" style={getSegmentTimelineStyle(segment)}></div>
                  <button
                    type="button"
                    class="timeline-handle"
                    style={getHandleStyle(segment.startSeconds)}
                    aria-label={$t('editor_video_segment_start')}
                    onpointerdown={(event) => startTimelineDrag(event, 'speed-start', segment.id)}
                  ></button>
                  <button
                    type="button"
                    class="timeline-handle"
                    style={getHandleStyle(segment.endSeconds)}
                    aria-label={$t('editor_video_segment_end')}
                    onpointerdown={(event) => startTimelineDrag(event, 'speed-end', segment.id)}
                  ></button>
                </div>
              </section>
            {/each}

            {#if speedSegmentError}
              <p class="text-sm text-red-500">{speedSegmentError}</p>
            {/if}

            <Button variant="outline" shape="round" size="small" onclick={addSpeedSegment}>
              {$t('editor_video_add_segment')}
            </Button>
          </div>
        {/if}
      </div>
    {:else if selectedTool === 'audio'}
      <div class="space-y-5">
        <button
          type="button"
          aria-pressed={muted}
          class="toggle-card {muted ? 'active' : ''}"
          onclick={() => (muted = !muted)}
        >
          <span class="font-medium">{$t('editor_video_mute')}</span>
          <span>{$t('editor_video_mute_description')}</span>
        </button>
        <label class="slider-row">
          <span>{$t('editor_video_volume')}</span>
          <span>{volume}x</span>
          <input type="range" min="0" max="2" step="0.05" bind:value={volume} disabled={muted} />
        </label>
      </div>
    {:else if selectedTool === 'text'}
      <div class="space-y-5">
        <div class="text-preview" style:aspect-ratio={canUseDimensions ? `${width} / ${height}` : '16 / 9'}>
          <img src={previewUrl} alt="" draggable="false" />
          <button
            type="button"
            class="text-overlay"
            style={textFrameStyle}
            aria-label={$t('editor_video_move_text')}
            onpointerdown={startTextDrag}
          >
            {text || $t('editor_video_text_placeholder')}
          </button>
        </div>

        <label class="field">
          <span>{$t('editor_video_text')}</span>
          <input class="editor-input" type="text" maxlength="200" bind:value={text} />
        </label>

        {#if canUseTimeline}
          <div>
            <div class="time-readout">
              <span>{formatTime(textStartSeconds)}</span>
              <span>{formatTime(textEndSeconds)}</span>
            </div>
            <div
              class="timeline-track"
              role="group"
              aria-label={$t('editor_video_text_timing')}
              onpointerdown={(event) => startTimelineDrag(event, 'text-start')}
            >
              <div class="timeline-fill" style={textRangeStyle}></div>
              <button
                type="button"
                class="timeline-handle"
                style={getHandleStyle(textStartSeconds)}
                aria-label={$t('editor_video_text_start')}
                onpointerdown={(event) => startTimelineDrag(event, 'text-start')}
              ></button>
              <button
                type="button"
                class="timeline-handle"
                style={getHandleStyle(textEndSeconds)}
                aria-label={$t('editor_video_text_end')}
                onpointerdown={(event) => startTimelineDrag(event, 'text-end')}
              ></button>
            </div>
          </div>
        {/if}

        <label class="slider-row">
          <span>{$t('size')}</span>
          <span>{textSize}</span>
          <input type="range" min="0.02" max="0.2" step="0.01" bind:value={textSize} />
        </label>

        <label class="field">
          <span>{$t('color')}</span>
          <input class="h-10 w-20" type="color" bind:value={textColor} />
        </label>
      </div>
    {:else if selectedTool === 'frame'}
      <div class="space-y-4">
        <div class="rounded-md bg-gray-100 p-3 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-300">
          {$t('editor_video_frame_description')}
        </div>
        <Button variant="outline" shape="round" size="small" onclick={exportFrame}>
          {$t('editor_video_export_frame')}
        </Button>
      </div>
    {/if}
  </section>

  <section class="p-4">
    <Button
      variant="outline"
      onclick={resetControls}
      disabled={!hasUnsavedChanges}
      class="self-start"
      shape="round"
      size="small"
    >
      {$t('editor_reset_all_changes')}
    </Button>
  </section>
</section>

<style>
  .tool-tab {
    display: inline-flex;
    height: 2.5rem;
    flex-shrink: 0;
    align-items: center;
    gap: 0.375rem;
    border-radius: 9999px;
    padding: 0 0.75rem;
    font-size: 0.875rem;
    color: rgb(229 231 235);
    background: rgb(31 41 55);
    transition:
      color 0.15s ease,
      background 0.15s ease;
  }

  .tool-tab:hover,
  .tool-tab.active {
    color: white;
    background: var(--immich-primary);
  }

  .toggle-card {
    display: grid;
    width: 100%;
    gap: 0.25rem;
    border-radius: 0.5rem;
    border: 1px solid rgb(55 65 81);
    padding: 0.875rem;
    text-align: start;
    font-size: 0.875rem;
    color: rgb(209 213 219);
    background: rgb(17 24 39);
  }

  .toggle-card.active {
    border-color: var(--immich-primary);
    background: color-mix(in srgb, var(--immich-primary) 18%, transparent);
    color: white;
  }

  .crop-preview,
  .text-preview {
    position: relative;
    width: 100%;
    overflow: hidden;
    border-radius: 0.5rem;
    background: black;
  }

  .crop-preview img,
  .text-preview img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    user-select: none;
  }

  .crop-frame {
    position: absolute;
    border: 2px solid white;
    box-shadow: 0 0 0 9999px rgb(0 0 0 / 55%);
  }

  .crop-grid {
    position: absolute;
    inset: 0;
    cursor: move;
    background-image:
      linear-gradient(rgb(255 255 255 / 72%) 1px, transparent 0),
      linear-gradient(90deg, rgb(255 255 255 / 72%) 1px, transparent 0);
    background-size: calc(100% / 3) calc(100% / 3);
  }

  .crop-handle {
    position: absolute;
    z-index: 1;
    border-radius: 9999px;
    background: white;
  }

  .crop-handle.edge.top,
  .crop-handle.edge.bottom {
    left: 50%;
    width: 2.25rem;
    height: 0.375rem;
    transform: translateX(-50%);
    cursor: ns-resize;
  }

  .crop-handle.edge.top {
    top: -0.25rem;
  }

  .crop-handle.edge.bottom {
    bottom: -0.25rem;
  }

  .crop-handle.edge.left,
  .crop-handle.edge.right {
    top: 50%;
    width: 0.375rem;
    height: 2.25rem;
    transform: translateY(-50%);
    cursor: ew-resize;
  }

  .crop-handle.edge.left {
    left: -0.25rem;
  }

  .crop-handle.edge.right {
    right: -0.25rem;
  }

  .crop-handle.corner {
    width: 0.875rem;
    height: 0.875rem;
  }

  .crop-handle.corner.top-left {
    top: -0.45rem;
    left: -0.45rem;
    cursor: nwse-resize;
  }

  .crop-handle.corner.top-right {
    top: -0.45rem;
    right: -0.45rem;
    cursor: nesw-resize;
  }

  .crop-handle.corner.bottom-right {
    right: -0.45rem;
    bottom: -0.45rem;
    cursor: nwse-resize;
  }

  .crop-handle.corner.bottom-left {
    bottom: -0.45rem;
    left: -0.45rem;
    cursor: nesw-resize;
  }

  .preset-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
  }

  .preset-button,
  .filter-tile,
  .speed-grid button,
  .segmented-control button {
    border-radius: 0.5rem;
    border: 1px solid rgb(55 65 81);
    background: rgb(17 24 39);
    color: rgb(229 231 235);
  }

  .preset-button {
    display: grid;
    min-height: 5rem;
    place-items: center;
    gap: 0.25rem;
    padding: 0.625rem;
    font-size: 0.875rem;
  }

  .preset-button.active,
  .filter-tile.active,
  .speed-grid button.active,
  .segmented-control button.active {
    border-color: var(--immich-primary);
    background: color-mix(in srgb, var(--immich-primary) 24%, transparent);
    color: white;
  }

  .aspect-icon,
  .free-crop-icon {
    display: block;
    border: 2px solid currentColor;
    border-radius: 0.125rem;
  }

  .free-crop-icon {
    width: 1.5rem;
    height: 1.5rem;
    border-style: dashed;
  }

  .slider-row {
    display: grid;
    gap: 0.5rem;
    font-size: 0.875rem;
  }

  .slider-row > span:first-child {
    font-weight: 500;
  }

  .slider-row > span:nth-child(2) {
    justify-self: end;
    color: rgb(156 163 175);
    font-size: 0.75rem;
  }

  .slider-row input[type='range'] {
    width: 100%;
  }

  .filter-tile {
    display: grid;
    gap: 0.5rem;
    padding: 0.5rem;
    text-align: start;
    font-size: 0.875rem;
  }

  .time-readout {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: rgb(156 163 175);
  }

  .timeline-track {
    position: relative;
    height: 2.75rem;
    border-radius: 9999px;
    background: linear-gradient(90deg, rgb(255 255 255 / 18%) 1px, transparent 1px), rgb(31 41 55);
    background-size: 10% 100%;
  }

  .timeline-fill {
    position: absolute;
    top: 0.875rem;
    height: 1rem;
    border-radius: 9999px;
    background: var(--immich-primary);
  }

  .timeline-handle {
    position: absolute;
    top: 50%;
    width: 1.125rem;
    height: 2.125rem;
    border-radius: 9999px;
    background: white;
    box-shadow: 0 0 0 2px rgb(0 0 0 / 25%);
    transform: translate(-50%, -50%);
  }

  .speed-grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 0.375rem;
  }

  .speed-grid button {
    min-height: 2.25rem;
    font-size: 0.875rem;
  }

  .segmented-control {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.375rem;
  }

  .segmented-control button {
    min-height: 2.5rem;
    font-size: 0.875rem;
  }

  .text-overlay {
    position: absolute;
    max-width: 80%;
    border-radius: 0.375rem;
    border: 1px dashed rgb(255 255 255 / 75%);
    padding: 0.25rem 0.5rem;
    text-align: center;
    text-shadow: 0 1px 5px rgb(0 0 0 / 90%);
    transform: translate(-50%, -50%);
    cursor: move;
  }

  .field {
    display: grid;
    gap: 0.5rem;
    font-size: 0.875rem;
  }

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
