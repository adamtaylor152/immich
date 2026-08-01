import { Injectable } from '@nestjs/common';
import { Duration } from 'luxon';
import { readFile } from 'node:fs/promises';
import { MachineLearningConfig } from 'src/config';
import { CLIPConfig } from 'src/dtos/model-config.dto';
import { MachineLearningHardwareAcceleration } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';

export interface BoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export enum ModelTask {
  FACIAL_RECOGNITION = 'facial-recognition',
  SEARCH = 'clip',
  OCR = 'ocr',
  IMAGE_DESCRIPTION = 'image-description-tagging',
  NSFW_DETECTION = 'nsfw-detection',
}

export enum ModelType {
  CLASSIFICATION = 'classification',
  DETECTION = 'detection',
  PIPELINE = 'pipeline',
  RECOGNITION = 'recognition',
  TEXTUAL = 'textual',
  VISUAL = 'visual',
  OCR = 'ocr',
}

export type ModelPayload = { imagePath: string } | { text: string };

type ModelOptions = { modelName: string };

export type FaceDetectionOptions = ModelOptions & { minScore: number };
export type OcrOptions = ModelOptions & {
  minDetectionScore: number;
  minRecognitionScore: number;
  maxResolution: number;
};
export type ImageDescriptionOptions = ModelOptions & {
  acceleration: MachineLearningHardwareAcceleration;
  fallbackModelName: string;
  device: string;
};
export type NsfwDetectionOptions = ModelOptions & {
  threshold: number;
  device: string;
};
type VisualResponse = { imageHeight: number; imageWidth: number };
export type ClipVisualRequest = { [ModelTask.SEARCH]: { [ModelType.VISUAL]: ModelOptions } };
export type ClipVisualResponse = { [ModelTask.SEARCH]: string } & VisualResponse;

export type ClipTextualRequest = { [ModelTask.SEARCH]: { [ModelType.TEXTUAL]: ModelOptions } };
export type ClipTextualResponse = { [ModelTask.SEARCH]: string };

export type OCR = {
  text: string[];
  box: number[];
  boxScore: number[];
  textScore: number[];
};

export type OcrRequest = {
  [ModelTask.OCR]: {
    [ModelType.DETECTION]: ModelOptions & { options: { minScore: number; maxResolution: number } };
    [ModelType.RECOGNITION]: ModelOptions & { options: { minScore: number } };
  };
};
export type OcrResponse = { [ModelTask.OCR]: OCR } & VisualResponse;

export type NsfwDetectionResult = {
  isNsfw: boolean;
  score: number;
  labels: Record<string, number>;
};

export type ImageDescriptionResult = {
  description: string;
  people: Array<{
    count: number;
    apparent_age_group: string;
    activity: string;
    confidence: string;
  }>;
  environment: string;
  objects: string[];
  visible_text: string[];
  context: string;
  tags: string[];
  safety?: {
    is_nsfw_likely: boolean;
    confidence: string;
    indicators: string[];
    reason: string;
  };
  medical?: {
    is_medical_likely: boolean;
    confidence: string;
    indicators: string[];
    reason: string;
  };
};

export type ImageDescriptionRequest = {
  [ModelTask.IMAGE_DESCRIPTION]: {
    [ModelType.VISUAL]: ModelOptions & {
      options: {
        acceleration: MachineLearningHardwareAcceleration;
        device: string;
        nsfw?: NsfwDetectionResult;
      };
    };
  };
};
export type ImageDescriptionResponse = { [ModelTask.IMAGE_DESCRIPTION]: ImageDescriptionResult } & VisualResponse;

export type NsfwDetectionRequest = {
  [ModelTask.NSFW_DETECTION]: {
    [ModelType.CLASSIFICATION]: ModelOptions & { options: { threshold: number; device: string } };
  };
};
export type NsfwDetectionResponse = { [ModelTask.NSFW_DETECTION]: NsfwDetectionResult } & VisualResponse;

