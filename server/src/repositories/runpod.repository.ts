import { Injectable } from '@nestjs/common';
import { LoggingRepository } from 'src/repositories/logging.repository';

const RUNPOD_API_BASE = 'https://rest.runpod.io/v1';
// The REST API does not currently expose GPU types; that endpoint is only
// available through the legacy GraphQL endpoint. Documented at
// https://docs.runpod.io/references/gpu-types.
const RUNPOD_GRAPHQL_URL = 'https://api.runpod.io/graphql';

export type RunPodGpuType = {
  id: string;
  displayName: string;
  memoryInGb: number;
  secureCloud: boolean;
  communityCloud: boolean;
  pricePerHour?: number;
};

export type RunPodPodSummary = {
  id: string;
  name: string;
  desiredStatus: string;
  imageName: string;
  gpuTypeIds: string[];
  costPerHr?: number;
  runtime?: {
    uptimeInSeconds?: number;
    ports?: Array<{
      ip: string;
      isIpPublic: boolean;
      privatePort: number;
      publicPort?: number;
      type: string;
    }>;
  };
};

export type CreatePodInput = {
  name: string;
  imageName: string;
  gpuTypeIds: string[];
  gpuCount?: number;
  containerDiskInGb: number;
  volumeInGb: number;
  volumeMountPath?: string;
  ports: string[];
  env: Record<string, string>;
};

export type RunPodTemplateSummary = {
  id: string;
  name: string;
  imageName: string;
  containerDiskInGb?: number;
  ports?: string[] | string;
  env?: Record<string, string> | Array<{ key: string; value: string }>;
  isServerless?: boolean;
};

export type CreateTemplateInput = {
  name: string;
  imageName: string;
  containerDiskInGb: number;
  ports: string[];
  env: Record<string, string>;
  /** Set true to create a Serverless template (vs the default Pod template). */
  isServerless?: boolean;
};

export type RunPodEndpointSummary = {
  id: string;
  name: string;
  templateId: string;
  computeType?: 'GPU' | 'CPU';
  gpuTypeIds: string[];
  gpuCount?: number;
  workersMin: number;
  workersMax: number;
  idleTimeout?: number;
  executionTimeoutMs?: number;
  scalerType?: 'QUEUE_DELAY' | 'REQUEST_COUNT';
  scalerValue?: number;
  createdAt?: string;
  workers?: Array<{ id?: string; status?: string }>;
  env?: Record<string, string>;
};

export type RunPodScalerType = 'QUEUE_DELAY' | 'REQUEST_COUNT';

export type CreateEndpointInput = {
  name: string;
  templateId: string;
  gpuTypeIds: string[];
  gpuCount?: number;
  workersMin: number;
  workersMax: number;
  idleTimeout: number;
  executionTimeoutMs: number;
  scalerType: RunPodScalerType;
  scalerValue: number;
  /**
   * Endpoint execution model. 'LB' = load-balancer (direct HTTP routing to
   * workers, supports custom routes like `/predict`). 'QB' = queue-based
   * (only `/run` + `/status`). LB is the one that integrates cleanly with
   * Immich's existing predict() flow.
   *
   * IMPORTANT: this field is only available via RunPod's GraphQL API. The
   * REST `POST /v1/endpoints` schema rejects it; the public docs only
   * describe the field as a console UI toggle. Confirmed against the
   * runpod/flash open-source resource model.
   */
  type?: 'LB' | 'QB';
};

export class RunPodApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'RunPodApiError';
  }
}

export class RunPodNotFoundError extends RunPodApiError {
  constructor(message: string) {
    super(message, 404);
    this.name = 'RunPodNotFoundError';
  }
}

/**
 * Allow-list extraction of a user-safe error message from RunPod's response
 * body. RunPod's contract is brittle — they could change it to echo
 * request envelope fields (env vars, HF token) — so we only ever return values
 * from a small set of known-safe message keys. The full body is logged
 * server-side at warn level for debugging; only the extracted snippet is
 * surfaced to the admin UI.
 *
 * Result is also truncated and stripped of control characters as a final
 * defense before being concatenated into a thrown error message.
 */
const SAFE_MESSAGE_KEYS = ['error', 'message', 'errorCode', 'detail'] as const;
const SAFE_MESSAGE_MAX_LEN = 200;
// eslint-disable-next-line no-control-regex
const SAFE_MESSAGE_CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

