<script lang="ts">
  import { MediaHealthCategory } from '@immich/sdk';
  import MediaHealthReview from '../MediaHealthReview.svelte';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
</script>

<MediaHealthReview
  category={MediaHealthCategory.Missing}
  initial={data.mediaHealth}
  initialStatus={data.status}
  title={data.meta.title}
/>
