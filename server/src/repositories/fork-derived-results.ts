import { Kysely, sql } from 'kysely';
import { createHash } from 'node:crypto';
import { ForkSchemaPhase } from 'src/repositories/fork-schema.repository';
import { DB } from 'src/schema';

export type TableVerification = { count: number; digest: string };
export type DerivedBackfillResult<Tables extends Record<string, TableVerification>> = TableVerification & {
  tables: Tables;
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
};

export const digestValue = (value: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');

export const verifyRows = (rows: unknown[]): TableVerification => ({ count: rows.length, digest: digestValue(rows) });

export const combineVerifications = <T extends Record<string, TableVerification>>(
  processed: number,
  tables: T,
): DerivedBackfillResult<T> => ({ count: processed, digest: digestValue(tables), tables });

export const getForkSchemaPhase = async (db: Kysely<DB>): Promise<ForkSchemaPhase> => {
  const schema = await sql<{ stateTable: string | null }>`
    SELECT to_regclass('immich_fork.state')::text AS "stateTable"
  `.execute(db);
  if (!schema.rows[0]?.stateTable) {
    return 'legacy';
  }
  const state = await sql<{ phase: ForkSchemaPhase }>`SELECT phase FROM immich_fork.state WHERE id = 1`.execute(db);
  return state.rows[0]?.phase ?? 'inactive';
};

export const readsForkSidecar = (phase: ForkSchemaPhase): boolean => phase !== 'legacy' && phase !== 'dual-write';
export const writesLegacy = (phase: ForkSchemaPhase): boolean => phase === 'legacy' || phase === 'dual-write';
export const writesForkSidecar = (phase: ForkSchemaPhase): boolean => phase !== 'legacy';
