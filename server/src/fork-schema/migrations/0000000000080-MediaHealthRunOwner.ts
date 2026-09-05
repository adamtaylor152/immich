import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE immich_fork.asset_health_run ADD COLUMN "ownerId" uuid`.execute(db);
  await sql`CREATE INDEX asset_health_run_owner_started_idx ON immich_fork.asset_health_run ("ownerId", "startedAt")`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX immich_fork.asset_health_run_owner_started_idx`.execute(db);
  await sql`ALTER TABLE immich_fork.asset_health_run DROP COLUMN "ownerId"`.execute(db);
}
