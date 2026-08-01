<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    listGpus as listRunPodGpus,
    Mode2 as RunPodMode,
    provision as provisionRunPodPod,
    start as startRunPodPod,
    stop as stopRunPodPod,
    terminate as terminateRunPodPod,
    testConnection as testRunPodConnection,
    type RunPodGpuTypeDto,
    type RunPodProvisionDto,
    type RunPodStateDto,
  } from '@immich/sdk';
  import FormatMessage from '$lib/elements/FormatMessage.svelte';
  import { systemConfigManager } from '$lib/managers/system-config-manager.svelte';
  import { handleError } from '$lib/utils/handle-error';
  import { Button, modalManager, toastManager } from '@immich/ui';
  import type { SystemConfigMachineLearningDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';

  // Optionally accept the in-progress form state so visibility of the launch
  // fieldsets reacts to dropdown changes the admin hasn't saved yet. Falls
  // back to the saved config when the parent doesn't pass anything.
  let { workingConfig }: { workingConfig?: SystemConfigMachineLearningDto } = $props();

  // Hand-rolled fetch instead of the SDK helper so we don't have to plumb additional
  // generated names through. Hits /api/runpod/pods/current with the existing session.
  const fetchCurrent = async (): Promise<RunPodStateDto> => {
    const response = await fetch('/api/runpod/pods/current', { credentials: 'include' });
    if (!response.ok) {
      throw new Error(`Failed to load RunPod state (${response.status})`);
    }
    return response.json();
  };

  const runBackfill = async () => {
    const response = await fetch('/api/runpod/backfill', { method: 'POST', credentials: 'include' });
    if (!response.ok) {
      // Surface the actual server error message (e.g. "Cannot start backfill
      // while RunPod is serverless-ready") instead of a generic status code.
      let detail = String(response.status);
      try {
        const body = (await response.json()) as { message?: string };
        if (body.message) {
          detail = body.message;
        }
      } catch {
        // Body wasn't JSON; fall back to status code.
      }
      throw new Error(`Failed to enqueue backfill: ${detail}`);
    }
    return response.json() as Promise<{ enqueued: string[]; skipped: string[] }>;
  };

  let podState = $state<RunPodStateDto | null>(null);
  let gpuTypes = $state<RunPodGpuTypeDto[]>([]);
  let gpuLoading = $state(false);
  let gpuError = $state<string | null>(null);
  let testing = $state(false);
  let testResult = $state<{ ok: boolean; message?: string } | null>(null);
  let provisioning = $state(false);
  let stopping = $state(false);
  let terminating = $state(false);
  let backfilling = $state(false);
  let consent = $state(false);
  let selectedGpu = $state('');
  let imageOverride = $state('');
  let maxHoursOverride = $state<number | undefined>(undefined);

  let pollTimer: ReturnType<typeof setInterval> | undefined;

  const config = $derived(systemConfigManager.value);
  // Zod's `.default(...)` on runpod makes it optional in the DTO type even
  // though the server always materialises it; assert non-null here.
  const rp = $derived(config.machineLearning.runpod!);
  // Visibility-driving state. When the parent passes `workingConfig` (the
  // form's in-progress edits), prefer it so changing the Mode dropdown
  // immediately reveals/hides the matching sections. Otherwise fall back to
  // the saved server config so the panel is still usable standalone.
  const editing = $derived<{ enabled: boolean; runpod: NonNullable<typeof rp> }>(
    workingConfig
      ? { enabled: workingConfig.enabled, runpod: workingConfig.runpod! }
      : { enabled: config.machineLearning.enabled, runpod: rp },
  );
  const runpodMode = $derived<RunPodMode>(
    editing.runpod.mode && editing.runpod.mode !== RunPodMode.Disabled
      ? editing.runpod.mode
      : editing.runpod.enabled
        ? RunPodMode.Pod
        : RunPodMode.Disabled,
  );
  const enabled = $derived(editing.enabled && runpodMode !== RunPodMode.Disabled);
  const isPodMode = $derived(runpodMode === RunPodMode.Pod);
  const isServerlessMode = $derived(runpodMode === RunPodMode.Serverless);
  // The saved apiKey is always redacted to '' on read, so checking its
  // length here always returned false. Honour the explicit server-side
  // boolean OR a fresh non-empty value typed into the in-progress form.
  const apiKeyConfigured = $derived(Boolean(rp.apiKeyConfigured) || (editing.runpod.apiKey?.length ?? 0) > 0);
  const status = $derived(podState?.status ?? 'idle');
  const isTransitioning = $derived(
    ['provisioning', 'starting', 'stopping', 'serverless-provisioning'].includes(status),
  );
  const isRunning = $derived(status === 'running');
  const isStopped = $derived(status === 'stopped');
  const isServerlessReady = $derived(status === 'serverless-ready');
  // workerReady is the server-side /ping probe result. `serverless-ready`
  // means the endpoint exists; workerReady means a worker is actually
  // responding. Pod's `running` state is set after a successful /ping so
  // workerReady is effectively true whenever running == true, but the
  // server returns the explicit flag either way.
  const workerReady = $derived(podState?.workerReady === true);
  const canBackfill = $derived((isRunning || isServerlessReady) && !backfilling);
  let endpointBusy = $state(false);
  let consentError = $state(false);

  const attemptServerlessLaunch = () => {
    if (!consent) {
      consentError = true;
      return;
    }
    consentError = false;
    void handleServerlessSetup();
  };

  const setupServerlessEndpoint = async (): Promise<RunPodStateDto> => {
    const response = await fetch('/api/runpod/endpoint/setup', { method: 'POST', credentials: 'include' });
    if (!response.ok) {
      throw new Error(`Failed to set up serverless endpoint (${response.status})`);
    }
    return response.json();
  };

  const teardownServerlessEndpoint = async (): Promise<RunPodStateDto> => {
    const response = await fetch('/api/runpod/endpoint', { method: 'DELETE', credentials: 'include' });
    if (!response.ok) {
      throw new Error(`Failed to tear down serverless endpoint (${response.status})`);
    }
    return response.json();
  };

  const handleServerlessSetup = async () => {
    endpointBusy = true;
    try {
      podState = await setupServerlessEndpoint();
      toastManager.primary($t('admin.machine_learning_runpod_endpoint_ready_toast'));
    } catch (error) {
      handleError(error, $t('admin.machine_learning_runpod_failed_setup_endpoint'));
    } finally {
      endpointBusy = false;
    }
  };

  const handleServerlessTeardown = async () => {
    const confirmed = await modalManager.showDialog({
      title: $t('admin.machine_learning_runpod_teardown_confirm_title'),
      prompt: $t('admin.machine_learning_runpod_teardown_confirm_prompt'),
      confirmColor: 'danger',
    });
    if (!confirmed) {
      return;
    }
    endpointBusy = true;
    try {
      podState = await teardownServerlessEndpoint();
      toastManager.primary($t('admin.machine_learning_runpod_endpoint_torn_down_toast'));
    } catch (error) {
      handleError(error, $t('admin.machine_learning_runpod_failed_teardown_endpoint'));
    } finally {
      endpointBusy = false;
    }
  };

  // The poll fires every 5s; a transient API blip should not spam toast
  // notifications. Only surface an error once per consecutive failure streak,
  // and clear the flag on the first successful refresh.
  let pollErrorShown = $state(false);
  // Track in-flight refresh so the 5s tick skips when a slow request is
  // still outstanding. Without this, network blips stack pending requests
  // and late-resolving stale responses overwrite newer state.
  let refreshInFlight = false;

  const refresh = async (options: { notifyOnError?: boolean } = {}) => {
    if (refreshInFlight) {
      return;
    }
    const notify = options.notifyOnError ?? true;
    refreshInFlight = true;
    try {
      podState = await fetchCurrent();
      pollErrorShown = false;
    } catch (error) {
      if (notify && !pollErrorShown) {
        handleError(error, $t('admin.machine_learning_runpod_failed_load_state'));
        pollErrorShown = true;
      } else if (!notify) {
        console.debug('RunPod state poll failed:', error);
      }
    } finally {
      refreshInFlight = false;
    }
  };

  const refreshGpus = async () => {
    if (!apiKeyConfigured) {
      gpuTypes = [];
      return;
    }
    gpuLoading = true;
    gpuError = null;
    try {
      gpuTypes = await listRunPodGpus();
      if (!selectedGpu) {
        selectedGpu = rp.defaultGpuTypeId ?? gpuTypes[0]?.id ?? '';
      }
    } catch (error) {
      gpuError = error instanceof Error ? error.message : String(error);
    } finally {
      gpuLoading = false;
    }
  };

  onMount(() => {
    void refresh();
    void refreshGpus();
    pollTimer = setInterval(() => void refresh({ notifyOnError: false }), 5000);
  });

  onDestroy(() => {
    if (pollTimer) {
      clearInterval(pollTimer);
    }
  });

  const handleTestConnection = async () => {
    testing = true;
    testResult = null;
    try {
      testResult = await testRunPodConnection({ runPodConnectionTestDto: {} });
      if (testResult.ok) {
        toastManager.primary($t('admin.machine_learning_runpod_connection_test_ok_toast'));
        await refreshGpus();
      }
    } catch (error) {
      testResult = { ok: false, message: error instanceof Error ? error.message : String(error) };
    } finally {
      testing = false;
    }
  };

  const handleLaunch = async () => {
    if (!consent) {
      toastManager.warning($t('admin.machine_learning_runpod_consent_required_title'));
      return;
    }
    if (!selectedGpu) {
      toastManager.warning($t('admin.machine_learning_runpod_pick_gpu_first'));
      return;
    }
    provisioning = true;
    try {
      const dto: RunPodProvisionDto = {
        gpuTypeId: selectedGpu,
        acknowledgeDataPrivacy: true,
        ...(imageOverride.trim() && { imageName: imageOverride.trim() }),
        ...(maxHoursOverride && { maxRuntimeHours: maxHoursOverride }),
      };
      podState = await provisionRunPodPod({ runPodProvisionDto: dto });
      toastManager.info($t('admin.machine_learning_runpod_launching_toast'));
    } catch (error) {
      handleError(error, $t('admin.machine_learning_runpod_failed_to_launch'));
    } finally {
      provisioning = false;
    }
  };

  const handleStop = async () => {
    stopping = true;
    try {
      podState = await stopRunPodPod();
      toastManager.info($t('admin.machine_learning_runpod_stop_requested'));
    } catch (error) {
      handleError(error, $t('admin.machine_learning_runpod_failed_to_stop'));
    } finally {
      stopping = false;
    }
  };

  const handleStart = async () => {
    provisioning = true;
    try {
      podState = await startRunPodPod();
      toastManager.info($t('admin.machine_learning_runpod_resuming_toast'));
    } catch (error) {
      handleError(error, $t('admin.machine_learning_runpod_failed_to_resume'));
    } finally {
      provisioning = false;
    }
  };

  const handleTerminate = async () => {
    const confirmed = await modalManager.showDialog({
      title: $t('admin.machine_learning_runpod_terminate_confirm_title'),
      prompt: $t('admin.machine_learning_runpod_terminate_confirm_prompt'),
      confirmColor: 'danger',
    });
    if (!confirmed) {
      return;
    }
    terminating = true;
    try {
      podState = await terminateRunPodPod();
      toastManager.primary($t('admin.machine_learning_runpod_pod_terminated_toast'));
    } catch (error) {
      handleError(error, $t('admin.machine_learning_runpod_failed_to_terminate'));
    } finally {
      terminating = false;
    }
  };

  const handleBackfill = async () => {
    backfilling = true;
    try {
      const result = await runBackfill();
      const enqueued = result.enqueued.join(', ');
      // Use a separate "none enqueued" key so translators can tailor the copy
      // (e.g. negative phrasing) instead of receiving a literal "nothing".
      const enqueuedMessage = enqueued
        ? $t('admin.machine_learning_runpod_backfill_enqueued_toast', { values: { jobs: enqueued } })
        : $t('admin.machine_learning_runpod_backfill_enqueued_none_toast');
      const message =
        result.skipped.length > 0
          ? `${enqueuedMessage} · ${$t('admin.machine_learning_runpod_backfill_skipped_toast', { values: { jobs: result.skipped.join(', ') } })}`
          : enqueuedMessage;
      toastManager.info(message);
    } catch (error) {
      handleError(error, $t('admin.machine_learning_runpod_failed_to_backfill'));
    } finally {
      backfilling = false;
    }
  };

  const minutesAgo = (iso?: string) => {
    if (!iso) {
      return '';
    }
    const ms = Date.now() - Date.parse(iso);
    if (!Number.isFinite(ms)) {
      return '';
    }
    const m = Math.floor(ms / 60_000);
    if (m < 1) {
      return $t('admin.machine_learning_runpod_just_now');
    }
    if (m < 60) {
      return $t('admin.machine_learning_runpod_minutes_ago', { values: { minutes: m } });
    }
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m ago`;
  };

  const formatCost = (podState: RunPodStateDto): string | null => {
    if (podState.status !== 'running' || !podState.runningSince) {
      return null;
    }
    const gpu = gpuTypes.find((g) => g.id === podState.gpuTypeId);
    if (!gpu?.pricePerHour) {
      return null;
    }
    const hours = (Date.now() - Date.parse(podState.runningSince)) / 3_600_000;
    if (!Number.isFinite(hours)) {
      return null;
    }
    return `$${(hours * gpu.pricePerHour).toFixed(3)} (est., ${gpu.pricePerHour.toFixed(2)}/hr)`;
  };
</script>

<div class="my-2 flex flex-col gap-4">
  {#if !enabled}
    <div class="rounded-sm bg-immich-bg/50 p-3 text-sm">
      <p>
        <FormatMessage key="admin.machine_learning_runpod_cloud_gpu_disabled">
          {#snippet children({ tag, message })}
            {#if tag === 'strong'}<strong>{message}</strong>{:else}{message}{/if}
          {/snippet}
        </FormatMessage>
      </p>
    </div>
  {/if}

  {#if podState}
    <div class="rounded-sm border border-immich-gray/20 bg-immich-bg/30 p-3">
      <div class="flex items-start justify-between gap-4">
        <div>
          <div class="flex items-center gap-2">
            <span class="font-semibold">{$t('admin.machine_learning_runpod_status_label')}</span>
            <span
              class="rounded-sm px-2 py-0.5 font-mono text-xs tracking-wide uppercase"
              class:bg-green-200={isRunning || isServerlessReady}
              class:text-green-900={isRunning || isServerlessReady}
              class:bg-yellow-200={isTransitioning}
              class:text-yellow-900={isTransitioning}
              class:bg-red-200={status === 'error'}
              class:text-red-900={status === 'error'}
              class:bg-gray-200={status === 'idle' || isStopped}
            >
              {status}
            </span>
          </div>
          {#if podState.podId}
            <div class="mt-1 font-mono text-xs text-immich-gray">
              {$t('admin.machine_learning_runpod_pod_id', { values: { id: podState.podId } })}
            </div>
          {/if}
          {#if podState.endpointId}
            <div class="mt-1 font-mono text-xs text-immich-gray">
              {$t('admin.machine_learning_runpod_endpoint_id', { values: { id: podState.endpointId } })}
            </div>
          {/if}
          {#if podState.templateId}
            <div class="mt-1 font-mono text-xs text-immich-gray">
              {$t('admin.machine_learning_runpod_template_id', { values: { id: podState.templateId } })}
            </div>
          {/if}
          {#if podState.endpointUrl}
            <div class="mt-1 font-mono text-xs break-all text-immich-gray">
              {$t('admin.machine_learning_runpod_endpoint_url', { values: { url: podState.endpointUrl } })}
            </div>
          {/if}
          {#if podState.imageName}
            <div class="mt-1 text-xs break-all text-immich-gray">
              {$t('admin.machine_learning_runpod_image', { values: { image: podState.imageName } })}
            </div>
          {/if}
          {#if podState.gpuTypeId}
            <div class="mt-1 text-xs text-immich-gray">
              {$t('admin.machine_learning_runpod_gpu', { values: { gpu: podState.gpuTypeId } })}
            </div>
          {/if}
          {#if podState.mlUrl}
            <div class="mt-1 font-mono text-xs break-all text-immich-gray">
              {$t('admin.machine_learning_runpod_pod_running_url', { values: { url: podState.mlUrl } })}
            </div>
          {/if}
          {#if podState.runningSince}
            <div class="mt-1 text-xs text-immich-gray">
              {$t('admin.machine_learning_runpod_running_since', {
                values: { time: minutesAgo(podState.runningSince) },
              })}
            </div>
          {/if}
          {#if podState.lastBusyAt && isRunning}
            <div class="mt-1 text-xs text-immich-gray">
              {$t('admin.machine_learning_runpod_last_busy_at', { values: { time: minutesAgo(podState.lastBusyAt) } })}
            </div>
          {/if}
          {#if isRunning}
            {@const cost = formatCost(podState)}
            {#if cost}
              <div class="mt-1 text-xs text-immich-gray">
                {$t('admin.machine_learning_runpod_cost_estimate', { values: { cost } })}
              </div>
            {/if}
          {/if}
          {#if isServerlessReady}
            <div class="mt-1 text-xs text-immich-gray">
              {$t('admin.machine_learning_runpod_billing_scale_to_zero')}
            </div>
            {#if podState.workersMin !== undefined && podState.workersMax !== undefined}
              <div class="mt-1 text-xs text-immich-gray">
                {#if podState.idleTimeoutSeconds !== undefined}
                  {$t('admin.machine_learning_runpod_workers_summary_with_idle', {
                    values: {
                      min: podState.workersMin,
                      max: podState.workersMax,
                      idle: podState.idleTimeoutSeconds,
                    },
                  })}
                {:else}
                  {$t('admin.machine_learning_runpod_workers_summary', {
                    values: { min: podState.workersMin, max: podState.workersMax },
                  })}
                {/if}
              </div>
            {/if}
          {/if}
          {#if podState.stoppedAt}
            <div class="mt-1 text-xs text-immich-gray">
              {$t('admin.machine_learning_runpod_stopped_at', { values: { time: minutesAgo(podState.stoppedAt) } })}
            </div>
          {/if}
          {#if podState.errorMessage}
            <div class="mt-2 text-xs wrap-break-word text-red-700">{podState.errorMessage}</div>
          {/if}
          {#if podState.unhealthySince}
            <div class="mt-1 text-xs text-yellow-700">
              {$t('admin.machine_learning_runpod_pod_unresponsive', {
                values: { time: minutesAgo(podState.unhealthySince) },
              })}
            </div>
          {/if}
        </div>
        <div class="flex shrink-0 flex-col gap-1">
          {#if isRunning}
            <Button size="small" onclick={handleStop} disabled={stopping}>
              {stopping ? $t('admin.machine_learning_runpod_stopping') : $t('admin.machine_learning_runpod_stop')}
            </Button>
            <Button size="small" color="danger" onclick={handleTerminate} disabled={terminating}>
              {terminating
                ? $t('admin.machine_learning_runpod_terminating')
                : $t('admin.machine_learning_runpod_terminate')}
            </Button>
          {:else if isStopped}
            <Button size="small" onclick={handleStart} disabled={provisioning}>
              {provisioning
                ? $t('admin.machine_learning_runpod_resume_starting')
                : $t('admin.machine_learning_runpod_resume')}
            </Button>
            <Button size="small" color="danger" onclick={handleTerminate} disabled={terminating}>
              {terminating
                ? $t('admin.machine_learning_runpod_terminating')
                : $t('admin.machine_learning_runpod_terminate')}
            </Button>
          {:else if isServerlessReady}
            <Button size="small" color="secondary" onclick={handleServerlessSetup} disabled={endpointBusy}>
              {endpointBusy
                ? $t('admin.machine_learning_runpod_recreating')
                : $t('admin.machine_learning_runpod_recreate_endpoint')}
            </Button>
            <Button size="small" color="danger" onclick={handleServerlessTeardown} disabled={endpointBusy}>
              {endpointBusy
                ? $t('admin.machine_learning_runpod_tearing_down')
                : $t('admin.machine_learning_runpod_tear_down')}
            </Button>
          {:else if status === 'error'}
            {#if isServerlessMode}
              <Button size="small" color="danger" onclick={handleServerlessTeardown} disabled={endpointBusy}>
                {$t('admin.machine_learning_runpod_clear')}
              </Button>
            {:else}
              <Button size="small" color="danger" onclick={handleTerminate} disabled={terminating}>
                {$t('admin.machine_learning_runpod_clear_terminate')}
              </Button>
            {/if}
          {/if}
        </div>
      </div>

      {#if isTransitioning || isRunning || isServerlessReady}
        <div class="relative mt-3 h-6 w-full overflow-hidden rounded-full bg-immich-gray/20">
          {#if (isRunning || isServerlessReady) && workerReady}
            <div class="size-full bg-green-500 transition-all"></div>
          {:else}
            <!-- Indeterminate animated bar for any not-yet-live state:
                 provisioning, starting, stopping, serverless-provisioning,
                 OR serverless-ready while the worker is still cold-starting. -->
            <div class="runpod-boot-bar absolute inset-y-0 h-full w-1/3 rounded-full bg-yellow-400"></div>
          {/if}
          <div class="absolute inset-0 flex items-center justify-center text-xs font-medium">
            {#if (isRunning || isServerlessReady) && workerReady}
              <span class="text-green-900">{$t('admin.machine_learning_runpod_ready')}</span>
            {:else if isServerlessReady}
              <span class="text-yellow-900">{$t('admin.machine_learning_runpod_endpoint_ready')}</span>
            {:else if isRunning}
              <span class="text-yellow-900">{$t('admin.machine_learning_runpod_pod_initializing')}</span>
            {:else if status === 'serverless-provisioning'}
              <span class="text-yellow-900">{$t('admin.machine_learning_runpod_provisioning_serverless')}</span>
            {:else if status === 'provisioning'}
              <span class="text-yellow-900">{$t('admin.machine_learning_runpod_provisioning_pod')}</span>
            {:else if status === 'starting'}
              <span class="text-yellow-900">{$t('admin.machine_learning_runpod_resume_starting')}</span>
            {:else if status === 'stopping'}
              <span class="text-yellow-900">{$t('admin.machine_learning_runpod_stopping_pod')}</span>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {/if}

  {#if enabled && isServerlessMode && ['idle', 'error', 'serverless-provisioning'].includes(status)}
    <fieldset class="flex flex-col gap-3 rounded-sm border border-immich-gray/30 p-3" disabled={!apiKeyConfigured}>
      <legend class="px-1 text-sm font-semibold">
        {$t('admin.machine_learning_runpod_serverless_endpoint_legend')}
      </legend>

      {#if !apiKeyConfigured}
        <div class="text-sm text-yellow-700">
          <FormatMessage key="admin.machine_learning_runpod_set_api_key_first">
            {#snippet children({ tag, message })}
              {#if tag === 'strong'}<strong>{message}</strong>{:else}{message}{/if}
            {/snippet}
          </FormatMessage>
        </div>
      {:else}
        <p class="text-sm text-immich-gray">
          {$t('admin.machine_learning_runpod_serverless_endpoint_help')}
        </p>
      {/if}

      <label
        class="flex items-start gap-2 rounded-sm p-1 text-sm transition"
        class:ring-2={consentError}
        class:ring-red-500={consentError}
      >
        <input type="checkbox" bind:checked={consent} onchange={() => (consentError = false)} class="mt-0.5" />
        <span>
          {$t('admin.machine_learning_runpod_consent')}
        </span>
      </label>
      {#if consentError}
        <p class="-mt-2 text-xs text-red-600">{$t('admin.machine_learning_runpod_consent_required')}</p>
      {/if}

      <div class="flex justify-end gap-2">
        <Button size="small" color="secondary" onclick={handleTestConnection} disabled={testing}>
          {testing ? $t('admin.machine_learning_runpod_testing') : $t('admin.machine_learning_runpod_test_connection')}
        </Button>
        {#if isServerlessReady || status === 'serverless-provisioning'}
          <Button size="small" color="danger" onclick={handleServerlessTeardown} disabled={endpointBusy}>
            {endpointBusy
              ? $t('admin.machine_learning_runpod_terminating')
              : $t('admin.machine_learning_runpod_terminate')}
          </Button>
        {/if}
        <Button
          size="small"
          onclick={attemptServerlessLaunch}
          disabled={endpointBusy}
          title={consent ? undefined : $t('admin.machine_learning_runpod_consent_required_tooltip')}
        >
          {endpointBusy
            ? $t('admin.machine_learning_runpod_launch_button_launching')
            : $t('admin.machine_learning_runpod_serverless_launch_button')}
        </Button>
      </div>

      {#if testResult}
        <div class="text-xs" class:text-green-700={testResult.ok} class:text-red-700={!testResult.ok}>
          {testResult.ok
            ? $t('admin.machine_learning_runpod_connection_ok')
            : `Failed: ${testResult.message ?? 'unknown error'}`}
        </div>
      {/if}
    </fieldset>
  {/if}

  {#if enabled && isPodMode}
    {#if status === 'idle' || status === 'error'}
      <fieldset class="flex flex-col gap-3 rounded-sm border border-immich-gray/30 p-3" disabled={!apiKeyConfigured}>
        <legend class="px-1 text-sm font-semibold">{$t('admin.machine_learning_runpod_launch_pod_legend')}</legend>

        {#if !apiKeyConfigured}
          <div class="text-sm text-yellow-700">
            <FormatMessage key="admin.machine_learning_runpod_set_api_key_first_pod">
              {#snippet children({ tag, message })}
                {#if tag === 'strong'}<strong>{message}</strong>{:else}{message}{/if}
              {/snippet}
            </FormatMessage>
          </div>
        {/if}

        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="runpod-gpu-select">
            {$t('admin.machine_learning_runpod_gpu_type')}
          </label>
          <select id="runpod-gpu-select" bind:value={selectedGpu} class="rounded-sm border px-2 py-1 text-sm">
            {#if gpuLoading}
              <option value="">{$t('admin.machine_learning_runpod_gpu_loading')}</option>
            {:else if gpuTypes.length === 0}
              <option value={rp.defaultGpuTypeId}>
                {$t('admin.machine_learning_runpod_default_gpu_type_dropdown_placeholder', {
                  values: { gpu: rp.defaultGpuTypeId },
                })}
              </option>
            {:else}
              {#each gpuTypes as g (g.id)}
                <option value={g.id}
                  >{g.displayName} · {g.memoryInGb} GB{g.pricePerHour
                    ? ` · $${g.pricePerHour.toFixed(2)}/hr`
                    : ''}</option
                >
              {/each}
            {/if}
          </select>
          {#if gpuError}
            <span class="text-xs text-red-700">{gpuError}</span>
          {/if}
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="runpod-image-override">
            {$t('admin.machine_learning_runpod_container_image_override')}
          </label>
          <input
            id="runpod-image-override"
            type="text"
            bind:value={imageOverride}
            placeholder={rp.imageName}
            class="rounded-sm border px-2 py-1 font-mono text-sm"
          />
          <span class="text-xs text-immich-gray">
            {$t('admin.machine_learning_runpod_container_image_override_help')}
          </span>
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="runpod-max-hours">
            {$t('admin.machine_learning_runpod_max_hours_help')}
          </label>
          <input
            id="runpod-max-hours"
            type="number"
            min="1"
            max="168"
            bind:value={maxHoursOverride}
            placeholder={String(rp.maxRuntimeHours)}
            class="w-32 rounded-sm border px-2 py-1 text-sm"
          />
        </div>

        <label class="flex items-start gap-2 text-sm">
          <input type="checkbox" bind:checked={consent} class="mt-0.5" />
          <span>
            {$t('admin.machine_learning_runpod_consent_pod')}
          </span>
        </label>

        <div class="flex justify-end gap-2">
          <Button size="small" color="secondary" onclick={handleTestConnection} disabled={testing}>
            {testing
              ? $t('admin.machine_learning_runpod_testing')
              : $t('admin.machine_learning_runpod_test_connection')}
          </Button>
          <Button size="small" onclick={handleLaunch} disabled={provisioning || !consent || !selectedGpu}>
            {provisioning
              ? $t('admin.machine_learning_runpod_launch_button_launching')
              : $t('admin.machine_learning_runpod_launch_button')}
          </Button>
        </div>

        {#if testResult}
          <div class="text-xs" class:text-green-700={testResult.ok} class:text-red-700={!testResult.ok}>
            {testResult.ok
              ? $t('admin.machine_learning_runpod_connection_ok')
              : `Failed: ${testResult.message ?? 'unknown error'}`}
          </div>
        {/if}
      </fieldset>
    {/if}

    {#if isRunning}
      <div class="flex items-center gap-2">
        <Button size="small" onclick={handleBackfill} disabled={!canBackfill}>
          {backfilling
            ? $t('admin.machine_learning_runpod_run_backfill_enqueuing')
            : $t('admin.machine_learning_runpod_run_backfill')}
        </Button>
        <span class="text-xs text-immich-gray">
          {$t('admin.machine_learning_runpod_run_backfill_description')}
        </span>
      </div>
    {/if}

    <div class="rounded-sm border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-900">
      <FormatMessage key="admin.machine_learning_runpod_security_pod">
        {#snippet children({ tag, message })}
          {#if tag === 'strong'}<strong>{message}</strong>{:else if tag === 'code'}<code>{message}</code
            >{:else}{message}{/if}
        {/snippet}
      </FormatMessage>
    </div>
  {/if}

  {#if enabled && isServerlessMode && isServerlessReady}
    <div class="flex items-center gap-2">
      <Button size="small" onclick={handleBackfill} disabled={!canBackfill}>
        {backfilling
          ? $t('admin.machine_learning_runpod_run_backfill_enqueuing')
          : $t('admin.machine_learning_runpod_run_backfill')}
      </Button>
      <span class="text-xs text-immich-gray">
        {$t('admin.machine_learning_runpod_run_backfill_description_serverless')}
      </span>
    </div>

    <div class="rounded-sm border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
      <FormatMessage key="admin.machine_learning_runpod_security_serverless">
        {#snippet children({ tag, message })}
          {#if tag === 'strong'}<strong>{message}</strong>{:else}{message}{/if}
        {/snippet}
      </FormatMessage>
    </div>
  {/if}
</div>

<style>
  /* Indeterminate progress bar used during pod/endpoint boot transitions. */
  .runpod-boot-bar {
    animation: runpod-boot-slide 1.4s ease-in-out infinite;
  }
  @keyframes runpod-boot-slide {
    0% {
      left: -33%;
    }
    100% {
      left: 100%;
    }
  }
</style>
