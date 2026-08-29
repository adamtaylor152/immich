import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { createHash } from 'node:crypto';
import { isForkAuthoritative, isForkWriteEnabled } from 'src/fork-schema/authority';
import type { ForkSchemaPhase } from 'src/repositories/fork-schema.repository';
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

export const canonicalize = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map((item) => canonicalize(item))
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonicalize(v)]),
        )
      : value;
export const digest = (value: unknown) =>
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
    if (!isForkWriteEnabled(await this.getPhase(kysely))) {
      return;
    }
    await this.backfill([assetId], kysely);
  }

  async initialize(assetIds: string[], kysely: Kysely<DB> = this.db): Promise<void> {
    if (assetIds.length === 0 || !isForkWriteEnabled(await this.getPhase(kysely))) {
      return;
    }
    await sql`
      INSERT INTO immich_fork.asset_enrichment ("assetId")
      SELECT id FROM asset WHERE id = ANY(${assetIds}::uuid[])
      ON CONFLICT ("assetId") DO NOTHING
    `.execute(kysely);
  }

  async delete(assetIds: string[], kysely: Kysely<DB> = this.db): Promise<void> {
    if (assetIds.length > 0 && isForkWriteEnabled(await this.getPhase(kysely))) {
      await sql`DELETE FROM immich_fork.asset_enrichment WHERE "assetId" = ANY(${assetIds}::uuid[])`.execute(kysely);
    }
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
    if (!isForkWriteEnabled(phase)) {
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
    return isForkAuthoritative(phase);
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
        .matchAll(/(?:^|\n\n)AI description: ([\s\S]*?)(?=\n\n|$)/g)
        .map((match) => match[1] ?? '')
        .toArray();
      const sidecarDescription =
        generated.description ?? (textGeneratedDescriptions.length > 0 ? textGeneratedDescriptions.join('\n\n') : null);
      const block =
        generated.description === null || generated.description === undefined
          ? null
          : `${prefix}${generated.description}`;
      const storedHash =
        row.provenance.description?.status === 'success'
          ? row.provenance.description.appliedDescriptionHash
          : undefined;
      const exactMatches = block ? this.findExactParagraphs(row.description, block) : [];
      const proven = !!block && storedHash === descriptionHash(generated.description!) && exactMatches.length === 1;
      const appliedTagValues =
        row.provenance.description?.status === 'success' ? row.provenance.description.appliedTagValues : undefined;
      const provenTags =
        Array.isArray(appliedTagValues) &&
        row.provenance.description.appliedTagHash === descriptionHash(appliedTagValues);
      const userDescription = proven ? this.removeExactParagraph(row.description, exactMatches[0]!) : row.description;
      const requiresReview =
        (textGeneratedDescriptions.length > 0 && !proven) || (generated.tags.length > 0 && !provenTags);
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

  private findExactParagraphs(value: string, block: string): Array<{ start: number; end: number }> {
    const matches: Array<{ start: number; end: number }> = [];
    let offset = 0;
    while ((offset = value.indexOf(block, offset)) >= 0) {
      const end = offset + block.length;
      const startsAtBoundary = offset === 0 || value.slice(offset - 2, offset) === '\n\n';
      const endsAtBoundary = end === value.length || value.slice(end, end + 2) === '\n\n';
      if (startsAtBoundary && endsAtBoundary) {
        matches.push({ start: offset, end });
      }
      offset = end;
    }
    return matches;
  }

  private removeExactParagraph(value: string, match: { start: number; end: number }): string {
    if (match.start > 0) {
      return value.slice(0, match.start - 2) + value.slice(match.end);
    }
    if (value.slice(match.end, match.end + 2) === '\n\n') {
      return value.slice(match.end + 2);
    }
    return value.slice(match.end);
  }

  private async getMany(ids: string[], kysely: Kysely<DB>) {
    const result = await sql<EnrichmentSidecar>`
      SELECT "assetId"::text AS "assetId", provenance, "userDescription", "generatedDescription", "generatedTags", "requiresReview"
      FROM immich_fork.asset_enrichment WHERE "assetId" = ANY(${ids}::uuid[]) ORDER BY "assetId"::text
    `.execute(kysely);
    return result.rows;
  }

  private async getPhase(kysely: Kysely<DB>): Promise<ForkSchemaPhase> {
    const exists = await sql<{ table: string | null }>`SELECT to_regclass('immich_fork.state')::text AS table`.execute(
      kysely,
    );
    if (!exists.rows[0]?.table) {
      return 'legacy';
    }
    const result = await sql<{ phase: ForkSchemaPhase }>`SELECT phase FROM immich_fork.state WHERE id = 1`.execute(
      kysely,
    );
    return result.rows[0]?.phase ?? 'inactive';
  }
}
