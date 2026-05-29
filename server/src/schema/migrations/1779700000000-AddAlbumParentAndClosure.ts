import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE "album"
    ADD COLUMN "parentId" uuid REFERENCES "album" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
  `.execute(db);

  // Keep in sync with AlbumTable.parentId's `comment` so schema:generate stays clean.
  await sql`COMMENT ON COLUMN "album"."parentId" IS 'Parent album ID for nesting (null = top-level)';`.execute(db);

  await sql`
    CREATE INDEX "album_parentId_idx" ON "album" ("parentId") WHERE "parentId" IS NOT NULL;
  `.execute(db);

  // Partial index → register an override so the schema generator (which derives
  // overrides from the @Index decorator) sees a matching DB-side entry. The SQL
  // must byte-match `asIndexCreate` for the AlbumTable @Index declaration.
  await sql`
    INSERT INTO "migration_overrides" ("name", "value") VALUES (
      'index_album_parentId_idx',
      '{"type":"index","name":"album_parentId_idx","sql":"CREATE INDEX \\"album_parentId_idx\\" ON \\"album\\" (\\"parentId\\") WHERE ((\\"parentId\\" IS NOT NULL));"}'::jsonb
    ) ON CONFLICT ("name") DO NOTHING;
  `.execute(db);

  await sql`
    CREATE TABLE "album_closure" (
      "id_ancestor"   uuid NOT NULL REFERENCES "album" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
      "id_descendant" uuid NOT NULL REFERENCES "album" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
      CONSTRAINT "album_closure_pkey" PRIMARY KEY ("id_ancestor", "id_descendant")
    );
  `.execute(db);

  await sql`
    CREATE INDEX "album_closure_id_ancestor_idx" ON "album_closure" ("id_ancestor");
  `.execute(db);

  await sql`
    CREATE INDEX "album_closure_id_descendant_idx" ON "album_closure" ("id_descendant");
  `.execute(db);

  await sql`
    INSERT INTO "album_closure" ("id_ancestor", "id_descendant")
    SELECT "id", "id" FROM "album";
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_album_parentId_idx';`.execute(db);
  await sql`DROP TABLE IF EXISTS "album_closure";`.execute(db);
  await sql`DROP INDEX IF EXISTS "album_parentId_idx";`.execute(db);
  await sql`ALTER TABLE "album" DROP COLUMN IF EXISTS "parentId";`.execute(db);
}
