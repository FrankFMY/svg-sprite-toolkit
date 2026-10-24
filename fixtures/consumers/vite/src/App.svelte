<script lang="ts">
 import Icon from '@frankfmy/svg-sprite-toolkit/Icon.svelte';
 import { spriteUrl } from 'virtual:svg-sprite';
 import type { IconKey } from './generated/icon-keys.js';
 const keys = ['circle','square','triangle'] as const satisfies readonly IconKey[];
</script>
<main>
 <h1>Geometry fixture</h1>
 {#each keys as key}<div data-icon={key}><Icon {key} {spriteUrl} title={key} width={96} height={96}/><span>{key}</span></div>{/each}
 <div data-icon="decorative"><Icon key="circle" {spriteUrl}/></div>
</main>
<style>
 :global(body){margin:24px;font-family:system-ui;background:white;color:#222}
 main{display:flex;gap:24px;align-items:center;flex-wrap:wrap;max-width:640px}
 h1{width:100%;font-size:24px}div{display:flex;flex-direction:column;align-items:center;gap:8px}
</style>
