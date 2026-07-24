import type { UpdateAlbumDto } from '@immich/sdk';
import { chunk } from 'lodash-es';
import type { ServerClient } from 'src/commands/migrate/client';
import type { Controller } from 'src/commands/migrate/controller';
import type { Ledger } from 'src/commands/migrate/ledger';
import { collectAssetIds } from 'src/commands/migrate/search';
import type { MigrateOptions } from 'src/commands/migrate/types';

/**
 * Phase 6: recreate albums (the top priority) — nested parents first — then link each
 * album's assets and set its thumbnail. Album membership is a per-album set; ordering is
 * only an asc/desc sort direction, copied via PATCH. `sortOrder` positions nested siblings.
 */
export async function migrateAlbums(
  from: ServerClient,
  to: ServerClient,
  ledger: Ledger,
  options: MigrateOptions,
  controller: Controller,
) {
  controller.setPhase('albums');
  const albums = ledger.allAlbums();
  if (albums.length === 0) {
    return;
  }

  // Order parents before children so parentId can be mapped at creation time.
  const byId = new Map(albums.map((a) => [a.aId, a]));
  const depthOf = (aId: string, seen = new Set<string>()): number => {
    const album = byId.get(aId);
    if (!album || !album.parentAId || seen.has(aId) || !byId.has(album.parentAId)) {
      return 0;
    }
    seen.add(aId);
    return 1 + depthOf(album.parentAId, seen);
  };
  const ordered = albums.toSorted((a, b) => depthOf(a.aId) - depthOf(b.aId));

  // 1. Create albums (parents first) and copy order/sortOrder.
  for (const album of ordered) {
    if (album.bId) {
      continue;
    }
    await controller.gate();
    if (controller.stopped) {
      return;
    }
    const parentBId = album.parentAId ? ledger.albumBId(album.parentAId) : undefined;
    const createdAlbum = await to.createAlbum({
      albumName: album.name,
      description: album.description || undefined,
      icon: album.icon ?? undefined,
      parentId: parentBId,
    });
    ledger.setAlbumBId(album.aId, createdAlbum.id);
    const patch: UpdateAlbumDto = {};
    if (album.order) {
      patch.order = album.order as UpdateAlbumDto['order'];
    }
    if (album.sortOrder != undefined) {
      patch.sortOrder = album.sortOrder;
    }
    if (Object.keys(patch).length > 0) {
      await to.updateAlbum(createdAlbum.id, patch);
    }
  }

  // 2. Link assets and set the thumbnail (assets must exist on B first).
  for (const album of ordered) {
    if (album.linked) {
      continue;
    }
    await controller.gate();
    if (controller.stopped) {
      return;
    }
    const bAlbumId = ledger.albumBId(album.aId);
    if (!bAlbumId) {
      continue;
    }
    const memberAIds = await collectAssetIds(from, { albumIds: [album.aId] }, options.includeTrashed);
    const bAssetIds: string[] = [];
    for (const aId of memberAIds) {
      const bId = ledger.bId(aId);
      if (bId) {
        bAssetIds.push(bId);
      }
    }
    for (const part of chunk(bAssetIds, 500)) {
      await to.addAssetsToAlbum(bAlbumId, part);
    }
    if (album.thumbAId) {
      const thumbBId = ledger.bId(album.thumbAId);
      if (thumbBId) {
        await to.updateAlbum(bAlbumId, { albumThumbnailAssetId: thumbBId });
      }
    }
    ledger.setAlbumLinked(album.aId);
    controller.log(`album linked: ${album.name}`);
  }
}
