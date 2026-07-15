import { describe, expect, it } from 'vitest';

import { assertSupportedUpstream, classifyMigration } from 'src/fork-schema/migration-manifest';

describe(classifyMigration, () => {
  it('classifies known legacy fork migrations', () => {
    expect(classifyMigration('1778000000000-PhysicalDeduplication')).toBe('legacy-fork');
    expect(classifyMigration('2100000000030-AddSha256ChecksumAlgorithm')).toBe('legacy-fork');
  });

  it('classifies migrations from a certified upstream tag', () => {
    expect(classifyMigration('1744910873969-InitialMigration')).toBe('upstream');
  });

  it('does not guess unknown migrations', () => {
    expect(classifyMigration('9999999999999-CustomPatch')).toBe('unknown');
  });
});

it('accepts a supported upstream version', () => {
  expect(() => assertSupportedUpstream('3.0.3')).not.toThrow();
});

it('rejects an unsupported upstream version', () => {
  expect(() => assertSupportedUpstream('4.0.0')).toThrow();
});