export type FacialRecognitionRequest = {
  [ModelTask.FACIAL_RECOGNITION]: {
    [ModelType.DETECTION]: ModelOptions & { options: { minScore: number } };
    [ModelType.RECOGNITION]: ModelOptions;
  };
};

export interface Face {
  boundingBox: BoundingBox;
  embedding: string;
  score: number;
}

export type FacialRecognitionResponse = { [ModelTask.FACIAL_RECOGNITION]: Face[] } & VisualResponse;
export type DetectedFaces = { faces: Face[] } & VisualResponse;
export type MachineLearningRequest =
  | ClipVisualRequest
  | ClipTextualRequest
  | FacialRecognitionRequest
  | OcrRequest
  | ImageDescriptionRequest
  | NsfwDetectionRequest;
export type TextEncodingOptions = ModelOptions & { language?: string };

export type MachineLearningHardwareResponse = {
  providers: string[];
  openvinoDeviceIds: string[];
  torchCudaAvailable: boolean;
  cudaDeviceCount: number;
  preferredAcceleration: MachineLearningHardwareAcceleration;
};

const defaultMachineLearningHardware: MachineLearningHardwareResponse = {
  providers: [],
  openvinoDeviceIds: [],
  torchCudaAvailable: false,
  cudaDeviceCount: 0,
  preferredAcceleration: MachineLearningHardwareAcceleration.Auto,
};

const isFlorenceImageDescriptionModel = (modelName: string) => {
  const cleanModelName = modelName.trim().toLowerCase().split('/').at(-1) ?? '';
  return cleanModelName.startsWith('florence-2-');
};

type ManagedUrlEntry = { url: string; authToken?: string };

@Injectable()
export class MachineLearningRepository {
  private healthyMap: Record<string, boolean> = {};
  private interval?: ReturnType<typeof setInterval>;
  private _config?: MachineLearningConfig;
  // Held on the instance — NOT on _config — so ConfigUpdate's rebuild of _config doesn't wipe it.
  private managed: ManagedUrlEntry | null = null;

  private get config(): MachineLearningConfig {
    if (!this._config) {
      throw new Error('Machine learning repository not been setup');
    }

    return this._config;
  }

  constructor(private logger: LoggingRepository) {
    this.logger.setContext(MachineLearningRepository.name);
  }

  setManagedUrl(url: string, authToken?: string) {
    this.managed = { url, authToken };
    this.logger.log(`Managed ML URL set (auth=${authToken ? 'yes' : 'no'}): ${url}`);
  }

  clearManagedUrl() {
    if (this.managed) {
      delete this.healthyMap[this.managed.url];
      this.logger.log(`Managed ML URL cleared: ${this.managed.url}`);
    }
    this.managed = null;
  }

  getManagedUrl(): string | null {
    return this.managed?.url ?? null;
  }

  /** Ordered list of (url, optional auth header) to try for ML requests.
   *
   * Iteration order:
   *   1. The managed (RunPod) URL, if set. Its priority comes from the RunPod
   *      state machine — when RunPodService publishes it, RunPod is "ready",
   *      and the /ping probe must NOT veto it. A cold-starting serverless
   *      worker that takes 60 s to come up would otherwise get marked
   *      unhealthy and silently demoted below local URLs.
   *   2. Configured URLs, sorted healthy-first. Inside the configured list we
   *      DO honor /ping results: if you have two local ML boxes and one is
   *      offline, the live one moves to the front of the line so jobs aren't
   *      blocked waiting for a TCP connect to the dead box. Unknown-health
   *      URLs (never probed) are treated as healthy so first-tick behavior
   *      matches the configured order.
   */
  private getOrderedUrls(): ManagedUrlEntry[] {
    const fromConfig: ManagedUrlEntry[] = this.config.urls.map((url) => ({ url }));
    const sortedConfig = [...fromConfig].sort((a, b) => {
      const healthyA = this.healthyMap[a.url] ? 1 : 0;
      const healthyB = this.healthyMap[b.url] ? 1 : 0;
      return healthyB - healthyA;
    });
    const managed = this.managed;
    if (!managed) {
      return sortedConfig;
    }
    // Don't double up if a user typed the managed URL into the editable list.
    return [managed, ...sortedConfig.filter((entry) => entry.url !== managed.url)];
  }

