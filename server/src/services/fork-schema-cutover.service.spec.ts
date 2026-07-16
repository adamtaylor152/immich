import { DatabaseLock } from 'src/enum';
import { ForkSchemaCutoverService } from 'src/services/fork-schema-cutover.service';
import { newTestService } from 'test/utils';

const evidence = () => ({
  activeWrites: 0,
  backfills: [],
  backfillKindsValid: true,
  catalogDiff: { clean: true, mismatched: [], missing: [], unexpected: [] },
  checksumCoverage: {
    applicableCount: 0,
    applicableDigest: 'empty',
    invalidCount: 0,
    sidecarCount: 0,
    sidecarDigest: 'empty',
    valid: true,
  },
  checksumFailures: 0,
  forkLedgerValid: true,
  forkMigrations: ['0000000000000-ForkSchemaBaseline'],
  installationClass: 'current-fork' as const,
  ledger: [
    {
      classification: 'legacy-fork' as const,
      name: '1778000000000-PhysicalDeduplication',
      timestamp: '2026-07-15T00:00:00.000Z',
    },
  ],
  maintenanceMode: true,
  mappingCoverage: {
    mappingCount: 0,
    mappingDigest: 'empty',
    normalizedCount: 0,
    normalizedDigest: 'empty',
    unsafeCount: 0,
    valid: true,
  },
  migrationOrderValid: true,
  officialPendingMigrations: [],
  state: { active: false, phase: 'ready' as const, schemaVersion: '1', upstreamVersion: '3.0.3' },
  storageReservations: 0,
  tableEvidence: [],
  unsafePhysicalMappings: 0,
  workflowCompatibility: {
    mode: 'legacy-alias' as const,
    rowDigests: [],
    schemaDigest: 'workflow-schema',
    timestamp: '2026-07-15T00:00:00.000Z',
  },
});

describe(ForkSchemaCutoverService.name, () => {
  it('refuses apply when the locked preflight digest differs', async () => {
    const { sut, mocks } = newTestService(ForkSchemaCutoverService);
    mocks.database.getForkSchemaCutoverEvidence.mockResolvedValue(evidence());
    mocks.database.withLock.mockImplementation(async (lock, callback) => {
      expect(lock).toBe(DatabaseLock.Migrations);
      mocks.database.getForkSchemaCutoverEvidence.mockResolvedValue({
        ...evidence(),
        tableEvidence: [{ count: 1, digest: 'changed', table: 'immich_fork.asset_privacy' }],
      });
      return callback();
    });

    const report = await sut.preflight();

    await expect(sut.apply(report.digest)).rejects.toThrow('Fork schema cutover preflight changed');
    expect(mocks.database.commitForkSchemaCutover).not.toHaveBeenCalled();
  });

  it('runs the unchanged official migrator only after the cutover commit and requires restore on failure', async () => {
    const { sut, mocks } = newTestService(ForkSchemaCutoverService);
    const checkpoint = {
      committedAt: '2026-07-15T00:00:00.000Z',
      phase: 'inactive' as const,
      reportDigest: 'digest',
      schemaVersion: '2' as const,
    };
    mocks.database.getForkSchemaCutoverEvidence.mockResolvedValue(evidence());
    mocks.database.withLock.mockImplementation(async (lock, callback) => {
      expect(lock).toBe(DatabaseLock.Migrations);
      return callback();
    });
    mocks.database.commitForkSchemaCutover.mockImplementation(async (_digest, _installationClass, verify) => {
      await verify({} as never);
      return checkpoint;
    });
    mocks.database.runOfficialMigrations.mockRejectedValue(new Error('official migration failed'));
    const report = await sut.preflight();

    await expect(sut.apply(report.digest)).rejects.toThrow(
      'Fork schema cutover committed but official migrations failed; checkpoint restore required: official migration failed',
    );
    expect(mocks.database.commitForkSchemaCutover).toHaveBeenCalledOnce();
    expect(mocks.database.runOfficialMigrations).toHaveBeenCalledOnce();
    expect(mocks.database.commitForkSchemaCutover.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.database.runOfficialMigrations.mock.invocationCallOrder[0],
    );
  });

  it('fails closed on an unknown catalog object', async () => {
    const { sut, mocks } = newTestService(ForkSchemaCutoverService);
    mocks.database.getForkSchemaCutoverEvidence.mockResolvedValue({
      ...evidence(),
      catalogDiff: {
        clean: false,
        mismatched: [],
        missing: [],
        unexpected: [{ actual: 'table', identity: 'public.physical_file_unexpected', kind: 'tables' as const }],
      },
    });

    const report = await sut.preflight();

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('Unknown catalog object: tables public.physical_file_unexpected');
  });

  it.each([
    [
      'nonzero backfill remainder',
      {
        backfills: [
          {
            claimToken: null,
            claimedCursor: null,
            claimedIds: [],
            cursor: null,
            digest: null,
            kind: 'privacy',
            lastError: null,
            processed: 1,
            remaining: 1,
          },
        ],
      },
      'Backfill privacy is not durably complete',
    ],
    ['active writes', { activeWrites: 1 }, 'Fork schema cutover detected 1 active write transaction(s)'],
    [
      'checksum failure',
      { checksumCoverage: { ...evidence().checksumCoverage, invalidCount: 1, valid: false } },
      'Checksum coverage is incomplete, invalid, or digest-mismatched',
    ],
    [
      'unsafe physical mapping',
      { mappingCoverage: { ...evidence().mappingCoverage, unsafeCount: 1, valid: false } },
      'Physical mapping coverage is incomplete, unsafe, or digest-mismatched',
    ],
    [
      'unresolved storage reservation',
      { storageReservations: 1 },
      'Storage normalization has 1 unresolved reservation(s)',
    ],
  ])('fails closed on %s', async (_name, overrides, blocker) => {
    const { sut, mocks } = newTestService(ForkSchemaCutoverService);
    mocks.database.getForkSchemaCutoverEvidence.mockResolvedValue({ ...evidence(), ...overrides });

    const report = await sut.preflight();

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain(blocker);
  });

  it.each([
    ['maintenance mode disabled', { maintenanceMode: false }, 'Fork schema cutover requires maintenance mode'],
    [
      'missing fork baseline',
      { forkLedgerValid: false, forkMigrations: [] },
      'Fork migration ledger is not the exact ordered applied provider set',
    ],
    [
      'invalid official migration order',
      { migrationOrderValid: false },
      'Official migration ledger is not an exact ordered prefix of the bundled provider',
    ],
    [
      'active fork state',
      { state: { ...evidence().state, active: true, phase: 'active' as const } },
      'Fork schema cutover requires the ready, inactive phase',
    ],
  ])('fails closed when %s', async (_name, overrides, blocker) => {
    const { sut, mocks } = newTestService(ForkSchemaCutoverService);
    mocks.database.getForkSchemaCutoverEvidence.mockResolvedValue({ ...evidence(), ...overrides });

    const report = await sut.preflight();

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain(blocker);
  });
});
