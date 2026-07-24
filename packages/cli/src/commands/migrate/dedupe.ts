import { AssetUploadAction } from '@immich/sdk';
import type { ServerClient } from 'src/commands/migrate/client';
import type { Controller } from 'src/commands/migrate/controller';
import type { Ledger } from 'src/commands/migrate/ledger';

const BATCH = 5000;

/**
 * Phase 2: ask SERVER B which source assets it already has (by checksum) and mark those
 * present, so the transfer phase skips downloading them. Legacy SHA-1 assets won't match
 * B's SHA-256 and simply fall through to transfer, where B dedups them on upload.
 *
 * Pages through the ledger by key rather than loading every pending row at once.
 */
export async function dedupe(to: ServerClient, ledger: Ledger, controller: Controller) {
  controller.setPhase('dedupe');
  let after = '';
  let checked = 0;
  for (;;) {
    await controller.gate();
    if (controller.stopped) {
      return;
    }
    const batch = ledger.pendingChecksums(after, BATCH);
    if (batch.length === 0) {
      return;
    }
    after = batch.at(-1)!.aId;

    const checksums = new Map(batch.map((b) => [b.aId, b.checksum]));
    const res = await to.checkBulkUpload(batch.map((b) => ({ id: b.aId, checksum: b.checksum })));
    for (const result of res.results) {
      const checksum = checksums.get(result.id);
      // A response id we didn't ask about can't be mapped back to a source asset; ignore it
      // rather than assert, so a surprising payload can't take the whole run down.
      if (result.action === AssetUploadAction.Reject && result.assetId && checksum) {
        ledger.setAssetUploaded(result.id, result.assetId, 'present', checksum);
      }
    }
    checked += batch.length;
    controller.log(`dedup-checked ${checked}`);
  }
}