const extractSafeUpstreamMessage = (body: unknown): string | undefined => {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }
  const obj = body as Record<string, unknown>;
  for (const key of SAFE_MESSAGE_KEYS) {
    const value = obj[key];
    if (typeof value === 'string' && value.length > 0) {
      return value.replaceAll(SAFE_MESSAGE_CONTROL_CHARS, ' ').slice(0, SAFE_MESSAGE_MAX_LEN);
    }
  }
  return undefined;
};

@Injectable()
export class RunPodRepository {
  constructor(private logger: LoggingRepository) {
    this.logger.setContext(RunPodRepository.name);
  }

  async testApiKey(apiKey: string): Promise<void> {
    // The cheapest authenticated read: list the pods. A 401 means the key is invalid.
    await this.request(apiKey, 'GET', '/pods', undefined, 10_000);
  }

  /** Returns all pods owned by the API key, no filtering. */
  async listPods(apiKey: string): Promise<RunPodPodSummary[]> {
    const data = await this.request<RunPodPodSummary[] | { data: RunPodPodSummary[] }>(
      apiKey,
      'GET',
      '/pods',
      undefined,
      15_000,
    );
    return Array.isArray(data) ? data : (data?.data ?? []);
  }

  async listGpuTypes(apiKey: string): Promise<RunPodGpuType[]> {
    // RunPod's REST API has no GPU-types endpoint. Fall back to the GraphQL
    // endpoint (the only place these are exposed). Schema documented at
    // https://docs.runpod.io/references/gpu-types.
    type GqlGpuType = {
      id: string;
      displayName: string;
      memoryInGb: number;
      secureCloud: boolean;
      communityCloud: boolean;
      lowestPrice?: { uninterruptablePrice?: number | null; minimumBidPrice?: number | null } | null;
    };
    const response = await this.graphql<{ gpuTypes: GqlGpuType[] }>(
      apiKey,
      `query GpuTypes {
        gpuTypes {
          id
          displayName
          memoryInGb
          secureCloud
          communityCloud
          lowestPrice(input: { gpuCount: 1 }) {
            uninterruptablePrice
            minimumBidPrice
          }
        }
      }`,
      15_000,
    );
    return (response.gpuTypes ?? []).map((t) => ({
      id: t.id,
      displayName: t.displayName,
      memoryInGb: t.memoryInGb,
      secureCloud: t.secureCloud,
      communityCloud: t.communityCloud,
      pricePerHour: t.lowestPrice?.uninterruptablePrice ?? t.lowestPrice?.minimumBidPrice ?? undefined,
    }));
  }

  async createPod(apiKey: string, input: CreatePodInput): Promise<RunPodPodSummary> {
    return this.request<RunPodPodSummary>(apiKey, 'POST', '/pods', input, 30_000);
  }

  async getPod(apiKey: string, podId: string): Promise<RunPodPodSummary> {
    return this.request<RunPodPodSummary>(apiKey, 'GET', `/pods/${encodeURIComponent(podId)}`, undefined, 15_000);
  }

  async stopPod(apiKey: string, podId: string): Promise<void> {
    await this.request(apiKey, 'POST', `/pods/${encodeURIComponent(podId)}/stop`, undefined, 30_000);
  }

  async startPod(apiKey: string, podId: string): Promise<void> {
    await this.request(apiKey, 'POST', `/pods/${encodeURIComponent(podId)}/start`, undefined, 30_000);
  }

  async terminatePod(apiKey: string, podId: string): Promise<void> {
    await this.request(apiKey, 'DELETE', `/pods/${encodeURIComponent(podId)}`, undefined, 30_000);
  }

  buildProxyUrl(podId: string, port = 3003): string {
    return `https://${podId}-${port}.proxy.runpod.net/`;
  }

  // ── Serverless: templates + endpoints ─────────────────────────────────────
  // RunPod's serverless model has two objects:
  //  - Template: bundles image + ports + env. Reusable across endpoints.
  //  - Endpoint: references a templateId, sets scaling. Workers scale 0→N
  //    on demand. Load-balancing endpoints expose
  //    `https://<endpoint-id>.api.runpod.ai/<path>` and forward HTTP paths
  //    directly to the worker; clients send `Authorization: Bearer <apiKey>`.

