import { FileMigrationProvider, Migration, MigrationProvider } from 'kysely';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { classifyMigration, SUPPORTED_UPSTREAM_MIGRATIONS } from 'src/fork-schema/migration-manifest';

const fileProvider = (migrationFolder: string) =>
  new FileMigrationProvider({
    fs: { readdir },
    path: { join },
    migrationFolder,
  });

function createClassifiedMigrationProvider(migrationFolder: string, includeLegacyFork: boolean): MigrationProvider {
  const provider = fileProvider(migrationFolder);

  return {
    async getMigrations(): Promise<Record<string, Migration>> {
      const migrations = await provider.getMigrations();
      const officialMigrations: Record<string, Migration> = {};

      for (const [name, migration] of Object.entries(migrations)) {
        const owner = classifyMigration(name);
        if (owner === 'unknown') {
          throw new Error(`Unknown migration in official migration folder: ${name}`);
        }
        if (owner === 'upstream' || (includeLegacyFork && owner === 'legacy-fork')) {
          officialMigrations[name] = migration;
        }
      }

      return officialMigrations;
    },
  };
}

export function createOfficialMigrationProvider(migrationFolder: string): MigrationProvider {
  return createClassifiedMigrationProvider(migrationFolder, false);
}

export function createCertifiedLedgerMigrationProvider(
  provider: MigrationProvider,
  appliedNames: readonly string[],
): MigrationProvider {
  const certifiedNames = new Set(SUPPORTED_UPSTREAM_MIGRATIONS);
  const appliedCertifiedNames = appliedNames.filter((name) => certifiedNames.has(name));

  return {
    async getMigrations(): Promise<Record<string, Migration>> {
      const migrations = await provider.getMigrations();
      for (const name of appliedCertifiedNames) {
        if (migrations[name]) {
          continue;
        }
        const failClosed = () => Promise.reject(new Error(`Certified migration sentinel ${name} must never execute`));
        migrations[name] = { down: failClosed, up: failClosed };
      }
      return Object.fromEntries(Object.entries(migrations).toSorted(([left], [right]) => left.localeCompare(right)));
    },
  };
}

export function createLegacyMigrationProvider(migrationFolder: string): MigrationProvider {
  return createClassifiedMigrationProvider(migrationFolder, true);
}

export function createForkMigrationProvider(migrationFolder: string): MigrationProvider {
  const provider = fileProvider(migrationFolder);
  return { getMigrations: () => provider.getMigrations() };
}
