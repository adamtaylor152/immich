import { DatabaseConnectionParams } from '@immich/sql-tools';
import { Kysely, sql } from 'kysely';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { promisify } from 'node:util';
import { getCatalogEvidence, serializeCatalogManifest } from 'src/fork-schema/catalog';
import { createForkMigrationProvider } from 'src/fork-schema/migration-provider';
import { DB } from 'src/schema';
import { getKyselyConfig } from 'src/utils/database';

const execFileAsync = promisify(execFile);

type Arguments = {
  forkUrl: string;
  officialTag: string;
  officialUrl: string;
  out: string;
};

const parseArguments = (): Arguments => {
  const values = new Map<string, string>();
  for (let index = 2; index < process.argv.length; index += 2) {
    const name = process.argv[index];
    const value = process.argv[index + 1];
    if (!name?.startsWith('--') || !value) {
      throw new Error(`Invalid catalog generator argument: ${name ?? '<missing>'}`);
    }
    values.set(name.slice(2), value);
  }
  const officialTag = values.get('official-tag');
  const officialUrl = values.get('official-url') ?? process.env.OFFICIAL_CATALOG_DATABASE_URL;
  const forkUrl = values.get('fork-url') ?? process.env.FORK_CATALOG_DATABASE_URL;
  const out = values.get('out');
  if (!officialTag || !officialUrl || !forkUrl || !out) {
    throw new Error(
      'Usage: --official-tag v3.0.3 --official-url <disposable-url> --fork-url <disposable-url> --out <directory>',
    );
  }
  if (officialTag !== 'v3.0.3') {
    throw new Error(`Unsupported official catalog tag: ${officialTag}`);
  }
  return { forkUrl, officialTag, officialUrl, out };
};

const connect = (url: string) => {
  const connection = { connectionType: 'url', url } as DatabaseConnectionParams;
  return new Kysely<DB>(getKyselyConfig(connection));
};

const exactTagMigrationNames = async (tag: string) => {
  const { stdout } = await execFileAsync('git', [
    'ls-tree',
    '-r',
    '--name-only',
    tag,
    ':(top)server/src/schema/migrations',
  ]);
  return stdout
    .split('\n')
    .filter((path) => path.endsWith('.ts'))
    .map((path) => basename(path, '.ts'))
    .toSorted();
};

const ledgerNames = async (db: Kysely<DB>, schema: 'immich_fork' | 'public') => {
  const table = schema === 'public' ? 'public.kysely_migrations' : 'immich_fork.migrations';
  return (await sql.raw<{ name: string }>(`SELECT name FROM ${table} ORDER BY name`).execute(db)).rows
    .map(({ name }) => name)
    .toSorted();
};

const requireExact = (label: string, expected: string[], actual: string[]) => {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    const expectedSet = new Set(expected);
    const actualSet = new Set(actual);
    const missing = expected.filter((name) => !actualSet.has(name));
    const unexpected = actual.filter((name) => !expectedSet.has(name));
    throw new Error(
      `${label} is not the exact provider set (missing=${JSON.stringify(missing)}, unexpected=${JSON.stringify(unexpected)})`,
    );
  }
};

const main = async () => {
  const { forkUrl, officialTag, officialUrl, out } = parseArguments();
  const official = connect(officialUrl);
  const fork = connect(forkUrl);
  try {
    requireExact(
      'Official migration ledger',
      await exactTagMigrationNames(officialTag),
      await ledgerNames(official, 'public'),
    );
    // eslint-disable-next-line unicorn/prefer-module
    const forkProvider = createForkMigrationProvider(resolve(__dirname, '../src/fork-schema/migrations'));
    requireExact(
      'Fork migration ledger',
      Object.keys(await forkProvider.getMigrations()).toSorted(),
      await ledgerNames(fork, 'immich_fork'),
    );

    const officialManifest = {
      ...(await getCatalogEvidence(official, { includeForkLedger: false })),
      source: officialTag,
    };
    const forkManifest = { ...(await getCatalogEvidence(fork)), source: 'fork-v2' };
    await mkdir(out, { recursive: true });
    await Promise.all([
      writeFile(resolve(out, `${officialTag}-public-catalog.json`), serializeCatalogManifest(officialManifest)),
      writeFile(resolve(out, 'fork-v2-catalog.json'), serializeCatalogManifest(forkManifest)),
    ]);
  } finally {
    await Promise.all([official.destroy(), fork.destroy()]);
  }
};

void main();
