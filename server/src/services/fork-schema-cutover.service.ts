import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DatabaseLock } from 'src/enum';
import { assertSupportedUpstream } from 'src/fork-schema/migration-manifest';
import { ForkSchemaCutoverEvidence } from 'src/repositories/database.repository';
import { BaseService } from 'src/services/base.service';

export type CutoverReport = ForkSchemaCutoverEvidence & {
  blockers: string[];
  digest: string;
  ready: boolean;
};

export type HandoffCheckpoint = {
  committedAt: string;
  phase: 'inactive';
  reportDigest: string;
  schemaVersion: '2';
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
};

export const cutoverReportDigest = (evidence: ForkSchemaCutoverEvidence): string =>
  createHash('sha256')
    .update(JSON.stringify(canonicalize(evidence)))
    .digest('hex');

const getBlockers = (evidence: ForkSchemaCutoverEvidence): string[] => {
  const blockers: string[] = [];
  const unknown = evidence.ledger.filter(({ classification }) => classification === 'unknown');
  for (const migration of unknown) {
    blockers.push(`Unknown migration in kysely_migrations: ${migration.name}`);
  }
  try {
    assertSupportedUpstream(evidence.state.upstreamVersion);
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }
  if (evidence.state.phase !== 'ready' || evidence.state.active) {
    blockers.push('Fork schema cutover requires the ready, inactive phase');
  }
  if (!evidence.maintenanceMode) {
    blockers.push('Fork schema cutover requires maintenance mode');
  }
  if (evidence.activeWrites > 0) {
    blockers.push(`Fork schema cutover detected ${evidence.activeWrites} active write transaction(s)`);
  }
  if (!evidence.migrationOrderValid) {
    blockers.push('Official migration ledger is not an exact ordered prefix of the bundled provider');
  }
  for (const residue of evidence.schemaResidue) {
    if (!residue.allowed) {
      blockers.push(`Unknown fork schema residue: ${residue.kind} ${residue.name}`);
    }
  }
  if (!evidence.forkMigrations.includes('0000000000000-ForkSchemaBaseline')) {
    blockers.push('Fork schema baseline is not applied');
  }
  for (const backfill of evidence.backfills) {
    if (backfill.remaining > 0 || backfill.lastError) {
      blockers.push(`Backfill ${backfill.kind} is incomplete or failed`);
    }
  }
  if (evidence.checksumFailures > 0) {
    blockers.push(`Checksum verification failed for ${evidence.checksumFailures} asset(s)`);
  }
  if (evidence.unsafePhysicalMappings > 0) {
    blockers.push(`Unsafe physical mapping remains for ${evidence.unsafePhysicalMappings} asset/file row(s)`);
  }
  if (evidence.storageReservations > 0) {
    blockers.push(`Storage normalization has ${evidence.storageReservations} unresolved reservation(s)`);
  }
  return blockers;
};

@Injectable()
export class ForkSchemaCutoverService extends BaseService {
  async preflight(): Promise<CutoverReport> {
    const evidence = await this.databaseRepository.getForkSchemaCutoverEvidence();
    const blockers = getBlockers(evidence);
    return { ...evidence, blockers, digest: cutoverReportDigest(evidence), ready: blockers.length === 0 };
  }

  async apply(expectedReportDigest: string): Promise<HandoffCheckpoint> {
    if (!expectedReportDigest) {
      throw new Error('Expected preflight report digest is required');
    }

    return this.databaseRepository.withLock(DatabaseLock.Migrations, async () => {
      const lockedReport = await this.preflight();
      if (lockedReport.digest !== expectedReportDigest) {
        throw new Error(
          `Fork schema cutover preflight changed: expected ${expectedReportDigest}, received ${lockedReport.digest}`,
        );
      }
      if (!lockedReport.ready) {
        throw new Error(lockedReport.blockers[0]);
      }

      const checkpoint = await this.databaseRepository.commitForkSchemaCutover(
        expectedReportDigest,
        async (transaction) => {
          const evidence = await this.databaseRepository.getForkSchemaCutoverEvidence(transaction);
          const blockers = getBlockers(evidence);
          const digest = cutoverReportDigest(evidence);
          if (digest !== expectedReportDigest) {
            throw new Error(
              `Fork schema cutover preflight changed: expected ${expectedReportDigest}, received ${digest}`,
            );
          }
          if (blockers.length > 0) {
            throw new Error(blockers[0]);
          }
        },
      );

      try {
        // This intentionally uses the unchanged official Kysely migrator after
        // the cutover checkpoint commits. A failure here is post-commit and can
        // only be recovered by restoring the mandatory checkpoint.
        await this.databaseRepository.runOfficialMigrations();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Fork schema cutover committed but official migrations failed; checkpoint restore required: ${message}`,
          { cause: error },
        );
      }
      return checkpoint;
    });
  }
}
