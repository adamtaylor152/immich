import { createZodDto } from 'nestjs-zod';
import z from 'zod';

const RunPodStatusSchema = z.enum(['idle', 'provisioning', 'starting', 'running', 'stopping', 'stopped', 'error']);

const RunPodConnectionTestSchema = z
  .object({
    apiKey: z.string().min(1).describe('API key to verify (overrides the stored key for the test)').optional(),
  })
  .meta({ id: 'RunPodConnectionTestDto' });

const RunPodConnectionResultSchema = z
  .object({
    ok: z.boolean(),
    message: z.string().optional(),
  })
  .meta({ id: 'RunPodConnectionResultDto' });

const RunPodGpuTypeSchema = z
  .object({
    id: z.string(),
    displayName: z.string(),
    memoryInGb: z.number(),
    pricePerHour: z.number().nullable().optional(),
    secureCloud: z.boolean().optional(),
    communityCloud: z.boolean().optional(),
  })
  .meta({ id: 'RunPodGpuTypeDto' });

const RunPodProvisionSchema = z
  .object({
    gpuTypeId: z.string().min(1).describe('RunPod GPU type ID, e.g. "NVIDIA RTX A5000"'),
    gpuCount: z.int().min(1).max(8).optional(),
    imageName: z.string().min(1).optional().describe('Override the configured image'),
    maxRuntimeHours: z.int().min(1).max(168).optional(),
    acknowledgeDataPrivacy: z.boolean().describe('User confirms image previews will be sent to RunPod'),
  })
  .meta({ id: 'RunPodProvisionDto' });

const RunPodStateSchema = z
  .object({
    status: RunPodStatusSchema,
    podId: z.string().optional(),
    mlUrl: z.string().optional(),
    imageName: z.string().optional(),
    gpuTypeId: z.string().optional(),
    podCreatedAt: z.string().optional(),
    runningSince: z.string().optional(),
    lastBusyAt: z.string().optional(),
    stoppedAt: z.string().optional(),
    maxRuntimeHours: z.number().optional(),
    estimatedCostUsd: z.number().optional(),
    pricePerHour: z.number().optional(),
    instanceTag: z.string().optional(),
    errorMessage: z.string().optional(),
    unhealthySince: z.string().optional(),
  })
  .meta({ id: 'RunPodStateDto' });

const RunPodBackfillResultSchema = z
  .object({
    enqueued: z.array(z.string()),
    skipped: z.array(z.string()),
  })
  .meta({ id: 'RunPodBackfillResultDto' });

export class RunPodConnectionTestDto extends createZodDto(RunPodConnectionTestSchema) {}
export class RunPodConnectionResultDto extends createZodDto(RunPodConnectionResultSchema) {}
export class RunPodGpuTypeDto extends createZodDto(RunPodGpuTypeSchema) {}
export class RunPodProvisionDto extends createZodDto(RunPodProvisionSchema) {}
export class RunPodStateDto extends createZodDto(RunPodStateSchema) {}
export class RunPodBackfillResultDto extends createZodDto(RunPodBackfillResultSchema) {}
