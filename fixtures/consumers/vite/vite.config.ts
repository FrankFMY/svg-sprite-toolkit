import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSvgSprite } from '@frankfmy/svg-sprite-toolkit/vite';
export default defineConfig({
 base:'/demo/',
 plugins:[viteSvgSprite({source:'artwork/source.svg',selection:'icons.json',output:'generated/icons.svg',types:'src/generated/icon-keys.ts',schema:'generated/schema.json',fileName:'assets/icons.svg'}),svelte()],
});
