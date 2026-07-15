import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE immich_fork.orphaned_records (
      "sourceTable" text NOT NULL,
      "sourceKey" text NOT NULL,
      payload jsonb NOT NULL,
      "archivedAt" timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY ("sourceTable", "sourceKey")
    )
  `.execute(db);
  await sql`
    CREATE TABLE immich_fork.asset_health_run (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      category varchar NOT NULL,
      status varchar NOT NULL DEFAULT 'running',
      "startedAt" timestamptz NOT NULL DEFAULT now(),
      "finishedAt" timestamptz,
      "totalAssets" integer NOT NULL DEFAULT 0,
      "checkedAssets" integer NOT NULL DEFAULT 0,
      "foundAssets" integer NOT NULL DEFAULT 0,
      error text
    )
  `.execute(db);
  await sql`
    CREATE TABLE immich_fork.asset_health (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      "assetId" uuid NOT NULL,
      "runId" uuid,
      category varchar NOT NULL,
      status varchar NOT NULL,
      severity varchar NOT NULL,
      "originalPath" varchar NOT NULL,
      "originalFileName" varchar NOT NULL,
      evidence jsonb NOT NULL,
      resolution jsonb NOT NULL,
      "checkedAt" timestamptz NOT NULL,
      "dismissedAt" timestamptz,
      "resolvedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      UNIQUE ("assetId", category)
    )
  `.execute(db);
  await sql`
    CREATE TABLE immich_fork.asset_health_candidate (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      "healthId" uuid NOT NULL,
      "candidatePath" varchar NOT NULL,
      status varchar NOT NULL,
      "visualMatchScore" double precision,
      evidence jsonb NOT NULL,
      resolution jsonb NOT NULL,
      "checkedAt" timestamptz NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      UNIQUE ("healthId", "candidatePath")
    )
  `.execute(db);
  await sql`
    CREATE TABLE immich_fork.asset_best_photo_score (
      "assetId" uuid PRIMARY KEY,
      "ownerId" uuid NOT NULL,
      score double precision NOT NULL,
      "aestheticScore" double precision,
      "technicalScore" double precision,
      "subjectScore" double precision,
      "diversityScore" double precision,
      "scoreVersion" integer NOT NULL,
      "computedAt" timestamptz NOT NULL,
      metadata jsonb,
      "bestFrameTimestampMs" integer,
      "frameScore" double precision,
      "frameMetadata" jsonb,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`
    CREATE TABLE immich_fork.asset_video_duplicate_frame (
      "assetId" uuid NOT NULL,
      "frameIndex" integer NOT NULL,
      "timestampMs" integer NOT NULL,
      path varchar NOT NULL,
      embedding vector(512) NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY ("assetId", "frameIndex")
    )
  `.execute(db);
  await sql`ALTER TABLE immich_fork.asset_video_duplicate_frame ALTER COLUMN embedding SET STORAGE EXTERNAL`.execute(db);
  await sql`CREATE INDEX asset_health_category_status_idx ON immich_fork.asset_health (category, status)`.execute(db);
  await sql`CREATE INDEX asset_health_checked_at_idx ON immich_fork.asset_health ("checkedAt")`.execute(db);
  await sql`CREATE INDEX asset_health_asset_idx ON immich_fork.asset_health ("assetId")`.execute(db);
  await sql`CREATE INDEX asset_health_run_idx ON immich_fork.asset_health ("runId")`.execute(db);
  await sql`CREATE INDEX asset_health_candidate_health_idx ON immich_fork.asset_health_candidate ("healthId")`.execute(db);
  await sql`CREATE INDEX asset_best_photo_owner_score_idx ON immich_fork.asset_best_photo_score ("ownerId", score DESC)`.execute(db);
  await sql`CREATE INDEX asset_best_photo_version_computed_idx ON immich_fork.asset_best_photo_score ("scoreVersion", "computedAt")`.execute(db);
  await sql`CREATE INDEX asset_video_duplicate_frame_asset_idx ON immich_fork.asset_video_duplicate_frame ("assetId")`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS immich_fork.asset_video_duplicate_frame`.execute(db);
  await sql`DROP TABLE IF EXISTS immich_fork.asset_best_photo_score`.execute(db);
  await sql`DROP TABLE IF EXISTS immich_fork.asset_health_candidate`.execute(db);
  await sql`DROP TABLE IF EXISTS immich_fork.asset_health`.execute(db);
  await sql`DROP TABLE IF EXISTS immich_fork.asset_health_run`.execute(db);
  await sql`DROP TABLE IF EXISTS immich_fork.orphaned_records`.execute(db);
}
