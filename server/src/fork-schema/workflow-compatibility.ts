import { Kysely, sql } from 'kysely';
import { createHash } from 'node:crypto';
import supportedVersions from 'src/fork-schema/supported-versions.json';
import { DB } from 'src/schema';

export const LEGACY_WORKFLOW_MIGRATION = '1779400000000-UpdateWorkflowTables';
export const OFFICIAL_WORKFLOW_MIGRATION = '1778614946174-UpdateWorkflowTables';
export const ADD_PLUGIN_TEMPLATES_MIGRATION = '1779806699547-AddPluginTemplates';
export const ADD_PLUGIN_METHOD_ALLOWED_HOSTS_MIGRATION = '1782414436633-AddPluginMethodAllowedHosts';
export const WORKFLOW_COMPATIBILITY_MIGRATIONS: ReadonlySet<string> = new Set([
  OFFICIAL_WORKFLOW_MIGRATION,
  ADD_PLUGIN_TEMPLATES_MIGRATION,
  ADD_PLUGIN_METHOD_ALLOWED_HOSTS_MIGRATION,
]);

export const normalizeWorkflowMigrationForOfficialOrder = (name: string): string =>
  name === LEGACY_WORKFLOW_MIGRATION ? OFFICIAL_WORKFLOW_MIGRATION : name;

export const WORKFLOW_TABLES = ['plugin', 'plugin_method', 'workflow', 'workflow_step'] as const;

export function validateOfficialMigrationLedgerOrder(
  ledgerNames: string[],
  bundledNames: string[],
): { pending: string[]; valid: boolean } {
  const expectedNames = supportedVersions.upstreamMigrations;
  const ledgerSet = new Set(ledgerNames);
  const bundledSet = new Set(bundledNames);
  const expectedSet = new Set(expectedNames);
  const isCertifiedProviderGap = (name: string) => expectedSet.has(name) && !bundledSet.has(name);
  const ledgerIsExactPrefix =
    ledgerSet.size === ledgerNames.length && ledgerNames.every((name, index) => expectedNames[index] === name);
  const unbundledLedgerNamesAreAuditedGaps = ledgerNames.every(
    (name) => bundledSet.has(name) || isCertifiedProviderGap(name),
  );

  let expectedIndex = 0;
  let bundledOrderValid = bundledSet.size === bundledNames.length;
  for (const bundledName of bundledNames) {
    while (
      expectedIndex < expectedNames.length &&
      expectedNames[expectedIndex] !== bundledName &&
      isCertifiedProviderGap(expectedNames[expectedIndex]!)
    ) {
      expectedIndex++;
    }
    if (expectedNames[expectedIndex] !== bundledName) {
      bundledOrderValid = false;
      break;
    }
    expectedIndex++;
  }

  const valid = ledgerIsExactPrefix && unbundledLedgerNamesAreAuditedGaps && bundledOrderValid;
  return { pending: valid ? bundledNames.filter((name) => !ledgerSet.has(name)) : [], valid };
}

export type WorkflowSchemaStage = 'post-allowed-hosts' | 'post-plugin-templates' | 'post-update';

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

type ColumnDefinition = readonly [name: string, type: string, isNotNull: boolean, defaultExpression: string | null];
const columnsFor = (tableName: string, definitions: readonly ColumnDefinition[]) =>
  definitions.map(([columnName, type, isNotNull, defaultExpression], index) => ({
    tableName,
    ordinal: index + 1,
    columnName,
    type,
    isNotNull,
    defaultExpression,
  }));

