import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_asset_video_duplicate_frame_updatedAt', '{"type":"trigger","name":"asset_video_duplicate_frame_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"asset_video_duplicate_frame_updatedAt\\"\\n  BEFORE UPDATE ON \\"asset_video_duplicate_frame\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_asset_video_duplicate_frame_updatedAt';`.execute(db);
}
