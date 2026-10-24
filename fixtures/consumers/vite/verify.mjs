import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build, createServer, preview } from 'vite';
import { chromium, webkit } from 'playwright';
import { Icons } from '@frankfmy/svg-sprite-toolkit/compiler';

const control=resolve('screenshots');
const installed=resolve('node_modules/@frankfmy/svg-sprite-toolkit');
const receipt={pid:process.pid,browsers:[],watch:[],teardown:{},baseUrls:[],installedPackageUnchanged:false};
const delay=(ms)=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn,label,timeout=15000){const start=Date.now();let last;while(Date.now()-start<timeout){try{const result=await fn();if(result)return result;}catch(e){last=e;}await delay(40);}throw new Error(`Timed out: ${label}`,{cause:last});}
async function snapshot(path){const out={};for(const ent of await readdir(path,{withFileTypes:true})){const child=`${path}/${ent.name}`;if(ent.isDirectory())Object.assign(out,await snapshot(child));else out[child.slice(installed.length)]=createHash('sha256').update(await readFile(child)).digest('hex');}return out;}
const before=await snapshot(installed);
const source=await readFile('artwork/source.svg','utf8');
const selection=await readFile('icons.json','utf8');
let viteServer;let previewServer;let activeBrowser;
let active=0,maxActive=0,starts=0,aborts=0;
const originalBuild=Icons.prototype.build;
async function closePreview(){if(previewServer){previewServer.httpServer.closeAllConnections();await new Promise((res,rej)=>previewServer.httpServer.close(e=>e?rej(e):res()));previewServer=undefined;}}
async function renderCheck(engine,url,label){
 const browser=await engine.launch({headless:true});activeBrowser=browser;
 try{
  const page=await browser.newPage({viewport:{width:720,height:400}});const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);await page.waitForSelector('[data-icon="triangle"] use');
  await page.waitForFunction(()=>['circle','square','triangle'].every(key=>document.querySelector(`[data-icon="${key}"] use`).getBBox().width>20));
  const metrics=await page.locator('[data-icon] svg').evaluateAll(nodes=>nodes.map(svg=>({label:svg.getAttribute('aria-label'),hidden:svg.getAttribute('aria-hidden'),href:svg.querySelector('use').getAttribute('href'),box:{width:svg.querySelector('use').getBBox().width,height:svg.querySelector('use').getBBox().height}})));
  assert.equal(metrics.length,4);assert.equal(metrics[3].hidden,'true');assert.ok(metrics.slice(0,3).every(x=>x.label));
  assert.ok(metrics.every(x=>!x.href.includes('undefined')));assert.deepEqual(errors,[]);
  const screenshot=`${control}/${Date.now()}-${label}-${engine.name()}.png`;await page.screenshot({path:screenshot});
  receipt.browsers.push({engine:engine.name(),version:browser.version(),mode:label,url,metrics,screenshot,errors});
  console.log(`BROWSER PASS ${label} ${engine.name()} ${browser.version()}`);
 }finally{await browser.close();activeBrowser=undefined;}
}
try{
 previewServer=await preview({preview:{host:'127.0.0.1',port:0,strictPort:true}});
 let origin=`http://127.0.0.1:${previewServer.httpServer.address().port}`;
 for(const engine of [chromium,webkit])await renderCheck(engine,`${origin}/demo/`,'production');
 let response=await fetch(`${origin}/demo/assets/icons.svg`);assert.equal(response.status,200);assert.match(await response.text(),/id="triangle"/u);
 receipt.baseUrls.push({base:'/demo/',productionAsset:'/demo/assets/icons.svg',status:200});
 await closePreview();
 await build({base:'./',build:{outDir:'dist-relative'}});
 previewServer=await preview({base:'./',build:{outDir:'dist-relative'},preview:{host:'127.0.0.1',port:0,strictPort:true}});
 origin=`http://127.0.0.1:${previewServer.httpServer.address().port}`;
 await renderCheck(chromium,`${origin}/`,'relative-base');
 receipt.baseUrls.push({base:'./',productionAsset:'assets/icons.svg',status:200});await closePreview();
 await build({build:{ssr:'src/ssr.ts',outDir:'dist-ssr'}});
 const {html}=await import('./dist-ssr/ssr.js');assert.match(html,/href="\/demo\/assets\/icons.svg#circle"/u);assert.match(html,/aria-label="Circle"/u);receipt.ssr={passed:true,html};
 Icons.prototype.build=async function(options){active++;maxActive=Math.max(maxActive,active);starts++;try{await delay(100);return await originalBuild.call(this,options);}catch(e){if(e.name==='AbortError')aborts++;throw e;}finally{active--;}};
 viteServer=await createServer({server:{host:'127.0.0.1',port:0,strictPort:true},clearScreen:false});await viteServer.listen();
 origin=`http://127.0.0.1:${viteServer.httpServer.address().port}`;
 const url=`${origin}/demo/assets/icons.svg`;
 for(const engine of [chromium,webkit])await renderCheck(engine,`${origin}/demo/`,'development');
 const current=async()=>{const response=await fetch(url);return {status:response.status,text:await response.text(),type:response.headers.get('content-type')};};
 assert.equal((await fetch(url,{method:'HEAD'})).status,200);assert.equal((await fetch(url,{method:'POST'})).status,405);
 const wrong=await fetch(`${origin}/assets/icons.svg`);assert.notEqual(wrong.headers.get('content-type'),'image/svg+xml');
 const browser=await chromium.launch({headless:true});activeBrowser=browser;const page=await browser.newPage();const wsErrors=[];
 page.on('websocket',ws=>ws.on('framereceived',({payload})=>{try{const data=JSON.parse(payload.toString());if(data.type==='error')wsErrors.push(data.err.message);}catch{}}));
 await page.goto(`${origin}/demo/`);await page.waitForSelector('[data-icon="circle"] use');
 await writeFile('icons.json','{"keys":{"circle":true}}');
 await waitFor(async()=>{const r=await current();return r.status===200&&r.text.includes('id="circle"')&&!r.text.includes('id="square"');},'selection change');receipt.watch.push('selection change');
 await writeFile('artwork/source.svg',source.replace('r="8"','r="6"'));
 await waitFor(async()=>{const r=await current();return r.status===200&&r.text.includes('r="6"');},'source geometry change');receipt.watch.push('source geometry change');
 await writeFile('artwork/source.svg',source.replace(/<symbol id="triangle"[\s\S]*?<\/symbol>/u,''));
 // The compiler publishes separate files with sequential atomic renames.
 // A new type file alone does not prove that the matching schema is ready.
 await waitFor(async()=>{const types=await readFile('src/generated/icon-keys.ts','utf8');const schema=JSON.parse(await readFile('generated/schema.json','utf8'));return !types.includes('triangle')&&!Object.hasOwn(schema.properties.keys.properties,'triangle');},'generated type and schema removal');
 assert.equal(JSON.parse(await readFile('generated/schema.json','utf8')).properties.keys.properties.triangle,undefined);receipt.watch.push('source keys and schema change');
 await writeFile('icons.json','{"keys":{"missing":true}}');
 await waitFor(async()=>(await current()).status===500,'missing symbol error');await waitFor(()=>wsErrors.some(x=>x.includes('Unknown symbol')),'websocket error');receipt.watch.push('missing symbol HTTP 500 and websocket error');
 for(const [label,content] of [['invalid shape','{"keys":[]}'],['malformed JSON','{']]){
  await writeFile('icons.json',content);await waitFor(async()=>{const r=await current();return r.status===500&&(label==='invalid shape'?r.text.includes('keys object'):r.text.includes('Invalid selection JSON'));},label);receipt.watch.push(label);
 }
 await writeFile('icons.json','{"keys":{"circle":true}}');await waitFor(async()=>(await current()).status===200,'error recovery');receipt.watch.push('error recovery');
 await rename('artwork/source.svg','artwork/source.saved');await waitFor(async()=>(await current()).status===500,'source unlink');
 await rename('artwork/source.saved','artwork/source.svg');await waitFor(async()=>(await current()).status===200,'source add');receipt.watch.push('source unlink/add');
 await rename('icons.json','icons.saved');await waitFor(async()=>(await current()).status===500,'selection unlink');
 await rename('icons.saved','icons.json');await waitFor(async()=>(await current()).status===200,'selection add');receipt.watch.push('selection unlink/add');
 await writeFile('artwork/source.svg',source.replace('<circle','<circle onload="alert(1)"'));await waitFor(async()=>{const r=await current();return r.status===500&&r.text.includes('Unsupported SVG attribute');},'unsafe sprite');receipt.watch.push('unsafe SVG error');
 await writeFile('artwork/source.svg',source);await waitFor(async()=>(await current()).status===200,'unsafe input recovery');
 await writeFile('icons.json','{"keys":{}}');await waitFor(async()=>{const r=await current();return r.status===200&&!r.text.includes('<symbol');},'empty selection');receipt.watch.push('empty selection');
 await writeFile('artwork/source.svg','<svg xmlns="http://www.w3.org/2000/svg"/>');await waitFor(async()=>(await readFile('src/generated/icon-keys.ts','utf8')).includes('= never;'),'empty source');receipt.watch.push('empty source and never type');
 await writeFile('artwork/source.svg',source);await writeFile('icons.json','{"keys":{"circle":true}}');await waitFor(async()=>{const r=await current();return r.status===200&&r.text.includes('id="circle"');},'restore');
 await writeFile('artwork/source.svg',source.replace('r="8"','r="4"'));await waitFor(()=>active===1,'in-flight build');
 await delay(55);await writeFile('artwork/source.svg',source.replace('r="8"','r="9"'));
 await writeFile('icons.json','{"keys":{"circle":true,"square":false,"triangle":false}}');
 await waitFor(async()=>{const r=await current();return r.status===200&&r.text.includes('r="9"')&&!r.text.includes('id="square"');},'latest revision');
 await delay(200);assert.match(await readFile('generated/icons.svg','utf8'),/r="9"/u);assert.equal(maxActive,1);assert.ok(aborts>=1);receipt.watch.push('superseded build cancellation, no overlap, latest output stable');
 const listenersBefore=['add','change','unlink'].map(event=>viteServer.watcher.listeners(event).filter(fn=>fn.name==='onInput').length);assert.deepEqual(listenersBefore,[1,1,1]);
 await writeFile('artwork/source.svg',source.replace('r="8"','r="5"'));await waitFor(()=>active===1,'build before teardown');
 const watch= viteServer.watcher;const http= viteServer.httpServer;await viteServer.close();viteServer=undefined;
 assert.equal(active,0);assert.equal(http.listening,false);assert.deepEqual(['add','change','unlink'].map(e=>watch.listeners(e).filter(fn=>fn.name==='onInput').length),[0,0,0]);
 const afterClose=await readFile('generated/icons.svg','utf8');const buildsAtClose=starts;
 await writeFile('artwork/source.svg',source);await delay(250);assert.equal(starts,buildsAtClose);assert.equal(await readFile('generated/icons.svg','utf8'),afterClose);await assert.rejects(fetch(url));
 receipt.teardown={passed:true,activeBuildsAtClose:active,listenersBefore,listenersAfter:[0,0,0],starts,maxActive,aborts,httpClosed:true,noWritesAfterClose:true};
 await browser.close();activeBrowser=undefined;
 assert.deepEqual(await snapshot(installed),before);receipt.installedPackageUnchanged=true;
 console.log(JSON.stringify(receipt,null,2));
 await writeFile('verification-results.json',JSON.stringify(receipt,null,2)+'\n');
}finally{
 Icons.prototype.build=originalBuild;
 await activeBrowser?.close();await viteServer?.close();await closePreview();
 for(const [backup,target] of [['icons.saved','icons.json'],['artwork/source.saved','artwork/source.svg']]){try{await rename(backup,target);}catch(e){if(e.code!=='ENOENT')throw e;}}
 await writeFile('artwork/source.svg',source);await writeFile('icons.json',selection);
}
