import { DatabaseLock } from 'src/enum';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { ForkHandoffService } from 'src/services/fork-handoff.service';
import { ForkSchemaMigrationService } from 'src/services/fork-schema-migration.service';

const checkpoint = {
  completedAt: '2026-07-16T12:00:00.000Z',
  databaseBackupId: 'backup-1',
  id: 'checkpoint-1',
  mediaSnapshotId: 'snapshot-1',
  officialImage: 'ghcr.io/immich-app/immich-server:v3.0.3' as const,
  reportDigest: 'a'.repeat(64),
  storageVerificationAssetCount: 0,
  storageVerificationDigest: 'b'.repeat(64),
  storageVerificationRunId: 'run-1',
};

const returnEvidence = {
  active: false,
  appliedCheckpointId: 'checkpoint-1',
  maintenanceMode: true,
  officialLedgerDigest: 'c'.repeat(64),
  phase: 'inactive' as const,
  reconciliationStatus: 'not-started' as const,
  schemaVersion: '2',
  supportedTag: 'v3.0.3' as const,
};

const activeReport = {
  ...returnEvidence,
  active: true,
  orphanArchive: { archived: 0, deleted: 0 },
  phase: 'active' as const,
  reconciliationStatus: 'complete' as const,
  verified: true as const,
  progress: [],
};

const setup = () => {
  const databaseMocks = {
    activateAfterReturnReconciliation: vi.fn().mockResolvedValue(activeReport),
    archiveAndDeleteOrphans: vi.fn().mockResolvedValue({ archived: 0, deleted: 0 }),
    getPreparedOfficialHandoffCheckpoint: vi.fn().mockResolvedValue(checkpoint),
    getReturnEvidence: vi.fn().mockResolvedValue(returnEvidence),
    getReturnWorkflowSnapshot: vi.fn().mockResolvedValue({ rowDigests: [], schemaDigest: 'd'.repeat(64) }),
    sealEmptyReturnBackfillDigests: vi.fn().mockResolvedValue(undefined),
    withLock: vi.fn().mockImplementation(async (_lock, callback) => callback()),
  };
  const migrationMocks = {
    reconcileAfterOfficialReturn: vi.fn().mockResolvedValue({ ...returnEvidence, progress: [], verified: true }),
  };
  const database = databaseMocks as unknown as DatabaseRepository;
  const migration = migrationMocks as unknown as ForkSchemaMigrationService;
  return { database, databaseMocks, migration, migrationMocks, sut: new ForkHandoffService(database, migration) };
};

describe(ForkHandoffService.name, () => {
  it('prepares the exact official image from read-only certified evidence', async () => {
    const { databaseMocks, migrationMocks, sut } = setup();

    await expect(sut.prepareOfficial()).resolves.toEqual(checkpoint);

    expect(databaseMocks.getReturnEvidence).toHaveBeenCalledOnce();
    expect(databaseMocks.getPreparedOfficialHandoffCheckpoint).toHaveBeenCalledOnce();
    expect(databaseMocks.archiveAndDeleteOrphans).not.toHaveBeenCalled();
    expect(migrationMocks.reconcileAfterOfficialReturn).not.toHaveBeenCalled();
  });

  it('validates return evidence before archiving, reconciliation, and final activation', async () => {
    const { databaseMocks, migrationMocks, sut } = setup();

    await expect(sut.prepareFork({ batchSize: 7 })).resolves.toEqual(activeReport);

    expect(databaseMocks.withLock).toHaveBeenCalledWith(DatabaseLock.Migrations, expect.any(Function));
    expect(migrationMocks.reconcileAfterOfficialReturn).toHaveBeenCalledWith(7);
    expect(databaseMocks.sealEmptyReturnBackfillDigests).toHaveBeenCalledOnce();
    expect(databaseMocks.activateAfterReturnReconciliation).toHaveBeenCalledWith(
      { rowDigests: [], schemaDigest: 'd'.repeat(64) },
      { archived: 0, deleted: 0 },
      undefined,
    );
    expect(databaseMocks.getReturnEvidence.mock.invocationCallOrder[0]).toBeLessThan(
      databaseMocks.archiveAndDeleteOrphans.mock.invocationCallOrder[0],
    );
  });

  it('fails an unsupported ledger before any reconciliation provider runs', async () => {
    const { databaseMocks, migrationMocks, sut } = setup();
    databaseMocks.getReturnEvidence.mockRejectedValue(new Error('exact certified v3.0.3 ledger'));

    await expect(sut.prepareFork({ batchSize: 1 })).rejects.toThrow('exact certified v3.0.3 ledger');

    expect(databaseMocks.archiveAndDeleteOrphans).not.toHaveBeenCalled();
    expect(migrationMocks.reconcileAfterOfficialReturn).not.toHaveBeenCalled();
    expect(databaseMocks.withLock).not.toHaveBeenCalled();
  });
});
