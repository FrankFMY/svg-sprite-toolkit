import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { build } from 'vite';
import { viteSvgSprite } from '../src/vite.js';

// Vite intentionally normalizes relative bases to '/' for SSR builds.
for (const [base, expected] of [['/demo/', '/demo/assets/icons.svg'], ['./', '/assets/icons.svg'], ['https://cdn.example.invalid/ui/', 'https://cdn.example.invalid/ui/assets/icons.svg']] as const) {
  test(`SSR sprite URL is a public asset reference for base ${base}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'svg-ssr-url-'));
    try {
      await mkdir(join(root, 'generated'));
      await writeFile(join(root, 'package.json'), '{"type":"module"}');
      await writeFile(join(root, 'entry.js'), "export { spriteUrl } from 'virtual:svg-sprite';");
      await writeFile(join(root, 'source.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="dot" viewBox="0 0 8 8"><circle cx="4" cy="4" r="2"/></symbol></svg>');
      await writeFile(join(root, 'selection.json'), '{"keys":{"dot":true}}');
      await build({
        configFile: false, root, base, logLevel: 'silent',
        plugins: [viteSvgSprite({ source: 'source.svg', selection: 'selection.json', output: 'generated/icons.svg', types: 'generated/keys.ts', schema: 'generated/schema.json', fileName: 'assets/icons.svg' })],
        build: { ssr: join(root, 'entry.js'), outDir: 'server' },
      });
      const emitted = await import(pathToFileURL(join(root, 'server/entry.js')).href) as { spriteUrl: string };
      assert.equal(emitted.spriteUrl, expected);
      assert.doesNotMatch(await readFile(join(root, 'server/entry.js'), 'utf8'), /file:\/\//u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
