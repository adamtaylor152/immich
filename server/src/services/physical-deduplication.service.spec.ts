import { JobStatus } from 'src/enum';
import { PhysicalDeduplicationService } from 'src/services/physical-deduplication.service';
import { newTestService } from 'test/utils';

describe(PhysicalDeduplicationService.name, () => {
  it.each(['ready', 'inactive', 'active', 'failed'] as const)(
    'refuses to create legacy physical mappings in the %s phase',
    async (phase) => {
      const { sut, mocks } = newTestService(PhysicalDeduplicationService);
      mocks.forkSchema.getState.mockResolvedValue({
        active: phase === 'active',
        phase,
        schemaVersion: '1',
        upstreamVersion: '3.0.3',
      });

      await expect(sut.handleApply({})).resolves.toBe(JobStatus.Skipped);

      expect(mocks.physicalFile.getMigrationCandidates).not.toHaveBeenCalled();
    },
  );
});
