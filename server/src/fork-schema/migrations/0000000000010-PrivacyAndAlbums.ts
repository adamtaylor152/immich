import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE immich_fork.asset_privacy (
      "assetId" uuid PRIMARY KEY,
      "isNsfw" boolean NOT NULL DEFAULT false,
      "suppression" jsonb,
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`
    CREATE INDEX asset_privacy_is_nsfw_idx
    ON immich_fork.asset_privacy ("isNsfw")
    WHERE "isNsfw" = true
  `.execute(db);

  await sql`
    CREATE TABLE immich_fork.album_metadata (
      "albumId" uuid PRIMARY KEY,
      "parentId" uuid,
      icon varchar,
      "sortOrder" double precision,
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`
    CREATE INDEX album_metadata_parent_sort_idx
    ON immich_fork.album_metadata ("parentId", "sortOrder")
  `.execute(db);

  await sql`
    CREATE TABLE immich_fork.album_closure (
      "ancestorId" uuid NOT NULL,
      "descendantId" uuid NOT NULL,
      PRIMARY KEY ("ancestorId", "descendantId")
    )
  `.execute(db);
  await sql`
    CREATE INDEX album_closure_descendant_idx
    ON immich_fork.album_closure ("descendantId", "ancestorId")
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS immich_fork.album_closure`.execute(db);
  await sql`DROP TABLE IF EXISTS immich_fork.album_metadata`.execute(db);
  await sql`DROP TABLE IF EXISTS immich_fork.asset_privacy`.execute(db);
}
