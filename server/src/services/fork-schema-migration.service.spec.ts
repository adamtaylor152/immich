import {
  ForkSchemaStartCommand,
  ForkSchemaVerifyCommand,
  formatForkSchemaStatus,
} from 'src/commands/fork-schema.command';
import { JobName, JobStatus } from 'src/enum';
import { BACKFILL_KINDS, BackfillKind, BackfillProgress } from 'src/repositories/fork-schema.repository';
import { BackfillBatchHandler, ForkSchemaMigrationService } from 'src/services/fork-schema-migration.service';
import { newTestService, ServiceMocks } from 'test/utils';

const state = (phase: 'legacy' | 'dual-write' | 'ready' = 'legacy') => ({
  active: false,
  phase,
  schemaVersion: '2',
  upstreamVersion: '3.0.3',
});

describe('fork-schema command', () => {
  const completeStatus = {
    ...state('dual-write'),
    verified: true,
    progress: BACKFILL_KINDS.map((kind) => progress(kind, { remaining: 0, digest: 'e'.repeat(64) })),
  };

  it('prints phase and per-kind progress details', () => {
    const output = formatForkSchemaStatus(completeStatus);

    expect(output).toContain('Phase: dual-write');
    expect(output).toContain('privacy: processed=0 remaining=0');
    expect(output).toContain(`digest=${'e'.repeat(64)}`);
    expect(output).toContain('lastError=none');
  });

  it('requires explicit confirmation before start', async () => {
    const migration = { start: vi.fn() } as unknown as ForkSchemaMigrationService;
    const inquirer = { ask: vi.fn().mockResolvedValue({ confirmed: false }) };
    const command = new ForkSchemaStartCommand(migration, inquirer as never);

    await command.run();

    expect(inquirer.ask).toHaveBeenCalledOnce();
    expect(migration.start).not.toHaveBeenCalled();
  });

  it('keeps the verify command read-only', async () => {
    const migration = { verify: vi.fn().mockResolvedValue(completeStatus) } as unknown as ForkSchemaMigrationService;
    const command = new ForkSchemaVerifyCommand(migration);

    await command.run();

    expect(migration.verify).toHaveBeenCalledOnce();
    expect('start' in migration).toBe(false);
    expect('pause' in migration).toBe(false);
    expect('resume' in migration).toBe(false);
  });
});

const progress = (kind: BackfillKind, overrides: Partial<BackfillProgress> = {}): BackfillProgress => ({
  kind,
  cursor: null,
  processed: 0,
  remaining: 10,
  digest: null,
  lastError: null,
  ...overrides,
});

