import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { build,preview } from 'vite';
import { chromium,webkit } from 'playwright';
const source=await readFile('artwork/source.svg','utf8');
const selection=await readFile('icons.json','utf8');
const fixture='<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><circle id="circle-geometry" cx="12" cy="12" r="8" fill="red"/><rect id="square-geometry" x="4" y="4" width="16" height="16" fill="green"/></defs><symbol id="circle" viewBox="0 0 24 24"><use xlink:href="#circle-geometry"/></symbol><symbol id="square" viewBox="0 0 24 24"><use href="#square-geometry"/></symbol><symbol id="triangle" viewBox="0 0 24 24"><polygon points="12,3 21,21 3,21" fill="blue"/></symbol></svg>';
const results=[];let server;let browser;
try{
 await writeFile('artwork/source.svg',fixture);await writeFile('icons.json','{"keys":{"circle":true,"square":true,"triangle":true}}');
 await build({build:{outDir:'dist-refs'}});
 const output=await readFile('dist-refs/assets/icons.svg','utf8');assert.match(output,/href="#circle-geometry"/u);assert.match(output,/href="#square-geometry"/u);
 server=await preview({build:{outDir:'dist-refs'},preview:{host:'127.0.0.1',port:0,strictPort:true}});
 const url=`http://127.0.0.1:${server.httpServer.address().port}/demo/`;
 for(const engine of [chromium,webkit]){
  browser=await engine.launch({headless:true});const page=await browser.newPage();await page.goto(url);
  await page.waitForFunction(()=>['circle','square','triangle'].every(key=>document.querySelector(`[data-icon="${key}"] use`)?.getBBox().width>20));
  const widths=await page.locator('[data-icon] use').evaluateAll(nodes=>nodes.map(n=>n.getBBox().width));
  assert.equal(widths[0],64);assert.equal(widths[1],64);assert.equal(widths[2],72);
  results.push({browser:engine.name(),version:browser.version(),localHrefAndXlinkRendered:true,widths});
  await browser.close();browser=undefined;
 }
 console.log(JSON.stringify({referenceBrowserChecks:results.length,results},null,2));await writeFile('reference-results.json',JSON.stringify(results,null,2)+'\n');
}finally{
 await browser?.close();if(server){server.httpServer.closeAllConnections();await new Promise((res,rej)=>server.httpServer.close(e=>e?rej(e):res()));}
 await writeFile('artwork/source.svg',source);await writeFile('icons.json',selection);
}
