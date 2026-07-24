import type {
  AlbumResponseDto,
  ApiKeyResponseDto,
  AssetBulkUploadCheckResponseDto,
  AssetMediaResponseDto,
  AssetMetadataResponseDto,
  AssetMetadataUpsertItemDto,
  AssetResponseDto,
  BulkIdResponseDto,
  CreateAlbumDto,
  MetadataSearchDto,
  PeopleResponseDto,
  PersonCreateDto,
  PersonResponseDto,
  SearchResponseDto,
  StackResponseDto,
  TagBulkAssetsResponseDto,
  TagResponseDto,
  UpdateAlbumDto,
  UpdateAssetDto,
  UserAdminResponseDto,
} from '@immich/sdk';
import { createReadStream } from 'node:fs';

export class MigrateHttpError extends Error {
  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly body: string,
    readonly method: string,
    readonly path: string,
  ) {
    super(`${method} ${path} -> ${status} ${statusText}: ${body.slice(0, 500)}`);
    this.name = 'MigrateHttpError';
  }
}

// A File subclass that streams its bytes from disk on demand, so uploads never buffer
// a whole asset in memory. Same pattern the `upload` command uses.
class StreamFile extends File {
  constructor(
    private readonly filepath: string,
    private readonly _size: number,
    name: string,
  ) {
    super([], name);
  }
  get size() {
    return this._size;
  }
  stream() {
    return createReadStream(this.filepath) as unknown as ReadableStream;
  }
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const buildQuery = (params: Record<string, string | number | boolean | undefined>): string => {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      usp.set(key, String(value));
    }
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : '';
};

/**
 * A minimal, self-contained API client for one Immich server. Unlike `@immich/sdk`
 * (which keeps a single global `defaults`), each instance is fully independent, so
 * SERVER A and SERVER B can be driven concurrently. Uses the SDK only for types.
 */
export class ServerClient {
  private constructor(
    readonly baseUrl: string,
    private readonly apiKey: string,
    readonly retries = 4,
  ) {}

  /** Resolve the real API endpoint via `.well-known/immich`, then verify the key. */
  static async connect(url: string, key: string): Promise<{ client: ServerClient; user: UserAdminResponseDto }> {
    let baseUrl = url.replace(/\/+$/, '');
    try {
      const wellKnown = await fetch(new URL('.well-known/immich', url)).then((r) => r.json());
      baseUrl = new URL(wellKnown.api.endpoint, url).toString().replace(/\/+$/, '');
    } catch {
      // no well-known endpoint; use the URL as given
    }
    const client = new ServerClient(baseUrl, key);
    const user = await client.getMyUser();
    return { client, user };
  }

  private async request(method: string, path: string, init: RequestInit = {}): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          ...init,
          method,
          redirect: 'error',
          headers: { 'x-api-key': this.apiKey, Accept: 'application/json', ...init.headers },
        });
        if (response.ok) {
          return response;
        }
        if (RETRYABLE.has(response.status) && attempt < this.retries) {
          await sleep(Math.min(30_000, 500 * 2 ** attempt));
          continue;
        }
        throw new MigrateHttpError(response.status, response.statusText, await response.text(), method, path);
      } catch (error) {
        lastError = error;
        // Network-level failure: back off and retry. HTTP errors we already decided to throw above.
        if (error instanceof MigrateHttpError || attempt >= this.retries) {
          throw error;
        }
        await sleep(Math.min(30_000, 500 * 2 ** attempt));
      }
    }
    throw lastError;
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit =
      body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
    const response = await this.request(method, path, init);
    return (await response.json()) as T;
  }

  // --- identity / preflight ---
  getMyUser = () => this.json<UserAdminResponseDto>('GET', '/users/me');
  getMyApiKey = () => this.json<ApiKeyResponseDto>('GET', '/api-keys/me');

  // --- enumeration ---
  searchAssets = (dto: MetadataSearchDto) => this.json<SearchResponseDto>('POST', '/search/metadata', dto);
  getAllAlbums = () => this.json<AlbumResponseDto[]>('GET', '/albums');
  getAlbumInfo = (id: string) => this.json<AlbumResponseDto>('GET', `/albums/${id}`);
  getAllTags = () => this.json<TagResponseDto[]>('GET', '/tags');
  searchStacks = () => this.json<StackResponseDto[]>('GET', '/stacks');
  getAllPeople = () => this.json<PeopleResponseDto>('GET', `/people${buildQuery({ withHidden: true, size: 1000 })}`);

  // --- dedup / download ---
  checkBulkUpload = (assets: Array<{ id: string; checksum: string }>) =>
    this.json<AssetBulkUploadCheckResponseDto>('POST', '/assets/bulk-upload-check', { assets });

  /** Streamed original bytes. Caller pipes `response.body` to disk. */
  downloadOriginal = (id: string) => this.request('GET', `/assets/${id}/original`);

  // --- writes on destination ---
  async uploadAsset(params: {
    filepath: string;
    size: number;
    filename: string;
    checksum: string; // base64 SHA-256 -> x-immich-checksum
    fileCreatedAt: string;
    fileModifiedAt: string;
    isFavorite: boolean;
    visibility: string;
    duration?: number | null;
  }): Promise<AssetMediaResponseDto> {
    const form = new FormData();
    form.append('assetData', new StreamFile(params.filepath, params.size, params.filename));
    form.append('filename', params.filename);
    form.append('fileCreatedAt', params.fileCreatedAt);
    form.append('fileModifiedAt', params.fileModifiedAt);
    form.append('isFavorite', String(params.isFavorite));
    form.append('visibility', params.visibility);
    if (params.duration != undefined) {
      form.append('duration', String(params.duration));
    }
    const response = await this.request('POST', '/assets', {
      body: form,
      headers: { 'x-immich-checksum': params.checksum },
    });
    return (await response.json()) as AssetMediaResponseDto;
  }

  updateAsset = (id: string, dto: UpdateAssetDto) => this.json<AssetResponseDto>('PUT', `/assets/${id}`, dto);
  getAssetMetadata = (id: string) => this.json<AssetMetadataResponseDto[]>('GET', `/assets/${id}/metadata`);
  upsertAssetMetadata = (id: string, items: AssetMetadataUpsertItemDto[]) =>
    this.json<AssetMetadataResponseDto[]>('PUT', `/assets/${id}/metadata`, { items });

  createAlbum = (dto: CreateAlbumDto) => this.json<AlbumResponseDto>('POST', '/albums', dto);
  updateAlbum = (id: string, dto: UpdateAlbumDto) => this.json<AlbumResponseDto>('PATCH', `/albums/${id}`, dto);
  addAssetsToAlbum = (id: string, ids: string[]) =>
    this.json<BulkIdResponseDto[]>('PUT', `/albums/${id}/assets`, { ids });

  upsertTags = (tags: string[]) => this.json<TagResponseDto[]>('PUT', '/tags', { tags });
  bulkTagAssets = (tagIds: string[], assetIds: string[]) =>
    this.json<TagBulkAssetsResponseDto>('PUT', '/tags/assets', { tagIds, assetIds });

  createStack = (assetIds: string[]) => this.json<StackResponseDto>('POST', '/stacks', { assetIds });

  searchPerson = (name: string) =>
    this.json<PersonResponseDto[]>('GET', `/search/person${buildQuery({ name, withHidden: true })}`);
  createPerson = (dto: PersonCreateDto) => this.json<PersonResponseDto>('POST', '/people', dto);
  reassignFaces = (personId: string, data: Array<{ assetId: string; personId: string }>) =>
    this.json<PersonResponseDto>('PUT', `/people/${personId}/reassign`, { data });
}
