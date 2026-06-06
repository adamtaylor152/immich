# Nested Album Navigation Design

## Goal

Make nested albums discoverable from the main left navigation while preserving the current Albums page card/list experience. Also improve Albums page search so common punctuation differences do not hide obvious matches.

## Current State

- The Albums page already has nested-album behavior backed by `parentId`, `TreeNode.fromAlbums`, and drag/drop reparenting.
- The main left navigation Albums item currently expands to a short recent-albums list, so nested albums are not visible there.
- The Albums page grid/list filters with a strict normalized substring search, so `2004 family vacation` does not match `2004 - Family Vacation - Disneyland`.
- `recentAlbumsDropdown` currently defaults open, which conflicts with the requested Apple Photos-like collapsed default.

## Desired Behavior

- The global Albums nav item starts collapsed by default.
- Expanding Albums shows a nested album tree of owned albums in the left navigation.
- Top-level albums are visible first; child albums appear only when their parent branch is expanded.
- If the current route is an album detail page, the active album branch opens automatically so the user keeps location context; all unrelated branches remain collapsed.
- The Albums page content keeps its current card/list layout and existing top-level/all albums toggle.
- The Albums page search matches album names and descriptions using tokenized, order-insensitive matching. Every query token must appear somewhere in the normalized album name or description.

## Implementation Shape

- Replace `RecentAlbums.svelte` usage in `UserSidebar.svelte` with an album navigation tree component that fetches owned albums and renders `TreeItems`.
- Reuse existing album tree helpers where possible: `TreeNode.fromAlbums`, `getLastIdSegment`, `albumIconPath`, and `DEFAULT_ALBUM_ICON_PATH`.
- Keep existing nav row styling cues from the current recent album rows: thumbnail/icon, rounded end cap, hover states, compact typography, and left indentation.
- Change the persisted Albums nav open default from `true` to `false`.
- Add a focused album search helper in `album-utils.ts`, and have `AlbumsList.svelte` use it for the Albums page search filter.

## Non-Goals

- Do not convert the Albums page grid/list into a tree or nav-style list.
- Do not remove the existing Albums page cover/list view toggle, grouping, sorting, or top-level/all albums toggle.
- Do not add a heavyweight fuzzy-search dependency.
- Do not change server album hierarchy APIs.

## Testing

- Add or update component tests for the main nav album tree:
  - owned albums are fetched and nested by `parentId`,
  - top-level albums render before child branches are expanded,
  - the Albums nav starts collapsed by default through the preference default.
- Add unit tests for album search:
  - `2004 family vacation` matches `2004 - Family Vacation - Disneyland`,
  - token order does not matter,
  - unmatched tokens still filter the album out.

## Open Risks

- Existing persisted `recent-albums-open` values may keep the nav open for users who have already stored `true`; the default only affects new or unset preferences.
- The current local test command is blocked by unresolved `@immich/sdk` imports in the web test environment, so verification may require the repo's SDK generation/bootstrap step before targeted tests can run.
