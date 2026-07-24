<script lang="ts" module>
  export const headerId = 'user-page-header';
</script>

<script lang="ts">
  import { useActions, type ActionArray } from '$lib/actions/use-actions';
  import NavigationBar from '$lib/components/shared-components/navigation-bar/NavigationBar.svelte';
  import UserSidebar from '$lib/components/shared-components/side-bar/UserSidebar.svelte';
  import { sidebarCollapsed, sidebarWidth } from '$lib/stores/preferences.store';
  import { sidebarStore } from '$lib/stores/sidebar.svelte';
  import type { HeaderButtonActionItem } from '$lib/types';
  import { openFileUploadDialog } from '$lib/utils/file-uploader';
  import { Button, ContextMenuButton, HStack, isMenuItemType, type MenuItemType } from '@immich/ui';
  import type { Snippet } from 'svelte';
  import { t } from 'svelte-i18n';

  interface Props {
    hideNavbar?: boolean;
    title?: string | undefined;
    description?: string | undefined;
    scrollbar?: boolean;
    use?: ActionArray;
    actions?: Array<HeaderButtonActionItem | MenuItemType>;
    sidebar?: Snippet;
    buttons?: Snippet;
    children?: Snippet;
  }

  let {
    hideNavbar = false,
    title = undefined,
    description = undefined,
    scrollbar = true,
    use = [],
    actions = [],
    sidebar,
    buttons,
    children,
  }: Props = $props();

  const enabledActions = $derived(
    actions
      .filter((action): action is HeaderButtonActionItem => !isMenuItemType(action))
      .filter((action) => action.$if?.() ?? true),
  );

  let scrollbarClass = $derived(scrollbar ? 'immich-scrollbar' : 'scrollbar-hidden');
  let hasTitleClass = $derived(title ? 'top-16 h-[calc(100%-(--spacing(16)))]' : 'top-0 h-full');

  const MIN_SIDEBAR_WIDTH = 200;
  const MAX_SIDEBAR_WIDTH = 500;
  // Collapsed rail width must fit a single icon (ps-5 padding + ~1.375em icon).
  const COLLAPSED_WIDTH = '4.5rem';
  const clampWidth = (value: number) => Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, value));
  // Clamp the persisted value too: a stale/edited localStorage entry could be out of range.
  const effectiveWidth = $derived(clampWidth($sidebarWidth));
  const railWidth = $derived($sidebarCollapsed ? COLLAPSED_WIDTH : `${effectiveWidth}px`);

  let container = $state<HTMLDivElement>();

  const resizeTo = (clientX: number) => {
    if (!container) {
      return;
    }
    const left = container.getBoundingClientRect().left;
    $sidebarWidth = Math.round(clampWidth(clientX - left));
  };

  const startResize = (event: PointerEvent) => {
    event.preventDefault();
    sidebarStore.isResizing = true;
    const controller = new AbortController();
    const { signal } = controller;
    const stopResize = () => {
      sidebarStore.isResizing = false;
      controller.abort();
    };
    globalThis.addEventListener('pointermove', (e: PointerEvent) => resizeTo(e.clientX), { signal });
    globalThis.addEventListener('pointerup', stopResize, { once: true, signal });
    globalThis.addEventListener('pointercancel', stopResize, { once: true, signal });
    globalThis.addEventListener('blur', stopResize, { once: true, signal });
  };

  const onResizeKey = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0;
    if (step === 0) {
      return;
    }
    event.preventDefault();
    $sidebarWidth = clampWidth($sidebarWidth + step);
  };
</script>

<header>
  {#if !hideNavbar}
    <NavigationBar onUploadClick={() => openFileUploadDialog()} />
  {/if}
</header>
<div
  bind:this={container}
  tabindex="-1"
  style="--sidebar-width: {railWidth}"
  class="relative z-0 grid grid-cols-[--spacing(0)_auto] overflow-hidden sidebar:grid-cols-[var(--sidebar-width)_auto]
    {sidebarStore.isResizing ? '' : 'transition-[grid-template-columns] duration-200'}
    {hideNavbar ? 'h-dvh' : 'h-[calc(100dvh-var(--navbar-height))] max-md:h-[calc(100dvh-var(--navbar-height-md))]'}
    {hideNavbar ? 'pt-(--navbar-height)' : ''}
    {hideNavbar ? 'max-md:pt-(--navbar-height-md)' : ''}"
>
  {#if sidebar}
    {@render sidebar()}
  {:else}
    <UserSidebar />
  {/if}

  {#if !$sidebarCollapsed}
    <!-- Drag handle to resize the sidebar; sits on the sidebar/content boundary (desktop only). -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={$t('resize_sidebar')}
      aria-valuenow={effectiveWidth}
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuemax={MAX_SIDEBAR_WIDTH}
      tabindex="0"
      style="inset-inline-start: var(--sidebar-width)"
      class="absolute inset-y-0 z-2 hidden w-1.5 -translate-x-1/2 cursor-col-resize hover:bg-primary/40 focus-visible:bg-primary/40 sidebar:block"
      onpointerdown={startResize}
      onkeydown={onResizeKey}
    ></div>
  {/if}

  <main class="relative">
    <div class="{scrollbarClass} absolute {hasTitleClass} w-full overflow-y-auto p-2" use:useActions={use}>
      {@render children?.()}
    </div>

    {#if title || buttons}
      <div class="absolute flex h-16 w-full place-items-center justify-between border-b p-2 text-dark">
        <div class="flex items-center gap-2">
          {#if title}
            <div class="pe-8 outline-none" tabindex="-1" id={headerId}>{title}</div>
          {/if}
          {#if description}
            <p class="text-sm text-gray-400 dark:text-gray-600">{description}</p>
          {/if}
        </div>

        {@render buttons?.()}

        {#if enabledActions.length > 0}
          <div class="hidden md:block">
            <HStack gap={0}>
              {#each enabledActions as action, i (i)}
                <Button
                  variant="ghost"
                  size="small"
                  color={action.color ?? 'secondary'}
                  leadingIcon={action.icon}
                  onclick={() => action.onAction(action)}
                  title={action.data?.title}
                >
                  {action.title}
                </Button>
              {/each}
            </HStack>
          </div>

          <ContextMenuButton aria-label={$t('open')} items={actions} class="md:hidden" />
        {/if}
      </div>
    {/if}
  </main>
</div>
