<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    listGpus as listRunPodGpus,
    provision as provisionRunPodPod,
    start as startRunPodPod,
    stop as stopRunPodPod,
    terminate as terminateRunPodPod,
    testConnection as testRunPodConnection,
    type RunPodGpuTypeDto,
    type RunPodProvisionDto,
    type RunPodStateDto,
  } from '@immich/sdk';
  import { systemConfigManager } from '$lib/managers/system-config-manager.svelte';
  import { handleError } from '$lib/utils/handle-error';
  import { Button, toastManager } from '@immich/ui';

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
      throw new Error(`Failed to enqueue backfill (${response.status})`);
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
  const enabled = $derived(config.machineLearning.enabled && rp.enabled);
  const apiKeyConfigured = $derived(rp.apiKey.length > 0);
  const status = $derived(podState?.status ?? 'idle');
  const isTransitioning = $derived(['provisioning', 'starting', 'stopping'].includes(status));
  const isRunning = $derived(status === 'running');
  const isStopped = $derived(status === 'stopped');
  const canBackfill = $derived(isRunning && !backfilling);

  // The poll fires every 5s; a transient API blip should not spam toast
  // notifications. Only surface an error once per consecutive failure streak,
  // and clear the flag on the first successful refresh.
  let pollErrorShown = $state(false);

  const refresh = async (options: { notifyOnError?: boolean } = {}) => {
    const notify = options.notifyOnError ?? true;
    try {
      podState = await fetchCurrent();
      pollErrorShown = false;
    } catch (error) {
      if (notify && !pollErrorShown) {
        handleError(error, 'Failed to load RunPod state');
        pollErrorShown = true;
      } else if (!notify) {
        console.debug('RunPod state poll failed:', error);
      }
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
        toastManager.primary('RunPod connection OK');
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
      toastManager.warning('Please acknowledge the data-privacy notice first.');
      return;
    }
    if (!selectedGpu) {
      toastManager.warning('Pick a GPU type first.');
      return;
    }
    provisioning = true;
    try {
      const dto: RunPodProvisionDto = {
        gpuTypeId: selectedGpu,
        acknowledgeDataPrivacy: true,
        ...(imageOverride.trim() ? { imageName: imageOverride.trim() } : {}),
        ...(maxHoursOverride ? { maxRuntimeHours: maxHoursOverride } : {}),
      };
      podState = await provisionRunPodPod({ runPodProvisionDto: dto });
      toastManager.info('Pod launching. This usually takes 2–3 minutes.');
    } catch (error) {
      handleError(error, 'Failed to launch pod');
    } finally {
      provisioning = false;
    }
  };

  const handleStop = async () => {
    stopping = true;
    try {
      podState = await stopRunPodPod();
      toastManager.info('Stop requested');
    } catch (error) {
      handleError(error, 'Failed to stop pod');
    } finally {
      stopping = false;
    }
  };

  const handleStart = async () => {
    provisioning = true;
    try {
      podState = await startRunPodPod();
      toastManager.info('Resuming pod');
    } catch (error) {
      handleError(error, 'Failed to resume pod');
    } finally {
      provisioning = false;
    }
  };

  const handleTerminate = async () => {
    if (
      !confirm('Terminate destroys the pod and its model cache. The next launch will be a full cold-start. Continue?')
    ) {
      return;
    }
    terminating = true;
    try {
      podState = await terminateRunPodPod();
      toastManager.primary('Pod terminated');
    } catch (error) {
      handleError(error, 'Failed to terminate pod');
    } finally {
      terminating = false;
    }
  };

  const handleBackfill = async () => {
    backfilling = true;
    try {
      const result = await runBackfill();
      toastManager.info(
        `Enqueued: ${result.enqueued.join(', ') || 'nothing'}${result.skipped.length > 0 ? ` · skipped: ${result.skipped.join(', ')}` : ''}`,
      );
    } catch (error) {
      handleError(error, 'Failed to enqueue backfill');
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
      return 'just now';
    }
    if (m < 60) {
      return `${m} min ago`;
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
        Cloud GPU provisioning is off. Enable machine learning above, then turn on
        <strong>Enable RunPod integration</strong> in this section to activate it.
      </p>
    </div>
  {/if}

  {#if podState}
    <div class="rounded-sm border border-immich-gray/20 bg-immich-bg/30 p-3">
      <div class="flex items-start justify-between gap-4">
        <div>
          <div class="flex items-center gap-2">
            <span class="font-semibold">Status:</span>
            <span
              class="rounded-sm px-2 py-0.5 font-mono text-xs tracking-wide uppercase"
              class:bg-green-200={isRunning}
              class:text-green-900={isRunning}
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
            <div class="mt-1 font-mono text-xs text-immich-gray">pod: {podState.podId}</div>
          {/if}
          {#if podState.imageName}
            <div class="mt-1 text-xs break-all text-immich-gray">image: {podState.imageName}</div>
          {/if}
          {#if podState.gpuTypeId}
            <div class="mt-1 text-xs text-immich-gray">gpu: {podState.gpuTypeId}</div>
          {/if}
          {#if podState.mlUrl}
            <div class="mt-1 font-mono text-xs break-all text-immich-gray">url: {podState.mlUrl}</div>
          {/if}
          {#if podState.runningSince}
            <div class="mt-1 text-xs text-immich-gray">running since: {minutesAgo(podState.runningSince)}</div>
          {/if}
          {#if podState.lastBusyAt && isRunning}
            <div class="mt-1 text-xs text-immich-gray">last ML job: {minutesAgo(podState.lastBusyAt)}</div>
          {/if}
          {#if isRunning}
            {@const cost = formatCost(podState)}
            {#if cost}
              <div class="mt-1 text-xs text-immich-gray">estimated cost: {cost}</div>
            {/if}
          {/if}
          {#if podState.stoppedAt}
            <div class="mt-1 text-xs text-immich-gray">stopped: {minutesAgo(podState.stoppedAt)}</div>
          {/if}
          {#if podState.errorMessage}
            <div class="mt-2 text-xs wrap-break-word text-red-700">{podState.errorMessage}</div>
          {/if}
          {#if podState.unhealthySince}
            <div class="mt-1 text-xs text-yellow-700">pod unresponsive since {minutesAgo(podState.unhealthySince)}</div>
          {/if}
        </div>
        <div class="flex shrink-0 flex-col gap-1">
          {#if isRunning}
            <Button size="small" onclick={handleStop} disabled={stopping}>{stopping ? 'Stopping…' : 'Stop'}</Button>
            <Button size="small" color="danger" onclick={handleTerminate} disabled={terminating}>
              {terminating ? 'Terminating…' : 'Terminate'}
            </Button>
          {:else if isStopped}
            <Button size="small" onclick={handleStart} disabled={provisioning}
              >{provisioning ? 'Starting…' : 'Resume'}</Button
            >
            <Button size="small" color="danger" onclick={handleTerminate} disabled={terminating}>
              {terminating ? 'Terminating…' : 'Terminate'}
            </Button>
          {:else if status === 'error'}
            <Button size="small" color="danger" onclick={handleTerminate} disabled={terminating}>
              Clear / terminate
            </Button>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  {#if enabled}
    {#if status === 'idle' || status === 'error'}
      <fieldset class="flex flex-col gap-3 rounded-sm border border-immich-gray/30 p-3" disabled={!apiKeyConfigured}>
        <legend class="px-1 text-sm font-semibold">Launch new pod</legend>

        {#if !apiKeyConfigured}
          <div class="text-sm text-yellow-700">
            Set <strong>API key</strong> below and click <strong>Test connection</strong> first.
          </div>
        {/if}

        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="runpod-gpu-select">GPU type</label>
          <select id="runpod-gpu-select" bind:value={selectedGpu} class="rounded-sm border px-2 py-1 text-sm">
            {#if gpuLoading}
              <option value="">Loading…</option>
            {:else if gpuTypes.length === 0}
              <option value={rp.defaultGpuTypeId}
                >{rp.defaultGpuTypeId} (default — click Test connection to refresh)</option
              >
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
          <label class="text-sm font-medium" for="runpod-image-override">Container image (override)</label>
          <input
            id="runpod-image-override"
            type="text"
            bind:value={imageOverride}
            placeholder={rp.imageName}
            class="rounded-sm border px-2 py-1 font-mono text-sm"
          />
          <span class="text-xs text-immich-gray">Leave blank to use the configured default.</span>
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="runpod-max-hours">Max runtime override (hours)</label>
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
            I understand that image previews will be sent to RunPod (an external service) and that the configured API
            key can spin up paid infrastructure.
          </span>
        </label>

        <div class="flex justify-end gap-2">
          <Button size="small" color="secondary" onclick={handleTestConnection} disabled={testing}>
            {testing ? 'Testing…' : 'Test connection'}
          </Button>
          <Button size="small" onclick={handleLaunch} disabled={provisioning || !consent || !selectedGpu}>
            {provisioning ? 'Launching…' : 'Launch pod'}
          </Button>
        </div>

        {#if testResult}
          <div class="text-xs" class:text-green-700={testResult.ok} class:text-red-700={!testResult.ok}>
            {testResult.ok ? 'Connection OK' : `Failed: ${testResult.message ?? 'unknown error'}`}
          </div>
        {/if}
      </fieldset>
    {/if}

    {#if isRunning}
      <div class="flex items-center gap-2">
        <Button size="small" onclick={handleBackfill} disabled={!canBackfill}>
          {backfilling ? 'Enqueuing…' : 'Run ML backfill now'}
        </Button>
        <span class="text-xs text-immich-gray">
          Queues smart search, face detection, OCR, duplicates, image description, and NSFW detection for every eligible
          asset.
        </span>
      </div>
    {/if}

    <div class="rounded-sm border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-900">
      <strong>Security:</strong> The pod's URL is reachable from the public internet. Immich protects it with a
      per-launch bearer token (the server sends <code>Authorization: Bearer ...</code> on every request). Unauthenticated
      requests get a 401. Stopping a pod releases the GPU but keeps the model cache for fast resume.
    </div>
  {/if}
</div>
