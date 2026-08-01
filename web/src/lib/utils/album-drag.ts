import type { AlbumResponseDto } from '@immich/sdk';

/**
 * Custom MIME type used to carry an album id across drag events. Using a
 * dedicated type means our drop targets only react to album drags — other
 * drag sources (files, text, browser tabs) are ignored automatically.
 */
export const ALBUM_DRAG_MIME = 'application/x-immich-album-id';

export function setAlbumDragData(event: DragEvent, albumId: string) {
  if (!event.dataTransfer) {
    return;
  }
  event.dataTransfer.setData(ALBUM_DRAG_MIME, albumId);
  event.dataTransfer.effectAllowed = 'move';
}

export function getAlbumDragData(event: DragEvent): string | null {
  return event.dataTransfer?.getData(ALBUM_DRAG_MIME) || null;
}

/**
 * Detect the album-drag MIME during dragover/dragenter. We can't call
 * `getData` there (the browser locks the payload for security), but the list
 * of present types is always readable. Use this to gate `preventDefault`.
 */
export function isAlbumDrag(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes(ALBUM_DRAG_MIME) ?? false;
}

/**
 * Walk `parentId` from the given root and return every descendant id (root
 * inclusive). Used to reject a drop client-side when it would create a cycle
 * — the server enforces this too, but rejecting in the browser avoids a
 * round-trip + toast for a clearly-invalid move.
 */
export function getAlbumSubtreeIds(albums: AlbumResponseDto[], rootId: string): Set<string> {
  const blocked = new Set<string>([rootId]);
  let added = true;
  while (added) {
    added = false;
    for (const album of albums) {
      if (!(album.parentId && blocked.has(album.parentId)) || blocked.has(album.id)) {
        continue;
      }

      blocked.add(album.id);
      added = true;
    }
  }
  return blocked;
}

/**
 * Compute a `sortOrder` value that places the dragged album immediately
 * before or after `target` among its siblings. Uses the midpoint between
 * neighbors so subsequent moves never need to renumber.
 *
 *   - 'before' → just smaller than the target (or target − 1 if first)
 *   - 'after'  → just larger than the target (or target + 1 if last)
 *
 * When a neighbor's sortOrder is null (legacy data not yet backfilled), we
 * fall back to `target − 1` / `target + 1` to keep the math safe; the page's
 * loader then refreshes and subsequent moves work normally.
 */
export function computeSiblingSortOrder(
  siblings: AlbumResponseDto[],
  target: AlbumResponseDto,
  position: 'before' | 'after',
): number {
  const ordered = [...siblings].sort((a, b) => {
    const av = a.sortOrder ?? 0;
    const bv = b.sortOrder ?? 0;
    return av - bv;
  });
  const idx = ordered.findIndex((a) => a.id === target.id);
  if (idx === -1) {
    return target.sortOrder ?? 0;
  }
  const targetValue = target.sortOrder ?? 0;
  if (position === 'before') {
    const prev = ordered[idx - 1];
    if (!prev || prev.sortOrder == null) {
      return targetValue - 1;
    }
    return (prev.sortOrder + targetValue) / 2;
  }
  // position === 'after'
  const next = ordered[idx + 1];
  if (!next || next.sortOrder == null) {
    return targetValue + 1;
  }
  return (targetValue + next.sortOrder) / 2;
}
