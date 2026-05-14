import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "asset_video_duplicate_frame" (
    "assetId" uuid NOT NULL,
    "frameIndex" integer NOT NULL,
    "timestampMs" integer NOT NULL,
    "path" character varying NOT NULL,
    "embedding" vector(512) NOT NULL,
    "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
    "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "asset_video_duplicate_frame_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT "asset_video_duplicate_frame_pkey" PRIMARY KEY ("assetId", "frameIndex")
  );`.execute(db);

  await sql`ALTER TABLE "asset_video_duplicate_frame" ALTER COLUMN "embedding" SET STORAGE EXTERNAL;`.execute(db);
  await sql`CREATE INDEX "asset_video_duplicate_frame_assetId_idx" ON "asset_video_duplicate_frame" ("assetId");`.execute(
    db,
  );
  await sql`CREATE TRIGGER "asset_video_duplicate_frame_updatedAt"
    BEFORE UPDATE ON "asset_video_duplicate_frame"
    FOR EACH ROW
    EXECUTE FUNCTION updated_at();`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TRIGGER "asset_video_duplicate_frame_updatedAt" ON "asset_video_duplicate_frame";`.execute(db);
  await sql`DROP INDEX "asset_video_duplicate_frame_assetId_idx";`.execute(db);
  await sql`DROP TABLE "asset_video_duplicate_frame";`.execute(db);
}
