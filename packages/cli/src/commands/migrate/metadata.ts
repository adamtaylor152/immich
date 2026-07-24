import type { UpdateAssetDto } from '@immich/sdk';
import type { ServerClient } from 'src/commands/migrate/client';
import type { Controller } from 'src/commands/migrate/controller';
import type { Ledger } from 'src/commands/migrate/ledger';
import type { AssetRecord, MigrateOptions } from 'src/commands/migrate/types';
import { Queue } from 'src/queue';

const BATCH = 1000;
const ML_ENRICHMENT_KEY = 'ml-enrichment';

/**
 * Phase 4: apply editable metadata to each uploaded asset on B — description (incl. the
 * applied AI text), capture date, GPS, rating, live-photo link — then copy the structured
 * ml-enrichment blob. All writes are idempotent (last-writer-wins / set semantics).
 */
export async function applyMetadata(
  from: ServerClient,
  to: ServerClient,
  ledger: Ledger,
  options: MigrateOptions,
  controller: Controller,
) {
  controller.setPhase('metadata');
  const total = ledger.counts().assetsUploaded;

  const applyOne = async (asset: AssetRecord) => {
    await controller.gate();
    if (controller.stopped) {
      return;
    }
    const bId = ledger.bId(asset.aId);
    if (!bId) {
      ledger.setAssetMetaApplied(asset.aId);
      return;
    }
    const dto: UpdateAssetDto = {};
    if (asset.description) {
      dto.description = asset.description;
    }
    if (asset.dateTimeOriginal) {
      dto.dateTimeOriginal = asset.dateTimeOriginal;
    }
    // The server requires latitude and longitude together.
    if (asset.latitude != undefined && asset.longitude != undefined) {
      dto.latitude = asset.latitude;
      dto.longitude = asset.longitude;
    }
    if (asset.rating != undefined) {
      dto.rating = asset.rating;
    }
    if (asset.livePhotoVideoAId) {
      const videoBId = ledger.bId(asset.livePhotoVideoAId);
      if (videoBId) {
        dto.livePhotoVideoId = videoBId;
      }
    }
    if (Object.keys(dto).length > 0) {
      await to.updateAsset(bId, dto);
    }

    // Structured AI/ML enrichment blob (objects/tags/NSFW review/re-run capability).
    const meta = await from.getAssetMetadata(asset.aId);
    const items = meta.filter((m) => m.key === ML_ENRICHMENT_KEY).map((m) => ({ key: m.key, value: m.value }));
    if (items.length > 0) {
      await to.upsertAssetMetadata(bId, items);
    }
    ledger.setAssetMetaApplied(asset.aId);
  };

  for (;;) {
    await controller.gate();
    if (controller.stopped) {
      return;
    }
    const batch = ledger.nextMetaBatch(BATCH);
    if (batch.length === 0) {
      break;
    }
    const queue = new Queue<AssetRecord, void>(applyOne, { concurrency: options.concurrency, retry: 3 });
    for (const asset of batch) {
      void queue.push(asset);
    }
    await queue.drained();
    for (const task of queue.tasks) {
      if (task.status === 'failed') {
        ledger.setAssetError(task.data.aId, String(task.error));
      }
    }
    controller.log(`metadata ${ledger.counts().assetsMeta}/${total}`);
  }
}
