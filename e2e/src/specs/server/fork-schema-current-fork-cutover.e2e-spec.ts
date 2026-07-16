import { describe, expect, it } from 'vitest';
import {
  api,
  authHeaders,
  ensureAdmin,
  LATER_WORKFLOW_MIGRATIONS,
  LEGACY_WORKFLOW_MIGRATION,
  loadState,
  OFFICIAL_WORKFLOW_MIGRATION,
  phase,
  saveState,
  uploadAsset,
  withDatabase,
  workflowEvidence,
} from './fork-schema-certification';

const lane = 'current-fork-to-official-v3.0.3';
const LEGACY_FORK_MIGRATIONS = [
  '1778000000000-PhysicalDeduplication',
  '1778255964846-PhysicalDeduplicationSchemaReconcile',
  '1778300000000-AddVideoDuplicateFrames',
  '1778788656647-AddVideoDuplicateFrameTriggerOverride',
  '1778900000000-CreateAssetHealthTables',
  '1779000000000-AddAssetBestPhotoScore',
  '1779100000000-ReconcileAssetHealthAndBestPhotoSchema',
  '1779200000000-AddAssetExifDescriptionTrigramIndex',
  '1779300000000-AddSmartSearchDescriptionTable',
  LEGACY_WORKFLOW_MIGRATION,
  '1779500000000-ReconcileSchemaDrift',
  '1779600000000-CreateSmartAlbumTables',
  '1779700000000-AddAlbumParentAndClosure',
  '1779800000000-AddAlbumIcon',
  '1779900000000-AddAlbumSortOrder',
  '2100000000010-AddAssetIsNsfwIndex',
  '2100000000020-AddAlbumCycleGuardTrigger',
  '2100000000030-AddSha256ChecksumAlgorithm',
] as const;