  async createTemplate(apiKey: string, input: CreateTemplateInput): Promise<RunPodTemplateSummary> {
    // RunPod's current REST schema (validated 2026-05-23) wants env as an
    // object (map of key → value) and ports as an array of strings. Older
    // examples in their docs show the inverse; the live API rejects both
    // variants of that older shape with HTTP 400 + a schema-mismatch error.
    return this.request<RunPodTemplateSummary>(
      apiKey,
      'POST',
      '/templates',
      {
        name: input.name,
        imageName: input.imageName,
        containerDiskInGb: input.containerDiskInGb,
        ports: input.ports,
        env: input.env,
        // Serverless endpoints reject pod-flavoured templates with HTTP 500
        // "Serverless endpoints cannot use pod templates."
        ...(input.isServerless ? { isServerless: true } : {}),
      },
      30_000,
    );
  }

  async getTemplate(apiKey: string, templateId: string): Promise<RunPodTemplateSummary> {
    return this.request<RunPodTemplateSummary>(
      apiKey,
      'GET',
      `/templates/${encodeURIComponent(templateId)}`,
      undefined,
      15_000,
    );
  }

  async listTemplates(apiKey: string): Promise<RunPodTemplateSummary[]> {
    const data = await this.request<RunPodTemplateSummary[] | { data: RunPodTemplateSummary[] }>(
      apiKey,
      'GET',
      '/templates',
      undefined,
      15_000,
    );
    return Array.isArray(data) ? data : (data?.data ?? []);
  }

  async deleteTemplate(apiKey: string, templateId: string): Promise<void> {
    await this.request(apiKey, 'DELETE', `/templates/${encodeURIComponent(templateId)}`, undefined, 30_000);
  }

  async createEndpoint(apiKey: string, input: CreateEndpointInput): Promise<RunPodEndpointSummary> {
    // For load-balancer endpoints we MUST go through GraphQL — the REST schema
    // does not expose the `type` field that flips the endpoint into LB mode
    // (confirmed by inspecting runpod/flash's resource serialiser).
    if (input.type === 'LB') {
      return this.createEndpointViaGraphQL(apiKey, input);
    }
    return this.request<RunPodEndpointSummary>(
      apiKey,
      'POST',
      '/endpoints',
      {
        name: input.name,
        templateId: input.templateId,
        computeType: 'GPU',
        gpuTypeIds: input.gpuTypeIds,
        gpuCount: input.gpuCount ?? 1,
        workersMin: input.workersMin,
        workersMax: input.workersMax,
        idleTimeout: input.idleTimeout,
        executionTimeoutMs: input.executionTimeoutMs,
        scalerType: input.scalerType,
        scalerValue: input.scalerValue,
      },
      30_000,
    );
  }

  /**
   * Create an endpoint via the GraphQL `saveEndpoint` mutation. Required for
   * load-balancer endpoints. GraphQL accepts the same scaling fields as REST
   * but additionally exposes `type: "LB"`.
   *
   * GPU IDs are passed as a comma-joined string (GraphQL convention; REST uses
   * an array). Confirmed via runpod/runpod-python `generate_endpoint_mutation`.
   */
  private async createEndpointViaGraphQL(apiKey: string, input: CreateEndpointInput): Promise<RunPodEndpointSummary> {
    const mutation = `
      mutation saveEndpoint($input: EndpointInput!) {
        saveEndpoint(input: $input) {
          id
          name
          templateId
          gpuIds
          workersMin
          workersMax
          idleTimeout
          scalerType
          scalerValue
          executionTimeoutMs
        }
      }
    `;
    const payload = {
      name: input.name,
      templateId: input.templateId,
      gpuIds: input.gpuTypeIds.join(','),
      gpuCount: input.gpuCount ?? 1,
      workersMin: input.workersMin,
      workersMax: input.workersMax,
      idleTimeout: input.idleTimeout,
      executionTimeoutMs: input.executionTimeoutMs,
      scalerType: input.scalerType,
      scalerValue: input.scalerValue,
      type: input.type ?? 'QB',
    };
    const data = await this.graphql<{ saveEndpoint: { id: string; name: string; templateId: string } }>(
      apiKey,
      mutation,
      30_000,
      { input: payload },
    );
    const endpoint = data.saveEndpoint;
    // Reshape into the summary type the rest of the service expects.
    return {
      id: endpoint.id,
      name: endpoint.name,
      templateId: endpoint.templateId,
      gpuTypeIds: input.gpuTypeIds,
      workersMin: input.workersMin,
      workersMax: input.workersMax,
      idleTimeout: input.idleTimeout,
      executionTimeoutMs: input.executionTimeoutMs,
      scalerType: input.scalerType,
      scalerValue: input.scalerValue,
    };
  }

