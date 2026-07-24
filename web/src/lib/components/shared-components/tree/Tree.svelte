<script lang="ts">
  import TreeItems from '$lib/components/shared-components/tree/TreeItems.svelte';
  import { getAlbumDragData, isAlbumDrag, setAlbumDragData } from '$lib/utils/album-drag';
  import { TreeNode } from '$lib/utils/tree-utils';
  import { Icon } from '@immich/ui';
  import { mdiChevronDown, mdiChevronRight } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    node: TreeNode;
    active: string;
    icons: { default: string; active: string };
    getLink: (path: string) => string;
    /**
     * Optional drop-target hooks. When supplied, every tree row also accepts
     * an album-drag (see `album-drag.ts`) and invokes `onDrop` with the dragged
     * album id, the target node's path, and where on the row the drop landed:
     *   - 'before' — top 25%: insert as a previous sibling of the target
     *   - 'inside' — middle 50%: nest as a child of the target
     *   - 'after'  — bottom 25%: insert as a following sibling of the target
     * Backward-compatible: omit to disable drop, as the tags page does.
     */
    onDrop?: (draggedId: string, targetPath: string, position: 'before' | 'inside' | 'after') => void;
    canAcceptDrop?: (draggedId: string, targetPath: string, position: 'before' | 'inside' | 'after') => boolean;
    draggedId?: string | null;
    /**
     * Per-node icon override. When supplied, the returned default/active pair
     * replaces the `icons` prop for this row only — used by the albums tree to
     * show each album's customized icon while keeping the tags tree unchanged.
     */
    getIcons?: (node: TreeNode) => { default: string; active: string };
    /**
     * Per-node thumbnail URL. When it returns a URL the row renders that cover
     * image instead of the icon — used by the album trees in nav style.
     */
    getThumbnail?: (node: TreeNode) => string | undefined;
    /**
     * Tailwind utility classes for the node label `<span>`. Defaults to the
     * monospace/text-sm look used by the tags tree. The albums tree overrides
     * to use the standard `GoogleSans` body font at a larger size.
     */
    labelClass?: string;
    /**
     * Opt into the main left-nav row treatment (rounded end cap, thumbnails,
     * nav color tokens) so the album trees match the sidebar. Off by default so
     * the tags and folders trees keep their existing compact look.
     */
    navStyle?: boolean;
    /**
     * When true the row also becomes a drag source — needed so siblings can be
     * reordered straight from the tree. Drag data uses `node.id` as the album
     * id, so the node must have one (set by `TreeNode.fromAlbums`).
     */
    enableDrag?: boolean;
    onDragStart?: (id: string) => void;
    onDragEnd?: () => void;
  }

  const DEFAULT_LABEL_CLASS =
    'overflow-hidden ps-1 pt-1 font-mono text-sm text-nowrap text-ellipsis whitespace-pre-wrap';

  let {
    node,
    active,
    icons,
    getLink,
    onDrop,
    canAcceptDrop,
    draggedId = null,
    getIcons,
    getThumbnail,
    labelClass = DEFAULT_LABEL_CLASS,
    navStyle = false,
    enableDrag = false,
    onDragStart,
    onDragEnd,
  }: Props = $props();

  const isDragSource = $derived(enableDrag && !!node.id);

  const handleDragStart = (event: DragEvent) => {
    if (!isDragSource || !node.id) {
      return;
    }
    setAlbumDragData(event, node.id);
    onDragStart?.(node.id);
  };

  const handleDragEnd = () => {
    onDragEnd?.();
  };

  const nodeIcons = $derived(getIcons ? getIcons(node) : icons);
  const nodeThumbnail = $derived(getThumbnail?.(node));
  const isTarget = $derived(active === node.path);
  const isActive = $derived(active === node.path || active.startsWith(node.value === '/' ? '/' : `${node.path}/`));
  let isOpen = $derived(isActive);
  let dropPosition = $state<'before' | 'inside' | 'after' | null>(null);
  const dropEnabled = $derived(onDrop !== undefined);

  // Nav style mirrors the RecentAlbums sidebar rows (rounded end cap, subtle
  // hover, immich color tokens); default keeps the original compact tree row.
  const rowClass = $derived(
    [
      navStyle
        ? 'relative flex grow place-items-center gap-4 rounded-e-full py-3 ps-10 transition-[padding] delay-100 duration-100 hover:cursor-pointer hover:bg-subtle hover:text-immich-primary group-hover:sm:px-10 md:px-10 dark:text-immich-dark-fg dark:hover:bg-immich-dark-gray dark:hover:text-immich-dark-primary'
        : 'relative flex grow place-items-center rounded-lg py-1 ps-2 hover:bg-slate-200 hover:font-semibold dark:hover:bg-slate-800',
      isTarget
        ? navStyle
          ? 'bg-primary/10 font-semibold text-immich-primary dark:text-immich-dark-primary'
          : 'bg-slate-100 font-semibold text-primary dark:bg-slate-700'
        : navStyle
          ? ''
          : 'dark:text-gray-200',
      dropPosition === 'inside' ? 'bg-primary/10 ring-2 ring-primary' : '',
      dropPosition === 'before'
        ? "before:absolute before:inset-x-0 before:-top-0.5 before:h-1 before:rounded-full before:bg-primary before:content-['']"
        : '',
      dropPosition === 'after'
        ? "after:absolute after:inset-x-0 after:-bottom-0.5 after:h-1 after:rounded-full after:bg-primary after:content-['']"
        : '',
    ].join(' '),
  );

  const onclick = (event: MouseEvent) => {
    event.preventDefault();
    isOpen = !isOpen;
  };

  const computeDropPosition = (event: DragEvent): 'before' | 'inside' | 'after' => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / rect.height;
    if (ratio < 0.25) {
      return 'before';
    }
    if (ratio > 0.75) {
      return 'after';
    }
    return 'inside';
  };

  const handleDragOver = (event: DragEvent) => {
    if (!dropEnabled || !isAlbumDrag(event)) {
      return;
    }
    const position = computeDropPosition(event);
    if (canAcceptDrop && draggedId && !canAcceptDrop(draggedId, node.path, position)) {
      dropPosition = null;
      return;
    }
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'move';
    dropPosition = position;
  };

  const handleDragLeave = () => {
    dropPosition = null;
  };

  const handleDrop = (event: DragEvent) => {
    if (!dropEnabled) {
      return;
    }
    event.preventDefault();
    const position = dropPosition ?? computeDropPosition(event);
    dropPosition = null;
    const dropped = getAlbumDragData(event);
    if (dropped) {
      onDrop?.(dropped, node.path, position);
    }
  };
</script>

<a
  href={getLink(node.path)}
  title={node.value}
  class={rowClass}
  data-sveltekit-keepfocus
  draggable={isDragSource}
  ondragstart={handleDragStart}
  ondragend={handleDragEnd}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
>
  {#if node.size > 0}
    <button type="button" {onclick} aria-label={$t(isOpen ? 'collapse' : 'expand')}>
      <Icon icon={isOpen ? mdiChevronDown : mdiChevronRight} class="text-gray-400" size="20" />
    </button>
  {/if}
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
  <span class={labelClass}>{node.value}</span>
</a>

{#if isOpen}
  <TreeItems
    tree={node}
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
{/if}