const POST_UPDATE_COLUMNS = [
  ...columnsFor('plugin', [
    ['id', 'uuid', true, 'uuid_generate_v4()'],
    ['enabled', 'boolean', true, 'true'],
    ['name', 'character varying', true, null],
    ['version', 'character varying', true, null],
    ['title', 'character varying', true, null],
    ['description', 'character varying', true, null],
    ['author', 'character varying', true, null],
    ['wasmBytes', 'bytea', true, null],
    ['createdAt', 'timestamp with time zone', true, 'now()'],
    ['updatedAt', 'timestamp with time zone', true, 'now()'],
  ]),
  ...columnsFor('plugin_method', [
    ['id', 'uuid', true, 'uuid_generate_v4()'],
    ['pluginId', 'uuid', true, null],
    ['name', 'character varying', true, null],
    ['title', 'character varying', true, null],
    ['description', 'character varying', true, null],
    ['types', 'character varying[]', true, null],
    ['hostFunctions', 'boolean', true, 'false'],
    ['uiHints', 'character varying[]', true, "'{}'::character varying[]"],
    ['schema', 'jsonb', false, null],
  ]),
  ...columnsFor('workflow', [
    ['id', 'uuid', true, 'uuid_generate_v4()'],
    ['ownerId', 'uuid', true, null],
    ['trigger', 'character varying', true, null],
    ['name', 'character varying', false, null],
    ['description', 'character varying', false, null],
    ['createdAt', 'timestamp with time zone', true, 'now()'],
    ['updatedAt', 'timestamp with time zone', true, 'now()'],
    ['updateId', 'uuid', true, 'immich_uuid_v7()'],
    ['enabled', 'boolean', true, 'true'],
  ]),
  ...columnsFor('workflow_step', [
    ['id', 'uuid', true, 'uuid_generate_v4()'],
    ['enabled', 'boolean', true, 'true'],
    ['workflowId', 'uuid', true, null],
    ['pluginMethodId', 'uuid', true, null],
    ['config', 'jsonb', false, null],
    ['order', 'integer', true, null],
  ]),
];

