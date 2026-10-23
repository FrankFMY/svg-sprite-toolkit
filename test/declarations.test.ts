import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

test('compiler config declarations do not require ambient Node types', async () => {
  const directory = resolve('.qualification/unit');
  await mkdir(directory, { recursive: true });
  const root = await mkdtemp(`${directory}/declaration-`);
  try {
    await writeFile(`${root}/package.json`, JSON.stringify({ private: true, type: 'module' }));
    const config = ts.readConfigFile(resolve('tsconfig.json'), ts.sys.readFile);
    assert.equal(config.error, undefined);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
    assert.deepEqual(parsed.errors, []);
    const producer = ts.createProgram([resolve('src/internal/__config.ts')], {
      ...parsed.options,
      noEmit: false,
      declaration: true,
      emitDeclarationOnly: true,
      declarationMap: false,
      sourceMap: false,
      rootDir: resolve('src'),
      outDir: root,
    });
    const describe = (errors: readonly ts.Diagnostic[]) => errors.map((error) =>
      `${error.code}: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`);
    assert.deepEqual(describe(ts.getPreEmitDiagnostics(producer)), []);
    const emitted = producer.emit();
    assert.equal(emitted.emitSkipped, false);
    assert.deepEqual(describe(emitted.diagnostics), []);
    const consumer = `${root}/consumer.ts`;
    await writeFile(consumer, "import type { IconsConfig } from './internal/__config.js';\nconst config: IconsConfig = { source: 'source.svg', selection: 'selection.json', output: 'icons.svg', types: 'keys.ts', schema: 'schema.json' };\nvoid config;\n");
    const program = ts.createProgram([consumer], {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      skipLibCheck: false,
      noEmit: true,
      types: [],
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    });
    assert.deepEqual(describe(ts.getPreEmitDiagnostics(program)), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
