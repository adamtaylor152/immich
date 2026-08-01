import type { ForkSchemaPhase } from 'src/repositories/fork-schema.repository';

export const isLegacyAuthoritative = (phase: ForkSchemaPhase): boolean =>
  ['legacy', 'dual-write', 'ready'].includes(phase);

export const isForkAuthoritative = (phase: ForkSchemaPhase): boolean => phase === 'active';

export const isForkWriteEnabled = (phase: ForkSchemaPhase): boolean =>
  ['dual-write', 'ready', 'active'].includes(phase);
