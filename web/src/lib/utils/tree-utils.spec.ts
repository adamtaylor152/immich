import type { AlbumResponseDto } from '@immich/sdk';
import { getAlbumIdPath, getLastIdSegment, TreeNode } from '$lib/utils/tree-utils';

const albumLike = (overrides: Partial<AlbumResponseDto>): AlbumResponseDto =>
  ({
    id: overrides.id ?? 'missing-id',
    albumName: overrides.albumName ?? 'Untitled',
    description: '',
    parentId: overrides.parentId ?? null,
    createdAt: '',
    updatedAt: '',
    albumThumbnailAssetId: null,
    shared: false,
    albumUsers: [],
    hasSharedLink: false,
    assetCount: 0,
    isActivityEnabled: true,
    ...overrides,
  }) as unknown as AlbumResponseDto;

describe('TreeNode.fromAlbums', () => {
  it('groups children by parentId', () => {
    const trips = albumLike({ id: 'trips', albumName: 'Trips' });
    const disney = albumLike({ id: 'disney', albumName: 'Disneyland 2024', parentId: 'trips' });
    const iceland = albumLike({ id: 'iceland', albumName: 'Iceland 2025', parentId: 'trips' });

    const root = TreeNode.fromAlbums([trips, disney, iceland]);

    expect(root.children.map((n) => n.id)).toEqual(['trips']);
    expect(root.children[0].children.map((n) => n.id).sort()).toEqual(['disney', 'iceland']);
    expect(root.children[0].path).toBe('trips');
    expect(root.children[0].children[0].path).toBe('trips/disney');
  });

  it('builds correct paths when a child is listed before its parent', () => {
    const disney = albumLike({ id: 'disney', albumName: 'Disneyland 2024', parentId: 'trips' });
    const trips = albumLike({ id: 'trips', albumName: 'Trips' });

    const root = TreeNode.fromAlbums([disney, trips]);

    expect(root.children.map((n) => n.id)).toEqual(['trips']);
    expect(root.children[0].path).toBe('trips');
    expect(root.children[0].children[0].id).toBe('disney');
    expect(root.children[0].children[0].path).toBe('trips/disney');
  });

  it('promotes albums whose parent is missing to the root', () => {
    const orphan = albumLike({ id: 'orphan', albumName: 'Orphan', parentId: 'ghost' });
    const root = TreeNode.fromAlbums([orphan]);
    expect(root.children.map((n) => n.id)).toEqual(['orphan']);
    expect(root.children[0].path).toBe('orphan');
  });

  it('handles deep nesting', () => {
    const a = albumLike({ id: 'a', albumName: 'A' });
    const b = albumLike({ id: 'b', albumName: 'B', parentId: 'a' });
    const c = albumLike({ id: 'c', albumName: 'C', parentId: 'b' });
    const d = albumLike({ id: 'd', albumName: 'D', parentId: 'c' });

    const root = TreeNode.fromAlbums([a, b, c, d]);
    const leaf = root.children[0].children[0].children[0].children[0];
    expect(leaf.id).toBe('d');
    expect(leaf.path).toBe('a/b/c/d');
    expect(leaf.value).toBe('D');
    expect(leaf.parents.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('getAlbumIdPath', () => {
  const trips = albumLike({ id: 'trips' });
  const disney = albumLike({ id: 'disney', parentId: 'trips' });
  const inner = albumLike({ id: 'inner', parentId: 'disney' });

  it('returns slash-joined ancestor ids ending with the target', () => {
    expect(getAlbumIdPath([trips, disney, inner], 'inner')).toBe('trips/disney/inner');
  });

  it('returns the album id when it has no parent', () => {
    expect(getAlbumIdPath([trips], 'trips')).toBe('trips');
  });

  it('returns empty string when the album is not in the list', () => {
    expect(getAlbumIdPath([trips], 'ghost')).toBe('');
  });

  it('stops at the first cycle without infinite looping', () => {
    const x = albumLike({ id: 'x', parentId: 'y' });
    const y = albumLike({ id: 'y', parentId: 'x' });
    expect(getAlbumIdPath([x, y], 'x')).toBe('y/x');
  });
});

describe('getLastIdSegment', () => {
  it('returns the last segment of a slash path', () => {
    expect(getLastIdSegment('trips/disney/inner')).toBe('inner');
  });

  it('returns the input when there is no slash', () => {
    expect(getLastIdSegment('trips')).toBe('trips');
  });

  it('returns empty for an empty input', () => {
    expect(getLastIdSegment('')).toBe('');
  });
});
