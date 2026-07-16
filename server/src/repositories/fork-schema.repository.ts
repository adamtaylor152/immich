import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { createHash, randomUUID } from 'node:crypto';
import { SystemConfig } from 'src/config';
import { isForkAuthoritative, isForkWriteEnabled } from 'src/fork-schema/authority';
import { DB } from 'src/schema';
import { DeepPartial } from 'src/types';

export type ForkSchemaPhase = 'legacy' | 'dual-write' | 'ready' | 'inactive' | 'active' | 'failed';
export type BackfillKind = 'privacy' | 'albums' | 'enrichment' | 'automation' | 'health' | 'storage' | 'checksum';
export type ForkState = {
  active: boolean;
  phase: ForkSchemaPhase;
  schemaVersion: string;
  upstreamVersion: string;
};
export type BackfillClaim = { ids: string[]; cursor: string };
export type ReturnConfigReconciliation = {
  count: number;
  digest: string;
  source: 'database' | 'file';
};
type ReturnAutomationReconciliation = {
  configDigest: string;
  digest: string;
  rawDigest: string | null;
};

export const BACKFILL_KINDS = [
  'privacy',
  'albums',
  'enrichment',
  'automation',
  'health',
  'storage',
  'checksum',
] as const satisfies readonly BackfillKind[];

type BackfillReservation = {
  claimExpired: boolean;
  claimToken: string | null;
  claimedCursor: string | null;
  claimedIds: string[];
  cursor: string | null;
};

export type BackfillProgress = {
  kind: BackfillKind;
  cursor: string | null;
  processed: number;
  remaining: number;
  digest: string | null;
  lastError: string | null;
};

export type ReturnBackfillBatchEvidence = {
  count: number;
  digest: string;
  endCursor: string;
};

export type ReturnBackfillKindEvidence = {
  batches: ReturnBackfillBatchEvidence[];
  cumulativeDigest: string;
  processed: number;
  sourceCount?: number;
};

export type ReturnBackfillEvidence = Partial<Record<BackfillKind, ReturnBackfillKindEvidence>>;

export const canonicalReturnBackfillDigest = (batches: readonly ReturnBackfillBatchEvidence[]): string =>
  createHash('sha256').update(JSON.stringify(batches)).digest('hex');

const CLAIM_LEASE = sql.raw("interval '15 minutes'");

const getBackfillSource = (kind: BackfillKind) => {
  switch (kind) {
    case 'albums':
    case 'automation': {
      return sql.raw('album');
    }
    case 'privacy':
    case 'enrichment':
    case 'health':
    case 'storage':
    case 'checksum': {
      return sql.raw('asset');
    }
  }
};

