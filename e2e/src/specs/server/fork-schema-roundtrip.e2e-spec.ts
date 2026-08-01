import { describe, expect, it } from 'vitest';
import {
  api,
  authHeaders,
  digest,
  downloadAsset,
  loadState,
  migrationEvidence,
  phase,
  saveState,
  uploadAsset,
  waitFor,
  withDatabase,
  workflowEvidence,
} from './fork-schema-certification';

const lane = 'official-v3.1.0-to-fork-return';
const originLane = 'origin-v3.1.0-to-fork';
type OriginState = {
  admin: { accessToken: string; userId: string };
  albumCount: number;
  albumId: string;
  albumIds: string[];
  assetCount: number;
  assetId: string;
  assetIds: string[];
  certification: {
    deleted: Awaited<ReturnType<typeof migrationEvidence>>;
    retained: Awaited<ReturnType<typeof migrationEvidence>>;
  };
  deletedAssetId: string;
  workflowId: string;
};

const waitForAssetState = (assetId: string, expected: { isFavorite: boolean; visibility?: string }) =>
  waitFor(
    () =>
      withDatabase(async (client) => {
        const result = await client.query<{ isFavorite: boolean; visibility: string }>(
          'SELECT "isFavorite", visibility FROM public.asset WHERE id = $1',
          [assetId],
        );
        return result.rows[0];
      }),
    (value) =>
      value?.isFavorite === expected.isFavorite &&
      (expected.visibility === undefined || value.visibility === expected.visibility),
    90_000,
  );

describe.runIf(phase === 'official-operations-before-restart')(`${lane}: supported official image first boot`, () => {
  it('runs the complete official API surface and mutates the certified database', async () => {
    const origin = await loadState<OriginState>(originLane);
    const headers = authHeaders(origin.admin.accessToken);
    const about = await api<Record<string, unknown>>('/server/about', { headers });
    expect(about).toEqual(expect.objectContaining({ version: expect.any(String) }));
    const timeline = await api<unknown[]>('/timeline/buckets', { headers });
    expect(timeline.length).toBeGreaterThan(0);
    const search = await api<Record<string, unknown>>('/search/metadata', {
      body: JSON.stringify({ id: origin.assetId, size: 10 }),
      headers: { ...headers, 'content-type': 'application/json' },
      method: 'POST',
    });
    expect(JSON.stringify(search)).toContain(origin.assetId);

    const workflows = await api<Array<{ id: string; name: string }>>('/workflows', { headers });
    expect(workflows.some(({ id }) => id === origin.workflowId)).toBe(true);
    const officialAsset = await uploadAsset(origin.admin.accessToken, 'official-existing-workflow.png');
    await waitForAssetState(officialAsset.id, { isFavorite: true });
    const bytes = await downloadAsset(origin.admin.accessToken, officialAsset.id);
    expect(bytes.length).toBeGreaterThan(0);
    const edited = await api<{ description: string; id: string }>(`/assets/${officialAsset.id}`, {
      body: JSON.stringify({ description: 'edited by official v3.1.0 certification' }),
      headers: { ...headers, 'content-type': 'application/json' },
      method: 'PUT',
    });
    expect(edited).toEqual(expect.objectContaining({ id: officialAsset.id }));

    const officialAlbum = await api<{ id: string }>('/albums', {
      body: JSON.stringify({ albumName: 'Official retained album', assetIds: [officialAsset.id] }),
      headers: { ...headers, 'content-type': 'application/json' },
      method: 'POST',
    });
    const disposableAlbum = await api<{ id: string }>('/albums', {
      body: JSON.stringify({ albumName: 'Official disposable album', assetIds: [] }),
      headers: { ...headers, 'content-type': 'application/json' },
      method: 'POST',
    });
    await api<void>(`/albums/${disposableAlbum.id}`, { headers, method: 'DELETE' });
    await expect(api(`/albums/${officialAlbum.id}`, { headers })).resolves.toEqual(
      expect.objectContaining({ id: officialAlbum.id }),
    );

    const createdWorkflow = await api<{ id: string }>('/workflows', {
      body: JSON.stringify({
        description: 'Created by official v3.1.0 during certification',
        enabled: true,
        name: 'official-created-archive-workflow',
        steps: [{ config: { inverse: false }, enabled: true, method: 'immich-plugin-core#assetArchive' }],
        trigger: 'AssetCreate',
      }),
      headers: { ...headers, 'content-type': 'application/json' },
      method: 'POST',
    });
    const queues = await api<Record<string, { jobCounts: Record<string, number> }>>('/jobs', { headers });
    expect(Object.keys(queues).length).toBeGreaterThan(0);
    expect(
      Object.values(queues).every(({ jobCounts }) => Object.values(jobCounts).every((count) => Number.isFinite(count))),
    ).toBe(true);

    await api<void>('/assets', {
      body: JSON.stringify({ force: true, ids: [origin.deletedAssetId] }),
      headers: { ...headers, 'content-type': 'application/json' },
      method: 'DELETE',
    });
    await waitFor(
      () =>
        withDatabase(async (client) => {
          const result = await client.query('SELECT count(*) FROM public.asset WHERE id = $1', [origin.deletedAssetId]);
          return Number(result.rows[0].count);
        }),
      (count) => count === 0,
    );
    const evidence = await workflowEvidence();
    await saveState(lane, {
      deletedAssetDigest: digest(bytes),
      evidence,
      officialAlbumId: officialAlbum.id,
      officialAssetId: officialAsset.id,
      officialCreatedWorkflowId: createdWorkflow.id,
      originalWorkflowId: origin.workflowId,
    });
  }, 180_000);
});

