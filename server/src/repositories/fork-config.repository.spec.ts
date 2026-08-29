import { defaults } from 'src/dtos/config.dto';
import { SystemConfigSchema } from 'src/dtos/system-config.dto';
import { canonicalize, digest } from 'src/repositories/fork-config.repository';

describe('fork-config canonicalization', () => {
  it('sorts object keys recursively while preserving array order', () => {
    const canonical = canonicalize({ z: [3, 1, 2], nested: { b: 1, a: { d: 4, c: 3 } } });

    expect(JSON.stringify(canonical)).toBe('{"nested":{"a":{"c":3,"d":4},"b":1},"z":[3,1,2]}');
  });

  it('produces the same digest regardless of key order', () => {
    const left = digest([{ key: 'smartAlbums', value: { enabled: true, minAssets: 5 } }]);
    const right = digest([{ value: { minAssets: 5, enabled: true }, key: 'smartAlbums' }]);

    expect(left).toBe(right);
  });

  it('changes the digest when a value changes', () => {
    expect(digest({ a: 1 })).not.toBe(digest({ a: 2 }));
  });
});

describe('fork-config SystemConfigSchema round-trip', () => {
  it('accepts the default configuration unchanged', () => {
    const result = SystemConfigSchema.safeParse(defaults);

    expect(result.success).toBe(true);
    expect(result.data).toEqual(defaults);
  });

  it('filters unknown keys out during the backfill round-trip', () => {
    // `backfillConfig` merges the legacy system-config snapshot over the
    // effective config and reparses; junk keys from a hand-edited legacy row
    // must not survive into the fork sidecar.
    const polluted = { ...structuredClone(defaults), junkTopLevel: true } as object;

    const result = SystemConfigSchema.safeParse(polluted);

    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty('junkTopLevel');
    expect(result.data).toEqual(defaults);
  });

  it('preserves the two mirrored sidecar keys through a round-trip', () => {
    const result = SystemConfigSchema.safeParse(structuredClone(defaults));

    expect(result.success).toBe(true);
    expect(result.data?.machineLearning.runpod).toEqual(defaults.machineLearning.runpod);
    expect(result.data?.smartAlbums).toEqual(defaults.smartAlbums);
  });
});