const POST_UPDATE_WORKFLOW_SCHEMA_MANIFEST = {
  columns: POST_UPDATE_COLUMNS,
  constraints: [
    { tableName: 'plugin', name: 'plugin_name_uq', type: 'u', definition: 'UNIQUE (name)' },
    { tableName: 'plugin', name: 'plugin_name_version_uq', type: 'u', definition: 'UNIQUE (name, version)' },
    { tableName: 'plugin', name: 'plugin_pkey', type: 'p', definition: 'PRIMARY KEY (id)' },
    { tableName: 'plugin_method', name: 'plugin_method_pkey', type: 'p', definition: 'PRIMARY KEY (id)' },
    {
      tableName: 'plugin_method',
      name: 'plugin_method_pluginId_fkey',
      type: 'f',
      definition: 'FOREIGN KEY ("pluginId") REFERENCES plugin(id) ON UPDATE CASCADE ON DELETE CASCADE',
    },
    {
      tableName: 'plugin_method',
      name: 'plugin_method_pluginId_name_uq',
      type: 'u',
      definition: 'UNIQUE ("pluginId", name)',
    },
    {
      tableName: 'workflow',
      name: 'workflow_ownerId_fkey',
      type: 'f',
      definition: 'FOREIGN KEY ("ownerId") REFERENCES "user"(id) ON UPDATE CASCADE ON DELETE CASCADE',
    },
    { tableName: 'workflow', name: 'workflow_pkey', type: 'p', definition: 'PRIMARY KEY (id)' },
    { tableName: 'workflow_step', name: 'workflow_step_pkey', type: 'p', definition: 'PRIMARY KEY (id)' },
    {
      tableName: 'workflow_step',
      name: 'workflow_step_pluginMethodId_fkey',
      type: 'f',
      definition: 'FOREIGN KEY ("pluginMethodId") REFERENCES plugin_method(id) ON UPDATE CASCADE ON DELETE CASCADE',
    },
    {
      tableName: 'workflow_step',
      name: 'workflow_step_workflowId_fkey',
      type: 'f',
      definition: 'FOREIGN KEY ("workflowId") REFERENCES workflow(id) ON UPDATE CASCADE ON DELETE CASCADE',
    },
  ],
  indexes: [
    {
      tableName: 'plugin',
      name: 'plugin_name_idx',
      definition: 'CREATE INDEX plugin_name_idx ON public.plugin USING btree (name)',
    },
    {
      tableName: 'plugin',
      name: 'plugin_name_uq',
      definition: 'CREATE UNIQUE INDEX plugin_name_uq ON public.plugin USING btree (name)',
    },
    {
      tableName: 'plugin',
      name: 'plugin_name_version_uq',
      definition: 'CREATE UNIQUE INDEX plugin_name_version_uq ON public.plugin USING btree (name, version)',
    },
    {
      tableName: 'plugin',
      name: 'plugin_pkey',
      definition: 'CREATE UNIQUE INDEX plugin_pkey ON public.plugin USING btree (id)',
    },
    {
      tableName: 'plugin_method',
      name: 'plugin_method_pkey',
      definition: 'CREATE UNIQUE INDEX plugin_method_pkey ON public.plugin_method USING btree (id)',
    },
    {
      tableName: 'plugin_method',
      name: 'plugin_method_pluginId_idx',
      definition: 'CREATE INDEX "plugin_method_pluginId_idx" ON public.plugin_method USING btree ("pluginId")',
    },
    {
      tableName: 'plugin_method',
      name: 'plugin_method_pluginId_name_uq',
      definition:
        'CREATE UNIQUE INDEX "plugin_method_pluginId_name_uq" ON public.plugin_method USING btree ("pluginId", name)',
    },
    {
      tableName: 'workflow',
      name: 'workflow_ownerId_idx',
      definition: 'CREATE INDEX "workflow_ownerId_idx" ON public.workflow USING btree ("ownerId")',
    },
    {
      tableName: 'workflow',
      name: 'workflow_pkey',
      definition: 'CREATE UNIQUE INDEX workflow_pkey ON public.workflow USING btree (id)',
    },
    {
      tableName: 'workflow_step',
      name: 'workflow_step_pkey',
      definition: 'CREATE UNIQUE INDEX workflow_step_pkey ON public.workflow_step USING btree (id)',
    },
    {
      tableName: 'workflow_step',
      name: 'workflow_step_pluginMethodId_idx',
      definition:
        'CREATE INDEX "workflow_step_pluginMethodId_idx" ON public.workflow_step USING btree ("pluginMethodId")',
    },
    {
      tableName: 'workflow_step',
      name: 'workflow_step_workflowId_idx',
      definition: 'CREATE INDEX "workflow_step_workflowId_idx" ON public.workflow_step USING btree ("workflowId")',
    },
  ],
  overrides: [
    {
      name: 'trigger_workflow_updatedAt',
      value: {
        sql: 'CREATE OR REPLACE TRIGGER "workflow_updatedAt"\n  BEFORE UPDATE ON "workflow"\n  FOR EACH ROW\n  EXECUTE FUNCTION updated_at();',
        name: 'workflow_updatedAt',
        type: 'trigger',
      },
    },
  ],
  tables: WORKFLOW_TABLES.map((tableName) => ({ tableName, tableType: 'r', persistence: 'p' })),
  triggers: [
    {
      tableName: 'workflow',
      name: 'workflow_updatedAt',
      definition:
        'CREATE TRIGGER "workflow_updatedAt" BEFORE UPDATE ON workflow FOR EACH ROW EXECUTE FUNCTION updated_at()',
    },
  ],
};

