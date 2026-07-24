import type { ForkSchemaPhase } from 'src/repositories/fork-schema.repository';

export const isLegacyAuthoritative = (phase: ForkSchemaPhase): boolean =>
  phase === 'legacy' || phase === 'dual-write' || phase === 'ready';

export const isForkAuthoritative = (phase: ForkSchemaPhase): boolean => phase === 'active';

export const isForkWriteEnabled = (phase: ForkSchemaPhase): boolean =>
  phase === 'dual-write' || phase === 'ready' || phase === 'active';
