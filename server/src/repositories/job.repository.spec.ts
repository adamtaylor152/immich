import { ModuleRef } from '@nestjs/core';
import { QueueName } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';

const mocks = vi.hoisted(() => ({
  worker: vi.fn(() => ({ on: vi.fn() })),
}));

vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<typeof import('bullmq')>()),
  Worker: mocks.worker,
}));

describe(JobRepository.name, () => {
  let sut: JobRepository;

  beforeEach(() => {
    mocks.worker.mockClear();

    sut = new JobRepository(
      {} as ModuleRef,
      {
        getEnv: () => ({
          bull: {
            config: {
              connection: {},
              prefix: 'immich_bull',
            },
          },
        }),
      } as ConfigRepository,
      {} as EventRepository,
      {
        debug: vi.fn(),
        error: vi.fn(),
        setContext: vi.fn(),
        warn: vi.fn(),
      } as unknown as LoggingRepository,
    );
  });

  it('should use a longer lock for the database backup worker', () => {
    sut.startWorkers();

    const workerCalls = mocks.worker.mock.calls as unknown as Array<[QueueName, unknown, Record<string, unknown>]>;
    const backupWorkerCall = workerCalls.find(([queueName]) => queueName === QueueName.BackupDatabase);
    const backgroundWorkerCall = workerCalls.find(([queueName]) => queueName === QueueName.BackgroundTask);

    expect(backupWorkerCall?.[2]).toMatchObject({
      concurrency: 1,
      lockDuration: 30 * 60_000,
      lockRenewTime: 15 * 60_000,
    });
    expect(backgroundWorkerCall?.[2]).not.toHaveProperty('lockDuration');
    expect(mocks.worker).toHaveBeenCalled();
  });
});
