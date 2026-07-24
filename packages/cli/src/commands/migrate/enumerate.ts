import { AssetVisibility, type AssetResponseDto } from '@immich/sdk';
import type { ServerClient } from 'src/commands/migrate/client';
import type { Controller } from 'src/commands/migrate/controller';
import type { Ledger } from 'src/commands/migrate/ledger';
import type { AssetRecord, MigrateOptions } from 'src/commands/migrate/types';

const toRecord = (a: AssetResponseDto): AssetRecord => ({
  aId: a.id,
  checksum: a.checksum,
  filename: a.originalFileName,
  type: a.type,
  fileCreatedAt: a.fileCreatedAt,
  fileModifiedAt: a.fileModifiedAt,
  isFavorite: a.isFavorite,
  visibility: a.visibility,
  livePhotoVideoAId: a.livePhotoVideoId ?? null,
  description: a.exifInfo?.description ?? null,
  dateTimeOriginal: a.exifInfo?.dateTimeOriginal ?? null,
  latitude: a.exifInfo?.latitude ?? null,
  longitude: a.exifInfo?.longitude ?? null,
  rating: a.exifInfo?.rating ?? null,
});

/**
 * Phase 1: walk SERVER A and snapshot every asset (+ albums/tags/stacks/people) into the
 * ledger. Each page is persisted before its cursor advances, so a huge scan resumes
 * mid-way. Runs once per visibility because the server filters to a single visibility.
 */
export async function enumerate(from: ServerClient, ledger: Ledger, options: MigrateOptions, controller: Controller) {
  controller.setPhase('enumerate');
  let count = ledger.counts().assetsTotal;

  for (const visibility of [AssetVisibility.Timeline, AssetVisibility.Archive]) {
    if (ledger.getCursor(`enum:${visibility}:done`)) {
      continue;
    }
    let page = Number(ledger.getCursor(`enum:${visibility}`) ?? '1');
    for (;;) {
      await controller.gate();
      if (controller.stopped) {
        return;
      }
      const res = await from.searchAssets({
        visibility,
        withDeleted: options.includeTrashed,
        withExif: true,
        size: 1000,
        page,
      });
      ledger.upsertAssets(res.assets.items.map((asset) => toRecord(asset))); // persist this page atomically
      count += res.assets.items.length;
      controller.log(`enumerating ${visibility}: ${count} assets`);
      const next = res.assets.nextPage ? Number(res.assets.nextPage) : null;
      if (next === null) {
        break;
      }
      ledger.setCursor(`enum:${visibility}`, String(next)); // advance only after the page is durable
      page = next;
    }
    ledger.setCursor(`enum:${visibility}:done`, '1');
  }

  // Organizational structures are small; re-snapshotting on resume is idempotent.
  controller.log('snapshotting albums, tags, stacks, people');
  for (const album of await from.getAllAlbums()) {
    ledger.upsertAlbum({
      aId: album.id,
      name: album.albumName,
      description: album.description,
      icon: album.icon,
      order: album.order,
      sortOrder: album.sortOrder,
      parentAId: album.parentId,
      thumbAId: album.albumThumbnailAssetId,
    });
  }
  for (const tag of await from.getAllTags()) {
    ledger.upsertTag(tag.id, tag.value);
  }
  for (const stack of await from.searchStacks()) {
    ledger.upsertStack({ primaryAId: stack.primaryAssetId, memberAIds: stack.assets.map((a) => a.id) });
  }
  if (options.faces) {
    const people = await from.getAllPeople();
    for (const person of people.people) {
      if (!person.name) {
        continue; // unnamed clusters aren't worth recreating; B will re-cluster
      }
      ledger.upsertPerson({
        aId: person.id,
        name: person.name,
        birthDate: person.birthDate,
        isHidden: person.isHidden,
        isFavorite: !!person.isFavorite,
        color: person.color ?? null,
      });
    }
  }
}
