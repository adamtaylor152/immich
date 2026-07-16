import { ImmichAdminModule } from 'src/app.module';
import { JobRepository } from 'src/repositories/job.repository';
import { CliService } from 'src/services/cli.service';
import { ForkSchemaMigrationService } from 'src/services/fork-schema-migration.service';
import { StorageService } from 'src/services/storage.service';

describe(ImmichAdminModule.name, () => {
  it('registers job routing for admin commands without starting workers', async () => {
    const cli = { cleanup: vi.fn() } as unknown as CliService;
    const job = {
      setup: vi.fn(),
      startWorkers: vi.fn(),
    } as unknown as JobRepository;
    const storage = { initializeMediaLocation: vi.fn(), onBootstrap: vi.fn() } as unknown as StorageService;
    const sut = new ImmichAdminModule(cli, job, storage);

    await sut.onModuleInit();

    const registeredServices = vi.mocked(job.setup).mock.calls[0]?.[0];
    expect(registeredServices).toContain(ForkSchemaMigrationService);
    expect(job.startWorkers).not.toHaveBeenCalled();
    expect(storage.initializeMediaLocation).toHaveBeenCalledOnce();
    expect(storage.onBootstrap).not.toHaveBeenCalled();
  });
});
