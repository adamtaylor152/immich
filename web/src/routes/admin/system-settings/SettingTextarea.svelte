<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from 'svelte-i18n';
  import { quintOut } from 'svelte/easing';
  import { fly } from 'svelte/transition';

  interface Props {
    value: string;
    label?: string;
    description?: string;
    required?: boolean;
    disabled?: boolean;
    isEdited?: boolean;
    descriptionSnippet?: Snippet;
    onChange?: (value: string) => void;
  }

  let {
    value = $bindable(),
    label = '',
    description = '',
    required = false,
    disabled = false,
    isEdited = false,
    descriptionSnippet,
    onChange,
  }: Props = $props();

  // The previous implementation used the (translated) `label` as the DOM id,
  // which collides whenever the same label string appears more than once
  // (e.g. the NSFW indicators label used as accordion title AND nested
  // textarea label). Duplicate ids are invalid HTML and break for/labelledby
  // resolution. Use `crypto.randomUUID()` so each mount has its own id.
  const uniqueId =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `setting-textarea-${Math.random().toString(36).slice(2)}`;
  const descId = description ? `${uniqueId}-desc` : undefined;

  // The handler intentionally only calls onChange — letting the parent's
  // bind: (or `value=`) own the assignment. Previously this also did
  // `value = next`, which double-wrote when the parent passed `bind:value`
  // (race) and dead-wrote when the parent passed only `value=` (the parent's
  // next $derived recalc clobbered it on the next reactive tick). Callers
  // should pick exactly one of `bind:value` or `onChange`.
  const handleInput = (e: Event) => {
    const next = (e.target as HTMLInputElement).value;
    if (onChange) {
      onChange(next);
    } else {
      value = next;
    }
  };
</script>

<div class="mb-4 w-full">
  <div class="flex h-6.5 place-items-center gap-1">
    <label class="text-sm font-medium text-primary" for={uniqueId}>{label}</label>
    {#if required}
      <div class="text-red-400">*</div>
    {/if}

    {#if isEdited}
      <div
        transition:fly={{ x: 10, duration: 200, easing: quintOut }}
        class="rounded-full bg-orange-100 px-2 text-[10px] text-orange-900"
      >
        {$t('unsaved_change')}
      </div>
    {/if}
  </div>

  {#if description}
    <p class="pb-2 text-sm immich-form-label" id={descId}>
      {description}
    </p>
  {:else}
    {@render descriptionSnippet?.()}
  {/if}

  <textarea
    class="immich-form-input w-full pb-2"
    aria-describedby={descId}
    id={uniqueId}
    name={uniqueId}
    {required}
    {value}
    oninput={handleInput}
    {disabled}
  ></textarea>
</div>
