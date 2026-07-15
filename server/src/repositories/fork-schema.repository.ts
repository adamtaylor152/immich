import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { randomUUID } from 'node:crypto';
import { SystemConfig } from 'src/config';
import { DB } from 'src/schema';
import { DeepPartial } from 'src/types';
import { clearRegisteredConfigCache } from 'src/utils/config-cache';

export type ForkSchemaPhase = 'legacy' | 'dual-write' | 'ready' | 'inactive' | 'active' | 'failed';
export type BackfillKind = 'privacy' | 'albums' | 'enrichment' | 'automation' | 'health' | 'storage' | 'checksum';
export type ForkState = {
  active: boolean;
  phase: ForkSchemaPhase;
  schemaVersion: string;
  upstreamVersion: string;
};
export type BackfillClaim = { ids: string[]; cursor: string };

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
    if (state.phase === 'legacy' || state.phase === 'dual-write') {
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
    if (state.phase === 'legacy') {
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
      if (state.rows[0].phase !== 'legacy') {
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

  async transitionPhase(expected: ForkSchemaPhase, next: ForkSchemaPhase): Promise<boolean> {
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
        SET active = ${next === 'active'}, phase = ${next}, "updatedAt" = now()
        WHERE id = 1
      `.execute(trx);
      return true;
    });
    if (transitioned) {
      clearRegisteredConfigCache();
    }
    return transitioned;
  }

  async setPhase(phase: ForkSchemaPhase): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const lockedState = await sql<{ id: number }>`
        SELECT id FROM immich_fork.state WHERE id = 1 FOR UPDATE
      `.execute(trx);
      if (!lockedState.rows[0]) {
        throw new Error('Fork schema state is not initialized');
      }

      if (phase === 'active') {
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
      }

      await sql`
        UPDATE immich_fork.state
        SET active = ${phase === 'active'}, phase = ${phase}, "updatedAt" = now()
        WHERE id = 1
      `.execute(trx);
    });
    clearRegisteredConfigCache();
  }

  async claimBatch(kind: BackfillKind, size: number): Promise<BackfillClaim | null> {
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
      if (state.phase !== 'dual-write') {
        throw new Error('Fork schema backfills can only run in dual-write phase');
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
        FOR UPDATE SKIP LOCKED
      `.execute(trx);
      const ids = batch.rows.map(({ id }) => id);
      if (ids.length === 0) {
        await sql`
          UPDATE immich_fork.backfill_progress
          SET remaining = 0, "updatedAt" = now()
          WHERE kind = ${kind}
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
      const locked = await sql<Pick<BackfillReservation, 'claimToken' | 'claimedCursor' | 'claimedIds'>>`
        SELECT "claimToken", "claimedCursor", "claimedIds"
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
      await sql`
        UPDATE immich_fork.backfill_progress
        SET
          cursor = ${progress.claimedCursor},
          processed = processed + ${count},
          remaining = ${remaining.rows[0]?.count ?? 0},
          digest = ${digest},
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