describe.runIf(phase === 'official-operations-after-restart')(`${lane}: supported official image second boot`, () => {
  it('boots the same database again and executes both upstream workflows', async () => {
    const origin = await loadState<OriginState>(originLane);
    const before = await loadState<any>(lane);
    const headers = authHeaders(origin.admin.accessToken);
    await expect(api('/server/about', { headers })).resolves.toEqual(
      expect.objectContaining({ version: expect.any(String) }),
    );
    const workflows = await api<Array<{ id: string }>>('/workflows', { headers });
    expect(workflows.map(({ id }) => id)).toEqual(
      expect.arrayContaining([before.originalWorkflowId, before.officialCreatedWorkflowId]),
    );
    const probe = await uploadAsset(origin.admin.accessToken, 'official-second-boot-both-workflows.png');
    await waitForAssetState(probe.id, { isFavorite: true, visibility: 'archive' });
    await api<void>('/assets', {
      body: JSON.stringify({ force: true, ids: [probe.id] }),
      headers: { ...headers, 'content-type': 'application/json' },
      method: 'DELETE',
    });
    await expect(api(`/albums/${before.officialAlbumId}`, { headers })).resolves.toEqual(
      expect.objectContaining({ id: before.officialAlbumId }),
    );
    const queues = await api<Record<string, unknown>>('/jobs', { headers });
    expect(Object.keys(queues).length).toBeGreaterThan(0);
    await saveState(lane, { ...before, secondBootWorkflowProbeId: probe.id });
  }, 120_000);
});

