import { DatabaseLock } from 'src/enum';
import forkCatalogManifest from 'src/fork-schema/manifests/fork-v2-catalog.json';
import { GENERIC_LEGACY_FORK_MIGRATIONS, SUPPORTED_UPSTREAM_MIGRATIONS } from 'src/fork-schema/migration-manifest';
import { LEGACY_WORKFLOW_MIGRATION, OFFICIAL_WORKFLOW_MIGRATION } from 'src/fork-schema/workflow-compatibility';
import { ForkSchemaCutoverEvidence } from 'src/repositories/database.repository';
import { BACKFILL_KINDS } from 'src/repositories/fork-schema.repository';
import { ForkSchemaCutoverService } from 'src/services/fork-schema-cutover.service';
import { newTestService } from 'test/utils';

const SHA256_A = 'a'.repeat(64);
const SHA256_B = 'b'.repeat(64);
const checkpointOptions = { databaseBackupId: 'backup-1', mediaSnapshotId: 'snapshot-1' };
const currentForkLedger = [
  ...SUPPORTED_UPSTREAM_MIGRATIONS.map((name) =>
    name === OFFICIAL_WORKFLOW_MIGRATION ? LEGACY_WORKFLOW_MIGRATION : name,
  ),
  ...GENERIC_LEGACY_FORK_MIGRATIONS,
].map((name, index) => ({
  classification: (SUPPORTED_UPSTREAM_MIGRATIONS.includes(name) ? 'upstream' : 'legacy-fork') as
    | 'legacy-fork'
    | 'upstream',
  name,
  timestamp: new Date(Date.UTC(2026, 6, 15, 0, 0, index)).toISOString(),
}));

const evidence = (): ForkSchemaCutoverEvidence => ({
  activeWrites: 0,
  backfills: BACKFILL_KINDS.map((kind) => ({
    claimToken: null,
    claimedCursor: null,
    claimedIds: [],
    cursor: null,
    digest: SHA256_A,
    kind,
    lastError: null,
    processed: 1,
    remaining: 0,
  })),
  backfillKindsValid: true,
  catalogDiff: { clean: true, mismatched: [], missing: [], unexpected: [] },
  checksumCoverage: {
    applicableCount: 1,
    applicableDigest: SHA256_A,
    invalidCount: 0,
    sidecarCount: 1,
    sidecarDigest: SHA256_A,
    valid: true,
  },
  checksumFailures: 0,
  forkLedgerValid: true,
  forkMigrations: forkCatalogManifest.forkMigrations,
  installationClass: 'current-fork' as const,
  ledger: currentForkLedger,
  maintenanceMode: true,
  mappingCoverage: {
    mappingCount: 1,
    mappingDigest: SHA256_A,
    normalizedCount: 1,
    normalizedDigest: SHA256_A,
    unsafeCount: 0,
    valid: true,
  },
  migrationOrderValid: true,
  officialPendingMigrations: [],
  state: { active: false, phase: 'ready' as const, schemaVersion: '1', upstreamVersion: '3.0.3' },
  storageReservations: 0,
  storageVerification: {
    runId: '00000000-0000-4000-8000-000000000001',
    databaseBackupId: 'backup-1',
    mediaSnapshotId: 'snapshot-1',
    assetCount: 1,
    aggregateDigest: SHA256_B,
    evidenceAggregateDigest: SHA256_B,
    evidenceAssetCount: 1,
    failureCount: 0,
    rootDriftCount: 0,
    verifiedCount: 1,
    completedAt: new Date().toISOString(),
  },
  tableEvidence: forkCatalogManifest.tables.map(({ identity }) => ({
    count: ['public.plugin', 'public.plugin_method', 'public.workflow', 'public.workflow_step'].includes(identity)
      ? 1
      : 0,
    digest: 'c'.repeat(32),
    table: identity,
  })),
  unsafePhysicalMappings: 0,
  workflowCompatibility: {
    mode: 'legacy-alias' as const,
    rowDigests: (['plugin', 'plugin_method', 'workflow', 'workflow_step'] as const).map((table) => ({
      count: 1,
      digest: SHA256_A,
      table: `public.${table}` as const,
    })),
    schemaDigest: SHA256_B,
    timestamp: '2026-07-15T00:00:00.000Z',
  },
});

