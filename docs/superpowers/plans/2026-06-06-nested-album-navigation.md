# Nested Album Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the global Albums nav show the nested owned-album tree, preserve the existing last-three-edited-albums shortcut under Recently Added, and make Albums page search tokenized and order-insensitive.

**Architecture:** Keep the Albums page card/list experience unchanged. Add one focused sidebar tree component that fetches owned albums and reuses existing tree utilities, move the existing `RecentAlbums` component under the Recently Added nav item, and add a small search helper used by `AlbumsList.svelte`.

**Tech Stack:** Svelte 5, SvelteKit, Vitest, Testing Library Svelte, `@immich/sdk`, existing `TreeItems` / `TreeNode` helpers, `svelte-persisted-store`.

---

## File Structure

- Modify: `web/src/lib/stores/preferences.store.ts`
  - Add a new `albumTreeDropdown` persisted boolean that defaults to `false`.
  - Keep `recentAlbumsDropdown` for the last-three-edited-albums shortcut after it moves under Recently Added.
- Create: `web/src/lib/components/shared-components/side-bar/AlbumNavigationTree.svelte`
  - Fetch owned albums with `getAllAlbums({ isOwned: true })`.
  - Render the nested tree with `TreeItems`.
  - Use album icons through `albumIconPath` and `DEFAULT_ALBUM_ICON_PATH`.
  - Derive the active album path from the current album route so the active branch opens automatically.
- Modify: `web/src/lib/components/shared-components/side-bar/UserSidebar.svelte`
  - Move `RecentAlbums` from Albums to Recently Added.
  - Add `AlbumNavigationTree` under Albums.
  - Bind Recently Added expansion to `recentAlbumsDropdown`.
  - Bind Albums expansion to `albumTreeDropdown`.
- Modify: `web/src/lib/utils/album-utils.ts`
  - Add `matchesAlbumSearch(album, searchQuery)` using tokenized normalized matching.
- Modify: `web/src/lib/components/album-page/AlbumsList.svelte`
  - Use `matchesAlbumSearch` instead of strict substring checks.
- Test: `web/src/lib/utils/album-utils.spec.ts`
  - Add focused tests for tokenized album search.
- Test: `web/src/lib/components/shared-components/side-bar/AlbumNavigationTree.spec.ts`
  - Add focused tests for owned album nesting and active-branch expansion.
- Test: `web/src/lib/components/shared-components/side-bar/RecentAlbums.spec.ts`
  - Keep coverage that the existing shortcut still returns the last three updated albums.
- Test: `web/src/lib/components/shared-components/side-bar/UserSidebar.spec.ts`
  - Add or update coverage that the shortcut is under Recently Added and the Albums tree preference defaults closed.

---

### Task 0: Restore Focused Web Test Readiness

**Files:**

- Generate: `packages/sdk/build/index.js`
- Generate: `packages/sdk/build/index.d.ts`

- [ ] **Step 1: Build the workspace SDK package**

Run:

```bash
pnpm --filter @immich/sdk build
```

Expected: command exits `0` and `packages/sdk/build/index.js` exists.

- [ ] **Step 2: Re-run a focused existing web test**

Run:

```bash
pnpm --filter immich-web test -- --run src/lib/utils/tree-utils.spec.ts
```

Expected: `tree-utils.spec.ts` passes. If Vite still reports unresolved `@immich/sdk`, check that `packages/sdk/build/index.js` and `packages/sdk/build/index.d.ts` exist before continuing.

---

### Task 1: Album Search Helper

**Files:**

- Modify: `web/src/lib/utils/album-utils.ts`
- Create or modify: `web/src/lib/utils/album-utils.spec.ts`
- Modify: `web/src/lib/components/album-page/AlbumsList.svelte`

- [ ] **Step 1: Write failing tests for tokenized album search**

Add these tests to `web/src/lib/utils/album-utils.spec.ts`:

