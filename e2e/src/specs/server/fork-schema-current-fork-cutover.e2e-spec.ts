import { describe, expect, it } from 'vitest';
import {
  api,
  authHeaders,
  ensureAdmin,
  LATER_WORKFLOW_MIGRATIONS,
  LEGACY_WORKFLOW_MIGRATION,
  loadState,
  migrationEvidence,
  OFFICIAL_WORKFLOW_MIGRATION,
  phase,
  saveState,
  uploadAsset,
  withDatabase,
  workflowEvidence,
} from './fork-schema-certification';

const lane = 'current-fork-to-official-v3.1.0';
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
      await client.query(`UPDATE public.asset SET is_nsfw = true WHERE id = ANY($1::uuid[])`, [
        [assets[0]!.id, assets[1]!.id],
      ]);
      await client.query(
        `INSERT INTO public.asset_metadata ("assetId", key, value)
         SELECT id, 'ml-enrichment', jsonb_build_object(
           'description', jsonb_build_object('status', 'success', 'result', jsonb_build_object(
             'description', 'certified generated description', 'tags', jsonb_build_array('certified-tag'))),
           'nsfwDetection', jsonb_build_object('review', jsonb_build_object('suppressed', true, 'reason', 'certification')))
         FROM public.asset WHERE id = ANY($1::uuid[])
         ON CONFLICT ("assetId", key) DO UPDATE SET value = EXCLUDED.value`,
        [[assets[0]!.id, assets[1]!.id]],
      );
      await client.query(`UPDATE public.album SET icon = 'star', "sortOrder" = 42.5 WHERE id = $1`, [albums[0]!.id]);
      await client.query(
        `INSERT INTO public.smart_album (id, kind, "ownerId", "albumId")
         VALUES ('60000000-0000-4000-8000-000000000006', 'certified-non-default', $1, $2)`,
        [admin.userId, albums[0]!.id],
      );
      await client.query(
        `INSERT INTO public.smart_album_asset ("smartAlbumId", "assetId", "matchReason")
         VALUES ('60000000-0000-4000-8000-000000000006', $1, 'both')`,
        [assets[0]!.id],
      );
      await client.query(
        `INSERT INTO public.smart_album_exclusion ("smartAlbumId", "assetId")
         VALUES ('60000000-0000-4000-8000-000000000006', $1)`,
        [assets[1]!.id],
      );
      await client.query(
        `INSERT INTO public.asset_health_run
           (id, category, status, "finishedAt", "totalAssets", "checkedAssets", "foundAssets")
         VALUES ('70000000-0000-4000-8000-000000000007', 'missing', 'completed', now(), 2, 2, 2)`,
      );
      for (const [index, asset] of [assets[0]!, assets[1]!].entries()) {
        await client.query(
          `INSERT INTO public.asset_health
             (id, "assetId", "runId", category, status, severity, "originalPath", "originalFileName",
              evidence, resolution, "checkedAt")
           VALUES ($1::uuid, $2, '70000000-0000-4000-8000-000000000007', 'missing', 'open', 'warning',
                   $3, $4, '{"certified":true}', '{"action":"review"}', now())`,
          [
            `80000000-0000-4000-8000-00000000000${index + 8}`,
            asset.id,
            `/certified/${index}.png`,
            `certified-${index}.png`,
          ],
        );
        await client.query(
          `INSERT INTO public.asset_best_photo_score
             ("assetId", "ownerId", score, "aestheticScore", "technicalScore", "subjectScore", "diversityScore",
              "scoreVersion", "computedAt", metadata)
           VALUES ($1, $2, 0.91, 0.82, 0.73, 0.64, 0.55, 7, now(), '{"certified":true}')`,
          [asset.id, admin.userId],
        );
      }
      await client.query(
        `INSERT INTO public.plugin
          (id, enabled, name, version, title, description, author, "wasmBytes", templates, "sha256hash",
           "createdAt", "updatedAt")
         VALUES
          ('10000000-0000-4000-8000-000000000001', true, 'immich-plugin-core', '2.0.1', 'Immich Core Plugin',
           'Core workflow capabilities for Immich', 'Immich Team',
           pg_read_binary_file('/tmp/immich-plugin-core-v3.1.0.wasm'), '[]'::jsonb,
           sha256(pg_read_binary_file('/tmp/immich-plugin-core-v3.1.0.wasm')), now(), now())`,
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
      legacyLedger: [...LEGACY_FORK_MIGRATIONS].toSorted((a, b) => a.localeCompare(b)),
    });
    expect(evidence.rows.workflow.length).toBeGreaterThan(0);
    expect(evidence.rows.workflow_step.length).toBeGreaterThan(0);
    expect(evidence.ledger).toContainEqual(expect.objectContaining({ name: LEGACY_WORKFLOW_MIGRATION }));
    expect(evidence.ledger).not.toContainEqual(expect.objectContaining({ name: OFFICIAL_WORKFLOW_MIGRATION }));
    // Post-sync, the later workflow migrations are bundled upstream migrations,
    // so a current-fork origin ledgers them before cutover (aliasing only maps
    // the legacy rewrite marker to its official name).
    expect(evidence.ledger.map(({ name }) => name)).toEqual(expect.arrayContaining([...LATER_WORKFLOW_MIGRATIONS]));
    // Post-sync these upstream columns exist on a current-fork origin too.
    expect(evidence.columns).toEqual(
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
      assetIds: assets.map(({ id }) => id),
      deletedAssetId: assets[1]!.id,
      albumIds: albums.map(({ id }) => id),
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
      const queues = await api<Record<string, { jobCounts: { active: number; delayed: number; waiting: number } }>>(
        '/jobs',
        { headers: authHeaders(admin.accessToken) },
      );
      const busyQueues = Object.entries(queues).filter(
        ([, { jobCounts }]) => jobCounts.active > 0 || jobCounts.delayed > 0 || jobCounts.waiting > 0,
      );
      stableSnapshots = busyQueues.length === 0 ? stableSnapshots + 1 : 0;
      if (stableSnapshots < 5) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    expect(stableSnapshots).toBe(5);

    // The microservices boot force-re-imports the bundled core plugin
    // (onPluginSync), rewriting plugin/plugin_method rows the api-only seed
    // phase captured. Rebaseline the evidence here so the cutover assertion
    // certifies what it intends: cutover itself preserves every workflow row
    // digest. Stable across later restarts — each re-import writes identical
    // values from the same image.
    // The import runs asynchronously on the microservices boot, so queue
    // drain alone doesn't guarantee it has landed — poll until the manifest's
    // 14 methods are present.
    let converged = await workflowEvidence();
    for (let attempt = 0; attempt < 300 && converged.rows.plugin_method.length < 14; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      converged = await workflowEvidence();
    }
    expect(converged.rows.plugin).toHaveLength(1);
    expect(converged.rows.plugin[0]).toMatchObject({ name: 'immich-plugin-core', version: '2.0.1' });
    expect(converged.rows.plugin_method).toHaveLength(14);
    const fullState = await loadState<Record<string, unknown>>(lane);
    await saveState(lane, { ...fullState, evidence: converged });
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
    // Scope to the workflow tables this test certifies. The bundled core
    // plugin is force-re-imported on every microservices boot (the lane
    // restarts the stack between phases), rewriting plugin/plugin_method
    // content that cutover never touches — cutover itself re-verifies all
    // four table digests inside its own transaction and aborts on drift, so
    // that invariant is enforced server-side. Row ids must still be stable
    // here: they anchor the workflow_step foreign keys.
    expect(after.rowDigests.workflow).toBe(before.evidence.rowDigests.workflow);
    expect(after.rowDigests.workflow_step).toBe(before.evidence.rowDigests.workflow_step);
    expect(after.rowIds.plugin).toEqual(before.evidence.rowIds.plugin);
    expect(after.rowIds.plugin_method).toEqual(before.evidence.rowIds.plugin_method);
    expect(after.schemaDigest).toBe(before.evidence.schemaDigest);
    expect(progress).toHaveLength(7);
    for (const item of progress) {
      expect(item.processed).toBe(
        item.kind === 'albums' || item.kind === 'automation' ? before.albumCount : before.assetCount,
      );
      expect(item.digest).toMatch(/^[\da-f]{64}$/);
    }
    const fullState = await loadState<any>(lane);
    const retainedAssetIds = fullState.assetIds.filter((id: string) => id !== fullState.deletedAssetId);
    const certification = {
      deleted: await migrationEvidence(
        fullState.assetIds,
        fullState.albumIds,
        fullState.deletedAssetId,
        fullState.albumId,
      ),
      retained: await migrationEvidence(retainedAssetIds, fullState.albumIds, fullState.assetId, fullState.albumId),
    };
    expect(certification.retained.families.privacy).toEqual([
      expect.objectContaining({ assetId: fullState.assetId, isNsfw: true }),
    ]);
    expect(certification.retained.families.enrichment).toEqual([
      expect.objectContaining({ assetId: fullState.assetId, generatedDescription: 'certified generated description' }),
    ]);
    expect(certification.retained.families.albums.metadata).toEqual([
      expect.objectContaining({ albumId: fullState.albumId, icon: 'star', sortOrder: 42.5 }),
    ]);
    expect(certification.retained.families.automation.matches).toHaveLength(1);
    expect(certification.retained.families.health.findings).toHaveLength(1);
    expect(certification.retained.families.storage.mappings).toHaveLength(1);
    expect(certification.retained.families.checksum).toHaveLength(1);
    await saveState(lane, { ...fullState, certification });
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