export const WORKFLOW_SCHEMA_MANIFESTS = {
  'post-update': POST_UPDATE_WORKFLOW_SCHEMA_MANIFEST,
  'post-plugin-templates': {
    ...POST_UPDATE_WORKFLOW_SCHEMA_MANIFEST,
    columns: [
      ...POST_UPDATE_COLUMNS.slice(0, 10),
      {
        tableName: 'plugin',
        ordinal: 11,
        columnName: 'templates',
        type: 'jsonb',
        isNotNull: true,
        defaultExpression: null,
      },
      {
        tableName: 'plugin',
        ordinal: 12,
        columnName: 'sha256hash',
        type: 'bytea',
        isNotNull: true,
        defaultExpression: null,
      },
      ...POST_UPDATE_COLUMNS.slice(10),
    ],
  },
  'post-allowed-hosts': {
    ...POST_UPDATE_WORKFLOW_SCHEMA_MANIFEST,
    columns: [
      ...POST_UPDATE_COLUMNS.slice(0, 10),
      {
        tableName: 'plugin',
        ordinal: 11,
        columnName: 'templates',
        type: 'jsonb',
        isNotNull: true,
        defaultExpression: null,
      },
      {
        tableName: 'plugin',
        ordinal: 12,
        columnName: 'sha256hash',
        type: 'bytea',
        isNotNull: true,
        defaultExpression: null,
      },
      ...POST_UPDATE_COLUMNS.slice(10, 19),
      {
        tableName: 'plugin_method',
        ordinal: 10,
        columnName: 'allowedHosts',
        type: 'character varying[]',
        isNotNull: true,
        defaultExpression: "'{}'::character varying[]",
      },
      ...POST_UPDATE_COLUMNS.slice(19),
    ],
  },
} satisfies Record<WorkflowSchemaStage, typeof POST_UPDATE_WORKFLOW_SCHEMA_MANIFEST>;

export const WORKFLOW_SCHEMA_DIGESTS: Readonly<Record<WorkflowSchemaStage, string>> = Object.fromEntries(
  Object.entries(WORKFLOW_SCHEMA_MANIFESTS).map(([stage, manifest]) => [stage, hash(JSON.stringify(manifest))]),
) as Record<WorkflowSchemaStage, string>;

export type WorkflowRowDigest = { count: number; digest: string; table: `public.${(typeof WORKFLOW_TABLES)[number]}` };

export type WorkflowCompatibilityEvidence = {
  ledger: Array<{ name: string; timestamp: string }>;
  rowDigests: WorkflowRowDigest[];
  schemaDigest: string;
  schemaStage: WorkflowSchemaStage;
};

export type WorkflowCompatibility = {
  mode: 'legacy-alias' | 'official';
  rowDigests: WorkflowRowDigest[];
  schemaDigest: string;
  timestamp: string;
};

const expectedStageFromLedger = (ledger: WorkflowCompatibilityEvidence['ledger']): WorkflowSchemaStage => {
  const hasTemplates = ledger.some(({ name }) => name === ADD_PLUGIN_TEMPLATES_MIGRATION);
  const hasAllowedHosts = ledger.some(({ name }) => name === ADD_PLUGIN_METHOD_ALLOWED_HOSTS_MIGRATION);
  if (hasAllowedHosts && !hasTemplates) {
    throw new Error('workflow ledger/schema disagreement');
  }
  return hasAllowedHosts ? 'post-allowed-hosts' : hasTemplates ? 'post-plugin-templates' : 'post-update';
};

export function classifyWorkflowCompatibility(evidence: WorkflowCompatibilityEvidence): WorkflowCompatibility {
  const legacy = evidence.ledger.find(({ name }) => name === LEGACY_WORKFLOW_MIGRATION);
  const official = evidence.ledger.find(({ name }) => name === OFFICIAL_WORKFLOW_MIGRATION);
  if (legacy && official) {
    throw new Error('Found both workflow migration markers');
  }
  if (!legacy && !official) {
    throw new Error('Found workflow tables with no workflow migration marker');
  }
  const expectedStage = expectedStageFromLedger(evidence.ledger);
  if (evidence.schemaStage !== expectedStage) {
    throw new Error('workflow ledger/schema disagreement');
  }
  if (evidence.schemaDigest !== WORKFLOW_SCHEMA_DIGESTS[expectedStage]) {
    throw new Error(`Unexpected workflow schema fingerprint: ${evidence.schemaDigest}`);
  }
  return {
    mode: legacy ? 'legacy-alias' : 'official',
    timestamp: (legacy ?? official)!.timestamp,
    schemaDigest: evidence.schemaDigest,
    rowDigests: evidence.rowDigests,
  };
}

