import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { PNG } from 'pngjs';

export const OFFICIAL_WORKFLOW_MIGRATION = '1778614946174-UpdateWorkflowTables';
export const LEGACY_WORKFLOW_MIGRATION = '1779400000000-UpdateWorkflowTables';
export const LATER_WORKFLOW_MIGRATIONS = [
  '1779806699547-AddPluginTemplates',
  '1782414436633-AddPluginMethodAllowedHosts',
] as const;

export type CertificationState = Record<string, unknown>;

const apiUrl = process.env.FORK_ROUNDTRIP_API_URL ?? 'http://127.0.0.1:2287/api';
const stateDir = process.env.FORK_ROUNDTRIP_STATE_DIR ?? '/tmp/immich-fork-roundtrip';
const databaseUrl = process.env.FORK_ROUNDTRIP_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5437/immich';

export const phase = process.env.FORK_ROUNDTRIP_PHASE ?? '';

export const withDatabase = async <T>(callback: (client: pg.Client) => Promise<T>): Promise<T> => {
  const client = new pg.Client(databaseUrl);
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
};

const canonical = (value: unknown): unknown => {
  if (Buffer.isBuffer(value)) {
    return { bytea: value.toString('hex') };
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonical(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
};

export const digest = (value: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');

export const workflowEvidence = () =>
  withDatabase(async (client) => {
    const tables = ['plugin', 'plugin_method', 'workflow', 'workflow_step'] as const;
    const rows: Record<string, unknown[]> = {};
    for (const table of tables) {
      const result = await client.query(`SELECT * FROM public.${table} ORDER BY id::text`);
      rows[table] = result.rows;
    }
    const ledger = await client.query<{ name: string; timestamp: string }>(
      `SELECT name, timestamp FROM public.kysely_migrations
       WHERE name = ANY($1::text[]) ORDER BY timestamp, name`,
      [[OFFICIAL_WORKFLOW_MIGRATION, LEGACY_WORKFLOW_MIGRATION, ...LATER_WORKFLOW_MIGRATIONS]],
    );
    const columns = await client.query(
      `SELECT table_name, column_name, ordinal_position, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])
       ORDER BY table_name, ordinal_position`,
      [tables],
    );
    return {
      columns: columns.rows,
      ledger: ledger.rows,
      rowDigests: Object.fromEntries(tables.map((table) => [table, digest(rows[table])])),
      rowIds: Object.fromEntries(tables.map((table) => [table, rows[table]!.map((row: any) => row.id).toSorted()])),
      rows,
      schemaDigest: digest(columns.rows),
    };
  });

export const saveState = async (lane: string, state: CertificationState): Promise<void> => {
  const path = join(stateDir, `${lane}.json`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(canonical(state), null, 2)}\n`);
};

export const loadState = async <T extends CertificationState>(lane: string): Promise<T> =>
  JSON.parse(await readFile(join(stateDir, `${lane}.json`), 'utf8')) as T;

export const waitFor = async <T>(
  callback: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeout = 60_000,
): Promise<T> => {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeout) {
    try {
      const value = await callback();
      if (predicate(value)) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out after ${timeout} ms${lastError ? `: ${String(lastError)}` : ''}`);
};

export const api = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${apiUrl}${path}`, options);
  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} returned ${response.status}: ${await response.text()}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
};

export const authHeaders = (token: string): HeadersInit => ({ Authorization: `Bearer ${token}` });

export const ensureAdmin = async () => {
  const credentials = { email: 'certification-admin@example.test', password: 'Certification123!' };
  await fetch(`${apiUrl}/auth/admin-sign-up`, {
    body: JSON.stringify({ ...credentials, name: 'Certification Admin' }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  return api<{ accessToken: string; userId: string }>('/auth/login', {
    body: JSON.stringify(credentials),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
};

const pngFor = (filename: string): Buffer => {
  const legacyIndex = /^legacy-origin-(\d+)\.png$/.exec(filename)?.[1];
  const image = new PNG({ height: 1, width: legacyIndex === undefined ? 2 : Number(legacyIndex) + 1 });
  const seed = createHash('sha256').update(filename).digest();
  for (let offset = 0; offset < image.data.length; offset++) {
    image.data[offset] = seed[offset % seed.length]!;
  }
  return PNG.sync.write(image);
};

export const uploadAsset = async (token: string, filename: string) => {
  const body = new FormData();
  const now = new Date().toISOString();
  const png = pngFor(filename);
  const bytes = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;
  body.set('assetData', new Blob([bytes], { type: 'image/png' }), filename);
  body.set('fileCreatedAt', now);
  body.set('fileModifiedAt', now);
  const response = await fetch(`${apiUrl}/assets`, { body, headers: authHeaders(token), method: 'POST' });
  if (!response.ok) {
    throw new Error(`POST /assets returned ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as { id: string; status: string };
};

export const downloadAsset = async (token: string, id: string): Promise<Buffer> => {
  const response = await fetch(`${apiUrl}/assets/${id}/original`, { headers: authHeaders(token) });
  if (!response.ok) {
    throw new Error(`GET asset original returned ${response.status}: ${await response.text()}`);
  }
  return Buffer.from(await response.arrayBuffer());
};
