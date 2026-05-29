import { Kysely, sql } from 'kysely';

/**
 * Denormalize NSFW state from asset_metadata JSONB → asset.is_nsfw column.
 *
 * Before this migration the privacy gate `nsfwAssetIdExists` did a correlated
 * `EXISTS (... asset_metadata.value #>> ...)` subquery on every privacy-filtered
 * read. The subquery scans 4 nested JSON paths + a regex against the description,
 * with no index. On libraries with >50k described assets it turns hot paths
 * (timeline, smart-search, albums) into seq-scans.
 *
 * Using a plain boolean column with a partial index reduces the predicate to a
 * single index probe. The column is owned by `image-enrichment.service`, which
 * writes to it inside the per-asset advisory lock alongside the JSONB blob.
 *
 * Naming: `2100xxxxxxxxx-` prefix is the fork-only timestamp convention to keep
 * future fork migrations from colliding with upstream's incrementing timestamps.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "asset" ADD COLUMN IF NOT EXISTS "is_nsfw" boolean NOT NULL DEFAULT false;`.execute(db);

  // Backfill in batches so we don't lock the asset table for minutes on large
  // libraries. Each batch covers ~10k rows; the WHERE-clause uses the existing
  // JSONB-derived predicate from utils/database.ts so initial state is correct.
  let updated = 0;
   
  while (true) {
    const result = await sql`
      WITH candidates AS (
        SELECT a.id
        FROM "asset" a
        WHERE a."is_nsfw" = false
          AND EXISTS (
            SELECT 1
            FROM asset_metadata am
            WHERE am."assetId" = a.id
              AND am.key = 'ml-enrichment'
              AND CASE
                WHEN am.value #> '{nsfwDetection,review}' IS NOT NULL THEN
                  COALESCE((am.value #>> '{nsfwDetection,review,isNsfw}')::boolean, false)
                ELSE
                  COALESCE(
                    (am.value #>> '{nsfwDetection,result,isNsfw}')::boolean,
                    (am.value #>> '{nsfwDetection,result,nsfw}')::boolean,
                    false
                  )
                  OR (
                    COALESCE((am.value #>> '{description,result,safety,is_nsfw_likely}')::boolean, false)
                    AND LOWER(COALESCE(am.value #>> '{description,result,safety,confidence}', '')) = 'high'
                  )
              END = true
          )
        LIMIT 10000
      )
      UPDATE "asset" SET "is_nsfw" = true WHERE id IN (SELECT id FROM candidates);
    `.execute(db);
    const rows = Number(result.numAffectedRows ?? 0n);
    updated += rows;
    if (rows === 0) {
      break;
    }
  }

  await sql`CREATE INDEX IF NOT EXISTS "idx_asset_is_nsfw" ON "asset" ("is_nsfw") WHERE "is_nsfw" = true;`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_idx_asset_is_nsfw', '{"type":"index","name":"idx_asset_is_nsfw","sql":"CREATE INDEX \\"idx_asset_is_nsfw\\" ON \\"asset\\" (\\"is_nsfw\\") WHERE \\"is_nsfw\\" = true;"}'::jsonb) ON CONFLICT ("name") DO NOTHING;`.execute(
    db,
  );

  // Log how many rows we backfilled — useful for ops debugging.
   
  console.log(`[migration 2100000000010] backfilled is_nsfw=true on ${updated} asset rows`);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_idx_asset_is_nsfw';`.execute(db);
  await sql`DROP INDEX IF EXISTS "idx_asset_is_nsfw";`.execute(db);
  await sql`ALTER TABLE "asset" DROP COLUMN IF EXISTS "is_nsfw";`.execute(db);
}
