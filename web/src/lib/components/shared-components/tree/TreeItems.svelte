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
    labelClass?: string;
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
    labelClass,
    enableDrag = false,
    onDragStart,
    onDragEnd,
  }: Props = $props();
</script>

<ul class="ms-2 list-none">
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
        {labelClass}
        {enableDrag}
        {onDragStart}
        {onDragEnd}
      />
    </li>
  {/each}
</ul>
