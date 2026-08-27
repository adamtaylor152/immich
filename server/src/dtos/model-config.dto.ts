// Compatibility shim: upstream folded the per-model ML config schemas into
// src/dtos/config.dto.ts (as part of the new config module). The fork's ML
// consumers (machine-learning.repository, prompt-assembler.service, specs)
// keep importing from this path.
export {
  CLIPConfig,
  CLIPConfigSchema,
  DuplicateDetectionConfigSchema,
  ImageDescriptionConfigSchema,
  ImageDescriptionPromptSchema,
  NsfwDetectionConfigSchema,
} from 'src/dtos/config.dto';
