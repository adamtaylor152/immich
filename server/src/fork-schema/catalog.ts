import { Kysely, sql } from 'kysely';
import { DB } from 'src/schema';

export type CatalogEntry = {
  definition: string;
  identity: string;
};

export type CatalogManifest = {
  columns: CatalogEntry[];
  constraints: CatalogEntry[];
  enums: CatalogEntry[];
  forkMigrations: string[];
  functions: CatalogEntry[];
  indexes: CatalogEntry[];
  migrationOverrides: string[];
  schemas: CatalogEntry[];
  source: string;
  tables: CatalogEntry[];
  triggers: CatalogEntry[];
};

type CatalogObjectKind = Exclude<keyof CatalogManifest, 'forkMigrations' | 'migrationOverrides' | 'source'>;

export type CatalogDifference = {
  actual?: string;
  expected?: string;
  identity: string;
  kind: CatalogObjectKind | 'forkMigrations' | 'migrationOverrides';
};

export type CatalogDiff = {
  clean: boolean;
  mismatched: CatalogDifference[];
  missing: CatalogDifference[];
  unexpected: CatalogDifference[];
};

const ENTRY_KINDS: CatalogObjectKind[] = [
  'schemas',
  'tables',
  'columns',
  'enums',
  'constraints',
  'indexes',
  'functions',
  'triggers',
];

const normalizeEntries = (entries: CatalogEntry[]) =>
  entries
    .map(({ definition, identity }) => ({ definition: definition.trim(), identity }))
    .toSorted(
      (left, right) => left.identity.localeCompare(right.identity) || left.definition.localeCompare(right.definition),
    );

export const normalizeCatalogManifest = (manifest: CatalogManifest): CatalogManifest => ({
  ...manifest,
  columns: normalizeEntries(manifest.columns),
  constraints: normalizeEntries(manifest.constraints),
  enums: normalizeEntries(manifest.enums),
  forkMigrations: manifest.forkMigrations.toSorted(),
  functions: normalizeEntries(manifest.functions),
  indexes: normalizeEntries(manifest.indexes),
  migrationOverrides: manifest.migrationOverrides.toSorted(),
  schemas: normalizeEntries(manifest.schemas),
  tables: normalizeEntries(manifest.tables),
  triggers: normalizeEntries(manifest.triggers),
});

export const serializeCatalogManifest = (manifest: CatalogManifest): string =>
  `${JSON.stringify(normalizeCatalogManifest(manifest), null, 2)}\n`;

const compareEntries = (
  kind: CatalogObjectKind,
  expectedEntries: CatalogEntry[],
  actualEntries: CatalogEntry[],
  inertAllowlist: ReadonlySet<string>,
  result: Omit<CatalogDiff, 'clean'>,
) => {
  const expected = new Map(expectedEntries.map((entry) => [entry.identity, entry.definition]));
  const actual = new Map(actualEntries.map((entry) => [entry.identity, entry.definition]));
  for (const [identity, definition] of expected) {
    const actualDefinition = actual.get(identity);
    if (actualDefinition === undefined) {
      result.missing.push({ expected: definition, identity, kind });
    } else if (actualDefinition !== definition) {
      result.mismatched.push({ actual: actualDefinition, expected: definition, identity, kind });
    }
  }
  for (const [identity, definition] of actual) {
    if (!expected.has(identity) && !inertAllowlist.has(`${kind}:${identity}`)) {
      result.unexpected.push({ actual: definition, identity, kind });
    }
  }
};

const compareStrings = (
  kind: 'forkMigrations' | 'migrationOverrides',
  expectedItems: string[],
  actualItems: string[],
  inertAllowlist: ReadonlySet<string>,
  result: Omit<CatalogDiff, 'clean'>,
) => {
  const expected = new Set(expectedItems);
  const actual = new Set(actualItems);
  for (const identity of expected) {
    if (!actual.has(identity)) {
      result.missing.push({ identity, kind });
    }
  }
  for (const identity of actual) {
    if (!expected.has(identity) && !inertAllowlist.has(`${kind}:${identity}`)) {
      result.unexpected.push({ identity, kind });
    }
  }
};

export const compareCatalogs = (
  expectedManifest: CatalogManifest,
  actualManifest: CatalogManifest,
  inertAllowlist: ReadonlySet<string> = new Set(),
): CatalogDiff => {
  const expected = normalizeCatalogManifest(expectedManifest);
  const actual = normalizeCatalogManifest(actualManifest);
  const result: Omit<CatalogDiff, 'clean'> = { mismatched: [], missing: [], unexpected: [] };
  for (const kind of ENTRY_KINDS) {
    compareEntries(kind, expected[kind], actual[kind], inertAllowlist, result);
  }
  compareStrings('migrationOverrides', expected.migrationOverrides, actual.migrationOverrides, inertAllowlist, result);
  compareStrings('forkMigrations', expected.forkMigrations, actual.forkMigrations, inertAllowlist, result);
  return {
    ...result,
    clean: result.mismatched.length === 0 && result.missing.length === 0 && result.unexpected.length === 0,
  };
};

