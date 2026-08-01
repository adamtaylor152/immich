import {
  CatalogEntry,
  CatalogManifest,
  compareCatalogs,
  getCatalogTableLocks,
  serializeCatalogManifest,
} from 'src/fork-schema/catalog';
import forkCatalogManifest from 'src/fork-schema/manifests/fork-v2-catalog.json';
import officialCatalogManifest from 'src/fork-schema/manifests/v3.0.3-public-catalog.json';

const entry = (identity: string, definition = identity): CatalogEntry => ({ definition, identity });

const manifest = (overrides: Partial<CatalogManifest> = {}): CatalogManifest => ({
  columns: [entry('public.asset.id', 'uuid not null')],
  constraints: [entry('public.asset.asset_pkey', 'PRIMARY KEY (id)')],
  enums: [entry('public.asset_type.IMAGE', '1')],
  forkMigrations: ['0000000000000-ForkSchemaBaseline'],
  functions: [entry('public.immich_uuid_v7()', 'CREATE FUNCTION immich_uuid_v7()')],
  indexes: [entry('public.asset.asset_pkey', 'CREATE UNIQUE INDEX asset_pkey ON public.asset USING btree (id)')],
  migrationOverrides: ['index_asset_pkey'],
  schemas: [entry('immich_fork'), entry('public')],
  source: 'fixture',
  tables: [entry('immich_fork.state', 'BASE TABLE'), entry('public.asset', 'BASE TABLE')],
  triggers: [entry('public.asset.asset_updated_at', 'CREATE TRIGGER asset_updated_at')],
  ...overrides,
});

