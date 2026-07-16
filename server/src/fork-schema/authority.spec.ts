import { isForkAuthoritative, isLegacyAuthoritative } from 'src/fork-schema/authority';

describe('fork schema authority policy', () => {
  it.each(['legacy', 'dual-write', 'ready'] as const)('keeps legacy reads authoritative in %s', (phase) => {
    expect(isLegacyAuthoritative(phase)).toBe(true);
    expect(isForkAuthoritative(phase)).toBe(false);
  });

  it('makes sidecars authoritative only when active', () => {
    expect(isForkAuthoritative('active')).toBe(true);
    expect(isLegacyAuthoritative('active')).toBe(false);
  });

  it.each(['inactive', 'failed'] as const)('exposes neither authority in %s', (phase) => {
    expect(isLegacyAuthoritative(phase)).toBe(false);
    expect(isForkAuthoritative(phase)).toBe(false);
  });
});
