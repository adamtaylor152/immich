import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { createHash } from 'node:crypto';
import supportedVersions from 'src/fork-schema/supported-versions.json';
import type { ForkSchemaPhase } from 'src/repositories/fork-schema.repository';
import { DB } from 'src/schema';

export type ForkReturnEvidence = {
  active: boolean;
  appliedCheckpointId: string;
  maintenanceMode: boolean;
  phase: ForkSchemaPhase;
  schemaVersion: string;
  supportedTag: 'v3.0.3';
  officialLedgerDigest: string;
  reconciliationStatus: 'not-started' | 'running' | 'failed' | 'complete';
};

export type OfficialHandoffCheckpoint = {
  completedAt: string;
  databaseBackupId: string | null;
  id: string;
  mediaSnapshotId: string | null;
  reportDigest: string;
  storageVerificationDigest: string | null;
  storageVerificationRunId: string | null;
};

export type OrphanArchiveSummary = { archived: number; deleted: number };

type CheckpointDetails = {
  databaseBackupId?: string | null;
  mediaSnapshotId?: string | null;
  reportDigest?: string;
  storageVerificationDigest?: string | null;
  storageVerificationRunId?: string | null;
};

const CERTIFIED_TAG = 'v3.0.3' as const;

export const assertExactCertifiedReturnLedger = (actual: readonly string[], expected: readonly string[]): 'v3.0.3' => {
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    throw new Error('Fork return requires the exact certified v3.0.3 ledger');
  }
  return CERTIFIED_TAG;
};

const officialLedgerDigest = (names: readonly string[]): string =>
  createHash('sha256').update(names.join('\n')).digest('hex');

const ORPHAN_FAMILIES = [
  [
    'smart_album_match',
    'immich_fork.smart_album_match',
    `candidate."smartAlbumId"::text || ':' || candidate."assetId"::text`,
    'NOT EXISTS (SELECT 1 FROM public.album album WHERE album.id = candidate."smartAlbumId") OR NOT EXISTS (SELECT 1 FROM public.asset asset WHERE asset.id = candidate."assetId")',
  ],
  [
    'smart_album_exclusion',
    'immich_fork.smart_album_exclusion',
    `candidate."smartAlbumId"::text || ':' || candidate."assetId"::text`,
    'NOT EXISTS (SELECT 1 FROM public.album album WHERE album.id = candidate."smartAlbumId") OR NOT EXISTS (SELECT 1 FROM public.asset asset WHERE asset.id = candidate."assetId")',
  ],
  [
    'smart_album_rule',
    'immich_fork.smart_album_rule',
    'candidate.id::text',
    'NOT EXISTS (SELECT 1 FROM public.album album WHERE album.id = candidate."albumId")',
  ],
  [
    'album_closure',
    'immich_fork.album_closure',
    `candidate."ancestorId"::text || ':' || candidate."descendantId"::text`,
    'NOT EXISTS (SELECT 1 FROM public.album album WHERE album.id = candidate."ancestorId") OR NOT EXISTS (SELECT 1 FROM public.album album WHERE album.id = candidate."descendantId")',
  ],
  [
    'album_metadata',
    'immich_fork.album_metadata',
    'candidate."albumId"::text',
    'NOT EXISTS (SELECT 1 FROM public.album album WHERE album.id = candidate."albumId") OR (candidate."parentId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.album album WHERE album.id = candidate."parentId"))',
  ],
  [
    'asset_health',
    'immich_fork.asset_health',
    'candidate."assetId"::text',
    'NOT EXISTS (SELECT 1 FROM public.asset asset WHERE asset.id = candidate."assetId")',
  ],
  [
    'asset_health_candidate',
    'immich_fork.asset_health_candidate',
    'candidate.id::text',
    'NOT EXISTS (SELECT 1 FROM immich_fork.asset_health health WHERE health.id = candidate."healthId")',
  ],
  [
    'asset_health_run',
    'immich_fork.asset_health_run',
    'candidate.id::text',
    'NOT EXISTS (SELECT 1 FROM immich_fork.asset_health health WHERE health."runId" = candidate.id)',
  ],
  [
    'asset_privacy',
    'immich_fork.asset_privacy',
    'candidate."assetId"::text',
    'NOT EXISTS (SELECT 1 FROM public.asset asset WHERE asset.id = candidate."assetId")',
  ],
  [
    'asset_enrichment',
    'immich_fork.asset_enrichment',
    'candidate."assetId"::text',
    'NOT EXISTS (SELECT 1 FROM public.asset asset WHERE asset.id = candidate."assetId")',
  ],
  [
    'asset_best_photo_score',
    'immich_fork.asset_best_photo_score',
    'candidate."assetId"::text',
    'NOT EXISTS (SELECT 1 FROM public.asset asset WHERE asset.id = candidate."assetId")',
  ],
  [
    'asset_video_duplicate_frame',
    'immich_fork.asset_video_duplicate_frame',
    `candidate."assetId"::text || ':' || candidate."frameIndex"::text`,
    'NOT EXISTS (SELECT 1 FROM public.asset asset WHERE asset.id = candidate."assetId")',
  ],
  [
    'asset_checksum',
    'immich_fork.asset_checksum',
    'candidate."assetId"::text',
    'NOT EXISTS (SELECT 1 FROM public.asset asset WHERE asset.id = candidate."assetId")',
  ],
  [
    'asset_physical_file',
    'immich_fork.asset_physical_file',
    'candidate."assetId"::text',
    'NOT EXISTS (SELECT 1 FROM public.asset asset WHERE asset.id = candidate."assetId") OR (candidate."physicalFileId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM immich_fork.physical_file physical WHERE physical.id = candidate."physicalFileId"))',
  ],
  [
    'asset_storage_reservation',
    'immich_fork.asset_storage_reservation',
    'candidate."assetId"::text',
    'NOT EXISTS (SELECT 1 FROM public.asset asset WHERE asset.id = candidate."assetId")',
  ],
  [
    'physical_file',
    'immich_fork.physical_file',
    'candidate.id::text',
    '(candidate."canonicalAssetId" IS NULL OR NOT EXISTS (SELECT 1 FROM public.asset asset WHERE asset.id = candidate."canonicalAssetId")) AND NOT EXISTS (SELECT 1 FROM immich_fork.asset_physical_file mapping JOIN public.asset asset ON asset.id = mapping."assetId" WHERE mapping."physicalFileId" = candidate.id)',
  ],
] as const;

