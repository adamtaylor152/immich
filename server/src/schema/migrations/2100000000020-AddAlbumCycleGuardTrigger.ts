import { Kysely, sql } from 'kysely';

/**
 * Cycle-prevention trigger for the album closure table.
 *
 * The closure-table model relies on `album.parentId` never pointing at one of
 * its own descendants. The original migration (1779700000000) does not enforce
 * this — if application code (or a future bug) writes a cycle, the closure
 * table can be poisoned and recursive walks loop forever.
 *
 * This trigger rejects any UPDATE of `album.parentId` that would create a
 * cycle. Defense-in-depth: the application's `albumRepository.setParent`
 * already does the check, but the trigger guarantees the invariant even if
 * a future ORM mutation or migration bypasses it.
 *
 * Naming follows the fork-only `2100xxxxxxxxx-` timestamp convention.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE OR REPLACE FUNCTION album_parent_cycle_check() RETURNS trigger AS $$
    BEGIN
      -- Setting parent to self is always a cycle.
      IF NEW."parentId" IS NOT NULL AND NEW."parentId" = NEW.id THEN
        RAISE EXCEPTION 'Album % cannot be its own parent', NEW.id;
      END IF;
      -- New parent must not already be a descendant of this album (excluding the
      -- self-row, which is always present per closure semantics).
      IF NEW."parentId" IS NOT NULL AND EXISTS (
        SELECT 1
        FROM album_closure
        WHERE id_ancestor = NEW.id
          AND id_descendant = NEW."parentId"
          AND id_ancestor <> id_descendant
      ) THEN
        RAISE EXCEPTION 'Album % cannot have % as parent (would create a cycle)', NEW.id, NEW."parentId";
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `.execute(db);

  await sql`
    DROP TRIGGER IF EXISTS album_parent_cycle_check_trigger ON "album";
  `.execute(db);

  await sql`
    CREATE TRIGGER album_parent_cycle_check_trigger
    BEFORE INSERT OR UPDATE OF "parentId" ON "album"
    FOR EACH ROW
    EXECUTE FUNCTION album_parent_cycle_check();
  `.execute(db);

  await sql`
    INSERT INTO "migration_overrides" ("name", "value") VALUES (
      'function_album_parent_cycle_check',
      '{"type":"function","name":"album_parent_cycle_check","sql":"see migration 2100000000020"}'::jsonb
    ) ON CONFLICT ("name") DO NOTHING;
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS album_parent_cycle_check_trigger ON "album";`.execute(db);
  await sql`DROP FUNCTION IF EXISTS album_parent_cycle_check();`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'function_album_parent_cycle_check';`.execute(db);
}
