import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright';
const server=spawn(process.execPath,['scripts/serve.mjs'],{stdio:['ignore','pipe','inherit']});await once(server.stdout,'data');
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>window.ardsResults?.[0].trajectory);
 assert.equal(await page.getByText('Why it matters',{exact:false}).count(),0);
 for(const k of ['a','b']){assert.equal(await page.locator('#map-'+k).evaluate(el=>Boolean(el.compareDocumentPosition(document.getElementById('pressures-'+el.id.at(-1)))&Node.DOCUMENT_POSITION_FOLLOWING)),true);assert.match(await page.locator('#pressures-'+k).textContent(),/Esophageal surrogate · Pes/);}
 await page.locator('#sweep').click();await page.waitForFunction(()=>window.ardsSweepIndex>=1&&window.ardsSweep);
 const baseline=await page.evaluate(()=>({renders:window.ardsRenderCounter,peep:document.getElementById('peep').value,results:JSON.stringify(window.ardsResults),sweep:JSON.stringify(window.ardsSweep)}));
 await page.locator('#play-sweep').click();const paused=await page.evaluate(()=>window.ardsSweepIndex);await page.waitForTimeout(700);assert.equal(await page.evaluate(()=>window.ardsSweepIndex),paused);
 await page.locator('#sweep-frame').fill('11');await page.locator('#sweep-frame').dispatchEvent('input');assert.match(await page.locator('#sweep-readout').textContent(),/PEEP 24.*Falling.*12\/22/);
 assert.equal(await page.locator('#sweep-chart .sweep-cursor rect').count(),2);
 await page.locator('#sweep-frame').fill('20');await page.locator('#sweep-frame').dispatchEvent('input');await page.locator('#play-sweep').click();await page.waitForFunction(()=>document.getElementById('play-sweep').getAttribute('aria-pressed')==='false');
 assert.equal(await page.evaluate(()=>window.ardsSweepIndex),21);assert.equal(await page.evaluate(()=>window.ardsRenderCounter),baseline.renders);assert.equal(await page.locator('#peep').inputValue(),baseline.peep);assert.equal(await page.evaluate(()=>JSON.stringify(window.ardsResults)),baseline.results);assert.equal(await page.evaluate(()=>JSON.stringify(window.ardsSweep)),baseline.sweep);
 await page.locator('#play-sweep').click();await page.locator('#tab-model').click();const hidden=await page.evaluate(()=>window.ardsSweepIndex);await page.waitForTimeout(650);assert.equal(await page.evaluate(()=>window.ardsSweepIndex),hidden);await page.locator('#tab-explore').click();
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>document.getElementById('play-sweep').disabled);assert.equal(await page.locator('#play-sweep').isDisabled(),true);await page.locator('#sweep-frame').fill('8');await page.locator('#sweep-frame').dispatchEvent('input');assert.match(await page.locator('#sweep-readout').textContent(),/PEEP 20.*Rising/);
 await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForFunction(()=>!document.getElementById('play-sweep').disabled);
 for(const theme of ['light','dark']){await page.emulateMedia({colorScheme:theme});for(const width of [1280,390,320]){await page.setViewportSize({width,height:900});await page.locator('#sweep-chart').scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}}
 await page.locator('#play-sweep').click();await page.locator('#vt').evaluate(el=>{el.value=7;el.dispatchEvent(new Event('input'));});assert.equal(await page.locator('#play-sweep').isDisabled(),true);assert.equal(await page.evaluate(()=>window.ardsSweep),null);
 await page.setViewportSize({width:1280,height:900});await page.locator('#ei').click();await page.locator('#patient-a').scrollIntoViewIfNeeded();await page.screenshot({path:'benchmarks/preview-live-pressures.png'});
 await page.locator('#mechanics-mode').selectOption('airflow');await page.waitForFunction(()=>window.ardsResults?.[0].trajectory.kind==='frozen-aeration-airflow');await page.locator('#ei').click();assert.match(await page.locator('#pressures-a').textContent(),/Airway − pleural/);assert.doesNotMatch(await page.locator('#pressures-a').textContent(),/Lung-distending/);
 assert.deepEqual(errors,[]);console.log('Sweep replay, stored-point inspection, state preservation, responsive layouts and prominent pressure readouts passed.');
}finally{await browser.close();server.kill();}
