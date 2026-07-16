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

const getBlockers = (
  evidence: ForkSchemaCutoverEvidence,
  checkpoint: { databaseBackupId: string; mediaSnapshotId: string },
): string[] => {
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
  if (!evidence.catalogDiff.clean) {
    for (const difference of evidence.catalogDiff.missing) {
      blockers.push(`Missing catalog object: ${difference.kind} ${difference.identity}`);
    }
    for (const difference of evidence.catalogDiff.unexpected) {
      blockers.push(`Unknown catalog object: ${difference.kind} ${difference.identity}`);
    }
    for (const difference of evidence.catalogDiff.mismatched) {
      blockers.push(`Mismatched catalog object: ${difference.kind} ${difference.identity}`);
    }
  }
  if (!evidence.forkLedgerValid) {
    blockers.push('Fork migration ledger is not the exact ordered applied provider set');
  }
  if (!evidence.backfillKindsValid) {
    blockers.push('Backfill progress does not contain the exact required kind set');
  }
  for (const backfill of evidence.backfills) {
    if (
      backfill.remaining !== 0 ||
      backfill.lastError !== null ||
      backfill.cursor !== null ||
      backfill.claimedCursor !== null ||
      backfill.claimToken !== null ||
      backfill.claimedIds.length > 0 ||
      !/^[\da-f]{64}$/.test(backfill.digest ?? '')
    ) {
      blockers.push(`Backfill ${backfill.kind} is not durably complete`);
    }
  }
  if (!evidence.checksumCoverage.valid) {
    blockers.push('Checksum coverage is incomplete, invalid, or digest-mismatched');
  }
  if (!evidence.mappingCoverage.valid) {
    blockers.push('Physical mapping coverage is incomplete, unsafe, or digest-mismatched');
  }
  if (evidence.storageReservations > 0) {
    blockers.push(`Storage normalization has ${evidence.storageReservations} unresolved reservation(s)`);
  }
  const storage = evidence.storageVerification;
  if (storage) {
    if (
      storage.databaseBackupId !== checkpoint.databaseBackupId ||
      storage.mediaSnapshotId !== checkpoint.mediaSnapshotId
    ) {
      blockers.push('Storage verification checkpoint IDs do not match the operator-supplied IDs');
    }
    const completedAt = Date.parse(storage.completedAt);
    const age = Date.now() - completedAt;
    if (!Number.isFinite(completedAt) || age < 0 || age > 60 * 60 * 1000) {
      blockers.push('Storage verification checkpoint is older than one hour');
    }
    if (
      !/^[\da-f]{64}$/.test(storage.aggregateDigest) ||
      storage.assetCount !== evidence.checksumCoverage.applicableCount ||
      storage.verifiedCount !== storage.assetCount ||
      storage.failureCount !== 0 ||
      storage.rootDriftCount !== 0 ||
      storage.evidenceAssetCount !== storage.assetCount ||
      storage.evidenceAggregateDigest !== storage.aggregateDigest ||
      !storage.runId
    ) {
      blockers.push('Storage verification checkpoint evidence is invalid');
    }
  } else {
    blockers.push('A completed storage verification checkpoint is required for the supplied IDs');
  }
  return blockers;
};

const checkpointIds = (databaseBackupId: string, mediaSnapshotId: string) => {
  const backup = databaseBackupId.trim();
  const snapshot = mediaSnapshotId.trim();
  if (!backup) {
    throw new Error('Database backup ID is required');
  }
  if (!snapshot) {
    throw new Error('Media snapshot ID is required');
  }
  return { databaseBackupId: backup, mediaSnapshotId: snapshot };
};

@Injectable()
export class ForkSchemaCutoverService extends BaseService {
  async preflight(databaseBackupId: string, mediaSnapshotId: string): Promise<CutoverReport> {
    const checkpoint = checkpointIds(databaseBackupId, mediaSnapshotId);
    const evidence = await this.databaseRepository.getForkSchemaCutoverEvidence(undefined, checkpoint);
    const blockers = getBlockers(evidence, checkpoint);
    return { ...evidence, blockers, digest: cutoverReportDigest(evidence), ready: blockers.length === 0 };
  }

  async apply(
    expectedReportDigest: string,
    databaseBackupId: string,
    mediaSnapshotId: string,
  ): Promise<HandoffCheckpoint> {
    if (!expectedReportDigest) {
      throw new Error('Expected preflight report digest is required');
    }
    const checkpointIdsForApply = checkpointIds(databaseBackupId, mediaSnapshotId);

    return this.databaseRepository.withLock(DatabaseLock.Migrations, async () => {
      const lockedReport = await this.preflight(
        checkpointIdsForApply.databaseBackupId,
        checkpointIdsForApply.mediaSnapshotId,
      );
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
        lockedReport.installationClass,
        async (transaction) => {
          const evidence = await this.databaseRepository.getForkSchemaCutoverEvidence(
            transaction,
            checkpointIdsForApply,
          );
          const blockers = getBlockers(evidence, checkpointIdsForApply);
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
