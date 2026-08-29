import { canonicalize, digestRows, PrivacySidecar } from 'src/repositories/fork-privacy.repository';

const row = (overrides: Partial<PrivacySidecar> = {}): PrivacySidecar => ({
  assetId: '00000000-0000-4000-a000-000000000001',
  isNsfw: false,
  suppression: { reviewedBy: 'admin', state: 'cleared' },
  ...overrides,
});

describe('fork-privacy canonicalization', () => {
  it('sorts object keys recursively while preserving array order', () => {
    const canonical = canonicalize({ b: { d: 1, c: [{ z: 1, a: 2 }, 'x'] }, a: true });

    expect(JSON.stringify(canonical)).toBe('{"a":true,"b":{"c":[{"a":2,"z":1},"x"],"d":1}}');
  });

  it('produces the same digest regardless of suppression key order', () => {
    const left = digestRows([row({ suppression: { reviewedBy: 'admin', state: 'cleared' } })]);
    const right = digestRows([row({ suppression: { state: 'cleared', reviewedBy: 'admin' } })]);

    expect(left).toBe(right);
  });

  it('changes the digest when a value changes', () => {
    expect(digestRows([row({ isNsfw: false })])).not.toBe(digestRows([row({ isNsfw: true })]));
    expect(digestRows([row()])).not.toBe(digestRows([]));
  });

  it('is stable for the empty batch', () => {
    expect(digestRows([])).toBe(digestRows([]));
  });
});
