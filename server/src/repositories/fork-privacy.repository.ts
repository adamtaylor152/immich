import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { createHash } from 'node:crypto';
import { isForkAuthoritative } from 'src/fork-schema/authority';
import type { ForkSchemaPhase } from 'src/repositories/fork-schema.repository';
import { DB } from 'src/schema';

export type PrivacySidecar = {
  assetId: string;
  isNsfw: boolean;
  suppression: Record<string, unknown> | null;
};

export type BatchResult = { count: number; digest: string };

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
};

const digestRows = (rows: PrivacySidecar[]) =>
  createHash('sha256')
    .update(JSON.stringify(canonicalize(rows)))
    .digest('hex');

@Injectable()
export class ForkPrivacyRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  async backfillPrivacy(ids: string[]): Promise<BatchResult> {
    return this.db.transaction().execute((trx) => this.backfill(ids, trx));
  }

  async mirrorFromLegacy(assetId: string, kysely: Kysely<DB> = this.db): Promise<void> {
    await this.mirrorManyFromLegacy([assetId], kysely);
  }

  async mirrorManyFromLegacy(assetIds: string[], kysely: Kysely<DB> = this.db): Promise<void> {
    if (assetIds.length === 0) {
      return;
    }
    const phase = await this.getPhase(kysely);
    if (phase === 'legacy') {
      return;
    }
    await this.backfill(assetIds, kysely);
  }

  async get(assetId: string, kysely: Kysely<DB> = this.db): Promise<PrivacySidecar | undefined> {
    const result = await sql<PrivacySidecar>`
      SELECT "assetId", "isNsfw", suppression
      FROM immich_fork.asset_privacy
      WHERE "assetId" = ${assetId}::uuid
    `.execute(kysely);
    return result.rows[0];
  }

  async delete(assetIds: string[], kysely: Kysely<DB> = this.db): Promise<void> {
    if (assetIds.length > 0) {
      await sql`DELETE FROM immich_fork.asset_privacy WHERE "assetId" = ANY(${assetIds}::uuid[])`.execute(kysely);
    }
  }

  async shouldReadSidecar(kysely: Kysely<DB> = this.db): Promise<boolean> {
    const phase = await this.getPhase(kysely);
    return isForkAuthoritative(phase);
  }

  private async backfill(ids: string[], kysely: Kysely<DB>): Promise<BatchResult> {
    if (ids.length === 0) {
      return { count: 0, digest: digestRows([]) };
    }

    const legacy = await sql<PrivacySidecar>`
      SELECT
        asset.id::text AS "assetId",
        asset.is_nsfw AS "isNsfw",
        metadata.value -> 'nsfwDetection' -> 'review' AS suppression
      FROM asset
      LEFT JOIN asset_metadata AS metadata
        ON metadata."assetId" = asset.id
       AND metadata.key = 'ml-enrichment'
      WHERE asset.id = ANY(${ids}::uuid[])
      ORDER BY asset.id::text
    `.execute(kysely);

    await sql`
      DELETE FROM immich_fork.asset_privacy
      WHERE "assetId" = ANY(${ids}::uuid[])
        AND NOT ("assetId" = ANY(${legacy.rows.map(({ assetId }) => assetId)}::uuid[]))
    `.execute(kysely);

    for (const row of legacy.rows) {
      await sql`
        INSERT INTO immich_fork.asset_privacy ("assetId", "isNsfw", suppression)
        VALUES (${row.assetId}::uuid, ${row.isNsfw}, ${row.suppression}::jsonb)
        ON CONFLICT ("assetId") DO UPDATE
        SET
          "isNsfw" = EXCLUDED."isNsfw",
          suppression = EXCLUDED.suppression,
          "updatedAt" = now()
      `.execute(kysely);
    }

    const canonical = await this.getMany(ids, kysely);
    return { count: ids.length, digest: digestRows(canonical) };
  }

  private async getMany(ids: string[], kysely: Kysely<DB>): Promise<PrivacySidecar[]> {
    const result = await sql<PrivacySidecar>`
      SELECT "assetId"::text AS "assetId", "isNsfw", suppression
      FROM immich_fork.asset_privacy
      WHERE "assetId" = ANY(${ids}::uuid[])
      ORDER BY "assetId"::text
    `.execute(kysely);
    return result.rows;
  }

  private async getPhase(kysely: Kysely<DB>): Promise<ForkSchemaPhase> {
    const schema = await sql<{ stateTable: string | null }>`
      SELECT to_regclass('immich_fork.state')::text AS "stateTable"
    `.execute(kysely);
    if (!schema.rows[0]?.stateTable) {
      return 'legacy';
    }
    const result = await sql<{ phase: ForkSchemaPhase }>`SELECT phase FROM immich_fork.state WHERE id = 1`.execute(
      kysely,
    );
    return result.rows[0]?.phase ?? 'inactive';
  }
}
