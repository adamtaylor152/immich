import {
  CatalogEntry,
  CatalogManifest,
  compareCatalogs,
  getForkTableLocks,
  serializeCatalogManifest,
} from 'src/fork-schema/catalog';

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

  it('derives the complete sorted fork lock set from the manifest', () => {
    const expected = manifest({
      tables: [
        entry('immich_fork.state'),
        entry('public.asset'),
        entry('immich_fork.orphaned_records'),
        entry('immich_fork.asset_health_run'),
      ],
    });

    expect(getForkTableLocks(expected)).toEqual([
      'immich_fork.asset_health_run',
      'immich_fork.orphaned_records',
      'immich_fork.state',
    ]);
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