describe.runIf(phase === 'current-fork-seed')(`${lane}: legacy marker fixture`, () => {
  it('creates a true post-update current-fork origin with nonempty workflow data', async () => {
    const admin = await ensureAdmin();
    const assets = await Promise.all(
      Array.from({ length: 256 }, (_, index) => uploadAsset(admin.accessToken, `legacy-origin-${index}.png`)),
    );
    const albums = await Promise.all(
      assets.map((asset, index) =>
        api<{ id: string }>('/albums', {
          body: JSON.stringify({ albumName: `Legacy origin album ${index}`, assetIds: [asset.id] }),
          headers: { ...authHeaders(admin.accessToken), 'content-type': 'application/json' },
          method: 'POST',
        }),
      ),
    );
    const fixture = await withDatabase(async (client) => {
      await client.query(
        `INSERT INTO public.plugin
          (id, enabled, name, version, title, description, author, "wasmBytes", "createdAt", "updatedAt")
         VALUES
          ('10000000-0000-4000-8000-000000000001', true, 'immich-plugin-core', '2.0.1', 'Immich Core Plugin',
           'Core workflow capabilities for Immich', 'Immich Team',
           pg_read_binary_file('/tmp/immich-plugin-core-v3.0.3.wasm'), now(), now())`,
      );
      await client.query(
        `INSERT INTO public.plugin_method
          (id, "pluginId", name, title, description, types, "hostFunctions", "uiHints", schema)
         VALUES
          ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
           'assetFavorite', 'Favorite', 'Favorite an asset', ARRAY['AssetV1']::varchar[], false,
           '{}'::varchar[],
           '{"type":"object","properties":{"inverse":{"type":"boolean","title":"Inverse","description":"Unfavorite by default, set to true to favorite instead","default":false}}}'::jsonb)`,
      );
      await client.query(
        `INSERT INTO public.workflow
          (id, "ownerId", trigger, name, description, "createdAt", "updatedAt", "updateId", enabled)
         VALUES
          ('30000000-0000-4000-8000-000000000003', $1::uuid, 'AssetCreate', 'legacy-post-update-favorite',
           'True legacy post-update fixture', now(), now(), '40000000-0000-4000-8000-000000000004', true)`,
        [admin.userId],
      );
      await client.query(
        `INSERT INTO public.workflow_step
          (id, enabled, "workflowId", "pluginMethodId", config, "order")
         VALUES
          ('50000000-0000-4000-8000-000000000005', true, '30000000-0000-4000-8000-000000000003',
           '20000000-0000-4000-8000-000000000002', '{"inverse":false}'::jsonb, 0)`,
      );
      const result = await client.query<{ albums: number; assets: number }>(
        `SELECT
          (SELECT count(*)::int FROM public.album) AS albums,
          (SELECT count(*)::int FROM public.asset) AS assets`,
      );
      const legacyLedger = await client.query<{ name: string }>(
        `SELECT name FROM public.kysely_migrations
         WHERE name = ANY($1::varchar[]) ORDER BY name`,
        [[...LEGACY_FORK_MIGRATIONS]],
      );
      const checksumAlgorithm = await client.query<{ present: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM pg_enum enum_value
           JOIN pg_type enum_type ON enum_type.oid = enum_value.enumtypid
           WHERE enum_type.typname = 'asset_checksum_algorithm_enum' AND enum_value.enumlabel = 'sha256'
         ) AS present`,
      );
      return {
        ...result.rows[0]!,
        hasSha256: checksumAlgorithm.rows[0]!.present,
        legacyLedger: legacyLedger.rows.map(({ name }) => name),
      };
    });
    const evidence = await workflowEvidence();
    expect(fixture).toEqual({
      albums: 256,
      assets: 256,
      hasSha256: true,
      legacyLedger: [...LEGACY_FORK_MIGRATIONS].toSorted(),
    });
    expect(evidence.rows.workflow.length).toBeGreaterThan(0);
    expect(evidence.rows.workflow_step.length).toBeGreaterThan(0);
    expect(evidence.ledger).toContainEqual(expect.objectContaining({ name: LEGACY_WORKFLOW_MIGRATION }));
    expect(evidence.ledger).not.toContainEqual(expect.objectContaining({ name: OFFICIAL_WORKFLOW_MIGRATION }));
    expect(evidence.ledger.map(({ name }) => name)).not.toEqual(expect.arrayContaining([...LATER_WORKFLOW_MIGRATIONS]));
    expect(evidence.columns).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ column_name: 'templates', table_name: 'plugin' }),
        expect.objectContaining({ column_name: 'allowedHosts', table_name: 'plugin_method' }),
      ]),
    );
    await saveState(lane, {
      admin,
      albumCount: fixture.albums,
      albumId: albums[0]!.id,
      assetCount: fixture.assets,
      assetId: assets[0]!.id,
      evidence,
      workflowId: '30000000-0000-4000-8000-000000000003',
    });
  }, 120_000);
});

describe.runIf(phase === 'current-fork-quiescent')(`${lane}: writer quiescence`, () => {
  it('drains every unrelated worker queue before establishing backfill digests', async () => {
    const { admin } = await loadState<{ admin: { accessToken: string } }>(lane);
    let stableSnapshots = 0;

    for (let attempt = 0; attempt < 600 && stableSnapshots < 5; attempt++) {
      const queues = await api<
        Record<string, { jobCounts: { active: number; delayed: number; waiting: number } }>
      >('/jobs', { headers: authHeaders(admin.accessToken) });
      const busyQueues = Object.entries(queues).filter(
        ([, { jobCounts }]) => jobCounts.active > 0 || jobCounts.delayed > 0 || jobCounts.waiting > 0,
      );
      stableSnapshots = busyQueues.length === 0 ? stableSnapshots + 1 : 0;
      if (stableSnapshots < 5) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    expect(stableSnapshots).toBe(5);
  }, 120_000);
});

describe.runIf(phase === 'current-fork-cutover')(`${lane}: locked cutover`, () => {
  it('aliases only 177940 to 177861 and preserves every workflow row digest', async () => {
    const before = await loadState<{
      albumCount: number;
      assetCount: number;
      evidence: Awaited<ReturnType<typeof workflowEvidence>>;
    }>(lane);
    const after = await workflowEvidence();
    const legacyTimestamp = before.evidence.ledger.find(({ name }) => name === LEGACY_WORKFLOW_MIGRATION)?.timestamp;
    const progress = await withDatabase(async (client) => {
      const result = await client.query<{ digest: string; kind: string; processed: number }>(
        `SELECT kind, processed::float8 AS processed, digest
         FROM immich_fork.backfill_progress ORDER BY kind`,
      );
      return result.rows;
    });
    expect(after.ledger).toContainEqual(
      expect.objectContaining({ name: OFFICIAL_WORKFLOW_MIGRATION, timestamp: legacyTimestamp }),
    );
    expect(after.ledger).not.toContainEqual(expect.objectContaining({ name: LEGACY_WORKFLOW_MIGRATION }));
    expect(after.rowDigests).toEqual(before.evidence.rowDigests);
    expect(after.schemaDigest).toBe(before.evidence.schemaDigest);
    expect(progress).toHaveLength(7);
    for (const item of progress) {
      expect(item.processed).toBe(
        item.kind === 'albums' || item.kind === 'automation' ? before.albumCount : before.assetCount,
      );
      expect(item.digest).toMatch(/^[\da-f]{64}$/);
    }
  });
});

describe.runIf(phase === 'current-fork-official')(`${lane}: official migration`, () => {
  it('keeps the seeded rows while later workflow columns are present', async () => {
    const before = await loadState<{ evidence: Awaited<ReturnType<typeof workflowEvidence>> }>(lane);
    const after = await workflowEvidence();
    expect(after.rowIds.workflow).toEqual(before.evidence.rowIds.workflow);
    expect(after.rowIds.workflow_step).toEqual(before.evidence.rowIds.workflow_step);
    expect(after.ledger.map(({ name }) => name)).toEqual(expect.arrayContaining([...LATER_WORKFLOW_MIGRATIONS]));
    expect(after.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ column_name: 'templates', table_name: 'plugin' }),
        expect.objectContaining({ column_name: 'sha256hash', table_name: 'plugin' }),
        expect.objectContaining({ column_name: 'allowedHosts', table_name: 'plugin_method' }),
      ]),
    );
  });
});
