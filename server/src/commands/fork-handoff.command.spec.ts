import { ForkHandoffPrepareForkCommand, ForkHandoffPrepareOfficialCommand } from 'src/commands/fork-handoff.command';
import { ForkHandoffService } from 'src/services/fork-handoff.service';

describe('fork handoff CLI', () => {
  afterEach(() => vi.restoreAllMocks());

  it('prints canonical one-line JSON for official preparation', async () => {
    const checkpoint = {
      officialImage: 'ghcr.io/immich-app/immich-server:v3.0.3',
      id: 'checkpoint-1',
    };
    const service = { prepareOfficial: vi.fn().mockResolvedValue(checkpoint) } as unknown as ForkHandoffService;
    const command = new ForkHandoffPrepareOfficialCommand(service);
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await command.run([]);

    expect(output).toHaveBeenCalledOnce();
    expect(output).toHaveBeenCalledWith(
      '{"id":"checkpoint-1","officialImage":"ghcr.io/immich-app/immich-server:v3.0.3"}\n',
    );
  });

  it.each([0, -1, 1.5, NaN, Infinity])(
    'rejects invalid batch size %s before invoking return preparation',
    async (batchSize) => {
      const service = { prepareFork: vi.fn() } as unknown as ForkHandoffService;
      const command = new ForkHandoffPrepareForkCommand(service);

      await expect(command.run([], { batchSize })).rejects.toThrow('Batch size must be a positive integer');
      expect(service.prepareFork).not.toHaveBeenCalled();
    },
  );

  it('rejects positional compatibility aliases before invoking the service', async () => {
    const service = { prepareFork: vi.fn() } as unknown as ForkHandoffService;
    const command = new ForkHandoffPrepareForkCommand(service);

    await expect(command.run(['1'], { batchSize: 1 })).rejects.toThrow('Prepare fork accepts named options only');
    expect(service.prepareFork).not.toHaveBeenCalled();
  });

  it('passes the validated batch size and prints canonical one-line JSON', async () => {
    const report = { supportedTag: 'v3.0.3', active: true, phase: 'active' };
    const service = { prepareFork: vi.fn().mockResolvedValue(report) } as unknown as ForkHandoffService;
    const command = new ForkHandoffPrepareForkCommand(service);
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await command.run([], { batchSize: 3 });

    expect(service.prepareFork).toHaveBeenCalledWith({ batchSize: 3 });
    expect(output).toHaveBeenCalledWith('{"active":true,"phase":"active","supportedTag":"v3.0.3"}\n');
  });
});
