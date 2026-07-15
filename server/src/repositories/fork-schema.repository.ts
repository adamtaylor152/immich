import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DB } from 'src/schema';

export type ForkSchemaPhase = 'legacy' | 'dual-write' | 'ready' | 'inactive' | 'active' | 'failed';
export type BackfillKind = 'privacy' | 'albums' | 'enrichment' | 'automation' | 'health' | 'storage' | 'checksum';
export type ForkState = {
  active: boolean;
  phase: ForkSchemaPhase;
  schemaVersion: string;
  upstreamVersion: string;
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

type BackfillProgress = {
  claimExpired: boolean;
  claimedCursor: string | null;
  claimedIds: string[];
  cursor: string | null;
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

  async setPhase(phase: ForkSchemaPhase): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      if (phase === 'active') {
        const readiness = await sql<{
          claimedCursor: string | null;
          kind: BackfillKind;
          lastError: string | null;
          remaining: number;
        }>`
          SELECT kind, remaining, "claimedCursor", "lastError"
          FROM immich_fork.backfill_progress
          WHERE kind = ANY(${[...BACKFILL_KINDS]})
          FOR UPDATE
        `.execute(trx);
        const allBackfillsComplete =
          readiness.rows.length === BACKFILL_KINDS.length &&
          new Set(readiness.rows.map(({ kind }) => kind)).size === BACKFILL_KINDS.length &&
          readiness.rows.every(
            ({ claimedCursor, lastError, remaining }) =>
              remaining === 0 && claimedCursor === null && lastError === null,
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
  }

  async claimBatch(kind: BackfillKind, size: number): Promise<string[]> {
    if (!Number.isSafeInteger(size) || size <= 0) {
      throw new Error('Backfill batch size must be a positive integer');
    }

    return this.db.transaction().execute(async (trx) => {
      const source = getBackfillSource(kind);
      const initialRemaining = await sql<{ count: number }>`SELECT count(*)::int AS count FROM ${source}`.execute(trx);
      await sql`
        INSERT INTO immich_fork.backfill_progress (kind, remaining)
        VALUES (${kind}, ${initialRemaining.rows[0]?.count ?? 0})
        ON CONFLICT (kind) DO NOTHING
      `.execute(trx);

      const locked = await sql<BackfillProgress>`
        SELECT
          cursor,
          "claimedCursor",
          "claimedIds",
          coalesce("claimExpiresAt" <= now(), false) AS "claimExpired"
        FROM immich_fork.backfill_progress
        WHERE kind = ${kind}
        FOR UPDATE SKIP LOCKED
      `.execute(trx);
      const progress = locked.rows[0];
      if (!progress) {
        return [];
      }

      if (progress.claimedCursor && !progress.claimExpired) {
        return [];
      }

      if (progress.claimedCursor && progress.claimExpired) {
        await sql`
          UPDATE immich_fork.backfill_progress
          SET "claimExpiresAt" = now() + ${CLAIM_LEASE}, "updatedAt" = now()
          WHERE kind = ${kind}
        `.execute(trx);
        return progress.claimedIds;
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
        return [];
      }

      const claimedCursor = ids.at(-1)!;
      await sql`
        UPDATE immich_fork.backfill_progress
        SET
          "claimedCursor" = ${claimedCursor},
          "claimedIds" = ${ids},
          "claimExpiresAt" = now() + ${CLAIM_LEASE},
          remaining = (SELECT count(*) FROM ${source} WHERE id::text > coalesce(${progress.cursor}, '')),
          "updatedAt" = now()
        WHERE kind = ${kind}
      `.execute(trx);
      return ids;
    });
  }

  async completeBatch(kind: BackfillKind, cursor: string, count: number, digest: string): Promise<void> {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error('Backfill processed count must be a non-negative integer');
    }

    await this.db.transaction().execute(async (trx) => {
      const locked = await sql<Pick<BackfillProgress, 'claimedCursor' | 'claimedIds'>>`
        SELECT "claimedCursor", "claimedIds"
        FROM immich_fork.backfill_progress
        WHERE kind = ${kind}
        FOR UPDATE
      `.execute(trx);
      const progress = locked.rows[0];
      if (!progress || progress.claimedCursor !== cursor || progress.claimedIds.at(-1) !== cursor) {
        throw new Error('Backfill reservation does not match completion cursor');
      }
      if (count > progress.claimedIds.length) {
        throw new Error('Backfill processed count exceeds the reserved batch size');
      }

      const source = getBackfillSource(kind);
      const remaining = await sql<{ count: number }>`
        SELECT count(*)::int AS count FROM ${source} WHERE id::text > ${cursor}
      `.execute(trx);
      await sql`
        UPDATE immich_fork.backfill_progress
        SET
          cursor = ${cursor},
          processed = processed + ${count},
          remaining = ${remaining.rows[0]?.count ?? 0},
          digest = ${digest},
          "lastError" = NULL,
          "claimedCursor" = NULL,
          "claimedIds" = '{}',
          "claimExpiresAt" = NULL,
          "updatedAt" = now()
        WHERE kind = ${kind}
      `.execute(trx);
    });
  }
}
