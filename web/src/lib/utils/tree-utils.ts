/* eslint-disable @typescript-eslint/no-this-alias */
/* eslint-disable unicorn/no-this-assignment */
/* eslint-disable unicorn/prefer-at */
import type { AlbumResponseDto, TagResponseDto } from '@immich/sdk';

export class TreeNode extends Map<string, TreeNode> {
  value: string;
  path: string;
  parent: TreeNode | null;
  hasAssets: boolean;
  id: string | undefined;
  color: string | undefined;
  private _parents: TreeNode[] | undefined;
  private _children: TreeNode[] | undefined;

  private constructor(value: string, path: string, parent: TreeNode | null) {
    super();
    this.value = value;
    this.parent = parent;
    this.path = path;
    this.hasAssets = false;
  }

  static fromPaths(paths: string[]) {
    const root = new TreeNode('', '', null);
    for (const path of paths) {
      const current = root.add(path);
      current.hasAssets = true;
    }
    return root;
  }

  static fromTags(tags: TagResponseDto[]) {
    const root = new TreeNode('', '', null);
    for (const tag of tags) {
      const current = root.add(tag.value);
      current.hasAssets = true;
      current.id = tag.id;
      current.color = tag.color;
    }
    return root;
  }

  /**
   * Build a tree from a flat list of albums using their parentId links.
   * Paths are slash-joined album ids (e.g. "uuid-a/uuid-b/uuid-c") so the
   * generic Tree.svelte / TreeItems.svelte / Breadcrumbs.svelte components can
   * detect active ancestors via the same `active.startsWith(path + "/")` check
   * they use for tags. Use `getAlbumIdPath()` to compute the slash-path for an
   * album from its id and the flat list. Albums whose parent isn't in the list
   * (e.g. parent is shared away or missing) are promoted to the root.
   */
  static fromAlbums(albums: AlbumResponseDto[]) {
    const root = new TreeNode('', '', null);
    const byId = new Map<string, TreeNode>();

    for (const album of albums) {
      const node = new TreeNode(album.albumName, '', root);
      node.id = album.id;
      node.hasAssets = true;
      byId.set(album.id, node);
    }

    // First pass: link parents and children. Don't derive `path` here — input
    // order isn't guaranteed, so a child can be visited before its parent and
    // would read a not-yet-computed `parentNode.path`.
    for (const album of albums) {
      const node = byId.get(album.id)!;
      const parentNode = album.parentId ? byId.get(album.parentId) : undefined;
      if (parentNode) {
        node.parent = parentNode;
        parentNode.set(album.id, node);
      } else {
        node.parent = root;
        root.set(album.id, node);
      }
    }

    // Second pass: assign paths root-to-leaf so each node's `path` is built
    // from its parent's already-finalized `path`, regardless of input order.
    const assignPaths = (parent: TreeNode) => {
      for (const [id, node] of parent) {
        node.path = parent.path ? `${parent.path}/${id}` : id;
        assignPaths(node);
      }
    };
    assignPaths(root);

    return root;
  }

  traverse(path: string) {
    const parts = getPathParts(path);
    let current: TreeNode = this;
    let curPart = null;
    for (const part of parts) {
      // segments common to all subtrees can be collapsed together
      curPart = curPart === null ? part : joinPaths(curPart, part);
      const next = current.get(curPart);
      if (next) {
        current = next;
        curPart = null;
      }
    }
    return current;
  }

  collapse() {
    if (this.size === 1 && !this.hasAssets && this.parent !== null) {
      const child = this.values().next().value!;
      child.value = joinPaths(this.value, child.value);
      child.parent = this.parent;

      const entries = Array.from(this.parent.entries());
      this.parent.clear();
      for (const [key, value] of entries) {
        if (key === this.value) {
          this.parent.set(child.value, child);
        } else {
          this.parent.set(key, value);
        }
      }
    }

    for (const child of this.values()) {
      child.collapse();
    }
  }

  private add(path: string) {
    let current: TreeNode = this;
    for (const part of getPathParts(path)) {
      let next = current.get(part);
      if (next === undefined) {
        next = new TreeNode(part, joinPaths(current.path, part), current);
        current.set(part, next);
      }
      current = next;
    }
    return current;
  }

  get parents(): TreeNode[] {
    if (this._parents) {
      return this._parents;
    }
    const parents: TreeNode[] = [];
    let current: TreeNode | null = this.parent;
    while (current !== null && current.parent !== null) {
      parents.push(current);
      current = current.parent;
    }
    return (this._parents = parents.reverse());
  }

  get children(): TreeNode[] {
    return (this._children ??= Array.from(this.values()));
  }
}

export const normalizeTreePath = (path: string) =>
  path.length > 1 && path[path.length - 1] === '/' ? path.slice(0, -1) : path;

export function getPathParts(path: string) {
  const parts = path.split('/');
  if (path[0] === '/') {
    parts[0] = '/';
  }

  if (path[path.length - 1] === '/') {
    parts.pop();
  }

  return parts;
}

export function joinPaths(path1: string, path2: string) {
  if (!path1) {
    return path2;
  }

  if (!path2) {
    return path1;
  }

  if (path1[path1.length - 1] === '/') {
    return path1 + path2;
  }

  return path1 + '/' + path2;
}

export function getParentPath(path: string) {
  const normalized = normalizeTreePath(path);
  const last = normalized.lastIndexOf('/');
  if (last > 0) {
    return normalized.slice(0, last);
  }
  return last === 0 ? '/' : normalized;
}

/**
 * Walk an album's parentId chain up to the root and produce the slash-joined
 * id path matching what `TreeNode.fromAlbums()` writes onto each node.
 * Returns an empty string if the album is not in the list.
 */
export function getAlbumIdPath(albums: AlbumResponseDto[], albumId: string): string {
  const byId = new Map(albums.map((a) => [a.id, a]));
  const parts: string[] = [];
  let current: AlbumResponseDto | undefined = byId.get(albumId);
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    parts.unshift(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return parts.join('/');
}

/**
 * Pull the last segment off a synthesized album path. Used in `getLink`
 * callbacks so navigation always routes to the deepest album, not a
 * concatenated ancestor chain.
 */
export function getLastIdSegment(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? path : path.slice(idx + 1);
}
