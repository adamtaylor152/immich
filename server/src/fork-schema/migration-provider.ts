import { FileMigrationProvider, Migration, MigrationProvider } from 'kysely';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  classifyMigration,
  POST_CERTIFIED_UPSTREAM_MIGRATIONS,
  SUPPORTED_UPSTREAM_MIGRATIONS,
} from 'src/fork-schema/migration-manifest';

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
        // Post-certified upstream migrations are excluded from the certified
        // official provider: a post-cutover (isolated) database must stay
        // byte-exact with the certified official tag, and the cutover itself
        // reverts them. They run on fresh/legacy installs through the combined
        // legacy provider and are re-applied by the fork return reconciliation.
        if (owner === 'upstream' && !includeLegacyFork && POST_CERTIFIED_UPSTREAM_MIGRATIONS.has(name)) {
          continue;
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
