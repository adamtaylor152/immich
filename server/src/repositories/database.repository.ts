import { schemaDiff, schemaFromCode, schemaFromDatabase } from '@immich/sql-tools';
import { Injectable } from '@nestjs/common';
import AsyncLock from 'async-lock';
import { Kysely, Migration, Migrator, sql } from 'kysely';
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
import { GenerateSql } from 'src/decorators';
import { DatabaseExtension, DatabaseLock, VectorIndex } from 'src/enum';
import { classifyMigration, LEGACY_FORK_MIGRATIONS } from 'src/fork-schema/migration-manifest';
import {
  createForkMigrationProvider,
  createLegacyMigrationProvider,
  createOfficialMigrationProvider,
} from 'src/fork-schema/migration-provider';
import { ConfigRepository } from 'src/repositories/config.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import 'src/schema'; // make sure all schema definitions are imported for schemaFromCode
import { DB } from 'src/schema';
import { immich_uuid_v7 } from 'src/schema/functions';
import { ExtensionVersion, VectorExtension } from 'src/types';
import { vectorIndexQuery } from 'src/utils/database';
import { isValidInteger } from 'src/validation';

export let cachedVectorExtension: VectorExtension | undefined;

const CLIP_TABLES = ['smart_search', 'smart_search_description', 'asset_video_duplicate_frame'] as const;

const CUTOVER_EVIDENCE_TABLES = [
  'public.user',
  'public.asset',
  'public.album',
  'public.asset_face',
  'public.tag',
  'public.shared_link',
  'immich_fork.asset_privacy',
  'immich_fork.album_metadata',
  'immich_fork.album_closure',
  'immich_fork.asset_enrichment',
  'immich_fork.config',
  'immich_fork.smart_album_rule',
  'immich_fork.smart_album_match',
  'immich_fork.smart_album_exclusion',
  'immich_fork.asset_health',
  'immich_fork.asset_best_photo_score',
  'immich_fork.asset_video_duplicate_frame',
  'immich_fork.asset_checksum',
  'immich_fork.physical_file',
  'immich_fork.asset_physical_file',
] as const;

const CUTOVER_LOCK_TABLES = [
  'public.kysely_migrations',
  'public.system_metadata',
  'public.asset_file',
  'immich_fork.state',
  'immich_fork.migrations',
  'immich_fork.migration_audit',
  'immich_fork.backfill_progress',
  'immich_fork.asset_storage_reservation',
  ...CUTOVER_EVIDENCE_TABLES,
] as const;

const LEGACY_TRIGGER_NAMES = new Set([
  'physical_file_updatedAt',
  'asset_video_duplicate_frame_updatedAt',
  'asset_health_updatedAt',
  'asset_health_candidate_updatedAt',
  'album_parent_cycle_check_trigger',
  'workflow_updatedAt',
]);

const LEGACY_RESIDUE_TABLES = new Set([
  'physical_file',
  'asset_video_duplicate_frame',
  'asset_health_run',
  'asset_health',
  'asset_health_candidate',
  'asset_best_photo_score',
  'smart_album',
  'smart_album_asset',
  'smart_album_exclusion',
  'album_closure',
]);

const LEGACY_RESIDUE_COLUMNS = new Set([
  'asset.physicalOriginalFileId',
  'asset.is_nsfw',
  'asset_file.physicalFileId',
  'album.parentId',
  'album.icon',
  'album.sortOrder',
]);

const LEGACY_RESIDUE_OVERRIDES = new Set([
  'trigger_physical_file_updatedAt',
  'trigger_asset_video_duplicate_frame_updatedAt',
  'trigger_asset_health_updatedAt',
  'trigger_asset_health_candidate_updatedAt',
  'trigger_workflow_updatedAt',
  'index_idx_asset_exif_description_trigram',
  'index_album_parentId_idx',
  'index_album_parent_sort_idx',
  'index_album_root_sort_idx',
  'function_album_parent_cycle_check',
  'trigger_album_parent_cycle_check_trigger',
  'index_idx_asset_is_nsfw',
]);

