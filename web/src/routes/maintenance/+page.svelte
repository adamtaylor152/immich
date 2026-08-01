<script lang="ts">
  /* eslint-disable unicorn/no-optional-chaining-on-undeclared-variable */
  import AuthPageLayout from '$lib/components/layouts/AuthPageLayout.svelte';
  import MaintenanceRestoreFlow from './MaintenanceRestoreFlow.svelte';
  import FormatMessage from '$lib/elements/FormatMessage.svelte';
  import { handleSetMaintenanceMode } from '$lib/services/maintenance.service';
  import { maintenanceStore } from '$lib/stores/maintenance.store';
  import { loadMaintenanceStatus } from '$lib/utils/maintenance';
  import { websocketEvents } from '$lib/stores/websocket';
  import { MaintenanceAction } from '@immich/sdk';
  import { Button, Heading, Link, ProgressBar, Scrollable, Text } from '@immich/ui';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  type Props = {
    data: PageData;
  };

  const { data }: Props = $props();

  const { auth, status } = maintenanceStore;

  // The websocket layer (see web/src/lib/stores/websocket.ts) already updates
  // maintenanceStore.status whenever a MaintenanceStatusV1 event arrives,
  // and the connection is opened for the maintenance route even without auth
  // (see openWebsocketConnection). We only need a single status fetch at mount
  // time to populate the store; live updates arrive via the websocket.
  onMount(() => {
    // One-shot initial load — websocket events take over after that.
    void loadMaintenanceStatus().catch(() => undefined);

    // Subscribe to the websocket event explicitly as well. websocket.ts
    // already calls maintenanceStore.status.set on its own, but listening here
    // means this component reacts immediately even if the maintenanceStore
    // wiring ever changes upstream.
    const cleanup = websocketEvents.on('MaintenanceStatusV1', (event) => {
      maintenanceStore.status.set(event);
    });

    return () => cleanup();
  });

  // strip token from URL after load
  const url = new URL(location.href);
  if (url.searchParams.get('token')) {
    url.searchParams.delete('token');
    history.replaceState({}, document.title, url);
  }

  const end = () =>
    handleSetMaintenanceMode({
      action: MaintenanceAction.End,
    });

  const error = $derived(
    $status?.error
      ?.split('\n')
      .filter((line) => !line.includes('drop cascades'))
      .join('\n'),
  );
</script>

<AuthPageLayout
  withHeader={$status?.action === MaintenanceAction.Start || $status?.action === MaintenanceAction.End}
  withBackdrop={$status?.action === MaintenanceAction.Start}
>
  <div class="flex flex-col place-items-center gap-8 text-center">
    {#if $status?.action === MaintenanceAction.RestoreDatabase}
      <Heading size="large" color="primary" tag="h1">{$t('maintenance_action_restore')}</Heading>
      {#if $status.error}
        <Scrollable class="max-h-80">
          <pre class="text-left text-sm"><code>{error}</code></pre>
        </Scrollable>
        <Button onclick={end}>{$t('maintenance_end')}</Button>
      {:else}
        <ProgressBar progress={$status.progress || 0} />
        {#if $status.task === 'backup'}
          <Text>{$t('maintenance_task_backup')}</Text>
        {/if}
        {#if $status.task === 'restore'}
          <Text>{$t('maintenance_task_restore')}</Text>
        {/if}
        {#if $status.task === 'migrations'}
          <Text>{$t('maintenance_task_migrations')}</Text>
        {/if}
        {#if $status.task === 'rollback'}
          <Text>{$t('maintenance_task_rollback')}</Text>
        {/if}
      {/if}
    {:else if $status?.action === MaintenanceAction.SelectDatabaseRestore && $auth}
      <MaintenanceRestoreFlow {end} expectedVersion={data.expectedVersion} />
    {:else}
      <Heading size="large" color="primary" tag="h1">{$t('maintenance_title')}</Heading>
      <p>
        <FormatMessage key="maintenance_description">
          {#snippet children({ tag, message })}
            {#if tag === 'link'}
              <Link href="https://docs.immich.app/administration/maintenance-mode">
                {message}
              </Link>
            {/if}
          {/snippet}
        </FormatMessage>
      </p>
      {#if $auth}
        <p>
          {$t('maintenance_logged_in_as', {
            values: {
              user: $auth.username,
            },
          })}
        </p>
        <Button onclick={end}>{$t('maintenance_end')}</Button>
      {/if}
    {/if}
  </div>
</AuthPageLayout>