```ts
import { albumFactory } from '@test-data/factories/album-factory';
import { matchesAlbumSearch } from '$lib/utils/album-utils';

describe('matchesAlbumSearch', () => {
  it('matches album names across punctuation boundaries', () => {
    const album = albumFactory.build({ albumName: '2004 - Family Vacation - Disneyland', description: '' });

    expect(matchesAlbumSearch(album, '2004 family vacation')).toBe(true);
  });

  it('matches query tokens regardless of order', () => {
    const album = albumFactory.build({ albumName: '2004 - Family Vacation - Disneyland', description: '' });

    expect(matchesAlbumSearch(album, 'vacation 2004 disneyland')).toBe(true);
  });

  it('matches tokens from the album description', () => {
    const album = albumFactory.build({ albumName: 'Disneyland', description: 'Family trip from 2004' });

    expect(matchesAlbumSearch(album, 'family 2004')).toBe(true);
  });

  it('filters out albums missing one or more query tokens', () => {
    const album = albumFactory.build({ albumName: '2004 - Family Vacation - Disneyland', description: '' });

    expect(matchesAlbumSearch(album, '2004 family beach')).toBe(false);
  });

  it('treats a blank query as a match', () => {
    const album = albumFactory.build({ albumName: 'Disneyland', description: '' });

    expect(matchesAlbumSearch(album, '   ')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the search tests to verify RED**

Run:

```bash
pnpm --filter immich-web test -- --run src/lib/utils/album-utils.spec.ts
```

Expected: FAIL because `matchesAlbumSearch` is not exported.

- [ ] **Step 3: Implement the minimal search helper**

Add this import near the top of `web/src/lib/utils/album-utils.ts`:

```ts
import { normalizeSearchString } from '$lib/utils/string-utils';
```

Add this helper near the other album utility exports:

```ts
const albumSearchTokens = (value: string) => normalizeSearchString(value).match(/[\p{Letter}\p{Number}]+/gu) ?? [];

export const matchesAlbumSearch = (album: AlbumResponseDto, searchQuery: string) => {
  const queryTokens = albumSearchTokens(searchQuery);
  if (queryTokens.length === 0) {
    return true;
  }

  const albumText = albumSearchTokens(`${album.albumName} ${album.description}`).join(' ');
  return queryTokens.every((token) => albumText.includes(token));
};
```

- [ ] **Step 4: Wire `AlbumsList.svelte` to the helper**

Change the imports in `web/src/lib/components/album-page/AlbumsList.svelte` from:

```ts
import { getSelectedAlbumGroupOption, sortAlbums, stringToSortOrder, type AlbumGroup } from '$lib/utils/album-utils';
import { normalizeSearchString } from '$lib/utils/string-utils';
```

to:

```ts
import {
  getSelectedAlbumGroupOption,
  matchesAlbumSearch,
  sortAlbums,
  stringToSortOrder,
  type AlbumGroup,
} from '$lib/utils/album-utils';
```

Replace the `normalizedSearchQuery` and `filteredAlbums` derived block with:

```ts
let filteredAlbums = $derived(searchQuery ? albums.filter((album) => matchesAlbumSearch(album, searchQuery)) : albums);
```

- [ ] **Step 5: Run tests to verify GREEN**

Run:

```bash
pnpm --filter immich-web test -- --run src/lib/utils/album-utils.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the search helper**

Run:

```bash
git add web/src/lib/utils/album-utils.ts web/src/lib/utils/album-utils.spec.ts web/src/lib/components/album-page/AlbumsList.svelte
git commit -m "feat(web): improve album search matching"
```

---

### Task 2: Album Tree Component

**Files:**

- Create: `web/src/lib/components/shared-components/side-bar/AlbumNavigationTree.svelte`
- Create: `web/src/lib/components/shared-components/side-bar/AlbumNavigationTree.spec.ts`

- [ ] **Step 1: Write failing tests for nested album rendering**

