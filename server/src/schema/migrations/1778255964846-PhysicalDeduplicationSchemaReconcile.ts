import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE INDEX "physical_file_canonicalAssetId_idx" ON "physical_file" ("canonicalAssetId");`.execute(db);
  await sql`ALTER TABLE "physical_file" RENAME CONSTRAINT "physical_file_path_unique" TO "physical_file_path_uq";`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_physical_file_updatedAt', '{"type":"trigger","name":"physical_file_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"physical_file_updatedAt\\"\\n  BEFORE UPDATE ON \\"physical_file\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX "physical_file_canonicalAssetId_idx";`.execute(db);
  await sql`ALTER TABLE "physical_file" RENAME CONSTRAINT "physical_file_path_uq" TO "physical_file_path_unique";`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_physical_file_updatedAt';`.execute(db);
}
