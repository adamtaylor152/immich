import { createZodDto } from 'nestjs-zod';
import z from 'zod';

const RunPodStatusSchema = z.enum([
  'idle',
  'provisioning',
  'starting',
  'running',
  'stopping',
  'stopped',
  'error',
  'serverless-provisioning',
  'serverless-ready',
]);

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
    acknowledgeDataPrivacy: z
      .literal(true)
      .describe('User confirms image previews will be sent to RunPod (must be true to launch)'),
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
    // Pod-mode numerics intentionally stay `.optional()` (not `.nullish()`)
    // even though that means the Dart generator still emits a brittle
    // `num.parse('${json[...]}')` for them. Loosening the contract to
    // include `null` here would be a breaking change for existing clients
    // (oasdiff catches it). The Dart parse path has been latently buggy
    // since PR #37; the right fix is a Dart-side post-generate patch in a
    // follow-up — not a wire-format break.
    maxRuntimeHours: z.number().optional(),
    estimatedCostUsd: z.number().optional(),
    pricePerHour: z.number().optional(),
    instanceTag: z.string().optional(),
    errorMessage: z.string().optional(),
    unhealthySince: z.string().optional(),
    // Serverless-only fields. These are NEW with this PR, so marking them
    // `.nullish()` doesn't break any existing client — and it lets the
    // openapi-generator's null-safe Dart parse path kick in (the previous
    // CodeRabbit pass flagged `num.parse('null')` would crash these
    // specifically when the DTO is fetched in non-serverless state).
    endpointId: z.string().optional(),
    endpointUrl: z.string().optional(),
    templateId: z.string().optional(),
    // .nullish() (rather than .optional()) so the generated Dart parse path
    // accepts a literal JSON `null` from the server when the endpoint hasn't
    // been created yet (e.g. response shape during `serverless-provisioning`).
    workersMin: z.number().nullish().describe('Serverless workersMin; may be null when not yet provisioned.'),
    workersMax: z.number().nullish().describe('Serverless workersMax; may be null when not yet provisioned.'),
    idleTimeoutSeconds: z.number().nullish().describe('Serverless idle timeout; may be null when not yet provisioned.'),
    // True when the RunPod endpoint exists AND the worker behind it is
    // currently responding to /ping. Distinct from `status === 'serverless-ready'`,
    // which only means the endpoint+template are provisioned on RunPod's
    // side — the worker may still be cold-starting. The UI uses this to
    // distinguish "endpoint provisioned" from "worker actually live".
    workerReady: z.boolean().optional(),
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
