import semver from 'semver';
import supportedVersions from 'src/fork-schema/supported-versions.json';

export const SUPPORTED_UPSTREAM_MIGRATIONS: readonly string[] = supportedVersions.upstreamMigrations;

export const LEGACY_FORK_MIGRATIONS: ReadonlySet<string> = new Set([
  '1778000000000-PhysicalDeduplication',
  '1778255964846-PhysicalDeduplicationSchemaReconcile',
  '1778300000000-AddVideoDuplicateFrames',
  '1778788656647-AddVideoDuplicateFrameTriggerOverride',
  '1778900000000-CreateAssetHealthTables',
  '1779000000000-AddAssetBestPhotoScore',
  '1779100000000-ReconcileAssetHealthAndBestPhotoSchema',
  '1779200000000-AddAssetExifDescriptionTrigramIndex',
  '1779300000000-AddSmartSearchDescriptionTable',
  '1779400000000-UpdateWorkflowTables',
  '1779500000000-ReconcileSchemaDrift',
  '1779600000000-CreateSmartAlbumTables',
  '1779700000000-AddAlbumParentAndClosure',
  '1779800000000-AddAlbumIcon',
  '1779900000000-AddAlbumSortOrder',
  '2100000000010-AddAssetIsNsfwIndex',
  '2100000000020-AddAlbumCycleGuardTrigger',
  '2100000000030-AddSha256ChecksumAlgorithm',
]);

export const GENERIC_LEGACY_FORK_MIGRATIONS: ReadonlySet<string> = new Set(
  [...LEGACY_FORK_MIGRATIONS].filter((name) => name !== '1779400000000-UpdateWorkflowTables'),
);

export function classifyMigration(name: string): 'upstream' | 'legacy-fork' | 'unknown' {
  if (LEGACY_FORK_MIGRATIONS.has(name)) {
    return 'legacy-fork';
  }

  if (supportedVersions.upstreamMigrations.includes(name)) {
    return 'upstream';
  }

  return 'unknown';
}

export function assertSupportedUpstream(version: string): void {
  if (!supportedVersions.ranges.some((range) => semver.satisfies(version, range))) {
    throw new Error(`Unsupported official Immich database version: ${version}`);
  }
}
