import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "asset_health_run" (
    "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
    "category" character varying NOT NULL,
    "status" character varying NOT NULL DEFAULT 'running',
    "startedAt" timestamp with time zone NOT NULL DEFAULT now(),
    "finishedAt" timestamp with time zone,
    "totalAssets" integer NOT NULL DEFAULT 0,
    "checkedAssets" integer NOT NULL DEFAULT 0,
    "foundAssets" integer NOT NULL DEFAULT 0,
    "error" text,
    CONSTRAINT "asset_health_run_pkey" PRIMARY KEY ("id")
  );`.execute(db);

  await sql`CREATE TABLE "asset_health" (
    "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
    "assetId" uuid NOT NULL,
    "runId" uuid,
    "category" character varying NOT NULL,
    "status" character varying NOT NULL,
    "severity" character varying NOT NULL,
    "originalPath" character varying NOT NULL,
    "originalFileName" character varying NOT NULL,
    "evidence" jsonb NOT NULL,
    "resolution" jsonb NOT NULL,
    "checkedAt" timestamp with time zone NOT NULL,
    "dismissedAt" timestamp with time zone,
    "resolvedAt" timestamp with time zone,
    "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
    "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "asset_health_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT "asset_health_runId_fkey" FOREIGN KEY ("runId") REFERENCES "asset_health_run" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT "asset_health_assetId_category_uq" UNIQUE ("assetId", "category"),
    CONSTRAINT "asset_health_pkey" PRIMARY KEY ("id")
  );`.execute(db);

  await sql`CREATE INDEX "asset_health_category_status_idx" ON "asset_health" ("category", "status");`.execute(db);
  await sql`CREATE INDEX "asset_health_checkedAt_idx" ON "asset_health" ("checkedAt");`.execute(db);

  await sql`CREATE TRIGGER "asset_health_updatedAt"
    BEFORE UPDATE ON "asset_health"
    FOR EACH ROW
    EXECUTE FUNCTION updated_at();`.execute(db);

  await sql`CREATE TABLE "asset_health_candidate" (
    "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
    "healthId" uuid NOT NULL,
    "candidatePath" character varying NOT NULL,
    "status" character varying NOT NULL,
    "visualMatchScore" double precision,
    "evidence" jsonb NOT NULL,
    "resolution" jsonb NOT NULL,
    "checkedAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
    "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "asset_health_candidate_healthId_fkey" FOREIGN KEY ("healthId") REFERENCES "asset_health" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT "asset_health_candidate_healthId_candidatePath_uq" UNIQUE ("healthId", "candidatePath"),
    CONSTRAINT "asset_health_candidate_pkey" PRIMARY KEY ("id")
  );`.execute(db);

  await sql`CREATE INDEX "asset_health_candidate_healthId_idx" ON "asset_health_candidate" ("healthId");`.execute(db);

  await sql`CREATE TRIGGER "asset_health_candidate_updatedAt"
    BEFORE UPDATE ON "asset_health_candidate"
    FOR EACH ROW
    EXECUTE FUNCTION updated_at();`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TRIGGER "asset_health_candidate_updatedAt" ON "asset_health_candidate";`.execute(db);
  await sql`DROP INDEX "asset_health_candidate_healthId_idx";`.execute(db);
  await sql`DROP TABLE "asset_health_candidate";`.execute(db);
  await sql`DROP TRIGGER "asset_health_updatedAt" ON "asset_health";`.execute(db);
  await sql`DROP INDEX "asset_health_checkedAt_idx";`.execute(db);
  await sql`DROP INDEX "asset_health_category_status_idx";`.execute(db);
  await sql`DROP TABLE "asset_health";`.execute(db);
  await sql`DROP TABLE "asset_health_run";`.execute(db);
}
