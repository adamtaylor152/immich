import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE asset_health_run ADD COLUMN "ownerId" uuid REFERENCES "user" (id) ON UPDATE CASCADE ON DELETE CASCADE`.execute(
    db,
  );
  await sql`CREATE INDEX "asset_health_run_ownerId_startedAt_idx" ON asset_health_run ("ownerId", "startedAt")`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX "asset_health_run_ownerId_startedAt_idx"`.execute(db);
  await sql`ALTER TABLE asset_health_run DROP COLUMN "ownerId"`.execute(db);
}
