import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { assertReleaseManifest, assertSupportedUpstream, classifyMigration } from 'src/fork-schema/migration-manifest';
import {
  createCertifiedLedgerMigrationProvider,
  createOfficialMigrationProvider,
} from 'src/fork-schema/migration-provider';
import supportedVersions from 'src/fork-schema/supported-versions.json';
const serverPackage = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string };

describe(classifyMigration, () => {
  it('classifies known legacy fork migrations', () => {
    expect(classifyMigration('1778000000000-PhysicalDeduplication')).toBe('legacy-fork');
    expect(classifyMigration('2100000000030-AddSha256ChecksumAlgorithm')).toBe('legacy-fork');
    expect(classifyMigration('2100000000040-ReconcileSmartAlbumDrift')).toBe('legacy-fork');
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

describe(assertReleaseManifest, () => {
  it('pins the certified core plugin for every official image architecture', () => {
    expect(supportedVersions.certification.officialCorePluginDigests).toEqual({
      amd64: 'b6161c1e7535c6d18d90d78bd9851d7645da834e00c18521b662fa33beae8f07',
      arm64: '66369060c5d5aa41222fb148dfa397a5c316322ef2f01ff70a1725d7e0cb5d06',
    });
  });

  it('certifies the current server version and exact bundled official migration provider', async () => {
    const migrationFolder = resolve('src/schema/migrations');
    const bundledMigrations = Object.keys(
      await createCertifiedLedgerMigrationProvider(
        createOfficialMigrationProvider(migrationFolder),
        supportedVersions.upstreamMigrations,
      ).getMigrations(),
    );

    expect(() => assertReleaseManifest(serverPackage.version, supportedVersions, bundledMigrations)).not.toThrow();
  });

  it('rejects reversion support without a certified official tag', () => {
    expect(() =>
      assertReleaseManifest(
        serverPackage.version,
        { ...supportedVersions, certifiedTags: [], reversionSupported: true },
        supportedVersions.upstreamMigrations,
      ),
    ).toThrow('certified official tag');
  });

  it('rejects a release whose bundled official migrations drift from the manifest', () => {
    expect(() =>
      assertReleaseManifest(serverPackage.version, supportedVersions, supportedVersions.upstreamMigrations.slice(1)),
    ).toThrow('official migration manifest');
  });
});