  private authHeaders(entry: ManagedUrlEntry): Record<string, string> {
    return entry.authToken ? { Authorization: `Bearer ${entry.authToken}` } : {};
  }

  setup(config: MachineLearningConfig) {
    this._config = config;
    this.teardown();

    // delete entries for URLs that are neither in the config nor the managed slot.
    const known = new Set(config.urls);
    if (this.managed) {
      known.add(this.managed.url);
    }
    for (const url of Object.keys(this.healthyMap)) {
      if (!known.has(url)) {
        delete this.healthyMap[url];
      }
    }

    if (!config.enabled || !config.availabilityChecks.enabled) {
      return;
    }

    this.tick();
    this.interval = setInterval(
      () => this.tick(),
      Duration.fromObject({ milliseconds: config.availabilityChecks.interval }).as('milliseconds'),
    );
  }

  teardown() {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }

  private tick() {
    for (const entry of this.getOrderedUrls()) {
      void this.check(entry);
    }
  }

  private async check(entry: ManagedUrlEntry) {
    let healthy = false;
    try {
      // /ping is intentionally unauthenticated on the ML container so RunPod's proxy probes work;
      // we still send the auth header for managed URLs in case a sidecar enforces it.
      const response = await fetch(new URL('ping', entry.url), {
        headers: this.authHeaders(entry),
        signal: AbortSignal.timeout(this.config.availabilityChecks.timeout),
      });
      if (response.ok) {
        healthy = true;
      }
    } catch {
      // nothing to do here
    }

    this.setHealthy(entry.url, healthy);
  }

  private setHealthy(url: string, healthy: boolean) {
    if (this.healthyMap[url] !== healthy) {
      this.logger.log(`Machine learning server became ${healthy ? 'healthy' : 'unhealthy'} (${url}).`);
    }

    this.healthyMap[url] = healthy;
  }

  private isHealthy(url: string) {
    if (!this.config.availabilityChecks.enabled) {
      return true;
    }

    return this.healthyMap[url];
  }

  private async predict<T>(payload: ModelPayload, config: MachineLearningRequest): Promise<T> {
    const formData = await this.getFormData(payload, config);
    // Iteration order is set by getOrderedUrls():
    //   1. The managed (RunPod) URL goes first regardless of /ping status.
    //      RunPod's own state machine is the authoritative "is RunPod
    //      active" signal; a cold-starting serverless worker would
    //      otherwise be demoted below local URLs while it's booting up.
    //   2. Configured URLs are sorted healthy-first by the /ping probe.
    //      With a dead local URL and a healthy secondary, this avoids
    //      sitting on a TCP connect timeout to the dead box before
    //      falling through.
    const entries = this.getOrderedUrls();

    for (const entry of entries) {
      try {
        const response = await fetch(new URL('predict', entry.url), {
          method: 'POST',
          headers: this.authHeaders(entry),
          body: formData,
        });
        if (response.ok) {
          this.setHealthy(entry.url, true);
          return response.json();
        }

        this.logger.warn(
          `Machine learning request to "${entry.url}" failed with status ${response.status}: ${response.statusText}`,
        );
      } catch (error: unknown) {
        this.logger.warn(
          `Machine learning request to "${entry.url}" failed: ${error instanceof Error ? error.message : error}`,
        );
      }

      this.setHealthy(entry.url, false);
    }

    // Redact assembled prompt text to avoid leaking identity hints and admin-configured
    // vocabulary into logs, while preserving model name and acceleration for debugging.
    const sanitizedConfig = JSON.parse(JSON.stringify(config));
    for (const task of Object.values<any>(sanitizedConfig)) {
      for (const entry of Object.values<any>(task ?? {})) {
        if (entry?.options?.external_prompt !== undefined) {
          entry.options.external_prompt = '[redacted]';
        }
      }
    }
    throw new Error(`Machine learning request '${JSON.stringify(sanitizedConfig)}' failed for all URLs`);
  }

