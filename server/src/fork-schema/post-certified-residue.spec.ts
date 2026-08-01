import { CERTIFIED_TAG_MIGRATIONS, POST_CERTIFIED_UPSTREAM_MIGRATIONS } from 'src/fork-schema/migration-manifest';
import {
  irreversiblePostCertifiedMigrations,
  REVERSIBLE_POST_CERTIFIED_MIGRATIONS,
} from 'src/fork-schema/post-certified-residue';
import supportedVersions from 'src/fork-schema/supported-versions.json';

describe('post-certified upstream residue', () => {
  it('registers an exact reversal for every post-certified migration', () => {
    // Fail-closed invariant: cutover refuses any residue it cannot revert, so
    // shipping a post-certified migration without a registered reversal would
    // permanently block the certified official handoff.
    expect(irreversiblePostCertifiedMigrations(POST_CERTIFIED_UPSTREAM_MIGRATIONS)).toEqual([]);
    for (const name of POST_CERTIFIED_UPSTREAM_MIGRATIONS) {
      expect(REVERSIBLE_POST_CERTIFIED_MIGRATIONS.get(name)).toBeDefined();
    }
  });

  it('keeps the residue set disjoint from and ordered after the certified tag set', () => {
    const certified = new Set(CERTIFIED_TAG_MIGRATIONS);
    for (const name of POST_CERTIFIED_UPSTREAM_MIGRATIONS) {
      expect(certified.has(name)).toBe(false);
    }
    // The residue names must be the final entries of the official order so a
    // certified ledger stays an exact prefix of the full upstream set.
    const residue = supportedVersions.postCertifiedUpstreamMigrations;
    expect(supportedVersions.upstreamMigrations.slice(-residue.length)).toEqual(residue);
    expect([...CERTIFIED_TAG_MIGRATIONS, ...residue]).toEqual(supportedVersions.upstreamMigrations);
  });

  it('flags only residue names without a registered reversal', () => {
    expect(irreversiblePostCertifiedMigrations(['1744910873969-InitialMigration'])).toEqual([]);
    expect(irreversiblePostCertifiedMigrations([...POST_CERTIFIED_UPSTREAM_MIGRATIONS, 'unknown'])).toEqual([]);
  });
});
