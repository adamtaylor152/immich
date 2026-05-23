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
  ports?: string;
  env?: Array<{ key: string; value: string }> | Record<string, string>;
};

export type CreateTemplateInput = {
  name: string;
  imageName: string;
  containerDiskInGb: number;
  ports: string[];
  env: Record<string, string>;
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
    // RunPod templates accept env as an array of {key, value} pairs.
    const envArray = Object.entries(input.env).map(([key, value]) => ({ key, value }));
    return this.request<RunPodTemplateSummary>(
      apiKey,
      'POST',
      '/templates',
      {
        name: input.name,
        imageName: input.imageName,
        containerDiskInGb: input.containerDiskInGb,
        ports: input.ports.join(','),
        env: envArray,
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

  private async graphql<T>(apiKey: string, query: string, timeoutMs: number): Promise<T> {
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
        body: JSON.stringify({ query }),
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
      this.logger.warn(`RunPod ${method} ${path} failed: ${response.status} ${response.statusText} ${text}`);
      throw new RunPodApiError(
        `RunPod ${method} ${path} failed: ${response.status} ${response.statusText}`,
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