  async detectFaces(imagePath: string, { modelName, minScore }: FaceDetectionOptions) {
    const request = {
      [ModelTask.FACIAL_RECOGNITION]: {
        [ModelType.DETECTION]: { modelName, options: { minScore } },
        [ModelType.RECOGNITION]: { modelName },
      },
    };
    const response = await this.predict<FacialRecognitionResponse>({ imagePath }, request);
    return {
      imageHeight: response.imageHeight,
      imageWidth: response.imageWidth,
      faces: response[ModelTask.FACIAL_RECOGNITION],
    };
  }

  async encodeImage(imagePath: string, { modelName }: CLIPConfig) {
    const request = { [ModelTask.SEARCH]: { [ModelType.VISUAL]: { modelName } } };
    const response = await this.predict<ClipVisualResponse>({ imagePath }, request);
    return response[ModelTask.SEARCH];
  }

  async encodeText(text: string, { language, modelName }: TextEncodingOptions) {
    const request = { [ModelTask.SEARCH]: { [ModelType.TEXTUAL]: { modelName, options: { language } } } };
    const response = await this.predict<ClipTextualResponse>({ text }, request);
    return response[ModelTask.SEARCH];
  }

  async ocr(imagePath: string, { modelName, minDetectionScore, minRecognitionScore, maxResolution }: OcrOptions) {
    const request = {
      [ModelTask.OCR]: {
        [ModelType.DETECTION]: { modelName, options: { minScore: minDetectionScore, maxResolution } },
        [ModelType.RECOGNITION]: { modelName, options: { minScore: minRecognitionScore } },
      },
    };
    const response = await this.predict<OcrResponse>({ imagePath }, request);
    return response[ModelTask.OCR];
  }

