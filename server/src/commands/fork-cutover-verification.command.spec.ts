import {
  ForkCutoverVerificationResumeCommand,
  ForkCutoverVerificationStartCommand,
  ForkCutoverVerificationStatusCommand,
} from 'src/commands/fork-cutover-verification.command';
import {
  ForkSchemaCutoverApplyCommand,
  ForkSchemaCutoverPreflightCommand,
} from 'src/commands/fork-schema-cutover.command';
import { ForkCutoverVerificationService } from 'src/services/fork-cutover-verification.service';
import { ForkSchemaCutoverService } from 'src/services/fork-schema-cutover.service';

const options = { databaseBackupId: 'backup-1', mediaSnapshotId: 'snapshot-1' };
const response = { id: 'run-1', ...options, status: 'running' };

describe('fork cutover verification CLI', () => {
  afterEach(() => vi.restoreAllMocks());

  it('rejects missing start IDs before mutation', async () => {
    const service = { start: vi.fn() } as unknown as ForkCutoverVerificationService;
    const command = new ForkCutoverVerificationStartCommand(service);

    await expect(command.run([], { ...options, databaseBackupId: '' })).rejects.toThrow(
      'Database backup ID is required',
    );
    expect(service.start).not.toHaveBeenCalled();
  });

  it('rejects an invalid resume batch size before mutation', async () => {
    const service = { resumeLatest: vi.fn() } as unknown as ForkCutoverVerificationService;
    const command = new ForkCutoverVerificationResumeCommand(service);

    await expect(command.run([], { ...options, batchSize: 0 })).rejects.toThrow(
      'Batch size must be a positive integer',
    );
    expect(service.resumeLatest).not.toHaveBeenCalled();
  });

  it('prints exact status including run ID and both checkpoint IDs', async () => {
    const service = { statusLatest: vi.fn().mockResolvedValue(response) } as unknown as ForkCutoverVerificationService;
    const command = new ForkCutoverVerificationStatusCommand(service);
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});

    await command.run([], options);

    expect(output).toHaveBeenCalledWith(JSON.stringify(response, null, 2));
  });

  it('binds preflight to both operator checkpoint IDs', async () => {
    const report = { ready: true, digest: 'a'.repeat(64) };
    const service = { preflight: vi.fn().mockResolvedValue(report) } as unknown as ForkSchemaCutoverService;
    const command = new ForkSchemaCutoverPreflightCommand(service);
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});

    await command.run([], options);

    expect(service.preflight).toHaveBeenCalledWith('backup-1', 'snapshot-1');
    expect(output).toHaveBeenCalledWith(JSON.stringify(report, null, 2));
  });

  it('rejects an apply without an exact report digest before mutation', async () => {
    const service = { apply: vi.fn() } as unknown as ForkSchemaCutoverService;
    const command = new ForkSchemaCutoverApplyCommand(service);

    await expect(command.run([], options)).rejects.toThrow('Preflight report digest is required');
    expect(service.apply).not.toHaveBeenCalled();
  });

  it('binds apply to the report digest and both operator checkpoint IDs', async () => {
    const checkpoint = { phase: 'inactive', schemaVersion: '2' };
    const service = { apply: vi.fn().mockResolvedValue(checkpoint) } as unknown as ForkSchemaCutoverService;
    const command = new ForkSchemaCutoverApplyCommand(service);
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const reportDigest = 'a'.repeat(64);

    await command.run([], { ...options, reportDigest });

    expect(service.apply).toHaveBeenCalledWith(reportDigest, 'backup-1', 'snapshot-1');
    expect(output).toHaveBeenCalledWith(JSON.stringify(checkpoint, null, 2));
  });
});
