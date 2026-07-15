import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { createHash } from 'node:crypto';
import { DB } from 'src/schema';

export type EnrichmentSidecar = {
  assetId: string;
  provenance: Record<string, unknown>;
  userDescription: string;
  generatedDescription: string | null;
  generatedTags: string[];
  requiresReview: boolean;
};
export type EnrichmentBatchResult = { count: number; digest: string };

const canonicalize = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map((item) => canonicalize(item))
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonicalize(v)]),
        )
      : value;
const digest = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
const descriptionHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const prefix = 'AI description: ';

type LegacyRow = { assetId: string; description: string; provenance: Record<string, any> };

@Injectable()
export class ForkEnrichmentRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  async backfillEnrichment(ids: string[]): Promise<EnrichmentBatchResult> {
    return this.db.transaction().execute((trx) => this.backfill(ids, trx));
  }

  async mirrorFromLegacy(assetId: string, kysely: Kysely<DB> = this.db): Promise<void> {
    if ((await this.getPhase(kysely)) === 'legacy') {
      return;
    }
    await this.backfill([assetId], kysely);
  }

  async get(assetId: string, kysely: Kysely<DB> = this.db): Promise<EnrichmentSidecar | undefined> {
    const result = await sql<EnrichmentSidecar>`
      SELECT "assetId"::text AS "assetId", provenance, "userDescription", "generatedDescription",
        "generatedTags", "requiresReview"
      FROM immich_fork.asset_enrichment WHERE "assetId" = ${assetId}::uuid
    `.execute(kysely);
    return result.rows[0];
  }

  async save(assetId: string, provenance: Record<string, unknown>, kysely: Kysely<DB> = this.db): Promise<void> {
    const phase = await this.getPhase(kysely);
    if (phase === 'legacy') {
      return;
    }
    const existing = await this.get(assetId, kysely);
    const generated = this.generatedFields(provenance as Record<string, any>);
    await sql`
      INSERT INTO immich_fork.asset_enrichment
        ("assetId", provenance, "userDescription", "generatedDescription", "generatedTags", "requiresReview")
      VALUES (${assetId}::uuid, ${provenance}::jsonb, ${existing?.userDescription ?? ''},
        ${generated.description}, ${generated.tags}::jsonb, ${existing?.requiresReview ?? false})
      ON CONFLICT ("assetId") DO UPDATE SET provenance = EXCLUDED.provenance,
        "generatedDescription" = EXCLUDED."generatedDescription", "generatedTags" = EXCLUDED."generatedTags", "updatedAt" = now()
    `.execute(kysely);
  }

  async shouldReadSidecar(kysely: Kysely<DB> = this.db): Promise<boolean> {
    const phase = await this.getPhase(kysely);
    return phase !== 'legacy' && phase !== 'dual-write';
  }

  private async backfill(ids: string[], kysely: Kysely<DB>): Promise<EnrichmentBatchResult> {
    if (ids.length === 0) {
      return { count: 0, digest: digest([]) };
    }
    const legacy = await sql<LegacyRow>`
      SELECT asset.id::text AS "assetId", COALESCE(exif.description, '') AS description,
        COALESCE(metadata.value, '{}'::jsonb) AS provenance
      FROM asset
      LEFT JOIN asset_exif exif ON exif."assetId" = asset.id
      LEFT JOIN asset_metadata metadata ON metadata."assetId" = asset.id AND metadata.key = 'ml-enrichment'
      WHERE asset.id = ANY(${ids}::uuid[]) ORDER BY asset.id::text
    `.execute(kysely);
    const found = legacy.rows.map((row) => row.assetId);
    await sql`DELETE FROM immich_fork.asset_enrichment WHERE "assetId" = ANY(${ids}::uuid[]) AND NOT ("assetId" = ANY(${found}::uuid[]))`.execute(
      kysely,
    );
    for (const row of legacy.rows) {
      const generated = this.generatedFields(row.provenance);
      const textGeneratedDescriptions = row.description
        .split('\n\n')
        .filter((part) => part.startsWith(prefix))
        .map((part) => part.slice(prefix.length));
      const sidecarDescription =
        generated.description ?? (textGeneratedDescriptions.length > 0 ? textGeneratedDescriptions.join('\n\n') : null);
      const block = generated.description == null ? null : `${prefix}${generated.description}`;
      const storedHash =
        row.provenance.description?.status === 'success'
          ? row.provenance.description.appliedDescriptionHash
          : undefined;
      const proven =
        !!block &&
        storedHash === descriptionHash(generated.description!) &&
        row.description.split('\n\n').includes(block);
      const appliedTagValues =
        row.provenance.description?.status === 'success' ? row.provenance.description.appliedTagValues : undefined;
      const provenTags =
        Array.isArray(appliedTagValues) &&
        row.provenance.description.appliedTagHash === descriptionHash(appliedTagValues);
      const userDescription = proven
        ? row.description
            .split('\n\n')
            .filter((part) => part !== block)
            .join('\n\n')
        : row.description;
      const requiresReview =
        (textGeneratedDescriptions.length > 0 && !proven) ||
        (!!row.provenance.description?.appliedTagHash && !provenTags);
      await sql`
        INSERT INTO immich_fork.asset_enrichment
          ("assetId", provenance, "userDescription", "generatedDescription", "generatedTags", "requiresReview")
        VALUES (${row.assetId}::uuid, ${row.provenance}::jsonb, ${userDescription}, ${sidecarDescription}, ${generated.tags}::jsonb, ${requiresReview})
        ON CONFLICT ("assetId") DO UPDATE SET provenance = EXCLUDED.provenance,
          "userDescription" = EXCLUDED."userDescription", "generatedDescription" = EXCLUDED."generatedDescription",
          "generatedTags" = EXCLUDED."generatedTags", "requiresReview" = EXCLUDED."requiresReview", "updatedAt" = now()
      `.execute(kysely);
      if (proven && userDescription !== row.description) {
        await sql`UPDATE asset_exif SET description = ${userDescription} WHERE "assetId" = ${row.assetId}::uuid`.execute(
          kysely,
        );
      }
      if (provenTags && appliedTagValues.length > 0) {
        await sql`
          DELETE FROM tag_asset USING tag
          WHERE tag_asset."tagId" = tag.id
            AND tag_asset."assetId" = ${row.assetId}::uuid
            AND tag.value = ANY(${appliedTagValues})
        `.execute(kysely);
      }
    }
    const rows = await this.getMany(ids, kysely);
    return { count: ids.length, digest: digest(rows) };
  }

  private generatedFields(provenance: Record<string, any>) {
    const task = provenance.description;
    if (task?.status !== 'success') {
      return { description: null, tags: [] as string[] };
    }
    const tags = task.appliedTagValues ?? task.result?.tags ?? [];
    return { description: typeof task.result?.description === 'string' ? task.result.description : null, tags };
  }

  private async getMany(ids: string[], kysely: Kysely<DB>) {
    const result = await sql<EnrichmentSidecar>`
      SELECT "assetId"::text AS "assetId", provenance, "userDescription", "generatedDescription", "generatedTags", "requiresReview"
      FROM immich_fork.asset_enrichment WHERE "assetId" = ANY(${ids}::uuid[]) ORDER BY "assetId"::text
    `.execute(kysely);
    return result.rows;
  }

  private async getPhase(kysely: Kysely<DB>): Promise<string> {
    const exists = await sql<{ table: string | null }>`SELECT to_regclass('immich_fork.state')::text AS table`.execute(
      kysely,
    );
    if (!exists.rows[0]?.table) {
      return 'legacy';
    }
    const result = await sql<{ phase: string }>`SELECT phase FROM immich_fork.state WHERE id = 1`.execute(kysely);
    return result.rows[0]?.phase ?? 'inactive';
  }
}
