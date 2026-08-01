import { Kysely, sql } from 'kysely';

// 1779600000000-CreateSmartAlbumTables was rewritten after it shipped (gen_random_uuid()
// default, unnamed unique constraint, missing FK indexes). Databases that ran the original
// version never re-run it, so bring them up to the current table definitions. Every
// statement is idempotent — fresh databases already match and this is a no-op there.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "smart_album" ALTER COLUMN "id" SET DEFAULT uuid_generate_v4();`.execute(db);

  await sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'smart_album_ownerId_kind_key') THEN
        ALTER TABLE "smart_album" RENAME CONSTRAINT "smart_album_ownerId_kind_key" TO "smart_album_ownerId_kind_uq";
      END IF;
    END
    $$;
  `.execute(db);

  await sql`CREATE INDEX IF NOT EXISTS "smart_album_albumId_idx" ON "smart_album" ("albumId");`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS "smart_album_asset_smartAlbumId_idx" ON "smart_album_asset" ("smartAlbumId");`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS "smart_album_exclusion_smartAlbumId_idx" ON "smart_album_exclusion" ("smartAlbumId");`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS "smart_album_exclusion_assetId_idx" ON "smart_album_exclusion" ("assetId");`.execute(
    db,
  );
}

export async function down(_db: Kysely<any>): Promise<void> {
  // Reconciliation only converges old databases onto the current shape; there is no
  // meaningful prior state to restore.
}
