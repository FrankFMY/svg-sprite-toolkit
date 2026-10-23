import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { link, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';
import { Icons } from '../src/compiler.js';
import type { IconsConfig } from '../src/compiler.js';
import { viteSvgSprite } from '../src/vite.js';

const directory = resolve('.qualification/unit');
await mkdir(directory, { recursive: true });
const roots: string[] = [];
after(async () => { await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))); });
const wrap = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
const circle = (id: string) => `<symbol id="${id}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></symbol>`;
async function fixture(body = circle('circle'), selection: unknown = { keys: { circle: true } }) {
  const root = await mkdtemp(`${directory}/case-`); roots.push(root);
  const config: IconsConfig = { source: `${root}/source.svg`, selection: `${root}/selection.json`, output: `${root}/generated/icons.svg`, types: `${root}/generated/keys.ts`, schema: `${root}/generated/schema.json` };
  await writeFile(config.source, wrap(body)); await writeFile(config.selection, JSON.stringify(selection));
  return { root, config, icons: new Icons(config) };
}
test('build writes real selected symbols, viewBoxes and full key artifacts in code-unit order', async () => {
  const { icons, config } = await fixture(circle('z') + circle('a') + circle('Z'), { keys: { z: false, a: true, Z: true } });
  const result = await icons.build();
  assert.deepEqual(result.keys, ['Z', 'a', 'z']); assert.deepEqual(result.selected, ['Z', 'a']);
  assert.deepEqual(result.included, ['Z', 'a']); assert.match(result.svg, /viewBox="0 0 24 24"/u);
  assert.ok(result.svg.indexOf('id="Z"') < result.svg.indexOf('id="a"')); assert.doesNotMatch(result.svg, /id="z"/u);
  assert.equal(result.bytes, Buffer.byteLength(result.svg)); assert.equal(await readFile(config.output, 'utf8'), result.svg);
  const types = await readFile(config.types, 'utf8'); assert.match(types, /"Z" \| "a" \| "z"/u);
  const schema = JSON.parse(await readFile(config.schema, 'utf8'));
  assert.equal(schema.additionalProperties, false); assert.equal(schema.properties.keys.additionalProperties, false);
  assert.deepEqual(Object.keys(schema.properties.keys.properties), ['Z', 'a', 'z']);
});
test('integer-like IDs also use code-unit order in schema source', async () => {
  const { icons, config } = await fixture(circle('2') + circle('10'), { keys: { '2': true, '10': true } });
  const result = await icons.build();
  assert.deepEqual(result.keys, ['10', '2']);
  assert.ok(result.svg.indexOf('id="10"') < result.svg.indexOf('id="2"'));
  const schema = await readFile(config.schema, 'utf8');
  assert.ok(schema.indexOf('"10"') < schema.indexOf('"2"'));
  assert.deepEqual(JSON.parse(schema).properties.keys.properties['10'], { type: 'boolean' });
});
test('unchanged input is byte deterministic and does not rewrite files', async () => {
  const { icons, config } = await fixture(); const first = await icons.build(); const time = (await stat(config.output)).mtimeMs;
  assert.deepEqual(await icons.build(), first); assert.equal((await stat(config.output)).mtimeMs, time);
});
test('sync bootstraps without selection and empty source produces never', async () => {
  const { icons, config } = await fixture('', { keys: {} }); await rm(config.selection);
  assert.deepEqual(await icons.sync(), { keys: [] }); assert.match(await readFile(config.types, 'utf8'), /IconKey = never;/u);
  await assert.rejects(stat(config.output), { code: 'ENOENT' });
});
test('empty selection and empty source both create valid deterministic empty SVG', async () => {
  for (const body of ['', circle('circle')]) {
    const { icons } = await fixture(body, { keys: {} }); const result = await icons.build();
    assert.deepEqual(result.selected, []); assert.deepEqual(result.included, []);
    assert.equal(result.svg, '<svg xmlns="http://www.w3.org/2000/svg"><defs/></svg>\n');
  }
});
test('local definitions, nested references, cross-symbol and xlink IDs survive optimization', async () => {
  const body = '<defs><g id="geometry"><circle id="dot" cx="12" cy="12" r="8"/></g><g id="unused"><use href="#square"/></g></defs>' +
    '<symbol id="circle" viewBox="0 0 24 24"><use href="#dot"/></symbol>' +
    '<symbol id="square" viewBox="0 0 24 24"><rect width="24" height="24"/></symbol>' +
    '<symbol id="triangle" viewBox="0 0 24 24"><use href="#circle"/></symbol>';
  const { icons, config } = await fixture(body, { keys: { triangle: true } });
  const result = await icons.build(); assert.deepEqual(result.included, ['circle', 'triangle']);
  assert.match(result.svg, /id="geometry"/u); assert.match(result.svg, /id="dot"/u); assert.doesNotMatch(result.svg, /id="unused"|id="square"/u);
  await writeFile(config.source, '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><circle id="dot" r="1"/></defs><symbol id="triangle" viewBox="0 0 2 2"><use xlink:href="#dot"/></symbol></svg>');
  assert.match((await icons.build()).svg, /href="#dot"/u);
});
test('malicious TypeScript-looking IDs are encoded as a single type literal', async () => {
  const id = 'x";type.P=never;const.q="\\';
  const { icons, config } = await fixture(circle(id.replaceAll('&', '&amp;').replaceAll('"', '&quot;')), { keys: { [id]: true } });
  await icons.build(); const text = await readFile(config.types, 'utf8');
  const ast = ts.createSourceFile('keys.ts', text, ts.ScriptTarget.Latest, true);
  assert.equal(ast.statements.length, 1); assert.ok(ts.isTypeAliasDeclaration(ast.statements[0]!));
  const declaration = ast.statements[0]; assert.ok(ts.isTypeAliasDeclaration(declaration!));
  assert.ok(ts.isLiteralTypeNode(declaration.type)); assert.ok(ts.isStringLiteral(declaration.type.literal));
  assert.equal(declaration.type.literal.text, id);
});
test('prototype-like IDs are ordinary keys', async () => {
  const { icons, config } = await fixture(circle('__proto__'), JSON.parse('{"keys":{"__proto__":true}}'));
  assert.deepEqual((await icons.build()).selected, ['__proto__']);
  const schema = JSON.parse(await readFile(config.schema, 'utf8')); assert.deepEqual(schema.properties.keys.properties.__proto__, { type: 'boolean' });
});
const invalidSelections = [null, [], {}, { keys: [] }, { keys: 'bad' }, { keys: { circle: 'yes' } }, { keys: { circle: 1 } }, { keys: {}, extra: true }, { keys: {}, $schema: 3 }, { keys: { missing: true } }, { keys: { missing: false } }];
for (const [index, value] of invalidSelections.entries()) test(`invalid selection ${index} fails before writes`, async () => {
  const { icons, config } = await fixture(undefined, value); await assert.rejects(icons.build()); await assert.rejects(stat(config.output), { code: 'ENOENT' });
});
for (const field of ['source', 'selection'] as const) test(`missing ${field} is a clear error`, async () => {
  const { icons, config } = await fixture(); await rm(config[field]); await assert.rejects(icons.build(), /Cannot read input file/u);
});
test('invalid JSON does not replace an existing output and the queue recovers', async () => {
  const { icons, config } = await fixture(); const good = await icons.build(); await writeFile(config.selection, '{');
  await assert.rejects(icons.build(), /Invalid selection JSON/u); assert.equal(await readFile(config.output, 'utf8'), good.svg);
  await writeFile(config.selection, '{"keys":{}}'); assert.deepEqual((await icons.build()).selected, []);
});
const invalidSvg = [
  ['missing ID', '<symbol><circle r="1"/></symbol>'], ['empty ID', circle('')], ['duplicate symbol', circle('a') + circle('a')],
  ['duplicate geometry ID', '<symbol id="circle"><circle id="same" r="1"/><rect id="same" width="1" height="1"/></symbol>'],
  ['script', '<symbol id="circle"><script>alert(1)</script></symbol>'], ['event handler', '<symbol id="circle" onload="alert(1)"><circle r="1"/></symbol>'],
  ['encoded event handler', '<symbol id="circle"><circle r="1" onload="&#97;lert(1)"/></symbol>'],
  ['style', '<symbol id="circle"><circle style="fill:url(https://example.invalid/x)" r="1"/></symbol>'],
  ['image URL', '<symbol id="circle"><image href="https://example.invalid/x"/></symbol>'],
  ['foreign object', '<symbol id="circle"><foreignObject/></symbol>'], ['animation', '<symbol id="circle"><animate attributeName="href"/></symbol>'],
  ['external use', '<symbol id="circle"><use href="https://example.invalid/x#x"/></symbol>'],
  ['script URL', '<symbol id="circle"><use href="javascript:alert(1)"/></symbol>'],
  ['encoded script URL', '<symbol id="circle"><use href="java&#115;cript:alert(1)"/></symbol>'],
  ['data URL', '<symbol id="circle"><use href="data:image/svg+xml,bad"/></symbol>'],
  ['paint URL', '<symbol id="circle"><circle fill="url(#x)" r="1"/></symbol>'],
  ['encoded paint URL', '<symbol id="circle"><circle fill="&#117;rl(https://example.invalid/x)" r="1"/></symbol>'],
  ['missing use target', '<symbol id="circle"><use href="#absent"/></symbol>'],
  ['recursive use', '<symbol id="circle"><use href="#circle"/></symbol>'],
  ['mutual recursive use', '<symbol id="circle"><use href="#square"/></symbol><symbol id="square"><use href="#circle"/></symbol>'],
  ['missing use href', '<symbol id="circle"><use/></symbol>'],
  ['unknown attribute', '<symbol id="circle" data-value="x"/>'], ['invalid viewBox', '<symbol id="circle" viewBox="0 0 -1 1"/>'],
  ['nonfinite number', '<symbol id="circle"><circle r="1e999"/></symbol>'], ['negative radius', '<symbol id="circle"><circle r="-1"/></symbol>'],
  ['invalid transform', '<symbol id="circle" transform="translate(alert(1))"/>'],
  ['invalid point pair', '<symbol id="circle"><polygon points="0 1 2"/></symbol>'],
  ['text outside title', '<symbol id="circle">text</symbol>'],
  ['nested markup title', '<symbol id="circle"><title><g/></title></symbol>'],
  ['XML processing instruction', '<?xml-stylesheet href="https://example.invalid/x"?><symbol id="circle"/>'],
  ['whitespace ID', circle('bad id')], ['fragment ID', circle('bad#id')], ['invalid namespace', '<symbol xmlns="http://www.w3.org/1999/xhtml" id="circle"/>'],
  ['nested symbol', '<symbol id="circle"><symbol id="nested"/></symbol>'], ['malformed XML', '<symbol id="circle">'],
];
for (const [name, body] of invalidSvg) test(`rejects ${name}`, async () => {
  const { icons } = await fixture(body); await assert.rejects(icons.build(), /Invalid sprite/u);
});
for (const prefix of ['<!DOCTYPE svg SYSTEM "file:///does-not-exist">', '<!DOCTYPE svg [<!ENTITY x "owned">]>']) test(`rejects XML declaration ${prefix.slice(0, 25)}`, async () => {
  const { icons, config } = await fixture(); await writeFile(config.source, prefix + wrap(circle('circle'))); await assert.rejects(icons.build(), /doctype and entity/u);
});
test('accepts escaped plain title and basic geometry values', async () => {
  const { icons } = await fixture('<symbol id="circle" viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet"><title>Circle &amp; dot</title><g transform="translate(1,2) scale(0.5)" fill="currentColor" opacity="0.5"><circle r="8" stroke="red" stroke-width="2"/><path d="M0 0L2 2Z"/></g></symbol>');
  assert.match((await icons.build()).svg, /Circle &amp; dot/u);
});
test('input byte and depth limits are enforced', async () => {
  const { icons, config } = await fixture(); await writeFile(config.source, ' '.repeat(2 * 1024 * 1024 + 1)); await assert.rejects(icons.build(), /2 MiB/u);
  await writeFile(config.source, wrap('<symbol id="circle">' + '<g>'.repeat(65) + '</g>'.repeat(65) + '</symbol>')); await assert.rejects(icons.build(), /depth limit/u);
});
test('compiler rejects unknown options, invalid paths and aliases', async () => {
  const { config } = await fixture();
  for (const bad of [null, [], { ...config, unknown: true }, { ...config, output: '' }, { ...config, types: 4 }, { ...config, output: 'x\0y' }, { ...config, output: config.source }, { ...config, schema: config.types }]) {
    assert.throws(() => new Icons(bad as IconsConfig));
  }
});
test('rejects writes inside node_modules, symlinked directories and hardlinks', async () => {
  const { root, config } = await fixture();
  await assert.rejects(new Icons({ ...config, output: `${root}/node_modules/pkg/out.svg` }).build(), /node_modules/u);
  await mkdir(`${root}/real`); await symlink(`${root}/real`, `${root}/alias`);
  await assert.rejects(new Icons({ ...config, output: `${root}/alias/out.svg` }).build(), /symlink/u);
  await link(config.source, `${root}/linked.svg`);
  await assert.rejects(new Icons({ ...config, output: `${root}/linked.svg` }).build(), /singly linked/u);
});
test('aborted and concurrent operations leave no temporary files', async () => {
  const { icons, config } = await fixture(); const abort = new AbortController(); abort.abort();
  await assert.rejects(icons.build({ signal: abort.signal }), { name: 'AbortError' });
  const operations = await Promise.all(Array.from({ length: 12 }, (_, i) => i % 2 ? icons.sync() : icons.build()));
  assert.equal(operations.length, 12); assert.deepEqual((await readdir(resolve(config.output, '..'))).sort(), ['icons.svg', 'keys.ts', 'schema.json']);
});
test('repeated parses release windows and keep producing identical results', async () => {
  const { icons } = await fixture(); const first = await icons.build();
  for (let i = 0; i < 30; i++) assert.equal((await icons.build()).svg, first.svg);
});
test('plugin rejects invalid and traversal asset names', async () => {
  const { config } = await fixture();
  for (const fileName of ['../icons.svg', '/icons.svg', 'icons.js', 'a//icons.svg', 'a/../../icons.svg', 'icons.svg?x']) assert.throws(() => viteSvgSprite({ ...config, fileName }), /fileName/u);
});
