# Nested Album Navigation Design

## Goal

Make nested albums discoverable from the main left navigation while preserving the current Albums page card/list experience. Also improve Albums page search so common punctuation differences do not hide obvious matches.

## Current State

- The Albums page already has nested-album behavior backed by `parentId`, `TreeNode.fromAlbums`, and drag/drop reparenting.
- The main left navigation Albums item currently expands to a short recent-albums list, so nested albums are not visible there.
- The current Albums dropdown preserves a useful shortcut by showing the three most recently updated or edited albums.
- The Albums page grid/list filters with a strict normalized substring search, so `2004 family vacation` does not match `2004 - Family Vacation - Disneyland`.
- `recentAlbumsDropdown` currently defaults open for that shortcut, so the nested Albums tree needs its own separate collapsed-by-default preference.

## Desired Behavior

- The global Albums nav item starts collapsed by default.
- Expanding Albums shows a nested album tree of owned albums in the left navigation.
- Top-level albums are visible first; child albums appear only when their parent branch is expanded.
- If the current route is an album detail page, the active album branch opens automatically so the user keeps location context; all unrelated branches remain collapsed.
- The existing three most recently updated or edited albums shortcut is preserved by moving that list under the global Recently Added nav item.
- The Recently Added album shortcut uses the existing open/closed preference so current users do not lose their saved visibility state.
- The Albums page content keeps its current card/list layout and existing top-level/all albums toggle.
- The Albums page search matches album names and descriptions using tokenized, order-insensitive matching. Every query token must appear somewhere in the normalized album name or description.

## Implementation Shape

- Move `RecentAlbums.svelte` usage in `UserSidebar.svelte` from the Albums nav item to the Recently Added nav item.
- Add an album navigation tree component for the Albums nav item that fetches owned albums and renders `TreeItems`.
- Reuse existing album tree helpers where possible: `TreeNode.fromAlbums`, `getLastIdSegment`, `albumIconPath`, and `DEFAULT_ALBUM_ICON_PATH`.
- Keep existing nav row styling cues from the current recent album rows: thumbnail/icon, rounded end cap, hover states, compact typography, and left indentation.
- Add a separate persisted open/closed preference for the Albums tree with a default of `false`.
- Keep the existing recent-albums open/closed preference attached to the Recently Added shortcut list.
- Add a focused album search helper in `album-utils.ts`, and have `AlbumsList.svelte` use it for the Albums page search filter.

## Non-Goals

- Do not convert the Albums page grid/list into a tree or nav-style list.
- Do not remove the three most recently updated or edited albums shortcut.
- Do not remove the existing Albums page cover/list view toggle, grouping, sorting, or top-level/all albums toggle.
- Do not add a heavyweight fuzzy-search dependency.
- Do not change server album hierarchy APIs.

## Testing

- Add or update component tests for the main nav album tree:
  - owned albums are fetched and nested by `parentId`,
  - top-level albums render before child branches are expanded,
  - the Albums nav starts collapsed by default through the preference default.
- Update component coverage for the recent albums shortcut:
  - the three most recently updated or edited albums still render,
  - the shortcut is now under the Recently Added nav item rather than Albums.
- Add unit tests for album search:
  - `2004 family vacation` matches `2004 - Family Vacation - Disneyland`,
  - token order does not matter,
  - unmatched tokens still filter the album out.

## Open Risks

- The Recently Added nav item will now contain both the existing Recently Added route and the last-three-edited-albums shortcut, so labels and tests should make that hierarchy clear.
- The current local test command is blocked by unresolved `@immich/sdk` imports in the web test environment, so verification may require the repo's SDK generation/bootstrap step before targeted tests can run.
