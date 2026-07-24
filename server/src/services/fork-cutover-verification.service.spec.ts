import { ForkCutoverVerificationRepository } from 'src/repositories/fork-cutover-verification.repository';
import {
  canonicalStorageVerificationDigest,
  ForkCutoverVerificationService,
} from 'src/services/fork-cutover-verification.service';

const run = {
  id: '00000000-0000-4000-8000-000000000001',
  databaseBackupId: 'backup-1',
  mediaSnapshotId: 'snapshot-1',
  status: 'running' as const,
  applicableAssetCount: 1,
  cursor: null,
  verifiedCount: 0,
  failureCount: 0,
  aggregateDigest: null,
  failure: null,
  createdAt: '2026-07-16T00:00:00.000Z',
  updatedAt: '2026-07-16T00:00:00.000Z',
  completedAt: null,
};

describe(ForkCutoverVerificationService.name, () => {
  it.each([
    ['', 'snapshot-1', 'Database backup ID is required'],
    ['backup-1', '   ', 'Media snapshot ID is required'],
  ])('rejects empty immutable checkpoint IDs before mutation', async (databaseBackupId, snapshotId, message) => {
    const repository = { start: vi.fn() } as unknown as ForkCutoverVerificationRepository;
    const service = new ForkCutoverVerificationService(repository);

    await expect(service.start(databaseBackupId, snapshotId)).rejects.toThrow(message);
    expect(repository.start).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects invalid batch size %s before mutation', async (batchSize) => {
    const repository = { resume: vi.fn() } as unknown as ForkCutoverVerificationRepository;
    const service = new ForkCutoverVerificationService(repository);

    await expect(service.resume(run.id, batchSize)).rejects.toThrow('Batch size must be a positive integer');
    expect(repository.resume).not.toHaveBeenCalled();
  });

  it('returns status with the run and both immutable checkpoint IDs', async () => {
    const repository = { get: vi.fn().mockResolvedValue(run) } as unknown as ForkCutoverVerificationRepository;
    const service = new ForkCutoverVerificationService(repository);

    await expect(service.status(run.id)).resolves.toEqual(run);
  });

  it('hashes asset-ID-sorted canonical JSON lines', () => {
    const evidence = [
      { assetId: 'b', path: '/media/b', size: 2, sha1: 'b1', sha256: 'b256', device: '2', inode: '3', links: 1 },
      { assetId: 'a', path: '/media/a', size: 1, sha1: 'a1', sha256: 'a256', device: '2', inode: '2', links: 2 },
    ];

    expect(canonicalStorageVerificationDigest(evidence)).toBe(
      canonicalStorageVerificationDigest(evidence.toReversed()),
    );
    expect(canonicalStorageVerificationDigest([])).toMatch(/^[\da-f]{64}$/);
  });
});