export const getForkTableLocks = (manifest: CatalogManifest): string[] =>
  manifest.tables
    .map(({ identity }) => identity)
    .filter((identity) => identity.startsWith('immich_fork.'))
    .toSorted();

export async function getCatalogEvidence(
  runner: Kysely<DB>,
  options: { includeForkLedger?: boolean } = {},
): Promise<CatalogManifest> {
  const [schemas, tables, columns, enums, constraints, indexes, functions, triggers, overrides] = await Promise.all([
    sql<CatalogEntry>`
        SELECT namespace.nspname AS identity, namespace.nspname AS definition
        FROM pg_namespace namespace
        WHERE namespace.nspname <> 'information_schema'
          AND namespace.nspname NOT LIKE 'pg_%'
        ORDER BY namespace.nspname
      `.execute(runner),
    sql<CatalogEntry>`
        SELECT namespace.nspname || '.' || relation.relname AS identity,
               CASE relation.relkind
                 WHEN 'r' THEN 'table'
                 WHEN 'p' THEN 'partitioned table'
                 WHEN 'v' THEN 'view'
                 WHEN 'm' THEN 'materialized view'
                 WHEN 'f' THEN 'foreign table'
               END AS definition
        FROM pg_class relation
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname IN ('public', 'immich_fork')
          AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
        ORDER BY identity
      `.execute(runner),
    sql<CatalogEntry>`
        SELECT namespace.nspname || '.' || relation.relname || '.' || attribute.attname AS identity,
               concat_ws('|',
                 format_type(attribute.atttypid, attribute.atttypmod),
                 CASE WHEN attribute.attnotnull THEN 'not null' ELSE 'nullable' END,
                 coalesce(pg_get_expr(default_value.adbin, default_value.adrelid), ''),
                 attribute.attidentity,
                 attribute.attgenerated
               ) AS definition
        FROM pg_attribute attribute
        JOIN pg_class relation ON relation.oid = attribute.attrelid
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        LEFT JOIN pg_attrdef default_value
          ON default_value.adrelid = attribute.attrelid AND default_value.adnum = attribute.attnum
        WHERE namespace.nspname IN ('public', 'immich_fork')
          AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
        ORDER BY identity
      `.execute(runner),
    sql<CatalogEntry>`
        SELECT namespace.nspname || '.' || type.typname || '.' || value.enumlabel AS identity,
               value.enumsortorder::text AS definition
        FROM pg_type type
        JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
        JOIN pg_enum value ON value.enumtypid = type.oid
        WHERE namespace.nspname IN ('public', 'immich_fork')
        ORDER BY namespace.nspname, type.typname, value.enumsortorder
      `.execute(runner),
    sql<CatalogEntry>`
        SELECT namespace.nspname || '.' || relation.relname || '.' || constraint_record.conname AS identity,
               pg_get_constraintdef(constraint_record.oid, true) AS definition
        FROM pg_constraint constraint_record
        JOIN pg_class relation ON relation.oid = constraint_record.conrelid
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname IN ('public', 'immich_fork')
        ORDER BY identity
      `.execute(runner),
    sql<CatalogEntry>`
        SELECT namespace.nspname || '.' || relation.relname || '.' || index_relation.relname AS identity,
               pg_get_indexdef(index_relation.oid) AS definition
        FROM pg_index index_record
        JOIN pg_class relation ON relation.oid = index_record.indrelid
        JOIN pg_class index_relation ON index_relation.oid = index_record.indexrelid
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname IN ('public', 'immich_fork')
        ORDER BY identity
      `.execute(runner),
    sql<CatalogEntry>`
        SELECT namespace.nspname || '.' || procedure.proname || '(' || pg_get_function_identity_arguments(procedure.oid) || ')' AS identity,
               pg_get_functiondef(procedure.oid) AS definition
        FROM pg_proc procedure
        JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname IN ('public', 'immich_fork')
          AND procedure.prokind IN ('f', 'p')
        ORDER BY identity
      `.execute(runner),
    sql<CatalogEntry>`
        SELECT namespace.nspname || '.' || relation.relname || '.' || trigger.tgname AS identity,
               pg_get_triggerdef(trigger.oid, true) AS definition
        FROM pg_trigger trigger
        JOIN pg_class relation ON relation.oid = trigger.tgrelid
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname IN ('public', 'immich_fork')
          AND NOT trigger.tgisinternal
        ORDER BY identity
      `.execute(runner),
    sql<{ name: string }>`
        SELECT name FROM public.migration_overrides ORDER BY name
      `.execute(runner),
  ]);
  const forkMigrations =
    options.includeForkLedger === false
      ? { rows: [] }
      : await sql<{ name: string }>`SELECT name FROM immich_fork.migrations ORDER BY name`.execute(runner);

  return normalizeCatalogManifest({
    columns: columns.rows,
    constraints: constraints.rows,
    enums: enums.rows,
    forkMigrations: forkMigrations.rows.map(({ name }) => name),
    functions: functions.rows,
    indexes: indexes.rows,
    migrationOverrides: overrides.rows.map(({ name }) => name),
    schemas: schemas.rows,
    source: 'database',
    tables: tables.rows,
    triggers: triggers.rows,
  });
}