describe(ForkSchemaCutoverService.name, () => {
  it('accepts the complete options object and returns the complete positive contract', async () => {
    const { sut, mocks } = newTestService(ForkSchemaCutoverService);
    mocks.database.getForkSchemaCutoverEvidence.mockResolvedValue(evidence());

    const report = await sut.preflight({ databaseBackupId: 'backup-1', mediaSnapshotId: 'snapshot-1' });

    expect(report).toMatchObject({
      backfillKindsValid: true,
      catalogDiff: { clean: true },
      forkLedgerValid: true,
      installationClass: 'current-fork',
      maintenanceMode: true,
      ready: true,
      state: { phase: 'ready', schemaVersion: '1', upstreamVersion: '3.0.3' },
      storageVerification: { databaseBackupId: 'backup-1', mediaSnapshotId: 'snapshot-1' },
      workflowCompatibility: { mode: 'legacy-alias' },
    });
    expect(report.backfills).toHaveLength(BACKFILL_KINDS.length);
    expect(report.tableEvidence).toHaveLength(forkCatalogManifest.tables.length);
    expect(report.workflowCompatibility.rowDigests).toHaveLength(4);
    expect(report.digest).toMatch(/^[\da-f]{64}$/);
  });

  it('rejects malformed apply options before acquiring the mutation lock', async () => {
    const { sut, mocks } = newTestService(ForkSchemaCutoverService);

    await expect(
      sut.apply({
        databaseBackupId: 'backup-1',
        mediaSnapshotId: 'snapshot-1',
        reportDigest: 'not-sha256',
      }),
    ).rejects.toThrow('Expected preflight report digest must be a lowercase SHA-256 digest');
    expect(mocks.database.withLock).not.toHaveBeenCalled();
  });

  it('requires both checkpoint IDs before reading preflight evidence', async () => {
    const { sut, mocks } = newTestService(ForkSchemaCutoverService);

    await expect(sut.preflight({ ...checkpointOptions, databaseBackupId: '' })).rejects.toThrow(
      'Database backup ID is required',
    );
    await expect(sut.preflight({ ...checkpointOptions, mediaSnapshotId: '' })).rejects.toThrow(
      'Media snapshot ID is required',
    );
    expect(mocks.database.getForkSchemaCutoverEvidence).not.toHaveBeenCalled();
  });

  it('blocks a stale completed storage verification', async () => {
    const { sut, mocks } = newTestService(ForkSchemaCutoverService);
    mocks.database.getForkSchemaCutoverEvidence.mockResolvedValue({
      ...evidence(),
      storageVerification: { ...evidence().storageVerification!, completedAt: '2026-07-15T00:00:00.000Z' },
    });

    const report = await sut.preflight(checkpointOptions);

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('Storage verification checkpoint is older than one hour');
  });

  it('blocks storage verification when approved roots drift after completion', async () => {
    const { sut, mocks } = newTestService(ForkSchemaCutoverService);
    mocks.database.getForkSchemaCutoverEvidence.mockResolvedValue({
      ...evidence(),
      storageVerification: { ...evidence().storageVerification!, rootDriftCount: 1 },
    });

    const report = await sut.preflight(checkpointOptions);

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('Storage verification checkpoint evidence is invalid');
  });

  it('rechecks exact storage identity, count, digest, and freshness during apply', async () => {
    const { sut, mocks } = newTestService(ForkSchemaCutoverService);
    mocks.database.getForkSchemaCutoverEvidence.mockResolvedValue(evidence());
    mocks.database.withLock.mockImplementation(async (_lock, callback) => callback());
    mocks.database.commitForkSchemaCutover.mockImplementation(async (_digest, verify) => {
      mocks.database.getForkSchemaCutoverEvidence.mockResolvedValue({
        ...evidence(),
        storageVerification: { ...evidence().storageVerification!, aggregateDigest: 'd'.repeat(64) },
      });
      await verify({} as never);
      throw new Error('unreachable');
    });
    const report = await sut.preflight(checkpointOptions);

    await expect(sut.apply({ ...checkpointOptions, reportDigest: report.digest })).rejects.toThrow(
      'Fork schema cutover preflight changed',
    );
  });

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

    const report = await sut.preflight(checkpointOptions);

    await expect(sut.apply({ ...checkpointOptions, reportDigest: report.digest })).rejects.toThrow(
      'Fork schema cutover preflight changed',
    );
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
    mocks.database.commitForkSchemaCutover.mockImplementation(async (_digest, verify) => {
      await verify({} as never);
      return checkpoint;
    });
    mocks.database.runOfficialMigrations.mockRejectedValue(new Error('official migration failed'));
    const report = await sut.preflight(checkpointOptions);

    await expect(sut.apply({ ...checkpointOptions, reportDigest: report.digest })).rejects.toThrow(
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

    const report = await sut.preflight(checkpointOptions);

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

    const report = await sut.preflight(checkpointOptions);

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

    const report = await sut.preflight(checkpointOptions);

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain(blocker);
  });
});
