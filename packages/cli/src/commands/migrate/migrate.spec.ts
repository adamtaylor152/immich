import { AssetUploadAction } from '@immich/sdk';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { audit } from 'src/commands/migrate/audit';
import type { ServerClient } from 'src/commands/migrate/client';
import { Controller } from 'src/commands/migrate/controller';
import { dedupe } from 'src/commands/migrate/dedupe';
import { Ledger } from 'src/commands/migrate/ledger';
import type { AssetRecord } from 'src/commands/migrate/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const asset = (aId: string, checksum: string, over: Partial<AssetRecord> = {}): AssetRecord => ({
  aId,
  checksum,
  filename: `${aId}.jpg`,
  type: 'IMAGE',
  fileCreatedAt: '2024-01-01T00:00:00.000Z',
  fileModifiedAt: '2024-01-01T00:00:00.000Z',
  isFavorite: false,
  visibility: 'timeline',
  livePhotoVideoAId: null,
  description: null,
  dateTimeOriginal: null,
  latitude: null,
  longitude: null,
  rating: null,
  ...over,
});

// A ServerClient stub exposing only checkBulkUpload: B "has" any checksum in `present`.
const fakeB = (present: Set<string>, spy?: { calls: number }) =>
  ({
    checkBulkUpload: async (assets: Array<{ id: string; checksum: string }>) => {
      if (spy) {
        spy.calls++;
      }
      return {
        results: assets.map((a) => ({
          id: a.id,
          action: present.has(a.checksum) ? AssetUploadAction.Reject : AssetUploadAction.Accept,
          assetId: present.has(a.checksum) ? `b-${a.id}` : undefined,
        })),
      };
    },
  }) as unknown as ServerClient;

describe('migrate ledger + phases', () => {
  let dir: string;
  let ledgerPath: string;
  let ledger: Ledger;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'immich-migrate-'));
    ledgerPath = join(dir, 'ledger.sqlite');
    ledger = new Ledger(ledgerPath);
  });
  afterEach(() => {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('resume: work queues exclude uploaded and errored rows; --retry-failed re-includes', () => {
    ledger.upsertAssets([asset('a1', 'c1'), asset('a2', 'c2'), asset('a3', 'c3')]);
    expect(
      ledger
        .nextUploadBatch(10)
        .map((a) => a.aId)
        .toSorted(),
    ).toEqual(['a1', 'a2', 'a3']);

    ledger.setAssetUploaded('a1', 'b1', 'upload', 'c1');
    expect(
      ledger
        .nextUploadBatch(10)
        .map((a) => a.aId)
        .toSorted(),
    ).toEqual(['a2', 'a3']);

    ledger.setAssetError('a2', 'network boom');
    expect(ledger.nextUploadBatch(10).map((a) => a.aId)).toEqual(['a3']); // errored row skipped, no infinite loop

    ledger.clearErrors();
    expect(
      ledger
        .nextUploadBatch(10)
        .map((a) => a.aId)
        .toSorted(),
    ).toEqual(['a2', 'a3']);
  });

  it('--retry-failed reopens people so names can be reattached after B finishes face detection', () => {
    ledger.upsertPerson({ aId: 'p1', name: 'Alice', birthDate: null, isHidden: false, isFavorite: false, color: null });
    ledger.setPersonDone('p1', 'bp1'); // processed too early: marked done with nothing attached
    expect(ledger.peopleToDo()).toHaveLength(0);

    ledger.clearErrors(); // --retry-failed
    expect(ledger.peopleToDo().map((p) => p.name)).toEqual(['Alice']);
  });

  it('idempotent replay: re-upserting and re-marking never duplicates rows', () => {
    ledger.upsertAssets([asset('a1', 'c1')]);
    ledger.upsertAssets([asset('a1', 'c1')]); // re-enumerate
    ledger.setAssetUploaded('a1', 'b1', 'upload', 'c1');
    ledger.setAssetUploaded('a1', 'b1', 'duplicate', 'c1'); // crash-then-retry lands here again
    expect(ledger.counts().assetsTotal).toBe(1);
    expect(ledger.counts().assetsUploaded).toBe(1);
    expect(ledger.bId('a1')).toBe('b1');
  });

  it('resume across process restart: state persists when the ledger file is reopened', () => {
    ledger.upsertAssets([asset('a1', 'c1'), asset('a2', 'c2')]);
    ledger.setAssetUploaded('a1', 'b1', 'upload', 'c1');
    ledger.close();

    const reopened = new Ledger(ledgerPath);
    expect(reopened.counts().assetsUploaded).toBe(1);
    expect(reopened.nextUploadBatch(10).map((a) => a.aId)).toEqual(['a2']);
    reopened.close();
    ledger = new Ledger(ledgerPath); // so afterEach can close cleanly
  });

  it('dedupe: marks assets already on B as present (with B checksum) and is idempotent', async () => {
    ledger.upsertAssets([asset('a1', 'c1'), asset('a2', 'c2')]);
    const spy = { calls: 0 };
    const to = fakeB(new Set(['c1']), spy); // B already has c1

    await dedupe(to, ledger, new Controller());
    expect(ledger.bId('a1')).toBe('b-a1'); // present -> mapped to existing B id
    expect(ledger.nextUploadBatch(10).map((a) => a.aId)).toEqual(['a2']); // only a2 still needs transfer

    const before = spy.calls;
    await dedupe(to, ledger, new Controller()); // re-run only re-checks the remainder
    expect(spy.calls).toBeGreaterThan(before);
    expect(ledger.nextUploadBatch(10).map((a) => a.aId)).toEqual(['a2']); // no change, no error
  });

  it('audit: reports missing (not-transferred + absent-on-B) and passes only when complete', async () => {
    ledger.upsertAssets([asset('a1', 'c1'), asset('a2', 'c2'), asset('a3', 'c3')]);
    ledger.setAssetUploaded('a1', 'b1', 'upload', 'c1'); // present on B
    ledger.setAssetUploaded('a2', 'b2', 'upload', 'c2'); // uploaded but B claims absent
    // a3 never transferred

    const to = fakeB(new Set(['c1'])); // B only confirms c1
    const report = await audit(to, ledger, new Controller(), join(dir, 'audit.json'), {
      from: 'A',
      to: 'B',
      user: 'u@x',
    });
    expect(report.ok).toBe(false);
    expect(report.missing.map((m) => m.aId).toSorted()).toEqual(['a2', 'a3']);
    expect(report.missing.find((m) => m.aId === 'a2')?.reason).toBe('absent-on-B');
    expect(report.missing.find((m) => m.aId === 'a3')?.reason).toBe('not-transferred');

    // Now everything present on B -> green light.
    const okReport = await audit(
      fakeB(new Set(['c1', 'c2', 'c3'])),
      reuploadAll(ledger),
      new Controller(),
      join(dir, 'audit2.json'),
      { from: 'A', to: 'B', user: 'u@x' },
    );
    expect(okReport.ok).toBe(true);
    expect(okReport.missing).toHaveLength(0);
  });
});

// Helper: mark every row uploaded (as if the transfer phase completed), for the green-light case.
function reuploadAll(ledger: Ledger): Ledger {
  for (const row of ledger.auditRows()) {
    ledger.setAssetUploaded(row.aId, `b-${row.aId}`, 'upload', row.checksum);
  }
  return ledger;
}
