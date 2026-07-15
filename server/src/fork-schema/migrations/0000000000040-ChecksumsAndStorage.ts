import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE immich_fork.asset_checksum (
      "assetId" uuid PRIMARY KEY,
      sha1 bytea NOT NULL,
      sha256 bytea NOT NULL,
      "sizeInBytes" bigint NOT NULL,
      "verifiedPaths" text[] NOT NULL,
      "linkCount" integer NOT NULL CHECK ("linkCount" > 0),
      evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
      "verifiedAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`CREATE INDEX asset_checksum_sha256_idx ON immich_fork.asset_checksum (sha256)`.execute(db);

  await sql`
    CREATE TABLE immich_fork.physical_file (
      id uuid PRIMARY KEY,
      "canonicalAssetId" uuid,
      type text NOT NULL,
      checksum bytea NOT NULL,
      "sizeInBytes" bigint NOT NULL,
      "canonicalPath" text NOT NULL,
      "createdAt" timestamptz NOT NULL,
      "updatedAt" timestamptz NOT NULL
    )
  `.execute(db);
  await sql`CREATE UNIQUE INDEX physical_file_canonical_path_uq ON immich_fork.physical_file ("canonicalPath")`.execute(
    db,
  );
  await sql`CREATE INDEX physical_file_checksum_size_idx ON immich_fork.physical_file (checksum, "sizeInBytes")`.execute(
    db,
  );

  await sql`
    CREATE TABLE immich_fork.asset_physical_file (
      "assetId" uuid PRIMARY KEY,
      "physicalFileId" uuid,
      "upstreamPath" text NOT NULL,
      "verifiedAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`CREATE INDEX asset_physical_file_physical_idx ON immich_fork.asset_physical_file ("physicalFileId")`.execute(
    db,
  );
  await sql`CREATE UNIQUE INDEX asset_physical_file_upstream_path_uq ON immich_fork.asset_physical_file ("upstreamPath")`.execute(
    db,
  );

  await sql`
    CREATE TABLE immich_fork.asset_storage_reservation (
      "assetId" uuid PRIMARY KEY,
      token uuid NOT NULL UNIQUE,
      "sourcePath" text NOT NULL,
      "upstreamPath" text NOT NULL UNIQUE,
      "temporaryPath" text NOT NULL UNIQUE,
      status text NOT NULL CHECK (status IN ('reserved')),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS immich_fork.asset_storage_reservation`.execute(db);
  await sql`DROP TABLE IF EXISTS immich_fork.asset_physical_file`.execute(db);
  await sql`DROP TABLE IF EXISTS immich_fork.physical_file`.execute(db);
  await sql`DROP TABLE IF EXISTS immich_fork.asset_checksum`.execute(db);
}
