<script lang="ts">
  import { browser } from '$app/environment';
  import { IconButton } from '@immich/ui';
  import { mdiClose } from '@mdi/js';
  import { onDestroy, onMount, type Snippet } from 'svelte';
  import { t } from 'svelte-i18n';
  import { fly } from 'svelte/transition';

  interface Props {
    showBackButton?: boolean;
    backIcon?: string;
    class?: string;
    forceDark?: boolean;
    multiRow?: boolean;
    onClose?: () => void;
    leading?: Snippet;
    children?: Snippet;
    trailing?: Snippet;
  }

  let {
    showBackButton = true,
    backIcon = mdiClose,
    class: className = '',
    forceDark = false,
    multiRow = false,
    onClose = () => {},
    leading,
    children,
    trailing,
  }: Props = $props();

  let appBarBorder = $state('border border-subtle');

  // requestAnimationFrame-throttled scroll handler. Previously every
  // scroll event invalidated the entire app bar, causing visible jank on
  // long lists. We collapse multiple events per frame into a single update.
  let scrollFrameRequested = false;

  const computeBorder = () => {
    scrollFrameRequested = false;
    if (window.scrollY > 80) {
      appBarBorder = forceDark ? 'border border-gray-600' : 'border border-gray-200 bg-gray-50 dark:border-gray-600';
    } else {
      appBarBorder = 'border border-subtle';
    }
  };

  const onScroll = () => {
    if (scrollFrameRequested) {
      return;
    }
    scrollFrameRequested = true;
    requestAnimationFrame(computeBorder);
  };

  onMount(() => {
    if (browser) {
      document.addEventListener('scroll', onScroll, { passive: true });
    }
  });

  onDestroy(() => {
    if (browser) {
      document.removeEventListener('scroll', onScroll);
    }
  });
</script>

<div in:fly={{ y: 10, duration: 200 }} class="absolute top-0 w-full bg-transparent">
  <nav
    id="asset-selection-app-bar"
    class={[
      'grid',
      multiRow && 'grid-cols-[100%] md:grid-cols-[25%_50%_25%]',
      !multiRow && 'grid-cols-[10%_80%_10%] sm:grid-cols-[25%_50%_25%]',
      'justify-between lg:grid-cols-[25%_50%_25%]',
      appBarBorder,
      'm-2 place-items-center rounded-full p-2 transition-all max-md:p-0',
      className,
      forceDark ? 'bg-immich-dark-gray! text-white' : 'bg-light-50 dark:bg-immich-dark-gray',
    ]}
  >
    <div class="flex place-items-center justify-self-start sm:gap-6 dark:text-immich-dark-fg {forceDark ? 'dark' : ''}">
      {#if showBackButton}
        <IconButton
          aria-label={$t('close')}
          onclick={onClose}
          color="secondary"
          shape="round"
          variant="ghost"
          icon={backIcon}
          size="large"
        />
      {/if}
      {@render leading?.()}
    </div>

    <div class="w-full">
      {@render children?.()}
    </div>

    <div class="me-4 flex place-items-center gap-1 justify-self-end max-[350px]:me-0 max-[350px]:gap-0">
      {@render trailing?.()}
    </div>
  </nav>
</div>
