import { JobStatus, SystemMetadataKey } from 'src/enum';
import { PhysicalDeduplicationService } from 'src/services/physical-deduplication.service';
import { newTestService } from 'test/utils';

describe(PhysicalDeduplicationService.name, () => {
  it.each(['inactive', 'failed'] as const)(
    'refuses to create physical mappings in the %s phase',
    async (phase) => {
      const { sut, mocks } = newTestService(PhysicalDeduplicationService);
      mocks.forkSchema.getState.mockResolvedValue({
        active: false,
        phase,
        schemaVersion: '1',
        upstreamVersion: '3.0.3',
      });

      await expect(sut.handleApply({})).resolves.toBe(JobStatus.Skipped);

      expect(mocks.physicalFile.getMigrationCandidates).not.toHaveBeenCalled();
    },
  );

  it.each(['legacy', 'dual-write', 'ready', 'active'] as const)(
    'runs deduplication in the %s phase when enabled',
    async (phase) => {
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

      await expect(sut.handleApply({})).resolves.toBe(JobStatus.Success);

      expect(mocks.physicalFile.getMigrationCandidates).toHaveBeenCalledWith('master-user');
    },
  );
});
