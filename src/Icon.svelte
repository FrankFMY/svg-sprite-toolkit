<script lang="ts">
  import type { IconProps } from './Icon.svelte.d.js';

  const { key, spriteUrl, title, class: className, style, width = '1em', height = '1em' }: IconProps = $props();
  const href = $derived(`${spriteUrl}#${encodeURIComponent(key)}`);
</script>

<svg {width} {height} class={className} {style} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
  {#if title}<title>{title}</title>{/if}
  <use {href} />
</svg>
