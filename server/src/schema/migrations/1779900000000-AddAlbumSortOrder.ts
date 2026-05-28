import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "album" ADD COLUMN "sortOrder" double precision DEFAULT NULL;`.execute(db);

  // Backfill so existing rows have a stable ordering: newer createdAt -> lower
  // sortOrder -> appears first (ascending). Future drag-to-reorder writes pick
  // midpoints between neighbors so subsequent moves never need to renumber.
  await sql`UPDATE "album" SET "sortOrder" = -extract(epoch from "createdAt") WHERE "sortOrder" IS NULL;`.execute(db);

  // Partial index for the common "siblings of P in display order" query.
  await sql`CREATE INDEX "album_parent_sort_idx" ON "album" ("parentId", "sortOrder") WHERE "parentId" IS NOT NULL;`.execute(
    db,
  );
  await sql`CREATE INDEX "album_root_sort_idx" ON "album" ("sortOrder") WHERE "parentId" IS NULL;`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS "album_root_sort_idx";`.execute(db);
  await sql`DROP INDEX IF EXISTS "album_parent_sort_idx";`.execute(db);
  await sql`ALTER TABLE "album" DROP COLUMN IF EXISTS "sortOrder";`.execute(db);
}
