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

@Injectable()
export class ForkHandoffRepository {
  constructor(@InjectKysely() protected readonly db: Kysely<DB>) {}

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
}
