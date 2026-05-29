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
 * Operator note (very large libraries):
 *   Kysely's `Migrator` wraps every migration in a transaction, and Postgres
 *   does not allow `CREATE INDEX CONCURRENTLY` inside a transaction. Plain
 *   `CREATE INDEX` takes a brief ACCESS EXCLUSIVE lock on `asset` which blocks
 *   writers for the duration of the build. For libraries large enough that
 *   this is painful, the recommended pre-deployment step is:
 *
 *     CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_asset_is_nsfw"
 *       ON "asset" ("is_nsfw") WHERE "is_nsfw" = true;
 *
 *   Run this against the live DB BEFORE deploying the new server. The
 *   migration below uses `IF NOT EXISTS` and will no-op the index step if
 *   the partial index already exists. The `migration_overrides` row is
 *   independent of how the index was created and is still registered.
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
   
  // Predicate alignment note:
  //   The description-side branch tries to track the runtime `isDescriptionNsfwLikely`
  //   (server/src/services/image-enrichment.service.ts:1045-1058) which requires:
  //     (1) safety.is_nsfw_likely = true
  //     (2) safety.confidence = 'high' (case-insensitive)
  //     (3) any of safety.indicators matches STRONG_NSFW_INDICATORS,
  //         OR safety.description/reason matches STRONG_NSFW_TEXT_PATTERN
  //
  //   The SQL implements (1), (2), and an approximation of (3): the indicator
  //   array is converted to a single space-joined string and probed with a
  //   word-boundary regex covering the strong set, AND the description+reason
  //   text is matched against the runtime's strong-text pattern (translated
  //   from JS `\b` to Postgres `\y`). The JS code normalizes each indicator
  //   (`replaceAll(/[^a-z0-9 _-]/g, '')` etc.) before set lookup — the SQL
  //   approximates this with a lower() + regex over the full array.
  //
  //   Edge cases where SQL disagrees with runtime:
  //     - Indicators with unusual punctuation: runtime normalizes,
  //       SQL just lower-cases. False-positive risk: very small (indicators
  //       are typically already lower-snake-case).
  //     - Indicators that exactly match a tag but contain hyphen variants:
  //       SQL covers via the `(genitals?|bare[- ]?buttocks|sex[- ]?toy)` style
  //       alternation below.
  //   The tighter predicate replaces the previous looser one
  //   (is_nsfw_likely AND confidence=high) which over-marked any high-confidence
  //   safety verdict, regardless of whether the strong indicators were present.
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
                    AND (
                      -- (3a) any indicator matches a strong NSFW tag (approximates STRONG_NSFW_INDICATORS)
                      LOWER(COALESCE((
                        SELECT string_agg(value, ' ')
                        FROM jsonb_array_elements_text(
                          COALESCE(am.value #> '{description,result,safety,indicators}', '[]'::jsonb)
                        )
                      ), '')) ~ '\y(adult[- ]?nudity|bare[- ]?buttocks|bondage|explicit|exposed[- ]?genitals|genitals?|naked|nude|nudity|pornography|restrained|restraint|sex[- ]?toy|sexual[- ]?activity)\y'
                      OR
                      -- (3b) description or reason matches strong text pattern (STRONG_NSFW_TEXT_PATTERN)
                      LOWER(COALESCE(am.value #>> '{description,result,description}', '') || ' ' ||
                            COALESCE(am.value #>> '{description,result,safety,reason}', '')
                      ) ~ '\y(naked|nude|nudity|genitals?|penis|vagina|buttocks?|sexual activity|sex toy|bondage|restrained|restraint)\y'
                    )
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

  // Partial index on the TRUE side only. The complementary `WHERE is_nsfw = false`
  // direction is intentionally NOT indexed:
  //  - Postgres only uses a partial index when the query predicate implies the
  //    partial's WHERE clause, so a `WHERE is_nsfw != true` filter would not
  //    consume an index on `WHERE is_nsfw = false` anyway.
  //  - Almost all rows have `is_nsfw = false`, so the false-side index would
  //    cover nearly the whole table — the storage cost approaches that of a
  //    full b-tree on `is_nsfw` for marginal selectivity benefit.
  //  - The hot privacy-gate query is the "is THIS asset NSFW" probe (see
  //    `nsfwAssetIdExists`), which always reads the TRUE side.
  await sql`CREATE INDEX IF NOT EXISTS "idx_asset_is_nsfw" ON "asset" ("is_nsfw") WHERE "is_nsfw" = true;`.execute(db);
  // The override SQL must byte-match `asIndexCreate` for the AssetTable @Index
  // declaration of idx_asset_is_nsfw (where: 'is_nsfw = true') so schema:generate
  // stays clean. ON CONFLICT DO UPDATE corrects any previously-registered value.
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_idx_asset_is_nsfw', '{"type":"index","name":"idx_asset_is_nsfw","sql":"CREATE INDEX \\"idx_asset_is_nsfw\\" ON \\"asset\\" (\\"is_nsfw\\") WHERE (is_nsfw = true);"}'::jsonb) ON CONFLICT ("name") DO UPDATE SET "value" = EXCLUDED."value";`.execute(
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
