import { Kysely, sql } from 'kysely';
import { DB } from 'src/schema';

/** Reproduce the catalog shape created by the normal Immich geodata import. */
export const alignCertifiedGeodataCatalog = async (db: Kysely<DB>): Promise<void> => {
  await sql`
    ALTER INDEX public.geodata_places_pkey SET (fillfactor = 100);
    DROP INDEX IF EXISTS public."IDX_geodata_gist_earthcoord";
    DROP INDEX IF EXISTS public.idx_geodata_places_name;
    DROP INDEX IF EXISTS public.idx_geodata_places_admin1_name;
    DROP INDEX IF EXISTS public.idx_geodata_places_admin2_name;
    DROP INDEX IF EXISTS public.idx_geodata_places_alternate_names;
    CREATE INDEX "IDX_geodata_gist_earthcoord"
      ON public.geodata_places USING gist (ll_to_earth_public(latitude, longitude));
    CREATE INDEX idx_geodata_places_name
      ON public.geodata_places USING gin (f_unaccent(name) gin_trgm_ops);
    CREATE INDEX idx_geodata_places_admin1_name
      ON public.geodata_places USING gin (f_unaccent("admin1Name") gin_trgm_ops);
    CREATE INDEX idx_geodata_places_admin2_name
      ON public.geodata_places USING gin (f_unaccent("admin2Name") gin_trgm_ops);
    CREATE INDEX idx_geodata_places_alternate_names
      ON public.geodata_places USING gin (f_unaccent("alternateNames") gin_trgm_ops);
  `.execute(db);
};
