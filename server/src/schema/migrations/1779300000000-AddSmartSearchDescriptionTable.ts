import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE "smart_search_description" (
      "assetId" uuid NOT NULL,
      "embedding" vector(768) NOT NULL,
      CONSTRAINT "smart_search_description_pkey" PRIMARY KEY ("assetId"),
      CONSTRAINT "smart_search_description_assetId_fkey"
        FOREIGN KEY ("assetId") REFERENCES "asset" ("id")
        ON DELETE CASCADE
    );
  `.execute(db);
  await sql`ALTER TABLE "smart_search_description" ALTER COLUMN "embedding" SET STORAGE EXTERNAL;`.execute(db);
  await sql`
    CREATE INDEX "clip_description_index" ON "smart_search_description"
      USING hnsw (embedding vector_cosine_ops)
      WITH (ef_construction = 300, m = 16);
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS "smart_search_description";`.execute(db);
}
