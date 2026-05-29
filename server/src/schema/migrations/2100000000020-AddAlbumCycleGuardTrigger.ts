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

  // Register overrides so schema:generate matches the declared function
  // (src/schema/functions.ts → album_parent_cycle_check) and the @Trigger on
  // AlbumTable. The SQL must byte-match `asFunctionCreate` / `asTriggerCreate`
  // for those declarations. ON CONFLICT DO UPDATE corrects any prior value.
  // Note: the generator cannot express `UPDATE OF "parentId"`, so the override
  // SQL describes `BEFORE INSERT OR UPDATE`; the actual trigger (created above)
  // is column-scoped. Trigger action-set + timing still match, so this is purely
  // a drift-suppression marker — behaviour is unchanged.
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_album_parent_cycle_check', '{"type":"function","name":"album_parent_cycle_check","sql":"CREATE OR REPLACE FUNCTION album_parent_cycle_check()\\n  RETURNS TRIGGER\\n  LANGUAGE PLPGSQL\\n  AS $$\\n    BEGIN\\n      -- Setting parent to self is always a cycle.\\n      IF NEW.\\"parentId\\" IS NOT NULL AND NEW.\\"parentId\\" = NEW.id THEN\\n        RAISE EXCEPTION ''Album % cannot be its own parent'', NEW.id;\\n      END IF;\\n      -- New parent must not already be a descendant of this album (excluding the\\n      -- self-row, which is always present per closure semantics).\\n      IF NEW.\\"parentId\\" IS NOT NULL AND EXISTS (\\n        SELECT 1\\n        FROM album_closure\\n        WHERE id_ancestor = NEW.id\\n          AND id_descendant = NEW.\\"parentId\\"\\n          AND id_ancestor <> id_descendant\\n      ) THEN\\n        RAISE EXCEPTION ''Album % cannot have % as parent (would create a cycle)'', NEW.id, NEW.\\"parentId\\";\\n      END IF;\\n      RETURN NEW;\\n    END\\n  $$;"}'::jsonb) ON CONFLICT ("name") DO UPDATE SET "value" = EXCLUDED."value";`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_album_parent_cycle_check_trigger', '{"type":"trigger","name":"album_parent_cycle_check_trigger","sql":"CREATE OR REPLACE TRIGGER \\"album_parent_cycle_check_trigger\\"\\n  BEFORE INSERT OR UPDATE ON \\"album\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION album_parent_cycle_check();"}'::jsonb) ON CONFLICT ("name") DO UPDATE SET "value" = EXCLUDED."value";`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS album_parent_cycle_check_trigger ON "album";`.execute(db);
  await sql`DROP FUNCTION IF EXISTS album_parent_cycle_check();`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_album_parent_cycle_check_trigger';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'function_album_parent_cycle_check';`.execute(db);
}
