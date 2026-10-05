import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const server=spawn(process.execPath,['scripts/serve.mjs'],{stdio:['ignore','pipe','inherit']});
let browser;
try{
  await once(server.stdout,'data');
  const args=process.env.CHROME_ARGS_FILE?JSON.parse(await fs.readFile(process.env.CHROME_ARGS_FILE,'utf8')):[];
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE_PATH||undefined,args});
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('requestfailed',r=>errors.push(r.url()+': '+r.failure()?.errorText));
  await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>window.ardsResults);
  const fresh=await page.evaluate(()=>window.ardsResults.map(r=>r.metrics));
  const timings=[];
  for(let i=0;i<7;i++){
    const ms=await page.evaluate(()=>new Promise(resolve=>{const n=window.ardsRenderCounter,start=performance.now();document.getElementById('reset').click();const poll=()=>{if(window.ardsRenderCounter>n)resolve(performance.now()-start);else setTimeout(poll,1);};poll();}));timings.push(ms);
  }
  assert.deepEqual(await page.evaluate(()=>window.ardsResults.map(r=>r.metrics)),fresh,'reset is reproducible');
  await page.locator('#ei').click();assert.equal(await page.locator('#ei').getAttribute('aria-pressed'),'true');
  await page.locator('#ee').click();
  await page.locator('#sweep').click();await page.waitForFunction(()=>window.ardsSweep);
  assert.equal(await page.evaluate(()=>window.ardsSweep[0].ascending.length),11);
  assert.deepEqual(await page.evaluate(()=>window.ardsResults.map(r=>r.metrics)),fresh,'sweep preserves active state');
  await page.evaluate(()=>{const el=document.getElementById('vt');el.value=7;el.dispatchEvent(new Event('input'));});
  assert.equal(await page.evaluate(()=>window.ardsSweep),null,'settings invalidate sweep');
  await page.waitForFunction(()=>window.ardsResults[0].settings.vt===7);
  await page.locator('#kind-b').selectOption('wall');await page.waitForFunction(()=>window.ardsResults[1].targetVT===490&&window.ardsResults[1].phenotype==='wall');
  await page.evaluate(()=>{const el=document.getElementById('vt');el.value=6;el.dispatchEvent(new Event('input'));});
  await page.locator('#kind-b').selectOption('low');await page.waitForFunction(()=>window.ardsResults[1].targetVT===420&&window.ardsResults[1].phenotype==='low');
  await page.locator('#reset').click();await page.waitForTimeout(150);
  await page.screenshot({path:'benchmarks/preview-desktop.png',fullPage:true});
  const layout=[];
  for(const width of [1280,390,320]){
    await page.setViewportSize({width,height:844});await page.waitForTimeout(160);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    assert.equal(overflow,false,`layout overflow at ${width}`);layout.push({width,overflow});
    if(width===390)await page.screenshot({path:'benchmarks/preview-mobile.png',fullPage:true});
  }
  await page.locator('#tab-benchmarks').click();await page.locator('#run-benchmark').click();await page.waitForFunction(()=>window.ardsBenchmark,{},{timeout:60000});
  const device=await page.evaluate(()=>window.ardsBenchmark);
  await page.locator('#tab-model').click();
  for(const href of await page.locator('a[href^="./docs/"]').evaluateAll(as=>as.map(a=>a.getAttribute('href'))))assert.equal((await page.request.get('http://127.0.0.1:5173/'+href)).status(),200,href);
  assert.deepEqual(errors,[]);
  const sorted=[...timings].sort((a,b)=>a-b);
  const result={date:new Date().toISOString(),provenance:{checkpoint:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),scriptSha256:createHash('sha256').update(await fs.readFile('benchmarks/browser-benchmark.mjs')).digest('hex'),sourceSha256:Object.fromEntries(await Promise.all(['src/app.js','src/worker.js','src/session.js','src/engine.js','src/teaching.js','index.html','styles.css'].map(async file=>[file,createHash('sha256').update(await fs.readFile(file)).digest('hex')]))),workingTree:'integration changes present at run'},browser:browser.version(),scope:`Headless Chromium on ${process.platform} / ${process.arch}; desktop/mobile layout emulation, not a physical mobile benchmark. Paired worker-plus-DOM reset timings include creation, simulation and DOM/canvas updates, but do not isolate compositor presentation.`,checks:['reproducible reset','phase toggle','fresh isolated 22-step sweep','stale sweep invalidation','phenotype change','320/390/1280 layout without overflow','module worker and device benchmark','documentation links','no page errors or failed requests'],layout,pairedUpdate:{samplesMs:timings,medianMs:sorted[3],p95Ms:sorted[6]},device};
  await fs.writeFile('benchmarks/results-browser.json',JSON.stringify(result,null,2));console.log(JSON.stringify({checks:result.checks.length,pairedUpdate:result.pairedUpdate,device:device.rows.map(({units,medianMs,p95Ms})=>({units,medianMs,p95Ms}))},null,2));
}finally{await browser?.close();server.kill();}
