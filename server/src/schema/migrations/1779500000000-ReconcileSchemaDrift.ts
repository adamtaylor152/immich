import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    INSERT INTO "migration_overrides" ("name", "value")
    VALUES ('index_idx_asset_exif_description_trigram', '{"type":"index","name":"idx_asset_exif_description_trigram","sql":"CREATE INDEX \\"idx_asset_exif_description_trigram\\" ON \\"asset_exif\\" USING gin (f_unaccent(\\"description\\") gin_trgm_ops);"}'::jsonb)
    ON CONFLICT ("name") DO NOTHING;
  `.execute(db);

  await sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PK_smart_search_description') THEN
        ALTER TABLE "smart_search_description" RENAME CONSTRAINT "PK_smart_search_description" TO "smart_search_description_pkey";
      END IF;
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_smart_search_description_asset') THEN
        ALTER TABLE "smart_search_description" RENAME CONSTRAINT "FK_smart_search_description_asset" TO "smart_search_description_assetId_fkey";
      END IF;
    END
    $$;
  `.execute(db);

  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_physicalOriginalFileId_fkey') THEN
        ALTER TABLE "asset"
          ADD CONSTRAINT "asset_physicalOriginalFileId_fkey"
          FOREIGN KEY ("physicalOriginalFileId") REFERENCES "physical_file" ("id")
          ON UPDATE CASCADE ON DELETE SET NULL;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_file_physicalFileId_fkey') THEN
        ALTER TABLE "asset_file"
          ADD CONSTRAINT "asset_file_physicalFileId_fkey"
          FOREIGN KEY ("physicalFileId") REFERENCES "physical_file" ("id")
          ON UPDATE CASCADE ON DELETE SET NULL;
      END IF;
    END
    $$;
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'smart_search_description_pkey') THEN
        ALTER TABLE "smart_search_description" RENAME CONSTRAINT "smart_search_description_pkey" TO "PK_smart_search_description";
      END IF;
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'smart_search_description_assetId_fkey') THEN
        ALTER TABLE "smart_search_description" RENAME CONSTRAINT "smart_search_description_assetId_fkey" TO "FK_smart_search_description_asset";
      END IF;
    END
    $$;
  `.execute(db);
}