Create `web/src/lib/components/shared-components/side-bar/AlbumNavigationTree.spec.ts`:

```ts
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { vi } from 'vitest';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import AlbumNavigationTree from '$lib/components/shared-components/side-bar/AlbumNavigationTree.svelte';
import { albumFactory } from '@test-data/factories/album-factory';

const mocks = vi.hoisted(() => ({
  page: {
    params: {},
    url: new URL('http://localhost/albums'),
  },
}));

vi.mock('$app/state', () => ({
  page: mocks.page,
}));

describe('AlbumNavigationTree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.page.params = {};
    mocks.page.url = new URL('http://localhost/albums');
  });

  it('renders owned albums as a collapsed tree', async () => {
    const parent = albumFactory.build({ id: 'parent', albumName: 'Trips', parentId: null });
    const child = albumFactory.build({ id: 'child', albumName: 'Disneyland', parentId: parent.id });
    sdkMock.getAllAlbums.mockResolvedValueOnce([parent, child]);

    render(AlbumNavigationTree);

    await waitFor(() => expect(screen.getByRole('link', { name: /trips/i })).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: /disneyland/i })).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'expand' }));

    expect(screen.getByRole('link', { name: /disneyland/i })).toHaveAttribute('href', '/albums/child');
    expect(sdkMock.getAllAlbums).toHaveBeenCalledWith({ isOwned: true });
  });

  it('opens the active album branch from the current route params', async () => {
    const parent = albumFactory.build({ id: 'parent', albumName: 'Trips', parentId: null });
    const child = albumFactory.build({ id: 'child', albumName: 'Disneyland', parentId: parent.id });
    mocks.page.params = { albumId: child.id };
    mocks.page.url = new URL('http://localhost/albums/child');
    sdkMock.getAllAlbums.mockResolvedValueOnce([parent, child]);

    render(AlbumNavigationTree);
    await tick();

    await waitFor(() => expect(screen.getByRole('link', { name: /disneyland/i })).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run the tree tests to verify RED**

Run:

```bash
pnpm --filter immich-web test -- --run src/lib/components/shared-components/side-bar/AlbumNavigationTree.spec.ts
```

Expected: FAIL because `AlbumNavigationTree.svelte` does not exist.

- [ ] **Step 3: Implement the tree component**

Create `web/src/lib/components/shared-components/side-bar/AlbumNavigationTree.svelte`:

```svelte
<script lang="ts">
  import { page } from '$app/state';
  import TreeItems from '$lib/components/shared-components/tree/TreeItems.svelte';
  import { Route } from '$lib/route';
  import { getAssetMediaUrl } from '$lib/utils';
  import { handleError } from '$lib/utils/handle-error';
  import { albumIconPath, DEFAULT_ALBUM_ICON_PATH } from '$lib/utils/album-icons';
  import { getAlbumIdPath, getLastIdSegment, TreeNode, type TreeNode as TreeNodeType } from '$lib/utils/tree-utils';
  import { getAllAlbums, type AlbumResponseDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';

  let albums: AlbumResponseDto[] = $state([]);

  const refreshAlbums = async () => {
    try {
      albums = await getAllAlbums({ isOwned: true });
    } catch (error) {
      handleError(error, $t('failed_to_load_assets'));
    }
  };

  $effect(() => {
    void refreshAlbums();
  });

  const tree = $derived(TreeNode.fromAlbums(albums));
  const activeAlbumId = $derived(typeof page.params.albumId === 'string' ? page.params.albumId : '');
  const activePath = $derived(activeAlbumId ? getAlbumIdPath(albums, activeAlbumId) : '');
  const iconByAlbumId = $derived(
    Object.fromEntries(albums.map((album) => [album.id, albumIconPath(album.icon)])) as Record<string, string>,
  );
  const thumbnailByAlbumId = $derived(
    Object.fromEntries(
      albums
        .filter((album) => album.albumThumbnailAssetId)
        .map((album) => [album.id, getAssetMediaUrl({ id: album.albumThumbnailAssetId! })]),
    ) as Record<string, string>,
  );

  const getLink = (path: string) => Route.viewAlbum({ id: getLastIdSegment(path) });
  const getNodeIcons = (node: TreeNodeType) => {
    const path = (node.id && iconByAlbumId[node.id]) ?? DEFAULT_ALBUM_ICON_PATH;
    return { default: path, active: path };
  };
  const getThumbnail = (node: TreeNodeType) => (node.id ? thumbnailByAlbumId[node.id] : undefined);
</script>

<TreeItems
  icons={{ default: DEFAULT_ALBUM_ICON_PATH, active: DEFAULT_ALBUM_ICON_PATH }}
  {tree}
  active={activePath}
  {getLink}
  {getNodeIcons}
  {getThumbnail}
  labelClass="min-w-0 grow truncate text-sm font-medium"
  listClass="list-none"
/>
```

- [ ] **Step 4: Extend tree components for nav thumbnails without breaking existing trees**

Modify `web/src/lib/components/shared-components/tree/TreeItems.svelte` to accept and forward `getThumbnail` and `listClass`:

```svelte
interface Props {
  tree: TreeNode;
  active: string;
  icons: { default: string; active: string };
  getLink: (path: string) => string;
  onDrop?: (draggedId: string, targetPath: string, position: 'before' | 'inside' | 'after') => void;
  canAcceptDrop?: (draggedId: string, targetPath: string, position: 'before' | 'inside' | 'after') => boolean;
  draggedId?: string | null;
  getIcons?: (node: TreeNode) => { default: string; active: string };
  getThumbnail?: (node: TreeNode) => string | undefined;
  labelClass?: string;
  listClass?: string;
  enableDrag?: boolean;
  onDragStart?: (id: string) => void;
  onDragEnd?: () => void;
}
```

Destructure `getThumbnail` and `listClass`, change the `<ul>` class, and pass `getThumbnail`:

```svelte
<ul class={listClass ?? 'ms-2 list-none'}>
```

Modify `web/src/lib/components/shared-components/tree/Tree.svelte` to accept `getThumbnail`, compute it, and render thumbnails before falling back to icons:

```svelte
getThumbnail?: (node: TreeNode) => string | undefined;
```

```svelte
const nodeThumbnail = $derived(getThumbnail?.(node));
```

```svelte
<div class={node.size === 0 ? 'ml-[1.5em]' : ''}>
  {#if nodeThumbnail}
    <div
      class="size-6 shrink-0 rounded-sm bg-gray-200 bg-cover dark:bg-gray-600"
      style={`background-image:url('${nodeThumbnail}')`}
    ></div>
  {:else}
    <Icon
      icon={isActive ? nodeIcons.active : nodeIcons.default}
      class={isActive ? 'text-primary' : 'text-gray-500 dark:text-gray-400'}
      color={node.color}
      size="20"
    />
  {/if}
</div>
```

Update the row class in `Tree.svelte` to match the nav-row treatment:

```svelte
class={`relative flex grow place-items-center gap-4 rounded-e-full py-3 ps-10 transition-[padding] delay-100 duration-100 hover:cursor-pointer hover:bg-subtle hover:text-immich-primary group-hover:sm:px-10 md:px-10 dark:text-immich-dark-fg dark:hover:bg-immich-dark-gray dark:hover:text-immich-dark-primary ${isTarget ? 'bg-primary/10 font-semibold text-primary dark:bg-slate-700' : 'dark:text-gray-200'} ${dropPosition === 'inside' ? 'bg-primary/10 ring-2 ring-primary' : ''} ${dropPosition === 'before' ? "before:absolute before:inset-x-0 before:-top-0.5 before:h-1 before:rounded-full before:bg-primary before:content-['']" : ''} ${dropPosition === 'after' ? "after:absolute after:inset-x-0 after:-bottom-0.5 after:h-1 after:rounded-full after:bg-primary after:content-['']" : ''}`}
```

- [ ] **Step 5: Run tree tests to verify GREEN**

Run:

```bash
pnpm --filter immich-web test -- --run src/lib/components/shared-components/side-bar/AlbumNavigationTree.spec.ts src/lib/utils/tree-utils.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the tree component**

Run:

```bash
git add web/src/lib/components/shared-components/side-bar/AlbumNavigationTree.svelte web/src/lib/components/shared-components/side-bar/AlbumNavigationTree.spec.ts web/src/lib/components/shared-components/tree/Tree.svelte web/src/lib/components/shared-components/tree/TreeItems.svelte
git commit -m "feat(web): add nested album nav tree"
```

---

### Task 3: Sidebar Wiring and Preferences

**Files:**

- Modify: `web/src/lib/stores/preferences.store.ts`
- Modify: `web/src/lib/components/shared-components/side-bar/UserSidebar.svelte`
- Modify: `web/src/lib/components/shared-components/side-bar/RecentAlbums.spec.ts`
- Create or modify: `web/src/lib/components/shared-components/side-bar/UserSidebar.spec.ts`

- [ ] **Step 1: Write failing preference and sidebar tests**

Add a preference assertion in `web/src/lib/components/shared-components/side-bar/UserSidebar.spec.ts`:

```ts
import { get } from 'svelte/store';
import { albumTreeDropdown, recentAlbumsDropdown } from '$lib/stores/preferences.store';

describe('album sidebar preferences', () => {
  it('starts the nested Albums tree collapsed while preserving the recent albums shortcut preference', () => {
    expect(get(albumTreeDropdown)).toBe(false);
    expect(get(recentAlbumsDropdown)).toBe(true);
  });
});
```

Keep `web/src/lib/components/shared-components/side-bar/RecentAlbums.spec.ts` focused on the shortcut itself and update the test name:

```ts
it('renders the three most recently updated albums for the nav shortcut', async () => {
  const albums = [
    albumFactory.build({ updatedAt: '2024-01-01T00:00:00Z' }),
    albumFactory.build({ updatedAt: '2024-01-09T00:00:01Z' }),
    albumFactory.build({ updatedAt: '2024-01-10T00:00:00Z' }),
    albumFactory.build({ updatedAt: '2024-01-09T00:00:00Z' }),
  ];

  sdkMock.getAllAlbums.mockResolvedValueOnce([...albums]);
  render(RecentAlbums);

  expect(sdkMock.getAllAlbums).toBeCalledTimes(1);

  await tick();
  await tick();

  const links = screen.getAllByRole('link');
  expect(links).toHaveLength(3);
  expect(links[0]).toHaveAttribute('href', `/albums/${albums[2].id}`);
  expect(links[1]).toHaveAttribute('href', `/albums/${albums[1].id}`);
  expect(links[2]).toHaveAttribute('href', `/albums/${albums[3].id}`);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
pnpm --filter immich-web test -- --run src/lib/components/shared-components/side-bar/UserSidebar.spec.ts src/lib/components/shared-components/side-bar/RecentAlbums.spec.ts
```

Expected: FAIL because `albumTreeDropdown` is not exported.

- [ ] **Step 3: Add the Albums tree preference**

Modify `web/src/lib/stores/preferences.store.ts`:

```ts
export const recentAlbumsDropdown = persisted<boolean>('recent-albums-open', true, {});

export const albumTreeDropdown = persisted<boolean>('album-tree-open', false, {});
```

- [ ] **Step 4: Wire Recently Added and Albums nav items**

Modify imports in `web/src/lib/components/shared-components/side-bar/UserSidebar.svelte`:

```ts
import AlbumNavigationTree from '$lib/components/shared-components/side-bar/AlbumNavigationTree.svelte';
import RecentAlbums from '$lib/components/shared-components/side-bar/RecentAlbums.svelte';
```

```ts
import { albumTreeDropdown, recentAlbumsDropdown } from '$lib/stores/preferences.store';
```

Change Recently Added from a leaf item to an expandable item:

```svelte
<NavbarItem
  title={$t('recently_added')}
  href={Route.recentlyAdded()}
  icon={mdiClockPlusOutline}
  activeIcon={mdiClockPlus}
  bind:expanded={$recentAlbumsDropdown}
>
  {#snippet items()}
    <span in:fly={{ y: -20 }} class="hidden md:block">
      <RecentAlbums />
    </span>
  {/snippet}
</NavbarItem>
```

Change Albums to use the tree:

```svelte
<NavbarItem
  title={$t('albums')}
  href={Route.albums()}
  icon={{ icon: mdiImageAlbum, flipped: true }}
  bind:expanded={$albumTreeDropdown}
>
  {#snippet items()}
    <span in:fly={{ y: -20 }} class="hidden md:block">
      <AlbumNavigationTree />
    </span>
  {/snippet}
</NavbarItem>
```

- [ ] **Step 5: Run tests to verify GREEN**

Run:

```bash
pnpm --filter immich-web test -- --run src/lib/components/shared-components/side-bar/UserSidebar.spec.ts src/lib/components/shared-components/side-bar/RecentAlbums.spec.ts src/lib/components/shared-components/side-bar/AlbumNavigationTree.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit sidebar wiring**

Run:

```bash
git add web/src/lib/stores/preferences.store.ts web/src/lib/components/shared-components/side-bar/UserSidebar.svelte web/src/lib/components/shared-components/side-bar/UserSidebar.spec.ts web/src/lib/components/shared-components/side-bar/RecentAlbums.spec.ts
git commit -m "feat(web): wire nested albums into sidebar"
```

---

### Task 4: Final Verification

**Files:**

- Verify: `web/src/lib/components/shared-components/side-bar/UserSidebar.svelte`
- Verify: `web/src/lib/components/shared-components/side-bar/AlbumNavigationTree.svelte`
- Verify: `web/src/lib/components/album-page/AlbumsList.svelte`
- Verify: `web/src/lib/utils/album-utils.ts`

- [ ] **Step 1: Run focused test suite**

Run:

```bash
pnpm --filter immich-web test -- --run src/lib/utils/album-utils.spec.ts src/lib/utils/tree-utils.spec.ts src/lib/components/shared-components/side-bar/RecentAlbums.spec.ts src/lib/components/shared-components/side-bar/AlbumNavigationTree.spec.ts src/lib/components/shared-components/side-bar/UserSidebar.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run Svelte and TypeScript checks**

Run:

```bash
pnpm --filter immich-web check:svelte
pnpm --filter immich-web check:typescript
```

Expected: both commands exit `0`.

- [ ] **Step 3: Run the web app locally for visual verification**

Run:

```bash
pnpm --filter immich-web dev -- --host 127.0.0.1 --port 3000
```

Expected: Vite serves the app at `http://127.0.0.1:3000`.

- [ ] **Step 4: Browser-check the changed surfaces**

Open `http://127.0.0.1:3000/albums` in the in-app browser and verify:

- Albums in the global left nav is collapsed by default.
- Expanding Albums shows top-level owned albums.
- Expanding a top-level album shows nested albums.
- Recently Added keeps the last-three-edited-albums shortcut.
- The Albums page still shows the existing card/list layout.
- Searching `2004 family vacation` finds `2004 - Family Vacation - Disneyland`.

- [ ] **Step 5: Commit any verification-only test adjustments**

If a test selector needs a small adjustment after implementation, commit only the test adjustment:

```bash
git add web/src/lib/components/shared-components/side-bar/*.spec.ts web/src/lib/utils/album-utils.spec.ts
git commit -m "test(web): cover nested album sidebar behavior"
```

Do not create this commit if there are no verification-only changes.
