import { Queue, Worker } from 'bullmq';
import { getForkSchemaBackfillJobOptions } from 'src/repositories/job.repository';
import { GenericContainer, StartedTestContainer } from 'testcontainers';

const waitFor = async (condition: () => boolean, timeout = 5000): Promise<void> => {
  const deadline = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for BullMQ lifecycle');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe('fork schema BullMQ lifecycle', () => {
  let redis: StartedTestContainer;
  let connection: { host: string; port: number };

  beforeAll(async () => {
    redis = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();
    connection = { host: redis.getHost(), port: redis.getMappedPort(6379) };
  }, 60_000);

  afterAll(async () => {
    await redis.stop();
  });

  it('accepts a successor queued by each active batch until all batches finish', async () => {
    const queueName = `fork-schema-lifecycle-${crypto.randomUUID()}`;
    const queue = new Queue(queueName, { connection });
    const runs: number[] = [];
    let active = 0;
    let maxActive = 0;
    const worker = new Worker<{ batch: number }>(
      queueName,
      async (job) => {
        active++;
        maxActive = Math.max(maxActive, active);
        runs.push(job.data.batch);
        if (job.data.batch < 3) {
          await queue.add(
            'ForkSchemaBackfill',
            { batch: job.data.batch + 1 },
            getForkSchemaBackfillJobOptions('privacy'),
          );
        }
        active--;
      },
      { connection },
    );

    try {
      await worker.waitUntilReady();
      await queue.add('ForkSchemaBackfill', { batch: 1 }, getForkSchemaBackfillJobOptions('privacy'));
      await waitFor(() => runs.length === 3);

      expect(runs).toEqual([1, 2, 3]);
      expect(maxActive).toBe(1);
      await expect(queue.getWaitingCount()).resolves.toBe(0);
    } finally {
      await worker.close();
      await queue.close();
    }
  });

  it('keeps exactly one resume successor while the pre-pause job is still active', async () => {
    const queueName = `fork-schema-resume-${crypto.randomUUID()}`;
    const queue = new Queue(queueName, { connection });
    const runs: number[] = [];
    let releaseFirst!: () => void;
    const firstMayFinish = new Promise<void>((resolve) => (releaseFirst = resolve));
    const worker = new Worker<{ generation: number }>(
      queueName,
      async (job) => {
        runs.push(job.data.generation);
        if (job.data.generation === 1) {
          await firstMayFinish;
        }
      },
      { connection },
    );

    try {
      await worker.waitUntilReady();
      await queue.add('ForkSchemaBackfill', { generation: 1 }, getForkSchemaBackfillJobOptions('privacy'));
      await waitFor(() => runs.length === 1);

      await queue.add('ForkSchemaBackfill', { generation: 2 }, getForkSchemaBackfillJobOptions('privacy'));
      await queue.add('ForkSchemaBackfill', { generation: 3 }, getForkSchemaBackfillJobOptions('privacy'));
      releaseFirst();

      await waitFor(() => runs.length === 2);
      expect(runs).toEqual([1, 3]);
      await expect(queue.getWaitingCount()).resolves.toBe(0);
    } finally {
      releaseFirst();
      await worker.close();
      await queue.close();
    }
  });
});