const inferSchemaStage = (columns: Array<{ columnName: string; tableName: string }>): WorkflowSchemaStage => {
  const names = new Set(columns.map(({ columnName, tableName }) => `${tableName}.${columnName}`));
  const templates = names.has('plugin.templates');
  const sha256hash = names.has('plugin.sha256hash');
  const allowedHosts = names.has('plugin_method.allowedHosts');
  if (templates !== sha256hash || (allowedHosts && !templates)) {
    throw new Error('workflow ledger/schema disagreement');
  }
  return allowedHosts ? 'post-allowed-hosts' : templates ? 'post-plugin-templates' : 'post-update';
};

export async function getWorkflowCompatibilityEvidence(runner: Kysely<DB>): Promise<WorkflowCompatibilityEvidence> {
  const ledger = await sql<{ name: string; timestamp: string }>`
    SELECT name, timestamp
    FROM public.kysely_migrations
    WHERE name IN (
      ${LEGACY_WORKFLOW_MIGRATION},
      ${OFFICIAL_WORKFLOW_MIGRATION},
      ${ADD_PLUGIN_TEMPLATES_MIGRATION},
      ${ADD_PLUGIN_METHOD_ALLOWED_HOSTS_MIGRATION}
    )
    ORDER BY timestamp, name
  `.execute(runner);
  const tables = await sql<{ persistence: string; tableName: string; tableType: string }>`
    SELECT class.relname AS "tableName", class.relkind::text AS "tableType", class.relpersistence::text AS persistence
    FROM pg_catalog.pg_class class
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public' AND class.relname IN (${sql.join(WORKFLOW_TABLES)})
    ORDER BY class.relname
  `.execute(runner);
  if (tables.rows.length !== WORKFLOW_TABLES.length) {
    throw new Error('Unexpected workflow schema fingerprint: missing workflow/plugin table');
  }
  const columns = await sql<{
    columnName: string;
    defaultExpression: string | null;
    isNotNull: boolean;
    ordinal: number;
    tableName: string;
    type: string;
  }>`
    SELECT class.relname AS "tableName", attribute.attnum::int AS ordinal,
      attribute.attname AS "columnName", pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS type,
      attribute.attnotnull AS "isNotNull", pg_catalog.pg_get_expr(defaults.adbin, defaults.adrelid) AS "defaultExpression"
    FROM pg_catalog.pg_attribute attribute
    JOIN pg_catalog.pg_class class ON class.oid = attribute.attrelid
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = class.relnamespace
    LEFT JOIN pg_catalog.pg_attrdef defaults ON defaults.adrelid = class.oid AND defaults.adnum = attribute.attnum
    WHERE namespace.nspname = 'public' AND class.relname IN (${sql.join(WORKFLOW_TABLES)})
      AND attribute.attnum > 0 AND NOT attribute.attisdropped
    ORDER BY class.relname, attribute.attnum
  `.execute(runner);
  const constraints = await sql<{ definition: string; name: string; tableName: string; type: string }>`
    SELECT class.relname AS "tableName", con.conname AS name, con.contype::text AS type,
      pg_catalog.pg_get_constraintdef(con.oid, true) AS definition
    FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_class class ON class.oid = con.conrelid
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public' AND class.relname IN (${sql.join(WORKFLOW_TABLES)})
    ORDER BY class.relname, con.conname
  `.execute(runner);
  const indexes = await sql<{ definition: string; name: string; tableName: string }>`
    SELECT table_class.relname AS "tableName", index_class.relname AS name,
      pg_catalog.pg_get_indexdef(indexes.indexrelid) AS definition
    FROM pg_catalog.pg_index indexes
    JOIN pg_catalog.pg_class table_class ON table_class.oid = indexes.indrelid
    JOIN pg_catalog.pg_class index_class ON index_class.oid = indexes.indexrelid
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = table_class.relnamespace
    WHERE namespace.nspname = 'public' AND table_class.relname IN (${sql.join(WORKFLOW_TABLES)})
    ORDER BY table_class.relname, index_class.relname
  `.execute(runner);
  const triggers = await sql<{ definition: string; name: string; tableName: string }>`
    SELECT class.relname AS "tableName", trigger.tgname AS name,
      pg_catalog.pg_get_triggerdef(trigger.oid, true) AS definition
    FROM pg_catalog.pg_trigger trigger
    JOIN pg_catalog.pg_class class ON class.oid = trigger.tgrelid
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public' AND class.relname IN (${sql.join(WORKFLOW_TABLES)})
      AND NOT trigger.tgisinternal
    ORDER BY class.relname, trigger.tgname
  `.execute(runner);
  const overrides = await sql<{ name: string; value: unknown }>`
    SELECT name, value
    FROM public.migration_overrides
    WHERE name ILIKE '%workflow%' OR name ILIKE '%plugin%'
       OR value::text ILIKE '%workflow%' OR value::text ILIKE '%plugin%'
    ORDER BY name
  `.execute(runner);
  const catalog = {
    columns: columns.rows,
    constraints: constraints.rows,
    indexes: indexes.rows,
    overrides: overrides.rows,
    tables: tables.rows,
    triggers: triggers.rows,
  };
  const rowDigests: WorkflowRowDigest[] = [];
  for (const table of WORKFLOW_TABLES) {
    const rows = await sql
      .raw<{
        rowData: string;
      }>(
        `SELECT row_to_json(row_data)::text AS "rowData" FROM public."${table}" row_data ORDER BY row_to_json(row_data)::text`,
      )
      .execute(runner);
    rowDigests.push({
      table: `public.${table}`,
      count: rows.rows.length,
      digest: hash(rows.rows.map(({ rowData }) => rowData).join('\n')),
    });
  }
  return {
    ledger: ledger.rows,
    rowDigests,
    schemaDigest: hash(JSON.stringify(catalog)),
    schemaStage: inferSchemaStage(columns.rows),
  };
}

