import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright';
const server=spawn(process.execPath,['scripts/serve.mjs'],{stdio:['ignore','pipe','inherit']});await once(server.stdout,'data');
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:5173/?mode=unified');
 await page.waitForFunction(()=>window.ardsResults?.[0].trajectory?.kind==='unified-nonlinear-flow',{},{timeout:120000});
 assert.equal(await page.locator('#mechanics-mode').inputValue(),'unified');
 const first=await page.evaluate(()=>window.ardsResults.map(r=>({metrics:r.metrics,trajectory:r.trajectory})));
 for(const r of first){assert.ok(Number.isFinite(r.metrics.endVolume));assert.ok(r.metrics.restingPEEPVolume>0);assert.equal(r.metrics.pplat,null);assert.ok(r.trajectory.frames.every(f=>f.unitAlveolar?.length===512));
  for(let i=1;i<r.trajectory.frames.length;i++){const f=r.trajectory.frames[i],p=r.trajectory.frames[i-1];if(f.time===p.time){assert.ok(Math.abs(f.volume-p.volume)<1e-7);assert.ok(f.unitVolume.every((v,j)=>Math.abs(v-p.unitVolume[j])<1e-8));}}
 }
 await page.locator('#eli5-toggle').click();assert.match(await page.locator('#eli5-text').textContent(),/PEEP|between|rest/i);await page.locator('#eli5-close').click();
 await page.locator('#map-help').evaluate(e=>e.open=true);assert.match(await page.locator('#map-help').textContent(),/opening|Opening/);assert.match(await page.locator('#map-help').textContent(),/1 cmH2O|1 cmH₂O/);await page.locator('#map-help').evaluate(e=>e.open=false);
 await page.locator('#end-expiration').click();await page.locator('#patient-a .unit-inspection').evaluate(e=>e.open=true);await page.locator('#unit-select-a').fill('100');await page.locator('#unit-select-a').dispatchEvent('change');assert.match(await page.locator('#unit-a').textContent(),/pressure|Pressure/);
 const setRange=async(id,value)=>{await page.locator('#'+id).evaluate((e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},String(value));};
 const waitNext=async(prev)=>page.waitForFunction(v=>window.ardsRenderCounter>v&&window.ardsResults?.[0].trajectory?.kind==='unified-nonlinear-flow',prev,{timeout:120000});
 for(const vt of [1,14]){const prev=await page.evaluate(()=>window.ardsRenderCounter);await setRange('vt',vt);await waitNext(prev);const m=await page.evaluate(()=>window.ardsResults.map(r=>r.metrics));assert.ok(m.every(r=>r.vtDelivered>=0&&Number.isFinite(r.endVolume)));}
 const before=await page.evaluate(()=>window.ardsRenderCounter);await setRange('peep',20);await waitNext(before);
 await page.locator('#pressure-experiments').evaluate(e=>e.open=true);await page.locator('#pressure-drive').selectOption('external');await page.waitForFunction(()=>window.ardsResults?.[0].conditions?.drive==='external',{},{timeout:120000});assert.ok(await page.evaluate(()=>window.ardsResults.every(r=>r.trajectory.frames.every(f=>f.pressure===0))));
 for(const width of [1280,800,390,320]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'overflow '+width);await page.locator('#map-a').scrollIntoViewIfNeeded();const r=await page.locator('#peep').boundingBox();assert.ok(r.y>=0&&r.y+r.height<=900,'sticky settings '+width);if(width===390)await page.screenshot({path:'benchmarks/preview-unified-mobile.png'});}
 await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'benchmarks/preview-unified-desktop.png'});
 await page.locator('#mechanics-mode').selectOption('recruitment');await page.waitForFunction(()=>window.ardsResults?.[0].trajectory?.kind==='quasi-static-steps',{},{timeout:120000}).catch(async()=>{assert.notEqual(await page.evaluate(()=>window.ardsResults?.[0].trajectory?.kind),'unified-nonlinear-flow');});
 assert.deepEqual(errors,[]);console.log('Unified breathing, real release continuity, extreme VT, pressure-source translation and responsive controls passed.');
}finally{await browser.close();server.kill();}
