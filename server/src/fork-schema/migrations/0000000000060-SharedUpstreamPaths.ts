import { Kysely, sql } from 'kysely';

/**
 * Physical deduplication is a core fork feature: multiple assets share one
 * on-disk file, so multiple immich_fork.asset_physical_file rows legitimately
 * point at the same upstreamPath. The unique index encoded the old
 * always-split normalization behavior; replace it with a plain index.
 * Exclusive per-asset target ownership is still enforced for the
 * return-to-upstream flow by asset_storage_reservation's unique upstreamPath.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX immich_fork.asset_physical_file_upstream_path_uq`.execute(db);
  await sql`CREATE INDEX asset_physical_file_upstream_path_idx ON immich_fork.asset_physical_file ("upstreamPath")`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX immich_fork.asset_physical_file_upstream_path_idx`.execute(db);
  await sql`CREATE UNIQUE INDEX asset_physical_file_upstream_path_uq ON immich_fork.asset_physical_file ("upstreamPath")`.execute(
    db,
  );
}