const ORPHAN_RELATIONS = [
  'public.album',
  'public.asset',
  'immich_fork.orphaned_records',
  ...ORPHAN_FAMILIES.map(([, table]) => table),
].sort();

@Injectable()
export class ForkHandoffRepository {
  constructor(@InjectKysely() protected readonly db: Kysely<DB>) {}

  protected afterOrphanRelationLocks(_transaction: Kysely<DB>): Promise<void> {
    return Promise.resolve();
  }

  async isCertifiedReturnStartup(kysely: Kysely<DB> = this.db): Promise<boolean> {
    const relation = await sql<{ present: boolean }>`
      SELECT to_regclass('immich_fork.state') IS NOT NULL AS present
    `.execute(kysely);
    if (!relation.rows[0]?.present) {
      return false;
    }

    const state = await sql<{ phase: string; schemaVersion: string }>`
      SELECT phase, "schemaVersion" FROM immich_fork.state WHERE id = 1
    `.execute(kysely);
    return state.rows[0]?.phase === 'inactive' && state.rows[0]?.schemaVersion === '2';
  }

  async assertCertifiedReturnLedger(kysely: Kysely<DB> = this.db): Promise<'v3.0.3'> {
    await this.getReturnEvidence(kysely);
    return CERTIFIED_TAG;
  }

  async getReturnEvidence(kysely: Kysely<DB> = this.db): Promise<ForkReturnEvidence> {
    const stateResult = await sql<{
      active: boolean;
      maintenanceMode: boolean;
      phase: ForkSchemaPhase;
      schemaVersion: string;
    }>`
      SELECT
        state.active,
        state.phase,
        state."schemaVersion",
        coalesce((metadata.value->>'isMaintenanceMode')::boolean, false) AS "maintenanceMode"
      FROM immich_fork.state state
      LEFT JOIN public.system_metadata metadata ON metadata.key = 'maintenance-mode'
      WHERE state.id = 1
    `.execute(kysely);
    const state = stateResult.rows[0];
    if (!state || state.active || state.phase !== 'inactive' || state.schemaVersion !== '2') {
      throw new Error('Fork return requires inactive schema version 2 state');
    }
    if (!state.maintenanceMode) {
      throw new Error('Fork return requires maintenance mode');
    }

    const checkpoint = await this.getOfficialHandoffCheckpoint(kysely);
    const ledgerResult = await sql<{ name: string }>`
      SELECT name FROM public.kysely_migrations ORDER BY timestamp, name
    `.execute(kysely);
    const names = ledgerResult.rows.map(({ name }) => name);
    assertExactCertifiedReturnLedger(names, supportedVersions.upstreamMigrations);

    const reconciliationResult = await sql<{ status: string }>`
      SELECT status
      FROM immich_fork.migration_audit
      WHERE name = 'fork-return-reconciliation'
      ORDER BY id DESC
      LIMIT 1
    `.execute(kysely);
    const auditStatus = reconciliationResult.rows[0]?.status;
    const reconciliationStatus =
      auditStatus === 'applied'
        ? 'complete'
        : auditStatus === 'running' || auditStatus === 'failed'
          ? auditStatus
          : 'not-started';

    return {
      ...state,
      appliedCheckpointId: checkpoint.id,
      supportedTag: CERTIFIED_TAG,
      officialLedgerDigest: officialLedgerDigest(names),
      reconciliationStatus,
    };
  }