describe(ForkSchemaMigrationService.name, () => {
  let service: ForkSchemaMigrationService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut: service, mocks } = newTestService(ForkSchemaMigrationService));
    mocks.forkSchema.getState.mockResolvedValue(state());
    mocks.forkSchema.getProgress.mockResolvedValue([]);
  });

  it('does not start outside legacy phase', async () => {
    mocks.forkSchema.getState.mockResolvedValue(state('ready'));

    await expect(service.start()).rejects.toThrow('Backfill can only start from legacy phase');
  });

  it('starts dual-write and queues exactly one batch per kind', async () => {
    mocks.forkSchema.getState.mockResolvedValue(state());
    mocks.forkSchema.transitionPhase.mockResolvedValue(true);

    await service.start(250);

    expect(mocks.forkSchema.transitionPhase).toHaveBeenCalledWith('legacy', 'dual-write');
    expect(mocks.job.queueAll).toHaveBeenCalledOnce();
    expect(mocks.job.queueAll).toHaveBeenCalledWith(
      BACKFILL_KINDS.map((kind) => ({ name: JobName.ForkSchemaBackfill, data: { kind, batchSize: 250 } })),
    );
  });

  it('allows only one concurrent start call to seed jobs', async () => {
    mocks.forkSchema.transitionPhase.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mocks.forkSchema.getState.mockResolvedValue(state('dual-write'));

    await Promise.all([service.start(250), service.start(250)]);

    expect(mocks.job.queueAll).toHaveBeenCalledOnce();
    expect(mocks.job.queueAll).toHaveBeenCalledWith(
      BACKFILL_KINDS.map((kind) => ({ name: JobName.ForkSchemaBackfill, data: { kind, batchSize: 250 } })),
    );
  });

  it('repairs missing initial seeds after a partial queue failure', async () => {
    mocks.forkSchema.transitionPhase.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mocks.forkSchema.getState.mockResolvedValue(state('dual-write'));
    mocks.job.queueAll.mockRejectedValueOnce(new Error('partial queue failure')).mockResolvedValueOnce();

    await expect(service.start(250)).rejects.toThrow('partial queue failure');
    await expect(service.start(250)).resolves.toMatchObject({ phase: 'dual-write' });

    expect(mocks.job.queueAll).toHaveBeenCalledTimes(2);
    expect(mocks.job.queueAll).toHaveBeenLastCalledWith(
      BACKFILL_KINDS.map((kind) => ({ name: JobName.ForkSchemaBackfill, data: { kind, batchSize: 250 } })),
    );
  });

  it('repairs missing resume seeds after a partial queue failure', async () => {
    mocks.forkSchema.transitionPhase.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mocks.forkSchema.getState.mockResolvedValue(state('dual-write'));
    mocks.job.queueAll.mockRejectedValueOnce(new Error('partial queue failure')).mockResolvedValueOnce();

    await expect(service.resume(250)).rejects.toThrow('partial queue failure');
    await expect(service.resume(250)).resolves.toMatchObject({ phase: 'dual-write' });

    expect(mocks.job.queueAll).toHaveBeenCalledTimes(2);
    expect(mocks.job.queueAll).toHaveBeenLastCalledWith(
      BACKFILL_KINDS.map((kind) => ({ name: JobName.ForkSchemaBackfill, data: { kind, batchSize: 250 } })),
    );
  });

  it('pauses idempotently', async () => {
    mocks.forkSchema.transitionPhase.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mocks.forkSchema.getState.mockResolvedValue(state('legacy'));

    await service.pause();
    await service.pause();

    expect(mocks.forkSchema.transitionPhase).toHaveBeenCalledTimes(2);
    expect(mocks.forkSchema.transitionPhase).toHaveBeenCalledWith('dual-write', 'legacy');
  });

  it('resumes idempotently', async () => {
    mocks.forkSchema.transitionPhase.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mocks.forkSchema.getState.mockResolvedValue(state('dual-write'));

    await service.resume(50);
    await service.resume(50);

    expect(mocks.forkSchema.transitionPhase).toHaveBeenCalledTimes(2);
    expect(mocks.forkSchema.transitionPhase).toHaveBeenCalledWith('legacy', 'dual-write');
    expect(mocks.job.queueAll).toHaveBeenCalledOnce();
  });

  it('allows only one concurrent resume call to seed jobs', async () => {
    mocks.forkSchema.transitionPhase.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mocks.forkSchema.getState.mockResolvedValue(state('dual-write'));

    await Promise.all([service.resume(50), service.resume(50)]);

    expect(mocks.job.queueAll).toHaveBeenCalledOnce();
  });

  it('projects structured status for every backfill kind', async () => {
    mocks.forkSchema.getState.mockResolvedValue(state('dual-write'));
    mocks.forkSchema.getProgress.mockResolvedValue([
      progress('privacy', { processed: 4, remaining: 6, digest: 'a'.repeat(64), lastError: 'stopped' }),
    ]);

    const result = await service.status();

    expect(result.phase).toBe('dual-write');
    expect(result.verified).toBe(false);
    expect(result.progress).toHaveLength(BACKFILL_KINDS.length);
    expect(result.progress[0]).toEqual({
      kind: 'privacy',
      cursor: null,
      processed: 4,
      remaining: 6,
      digest: 'a'.repeat(64),
      lastError: 'stopped',
    });
    expect(result.progress[1]).toEqual(progress('albums', { remaining: 0 }));
  });

  it('verify is read-only', async () => {
    mocks.forkSchema.getState.mockResolvedValue(state('dual-write'));
    mocks.forkSchema.getProgress.mockResolvedValue(BACKFILL_KINDS.map((kind) => progress(kind, { remaining: 0 })));

    const result = await service.verify();

    expect(result.verified).toBe(true);
    expect(mocks.forkSchema.setPhase).not.toHaveBeenCalled();
    expect(mocks.forkSchema.claimBatch).not.toHaveBeenCalled();
    expect(mocks.job.queueAll).not.toHaveBeenCalled();
  });

  it('fails closed when no handler is registered', async () => {
    mocks.forkSchema.getState.mockResolvedValue(state('dual-write'));
    mocks.forkSchema.claimBatch.mockResolvedValue({ ids: ['asset-1'], cursor: 'claim-token' });

    await expect(service.runBatch('privacy', 100)).resolves.toBe(JobStatus.Failed);

    expect(mocks.forkSchema.failBatch).toHaveBeenCalledWith(
      'privacy',
      'claim-token',
      'No backfill handler registered for privacy',
    );
    expect(mocks.forkSchema.completeBatch).not.toHaveBeenCalled();
  });

  it('does not enqueue another batch when a claim is already held', async () => {
    mocks.forkSchema.claimBatch.mockResolvedValue(null);
    mocks.forkSchema.getState.mockResolvedValue(state('dual-write'));
    mocks.forkSchema.getProgress.mockResolvedValue([progress('privacy', { remaining: 10 })]);

    await expect(service.runBatch('privacy', 100)).resolves.toBe(JobStatus.Skipped);

    expect(mocks.job.queue).not.toHaveBeenCalled();
    expect(mocks.forkSchema.setPhase).not.toHaveBeenCalled();
  });

  it('skips a queued batch after pause without claiming or recording an error', async () => {
    mocks.forkSchema.getState.mockResolvedValue(state('legacy'));

    await expect(service.runBatch('privacy', 100)).resolves.toBe(JobStatus.Skipped);

    expect(mocks.forkSchema.claimBatch).not.toHaveBeenCalled();
    expect(mocks.forkSchema.failBatch).not.toHaveBeenCalled();
    expect(mocks.forkSchema.completeBatch).not.toHaveBeenCalled();
    expect(mocks.job.queue).not.toHaveBeenCalled();
  });

  it('records a failed batch without advancing its cursor', async () => {
    mocks.forkSchema.getState.mockResolvedValue(state('dual-write'));
    const handler: BackfillBatchHandler = vi.fn().mockRejectedValue(new Error('sidecar write failed'));
    service.registerHandler('privacy', handler);
    mocks.forkSchema.claimBatch.mockResolvedValue({ ids: ['asset-1'], cursor: 'claim-token' });

    await expect(service.runBatch('privacy', 100)).resolves.toBe(JobStatus.Failed);

    expect(mocks.forkSchema.failBatch).toHaveBeenCalledWith('privacy', 'claim-token', 'sidecar write failed');
    expect(mocks.forkSchema.completeBatch).not.toHaveBeenCalled();
  });

  it('completes under the claim token and queues only the next batch for that kind', async () => {
    const handler: BackfillBatchHandler = vi.fn().mockResolvedValue({ count: 2, digest: 'b'.repeat(64) });
    service.registerHandler('privacy', handler);
    mocks.forkSchema.claimBatch.mockResolvedValue({ ids: ['asset-1', 'asset-2'], cursor: 'claim-token' });
    mocks.forkSchema.getState.mockResolvedValue(state('dual-write'));
    mocks.forkSchema.getProgress.mockResolvedValue([progress('privacy', { processed: 2, remaining: 8 })]);

    await expect(service.runBatch('privacy', 100)).resolves.toBe(JobStatus.Success);

    expect(handler).toHaveBeenCalledWith(['asset-1', 'asset-2']);
    expect(mocks.forkSchema.completeBatch).toHaveBeenCalledWith('privacy', 'claim-token', 2, 'b'.repeat(64));
    expect(mocks.forkSchema.failBatch).not.toHaveBeenCalled();
    expect(mocks.job.queue).toHaveBeenCalledOnce();
    expect(mocks.job.queue).toHaveBeenCalledWith({
      name: JobName.ForkSchemaBackfill,
      data: { kind: 'privacy', batchSize: 100 },
    });
  });

  it('does not advance when completion fails', async () => {
    mocks.forkSchema.getState.mockResolvedValue(state('dual-write'));
    service.registerHandler('privacy', vi.fn().mockResolvedValue({ count: 1, digest: 'c'.repeat(64) }));
    mocks.forkSchema.claimBatch.mockResolvedValue({ ids: ['asset-1'], cursor: 'claim-token' });
    mocks.forkSchema.completeBatch.mockRejectedValue(new Error('completion rejected'));

    await expect(service.runBatch('privacy', 100)).resolves.toBe(JobStatus.Failed);

    expect(mocks.forkSchema.failBatch).toHaveBeenCalledWith('privacy', 'claim-token', 'completion rejected');
    expect(mocks.job.queue).not.toHaveBeenCalled();
  });

  it('moves to ready when every kind is complete', async () => {
    service.registerHandler('privacy', vi.fn().mockResolvedValue({ count: 1, digest: 'd'.repeat(64) }));
    mocks.forkSchema.claimBatch.mockResolvedValue({ ids: ['asset-1'], cursor: 'claim-token' });
    mocks.forkSchema.getState.mockResolvedValue(state('dual-write'));
    mocks.forkSchema.getProgress.mockResolvedValue(BACKFILL_KINDS.map((kind) => progress(kind, { remaining: 0 })));

    await expect(service.runBatch('privacy', 100)).resolves.toBe(JobStatus.Success);

    expect(mocks.forkSchema.transitionPhase).toHaveBeenCalledWith('dual-write', 'ready');
    expect(mocks.job.queue).not.toHaveBeenCalled();
  });

  it('does not overwrite a concurrent pause when transitioning to ready', async () => {
    service.registerHandler('privacy', vi.fn().mockResolvedValue({ count: 1, digest: 'd'.repeat(64) }));
    mocks.forkSchema.getState.mockResolvedValue(state('dual-write'));
    mocks.forkSchema.claimBatch.mockResolvedValue({ ids: ['asset-1'], cursor: 'claim-token' });
    mocks.forkSchema.getProgress.mockResolvedValue(BACKFILL_KINDS.map((kind) => progress(kind, { remaining: 0 })));
    mocks.forkSchema.transitionPhase.mockResolvedValue(false);

    await expect(service.runBatch('privacy', 100)).resolves.toBe(JobStatus.Success);

    expect(mocks.forkSchema.transitionPhase).toHaveBeenCalledWith('dual-write', 'ready');
    expect(mocks.job.queue).not.toHaveBeenCalled();
  });
});