const assertWorkflowEvidenceUnchanged = (before: WorkflowCompatibility, after: WorkflowCompatibilityEvidence): void => {
  if (
    after.schemaDigest !== before.schemaDigest ||
    JSON.stringify(after.rowDigests) !== JSON.stringify(before.rowDigests)
  ) {
    throw new Error('Workflow schema or rows changed during ledger alias');
  }
};

export async function aliasLegacyWorkflowMigration(
  transaction: Kysely<DB>,
  compatibility: WorkflowCompatibility,
  reportDigest: string,
): Promise<void> {
  if (compatibility.mode === 'official') {
    return;
  }
  await sql`
    INSERT INTO immich_fork.migration_audit (name, phase, status, details, "completedAt")
    VALUES (
      ${LEGACY_WORKFLOW_MIGRATION},
      'workflow-alias',
      'applied',
      jsonb_build_object(
        'legacyName', ${LEGACY_WORKFLOW_MIGRATION}::text,
        'officialName', ${OFFICIAL_WORKFLOW_MIGRATION}::text,
        'originalTimestamp', ${compatibility.timestamp}::text,
        'schemaFingerprint', ${compatibility.schemaDigest}::text,
        'rowDigests', (${{ rows: compatibility.rowDigests }}::jsonb -> 'rows'),
        'reportDigest', ${reportDigest}::text
      ),
      now()
    )
  `.execute(transaction);
  const deleted = await sql`
    DELETE FROM public.kysely_migrations WHERE name = ${LEGACY_WORKFLOW_MIGRATION}
  `.execute(transaction);
  if (Number(deleted.numAffectedRows) !== 1) {
    throw new Error('Legacy workflow migration marker changed during ledger alias');
  }
  await sql`
    INSERT INTO public.kysely_migrations (name, timestamp)
    VALUES (${OFFICIAL_WORKFLOW_MIGRATION}, ${compatibility.timestamp})
  `.execute(transaction);
  const after = await getWorkflowCompatibilityEvidence(transaction);
  const classifiedAfter = classifyWorkflowCompatibility(after);
  if (classifiedAfter.mode !== 'official' || classifiedAfter.timestamp !== compatibility.timestamp) {
    throw new Error('Workflow migration ledger alias verification failed');
  }
  assertWorkflowEvidenceUnchanged(compatibility, after);
}
