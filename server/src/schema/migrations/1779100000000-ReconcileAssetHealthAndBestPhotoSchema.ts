import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE INDEX "asset_best_photo_score_ownerId_idx" ON "asset_best_photo_score" ("ownerId");`.execute(db);
  await sql`CREATE INDEX "asset_health_assetId_idx" ON "asset_health" ("assetId");`.execute(db);
  await sql`CREATE INDEX "asset_health_runId_idx" ON "asset_health" ("runId");`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_asset_health_updatedAt', '{"type":"trigger","name":"asset_health_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"asset_health_updatedAt\\"\\n  BEFORE UPDATE ON \\"asset_health\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_asset_health_candidate_updatedAt', '{"type":"trigger","name":"asset_health_candidate_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"asset_health_candidate_updatedAt\\"\\n  BEFORE UPDATE ON \\"asset_health_candidate\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX "asset_health_assetId_idx";`.execute(db);
  await sql`DROP INDEX "asset_health_runId_idx";`.execute(db);
  await sql`DROP INDEX "asset_best_photo_score_ownerId_idx";`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_asset_health_updatedAt';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_asset_health_candidate_updatedAt';`.execute(db);
}
