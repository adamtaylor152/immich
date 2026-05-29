import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // NOTE: Constraint/index names and the id default below are chosen to match the
  // table definitions (SmartAlbum*Table) so `migrations:generate` produces no drift:
  //   - id default uses uuid_generate_v4() (the @PrimaryGeneratedColumn convention)
  //   - the unique constraint uses the generator's `_uq` suffix
  //   - every foreign-key column gets its `{table}_{column}_idx` index (the
  //     generator auto-creates FK indexes), and matchReason is a plain text column.
  await sql`
    CREATE TABLE "smart_album" (
      "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      "kind" text NOT NULL,
      "ownerId" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "albumId" uuid NOT NULL REFERENCES "album"("id") ON DELETE CASCADE,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "smart_album_ownerId_kind_uq" UNIQUE ("ownerId", "kind")
    );
  `.execute(db);

  await sql`
    CREATE INDEX "smart_album_ownerId_idx" ON "smart_album" ("ownerId");
  `.execute(db);
  await sql`
    CREATE INDEX "smart_album_albumId_idx" ON "smart_album" ("albumId");
  `.execute(db);

  await sql`
    CREATE TABLE "smart_album_asset" (
      "smartAlbumId" uuid NOT NULL REFERENCES "smart_album"("id") ON DELETE CASCADE,
      "assetId" uuid NOT NULL REFERENCES "asset"("id") ON DELETE CASCADE,
      "addedAt" timestamptz NOT NULL DEFAULT now(),
      "matchReason" text NOT NULL CONSTRAINT "smart_album_asset_matchReason_check" CHECK ("matchReason" IN ('tag', 'clip', 'both')),
      PRIMARY KEY ("smartAlbumId", "assetId")
    );
  `.execute(db);

  await sql`
    CREATE INDEX "smart_album_asset_assetId_idx" ON "smart_album_asset" ("assetId");
  `.execute(db);
  await sql`
    CREATE INDEX "smart_album_asset_smartAlbumId_idx" ON "smart_album_asset" ("smartAlbumId");
  `.execute(db);

  await sql`
    CREATE TABLE "smart_album_exclusion" (
      "smartAlbumId" uuid NOT NULL REFERENCES "smart_album"("id") ON DELETE CASCADE,
      "assetId" uuid NOT NULL REFERENCES "asset"("id") ON DELETE CASCADE,
      PRIMARY KEY ("smartAlbumId", "assetId")
    );
  `.execute(db);

  await sql`
    CREATE INDEX "smart_album_exclusion_smartAlbumId_idx" ON "smart_album_exclusion" ("smartAlbumId");
  `.execute(db);
  await sql`
    CREATE INDEX "smart_album_exclusion_assetId_idx" ON "smart_album_exclusion" ("assetId");
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS "smart_album_exclusion";`.execute(db);
  await sql`DROP TABLE IF EXISTS "smart_album_asset";`.execute(db);
  await sql`DROP TABLE IF EXISTS "smart_album";`.execute(db);
}
