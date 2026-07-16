import { Migration, MigrationProvider } from 'kysely';
import { createCertifiedLedgerMigrationProvider } from 'src/fork-schema/migration-provider';
import {
  ADD_PLUGIN_METHOD_ALLOWED_HOSTS_MIGRATION,
  ADD_PLUGIN_TEMPLATES_MIGRATION,
  OFFICIAL_WORKFLOW_MIGRATION,
} from 'src/fork-schema/workflow-compatibility';

const migration = (): Migration => ({
  down: vi.fn(),
  up: vi.fn(),
});

const provider = (migrations: Record<string, Migration>): MigrationProvider => ({
  getMigrations: () => Promise.resolve(migrations),
});

describe(createCertifiedLedgerMigrationProvider, () => {
  it('exposes only audited protected names that are already recorded in the official ledger', async () => {
    const base = migration();
    const wrapped = createCertifiedLedgerMigrationProvider(provider({ '1000-Base': base }), [
      OFFICIAL_WORKFLOW_MIGRATION,
      ADD_PLUGIN_TEMPLATES_MIGRATION,
    ]);

    const migrations = await wrapped.getMigrations();

    expect(Object.keys(migrations).toSorted()).toEqual(
      ['1000-Base', OFFICIAL_WORKFLOW_MIGRATION, ADD_PLUGIN_TEMPLATES_MIGRATION].toSorted(),
    );
    expect(migrations[ADD_PLUGIN_METHOD_ALLOWED_HOSTS_MIGRATION]).toBeUndefined();
    expect(migrations['1000-Base']).toBe(base);
  });

  it.each(['up', 'down'] as const)('fails closed if Kysely tries to execute sentinel %s', async (direction) => {
    const wrapped = createCertifiedLedgerMigrationProvider(provider({}), [OFFICIAL_WORKFLOW_MIGRATION]);
    const migrations = await wrapped.getMigrations();
    const sentinel = migrations[OFFICIAL_WORKFLOW_MIGRATION]!;

    await expect(sentinel[direction]!({} as never)).rejects.toThrow(
      `Certified migration sentinel ${OFFICIAL_WORKFLOW_MIGRATION} must never execute`,
    );
  });

  it('does not expose a sentinel for a missing or unknown ledger name', async () => {
    const wrapped = createCertifiedLedgerMigrationProvider(provider({}), [
      ADD_PLUGIN_METHOD_ALLOWED_HOSTS_MIGRATION,
      '9999999999999-Unknown',
    ]);

    expect(Object.keys(await wrapped.getMigrations())).toEqual([ADD_PLUGIN_METHOD_ALLOWED_HOSTS_MIGRATION]);
  });

  it('preserves a bundled implementation instead of replacing it with a sentinel', async () => {
    const bundled = migration();
    const wrapped = createCertifiedLedgerMigrationProvider(provider({ [OFFICIAL_WORKFLOW_MIGRATION]: bundled }), [
      OFFICIAL_WORKFLOW_MIGRATION,
    ]);

    const migrations = await wrapped.getMigrations();
    expect(migrations[OFFICIAL_WORKFLOW_MIGRATION]).toBe(bundled);
  });

  it('returns sentinels in migration-name order when legacy migrations are interleaved', async () => {
    const wrapped = createCertifiedLedgerMigrationProvider(
      provider({
        '1778000000000-LegacyBefore': migration(),
        '1779000000000-LegacyAfter': migration(),
      }),
      [OFFICIAL_WORKFLOW_MIGRATION],
    );

    expect(Object.keys(await wrapped.getMigrations())).toEqual([
      '1778000000000-LegacyBefore',
      OFFICIAL_WORKFLOW_MIGRATION,
      '1779000000000-LegacyAfter',
    ]);
  });
});
