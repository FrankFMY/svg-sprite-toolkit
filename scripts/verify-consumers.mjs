import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const output = join(root, '.qualification', `ci-consumers-${Date.now()}`);
mkdirSync(output, { recursive: true });
// Do not inherit optional peers from the development checkout's node_modules.
const work = realpathSync(mkdtempSync(join(tmpdir(), 'svg-sprite-consumers-')));
const report = { status: 'running', commands: [], work, output };
let sequence = 0;
function run(cwd, command, args, expected = 0) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 ** 2 });
  const log = join(output, `${++sequence}.log`);
  writeFileSync(log, `${result.stdout ?? ''}${result.stderr ?? ''}`);
  process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
  report.commands.push({ command, args, cwd, exit: result.status, expected, log });
  if (result.error) throw result.error;
  assert.equal(result.signal, null);
  assert.equal(result.status, expected, `Consumer command failed; see ${log}`);
  return result.stdout + result.stderr;
}
function json(path, value) { writeFileSync(path, JSON.stringify(value, null, 2) + '\n'); }
function install(name, tools) {
  const directory = join(work, name); mkdirSync(directory);
  json(join(directory, 'package.json'), {
    name: `svg-${name}-consumer`, private: true, type: 'module',
    dependencies: { [manifest.name]: `file:${report.artifact}` }, devDependencies: tools,
  });
  run(directory, 'npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund']);
  const installed = join(directory, 'node_modules', manifest.name);
  assert(realpathSync(installed).startsWith(directory + '/'), 'consumer must install release bytes');
  assert.equal(readFileSync(join(installed, 'package.json'), 'utf8'), readFileSync(join(root, 'package.json'), 'utf8'));
  return directory;
}
try {
  const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', output], { cwd: root, encoding: 'utf8' }));
  const artifact = Array.isArray(packed) ? packed[0] : packed[manifest.name];
  assert.equal(artifact.name, manifest.name); assert.equal(artifact.version, manifest.version);
  report.artifact = join(output, artifact.filename);
  report.sha256 = createHash('sha256').update(readFileSync(report.artifact)).digest('hex');
  const compiler = install('compiler', { typescript: manifest.devDependencies.typescript });
  cpSync(join(root, 'fixtures/consumers/compiler'), compiler, { recursive: true });
  cpSync(join(root, 'fixtures/consumers/vite/artwork'), join(compiler, 'artwork'), { recursive: true });
  cpSync(join(root, 'fixtures/consumers/vite/icons.json'), join(compiler, 'icons.json'));
  assert(!existsSync(join(compiler, 'node_modules/@types/node')), 'minimal declarations must not require Node ambient types');
  for (const peer of ['svelte', 'vite']) assert(!existsSync(join(compiler, 'node_modules', peer)));
  json(join(compiler, 'tsconfig.json'), { compilerOptions: {
    target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
    exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, skipLibCheck: false, noEmit: true,
  }, include: ['types.ts', 'generated/*.ts'] });
  run(compiler, 'node', ['runtime.mjs']);
  run(compiler, 'bun', ['--no-env-file', 'runtime.mjs']);
  run(compiler, 'node', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json']);
  const tools = Object.fromEntries(['@sveltejs/vite-plugin-svelte', '@types/node', 'playwright', 'svelte', 'svelte-check', 'typescript', 'vite'].map((name) => [name, manifest.devDependencies[name]]));
  const vite = install('vite', tools);
  cpSync(join(root, 'fixtures/consumers/vite'), vite, { recursive: true });
  mkdirSync(join(vite, 'screenshots'));
  run(vite, 'node', ['node_modules/vite/bin/vite.js', 'build']);
  run(vite, 'node', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json']);
  run(vite, 'node', ['node_modules/svelte-check/bin/svelte-check', '--tsconfig', 'tsconfig.json']);
  const source = readFileSync(join(vite, 'artwork/source.svg'), 'utf8');
  const selection = readFileSync(join(vite, 'icons.json'), 'utf8');
  const negative = join(vite, 'src/Negative.svelte');
  try {
    writeFileSync(negative, `<script lang="ts">
import Icon from '@frankfmy/svg-sprite-toolkit/Icon.svelte';
import type { IconKey } from './generated/icon-keys.js';
const bad: IconKey = 'missing';
const good: IconKey = 'circle';
</script>
<Icon key={bad} width={true}/>
<Icon key={good}/>
`);
    const diagnostics = run(vite, 'node', ['node_modules/svelte-check/bin/svelte-check', '--tsconfig', 'tsconfig.json'], 1);
    assert.match(diagnostics, /missing/); assert.match(diagnostics, /spriteUrl/);
    assert.match(diagnostics, /Type 'true' is not assignable to type 'string \| number \| undefined'/);
    assert.match(diagnostics, /svelte-check found 3 errors and 0 warnings/);
    rmSync(negative);
    for (const [kind, value] of [
      ['selection', '{"keys":[]}'], ['selection', '{"keys":{"missing":true}}'],
      ['source', source.replace('<circle', '<circle onload="alert(1)"')],
      ['missing-selection', null], ['missing-source', null],
    ]) {
      writeFileSync(join(vite, 'artwork/source.svg'), source); writeFileSync(join(vite, 'icons.json'), selection);
      const before = readFileSync(join(vite, 'generated/icons.svg'));
      if (kind === 'selection') writeFileSync(join(vite, 'icons.json'), value);
      else if (kind === 'source') writeFileSync(join(vite, 'artwork/source.svg'), value);
      else rmSync(join(vite, kind === 'missing-selection' ? 'icons.json' : 'artwork/source.svg'));
      run(vite, 'node', ['node_modules/vite/bin/vite.js', 'build'], 1);
      assert.deepEqual(readFileSync(join(vite, 'generated/icons.svg')), before);
    }
  } finally {
    rmSync(negative, { force: true });
    writeFileSync(join(vite, 'artwork/source.svg'), source); writeFileSync(join(vite, 'icons.json'), selection);
  }
  run(vite, 'node', ['node_modules/vite/bin/vite.js', 'build']);
  run(vite, 'node', ['verify.mjs']);
  run(vite, 'node', ['verify-refs.mjs']);
  cpSync(join(vite, 'screenshots'), join(output, 'screenshots'), { recursive: true });
  for (const name of ['verification-results.json', 'reference-results.json']) cpSync(join(vite, name), join(output, name));
  report.status = 'passed';
  console.log('SVG_INSTALLED_CONSUMERS_PASS', output);
} catch (error) {
  report.status = 'failed'; report.error = String(error.stack ?? error); throw error;
} finally {
  rmSync(work, { recursive: true, force: true });
  report.cleanupComplete = !existsSync(work);
  json(join(output, 'report.json'), report);
}
