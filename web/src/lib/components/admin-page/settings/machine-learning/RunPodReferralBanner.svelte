<script lang="ts">
  import { browser } from '$app/environment';
  import { t } from 'svelte-i18n';

  const STORAGE_KEY = 'immich.runpod.referralBannerDismissedAt';
  const REFERRAL_URL = 'https://runpod.io?ref=y1isyc1m';

  // Read synchronously from localStorage in the script body (guarded by
  // `browser` so SSR is safe). Avoids the previous `onMount` race that
  // flashed the banner visible for already-dismissed admins between mount
  // and the async fetch cycle for the admin panel.
  const initialDismissed = browser
    ? (() => {
        try {
          return Boolean(localStorage.getItem(STORAGE_KEY));
        } catch {
          // localStorage unavailable (private mode, etc.) — show the banner.
          return false;
        }
      })()
    : false;

  let dismissed = $state(initialDismissed);

  const handleDismiss = () => {
    dismissed = true;
    try {
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {
      // Ignore — dismissal is best-effort.
    }
  };
</script>

{#if !dismissed}
  <div
    class="relative overflow-hidden rounded-md border border-purple-300/50 bg-linear-to-br from-indigo-500 via-purple-500 to-pink-500 p-4 text-white shadow-md"
  >
    <button
      type="button"
      onclick={handleDismiss}
      aria-label={$t('admin.machine_learning_runpod_referral_banner_dismiss')}
      class="absolute top-2 right-2 rounded-full p-1 text-white/80 transition hover:bg-white/20 hover:text-white"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>

    <div class="flex flex-col gap-3 pr-8 sm:flex-row sm:items-center sm:gap-4">
      <div class="flex size-12 shrink-0 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
          <path d="M2 17l10 5 10-5"></path>
          <path d="M2 12l10 5 10-5"></path>
        </svg>
      </div>

      <div class="flex-1">
        <h3 class="text-base/tight font-semibold">{$t('admin.machine_learning_runpod_referral_banner_title')}</h3>
        <p class="mt-1 text-sm text-white/90">
          {$t('admin.machine_learning_runpod_referral_banner_subtitle')}
        </p>
      </div>

      <a
        href={REFERRAL_URL}
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex shrink-0 items-center justify-center gap-1.5 self-start rounded-full bg-white px-4 py-2 text-sm font-semibold text-purple-700 shadow-sm transition hover:bg-white/90 hover:shadow-sm sm:self-center"
      >
        {$t('admin.machine_learning_runpod_referral_banner_signup')}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <line x1="7" y1="17" x2="17" y2="7"></line>
          <polyline points="7 7 17 7 17 17"></polyline>
        </svg>
      </a>
    </div>
  </div>
{/if}