  async getOfficialHandoffCheckpoint(kysely: Kysely<DB> = this.db): Promise<OfficialHandoffCheckpoint> {
    const result = await sql<{ completedAt: Date; details: CheckpointDetails; id: string }>`
      SELECT id::text AS id, details, "completedAt"
      FROM immich_fork.migration_audit
      WHERE name = 'fork-schema-cutover'
        AND phase = 'official-cutover'
        AND status = 'applied'
      ORDER BY id
    `.execute(kysely);
    if (result.rows.length !== 1) {
      throw new Error('Fork return requires one applied official cutover checkpoint');
    }
    const row = result.rows[0]!;
    if (!row.completedAt || !row.details?.reportDigest) {
      throw new Error('Fork return official cutover checkpoint evidence is incomplete');
    }
    return {
      completedAt: row.completedAt.toISOString(),
      databaseBackupId: row.details.databaseBackupId ?? null,
      id: row.id,
      mediaSnapshotId: row.details.mediaSnapshotId ?? null,
      reportDigest: row.details.reportDigest,
      storageVerificationDigest: row.details.storageVerificationDigest ?? null,
      storageVerificationRunId: row.details.storageVerificationRunId ?? null,
    };
  }

  async archiveAndDeleteOrphans(kysely: Kysely<DB> = this.db): Promise<OrphanArchiveSummary> {
    return kysely
      .transaction()
      .setIsolationLevel('serializable')
      .execute(async (transaction) => {
        for (const relation of ORPHAN_RELATIONS) {
          await sql.raw(`LOCK TABLE ${relation} IN SHARE ROW EXCLUSIVE MODE`).execute(transaction);
        }
        await this.afterOrphanRelationLocks(transaction);
        const state = await sql<{ active: boolean; phase: ForkSchemaPhase }>`
          SELECT active, phase FROM immich_fork.state WHERE id = 1 FOR UPDATE
        `.execute(transaction);
        if (!state.rows[0] || state.rows[0].active || state.rows[0].phase !== 'inactive') {
          throw new Error('Fork orphan reconciliation requires inactive phase');
        }

        const families = ORPHAN_FAMILIES.map(([sourceTable, table, key, where]) => ({
          sourceTable,
          table,
          key,
          where,
        }));
        let deleted = 0;
        for (const family of families) {
          await sql
            .raw(
              `INSERT INTO immich_fork.orphaned_records ("sourceTable", "sourceKey", payload)
               SELECT '${family.sourceTable}', ${family.key}, row_to_json(candidate)::jsonb
               FROM ${family.table} candidate
               WHERE ${family.where}
               ON CONFLICT ("sourceTable", "sourceKey") DO NOTHING`,
            )
            .execute(transaction);
          const removed = await sql
            .raw<{ count: number }>(
              `WITH removed AS (
                 DELETE FROM ${family.table} candidate
                 WHERE (${family.where})
                   AND EXISTS (
                     SELECT 1 FROM immich_fork.orphaned_records archive
                     WHERE archive."sourceTable" = '${family.sourceTable}'
                       AND archive."sourceKey" = ${family.key}
                   )
                 RETURNING 1
               ) SELECT count(*)::int AS count FROM removed`,
            )
            .execute(transaction);
          deleted += removed.rows[0]?.count ?? 0;
        }

        for (const family of families) {
          const remaining = await sql
            .raw<{
              count: number;
            }>(`SELECT count(*)::int AS count FROM ${family.table} candidate WHERE ${family.where}`)
            .execute(transaction);
          if ((remaining.rows[0]?.count ?? 0) !== 0) {
            throw new Error(`Fork orphan reconciliation left references in ${family.sourceTable}`);
          }
        }
        return { archived: deleted, deleted };
      });
  }
}
