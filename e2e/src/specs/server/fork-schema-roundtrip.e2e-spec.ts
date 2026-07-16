import { describe, expect, it } from 'vitest';
import {
  api,
  authHeaders,
  digest,
  downloadAsset,
  loadState,
  phase,
  saveState,
  uploadAsset,
  waitFor,
  withDatabase,
  workflowEvidence,
} from './fork-schema-certification';

const lane = 'official-v3.0.3-to-fork-return';
type OriginState = { admin: { accessToken: string; userId: string }; workflowId: string };

describe.runIf(phase === 'official-operations')(`${lane}: supported official image`, () => {
  it('authenticates, reads and executes a workflow, creates another, and round-trips asset bytes', async () => {
    const origin = await loadState<OriginState>('origin-v3.0.3-to-fork');
    const workflows = await api<Array<{ id: string; name: string }>>('/workflows', {
      headers: authHeaders(origin.admin.accessToken),
    });
    expect(workflows.some(({ id }) => id === origin.workflowId)).toBe(true);

    const created = await api<{ id: string }>('/workflows', {
      body: JSON.stringify({
        description: 'Created by official v3.0.3 during certification',
        enabled: true,
        name: 'official-created-workflow',
        steps: [],
        trigger: 'AssetCreate',
      }),
      headers: { ...authHeaders(origin.admin.accessToken), 'content-type': 'application/json' },
      method: 'POST',
    });
    const asset = await uploadAsset(origin.admin.accessToken, 'official-executes-workflow.png');
    await waitFor(
      () =>
        withDatabase(async (client) => {
          const result = await client.query<{ isFavorite: boolean }>('SELECT "isFavorite" FROM asset WHERE id = $1', [
            asset.id,
          ]);
          return result.rows[0]?.isFavorite;
        }),
      (isFavorite) => isFavorite === true,
      90_000,
    );
    const bytes = await downloadAsset(origin.admin.accessToken, asset.id);
    expect(bytes.length).toBeGreaterThan(0);
    await api<void>('/assets', {
      body: JSON.stringify({ force: true, ids: [asset.id] }),
      headers: { ...authHeaders(origin.admin.accessToken), 'content-type': 'application/json' },
      method: 'DELETE',
    });
    await waitFor(
      () =>
        withDatabase(async (client) => {
          const result = await client.query('SELECT count(*) FROM asset WHERE id = $1', [asset.id]);
          return Number(result.rows[0].count);
        }),
      (count) => count === 0,
    );
    const evidence = await workflowEvidence();
    await saveState(lane, {
      deletedAssetDigest: digest(bytes),
      evidence,
      officialCreatedWorkflowId: created.id,
      originalWorkflowId: origin.workflowId,
    });
  }, 120_000);
});

describe.runIf(phase === 'fork-return')(`${lane}: compatible fork return`, () => {
  it('preserves old and official-created workflows as ordinary upstream data after final activation', async () => {
    const ping = await api<{ res: string }>('/server/ping');
    expect(ping.res).toBe('pong');
    const before = await loadState<{
      evidence: Awaited<ReturnType<typeof workflowEvidence>>;
      officialCreatedWorkflowId: string;
      originalWorkflowId: string;
    }>(lane);
    const after = await workflowEvidence();
    expect(after.rowIds.workflow).toEqual(before.evidence.rowIds.workflow);
    expect(after.rowIds.workflow_step).toEqual(before.evidence.rowIds.workflow_step);
    expect(after.rowIds.workflow).toEqual(
      expect.arrayContaining([before.originalWorkflowId, before.officialCreatedWorkflowId]),
    );
    await withDatabase(async (client) => {
      const state = await client.query('SELECT active, phase FROM immich_fork.state WHERE id = 1');
      expect(state.rows[0]).toEqual({
        active: true,
        phase: 'active',
      });
      const workflowSidecar = await client.query("SELECT to_regclass('immich_fork.workflow') AS relation");
      expect(workflowSidecar.rows[0].relation).toBeNull();
    });
  });
});