describe.runIf(phase === 'fork-return')(`${lane}: compatible fork normal return`, () => {
  it('preserves sidecars, defaults official rows, archives deletion orphans, and executes both workflows', async () => {
    const origin = await loadState<OriginState>(originLane);
    const before = await loadState<any>(lane);
    const headers = authHeaders(origin.admin.accessToken);
    await expect(api('/server/about', { headers })).resolves.toEqual(
      expect.objectContaining({ version: expect.any(String) }),
    );
    const after = await workflowEvidence();
    expect(after.rowIds.workflow).toEqual(before.evidence.rowIds.workflow);
    expect(after.rowIds.workflow_step).toEqual(before.evidence.rowIds.workflow_step);
    expect(after.rowIds.workflow).toEqual(
      expect.arrayContaining([before.originalWorkflowId, before.officialCreatedWorkflowId]),
    );

    const retainedAssetIds = origin.assetIds.filter((id) => id !== origin.deletedAssetId);
    const retained = await migrationEvidence(retainedAssetIds, origin.albumIds, origin.assetId, origin.albumId);
    expect(retained).toEqual(origin.certification.retained);
    const officialDefaults = await migrationEvidence(
      [before.officialAssetId],
      [before.officialAlbumId],
      before.officialAssetId,
      before.officialAlbumId,
    );
    expect(officialDefaults.families.privacy).toEqual([
      expect.objectContaining({ assetId: before.officialAssetId, isNsfw: false, suppression: null }),
    ]);
    expect(officialDefaults.families.enrichment).toEqual([
      expect.objectContaining({ assetId: before.officialAssetId, generatedDescription: null, generatedTags: [] }),
    ]);
    expect(officialDefaults.families.albums.metadata).toEqual([
      expect.objectContaining({ albumId: before.officialAlbumId, icon: null, parentId: null }),
    ]);
    expect(officialDefaults.families.automation.rules).toEqual([]);

    await withDatabase(async (client) => {
      const state = await client.query('SELECT active, phase FROM immich_fork.state WHERE id = 1');
      expect(state.rows[0]).toEqual({ active: true, phase: 'active' });
      const maintenance = await client.query(
        `SELECT coalesce((value->>'isMaintenanceMode')::boolean, false) AS enabled
         FROM public.system_metadata WHERE key = 'maintenance-mode'`,
      );
      expect(maintenance.rows[0]?.enabled ?? false).toBe(false);
      const totals = await client.query(
        `SELECT (SELECT count(*)::int FROM public.asset) AS assets,
                (SELECT count(*)::int FROM public.album) AS albums`,
      );
      expect(totals.rows[0]).toEqual({ albums: origin.albumCount + 1, assets: origin.assetCount });
      const deletedSidecars = await client.query(
        `SELECT count(*)::int AS count FROM (
           SELECT "assetId" FROM immich_fork.asset_privacy WHERE "assetId" = $1
           UNION ALL SELECT "assetId" FROM immich_fork.asset_enrichment WHERE "assetId" = $1
           UNION ALL SELECT "assetId" FROM immich_fork.asset_health WHERE "assetId" = $1
           UNION ALL SELECT "assetId" FROM immich_fork.asset_checksum WHERE "assetId" = $1
           UNION ALL SELECT "assetId" FROM immich_fork.asset_physical_file WHERE "assetId" = $1
         ) sidecars`,
        [origin.deletedAssetId],
      );
      expect(deletedSidecars.rows[0].count).toBe(0);
      const archived = await client.query(
        `SELECT "sourceTable" FROM immich_fork.orphaned_records
         WHERE payload->>'assetId' = $1 OR "sourceKey" = $1 ORDER BY "sourceTable"`,
        [origin.deletedAssetId],
      );
      expect(archived.rows.map(({ sourceTable }) => sourceTable)).toEqual(
        expect.arrayContaining([
          'asset_checksum',
          'asset_enrichment',
          'asset_health',
          'asset_physical_file',
          'asset_privacy',
        ]),
      );
      const progress = await client.query(
        `SELECT kind, processed::int, remaining::int, cursor, "lastError" FROM immich_fork.backfill_progress ORDER BY kind`,
      );
      expect(progress.rows).toHaveLength(7);
      expect(
        progress.rows.every(
          ({ cursor, lastError, remaining }) => remaining === 0 && cursor === null && lastError === null,
        ),
      ).toBe(true);
      const workflowSidecar = await client.query("SELECT to_regclass('immich_fork.workflow') AS relation");
      expect(workflowSidecar.rows[0].relation).toBeNull();
    });

    // The certification compose stack intentionally has no ML service. Keep
    // the persisted config aligned with that runtime before testing workflow
    // dispatch, otherwise the fork's privacy gate waits for enrichment that
    // this stack can never produce. Preserve every unrelated config field.
    const config = await api<
      Record<string, unknown> & {
        machineLearning: {
          imageDescription: { enabled: boolean };
          nsfwDetection: { enabled: boolean };
        };
      }
    >('/system-config', { headers });
    config.machineLearning.imageDescription.enabled = false;
    config.machineLearning.nsfwDetection.enabled = false;
    await api('/system-config', {
      body: JSON.stringify(config),
      headers: { ...headers, 'content-type': 'application/json' },
      method: 'PUT',
    });
    const appliedConfig = await api<typeof config>('/system-config', { headers });
    expect({
      imageDescription: appliedConfig.machineLearning.imageDescription.enabled,
      nsfwDetection: appliedConfig.machineLearning.nsfwDetection.enabled,
    }).toEqual({ imageDescription: false, nsfwDetection: false });

    const probe = await uploadAsset(origin.admin.accessToken, 'fork-normal-return-both-workflows.png');
    await waitForAssetState(probe.id, { isFavorite: true, visibility: 'archive' });
    await api<void>('/assets', {
      body: JSON.stringify({ force: true, ids: [probe.id] }),
      headers: { ...headers, 'content-type': 'application/json' },
      method: 'DELETE',
    });
  }, 120_000);
});
