import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE INDEX "idx_asset_exif_description_trigram" ON "asset_exif" USING gin (f_unaccent("description") gin_trgm_ops);`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX "idx_asset_exif_description_trigram";`.execute(db);
}
