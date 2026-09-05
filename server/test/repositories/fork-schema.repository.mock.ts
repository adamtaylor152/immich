import { ForkSchemaRepository } from 'src/repositories/fork-schema.repository';
import { RepositoryInterface } from 'src/types';
import { Mocked, vitest } from 'vitest';

export const newForkSchemaRepositoryMock = (): Mocked<RepositoryInterface<ForkSchemaRepository>> => ({
  activateAfterReturnReconciliation: vitest.fn(),
  beginOrResumeReturnReconciliation: vitest.fn(),
  recordAssetChecksums: vitest.fn(),
  hasAssetChecksum: vitest.fn((_ownerId: string, _sha1: Buffer, _sha256: Buffer) => Promise.resolve(false)),
  getChecksumTranslations: vitest.fn((_ownerId: string, _sha1Checksums: Buffer[]) => Promise.resolve([])),
  overlayConfig: vitest.fn((config) => Promise.resolve(config)),
  mirrorConfig: vitest.fn(),
  persistConfig: vitest.fn(),
  getState: vitest.fn(),
  getProgress: vitest.fn(),
  setPhase: vitest.fn(),
  transitionPhase: vitest.fn(),
  claimBatch: vitest.fn(),
  claimReturnBatch: vitest.fn(),
  claimOfficialHandoffBatch: vitest.fn(),
  beginOrResumeOfficialHandoffPreparation: vitest.fn(),
  completeOfficialHandoffPreparation: vitest.fn(),
  completeBatch: vitest.fn(),
  failBatch: vitest.fn(),
  finalizeReturnAutomationProgress: vitest.fn(),
  getReturnConfigReconciliation: vitest.fn(),
  recordReturnConfigReconciliation: vitest.fn(),
});