  async describeImage(
    imagePath: string,
    { modelName, acceleration, fallbackModelName, device }: ImageDescriptionOptions,
    nsfw?: NsfwDetectionResult,
    prompt?: string,
  ) {
    const buildRequest = (effectiveModelName: string) => ({
      [ModelTask.IMAGE_DESCRIPTION]: {
        [ModelType.VISUAL]: {
          modelName: effectiveModelName,
          options: { acceleration, device, nsfw, external_prompt: prompt },
        },
      },
    });

    // The fallback model is intentionally NOT tried on the managed (RunPod) URL.
    // Two reasons:
    //   1. The admin picks a single primary model in the dropdown; silently
    //      switching to Florence on RunPod muddies that contract.
    //   2. Florence's HF modeling code requires transformers 4.x and isn't
    //      loadable on the cuda-runpod image's transformers 5.x pin, so the
    //      fallback would always 500 anyway — wasting a round trip + cold-start.
    // Local (configured) URLs still get the fallback retry: they may be running
    // an older ML image where Florence works fine, and Florence is the only
    // small-footprint option on CPU/laptop deploys.
    const managedUrl = this.getManagedUrl();
    const orderedUrls = this.getOrderedUrls();

    const florenceUnavailable =
      acceleration !== MachineLearningHardwareAcceleration.Cuda &&
      !!fallbackModelName &&
      isFlorenceImageDescriptionModel(fallbackModelName);

    let lastError: unknown = new Error('Machine learning has no configured URLs');
    for (const entry of orderedUrls) {
      const isManaged = entry.url === managedUrl;
      const candidateModels: string[] = [modelName];
      if (!isManaged && fallbackModelName && fallbackModelName !== modelName && !florenceUnavailable) {
        candidateModels.push(fallbackModelName);
      }

      let urlReachable = false;
      for (const candidateModel of candidateModels) {
        try {
          const formData = await this.getFormData({ imagePath }, buildRequest(candidateModel));
          const response = await fetch(new URL('predict', entry.url), {
            method: 'POST',
            headers: this.authHeaders(entry),
            body: formData,
          });
          if (response.ok) {
            this.setHealthy(entry.url, true);
            const body = (await response.json()) as ImageDescriptionResponse;
            if (candidateModel !== modelName) {
              this.logger.warn(
                `Image description model '${modelName}' failed on "${entry.url}"; succeeded with fallback model '${candidateModel}'`,
              );
            }
            return body[ModelTask.IMAGE_DESCRIPTION];
          }
          urlReachable = true;
          lastError = new Error(`HTTP ${response.status} ${response.statusText}`);
          this.logger.warn(
            `Image description request to "${entry.url}" (model='${candidateModel}') failed with status ${response.status}: ${response.statusText}`,
          );
        } catch (error) {
          lastError = error;
          this.logger.warn(
            `Image description request to "${entry.url}" (model='${candidateModel}') failed: ${error instanceof Error ? error.message : error}`,
          );
        }
      }

      // Mark unhealthy only on transport-level failure; HTTP-level errors mean
      // the server was reachable but the model load/inference failed, which the
      // /ping probe will pick up independently.
      this.setHealthy(entry.url, urlReachable);

      if (isManaged && managedUrl && fallbackModelName && fallbackModelName !== modelName && !florenceUnavailable) {
        // Audit log so admins can see the fallback was skipped because RunPod was the candidate.
        this.logger.debug(
          `Image description fallback model '${fallbackModelName}' not attempted on managed URL "${entry.url}".`,
        );
      }
    }

    const sanitizedConfig = JSON.parse(JSON.stringify(buildRequest(modelName)));
    for (const task of Object.values<any>(sanitizedConfig)) {
      for (const entry of Object.values<any>(task ?? {})) {
        if (entry?.options?.external_prompt !== undefined) {
          entry.options.external_prompt = '[redacted]';
        }
      }
    }
    throw new Error(
      `Machine learning request '${JSON.stringify(sanitizedConfig)}' failed for all URLs (last error: ${lastError instanceof Error ? lastError.message : String(lastError)})`,
    );
  }

  async detectNsfw(imagePath: string, { modelName, threshold, device }: NsfwDetectionOptions) {
    const request = {
      [ModelTask.NSFW_DETECTION]: {
        [ModelType.CLASSIFICATION]: { modelName, options: { threshold, device } },
      },
    };
    const response = await this.predict<NsfwDetectionResponse>({ imagePath }, request);
    return response[ModelTask.NSFW_DETECTION];
  }

  async getHardware(): Promise<MachineLearningHardwareResponse> {
    // Same managed-first ordering as predict(); don't let the 2s health probe
    // shadow a cold-starting RunPod worker. See predict() for the rationale.
    const entries = this.getOrderedUrls();
    for (const entry of entries) {
      try {
        const response = await fetch(new URL('/hardware', entry.url), {
          headers: this.authHeaders(entry),
          signal: AbortSignal.timeout(this.config.availabilityChecks.timeout),
        });
        if (response.ok) {
          this.setHealthy(entry.url, true);
          return response.json();
        }

        this.logger.warn(
          `Machine learning hardware request to "${entry.url}" failed with status ${response.status}: ${response.statusText}`,
        );
      } catch (error: unknown) {
        this.logger.warn(
          `Machine learning hardware request to "${entry.url}" failed: ${error instanceof Error ? error.message : error}`,
        );
      }

      this.setHealthy(entry.url, false);
    }

    return defaultMachineLearningHardware;
  }

  private async getFormData(payload: ModelPayload, config: MachineLearningRequest): Promise<FormData> {
    const formData = new FormData();
    formData.append('entries', JSON.stringify(config));

    if ('imagePath' in payload) {
      const fileBuffer = await readFile(payload.imagePath);
      formData.append('image', new Blob([new Uint8Array(fileBuffer)]));
    } else if ('text' in payload) {
      formData.append('text', payload.text);
    } else {
      throw new Error('Invalid input');
    }

    return formData;
  }
}
