import { Injectable } from '@nestjs/common';
import { LoggingRepository } from 'src/repositories/logging.repository';

const RUNPOD_API_BASE = 'https://rest.runpod.io/v1';

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

  async listGpuTypes(apiKey: string): Promise<RunPodGpuType[]> {
    const data = await this.request<RunPodGpuType[] | { data: RunPodGpuType[] }>(
      apiKey,
      'GET',
      '/gputypes',
      undefined,
      15_000,
    );
    return Array.isArray(data) ? data : (data?.data ?? []);
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
