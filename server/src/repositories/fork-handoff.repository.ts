import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { createHash } from 'node:crypto';
import { StorageCore } from 'src/cores/storage.core';
import forkCatalogManifest from 'src/fork-schema/manifests/fork-v2-catalog.json';
import supportedVersions from 'src/fork-schema/supported-versions.json';
import { getWorkflowCompatibilityEvidence, WorkflowRowDigest } from 'src/fork-schema/workflow-compatibility';
import {
  canonicalStorageVerificationDigest,
  StorageVerificationEvidence,
} from 'src/repositories/fork-cutover-verification.repository';
import {
  BACKFILL_KINDS,
  BackfillKind,
  BackfillProgress,
  canonicalReturnBackfillDigest,
  ForkSchemaPhase,
  ReturnBackfillBatchEvidence,
  ReturnBackfillEvidence,
} from 'src/repositories/fork-schema.repository';
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
  officialImage: 'ghcr.io/immich-app/immich-server:v3.0.3';
  reportDigest: string;
  storageVerificationAssetCount: number | null;
  storageVerificationDigest: string | null;
  storageVerificationRunId: string | null;
};

export type OrphanArchiveSummary = { archived: number; deleted: number };

export type ReturnWorkflowSnapshot = { rowDigests: WorkflowRowDigest[]; schemaDigest: string };

export type ReconciliationReport = Omit<ForkReturnEvidence, 'active' | 'phase' | 'reconciliationStatus'> & {
  active: true;
  orphanArchive: OrphanArchiveSummary;
  phase: 'active';
  progress: BackfillProgress[];
  reconciliationStatus: 'complete';
  verified: true;
};

type CheckpointDetails = {
  databaseBackupId?: string | null;
  mediaSnapshotId?: string | null;
  reportDigest?: string;
  storageVerificationDigest?: string | null;
  storageVerificationAssetCount?: number | null;
  storageVerificationRunId?: string | null;
};

const CERTIFIED_TAG = 'v3.0.3' as const;
const OFFICIAL_IMAGE = 'ghcr.io/immich-app/immich-server:v3.0.3' as const;
const OFFICIAL_WORKFLOW_MIGRATION = '1778614946174-UpdateWorkflowTables';

export const assertExactCertifiedReturnLedger = (actual: readonly string[], expected: readonly string[]): 'v3.0.3' => {
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    throw new Error('Fork return requires the exact certified v3.0.3 ledger');
  }
  return CERTIFIED_TAG;
};

