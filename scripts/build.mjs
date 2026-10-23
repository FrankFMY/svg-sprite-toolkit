import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc'], { stdio: 'inherit' });
await mkdir('dist', { recursive: true });
await copyFile('src/Icon.svelte.d.ts', 'dist/Icon.svelte.d.ts');
await copyFile('src/client.d.ts', 'dist/client.d.ts');
