/**
 * Server-side allow-list of valid album icon keys.
 *
 * IMPORTANT: this list MUST stay in sync with the catalog in
 * `web/src/lib/utils/album-icons.ts` (`ALBUM_ICONS`). The web package owns the
 * key → MDI-path mapping; the server only needs the set of valid keys so it can
 * reject unknown values at the API boundary. The two packages are intentionally
 * decoupled (server must not import web code), so the key list is duplicated
 * here. When you add/remove an icon in the web catalog, mirror the change here.
 *
 * The stored value on the album row is the kebab-case key. `null` means "use the
 * default folder icon".
 */
export const ALBUM_ICON_KEYS = [
  'folder',
  'folder-image',
  'folder-heart',
  'folder-star',
  'home',
  'city',
  'airplane',
  'car',
  'map',
  'compass',
  'camera',
  'beach',
  'hiking',
  'pine-tree',
  'snowflake',
  'flower',
  'food',
  'music',
  'gamepad',
  'party',
  'school',
  'cake',
  'gift',
  'heart',
  'star',
  'account',
  'account-group',
  'baby',
  'paw',
  'ring',
  'book',
] as const;

export type AlbumIconKey = (typeof ALBUM_ICON_KEYS)[number];
