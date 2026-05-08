import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "physical_file" (
    "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
    "type" character varying NOT NULL,
    "checksum" bytea NOT NULL,
    "sizeInBytes" bigint NOT NULL,
    "path" character varying NOT NULL,
    "canonicalAssetId" uuid,
    "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
    "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
    "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
    CONSTRAINT "physical_file_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "physical_file_canonicalAssetId_fkey" FOREIGN KEY ("canonicalAssetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT "physical_file_path_unique" UNIQUE ("path")
  );`.execute(db);

  await sql`CREATE INDEX "physical_file_canonicalAssetId_type_idx" ON "physical_file" ("canonicalAssetId", "type");`.execute(
    db,
  );
  await sql`CREATE INDEX "physical_file_checksum_sizeInBytes_type_idx" ON "physical_file" ("checksum", "sizeInBytes", "type");`.execute(
    db,
  );
  await sql`CREATE INDEX "physical_file_updateId_idx" ON "physical_file" ("updateId");`.execute(db);

  await sql`CREATE TRIGGER "physical_file_updatedAt"
    BEFORE UPDATE ON "physical_file"
    FOR EACH ROW
    EXECUTE FUNCTION updated_at();`.execute(db);

  await sql`ALTER TABLE "asset" ADD COLUMN "physicalOriginalFileId" uuid;`.execute(db);
  await sql`CREATE INDEX "asset_physicalOriginalFileId_idx" ON "asset" ("physicalOriginalFileId");`.execute(db);
  await sql`ALTER TABLE "asset" ADD CONSTRAINT "asset_physicalOriginalFileId_fkey" FOREIGN KEY ("physicalOriginalFileId") REFERENCES "physical_file" ("id") ON UPDATE CASCADE ON DELETE SET NULL;`.execute(
    db,
  );

  await sql`ALTER TABLE "asset_file" ADD COLUMN "physicalFileId" uuid;`.execute(db);
  await sql`CREATE INDEX "asset_file_physicalFileId_idx" ON "asset_file" ("physicalFileId");`.execute(db);
  await sql`ALTER TABLE "asset_file" ADD CONSTRAINT "asset_file_physicalFileId_fkey" FOREIGN KEY ("physicalFileId") REFERENCES "physical_file" ("id") ON UPDATE CASCADE ON DELETE SET NULL;`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "asset_file" DROP CONSTRAINT "asset_file_physicalFileId_fkey";`.execute(db);
  await sql`DROP INDEX "asset_file_physicalFileId_idx";`.execute(db);
  await sql`ALTER TABLE "asset_file" DROP COLUMN "physicalFileId";`.execute(db);

  await sql`ALTER TABLE "asset" DROP CONSTRAINT "asset_physicalOriginalFileId_fkey";`.execute(db);
  await sql`DROP INDEX "asset_physicalOriginalFileId_idx";`.execute(db);
  await sql`ALTER TABLE "asset" DROP COLUMN "physicalOriginalFileId";`.execute(db);

  await sql`DROP TRIGGER "physical_file_updatedAt" ON "physical_file";`.execute(db);
  await sql`DROP TABLE "physical_file";`.execute(db);
}