export const assertCertifiedOfficialHandoffLedger = (
  actual: readonly string[],
  expected: readonly string[],
): 'v3.0.3' => {
  const workflowIndex = expected.indexOf(OFFICIAL_WORKFLOW_MIGRATION);
  if (
    workflowIndex === -1 ||
    actual.length < workflowIndex + 1 ||
    actual.length > expected.length ||
    actual.some((name, index) => name !== expected[index])
  ) {
    throw new Error('Official handoff requires an exact certified v3.0.3 prefix through 177861');
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
    'NOT EXISTS (SELECT 1 FROM immich_fork.smart_album_rule rule JOIN public.album album ON album.id = rule."albumId" WHERE rule.id = candidate."smartAlbumId") OR NOT EXISTS (SELECT 1 FROM public.asset asset WHERE asset.id = candidate."assetId")',
  ],
  [
    'smart_album_exclusion',
    'immich_fork.smart_album_exclusion',
    `candidate."smartAlbumId"::text || ':' || candidate."assetId"::text`,
    'NOT EXISTS (SELECT 1 FROM immich_fork.smart_album_rule rule JOIN public.album album ON album.id = rule."albumId" WHERE rule.id = candidate."smartAlbumId") OR NOT EXISTS (SELECT 1 FROM public.asset asset WHERE asset.id = candidate."assetId")',
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

const FINAL_ACTIVATION_RELATIONS = [...new Set(forkCatalogManifest.tables.map(({ identity }) => identity))].sort();

const RETURN_BACKFILL_SOURCES: Record<BackfillKind, 'public.album' | 'public.asset'> = {
  albums: 'public.album',
  automation: 'public.album',
  checksum: 'public.asset',
  enrichment: 'public.asset',
  health: 'public.asset',
  privacy: 'public.asset',
  storage: 'public.asset',
};

const quoteRelation = (relation: string): string =>
  relation
    .split('.')
    .map((part) => `"${part.replaceAll('"', '""')}"`)
    .join('.');

const isReturnBackfillBatchEvidence = (value: unknown): value is ReturnBackfillBatchEvidence => {
  const batch = value as Partial<ReturnBackfillBatchEvidence> | null;
  return (
    !!batch &&
    Number.isSafeInteger(batch.count) &&
    (batch.count ?? 0) > 0 &&
    typeof batch.digest === 'string' &&
    /^[0-9a-f]{64}$/.test(batch.digest) &&
    typeof batch.endCursor === 'string' &&
    batch.endCursor.length > 0
  );
};

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
      officialImage: OFFICIAL_IMAGE,
      reportDigest: row.details.reportDigest,
      storageVerificationAssetCount: row.details.storageVerificationAssetCount ?? null,
      storageVerificationDigest: row.details.storageVerificationDigest ?? null,
      storageVerificationRunId: row.details.storageVerificationRunId ?? null,
    };
  }

  async prepareOfficialHandoffCheckpoint(): Promise<OfficialHandoffCheckpoint> {
    return this.db
      .transaction()
      .setIsolationLevel('repeatable read')
      .setAccessMode('read only')
      .execute(async (transaction) => {
        await this.assertOfficialHandoffReady(transaction);
        return this.getPreparedOfficialHandoffCheckpoint(transaction);
      });
  }

  async assertOfficialHandoffReady(kysely: Kysely<DB> = this.db): Promise<'v3.0.3'> {
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
      throw new Error('Official handoff requires inactive schema version 2 state');
    }
    if (!state.maintenanceMode) {
      throw new Error('Official handoff requires maintenance mode');
    }
    await this.getOfficialHandoffCheckpoint(kysely);
    const ledger = await sql<{ name: string }>`
      SELECT name FROM public.kysely_migrations ORDER BY timestamp, name
    `.execute(kysely);
    return assertCertifiedOfficialHandoffLedger(
      ledger.rows.map(({ name }) => name),
      supportedVersions.upstreamMigrations,
    );
  }

  async getPreparedOfficialHandoffCheckpoint(kysely: Kysely<DB> = this.db): Promise<OfficialHandoffCheckpoint> {
    const checkpoint = await this.getOfficialHandoffCheckpoint(kysely);
    if (
      !checkpoint.databaseBackupId ||
      !checkpoint.mediaSnapshotId ||
      !checkpoint.storageVerificationRunId ||
      !checkpoint.storageVerificationDigest ||
      checkpoint.storageVerificationAssetCount === null
    ) {
      throw new Error('Official handoff requires a bound storage verification checkpoint');
    }
    const result = await sql<{
      aggregateDigest: string | null;
      applicableAssetCount: number;
      completedAt: Date | null;
      databaseBackupId: string;
      failureCount: number;
      snapshotId: string;
      status: string;
      verifiedCount: number;
    }>`
      SELECT
        "aggregateDigest",
        "applicableAssetCount"::int AS "applicableAssetCount",
        "completedAt",
        "databaseBackupId",
        "failureCount"::int AS "failureCount",
        "snapshotId",
        status,
        "verifiedCount"::int AS "verifiedCount"
      FROM immich_fork.cutover_verification_run
      WHERE id = ${checkpoint.storageVerificationRunId}::uuid
    `.execute(kysely);
    const run = result.rows[0];
    const storageEvidence = run
      ? await sql<StorageVerificationEvidence>`
          SELECT "assetId", path, size::float8 AS size, sha1, sha256, device::text, inode::text, links
          FROM immich_fork.cutover_verification_asset
          WHERE "runId" = ${checkpoint.storageVerificationRunId}::uuid AND status = 'verified'
          ORDER BY "assetId"
        `.execute(kysely)
      : { rows: [] };
    const rootDrift = run
      ? await sql<{ count: number }>`
          SELECT count(*)::int AS count
          FROM immich_fork.cutover_verification_asset verification
          LEFT JOIN public.asset asset ON asset.id = verification."assetId"
          LEFT JOIN public.library library ON library.id = asset."libraryId"
          WHERE verification."runId" = ${checkpoint.storageVerificationRunId}::uuid
            AND (
              asset.id IS NULL
              OR verification.path IS DISTINCT FROM asset."originalPath"
              OR verification."approvedRoots" IS DISTINCT FROM
                ARRAY[${StorageCore.getMediaLocation()}] || coalesce(library."importPaths", ARRAY[]::text[])
            )
        `.execute(kysely)
      : { rows: [{ count: 0 }] };
    const completedAt = run?.completedAt?.getTime() ?? Number.NaN;
    const age = Date.now() - completedAt;
    if (
      !run ||
      run.status !== 'completed' ||
      run.databaseBackupId !== checkpoint.databaseBackupId ||
      run.snapshotId !== checkpoint.mediaSnapshotId ||
      run.aggregateDigest !== checkpoint.storageVerificationDigest ||
      run.applicableAssetCount !== checkpoint.storageVerificationAssetCount ||
      run.failureCount !== 0 ||
      run.verifiedCount !== run.applicableAssetCount ||
      storageEvidence.rows.length !== run.applicableAssetCount ||
      canonicalStorageVerificationDigest(storageEvidence.rows) !== run.aggregateDigest ||
      (rootDrift.rows[0]?.count ?? 0) !== 0 ||
      !Number.isFinite(completedAt) ||
      age < 0 ||
      age > 60 * 60 * 1000
    ) {
      throw new Error('Official handoff storage verification checkpoint is stale or drifted');
    }
    return { ...checkpoint, officialImage: OFFICIAL_IMAGE };
  }

  async getReturnWorkflowSnapshot(kysely: Kysely<DB> = this.db): Promise<ReturnWorkflowSnapshot> {
    const evidence = await getWorkflowCompatibilityEvidence(kysely);
    return { rowDigests: evidence.rowDigests, schemaDigest: evidence.schemaDigest };
  }

  async sealEmptyReturnBackfillDigests(): Promise<void> {
    const emptyDigest = createHash('sha256').update('').digest('hex');
    await sql`
      UPDATE immich_fork.backfill_progress
      SET digest = ${emptyDigest}, "updatedAt" = now()
      WHERE processed = 0
        AND remaining = 0
        AND digest IS NULL
        AND "lastError" IS NULL
        AND "claimedCursor" IS NULL
        AND "claimToken" IS NULL
        AND cardinality("claimedIds") = 0
    `.execute(this.db);
  }

  async activateAfterReturnReconciliation(
    expectedWorkflow: ReturnWorkflowSnapshot,
    orphanArchive: OrphanArchiveSummary,
    beforeActivate?: (transaction: Kysely<DB>) => Promise<void> | void,
  ): Promise<ReconciliationReport> {
    return this.db
      .transaction()
      .setIsolationLevel('serializable')
      .execute(async (transaction) => {
        for (const relation of FINAL_ACTIVATION_RELATIONS) {
          await sql.raw(`LOCK TABLE ${quoteRelation(relation)} IN SHARE ROW EXCLUSIVE MODE`).execute(transaction);
        }
        await beforeActivate?.(transaction);

        const evidence = await this.getReturnEvidence(transaction);
        const currentWorkflow = await this.getReturnWorkflowSnapshot(transaction);
        if (
          currentWorkflow.schemaDigest !== expectedWorkflow.schemaDigest ||
          JSON.stringify(currentWorkflow.rowDigests) !== JSON.stringify(expectedWorkflow.rowDigests)
        ) {
          throw new Error('Fork return workflow rows or catalog drifted during reconciliation');
        }

        const progressResult = await sql<
          BackfillProgress & {
            claimedCursor: string | null;
            claimToken: string | null;
            claimedIds: string[];
          }
        >`
          SELECT
            kind,
            cursor,
            processed::float8 AS processed,
            remaining::float8 AS remaining,
            digest,
            "lastError",
            "claimedCursor",
            "claimToken",
            "claimedIds"
          FROM immich_fork.backfill_progress
          ORDER BY kind
          FOR UPDATE
        `.execute(transaction);
        const progress = progressResult.rows;
        const complete =
          progress.length === BACKFILL_KINDS.length &&
          new Set(progress.map(({ kind }) => kind)).size === BACKFILL_KINDS.length &&
          BACKFILL_KINDS.every((kind) => progress.some((row) => row.kind === kind)) &&
          progress.every(
            ({ claimedCursor, claimToken, claimedIds, lastError, remaining }) =>
              remaining === 0 &&
              claimedCursor === null &&
              claimToken === null &&
              claimedIds.length === 0 &&
              lastError === null,
          );
        if (!complete) {
          throw new Error('Cannot activate fork schema with incomplete backfills');
        }

        for (const [sourceTable, table, , where] of ORPHAN_FAMILIES) {
          const remaining = await sql
            .raw<{ count: number }>(`SELECT count(*)::int AS count FROM ${table} candidate WHERE ${where}`)
            .execute(transaction);
          if ((remaining.rows[0]?.count ?? 0) !== 0) {
            throw new Error(`Fork return activation found orphan references in ${sourceTable}`);
          }
        }

        const auditResult = await sql<{ details: Record<string, unknown>; id: string }>`
          SELECT id::text AS id, details
          FROM immich_fork.migration_audit
          WHERE name = 'fork-return-reconciliation' AND phase = 'inactive' AND status = 'running'
          ORDER BY id
          FOR UPDATE
        `.execute(transaction);
        if (auditResult.rows.length !== 1) {
          throw new Error('Fork schema activation requires exactly one running return reconciliation audit');
        }
        const audit = auditResult.rows[0];
        const backfillEvidence = (audit.details.backfillEvidence ?? {}) as ReturnBackfillEvidence;
        if (Object.keys(backfillEvidence).some((kind) => !BACKFILL_KINDS.includes(kind as BackfillKind))) {
          throw new Error('Fork return activation requires the exact backfill evidence set');
        }
        for (const kind of BACKFILL_KINDS) {
          const row = progress.find((candidate) => candidate.kind === kind)!;
          const sourceCountResult = await sql
            .raw<{ count: number }>(`SELECT count(*)::int AS count FROM ${RETURN_BACKFILL_SOURCES[kind]}`)
            .execute(transaction);
          const sourceCount = sourceCountResult.rows[0]?.count ?? 0;
          let kindEvidence = backfillEvidence[kind];
          if (!kindEvidence && sourceCount === 0 && row.processed === 0) {
            if (kind !== 'automation' && row.digest !== null) {
              throw new Error(`Fork return ${kind} backfill digest drifted without durable evidence`);
            }
            const batches: ReturnBackfillBatchEvidence[] = [];
            kindEvidence = {
              batches,
              cumulativeDigest: canonicalReturnBackfillDigest(batches),
              processed: 0,
            };
            backfillEvidence[kind] = kindEvidence;
            if (kind !== 'automation') {
              row.digest = kindEvidence.cumulativeDigest;
              await sql`
                UPDATE immich_fork.backfill_progress
                SET digest = ${row.digest}, "updatedAt" = now()
                WHERE kind = ${kind}
              `.execute(transaction);
            }
          }
          const batches = kindEvidence?.batches;
          if (
            !kindEvidence ||
            !Array.isArray(batches) ||
            !batches.every(isReturnBackfillBatchEvidence) ||
            kindEvidence.processed !== batches.reduce((total, batch) => total + batch.count, 0) ||
            kindEvidence.processed !== row.processed ||
            row.processed !== sourceCount ||
            kindEvidence.cumulativeDigest !== canonicalReturnBackfillDigest(batches) ||
            (kindEvidence.sourceCount !== undefined && kindEvidence.sourceCount !== sourceCount) ||
            (kind !== 'automation' && row.digest !== kindEvidence.cumulativeDigest)
          ) {
            throw new Error(`Fork return ${kind} backfill processed, source, or digest evidence drifted`);
          }
          backfillEvidence[kind] = { ...kindEvidence, sourceCount };
        }
        if (Object.keys(backfillEvidence).length !== BACKFILL_KINDS.length) {
          throw new Error('Fork return activation requires the exact backfill evidence set');
        }
        const config = audit.details.configReconciliation as
          | { count?: number; digest?: string; source?: string }
          | undefined;
        const automation = audit.details.automationReconciliation as
          | { configDigest?: string; digest?: string; rawDigest?: string | null }
          | undefined;
        const backfillKinds = audit.details.backfillKinds;
        const automationProgress = progress.find(({ kind }) => kind === 'automation');
        const automationBackfill = backfillEvidence.automation!;
        const expectedAutomationRawDigest =
          automationBackfill.sourceCount === 0 ? null : automationBackfill.cumulativeDigest;
        const expectedAutomationDigest = automation
          ? createHash('sha256')
              .update(JSON.stringify({ automation: automation.rawDigest, config: automation.configDigest }))
              .digest('hex')
          : null;
        if (
          !Array.isArray(backfillKinds) ||
          backfillKinds.length !== BACKFILL_KINDS.length ||
          !BACKFILL_KINDS.every((kind) => backfillKinds.includes(kind)) ||
          config?.count !== 2 ||
          !/^[0-9a-f]{64}$/.test(config.digest ?? '') ||
          (config.source !== 'database' && config.source !== 'file') ||
          automation?.configDigest !== config.digest ||
          automation?.rawDigest !== expectedAutomationRawDigest ||
          automation?.digest !== expectedAutomationDigest ||
          automationProgress?.digest !== automation.digest ||
          !/^[0-9a-f]{64}$/.test(automation?.digest ?? '')
        ) {
          throw new Error('Fork return activation evidence is incomplete or drifted');
        }

        await sql`
          UPDATE immich_fork.migration_audit
          SET
            status = 'applied',
            details = coalesce(details, '{}'::jsonb) || jsonb_build_object(
              'officialLedgerDigest', ${evidence.officialLedgerDigest}::text,
              'backfillEvidence', ${backfillEvidence}::jsonb,
              'orphanArchive', ${orphanArchive}::jsonb,
              'supportedTag', ${CERTIFIED_TAG}::text,
              'workflowSnapshot', ${expectedWorkflow}::jsonb
            ),
            "completedAt" = now()
          WHERE id = ${audit.id}::bigint
        `.execute(transaction);
        const activated = await sql`
          UPDATE immich_fork.state
          SET active = true, phase = 'active', "updatedAt" = now()
          WHERE id = 1 AND active = false AND phase = 'inactive' AND "schemaVersion" = '2'
        `.execute(transaction);
        if (Number(activated.numAffectedRows) !== 1) {
          throw new Error('Fork schema activation requires inactive schema version 2 state');
        }

        return {
          ...evidence,
          active: true,
          orphanArchive,
          phase: 'active',
          progress: progress.map(({ claimedCursor: _, claimedIds: __, claimToken: ___, ...row }) => row),
          reconciliationStatus: 'complete',
          verified: true,
        };
      });
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
