<script lang="ts">
  import Tree from '$lib/components/shared-components/tree/Tree.svelte';
  import { type TreeNode } from '$lib/utils/tree-utils';

  interface Props {
    tree: TreeNode;
    active: string;
    icons: { default: string; active: string };
    getLink: (path: string) => string;
    onDrop?: (draggedId: string, targetPath: string, position: 'before' | 'inside' | 'after') => void;
    canAcceptDrop?: (draggedId: string, targetPath: string, position: 'before' | 'inside' | 'after') => boolean;
    draggedId?: string | null;
    getIcons?: (node: TreeNode) => { default: string; active: string };
    /** Optional per-node thumbnail URL; when returned, rendered instead of the icon (nav style). */
    getThumbnail?: (node: TreeNode) => string | undefined;
    labelClass?: string;
    /** Override the `<ul>` class for this level only; nested levels keep the default indent. */
    listClass?: string;
    /** Opt into the main-nav row treatment (rounded end cap, thumbnails, nav tokens). Off for tags/folders. */
    navStyle?: boolean;
    enableDrag?: boolean;
    onDragStart?: (id: string) => void;
    onDragEnd?: () => void;
  }

  let {
    tree,
    active,
    icons,
    getLink,
    onDrop,
    canAcceptDrop,
    draggedId = null,
    getIcons,
    getThumbnail,
    labelClass,
    listClass,
    navStyle = false,
    enableDrag = false,
    onDragStart,
    onDragEnd,
  }: Props = $props();
</script>

<ul class={listClass ?? 'ms-2 list-none'}>
  {#each tree.children as node (node.color ? node.path + node.color : node.path)}
    <li>
      <Tree
        {node}
        {icons}
        {active}
        {getLink}
        {onDrop}
        {canAcceptDrop}
        {draggedId}
        {getIcons}
        {getThumbnail}
        {labelClass}
        {navStyle}
        {enableDrag}
        {onDragStart}
        {onDragEnd}
      />
    </li>
  {/each}
</ul>