describe('catalog manifests', () => {
  it.each(['schemas', 'tables', 'columns', 'enums', 'constraints', 'indexes', 'functions', 'triggers'] as const)(
    'reports every unexpected %s object by exact identity',
    (kind) => {
      const expected = manifest();
      const actual = manifest({ [kind]: [...expected[kind], entry(`${kind}.unexpected`)] });

      expect(compareCatalogs(expected, actual)).toMatchObject({
        clean: false,
        unexpected: [{ identity: `${kind}.unexpected`, kind }],
      });
    },
  );

  it('reports missing and definition-mismatched objects independently', () => {
    const expected = manifest();
    const actual = manifest({
      columns: [],
      indexes: [entry('public.asset.asset_pkey', 'different definition')],
    });

    expect(compareCatalogs(expected, actual)).toMatchObject({
      clean: false,
      mismatched: [{ identity: 'public.asset.asset_pkey', kind: 'indexes' }],
      missing: [{ identity: 'public.asset.id', kind: 'columns' }],
    });
  });

  it('permits only exact explicitly inert legacy objects', () => {
    const expected = manifest();
    const actual = manifest({ tables: [...expected.tables, entry('public.legacy_table')] });

    expect(compareCatalogs(expected, actual, new Set(['tables:public.legacy_table']))).toMatchObject({ clean: true });
    expect(compareCatalogs(expected, actual, new Set(['tables:public.legacy_%']))).toMatchObject({ clean: false });
  });

  it('derives the complete sorted table lock set from the manifest', () => {
    const expected = manifest({
      tables: [
        entry('immich_fork.state'),
        entry('public.asset'),
        entry('immich_fork.orphaned_records'),
        entry('immich_fork.asset_health_run'),
      ],
    });

    expect(getCatalogTableLocks(expected)).toEqual([
      'immich_fork.asset_health_run',
      'immich_fork.orphaned_records',
      'immich_fork.state',
      'public.asset',
    ]);
  });

  it('derives deterministic complete lock sets for both installation classes', () => {
    const fork = forkCatalogManifest as CatalogManifest;
    const official = officialCatalogManifest as CatalogManifest;
    const forkTables = fork.tables.filter(({ identity }) => identity.startsWith('immich_fork.'));
    const originalOfficial = { ...official, tables: [...official.tables, ...forkTables] };

    expect(getCatalogTableLocks(fork)).toEqual(fork.tables.map(({ identity }) => identity).toSorted());
    expect(getCatalogTableLocks(originalOfficial)).toEqual(
      [...official.tables, ...forkTables].map(({ identity }) => identity).toSorted(),
    );
    expect(getCatalogTableLocks(fork)).toHaveLength(102);
    expect(getCatalogTableLocks(originalOfficial)).toHaveLength(91);
  });

  it('records the steady-state geodata primary index rebuilt by the runtime importer', () => {
    const fork = forkCatalogManifest as CatalogManifest;
    const official = officialCatalogManifest as CatalogManifest;
    const tableIdentities = ['public.geodata_places.', 'public.naturalearth_countries.'];
    const expectedIndexes = [
      {
        definition:
          'CREATE INDEX "IDX_geodata_gist_earthcoord" ON public.geodata_places USING gist (ll_to_earth_public(latitude, longitude))',
        identity: 'public.geodata_places.IDX_geodata_gist_earthcoord',
      },
      {
        definition:
          "CREATE UNIQUE INDEX geodata_places_pkey ON public.geodata_places USING btree (id) WITH (fillfactor='100')",
        identity: 'public.geodata_places.geodata_places_pkey',
      },
      {
        definition:
          'CREATE INDEX idx_geodata_places_admin1_name ON public.geodata_places USING gin (f_unaccent(("admin1Name")::text) gin_trgm_ops)',
        identity: 'public.geodata_places.idx_geodata_places_admin1_name',
      },
      {
        definition:
          'CREATE INDEX idx_geodata_places_admin2_name ON public.geodata_places USING gin (f_unaccent(("admin2Name")::text) gin_trgm_ops)',
        identity: 'public.geodata_places.idx_geodata_places_admin2_name',
      },
      {
        definition:
          'CREATE INDEX idx_geodata_places_alternate_names ON public.geodata_places USING gin (f_unaccent(("alternateNames")::text) gin_trgm_ops)',
        identity: 'public.geodata_places.idx_geodata_places_alternate_names',
      },
      {
        definition:
          'CREATE INDEX idx_geodata_places_name ON public.geodata_places USING gin (f_unaccent((name)::text) gin_trgm_ops)',
        identity: 'public.geodata_places.idx_geodata_places_name',
      },
      {
        definition:
          "CREATE UNIQUE INDEX naturalearth_countries_pkey ON public.naturalearth_countries USING btree (id) WITH (fillfactor='100')",
        identity: 'public.naturalearth_countries.naturalearth_countries_pkey',
      },
    ];
    const expectedConstraints = [
      { definition: 'PRIMARY KEY (id)', identity: 'public.geodata_places.geodata_places_pkey' },
      {
        definition: 'PRIMARY KEY (id)',
        identity: 'public.naturalearth_countries.naturalearth_countries_pkey',
      },
    ];

    for (const catalog of [fork, official]) {
      expect(
        catalog.indexes
          .filter(({ identity }) => tableIdentities.some((table) => identity.startsWith(table)))
          .toSorted((left, right) => left.identity.localeCompare(right.identity)),
      ).toEqual(expectedIndexes.toSorted((left, right) => left.identity.localeCompare(right.identity)));
      expect(
        catalog.constraints.filter(({ identity }) => tableIdentities.some((table) => identity.startsWith(table))),
      ).toEqual(expectedConstraints);
    }
  });

  it('serializes deterministically regardless of input order', () => {
    const value = manifest({
      schemas: [entry('public'), entry('immich_fork')],
      tables: [entry('public.asset'), entry('immich_fork.state')],
    });
    const reordered = manifest({
      schemas: value.schemas.toReversed(),
      tables: value.tables.toReversed(),
    });

    expect(serializeCatalogManifest(value)).toBe(serializeCatalogManifest(reordered));
    expect(serializeCatalogManifest(value)).toBe(`${serializeCatalogManifest(value).trimEnd()}\n`);
  });
});
