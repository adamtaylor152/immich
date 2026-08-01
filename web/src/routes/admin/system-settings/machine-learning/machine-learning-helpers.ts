import { MachineLearningHardwareAcceleration, Mode2 as RunPodMode } from '@immich/sdk';

/**
 * Hardware acceleration value map keeping the SDK enum hidden behind a
 * stable shape that the section components import.
 */
export const hardwareAcceleration = {
  Auto: MachineLearningHardwareAcceleration.Auto,
  OpenVino: MachineLearningHardwareAcceleration.Openvino,
  Cuda: MachineLearningHardwareAcceleration.Cuda,
} as const;

export type ImageEnrichmentHardwareAcceleration =
  MachineLearningHardwareAcceleration.Openvino | MachineLearningHardwareAcceleration.Cuda;

export const isImageEnrichmentHardwareAcceleration = (
  acceleration: MachineLearningHardwareAcceleration,
): acceleration is ImageEnrichmentHardwareAcceleration =>
  acceleration === hardwareAcceleration.OpenVino || acceleration === hardwareAcceleration.Cuda;

export const imageEnrichmentHardwarePresets: Record<
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

/**
 * Curated image-description model presets.
 *
 * The dropdown lets admins pick from a vetted set of Qwen-VL models that are
 * known to load on the published `:fork-main-cuda-runpod` ML image (Qwen2.5
 * and Qwen3 families dispatched via `AutoModelForVision2Seq`). The "Custom"
 * sentinel reveals a free-text HF model name input so power users aren't
 * locked into this list.
 *
 * `gpuPoolIds` is a recommended-default for RunPod's serverless GPU pool
 * textarea. The admin can override; we never silently rewrite their choice.
 */
export const CUSTOM_MODEL = '__custom__';

export type DescriptionModelProfile = {
  value: string;
  label: string;
  vramHint: string;
  gpuPoolIds: string[];
};

export const DESCRIPTION_MODEL_PROFILES: readonly DescriptionModelProfile[] = [
  {
    value: 'Qwen/Qwen2.5-VL-3B-Instruct',
    label: 'Qwen2.5-VL 3B (lightweight)',
    vramHint: '~6 GB VRAM',
    gpuPoolIds: ['AMPERE_24', 'ADA_24'],
  },
  {
    value: 'Qwen/Qwen2.5-VL-7B-Instruct',
    label: 'Qwen2.5-VL 7B (balanced)',
    vramHint: '~16 GB VRAM',
    gpuPoolIds: ['AMPERE_24', 'AMPERE_48', 'ADA_48_PRO'],
  },
  {
    value: 'Qwen/Qwen2.5-VL-32B-Instruct',
    label: 'Qwen2.5-VL 32B (quality)',
    vramHint: '~64 GB VRAM, needs 80 GB GPU',
    gpuPoolIds: ['AMPERE_80', 'ADA_80_PRO'],
  },
  {
    value: 'Qwen/Qwen2.5-VL-72B-Instruct',
    label: 'Qwen2.5-VL 72B (top tier)',
    vramHint: '~144 GB VRAM, multi-GPU only',
    gpuPoolIds: ['AMPERE_80_2X'],
  },
  {
    value: 'Qwen/Qwen3-VL-30B-A3B-Instruct',
    label: 'Qwen3-VL 30B-A3B (MoE)',
    vramHint: '~60 GB VRAM',
    gpuPoolIds: ['AMPERE_48', 'AMPERE_80'],
  },
];

export type FallbackModelProfile = {
  value: string;
  label: string;
};

export const FALLBACK_MODEL_PROFILES: readonly FallbackModelProfile[] = [
  { value: 'microsoft/Florence-2-base-ft', label: 'Florence-2-base-ft (local CUDA only)' },
  { value: 'microsoft/Florence-2-large-ft', label: 'Florence-2-large-ft (local CUDA only)' },
];

export const findDescriptionProfile = (modelName: string): DescriptionModelProfile | undefined =>
  DESCRIPTION_MODEL_PROFILES.find((p) => p.value === modelName);

/**
 * Compute the effective UI RunPod mode. Older configs may have `mode`
 * undefined while `enabled === true`; treat that as legacy pod mode so the
 * form doesn't surprise the admin.
 */
export const computeRunpodMode = (mode: RunPodMode | undefined, enabled: boolean): RunPodMode => {
  if (mode && mode !== RunPodMode.Disabled) {
    return mode;
  }
  return enabled ? RunPodMode.Pod : RunPodMode.Disabled;
};

/** Split a newline-joined textarea value into trimmed, non-empty lines. */
export const parseLines = (text: string): string[] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/** Human-readable duration like "23s" / "4m" / "1h 12m". */
export const formatDuration = (seconds: number): string => {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
};

/** Local-format ISO timestamps, with a dash for null/undefined. */
export const formatTimestamp = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString() : '—');
