import { ForkSchemaRepository } from 'src/repositories/fork-schema.repository';
import { RepositoryInterface } from 'src/types';
import { Mocked, vitest } from 'vitest';

export const newForkSchemaRepositoryMock = (): Mocked<RepositoryInterface<ForkSchemaRepository>> => ({
  getState: vitest.fn(),
  getProgress: vitest.fn(),
  setPhase: vitest.fn(),
  claimBatch: vitest.fn(),
  completeBatch: vitest.fn(),
  failBatch: vitest.fn(),
});
