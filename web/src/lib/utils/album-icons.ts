import {
  mdiAccountGroupOutline,
  mdiAccountOutline,
  mdiAirplane,
  mdiBabyFaceOutline,
  mdiBeach,
  mdiBookOutline,
  mdiCakeVariantOutline,
  mdiCameraOutline,
  mdiCarOutline,
  mdiCityVariantOutline,
  mdiCompassOutline,
  mdiFlowerOutline,
  mdiFolderHeartOutline,
  mdiFolderImage,
  mdiFolderOutline,
  mdiFolderStarOutline,
  mdiFoodOutline,
  mdiGamepadVariantOutline,
  mdiGiftOutline,
  mdiHeartOutline,
  mdiHiking,
  mdiHomeOutline,
  mdiMapOutline,
  mdiMusicNoteOutline,
  mdiPartyPopper,
  mdiPawOutline,
  mdiPineTree,
  mdiRing,
  mdiSchoolOutline,
  mdiSnowflake,
  mdiStarOutline,
} from '@mdi/js';

/**
 * Curated album icon catalog. All icons are Material Design Icons outline
 * variants — SVG paths rendered with `currentColor`, so they inherit the
 * surrounding text color and adapt automatically to light/dark mode. The
 * outline weight keeps the sidebar visually quiet while still being
 * recognizable.
 *
 * The stored value on the album row is the kebab-case key (left column).
 * Unknown / cleared values render the default folder icon.
 */
export const ALBUM_ICONS = {
  folder: mdiFolderOutline,
  'folder-image': mdiFolderImage,
  'folder-heart': mdiFolderHeartOutline,
  'folder-star': mdiFolderStarOutline,
  home: mdiHomeOutline,
  city: mdiCityVariantOutline,
  airplane: mdiAirplane,
  car: mdiCarOutline,
  map: mdiMapOutline,
  compass: mdiCompassOutline,
  camera: mdiCameraOutline,
  beach: mdiBeach,
  hiking: mdiHiking,
  'pine-tree': mdiPineTree,
  snowflake: mdiSnowflake,
  flower: mdiFlowerOutline,
  food: mdiFoodOutline,
  music: mdiMusicNoteOutline,
  gamepad: mdiGamepadVariantOutline,
  party: mdiPartyPopper,
  school: mdiSchoolOutline,
  cake: mdiCakeVariantOutline,
  gift: mdiGiftOutline,
  heart: mdiHeartOutline,
  star: mdiStarOutline,
  account: mdiAccountOutline,
  'account-group': mdiAccountGroupOutline,
  baby: mdiBabyFaceOutline,
  paw: mdiPawOutline,
  ring: mdiRing,
  book: mdiBookOutline,
} as const satisfies Record<string, string>;

export const DEFAULT_ALBUM_ICON_KEY = 'folder';
export const DEFAULT_ALBUM_ICON_PATH = ALBUM_ICONS[DEFAULT_ALBUM_ICON_KEY];

export type AlbumIconKey = keyof typeof ALBUM_ICONS;

/**
 * Resolve a stored icon key (or null/unknown value) to an MDI path string.
 * Always returns a valid path — the default folder icon is the fallback.
 */
export function albumIconPath(key: string | null | undefined): string {
  if (key && Object.hasOwn(ALBUM_ICONS, key)) {
    return ALBUM_ICONS[key as AlbumIconKey];
  }
  return DEFAULT_ALBUM_ICON_PATH;
}

export const ALBUM_ICON_KEYS = Object.keys(ALBUM_ICONS);
