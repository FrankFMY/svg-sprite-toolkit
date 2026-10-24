import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Icons as RootIcons } from '@frankfmy/svg-sprite-toolkit';
import { Icons } from '@frankfmy/svg-sprite-toolkit/compiler';
import { viteSvgSprite } from '@frankfmy/svg-sprite-toolkit/vite';

assert.equal(RootIcons, Icons);
assert.equal(typeof viteSvgSprite, 'function');
const installed = resolve('node_modules/@frankfmy/svg-sprite-toolkit');
async function snapshot(path) {
 const output = {};
 for (const item of (await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name < b.name ? -1:1)) {
  const child = `${path}/${item.name}`;
  if(item.isDirectory()) Object.assign(output,await snapshot(child));
  else output[child.slice(installed.length)] = createHash('sha256').update(await readFile(child)).digest('hex');
 }
 return output;
}
const before = await snapshot(installed);
for (const optional of ['svelte','vite']) {
 assert.throws(()=>import.meta.resolve(optional));
}
for(const runtime of ['jsdom','svgo']) assert.ok(import.meta.resolve(runtime).startsWith(`file://${resolve('node_modules')}/`));
const config = {source:'artwork/source.svg', selection:'icons.json',output:'generated/icons.svg',types:'generated/keys.ts',schema:'generated/schema.json'};
const icons = new Icons(config);
await icons.sync();
const result = await icons.build();
assert.deepEqual(result.selected,['circle','square','triangle']);
assert.match(result.svg,/<circle/u); assert.match(result.svg,/<rect/u); assert.match(result.svg,/<polygon/u);
assert.match(result.svg,/viewBox="0 0 24 24"/u);
await assert.rejects(new Icons({...config,output:`${installed}/mutated.svg`}).build(),/node_modules/u);
const source = await readFile(config.source,'utf8'); const selection = await readFile(config.selection,'utf8');
try {
 for(const invalid of ['{"keys":{"missing":true}}','{"keys":{"circle":"yes"}}','{"keys":{},"extra":1}','{']) {
  await writeFile(config.selection,invalid); await assert.rejects(icons.build());
  assert.equal(await readFile(config.output,'utf8'),result.svg);
 }
 await writeFile(config.selection,selection);
 for(const invalid of [
  '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///unavailable">]>'+source,
  source.replace('<circle','<script/> <circle'),
  source.replace('<circle','<circle onload="alert(1)"'),
  source.replace('<circle','<use href="javascript:alert(1)"/><circle'),
  source.replace('<circle','<circle style="fill:red"'),
 ]) { await writeFile(config.source,invalid); await assert.rejects(icons.build()); }
 await writeFile(config.source,source); await writeFile(config.selection,'{"keys":{}}');
 assert.deepEqual((await icons.build()).selected,[]);
 await writeFile(config.source,'<svg xmlns="http://www.w3.org/2000/svg"/>');
 assert.deepEqual((await icons.build()).keys,[]);
 assert.match(await readFile(config.types,'utf8'),/IconKey = never/u);
} finally {await writeFile(config.source,source);await writeFile(config.selection,selection);await icons.build();}
assert.deepEqual(await snapshot(installed),before);
assert.equal((await stat(config.output)).isFile(),true);
console.log(JSON.stringify({runtime:process.versions.bun ? `Bun ${process.versions.bun}`:`Node ${process.version}`,exports:['.','./compiler','./vite'],optionalFrameworksAbsent:true,installedPackageUnchanged:true,selected:result.selected,svgSha256:createHash('sha256').update(result.svg).digest('hex'),assertionGroups:18,pid:process.pid},null,2));
