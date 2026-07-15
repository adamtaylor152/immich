import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE immich_fork.asset_enrichment (
      "assetId" uuid PRIMARY KEY,
      provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
      "userDescription" text NOT NULL DEFAULT '',
      "generatedDescription" text,
      "generatedTags" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "requiresReview" boolean NOT NULL DEFAULT false,
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`
    CREATE TABLE immich_fork.config (
      key text PRIMARY KEY,
      value jsonb NOT NULL,
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`
    CREATE TABLE immich_fork.smart_album_rule (
      id uuid PRIMARY KEY,
      "albumId" uuid NOT NULL,
      "ownerId" uuid NOT NULL,
      kind text NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      UNIQUE ("ownerId", kind)
    )
  `.execute(db);
  await sql`
    CREATE TABLE immich_fork.smart_album_match (
      "smartAlbumId" uuid NOT NULL,
      "assetId" uuid NOT NULL,
      "matchReason" text NOT NULL CHECK ("matchReason" IN ('tag', 'clip', 'both')),
      "addedAt" timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY ("smartAlbumId", "assetId")
    )
  `.execute(db);
  await sql`
    CREATE TABLE immich_fork.smart_album_exclusion (
      "smartAlbumId" uuid NOT NULL,
      "assetId" uuid NOT NULL,
      PRIMARY KEY ("smartAlbumId", "assetId")
    )
  `.execute(db);
  await sql`CREATE INDEX smart_album_rule_album_idx ON immich_fork.smart_album_rule ("albumId")`.execute(db);
  await sql`CREATE INDEX smart_album_match_asset_idx ON immich_fork.smart_album_match ("assetId")`.execute(db);
  await sql`CREATE INDEX smart_album_exclusion_asset_idx ON immich_fork.smart_album_exclusion ("assetId")`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS immich_fork.smart_album_exclusion`.execute(db);
  await sql`DROP TABLE IF EXISTS immich_fork.smart_album_match`.execute(db);
  await sql`DROP TABLE IF EXISTS immich_fork.smart_album_rule`.execute(db);
  await sql`DROP TABLE IF EXISTS immich_fork.config`.execute(db);
  await sql`DROP TABLE IF EXISTS immich_fork.asset_enrichment`.execute(db);
}
