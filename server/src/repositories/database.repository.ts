import { schemaDiff, schemaFromCode, schemaFromDatabase } from '@immich/sql-tools';
/* eslint-disable unicorn/prefer-module -- migration providers resolve paths relative to the compiled CommonJS module */
import { Injectable } from '@nestjs/common';
import AsyncLock from 'async-lock';
import { Kysely, Migration, MigrationProvider, Migrator, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { join } from 'node:path';
import semver from 'semver';
import {
  EXTENSION_NAMES,
  POSTGRES_VERSION_RANGE,
  VECTOR_EXTENSIONS,
  VECTOR_INDEX_TABLES,
  VECTOR_VERSION_RANGE,
  VECTORCHORD_LIST_SLACK_FACTOR,
  VECTORCHORD_VERSION_RANGE,
} from 'src/constants';
import { StorageCore } from 'src/cores/storage.core';
import { GenerateSql } from 'src/decorators';
import { DatabaseExtension, DatabaseLock, VectorIndex } from 'src/enum';
import {
  CatalogDiff,
  CatalogManifest,
  compareCatalogs,
  getCatalogEvidence,
  getCatalogTableLocks,
} from 'src/fork-schema/catalog';
import forkCatalogManifest from 'src/fork-schema/manifests/fork-v2-catalog.json';
import officialCatalogManifest from 'src/fork-schema/manifests/v3.1.0-public-catalog.json';
import {
  CERTIFIED_TAG_MIGRATIONS,
  classifyMigration,
  GENERIC_LEGACY_FORK_MIGRATIONS,
  POST_CERTIFIED_UPSTREAM_MIGRATIONS,
} from 'src/fork-schema/migration-manifest';
import {
  createCertifiedLedgerMigrationProvider,
  createForkMigrationProvider,
  createLegacyMigrationProvider,
  createOfficialMigrationProvider,
} from 'src/fork-schema/migration-provider';
import {
  irreversiblePostCertifiedMigrations,
  REVERSIBLE_POST_CERTIFIED_MIGRATIONS,
} from 'src/fork-schema/post-certified-residue';
import {
  aliasLegacyWorkflowMigration,
  classifyWorkflowCompatibility,
  getWorkflowCompatibilityEvidence,
  LEGACY_WORKFLOW_MIGRATION,
  normalizeWorkflowMigrationForOfficialOrder,
  validateOfficialMigrationLedgerOrder,
  WorkflowCompatibility,
} from 'src/fork-schema/workflow-compatibility';
import { ConfigRepository } from 'src/repositories/config.repository';
import {
  canonicalStorageVerificationDigest,
  StorageVerificationEvidence,
} from 'src/repositories/fork-cutover-verification.repository';
import { ForkHandoffRepository } from 'src/repositories/fork-handoff.repository';
import { BACKFILL_KINDS } from 'src/repositories/fork-schema.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import 'src/schema'; // make sure all schema definitions are imported for schemaFromCode
import { DB } from 'src/schema';
import { immich_uuid_v7 } from 'src/schema/functions';
import { ExtensionVersion, VectorExtension } from 'src/types';
import { vectorIndexQuery } from 'src/utils/database';
import z from 'zod';

export let cachedVectorExtension: VectorExtension | undefined;

const CLIP_TABLES = ['smart_search', 'smart_search_description', 'asset_video_duplicate_frame'] as const;

const FORK_CATALOG_MANIFEST = forkCatalogManifest as CatalogManifest;
const OFFICIAL_CATALOG_MANIFEST = officialCatalogManifest as CatalogManifest;

const INERT_LEGACY_CATALOG_ALLOWLIST = new Set<string>();

const forkEntries = <T extends { identity: string }>(entries: T[]) =>
  entries.filter(({ identity }) => identity === 'immich_fork' || identity.startsWith('immich_fork.'));

const expectedCatalogFor = (installationClass: ForkSchemaCutoverEvidence['installationClass']): CatalogManifest => {
  if (installationClass === 'current-fork') {
    return FORK_CATALOG_MANIFEST;
  }
  return {
    ...OFFICIAL_CATALOG_MANIFEST,
    columns: [...OFFICIAL_CATALOG_MANIFEST.columns, ...forkEntries(FORK_CATALOG_MANIFEST.columns)],
    constraints: [...OFFICIAL_CATALOG_MANIFEST.constraints, ...forkEntries(FORK_CATALOG_MANIFEST.constraints)],
    enums: [...OFFICIAL_CATALOG_MANIFEST.enums, ...forkEntries(FORK_CATALOG_MANIFEST.enums)],
    forkMigrations: FORK_CATALOG_MANIFEST.forkMigrations,
    functions: [...OFFICIAL_CATALOG_MANIFEST.functions, ...forkEntries(FORK_CATALOG_MANIFEST.functions)],
    indexes: [...OFFICIAL_CATALOG_MANIFEST.indexes, ...forkEntries(FORK_CATALOG_MANIFEST.indexes)],
    schemas: [...OFFICIAL_CATALOG_MANIFEST.schemas, ...forkEntries(FORK_CATALOG_MANIFEST.schemas)],
    source: 'v3.1.0+fork-v2',
    tables: [...OFFICIAL_CATALOG_MANIFEST.tables, ...forkEntries(FORK_CATALOG_MANIFEST.tables)],
    triggers: [...OFFICIAL_CATALOG_MANIFEST.triggers, ...forkEntries(FORK_CATALOG_MANIFEST.triggers)],
  };
};

const LEGACY_TRIGGER_NAMES = new Set([
  'physical_file_updatedAt',
  'asset_video_duplicate_frame_updatedAt',
  'asset_health_updatedAt',
  'asset_health_candidate_updatedAt',
  'album_parent_cycle_check_trigger',
]);

const LEGACY_MIGRATION_OVERRIDE_NAMES = new Set([
  'function_album_parent_cycle_check',
  'index_album_parentId_idx',
  'index_album_parent_sort_idx',
  'index_album_root_sort_idx',
  'index_idx_asset_exif_description_trigram',
  'index_idx_asset_is_nsfw',
  'trigger_album_parent_cycle_check_trigger',
  'trigger_asset_health_candidate_updatedAt',
  'trigger_asset_health_updatedAt',
  'trigger_asset_video_duplicate_frame_updatedAt',
  'trigger_physical_file_updatedAt',
]);

export const FORK_SCHEMA_CUTOVER_MUTATION_STAGES = [
  'workflow-alias',
  'legacy-ledger-audit',
  'legacy-ledger-delete',
  'legacy-artifact-shutdown',
  'post-certified-residue',
  'state-transition',
  'checkpoint-audit',
] as const;

export type ForkSchemaCutoverMutationStage = (typeof FORK_SCHEMA_CUTOVER_MUTATION_STAGES)[number];

export type ForkSchemaCutoverEvidence = {
  activeWrites: number;
  backfills: Array<{
    claimToken: string | null;
    claimedCursor: string | null;
    claimedIds: string[];
    cursor: string | null;
    digest: string | null;
    kind: string;
    lastError: string | null;
    processed: number;
    remaining: number;
  }>;
  backfillKindsValid: boolean;
  catalogDiff: CatalogDiff;
  checksumCoverage: {
    applicableCount: number;
    applicableDigest: string;
    invalidCount: number;
    sidecarCount: number;
    sidecarDigest: string;
    valid: boolean;
  };
  checksumFailures: number;
  forkLedgerValid: boolean;
  forkMigrations: string[];
  installationClass: 'current-fork' | 'original-official';
  ledger: Array<{
    classification: 'legacy-fork' | 'unknown' | 'upstream';
    name: string;
    timestamp: string;
  }>;
  maintenanceMode: boolean;
  migrationOrderValid: boolean;
  officialPendingMigrations: string[];
  mappingCoverage: {
    mappingCount: number;
    mappingDigest: string;
    normalizedCount: number;
    normalizedDigest: string;
    unsafeCount: number;
    valid: boolean;
  };
  state: {
    active: boolean;
    phase: 'active' | 'dual-write' | 'failed' | 'inactive' | 'legacy' | 'ready';
    schemaVersion: string;
    upstreamVersion: string;
  };
  storageReservations: number;
  storageVerification: {
    runId: string;
    databaseBackupId: string;
    mediaSnapshotId: string;
    assetCount: number;
    aggregateDigest: string;
    completedAt: string;
    evidenceAggregateDigest: string;
    evidenceAssetCount: number;
    failureCount: number;
    rootDriftCount: number;
    verifiedCount: number;
  } | null;
  tableEvidence: Array<{ count: number; digest: string; table: string }>;
  unsafePhysicalMappings: number;
  workflowCompatibility: WorkflowCompatibility;
};

export type ForkSchemaCutoverCheckpoint = {
  committedAt: string;
  phase: 'inactive';
  reportDigest: string;
  schemaVersion: '2';
};

const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

export async function getVectorExtension(runner: Kysely<DB>): Promise<VectorExtension> {
  if (cachedVectorExtension) {
    return cachedVectorExtension;
  }

  cachedVectorExtension = new ConfigRepository().getEnv().database.vectorExtension;
  if (cachedVectorExtension) {
    return cachedVectorExtension;
  }

  const query = `SELECT name FROM pg_available_extensions WHERE name IN (${VECTOR_EXTENSIONS.map((ext) => `'${ext}'`).join(', ')})`;
  const { rows: availableExtensions } = await sql.raw<{ name: VectorExtension }>(query).execute(runner);
  const extensionNames = new Set(availableExtensions.map((row) => row.name));
  cachedVectorExtension = VECTOR_EXTENSIONS.find((ext) => extensionNames.has(ext));
  if (!cachedVectorExtension) {
    throw new Error(`No vector extension found. Available extensions: ${VECTOR_EXTENSIONS.join(', ')}`);
  }
  return cachedVectorExtension;
}

export const probes: Record<VectorIndex, number> = {
  [VectorIndex.Clip]: 1,
  [VectorIndex.Face]: 1,
};

@Injectable()
export class DatabaseRepository extends ForkHandoffRepository {
  private readonly asyncLock = new AsyncLock();

  constructor(
    @InjectKysely() db: Kysely<DB>,
    private logger: LoggingRepository,
    private configRepository: ConfigRepository,
  ) {
    super(db);
    this.logger.setContext(DatabaseRepository.name);
  }

  override isCertifiedReturnStartup(kysely: Kysely<DB> = this.db): Promise<boolean> {
    return super.isCertifiedReturnStartup(kysely);
  }

  override assertCertifiedReturnLedger(kysely: Kysely<DB> = this.db): Promise<'v3.1.0'> {
    return super.assertCertifiedReturnLedger(kysely);
  }

  async shutdown() {
    await this.db.destroy();
  }

  getVectorExtension(): Promise<VectorExtension> {
    return getVectorExtension(this.db);
  }

  @GenerateSql({ params: [[DatabaseExtension.Vector]] })
  async getExtensionVersions(extensions: readonly DatabaseExtension[]): Promise<ExtensionVersion[]> {
    const { rows } = await sql<ExtensionVersion>`
      SELECT name, default_version as "availableVersion", installed_version as "installedVersion"
      FROM pg_available_extensions
      WHERE name in (${sql.join(extensions)})
    `.execute(this.db);
    return rows;
  }

  getExtensionVersionRange(extension: VectorExtension): string {
    switch (extension) {
      case DatabaseExtension.VectorChord: {
        return VECTORCHORD_VERSION_RANGE;
      }
      case DatabaseExtension.Vector: {
        return VECTOR_VERSION_RANGE;
      }
      default: {
        throw new Error(`Unsupported vector extension: '${extension}'`);
      }
    }
  }

  @GenerateSql()
  async getPostgresVersion(): Promise<string> {
    const { rows } = await sql<{ server_version: string }>`SHOW server_version`.execute(this.db);
    return rows[0].server_version;
  }

  getPostgresVersionRange(): string {
    return POSTGRES_VERSION_RANGE;
  }

  async createExtension(extension: DatabaseExtension): Promise<void> {
    this.logger.log(`Creating ${EXTENSION_NAMES[extension]} extension`);
    await sql`CREATE EXTENSION IF NOT EXISTS ${sql.raw(extension)} CASCADE`.execute(this.db);
    if (extension === DatabaseExtension.VectorChord) {
      const dbName = sql.id(await this.getDatabaseName());
      await sql`ALTER DATABASE ${dbName} SET vchordrq.probes = 1`.execute(this.db);
      await sql`SET vchordrq.probes = 1`.execute(this.db);
    }
  }

  async dropExtension(extension: DatabaseExtension): Promise<void> {
    this.logger.log(`Dropping ${EXTENSION_NAMES[extension]} extension`);
    await sql`DROP EXTENSION IF EXISTS ${sql.raw(extension)}`.execute(this.db);
  }

  async updateVectorExtension(extension: VectorExtension, targetVersion?: string): Promise<void> {
    const [{ availableVersion, installedVersion }] = await this.getExtensionVersions([extension]);
    if (!installedVersion) {
      throw new Error(`${EXTENSION_NAMES[extension]} extension is not installed`);
    }

    if (!availableVersion) {
      throw new Error(`No available version for ${EXTENSION_NAMES[extension]} extension`);
    }
    targetVersion ??= availableVersion;

    if (!semver.diff(installedVersion, targetVersion)) {
      return;
    }

    await Promise.all([
      this.db.schema.dropIndex(VectorIndex.Clip).ifExists().execute(),
      this.db.schema.dropIndex(VectorIndex.Face).ifExists().execute(),
    ]);

    await sql`ALTER EXTENSION ${sql.raw(extension)} UPDATE TO ${sql.lit(targetVersion)}`.execute(this.db);
    await Promise.all([this.reindexVectors(VectorIndex.Clip), this.reindexVectors(VectorIndex.Face)]);
  }

  async prewarm(index: VectorIndex): Promise<void> {
    const vectorExtension = await getVectorExtension(this.db);
    if (vectorExtension !== DatabaseExtension.VectorChord) {
      return;
    }
    this.logger.debug(`Prewarming ${index}`);
    await sql`SELECT vchordrq_prewarm(${index})`.execute(this.db);
  }

  async reindexVectorsIfNeeded(names: VectorIndex[]): Promise<void> {
    const { rows } = await sql<{
      indexdef: string;
      indexname: string;
    }>`SELECT indexdef, indexname FROM pg_indexes WHERE indexname = ANY(ARRAY[${sql.join(names)}])`.execute(this.db);

    const vectorExtension = await getVectorExtension(this.db);

    const promises = [];
    for (const indexName of names) {
      const row = rows.find((index) => index.indexname === indexName);
      const table = VECTOR_INDEX_TABLES[indexName];
      if (!row) {
        promises.push(this.reindexVectors(indexName));
        continue;
      }

      switch (vectorExtension) {
        case DatabaseExtension.Vector: {
          if (!row.indexdef.toLowerCase().includes('using hnsw')) {
            promises.push(this.reindexVectors(indexName));
          }
          break;
        }
        case DatabaseExtension.VectorChord: {
          const matches = row.indexdef.match(/(?<=lists = \[)\d+/g);
          const lists = matches && matches.length > 0 ? Number(matches[0]) : 1;
          promises.push(
            this.getRowCount(table).then((count) => {
              const targetLists = this.targetListCount(count);
              this.logger.log(`targetLists=${targetLists}, current=${lists} for ${indexName} of ${count} rows`);
              if (
                !row.indexdef.toLowerCase().includes('using vchordrq') ||
                // slack factor is to avoid frequent reindexing if the count is borderline
                (lists !== targetLists && lists !== this.targetListCount(count * VECTORCHORD_LIST_SLACK_FACTOR))
              ) {
                probes[indexName] = this.targetProbeCount(targetLists);
                return this.reindexVectors(indexName, { lists: targetLists });
              }
              probes[indexName] = this.targetProbeCount(lists);
            }),
          );
          break;
        }
      }
    }

    if (promises.length > 0) {
      await Promise.all(promises);
    }
  }

  private async reindexVectors(indexName: VectorIndex, { lists }: { lists?: number } = {}): Promise<void> {
    this.logger.log(`Reindexing ${indexName} (This may take a while, do not restart)`);
    const table = VECTOR_INDEX_TABLES[indexName];
    const vectorExtension = await getVectorExtension(this.db);

    const { rows } = await sql<{
      columnName: string;
    }>`SELECT column_name as "columnName" FROM information_schema.columns WHERE table_name = ${table}`.execute(this.db);
    if (rows.length === 0) {
      this.logger.warn(
        `Table ${table} does not exist, skipping reindexing. This is only normal if this is a new Immich instance.`,
      );
      return;
    }
    const dimSize = await this.getDimensionSize(table);
    lists ||= this.targetListCount(await this.getRowCount(table));
    await this.db.transaction().execute(async (tx) => {
      await sql`DROP INDEX IF EXISTS ${sql.raw(indexName)}`.execute(tx);
      if (table === 'smart_search') {
        await sql`ALTER TABLE ${sql.raw(table)} DROP CONSTRAINT IF EXISTS dim_size_constraint`.execute(tx);
      }
      if (rows.every((row) => row.columnName !== 'embedding')) {
        this.logger.warn(`Column 'embedding' does not exist in table '${table}', truncating and adding column.`);
        await sql`TRUNCATE TABLE ${sql.raw(table)}`.execute(tx);
        await sql`ALTER TABLE ${sql.raw(table)} ADD COLUMN embedding real[] NOT NULL`.execute(tx);
      }
      await sql`ALTER TABLE ${sql.raw(table)} ALTER COLUMN embedding SET DATA TYPE real[]`.execute(tx);
      await sql`
        ALTER TABLE ${sql.raw(table)}
        ALTER COLUMN embedding
        SET DATA TYPE vector(${sql.raw(String(dimSize))})`.execute(tx);
      await sql.raw(vectorIndexQuery({ vectorExtension, table, indexName, lists })).execute(tx);
    });
    try {
      await sql`VACUUM ANALYZE ${sql.raw(table)}`.execute(this.db);
    } catch (error: any) {
      this.logger.warn(`Failed to vacuum table '${table}'. The DB will temporarily use more disk space: ${error}`);
    }
    this.logger.log(`Reindexed ${indexName}`);
  }

  private async getDatabaseName(): Promise<string> {
    const { rows } = await sql<{ db: string }>`SELECT current_database() as db`.execute(this.db);
    return rows[0].db;
  }

  getMigrations() {
    return this.db.selectFrom('kysely_migrations').select(['name', 'timestamp']).orderBy('name', 'asc').execute();
  }

  async getSchemaDrift() {
    const source = schemaFromCode({
      overrides: true,
      namingStrategy: 'default',
      uuidFunction: (version) => (version === 7 ? `${immich_uuid_v7.name}()` : 'uuid_generate_v4()'),
    });
    const { database } = this.configRepository.getEnv();
    const target = await schemaFromDatabase({ connection: database.config });

    const drift = schemaDiff(source, target, {
      tables: { ignoreExtra: true },
      constraints: { ignoreExtra: false },
      indexes: { ignoreExtra: true },
      triggers: { ignoreExtra: true },
      columns: { ignoreExtra: true },
      functions: { ignoreExtra: false },
      parameters: { ignoreExtra: true },
      extensions: { ignoreExtra: true },
    });

    return drift;
  }

  async getDimensionSize(table: string, column = 'embedding'): Promise<number> {
    const { rows } = await sql<{ dimsize: number }>`
      SELECT atttypmod as dimsize
      FROM pg_attribute f
        JOIN pg_class c ON c.oid = f.attrelid
      WHERE c.relkind = 'r'::char
        AND f.attnum > 0
        AND c.relname = ${table}::text
        AND f.attname = ${column}::text
    `.execute(this.db);

    const dimSize = rows[0]?.dimsize;
    if (
      !z
        .int()
        .min(1)
        .max(2 ** 16)
        .safeParse(dimSize).success
    ) {
      this.logger.warn(`Could not retrieve dimension size of column '${column}' in table '${table}', assuming 512`);
      return 512;
    }
    return dimSize;
  }

  async setDimensionSize(dimSize: number): Promise<void> {
    if (
      !z
        .int()
        .min(1)
        .max(2 ** 16)
        .safeParse(dimSize).success
    ) {
      throw new Error(`Invalid CLIP dimension size: ${dimSize}`);
    }

    const { rows: clipTables } = await sql<{ tableName: string }>`
      SELECT table_name as "tableName"
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY(${CLIP_TABLES})
    `.execute(this.db);
    const tables = clipTables.map(({ tableName }) => tableName);

    // this is done in two transactions to handle concurrent writes
    await this.db.transaction().execute(async (trx) => {
      for (const table of tables) {
        const constraint = `${table}_dim_size_constraint`;
        await sql`delete from ${sql.table(table)}`.execute(trx);
        await sql`alter table ${sql.table(table)} drop constraint if exists ${sql.raw(constraint)}`.execute(trx);
        await sql`alter table ${sql.table(table)} add constraint ${sql.raw(constraint)} check (array_length(embedding::real[], 1) = ${sql.lit(dimSize)})`.execute(
          trx,
        );
      }
    });

    const vectorExtension = await this.getVectorExtension();
    await this.db.transaction().execute(async (trx) => {
      if (tables.includes('smart_search')) {
        await sql`drop index if exists clip_index`.execute(trx);
      }
      if (tables.includes('smart_search_description')) {
        await sql`drop index if exists clip_description_index`.execute(trx);
      }
      for (const table of tables) {
        const constraint = `${table}_dim_size_constraint`;
        await trx.schema
          .alterTable(table)
          .alterColumn('embedding', (col) => col.setDataType(sql.raw(`vector(${dimSize})`)))
          .execute();
        await sql`alter table ${sql.table(table)} drop constraint if exists ${sql.raw(constraint)}`.execute(trx);
      }
      if (tables.includes('smart_search')) {
        await sql
          .raw(vectorIndexQuery({ vectorExtension, table: 'smart_search', indexName: VectorIndex.Clip }))
          .execute(trx);
      }
      if (tables.includes('smart_search_description')) {
        await sql
          .raw(
            vectorIndexQuery({
              vectorExtension,
              table: 'smart_search_description',
              indexName: 'clip_description_index',
            }),
          )
          .execute(trx);
      }
    });
    probes[VectorIndex.Clip] = 1;

    for (const table of tables) {
      await sql`vacuum analyze ${sql.table(table)}`.execute(this.db);
    }
  }

  async deleteAllSearchEmbeddings(): Promise<void> {
    await sql`truncate ${sql.table('smart_search')}, ${sql.table('smart_search_description')}, ${sql.table('asset_video_duplicate_frame')}`.execute(
      this.db,
    );
  }

  private targetListCount(count: number) {
    if (count < 128_000) {
      return 1;
    }
    // eslint-disable-next-line unicorn/prefer-minimal-ternary
    return count < 2_048_000 ? 1 << (32 - Math.clz32(count / 1000)) : 1 << (33 - Math.clz32(Math.sqrt(count)));
  }

  private targetProbeCount(lists: number) {
    return Math.ceil(lists / 8);
  }

  private async getRowCount(table: keyof DB): Promise<number> {
    const { count } = await this.db
      .selectFrom(this.db.dynamic.table(table).as('t'))
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    return count;
  }

  async runMigrations(): Promise<void> {
    this.logger.log('Running migrations');

    const ledgerTable = await sql<{ present: boolean }>`
      SELECT to_regclass('public.kysely_migrations') IS NOT NULL AS present
    `.execute(this.db);
    const ledger = ledgerTable.rows[0]?.present
      ? await sql<{ name: string }>`SELECT name FROM public.kysely_migrations`.execute(this.db)
      : { rows: [] };
    const provider = createCertifiedLedgerMigrationProvider(
      createLegacyMigrationProvider(join(__dirname, '..', 'schema/migrations')),
      ledger.rows.map(({ name }) => name),
    );
    const migrator = this.createMigrator(provider);

    const { error, results } = await migrator.migrateToLatest();

    for (const result of results ?? []) {
      if (result.status === 'Success') {
        this.logger.log(`Migration "${result.migrationName}" succeeded`);
      } else if (result.status === 'Error') {
        this.logger.warn(`Migration "${result.migrationName}" failed`);
      }
    }

    if (error) {
      this.logger.error(`Migrations failed: ${error}`);
      throw error;
    }

    this.logger.log('Finished running migrations');
  }

  async runOfficialMigrations(): Promise<void> {
    this.logger.log('Running official migrations');

    const ledgerTable = await sql<{ present: boolean }>`
      SELECT to_regclass('public.kysely_migrations') IS NOT NULL AS present
    `.execute(this.db);
    const ledger = ledgerTable.rows[0]?.present
      ? await sql<{ name: string }>`
          SELECT name FROM public.kysely_migrations ORDER BY timestamp, name
        `.execute(this.db)
      : { rows: [] };
    const appliedNames = ledger.rows.map(({ name }) => name);
    const officialProvider = createOfficialMigrationProvider(join(__dirname, '..', 'schema/migrations'));
    const bundledNames = Object.keys(await officialProvider.getMigrations());
    if (!validateOfficialMigrationLedgerOrder(appliedNames, bundledNames).valid) {
      throw new Error('Official migration ledger is not an exact ordered prefix of the bundled provider');
    }
    const provider = createCertifiedLedgerMigrationProvider(officialProvider, appliedNames);

    const migrator = new Migrator({
      db: this.db,
      migrationLockTableName: 'kysely_migrations_lock',
      allowUnorderedMigrations: this.configRepository.isDev(),
      migrationTableName: 'kysely_migrations',
      provider,
    });

    await this.runMigrationSet(migrator, 'official');
  }

  protected async loadOfficialMigrations(): Promise<Record<string, Migration>> {
    // Keep cutover on the same filtered provider used by normal startup. This
    // provider refuses unknown files and cannot expose fork migrations.
    return createOfficialMigrationProvider(join(__dirname, '..', 'schema/migrations')).getMigrations();
  }

  async getForkSchemaCutoverEvidence(
    runner: Kysely<DB> = this.db,
    checkpoint?: { databaseBackupId: string; mediaSnapshotId: string },
  ): Promise<ForkSchemaCutoverEvidence> {
    const [
      officialMigrations,
      ledgerResult,
      forkLedgerResult,
      stateResult,
      backfillResult,
      maintenanceResult,
      classificationResult,
    ] = await Promise.all([
      this.loadOfficialMigrations(),
      sql<{ name: string; timestamp: string }>`
          SELECT name, timestamp FROM public.kysely_migrations ORDER BY timestamp, name
        `.execute(runner),
      sql<{ name: string }>`SELECT name FROM immich_fork.migrations ORDER BY timestamp, name`.execute(runner),
      sql<ForkSchemaCutoverEvidence['state']>`
          SELECT active, phase, "schemaVersion", "upstreamVersion" FROM immich_fork.state WHERE id = 1
        `.execute(runner),
      sql<{
        digest: string | null;
        claimToken: string | null;
        claimedCursor: string | null;
        claimedIds: string[];
        cursor: string | null;
        kind: string;
        lastError: string | null;
        processed: string;
        remaining: string;
      }>`
          SELECT kind, cursor, processed, remaining, digest, "claimedCursor", "claimedIds", "claimToken", "lastError"
          FROM immich_fork.backfill_progress
          ORDER BY kind
        `.execute(runner),
      sql<{ maintenanceMode: boolean }>`
          SELECT coalesce((value->>'isMaintenanceMode')::boolean, false) AS "maintenanceMode"
          FROM public.system_metadata
          WHERE key = 'maintenance-mode'
        `.execute(runner),
      sql<{ currentFork: boolean }>`
          SELECT to_regclass('public.physical_file') IS NOT NULL AS "currentFork"
        `.execute(runner),
    ]);

    const state = stateResult.rows[0];
    if (!state) {
      throw new Error('Fork schema state is not initialized');
    }
    const ledger = ledgerResult.rows.map((row) => ({ ...row, classification: classifyMigration(row.name) }));
    const workflowCompatibility = classifyWorkflowCompatibility(await getWorkflowCompatibilityEvidence(runner));
    const installationClass = classificationResult.rows[0]?.currentFork ? 'current-fork' : 'original-official';
    const officialNames = Object.keys(officialMigrations).toSorted();
    if (officialNames.some((name) => classifyMigration(name) !== 'upstream')) {
      throw new Error('Official migration provider exposed a non-upstream migration');
    }
    const appliedOfficial = ledger
      .filter(({ classification, name }) => classification === 'upstream' || name === LEGACY_WORKFLOW_MIGRATION)
      .map(({ name }) => normalizeWorkflowMigrationForOfficialOrder(name));
    const officialLedgerOrder = validateOfficialMigrationLedgerOrder(appliedOfficial, officialNames);

    const activeWritesResult = await sql<{ count: number }>`
      SELECT count(*)::int AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND backend_xid IS NOT NULL
    `.execute(runner);
    const checksumResult = await sql<{
      applicableCount: number;
      applicableDigest: string;
      invalidCount: number;
      sidecarCount: number;
      sidecarDigest: string;
    }>`
      SELECT
        count(asset.id)::int AS "applicableCount",
        encode(sha256(convert_to(coalesce(string_agg(asset.id::text, E'\n' ORDER BY asset.id::text), ''), 'UTF8')), 'hex') AS "applicableDigest",
        count(checksum."assetId")::int AS "sidecarCount",
        encode(sha256(convert_to(coalesce(string_agg(checksum."assetId"::text, E'\n' ORDER BY checksum."assetId"::text), ''), 'UTF8')), 'hex') AS "sidecarDigest",
        count(*) FILTER (WHERE
          checksum."assetId" IS NULL
          OR checksum.sha1 IS NULL OR octet_length(checksum.sha1) <> 20
          OR checksum.sha256 IS NULL OR octet_length(checksum.sha256) <> 32
          OR asset.checksum IS NULL
          OR asset."checksumAlgorithm" <> 'sha1'
          OR asset.checksum <> checksum.sha1
        )::int AS "invalidCount"
      FROM public.asset asset
      LEFT JOIN immich_fork.asset_checksum checksum ON checksum."assetId" = asset.id
    `.execute(runner);
    const mappingResult = await sql<{
      mappingCount: number;
      mappingDigest: string;
      normalizedCount: number;
      normalizedDigest: string;
      unsafeCount: number;
    }>`
      SELECT
        count(asset.id)::int AS "normalizedCount",
        encode(sha256(convert_to(coalesce(string_agg(asset.id::text || ':' || asset."originalPath", E'\n' ORDER BY asset.id::text), ''), 'UTF8')), 'hex') AS "normalizedDigest",
        count(mapping."assetId")::int AS "mappingCount",
        encode(sha256(convert_to(coalesce(string_agg(mapping."assetId"::text || ':' || mapping."upstreamPath", E'\n' ORDER BY mapping."assetId"::text), ''), 'UTF8')), 'hex') AS "mappingDigest",
        count(*) FILTER (
          WHERE mapping."assetId" IS NULL
            OR mapping."upstreamPath" IS NULL
            OR mapping."upstreamPath" <> asset."originalPath"
        )::int AS "unsafeCount"
      FROM public.asset asset
      LEFT JOIN immich_fork.asset_physical_file mapping ON mapping."assetId" = asset.id
    `.execute(runner);
    const publicPhysicalReferenceResult =
      installationClass === 'current-fork'
        ? await sql<{ count: number }>`
            SELECT (
              (SELECT count(*) FROM public.asset WHERE "physicalOriginalFileId" IS NOT NULL)
              + (SELECT count(*) FROM public.asset_file WHERE "physicalFileId" IS NOT NULL)
            )::int AS count
          `.execute(runner)
        : { rows: [{ count: 0 }] };
    const reservationResult = await sql<{ count: number }>`
      SELECT count(*)::int AS count FROM immich_fork.asset_storage_reservation
    `.execute(runner);
    const storageVerificationResult = checkpoint
      ? await sql<{
          runId: string;
          databaseBackupId: string;
          mediaSnapshotId: string;
          assetCount: number;
          aggregateDigest: string;
          completedAt: Date | string;
          failureCount: number;
          verifiedCount: number;
        }>`
          SELECT id AS "runId", "databaseBackupId", "snapshotId" AS "mediaSnapshotId",
            "applicableAssetCount"::int AS "assetCount", "aggregateDigest", "completedAt",
            "failureCount"::int AS "failureCount", "verifiedCount"::int AS "verifiedCount"
          FROM immich_fork.cutover_verification_run
          WHERE "databaseBackupId" = ${checkpoint.databaseBackupId}
            AND "snapshotId" = ${checkpoint.mediaSnapshotId}
            AND status = 'completed'
          ORDER BY "completedAt" DESC, id DESC LIMIT 1
        `.execute(runner)
      : { rows: [] };
    const storageVerificationRow = storageVerificationResult.rows[0];
    const storageEvidenceResult = storageVerificationRow
      ? await sql<StorageVerificationEvidence>`
          SELECT "assetId", path, size::float8 AS size, sha1, sha256, device::text, inode::text, links
          FROM immich_fork.cutover_verification_asset
          WHERE "runId" = ${storageVerificationRow.runId}::uuid AND status = 'verified'
          ORDER BY "assetId"
        `.execute(runner)
      : { rows: [] };
    const storageRootDriftResult = storageVerificationRow
      ? await sql<{ count: number }>`
          SELECT count(*)::int AS count
          FROM immich_fork.cutover_verification_asset verification
          LEFT JOIN public.asset asset ON asset.id = verification."assetId"
          LEFT JOIN public.library library ON library.id = asset."libraryId"
          WHERE verification."runId" = ${storageVerificationRow.runId}::uuid
            AND (
              asset.id IS NULL
              OR verification.path IS DISTINCT FROM asset."originalPath"
              OR verification."approvedRoots" IS DISTINCT FROM
                ARRAY[${StorageCore.getMediaLocation()}] || coalesce(library."importPaths", ARRAY[]::text[])
            )
        `.execute(runner)
      : { rows: [] };

    const actualCatalog = await getCatalogEvidence(runner);
    const expectedCatalog = expectedCatalogFor(installationClass);
    const catalogDiff = compareCatalogs(expectedCatalog, actualCatalog, INERT_LEGACY_CATALOG_ALLOWLIST);
    // An original-official installation is a byte-exact certified-tag database,
    // so it must match the exact certified-tag ledger — which does not contain the
    // post-certified upstream migrations the fork bundles.
    const exactOriginalOfficialLedger =
      ledger.length === CERTIFIED_TAG_MIGRATIONS.length &&
      ledger.every(
        ({ classification, name }, index) => classification === 'upstream' && name === CERTIFIED_TAG_MIGRATIONS[index],
      );
    const migrationOrderValid =
      installationClass === 'current-fork'
        ? officialLedgerOrder.valid
        : exactOriginalOfficialLedger && catalogDiff.clean;
    const forkMigrations = forkLedgerResult.rows.map(({ name }) => name);
    const cutoverAuditResult = await sql<{ present: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM immich_fork.migration_audit
        WHERE name = 'fork-schema-cutover' AND phase = 'official-cutover' AND status = 'applied'
      ) AS present
    `.execute(runner);
    const forkLedgerValid =
      forkMigrations.length === expectedCatalog.forkMigrations.length &&
      forkMigrations.every((name, index) => expectedCatalog.forkMigrations[index] === name) &&
      (state.schemaVersion !== '2' || cutoverAuditResult.rows[0]?.present);
    const tableEvidence: ForkSchemaCutoverEvidence['tableEvidence'] = [];
    for (const { identity: table } of expectedCatalog.tables) {
      const [schema, name] = table.split('.', 2);
      const identifier = `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
      const result = await sql
        .raw<{ count: number; digest: string }>(
          String.raw`
        SELECT count(*)::int AS count,
          md5(coalesce(string_agg(row_data, E'\n' ORDER BY row_data), '')) AS digest
        FROM (SELECT row_to_json(t)::text AS row_data FROM ${identifier} t) rows
      `,
        )
        .execute(runner);
      tableEvidence.push({ table, count: result.rows[0]?.count ?? 0, digest: result.rows[0]?.digest ?? '' });
    }

    const backfills = backfillResult.rows.map((row) => ({
      ...row,
      processed: Number(row.processed),
      remaining: Number(row.remaining),
    }));
    const requiredKinds = new Set<string>(BACKFILL_KINDS);
    const actualKinds = new Set(backfills.map(({ kind }) => kind));
    const backfillKindsValid =
      actualKinds.size === requiredKinds.size && [...requiredKinds].every((kind) => actualKinds.has(kind));
    const checksum = checksumResult.rows[0] ?? {
      applicableCount: 0,
      applicableDigest: '',
      invalidCount: 1,
      sidecarCount: 0,
      sidecarDigest: '',
    };
    const checksumCoverage = {
      ...checksum,
      valid:
        checksum.invalidCount === 0 &&
        checksum.applicableCount === checksum.sidecarCount &&
        checksum.applicableDigest === checksum.sidecarDigest,
    };
    const mappingResultRow = mappingResult.rows[0] ?? {
      mappingCount: 0,
      mappingDigest: '',
      normalizedCount: 0,
      normalizedDigest: '',
      unsafeCount: 1,
    };
    const mapping = {
      ...mappingResultRow,
      unsafeCount: mappingResultRow.unsafeCount + (publicPhysicalReferenceResult.rows[0]?.count ?? 0),
    };
    const mappingCoverage = {
      ...mapping,
      valid:
        mapping.unsafeCount === 0 &&
        mapping.normalizedCount === mapping.mappingCount &&
        mapping.normalizedDigest === mapping.mappingDigest,
    };
    return {
      activeWrites: activeWritesResult.rows[0]?.count ?? 0,
      backfills,
      backfillKindsValid,
      catalogDiff,
      checksumCoverage,
      checksumFailures: checksum.invalidCount,
      forkLedgerValid,
      forkMigrations,
      installationClass,
      ledger,
      maintenanceMode: maintenanceResult.rows[0]?.maintenanceMode ?? false,
      mappingCoverage,
      migrationOrderValid,
      officialPendingMigrations:
        installationClass === 'current-fork' && officialLedgerOrder.valid ? officialLedgerOrder.pending : [],
      state,
      storageReservations: reservationResult.rows[0]?.count ?? 0,
      storageVerification: storageVerificationRow
        ? {
            ...storageVerificationRow,
            completedAt: new Date(storageVerificationRow.completedAt).toISOString(),
            evidenceAggregateDigest: canonicalStorageVerificationDigest(storageEvidenceResult.rows),
            evidenceAssetCount: storageEvidenceResult.rows.length,
            rootDriftCount: storageRootDriftResult.rows[0]?.count ?? 0,
          }
        : null,
      tableEvidence,
      unsafePhysicalMappings: mapping.unsafeCount,
      workflowCompatibility,
    };
  }

  async commitForkSchemaCutover(
    reportDigest: string,
    verify: (transaction: Kysely<DB>) => Promise<ForkSchemaCutoverEvidence | void>,
  ): Promise<ForkSchemaCutoverCheckpoint> {
    return this.db
      .transaction()
      .setIsolationLevel('serializable')
      .execute(async (transaction) => {
        const classification = await sql<{ currentFork: boolean }>`
          SELECT to_regclass('public.physical_file') IS NOT NULL AS "currentFork"
        `.execute(transaction);
        const installationClass: ForkSchemaCutoverEvidence['installationClass'] = classification.rows[0]?.currentFork
          ? 'current-fork'
          : 'original-official';
        const lockTables = getCatalogTableLocks(expectedCatalogFor(installationClass))
          .map((table) =>
            table
              .split('.')
              .map((segment) => quoteIdentifier(segment))
              .join('.'),
          )
          .join(', ');
        await sql.raw(`LOCK TABLE ${lockTables} IN SHARE ROW EXCLUSIVE MODE`).execute(transaction);
        const verifiedEvidence = await verify(transaction);
        if (verifiedEvidence && verifiedEvidence.installationClass !== installationClass) {
          throw new Error('Fork schema cutover installation classification changed under lock');
        }

        const workflowCompatibility = classifyWorkflowCompatibility(
          await getWorkflowCompatibilityEvidence(transaction),
        );
        await aliasLegacyWorkflowMigration(transaction, workflowCompatibility, reportDigest);
        await this.afterForkSchemaCutoverStage(transaction, 'workflow-alias');

        const legacy = await sql<{ name: string; timestamp: string }>`
          SELECT name, timestamp
          FROM public.kysely_migrations
          WHERE name = ANY(${[...GENERIC_LEGACY_FORK_MIGRATIONS]})
          ORDER BY name
        `.execute(transaction);
        for (const row of legacy.rows) {
          await sql`
            INSERT INTO immich_fork.migration_audit (name, phase, status, details, "completedAt")
            VALUES (
              ${row.name},
              'ledger-cutover',
              'applied',
              jsonb_build_object(
                'classification', 'legacy-fork',
                'originalTimestamp', ${row.timestamp}::text,
                'reportDigest', ${reportDigest}::text
              ),
              now()
            )
          `.execute(transaction);
        }
        await this.afterForkSchemaCutoverStage(transaction, 'legacy-ledger-audit');
        await sql`DELETE FROM public.kysely_migrations WHERE name = ANY(${[
          ...GENERIC_LEGACY_FORK_MIGRATIONS,
        ]})`.execute(transaction);
        await this.afterForkSchemaCutoverStage(transaction, 'legacy-ledger-delete');
        const legacyTriggers = await sql<{ name: string; schemaName: string; tableName: string }>`
          SELECT trigger.tgname AS name, namespace.nspname AS "schemaName", relation.relname AS "tableName"
          FROM pg_trigger trigger
          JOIN pg_class relation ON relation.oid = trigger.tgrelid
          JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
          WHERE NOT trigger.tgisinternal AND namespace.nspname = 'public'
        `.execute(transaction);
        for (const trigger of legacyTriggers.rows) {
          if (!LEGACY_TRIGGER_NAMES.has(trigger.name)) {
            continue;
          }
          await sql
            .raw(
              `ALTER TABLE ${quoteIdentifier(trigger.schemaName)}.${quoteIdentifier(trigger.tableName)} DISABLE TRIGGER ${quoteIdentifier(trigger.name)}`,
            )
            .execute(transaction);
        }
        await sql`DELETE FROM public.migration_overrides WHERE name = ANY(${[
          ...LEGACY_MIGRATION_OVERRIDE_NAMES,
        ]})`.execute(transaction);
        await this.afterForkSchemaCutoverStage(transaction, 'legacy-artifact-shutdown');

        // Post-certified upstream residue: migrations the fork applied on top
        // of the certified official tag. Their ledger rows would crash the
        // certified container's migrator and their effects drift from the
        // certified catalog, so revert each one exactly (registered reversal),
        // audit it, and remove its ledger row. The fork return re-applies them
        // through the normal official provider. Fail closed on any residue
        // without a registered reversal.
        const residue = await sql<{ name: string; timestamp: string }>`
          SELECT name, timestamp
          FROM public.kysely_migrations
          WHERE name = ANY(${[...POST_CERTIFIED_UPSTREAM_MIGRATIONS]})
          ORDER BY name
        `.execute(transaction);
        const irreversible = irreversiblePostCertifiedMigrations(residue.rows.map(({ name }) => name));
        if (irreversible.length > 0) {
          throw new Error(`Fork schema cutover cannot revert post-certified migration(s): ${irreversible.join(', ')}`);
        }
        for (const row of residue.rows.toReversed()) {
          await REVERSIBLE_POST_CERTIFIED_MIGRATIONS.get(row.name)!.revert(transaction);
          await sql`
            INSERT INTO immich_fork.migration_audit (name, phase, status, details, "completedAt")
            VALUES (
              ${row.name},
              'ledger-cutover',
              'applied',
              jsonb_build_object(
                'classification', 'post-certified-upstream',
                'originalTimestamp', ${row.timestamp}::text,
                'reportDigest', ${reportDigest}::text
              ),
              now()
            )
          `.execute(transaction);
        }
        await sql`DELETE FROM public.kysely_migrations WHERE name = ANY(${[
          ...POST_CERTIFIED_UPSTREAM_MIGRATIONS,
        ]})`.execute(transaction);
        await this.afterForkSchemaCutoverStage(transaction, 'post-certified-residue');

        const committedAt = new Date().toISOString();
        const state = await sql<{ id: number }>`
          UPDATE immich_fork.state
          SET active = false,
              phase = 'inactive',
              "schemaVersion" = '2',
              "checkpointStartedAt" = coalesce("checkpointStartedAt", now()),
              "checkpointCompletedAt" = now(),
              "updatedAt" = now()
          WHERE id = 1 AND phase = 'ready'
          RETURNING id
        `.execute(transaction);
        if (!state.rows[0]) {
          throw new Error('Fork schema cutover requires ready phase');
        }
        await this.afterForkSchemaCutoverStage(transaction, 'state-transition');
        const storage = verifiedEvidence?.storageVerification;
        await sql`
          INSERT INTO immich_fork.migration_audit (name, phase, status, details, "completedAt")
          VALUES (
            'fork-schema-cutover',
            'official-cutover',
            'applied',
            jsonb_build_object(
              'reportDigest', ${reportDigest}::text,
              'installationClass', ${installationClass}::text,
              'databaseBackupId', ${storage?.databaseBackupId ?? null}::text,
              'mediaSnapshotId', ${storage?.mediaSnapshotId ?? null}::text,
              'storageVerificationRunId', ${storage?.runId ?? null}::text,
              'storageVerificationDigest', ${storage?.aggregateDigest ?? null}::text,
              'storageVerificationAssetCount', ${storage?.assetCount ?? null}::int,
              'workflowMode', ${verifiedEvidence?.workflowCompatibility.mode ?? workflowCompatibility.mode}::text,
              'workflowSchemaDigest', ${
                verifiedEvidence?.workflowCompatibility.schemaDigest ?? workflowCompatibility.schemaDigest
              }::text
            ),
            now()
          )
        `.execute(transaction);
        await this.afterForkSchemaCutoverStage(transaction, 'checkpoint-audit');
        await this.finishForkSchemaCutover(transaction);
        return { committedAt, phase: 'inactive', reportDigest, schemaVersion: '2' };
      });
  }

  protected finishForkSchemaCutover(_transaction: Kysely<DB>): Promise<void> {
    return Promise.resolve();
  }

  protected afterForkSchemaCutoverStage(
    _transaction: Kysely<DB>,
    _stage: ForkSchemaCutoverMutationStage,
  ): Promise<void> {
    return Promise.resolve();
  }

  async runForkMigrations(): Promise<void> {
    this.logger.log('Running fork migrations');

    const migrator = new Migrator({
      db: this.db,
      migrationTableSchema: 'immich_fork',
      migrationTableName: 'migrations',
      migrationLockTableName: 'migrations_lock',
      provider: createForkMigrationProvider(join(__dirname, '..', 'fork-schema/migrations')),
    });

    await this.runMigrationSet(migrator, 'fork');
  }

  async detectMigrationMode(): Promise<'legacy' | 'isolated' | 'fresh'> {
    const {
      rows: [ledgers],
    } = await sql<{ forkLedger: string | null; officialLedger: string | null }>`
      SELECT
        to_regclass('public.kysely_migrations')::text AS "officialLedger",
        to_regclass('immich_fork.migrations')::text AS "forkLedger"
    `.execute(this.db);

    let hasLegacyMigrations = false;
    if (ledgers.officialLedger) {
      const { rows } = await sql<{ name: string }>`SELECT name FROM public.kysely_migrations ORDER BY name`.execute(
        this.db,
      );
      for (const { name } of rows) {
        const owner = classifyMigration(name);
        if (owner === 'unknown') {
          throw new Error(`Unknown migration in kysely_migrations: ${name}`);
        }
        hasLegacyMigrations ||= owner === 'legacy-fork';
      }
    }

    if (hasLegacyMigrations) {
      return 'legacy';
    }

    return ledgers.forkLedger ? 'isolated' : 'fresh';
  }

  async migrateFilePaths(sourceFolder: string, targetFolder: string): Promise<void> {
    // remove trailing slashes
    if (sourceFolder.endsWith('/')) {
      sourceFolder = sourceFolder.slice(0, -1);
    }

    if (targetFolder.endsWith('/')) {
      targetFolder = targetFolder.slice(0, -1);
    }

    // escaping regex special characters with a backslash
    const sourceRegex = '^' + sourceFolder.replaceAll(/[-[\]{}()*+?.,\\^$|#\s]/g, String.raw`\$&`);
    const source = sql.raw(`'${sourceRegex}'`);
    const target = sql.lit(targetFolder);

    await this.db.transaction().execute(async (tx) => {
      await tx
        .updateTable('asset')
        .set((eb) => ({
          originalPath: eb.fn('REGEXP_REPLACE', ['originalPath', source, target]),
        }))
        .execute();

      await tx
        .updateTable('asset_file')
        .set((eb) => ({ path: eb.fn('REGEXP_REPLACE', ['path', source, target]) }))
        .execute();

      await tx
        .updateTable('person')
        .set((eb) => ({ thumbnailPath: eb.fn('REGEXP_REPLACE', ['thumbnailPath', source, target]) }))
        .execute();

      await tx
        .updateTable('user')
        .set((eb) => ({ profileImagePath: eb.fn('REGEXP_REPLACE', ['profileImagePath', source, target]) }))
        .execute();
    });
  }

  async withLock<R>(lock: DatabaseLock, callback: () => Promise<R>): Promise<R> {
    let res;
    await this.asyncLock.acquire(DatabaseLock[lock], async () => {
      await this.db.connection().execute(async (connection) => {
        try {
          await this.acquireLock(lock, connection);
          res = await callback();
        } finally {
          await this.releaseLock(lock, connection);
        }
      });
    });

    return res as R;
  }

  tryLock(lock: DatabaseLock): Promise<boolean> {
    return this.db.connection().execute(async (connection) => this.acquireTryLock(lock, connection));
  }

  isBusy(lock: DatabaseLock): boolean {
    return this.asyncLock.isBusy(DatabaseLock[lock]);
  }

  async wait(lock: DatabaseLock): Promise<void> {
    await this.asyncLock.acquire(DatabaseLock[lock], () => {});
  }

  /**
   * Per-asset advisory lock. Serializes concurrent read-modify-write of
   * `asset_metadata` blobs so two jobs (e.g. background NSFW detection and a
   * user review action) can't clobber each other. Uses a single dedicated lock
   * class (the negative number namespace) and the lower 32 bits of the UUID's
   * hashtext for the key, so it doesn't collide with the integer DatabaseLock
   * enum values above.
   *
   * The lock is acquired via `pg_advisory_xact_lock` inside a transaction so
   * it auto-releases on commit/rollback. The transaction object is passed to
   * the callback — callers must do their lock-protected reads/writes through
   * it (otherwise those queries run on different pooled connections and
   * can deadlock once N parallel callers exhaust the pool with held locks).
   * Side effects that don't need to be atomic with the metadata RMW (tag
   * application, job queueing, ML inference) should be performed outside the
   * callback to keep the lock window — and therefore the held connection —
   * as short as possible.
   */
  async withAssetMetadataLock<R>(assetId: string, callback: (kysely: Kysely<DB>) => Promise<R>): Promise<R> {
    return this.db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(-1, hashtext(${assetId})::int)`.execute(trx);
      return callback(trx);
    });
  }

  private async acquireLock(lock: DatabaseLock, connection: Kysely<DB>): Promise<void> {
    await sql`SELECT pg_advisory_lock(${lock})`.execute(connection);
  }

  private async acquireTryLock(lock: DatabaseLock, connection: Kysely<DB>): Promise<boolean> {
    const { rows } = await sql<{
      pg_try_advisory_lock: boolean;
    }>`SELECT pg_try_advisory_lock(${lock})`.execute(connection);
    return rows[0].pg_try_advisory_lock;
  }

  private async releaseLock(lock: DatabaseLock, connection: Kysely<DB>): Promise<void> {
    await sql`SELECT pg_advisory_unlock(${lock})`.execute(connection);
  }

  async revertLastMigration(): Promise<string | undefined> {
    this.logger.debug('Reverting last migration');

    const migrator = this.createMigrator();
    const { error, results } = await migrator.migrateDown();

    for (const result of results ?? []) {
      if (result.status === 'Success') {
        this.logger.log(`Reverted migration "${result.migrationName}"`);
      } else if (result.status === 'Error') {
        this.logger.warn(`Failed to revert migration "${result.migrationName}"`);
      }
    }

    if (error) {
      this.logger.error(`Failed to revert migrations: ${error}`);
      throw error;
    }

    const reverted = results?.find((result) => result.direction === 'Down' && result.status === 'Success');
    if (!reverted) {
      this.logger.debug('No migrations to revert');
      return undefined;
    }

    this.logger.debug('Finished reverting migration');
    return reverted.migrationName;
  }

  // NOTE: `revertSchemaToUpstream` was REMOVED — see commands/index.ts comment.
  // The CLI was broken (empty down() stubs silently corrupted state). For
  // downgrade, use `pg_restore` from a backup taken before installing the fork.

  /**
   * Migration timestamp convention for this fork:
   *
   *   1777xxxxxxxxx and earlier — shared with upstream immich-app/immich
   *   1778xxxxxxxxx to 1779xxxxxxxxx — initial fork migrations (collision risk)
   *   2100xxxxxxxxx and later — fork-only migrations far from the upstream
   *                              namespace, no risk of clashes when merging.
   *
   * Use `2100xxxxxxxxx-` for any new fork migration to avoid the kind of
   * reorder churn that landed `1779400000000-UpdateWorkflowTables.ts`. See the
   * `2100000000010-AddAssetIsNsfwIndex.ts` migration for an example.
   *
   * `allowUnorderedMigrations` must stay enabled for the combined provider:
   * adopting an official-origin database (and upgrading an existing fork
   * database across an upstream sync) applies migrations whose names sort
   * before already-ledgered ones — e.g. `1779806699547-AddPluginTemplates`
   * lands after `2100000000030-AddSha256ChecksumAlgorithm` was applied — and
   * Kysely's ordered mode refuses those as "corrupted migrations".
   */
  private createMigrator(
    provider: MigrationProvider = createLegacyMigrationProvider(join(__dirname, '..', 'schema/migrations')),
  ): Migrator {
    return new Migrator({
      db: this.db,
      migrationLockTableName: 'kysely_migrations_lock',
      allowUnorderedMigrations: true,
      migrationTableName: 'kysely_migrations',
      provider,
    });
  }

  private async runMigrationSet(migrator: Migrator, owner: 'official' | 'fork'): Promise<void> {
    const { error, results } = await migrator.migrateToLatest();

    for (const result of results ?? []) {
      if (result.status === 'Success') {
        this.logger.log(`${owner} migration "${result.migrationName}" succeeded`);
      } else if (result.status === 'Error') {
        this.logger.warn(`${owner} migration "${result.migrationName}" failed`);
      }
    }

    if (error) {
      this.logger.error(`${owner} migrations failed: ${error}`);
      throw error;
    }

    this.logger.log(`Finished running ${owner} migrations`);
  }
}