@Injectable()
export class ForkSchemaRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  async overlayConfig(config: SystemConfig): Promise<SystemConfig> {
    const state = await this.getState();
    if (!isForkAuthoritative(state.phase)) {
      return config;
    }
    const result = await sql<{ key: string; value: unknown }>`
      SELECT key, value FROM immich_fork.config
      WHERE key IN ('machineLearning.runpod', 'smartAlbums')
    `.execute(this.db);
    const values = new Map(result.rows.map(({ key, value }) => [key, value]));
    const runpod = values.get('machineLearning.runpod');
    const smartAlbums = values.get('smartAlbums');
    if (!runpod || !smartAlbums) {
      throw new Error('Missing authoritative fork configuration sidecar');
    }
    return {
      ...config,
      machineLearning: { ...config.machineLearning, runpod: runpod as SystemConfig['machineLearning']['runpod'] },
      smartAlbums: smartAlbums as SystemConfig['smartAlbums'],
    };
  }

  async mirrorConfig(config: SystemConfig): Promise<void> {
    const state = await this.getState();
    if (!isForkWriteEnabled(state.phase)) {
      return;
    }
    await this.db.transaction().execute(async (trx) => {
      for (const [key, value] of [
        ['machineLearning.runpod', config.machineLearning.runpod],
        ['smartAlbums', config.smartAlbums],
      ] as const) {
        await sql`INSERT INTO immich_fork.config (key, value) VALUES (${key}, ${value}::jsonb)
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now()`.execute(trx);
      }
    });
  }

  async persistConfig(partialConfig: DeepPartial<SystemConfig>, config: SystemConfig): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const state = await sql<{ phase: ForkSchemaPhase }>`
        SELECT phase FROM immich_fork.state WHERE id = 1 FOR UPDATE
      `.execute(trx);
      if (!state.rows[0]) {
        throw new Error('Fork schema state is not initialized');
      }
      await sql`
        INSERT INTO system_metadata (key, value) VALUES ('system-config', ${partialConfig}::jsonb)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `.execute(trx);
      if (isForkWriteEnabled(state.rows[0].phase)) {
        for (const [key, value] of [
          ['machineLearning.runpod', config.machineLearning.runpod],
          ['smartAlbums', config.smartAlbums],
        ] as const) {
          await sql`INSERT INTO immich_fork.config (key, value) VALUES (${key}, ${value}::jsonb)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now()`.execute(trx);
        }
      }
    });
  }

  async getState(): Promise<ForkState> {
    const result = await sql<ForkState>`
      SELECT active, phase, "schemaVersion", "upstreamVersion"
      FROM immich_fork.state
      WHERE id = 1
    `.execute(this.db);
    const state = result.rows[0];
    if (!state) {
      throw new Error('Fork schema state is not initialized');
    }
    return state;
  }

  async getProgress(): Promise<BackfillProgress[]> {
    const result = await sql<BackfillProgress>`
      SELECT
        kind,
        cursor,
        processed::float8 AS processed,
        remaining::float8 AS remaining,
        digest,
        "lastError"
      FROM immich_fork.backfill_progress
      WHERE kind = ANY(${[...BACKFILL_KINDS]})
    `.execute(this.db);
    return result.rows;
  }

  async getReturnConfigReconciliation(): Promise<ReturnConfigReconciliation | null> {
    const result = await sql<{ evidence: ReturnConfigReconciliation | null }>`
      SELECT details -> 'configReconciliation' AS evidence
      FROM immich_fork.migration_audit
      WHERE name = 'fork-return-reconciliation'
      ORDER BY id DESC
      LIMIT 1
    `.execute(this.db);
    const evidence = result.rows[0]?.evidence;
    if (!evidence) {
      return null;
    }
    if (
      evidence.count !== 2 ||
      !/^[0-9a-f]{64}$/.test(evidence.digest) ||
      (evidence.source !== 'database' && evidence.source !== 'file')
    ) {
      throw new Error('Fork return config reconciliation evidence is invalid');
    }
    return evidence;
  }

  async recordReturnConfigReconciliation(evidence: ReturnConfigReconciliation): Promise<void> {
    if (evidence.count !== 2 || !/^[0-9a-f]{64}$/.test(evidence.digest)) {
      throw new Error('Fork return config reconciliation evidence is invalid');
    }
    await this.db
      .transaction()
      .setIsolationLevel('serializable')
      .execute(async (trx) => {
        const audit = await sql<{ details: Record<string, unknown>; id: string }>`
          SELECT id::text AS id, coalesce(details, '{}'::jsonb) AS details
          FROM immich_fork.migration_audit
          WHERE name = 'fork-return-reconciliation' AND phase = 'inactive' AND status = 'running'
          ORDER BY id DESC LIMIT 1 FOR UPDATE
        `.execute(trx);
        const row = audit.rows[0];
        if (!row) {
          throw new Error('Fork return config reconciliation requires a running audit');
        }
        const current = row.details.configReconciliation;
        if (current) {
          const stored = current as Partial<ReturnConfigReconciliation>;
          if (
            stored.count !== evidence.count ||
            stored.digest !== evidence.digest ||
            stored.source !== evidence.source
          ) {
            throw new Error('Fork return config reconciliation evidence drifted');
          }
          return;
        }
        await sql`
          UPDATE immich_fork.migration_audit
          SET details = jsonb_set(coalesce(details, '{}'::jsonb), '{configReconciliation}', ${evidence}::jsonb)
          WHERE id = ${row.id}::bigint
        `.execute(trx);
      });
  }

  async finalizeReturnAutomationProgress(configDigest: string): Promise<void> {
    if (!/^[0-9a-f]{64}$/.test(configDigest)) {
      throw new Error('Fork return config digest is invalid');
    }
    await this.db.transaction().execute(async (trx) => {
      const audit = await sql<{ details: Record<string, unknown>; id: string }>`
        SELECT id::text AS id, coalesce(details, '{}'::jsonb) AS details
        FROM immich_fork.migration_audit
        WHERE name = 'fork-return-reconciliation' AND phase = 'inactive' AND status = 'running'
        ORDER BY id DESC LIMIT 1 FOR UPDATE
      `.execute(trx);
      const auditRow = audit.rows[0];
      const config = auditRow?.details.configReconciliation as Partial<ReturnConfigReconciliation> | undefined;
      if (!auditRow || config?.digest !== configDigest) {
        throw new Error('Fork return automation finalization requires durable config evidence');
      }
      const progress = await sql<{
        claimToken: string | null;
        digest: string | null;
        lastError: string | null;
        remaining: number;
      }>`
        SELECT remaining::float8 AS remaining, digest, "lastError", "claimToken"
        FROM immich_fork.backfill_progress WHERE kind = 'automation' FOR UPDATE
      `.execute(trx);
      const row = progress.rows[0];
      if (!row || row.remaining !== 0 || row.lastError || row.claimToken) {
        throw new Error('Fork return automation progress is incomplete');
      }
      const stored = auditRow.details.automationReconciliation as Partial<ReturnAutomationReconciliation> | undefined;
      if (stored) {
        const expected = createHash('sha256')
          .update(JSON.stringify({ automation: stored.rawDigest, config: stored.configDigest }))
          .digest('hex');
        if (
          stored.configDigest !== configDigest ||
          stored.digest !== expected ||
          !(
            stored.rawDigest === null ||
            (typeof stored.rawDigest === 'string' && /^[0-9a-f]{64}$/.test(stored.rawDigest))
          ) ||
          row.digest !== stored.digest
        ) {
          throw new Error('Fork return automation reconciliation evidence drifted');
        }
        return;
      }
      const binding: ReturnAutomationReconciliation = {
        configDigest,
        digest: createHash('sha256')
          .update(JSON.stringify({ automation: row.digest, config: configDigest }))
          .digest('hex'),
        rawDigest: row.digest,
      };
      await sql`
        UPDATE immich_fork.migration_audit
        SET details = jsonb_set(coalesce(details, '{}'::jsonb), '{automationReconciliation}', ${binding}::jsonb)
        WHERE id = ${auditRow.id}::bigint
      `.execute(trx);
      await sql`
        UPDATE immich_fork.backfill_progress SET digest = ${binding.digest}, "updatedAt" = now()
        WHERE kind = 'automation'
      `.execute(trx);
    });
  }

  async transitionPhase(expected: ForkSchemaPhase, next: ForkSchemaPhase): Promise<boolean> {
    if (next === 'active') {
      throw new Error('Fork schema activation requires return reconciliation');
    }
    const transitioned = await this.db.transaction().execute(async (trx) => {
      const lockedState = await sql<{ phase: ForkSchemaPhase }>`
        SELECT phase FROM immich_fork.state WHERE id = 1 FOR UPDATE
      `.execute(trx);
      const state = lockedState.rows[0];
      if (!state) {
        throw new Error('Fork schema state is not initialized');
      }
      if (state.phase !== expected) {
        return false;
      }

      await sql`
        UPDATE immich_fork.state
        SET active = false, phase = ${next}, "updatedAt" = now()
        WHERE id = 1
      `.execute(trx);
      return true;
    });
    return transitioned;
  }

  async setPhase(phase: ForkSchemaPhase): Promise<void> {
    if (phase === 'active') {
      throw new Error('Fork schema activation requires return reconciliation');
    }
    await this.db.transaction().execute(async (trx) => {
      const lockedState = await sql<{ id: number }>`
        SELECT id FROM immich_fork.state WHERE id = 1 FOR UPDATE
      `.execute(trx);
      if (!lockedState.rows[0]) {
        throw new Error('Fork schema state is not initialized');
      }

      await sql`
        UPDATE immich_fork.state
        SET active = false, phase = ${phase}, "updatedAt" = now()
        WHERE id = 1
      `.execute(trx);
    });
  }

  async activateAfterReturnReconciliation(): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const lockedState = await sql<{ phase: ForkSchemaPhase }>`
        SELECT phase FROM immich_fork.state WHERE id = 1 FOR UPDATE
      `.execute(trx);
      const state = lockedState.rows[0];
      if (!state) {
        throw new Error('Fork schema state is not initialized');
      }
      if (state.phase !== 'inactive') {
        throw new Error('Fork schema activation requires inactive phase');
      }

      const readiness = await sql<{
        claimToken: string | null;
        claimedCursor: string | null;
        kind: BackfillKind;
        lastError: string | null;
        remaining: number;
      }>`
        SELECT kind, remaining, "claimToken", "claimedCursor", "lastError"
        FROM immich_fork.backfill_progress
        WHERE kind = ANY(${[...BACKFILL_KINDS]})
        FOR UPDATE
      `.execute(trx);
      const allBackfillsComplete =
        readiness.rows.length === BACKFILL_KINDS.length &&
        new Set(readiness.rows.map(({ kind }) => kind)).size === BACKFILL_KINDS.length &&
        readiness.rows.every(
          ({ claimToken, claimedCursor, lastError, remaining }) =>
            remaining === 0 && claimToken === null && claimedCursor === null && lastError === null,
        );
      if (!allBackfillsComplete) {
        throw new Error('Cannot activate fork schema with incomplete backfills');
      }

      await sql`
        UPDATE immich_fork.state
        SET active = true, phase = 'active', "updatedAt" = now()
        WHERE id = 1
      `.execute(trx);
    });
  }

  async beginOrResumeReturnReconciliation(): Promise<void> {
    await this.db
      .transaction()
      .setIsolationLevel('serializable')
      .execute(async (trx) => {
        const lockedState = await sql<{ active: boolean; phase: ForkSchemaPhase; schemaVersion: string }>`
          SELECT active, phase, "schemaVersion"
          FROM immich_fork.state
          WHERE id = 1
          FOR UPDATE
        `.execute(trx);
        const state = lockedState.rows[0];
        if (!state || state.active || state.phase !== 'inactive' || state.schemaVersion !== '2') {
          throw new Error('Fork return reconciliation requires inactive schema version 2 state');
        }

        const auditResult = await sql<{ id: string; status: string }>`
          SELECT id::text AS id, status
          FROM immich_fork.migration_audit
          WHERE name = 'fork-return-reconciliation'
          ORDER BY id DESC
          LIMIT 1
          FOR UPDATE
        `.execute(trx);
        const audit = auditResult.rows[0];
        if (audit?.status === 'applied') {
          return;
        }
        if (audit) {
          if (audit.status !== 'running' && audit.status !== 'failed') {
            throw new Error(`Unsupported fork return reconciliation audit status: ${audit.status}`);
          }
          const progress = await sql<{ kind: string }>`
            SELECT kind FROM immich_fork.backfill_progress ORDER BY kind FOR UPDATE
          `.execute(trx);
          const exactProgress =
            progress.rows.length === BACKFILL_KINDS.length &&
            new Set(progress.rows.map(({ kind }) => kind)).size === BACKFILL_KINDS.length &&
            BACKFILL_KINDS.every((kind) => progress.rows.some((row) => row.kind === kind));
          if (!exactProgress) {
            throw new Error('Fork return reconciliation requires the exact fork return progress set');
          }
          await sql`
            UPDATE immich_fork.migration_audit
            SET status = 'running', "completedAt" = NULL
            WHERE id = ${audit.id}::bigint
          `.execute(trx);
          return;
        }

        await sql`DELETE FROM immich_fork.backfill_progress`.execute(trx);
        for (const kind of BACKFILL_KINDS) {
          const source = getBackfillSource(kind);
          await sql`
            INSERT INTO immich_fork.backfill_progress (kind, remaining)
            SELECT ${kind}, count(*) FROM ${source}
          `.execute(trx);
        }
        await sql`
          INSERT INTO immich_fork.migration_audit (name, phase, status, details)
          VALUES (
            'fork-return-reconciliation',
            'inactive',
            'running',
            jsonb_build_object('backfillKinds', ${[...BACKFILL_KINDS]}::text[])
          )
        `.execute(trx);
      });
  }

  async claimBatch(kind: BackfillKind, size: number): Promise<BackfillClaim | null> {
    return this.claimBatchForMode(kind, size, 'dual-write');
  }

  async claimReturnBatch(kind: BackfillKind, size: number): Promise<BackfillClaim | null> {
    return this.claimBatchForMode(kind, size, 'inactive');
  }

  private async claimBatchForMode(
    kind: BackfillKind,
    size: number,
    mode: 'dual-write' | 'inactive',
  ): Promise<BackfillClaim | null> {
    if (!Number.isSafeInteger(size) || size <= 0) {
      throw new Error('Backfill batch size must be a positive integer');
    }

    return this.db.transaction().execute(async (trx) => {
      const lockedState = await sql<{ phase: ForkSchemaPhase }>`
        SELECT phase FROM immich_fork.state WHERE id = 1 FOR SHARE
      `.execute(trx);
      const state = lockedState.rows[0];
      if (!state) {
        throw new Error('Fork schema state is not initialized');
      }
      if (state.phase !== mode) {
        throw new Error(
          mode === 'inactive'
            ? 'Fork return reconciliation claims require inactive phase'
            : 'Fork schema backfills can only run in dual-write phase',
        );
      }
      if (mode === 'inactive') {
        const audit = await sql<{ running: boolean }>`
          SELECT EXISTS (
            SELECT 1
            FROM immich_fork.migration_audit
            WHERE name = 'fork-return-reconciliation' AND phase = 'inactive' AND status = 'running'
          ) AS running
        `.execute(trx);
        if (!audit.rows[0]?.running) {
          throw new Error('Fork return batch claims require a running return reconciliation audit');
        }
      }

      const source = getBackfillSource(kind);
      const initialRemaining = await sql<{ count: number }>`SELECT count(*)::int AS count FROM ${source}`.execute(trx);
      await sql`
        INSERT INTO immich_fork.backfill_progress (kind, remaining)
        VALUES (${kind}, ${initialRemaining.rows[0]?.count ?? 0})
        ON CONFLICT (kind) DO NOTHING
      `.execute(trx);

      const locked = await sql<BackfillReservation>`
        SELECT
          cursor,
          "claimToken",
          "claimedCursor",
          "claimedIds",
          coalesce("claimExpiresAt" <= now(), false) AS "claimExpired"
        FROM immich_fork.backfill_progress
        WHERE kind = ${kind}
        FOR UPDATE SKIP LOCKED
      `.execute(trx);
      const progress = locked.rows[0];
      if (!progress) {
        return null;
      }

      if (progress.claimToken && !progress.claimExpired) {
        return null;
      }

      if (progress.claimToken && progress.claimedCursor && progress.claimExpired) {
        const claimToken = randomUUID();
        await sql`
          UPDATE immich_fork.backfill_progress
          SET
            "claimToken" = ${claimToken},
            "claimExpiresAt" = now() + ${CLAIM_LEASE},
            "updatedAt" = now()
          WHERE kind = ${kind}
        `.execute(trx);
        return { ids: progress.claimedIds, cursor: claimToken };
      }

      const batch = await sql<{ id: string }>`
        SELECT id::text AS id
        FROM ${source}
        WHERE (${progress.cursor}::text IS NULL OR id::text > ${progress.cursor})
        ORDER BY id::text
        LIMIT ${size}
      `.execute(trx);
      const ids = batch.rows.map(({ id }) => id);
      if (ids.length === 0) {
        await sql`
          UPDATE immich_fork.backfill_progress
          SET remaining = 0, "updatedAt" = now()
          WHERE kind = ${kind} AND remaining <> 0
        `.execute(trx);
        return null;
      }

      const claimedCursor = ids.at(-1)!;
      const claimToken = randomUUID();
      await sql`
        UPDATE immich_fork.backfill_progress
        SET
          "claimedCursor" = ${claimedCursor},
          "claimedIds" = ${ids},
          "claimToken" = ${claimToken},
          "claimExpiresAt" = now() + ${CLAIM_LEASE},
          remaining = (SELECT count(*) FROM ${source} WHERE id::text > coalesce(${progress.cursor}, '')),
          "updatedAt" = now()
        WHERE kind = ${kind}
      `.execute(trx);
      return { ids, cursor: claimToken };
    });
  }

  async completeBatch(kind: BackfillKind, cursor: string, count: number, digest: string): Promise<void> {
    if (!/^[0-9a-f]{64}$/.test(digest)) {
      throw new Error('Backfill digest must be a canonical SHA-256 hex string');
    }

    await this.db.transaction().execute(async (trx) => {
      const locked = await sql<
        Pick<BackfillReservation, 'claimToken' | 'claimedCursor' | 'claimedIds'> & { processed: number }
      >`
        SELECT "claimToken", "claimedCursor", "claimedIds", processed::float8 AS processed
        FROM immich_fork.backfill_progress
        WHERE kind = ${kind}
        FOR UPDATE
      `.execute(trx);
      const progress = locked.rows[0];
      if (!progress || progress.claimToken !== cursor || !progress.claimedCursor) {
        throw new Error('Backfill reservation does not match completion cursor');
      }
      if (!Number.isSafeInteger(count) || count !== progress.claimedIds.length) {
        throw new Error('Backfill processed count must equal the reserved batch size');
      }

      const source = getBackfillSource(kind);
      const remaining = await sql<{ count: number }>`
        SELECT count(*)::int AS count FROM ${source} WHERE id::text > ${progress.claimedCursor}
      `.execute(trx);
      const audits = await sql<{ details: Record<string, unknown>; id: string }>`
        SELECT id::text AS id, coalesce(details, '{}'::jsonb) AS details
        FROM immich_fork.migration_audit
        WHERE name = 'fork-return-reconciliation' AND phase = 'inactive' AND status = 'running'
        ORDER BY id
        FOR UPDATE
      `.execute(trx);
      if (audits.rows.length > 1) {
        throw new Error('Fork return batch completion requires exactly one running reconciliation audit');
      }
      let storedDigest = digest;
      const audit = audits.rows[0];
      if (audit) {
        const evidence = (audit.details.backfillEvidence ?? {}) as ReturnBackfillEvidence;
        const current = evidence[kind];
        if (current && current.processed !== progress.processed) {
          throw new Error(`Fork return ${kind} backfill evidence processed count drifted`);
        }
        const batches = [...(current?.batches ?? []), { count, digest, endCursor: progress.claimedCursor }];
        const next: ReturnBackfillKindEvidence = {
          batches,
          cumulativeDigest: canonicalReturnBackfillDigest(batches),
          processed: progress.processed + count,
        };
        storedDigest = next.cumulativeDigest;
        await sql`
          UPDATE immich_fork.migration_audit
          SET details = jsonb_set(
            coalesce(details, '{}'::jsonb),
            '{backfillEvidence}',
            coalesce(details -> 'backfillEvidence', '{}'::jsonb) || jsonb_build_object(${kind}::text, ${next}::jsonb),
            true
          )
          WHERE id = ${audit.id}::bigint
        `.execute(trx);
      }
      await sql`
        UPDATE immich_fork.backfill_progress
        SET
          cursor = ${progress.claimedCursor},
          processed = processed + ${count},
          remaining = ${remaining.rows[0]?.count ?? 0},
          digest = ${storedDigest},
          "lastError" = NULL,
          "claimedCursor" = NULL,
          "claimedIds" = '{}',
          "claimToken" = NULL,
          "claimExpiresAt" = NULL,
          "updatedAt" = now()
        WHERE kind = ${kind}
      `.execute(trx);
    });
  }

  async failBatch(kind: BackfillKind, cursor: string, error: string): Promise<void> {
    if (!error.trim()) {
      throw new Error('Backfill failure must include an error message');
    }

    await this.db.transaction().execute(async (trx) => {
      const locked = await sql<{ claimToken: string | null }>`
        SELECT "claimToken"
        FROM immich_fork.backfill_progress
        WHERE kind = ${kind}
        FOR UPDATE
      `.execute(trx);
      if (locked.rows[0]?.claimToken !== cursor) {
        throw new Error('Backfill reservation does not match failure cursor');
      }

      await sql`
        UPDATE immich_fork.backfill_progress
        SET
          "lastError" = ${error},
          "claimedCursor" = NULL,
          "claimedIds" = '{}',
          "claimToken" = NULL,
          "claimExpiresAt" = NULL,
          "updatedAt" = now()
        WHERE kind = ${kind}
      `.execute(trx);
    });
  }
}
