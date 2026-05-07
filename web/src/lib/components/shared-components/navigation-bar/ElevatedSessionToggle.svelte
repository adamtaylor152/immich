<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import { eventManager } from '$lib/managers/event-manager.svelte';
  import { Route } from '$lib/route';
  import { handleError } from '$lib/utils/handle-error';
  import { isAssetViewerRoute, navigate } from '$lib/utils/navigation';
  import { getAuthStatus, lockAuthSession } from '@immich/sdk';
  import { IconButton } from '@immich/ui';
  import { mdiLockOpenVariantOutline, mdiLockOutline } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  let isElevated = $state(false);
  let isLoading = $state(true);

  const label = $derived(isElevated ? $t('lock_sensitive_content') : $t('unlock_sensitive_content'));
  const icon = $derived(isElevated ? mdiLockOpenVariantOutline : mdiLockOutline);

  const isLockedRoute = (pathname: string) => pathname === Route.locked() || pathname.startsWith(`${Route.locked()}/`);
  const isSuppressedRoute = (pathname: string) =>
    pathname === Route.suppressed() || pathname.startsWith(`${Route.suppressed()}/`);
  const getContinueUrl = () => page.url.pathname + page.url.search;

  const refreshAuthStatus = async () => {
    isLoading = true;
    try {
      const status = await getAuthStatus();
      isElevated = status.isElevated;
    } catch (error) {
      console.error('Failed to load elevated session status', error);
    } finally {
      isLoading = false;
    }
  };

  onMount(() => {
    void refreshAuthStatus();

    return eventManager.on({
      SessionLocked: () => (isElevated = false),
      SessionAccessChanged: ({ isElevated: elevated }) => (isElevated = elevated),
    });
  });

  const handleLockSession = async () => {
    const pathname = page.url.pathname;
    const isSensitiveRoute = isLockedRoute(pathname) || isSuppressedRoute(pathname);

    isLoading = true;
    try {
      await lockAuthSession();
      isElevated = false;

      if (isSensitiveRoute) {
        await goto(Route.photos());
      } else if (isAssetViewerRoute(page)) {
        await navigate({ targetRoute: 'current', assetId: null }, { replaceState: true, invalidateAll: true });
      } else {
        await invalidateAll();
      }

      eventManager.emit('SessionAccessChanged', { isElevated: false });
      eventManager.emit('SessionLocked');
    } catch (error) {
      handleError(error, $t('errors.something_went_wrong'));
    } finally {
      isLoading = false;
    }
  };

  const handleToggleSession = async () => {
    if (isLoading) {
      return;
    }

    if (!isElevated) {
      await goto(Route.pinPrompt({ continue: getContinueUrl() }));
      return;
    }

    await handleLockSession();
  };
</script>

<IconButton
  color={isElevated ? 'primary' : 'secondary'}
  shape="round"
  variant="ghost"
  size="medium"
  {icon}
  disabled={isLoading}
  onclick={handleToggleSession}
  title={label}
  aria-label={label}
/>
