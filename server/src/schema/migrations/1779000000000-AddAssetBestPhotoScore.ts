import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "asset_best_photo_score" (
    "assetId" uuid NOT NULL,
    "ownerId" uuid NOT NULL,
    "score" double precision NOT NULL,
    "aestheticScore" double precision,
    "technicalScore" double precision,
    "subjectScore" double precision,
    "diversityScore" double precision,
    "scoreVersion" integer NOT NULL,
    "computedAt" timestamp with time zone NOT NULL,
    "metadata" jsonb,
    "bestFrameTimestampMs" integer,
    "frameScore" double precision,
    "frameMetadata" jsonb,
    "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
    "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "asset_best_photo_score_pkey" PRIMARY KEY ("assetId"),
    CONSTRAINT "asset_best_photo_score_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT "asset_best_photo_score_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE
  );`.execute(db);

  await sql`CREATE INDEX "asset_best_photo_score_ownerId_score_idx" ON "asset_best_photo_score" ("ownerId", "score" DESC);`.execute(
    db,
  );
  await sql`CREATE INDEX "asset_best_photo_score_scoreVersion_computedAt_idx" ON "asset_best_photo_score" ("scoreVersion", "computedAt");`.execute(
    db,
  );
  await sql`CREATE INDEX "asset_best_photo_score_computedAt_idx" ON "asset_best_photo_score" ("computedAt");`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX "asset_best_photo_score_computedAt_idx";`.execute(db);
  await sql`DROP INDEX "asset_best_photo_score_scoreVersion_computedAt_idx";`.execute(db);
  await sql`DROP INDEX "asset_best_photo_score_ownerId_score_idx";`.execute(db);
  await sql`DROP TABLE "asset_best_photo_score";`.execute(db);
}
