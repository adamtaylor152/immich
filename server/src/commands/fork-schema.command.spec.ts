import { InquirerService } from 'nest-commander';
import { ForkSchemaResumeCommand, ForkSchemaStartCommand } from 'src/commands/fork-schema.command';
import { ForkSchemaMigrationService, ForkSchemaMigrationStatus } from 'src/services/fork-schema-migration.service';

const status = {
  active: false,
  phase: 'dual-write',
  progress: [],
  schemaVersion: '1',
  upstreamVersion: '3.0.3',
  verified: false,
} as ForkSchemaMigrationStatus;

describe('fork schema CLI batch sizing', () => {
  beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('passes a validated batch size to start', async () => {
    const migration = { start: vi.fn().mockResolvedValue(status) } as unknown as ForkSchemaMigrationService;
    const inquirer = { ask: vi.fn().mockResolvedValue({ confirmed: true }) } as unknown as InquirerService;
    const command = new ForkSchemaStartCommand(migration, inquirer);

    await command.run([], { batchSize: 1 });

    expect(migration.start).toHaveBeenCalledWith(1);
  });

  it('passes a validated batch size to resume', async () => {
    const migration = { resume: vi.fn().mockResolvedValue(status) } as unknown as ForkSchemaMigrationService;
    const command = new ForkSchemaResumeCommand(migration);

    await command.run([], { batchSize: 1 });

    expect(migration.resume).toHaveBeenCalledWith(1);
  });

  it.each(['0', '-1', '1.5', 'nope'])('rejects invalid batch size %s', (value) => {
    const command = new ForkSchemaResumeCommand({} as ForkSchemaMigrationService);

    expect(() => command.parseBatchSize(value)).toThrow('Batch size must be a positive integer');
  });
});
