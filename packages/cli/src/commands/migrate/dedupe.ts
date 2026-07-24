import { AssetUploadAction } from '@immich/sdk';
import { chunk } from 'lodash-es';
import type { ServerClient } from 'src/commands/migrate/client';
import type { Controller } from 'src/commands/migrate/controller';
import type { Ledger } from 'src/commands/migrate/ledger';

/**
 * Phase 2: ask SERVER B which source assets it already has (by checksum), in batches of
 * 5000, and mark those present so the transfer phase skips downloading them. Legacy SHA-1
 * assets won't match B's SHA-256 and simply fall through to transfer, where B dedups them.
 */
export async function dedupe(to: ServerClient, ledger: Ledger, controller: Controller) {
  controller.setPhase('dedupe');
  const pending = ledger.pendingChecksums();
  let checked = 0;
  for (const batch of chunk(pending, 5000)) {
    await controller.gate();
    if (controller.stopped) {
      return;
    }
    const byId = new Map(batch.map((b) => [b.aId, b.checksum]));
    const res = await to.checkBulkUpload(batch.map((b) => ({ id: b.aId, checksum: b.checksum })));
    for (const result of res.results) {
      if (result.action === AssetUploadAction.Reject && result.assetId) {
        ledger.setAssetUploaded(result.id, result.assetId, 'present', byId.get(result.id)!);
      }
    }
    checked += batch.length;
    controller.log(`dedup-checked ${checked}/${pending.length}`);
  }
}
