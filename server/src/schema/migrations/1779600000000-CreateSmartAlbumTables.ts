import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE "smart_album" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "kind" text NOT NULL,
      "ownerId" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "albumId" uuid NOT NULL REFERENCES "album"("id") ON DELETE CASCADE,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      UNIQUE ("ownerId", "kind")
    );
  `.execute(db);

  await sql`
    CREATE INDEX "smart_album_ownerId_idx" ON "smart_album" ("ownerId");
  `.execute(db);

  await sql`
    CREATE TABLE "smart_album_asset" (
      "smartAlbumId" uuid NOT NULL REFERENCES "smart_album"("id") ON DELETE CASCADE,
      "assetId" uuid NOT NULL REFERENCES "asset"("id") ON DELETE CASCADE,
      "addedAt" timestamptz NOT NULL DEFAULT now(),
      "matchReason" text NOT NULL CHECK ("matchReason" IN ('tag', 'clip', 'both')),
      PRIMARY KEY ("smartAlbumId", "assetId")
    );
  `.execute(db);

  await sql`
    CREATE INDEX "smart_album_asset_assetId_idx" ON "smart_album_asset" ("assetId");
  `.execute(db);

  await sql`
    CREATE TABLE "smart_album_exclusion" (
      "smartAlbumId" uuid NOT NULL REFERENCES "smart_album"("id") ON DELETE CASCADE,
      "assetId" uuid NOT NULL REFERENCES "asset"("id") ON DELETE CASCADE,
      PRIMARY KEY ("smartAlbumId", "assetId")
    );
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS "smart_album_exclusion";`.execute(db);
  await sql`DROP TABLE IF EXISTS "smart_album_asset";`.execute(db);
  await sql`DROP TABLE IF EXISTS "smart_album";`.execute(db);
}
