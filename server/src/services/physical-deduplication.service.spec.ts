import { JobStatus, SystemMetadataKey } from 'src/enum';
import { PhysicalDeduplicationService } from 'src/services/physical-deduplication.service';
import { newTestService } from 'test/utils';

type Handler = 'handleDryRun' | 'handleApply';

describe(PhysicalDeduplicationService.name, () => {
  const blockedCases: Array<[Handler, 'inactive' | 'failed']> = [
    ['handleDryRun', 'inactive'],
    ['handleDryRun', 'failed'],
    ['handleApply', 'inactive'],
    ['handleApply', 'failed'],
  ];

  it.each(blockedCases)('%s refuses to create physical mappings in the %s phase', async (handler, phase) => {
    const { sut, mocks } = newTestService(PhysicalDeduplicationService);
    mocks.forkSchema.getState.mockResolvedValue({
      active: false,
      phase,
      schemaVersion: '1',
      upstreamVersion: '3.0.3',
    });

    await expect(sut[handler]({})).resolves.toBe(JobStatus.Skipped);

    expect(mocks.physicalFile.getMigrationCandidates).not.toHaveBeenCalled();
  });

  const allowedCases: Array<[Handler, 'legacy' | 'dual-write' | 'ready' | 'active']> = [
    ['handleDryRun', 'legacy'],
    ['handleDryRun', 'dual-write'],
    ['handleDryRun', 'ready'],
    ['handleDryRun', 'active'],
    ['handleApply', 'legacy'],
    ['handleApply', 'dual-write'],
    ['handleApply', 'ready'],
    ['handleApply', 'active'],
  ];

  it.each(allowedCases)('%s runs deduplication in the %s phase when enabled', async (handler, phase) => {
    const { sut, mocks } = newTestService(PhysicalDeduplicationService);
    mocks.forkSchema.getState.mockResolvedValue({
      active: phase === 'active',
      phase,
      schemaVersion: '1',
      upstreamVersion: '3.0.3',
    });
    mocks.systemMetadata.get.mockImplementation((key) =>
      Promise.resolve(
        key === SystemMetadataKey.PhysicalDeduplicationMigration
          ? {
              mode: 'dry-run',
              masterUserId: 'master-user',
              ranAt: new Date().toISOString(),
              eligibleAssets: 0,
              linkedAssets: 0,
              skippedExternal: 0,
              skippedMissingMaster: 0,
              reclaimableBytes: 0,
              deletedBytes: 0,
              samples: [],
            }
          : { physicalDeduplication: { enabled: true, masterUserId: 'master-user' } },
      ),
    );
    mocks.database.withLock.mockImplementation((_lock, callback) => callback());
    mocks.physicalFile.getMigrationCandidates.mockReturnValue((async function* () {})());

    await expect(sut[handler]({})).resolves.toBe(JobStatus.Success);

    expect(mocks.physicalFile.getMigrationCandidates).toHaveBeenCalledWith('master-user');
  });
});