export type ForkSchemaCutoverEvidence = {
  activeWrites: number;
  backfills: Array<{
    digest: string | null;
    kind: string;
    lastError: string | null;
    processed: number;
    remaining: number;
  }>;
  checksumFailures: number;
  forkMigrations: string[];
  ledger: Array<{
    classification: 'legacy-fork' | 'unknown' | 'upstream';
    name: string;
    timestamp: string;
  }>;
  maintenanceMode: boolean;
  migrationOrderValid: boolean;
  officialPendingMigrations: string[];
  schemaResidue: Array<{
    allowed: boolean;
    kind: 'column' | 'enum-value' | 'function' | 'migration-override' | 'table' | 'trigger';
    name: string;
  }>;
  state: {
    active: boolean;
    phase: 'active' | 'dual-write' | 'failed' | 'inactive' | 'legacy' | 'ready';
    schemaVersion: string;
    upstreamVersion: string;
  };
  storageReservations: number;
  tableEvidence: Array<{ count: number; digest: string; table: string }>;
  unsafePhysicalMappings: number;
};

export type ForkSchemaCutoverCheckpoint = {
  committedAt: string;
  phase: 'ready';
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
export class DatabaseRepository {
  private readonly asyncLock = new AsyncLock();

  constructor(
    @InjectKysely() private db: Kysely<DB>,
    private logger: LoggingRepository,
    private configRepository: ConfigRepository,
  ) {
    this.logger.setContext(DatabaseRepository.name);
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
              } else {
                probes[indexName] = this.targetProbeCount(lists);
              }
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
      if (!rows.some((row) => row.columnName === 'embedding')) {
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
    if (!isValidInteger(dimSize, { min: 1, max: 2 ** 16 })) {
      this.logger.warn(`Could not retrieve dimension size of column '${column}' in table '${table}', assuming 512`);
      return 512;
    }
    return dimSize;
  }

  async setDimensionSize(dimSize: number): Promise<void> {
    if (!isValidInteger(dimSize, { min: 1, max: 2 ** 16 })) {
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
    } else if (count < 2_048_000) {
      return 1 << (32 - Math.clz32(count / 1000));
    } else {
      return 1 << (33 - Math.clz32(Math.sqrt(count)));
    }
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

    const migrator = this.createMigrator();

    const { error, results } = await migrator.migrateToLatest();

    for (const result of results ?? []) {
      if (result.status === 'Success') {
        this.logger.log(`Migration "${result.migrationName}" succeeded`);
      }

      if (result.status === 'Error') {
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

    const migrator = new Migrator({
      db: this.db,
      migrationLockTableName: 'kysely_migrations_lock',
      allowUnorderedMigrations: this.configRepository.isDev(),
      migrationTableName: 'kysely_migrations',
      // eslint-disable-next-line unicorn/prefer-module
      provider: createOfficialMigrationProvider(join(__dirname, '..', 'schema/migrations')),
    });

    await this.runMigrationSet(migrator, 'official');
  }

  protected async loadOfficialMigrations(): Promise<Record<string, Migration>> {
    // Keep cutover on the same filtered provider used by normal startup. This
    // provider refuses unknown files and cannot expose fork migrations.
    // eslint-disable-next-line unicorn/prefer-module
    return createOfficialMigrationProvider(join(__dirname, '..', 'schema/migrations')).getMigrations();
  }

  async getForkSchemaCutoverEvidence(runner: Kysely<DB> = this.db): Promise<ForkSchemaCutoverEvidence> {
    const [officialMigrations, ledgerResult, forkLedgerResult, stateResult, backfillResult, maintenanceResult] =
      await Promise.all([
        this.loadOfficialMigrations(),
        sql<{ name: string; timestamp: string }>`
          SELECT name, timestamp FROM public.kysely_migrations ORDER BY timestamp, name
        `.execute(runner),
        sql<{ name: string }>`SELECT name FROM immich_fork.migrations ORDER BY name`.execute(runner),
        sql<ForkSchemaCutoverEvidence['state']>`
          SELECT active, phase, "schemaVersion", "upstreamVersion" FROM immich_fork.state WHERE id = 1
        `.execute(runner),
        sql<{
          digest: string | null;
          kind: string;
          lastError: string | null;
          processed: string;
          remaining: string;
        }>`
          SELECT kind, processed, remaining, digest, "lastError"
          FROM immich_fork.backfill_progress
          ORDER BY kind
        `.execute(runner),
        sql<{ maintenanceMode: boolean }>`
          SELECT coalesce((value->>'isMaintenanceMode')::boolean, false) AS "maintenanceMode"
          FROM public.system_metadata
          WHERE key = 'maintenance-mode'
        `.execute(runner),
      ]);

    const state = stateResult.rows[0];
    if (!state) {
      throw new Error('Fork schema state is not initialized');
    }
    const ledger = ledgerResult.rows.map((row) => ({ ...row, classification: classifyMigration(row.name) }));
    const officialNames = Object.keys(officialMigrations).toSorted();
    if (officialNames.some((name) => classifyMigration(name) !== 'upstream')) {
      throw new Error('Official migration provider exposed a non-upstream migration');
    }
    const appliedOfficial = ledger
      .filter(({ classification }) => classification === 'upstream')
      .map(({ name }) => name);
    const migrationOrderValid = appliedOfficial.every((name, index) => officialNames[index] === name);

    const activeWritesResult = await sql<{ count: number }>`
      SELECT count(*)::int AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND backend_xid IS NOT NULL
    `.execute(runner);
    const checksumResult = await sql<{ count: number }>`
      SELECT count(*)::int AS count
      FROM public.asset a
      LEFT JOIN immich_fork.asset_checksum c ON c."assetId" = a.id
      WHERE a."checksumAlgorithm" = 'sha256'
         OR (c."assetId" IS NOT NULL AND (a.checksum <> c.sha1 OR a."checksumAlgorithm" <> 'sha1'))
    `.execute(runner);
    const unsafeMappingResult = await sql<{ count: number }>`
      SELECT (
        (SELECT count(*) FROM public.asset WHERE "physicalOriginalFileId" IS NOT NULL)
        + (SELECT count(*) FROM public.asset_file WHERE "physicalFileId" IS NOT NULL)
        + (
          SELECT count(*)
          FROM immich_fork.asset_physical_file mapping
          LEFT JOIN public.asset asset ON asset.id = mapping."assetId"
          LEFT JOIN immich_fork.asset_checksum checksum ON checksum."assetId" = mapping."assetId"
          WHERE asset.id IS NULL OR checksum."assetId" IS NULL OR asset."originalPath" <> mapping."upstreamPath"
        )
      )::int AS count
    `.execute(runner);
    const reservationResult = await sql<{ count: number }>`
      SELECT count(*)::int AS count FROM immich_fork.asset_storage_reservation
    `.execute(runner);

    const tableEvidence: ForkSchemaCutoverEvidence['tableEvidence'] = [];
    for (const table of CUTOVER_EVIDENCE_TABLES) {
      const [schema, name] = table.split('.');
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

    const schemaResidue: ForkSchemaCutoverEvidence['schemaResidue'] = [];
    const residueTables = await sql<{ name: string }>`
      SELECT table_name AS name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND (
          table_name LIKE 'physical_file%'
          OR table_name LIKE 'asset_video_duplicate_frame%'
          OR table_name LIKE 'asset_health%'
          OR table_name LIKE 'asset_best_photo%'
          OR table_name LIKE 'smart_album%'
          OR table_name LIKE 'album_closure%'
        )
      ORDER BY table_name
    `.execute(runner);
    for (const { name } of residueTables.rows) {
      schemaResidue.push({ allowed: LEGACY_RESIDUE_TABLES.has(name), kind: 'table', name: `public.${name}` });
    }
    const residueColumns = await sql<{ columnName: string; tableName: string }>`
      SELECT table_name AS "tableName", column_name AS "columnName"
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          (table_name = 'asset' AND (column_name LIKE 'physical%' OR column_name LIKE 'is_nsfw%'))
          OR (table_name = 'asset_file' AND column_name LIKE 'physical%')
          OR (table_name = 'album' AND (column_name LIKE 'parent%' OR column_name LIKE 'icon%' OR column_name LIKE 'sortOrder%'))
        )
      ORDER BY table_name, column_name
    `.execute(runner);
    for (const { columnName, tableName } of residueColumns.rows) {
      const key = `${tableName}.${columnName}`;
      schemaResidue.push({ allowed: LEGACY_RESIDUE_COLUMNS.has(key), kind: 'column', name: `public.${key}` });
    }
    const triggers = await sql<{ name: string; tableName: string }>`
      SELECT trigger_name AS name, event_object_table AS "tableName"
      FROM information_schema.triggers
      WHERE trigger_schema = 'public'
        AND (
          trigger_name LIKE 'physical_file%'
          OR trigger_name LIKE 'asset_video_duplicate_frame%'
          OR trigger_name LIKE 'asset_health%'
          OR trigger_name LIKE 'album_parent_cycle%'
          OR trigger_name LIKE 'workflow%'
          OR event_object_table LIKE 'physical_file%'
          OR event_object_table LIKE 'asset_video_duplicate_frame%'
          OR event_object_table LIKE 'asset_health%'
        )
      ORDER BY event_object_table, trigger_name
    `.execute(runner);
    for (const trigger of triggers.rows) {
      schemaResidue.push({
        allowed: LEGACY_TRIGGER_NAMES.has(trigger.name),
        kind: 'trigger',
        name: `public.${trigger.tableName}.${trigger.name}`,
      });
    }
    const functions = await sql<{ name: string }>`
      SELECT routine_name AS name
      FROM information_schema.routines
      WHERE routine_schema = 'public' AND routine_name LIKE 'album_parent_cycle%'
      ORDER BY routine_name
    `.execute(runner);
    for (const { name } of functions.rows) {
      schemaResidue.push({ allowed: name === 'album_parent_cycle_check', kind: 'function', name: `public.${name}` });
    }
    const enumValues = await sql<{ name: string }>`
      SELECT value.enumlabel AS name
      FROM pg_enum value
      JOIN pg_type type ON type.oid = value.enumtypid
      WHERE type.typname = 'asset_checksum_algorithm_enum' AND value.enumlabel NOT IN ('sha1', 'sha1-path')
      ORDER BY value.enumsortorder
    `.execute(runner);
    for (const { name } of enumValues.rows) {
      schemaResidue.push({
        allowed: name === 'sha256',
        kind: 'enum-value',
        name: `asset_checksum_algorithm_enum.${name}`,
      });
    }
    const overrides = await sql<{ name: string }>`
      SELECT name
      FROM public.migration_overrides
      WHERE name LIKE '%physical_file%'
         OR name LIKE '%asset_video_duplicate_frame%'
         OR name LIKE '%asset_health%'
         OR name LIKE '%asset_best_photo%'
         OR name LIKE '%smart_album%'
         OR name LIKE '%album_parent%'
         OR name LIKE '%asset_is_nsfw%'
         OR name LIKE '%asset_exif_description%'
         OR name LIKE '%workflow%'
      ORDER BY name
    `.execute(runner);
    for (const { name } of overrides.rows) {
      schemaResidue.push({ allowed: LEGACY_RESIDUE_OVERRIDES.has(name), kind: 'migration-override', name });
    }

    return {
      activeWrites: activeWritesResult.rows[0]?.count ?? 0,
      backfills: backfillResult.rows.map((row) => ({
        ...row,
        processed: Number(row.processed),
        remaining: Number(row.remaining),
      })),
      checksumFailures: checksumResult.rows[0]?.count ?? 0,
      forkMigrations: forkLedgerResult.rows.map(({ name }) => name),
      ledger,
      maintenanceMode: maintenanceResult.rows[0]?.maintenanceMode ?? false,
      migrationOrderValid,
      officialPendingMigrations: migrationOrderValid ? officialNames.slice(appliedOfficial.length) : [],
      schemaResidue,
      state,
      storageReservations: reservationResult.rows[0]?.count ?? 0,
      tableEvidence,
      unsafePhysicalMappings: unsafeMappingResult.rows[0]?.count ?? 0,
    };
  }

  async commitForkSchemaCutover(
    reportDigest: string,
    verify: (transaction: Kysely<DB>) => Promise<void>,
  ): Promise<ForkSchemaCutoverCheckpoint> {
    return this.db
      .transaction()
      .setIsolationLevel('serializable')
      .execute(async (transaction) => {
        const lockTables = [...new Set(CUTOVER_LOCK_TABLES)]
          .map((table) =>
            table
              .split('.')
              .map((segment) => quoteIdentifier(segment))
              .join('.'),
          )
          .join(', ');
        await sql.raw(`LOCK TABLE ${lockTables} IN SHARE ROW EXCLUSIVE MODE`).execute(transaction);
        await verify(transaction);

        const legacy = await sql<{ name: string; timestamp: string }>`
          SELECT name, timestamp
          FROM public.kysely_migrations
          WHERE name = ANY(${[...LEGACY_FORK_MIGRATIONS]})
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
        await sql`DELETE FROM public.kysely_migrations WHERE name = ANY(${[...LEGACY_FORK_MIGRATIONS]})`.execute(
          transaction,
        );
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

        const committedAt = new Date().toISOString();
        await sql`
          UPDATE immich_fork.state
          SET active = false,
              phase = 'ready',
              "schemaVersion" = '2',
              "checkpointStartedAt" = coalesce("checkpointStartedAt", now()),
              "checkpointCompletedAt" = now(),
              "updatedAt" = now()
          WHERE id = 1
        `.execute(transaction);
        await this.finishForkSchemaCutover(transaction);
        return { committedAt, phase: 'ready', reportDigest, schemaVersion: '2' };
      });
  }

  protected finishForkSchemaCutover(_transaction: Kysely<DB>): Promise<void> {
    return Promise.resolve();
  }

  async runForkMigrations(): Promise<void> {
    this.logger.log('Running fork migrations');

    const migrator = new Migrator({
      db: this.db,
      migrationTableSchema: 'immich_fork',
      migrationTableName: 'migrations',
      migrationLockTableName: 'migrations_lock',
      // eslint-disable-next-line unicorn/prefer-module
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
      }

      if (result.status === 'Error') {
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
   * `allowUnorderedMigrations` is enabled in dev so reordering is forgiving;
   * production migrations should still be timestamp-ordered for clarity.
   */
  private createMigrator(): Migrator {
    return new Migrator({
      db: this.db,
      migrationLockTableName: 'kysely_migrations_lock',
      allowUnorderedMigrations: this.configRepository.isDev(),
      migrationTableName: 'kysely_migrations',
      // eslint-disable-next-line unicorn/prefer-module
      provider: createLegacyMigrationProvider(join(__dirname, '..', 'schema/migrations')),
    });
  }

  private async runMigrationSet(migrator: Migrator, owner: 'official' | 'fork'): Promise<void> {
    const { error, results } = await migrator.migrateToLatest();

    for (const result of results ?? []) {
      if (result.status === 'Success') {
        this.logger.log(`${owner} migration "${result.migrationName}" succeeded`);
      }

      if (result.status === 'Error') {
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
