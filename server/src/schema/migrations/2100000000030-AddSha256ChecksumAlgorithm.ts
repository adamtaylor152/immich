import { Kysely, sql } from 'kysely';

/**
 * Add `sha256` value to the `asset_checksum_algorithm_enum` Postgres type.
 *
 * SHA-1 has been considered cryptographically broken since the SHAttered
 * collision attack (2017, CWE-327). New uploads handled by the server now
 * compute SHA-256 of the streamed bytes and persist the 32-byte digest in
 * the `asset.checksum` bytea column. Existing rows keep their SHA-1 digest
 * (20 bytes) and are never rehashed — the column is variable-length bytea
 * so it accepts both. Deduplication compares full `checksum + fileSize`
 * tuples, so SHA-1 and SHA-256 rows for the same content simply do not
 * link with each other (which is the correct, conservative behavior).
 *
 * `sha1-path` (used by external libraries) is unaffected because external
 * libraries are still hashed by the importer process, not the upload
 * pipeline.
 *
 * No data backfill is needed — the existing default for the algorithm
 * column was set by 1774548649115-AddChecksumAlgorithm.ts and remains
 * accurate for all historical rows.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TYPE "asset_checksum_algorithm_enum" ADD VALUE IF NOT EXISTS 'sha256';`.execute(db);
}

export async function down(): Promise<void> {
  // Postgres does not support removing enum values without a full type rebuild,
  // and removal would orphan any rows written with this algorithm. No-op.
}