  async getEndpoint(apiKey: string, endpointId: string): Promise<RunPodEndpointSummary> {
    return this.request<RunPodEndpointSummary>(
      apiKey,
      'GET',
      `/endpoints/${encodeURIComponent(endpointId)}`,
      undefined,
      15_000,
    );
  }

  async listEndpoints(apiKey: string): Promise<RunPodEndpointSummary[]> {
    const data = await this.request<RunPodEndpointSummary[] | { data: RunPodEndpointSummary[] }>(
      apiKey,
      'GET',
      '/endpoints',
      undefined,
      15_000,
    );
    return Array.isArray(data) ? data : (data?.data ?? []);
  }

  async deleteEndpoint(apiKey: string, endpointId: string): Promise<void> {
    await this.request(apiKey, 'DELETE', `/endpoints/${encodeURIComponent(endpointId)}`, undefined, 30_000);
  }

  /**
   * URL pattern for load-balancing serverless endpoints. Paths from the
   * container's HTTP server (e.g., FastAPI's `/predict`, `/ping`) are
   * forwarded as-is. Clients authenticate with `Authorization: Bearer <apiKey>`.
   */
  buildEndpointUrl(endpointId: string): string {
    return `https://${endpointId}.api.runpod.ai/`;
  }

  private async graphql<T>(
    apiKey: string,
    query: string,
    timeoutMs: number,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    if (!apiKey) {
      throw new RunPodApiError('RunPod API key is not configured');
    }
    let response: Response;
    try {
      response = await fetch(RUNPOD_GRAPHQL_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(variables ? { query, variables } : { query }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`RunPod GraphQL network error: ${message}`);
      throw new RunPodApiError(`RunPod GraphQL request failed: ${message}`);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      this.logger.warn(`RunPod GraphQL failed: ${response.status} ${response.statusText} ${text}`);
      throw new RunPodApiError(`RunPod GraphQL failed: ${response.status} ${response.statusText}`, response.status);
    }
    const body = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (body.errors?.length) {
      const message = body.errors.map((e) => e.message).join('; ');
      throw new RunPodApiError(`RunPod GraphQL returned errors: ${message}`);
    }
    if (!body.data) {
      throw new RunPodApiError('RunPod GraphQL returned no data');
    }
    return body.data;
  }

  private async request<T>(
    apiKey: string,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<T> {
    if (!apiKey) {
      throw new RunPodApiError('RunPod API key is not configured');
    }

    const url = `${RUNPOD_API_BASE}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`RunPod ${method} ${path} network error: ${message}`);
      throw new RunPodApiError(`RunPod request failed: ${message}`);
    }

    if (response.status === 404 || response.status === 410) {
      throw new RunPodNotFoundError(`RunPod resource not found (${response.status} ${response.statusText})`);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      let parsed: unknown = text;
      try {
        parsed = text ? JSON.parse(text) : text;
      } catch {
        // keep the raw text
      }
      // SECURITY (security.md H3): never surface raw upstream body in the
      // user-facing message — RunPod can change its contract and accidentally
      // echo env vars (HF token, ML_AUTH_TOKEN). Log full body server-side at
      // warn level for debugging; bubble only an allow-listed message field.
      this.logger.warn(`RunPod ${method} ${path} failed: ${response.status} ${response.statusText} ${text}`);
      const safeMessage = extractSafeUpstreamMessage(parsed);
      const snippet = safeMessage ? `: ${safeMessage}` : '';
      throw new RunPodApiError(
        `RunPod ${method} ${path} failed: ${response.status} ${response.statusText}${snippet}`,
        response.status,
        parsed,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    if (!text) {
      return undefined as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new RunPodApiError(`RunPod ${method} ${path} returned invalid JSON: ${(error as Error).message}`);
    }
  }
}
