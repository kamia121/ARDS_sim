import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright';
const server=process.env.ARDS_AIRFLOW_EXTERNAL_SERVER?null:spawn(process.execPath,['scripts/serve.mjs'],{stdio:['ignore','pipe','inherit']});
if(server)await once(server.stdout,'data');
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>window.ardsResults?.[0].trajectory);
 const original=await page.evaluate(()=>window.ardsResults.map(r=>r.metrics));
 await page.locator('#mechanics-mode').selectOption('airflow');await page.waitForFunction(()=>window.ardsResults?.[0].trajectory.kind==='frozen-aeration-airflow');
 assert.equal(await page.locator('#resistance-control').isVisible(),true);
 assert.equal(await page.locator('#sweep-panel').isVisible(),false);
 assert.match(await page.locator('.legend').textContent(),/fixed/);assert.doesNotMatch(await page.locator('.legend').textContent(),/More tissue opened|High-stretch square/);
 assert.equal(await page.evaluate(()=>window.ardsResults[0].metrics.pplat),null);assert.equal(await page.evaluate(()=>window.ardsResults[0].metrics.over),null);
 const continuity=await page.evaluate(()=>{const t=window.ardsResults[0].trajectory,a=t.frames[t.eiIndex],b=t.frames[t.releaseIndex];return {sameVolume:a.volume===b.volume,pressureChanged:a.pressure!==b.pressure,flowChanged:a.flow!==b.flow,unitSame:a.unitVolume.every((v,i)=>v===b.unitVolume[i]),openingSame:t.frames[0].volume===t.frames[1].volume};});
 assert.deepEqual(continuity,{sameVolume:true,pressureChanged:true,flowChanged:true,unitSame:true,openingSame:true});
 await page.locator('#patient-a .unit-inspection summary').click();await page.locator('#unit-select-a').fill('0');await page.locator('#ei').click();
 assert.match(await page.locator('#unit-a').textContent(),/flow .*own emptying-time estimate \(RC\).*share of extra air released/);
 await page.locator('#release-breath').click();assert.match(await page.locator('#breath-phase').textContent(),/Start expiration/);
 await page.locator('[data-prediction="up"]').click();await page.locator('#apply-adjustment').click();
 await page.waitForFunction(()=>document.getElementById('prediction-feedback').textContent.startsWith('Prediction matched'));
 assert.equal(await page.locator('#resistance').inputValue(),'16');await page.locator('#ei').click();
 assert.ok(await page.evaluate(()=>window.ardsResults[0].metrics.retainedVolume>20));
 await page.locator('#learner-level').selectOption('fellow');await page.locator('#lesson').selectOption('flow-rate');await page.waitForFunction(()=>!document.getElementById('apply-adjustment').disabled);
 await page.locator('[data-prediction="down"]').click();await page.locator('#apply-adjustment').click();
 await page.waitForFunction(()=>document.getElementById('prediction-feedback').textContent.startsWith('Prediction matched')&&window.ardsResults[0].settings.rr===30);
 await page.locator('#ei').click();
 await page.locator('#play-breath').click();await page.waitForFunction(()=>window.ardsAnimationCounter>10);await page.locator('#play-breath').click();
 const count=await page.evaluate(()=>window.ardsAnimationCounter);await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>window.ardsAnimationCounter),count);
 const layout=[];
 for(const scheme of ['light','dark'])for(const width of [1280,900,800,390,320]){
  await page.emulateMedia({colorScheme:scheme});await page.setViewportSize({width,height:900});await page.locator('#map-b').scrollIntoViewIfNeeded();await page.waitForTimeout(80);
  const r=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,slidersVisible:[...document.querySelectorAll('.controls input')].every(e=>{const b=e.getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight;})}));
  assert.equal(r.overflow,false,`${scheme}/${width} overflow`);assert.equal(r.slidersVisible,true,`${scheme}/${width} hidden control`);layout.push({scheme,width,...r});
  if(width===390)await page.screenshot({path:`benchmarks/preview-airflow-${scheme}-mobile.png`});
 }
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>document.getElementById('play-breath').disabled);assert.equal(await page.locator('#play-breath').isDisabled(),true);
 const reducedCount=await page.evaluate(()=>window.ardsAnimationCounter);await page.locator('#set-baseline').click();await page.waitForFunction(()=>!document.getElementById('apply-adjustment').disabled);await page.locator('#apply-adjustment').click();await page.waitForFunction(()=>window.ardsResults[0].settings.rr===30);await page.waitForTimeout(300);
 assert.equal(await page.evaluate(()=>window.ardsAnimationCounter),reducedCount);await page.locator('#release-breath').click();
 // Switching modes invalidates pending flow results and restores the original numerical recruitment path.
 await page.locator('#mechanics-mode').selectOption('recruitment');await page.waitForFunction(()=>window.ardsResults?.[0].trajectory.kind==='quasi-static-steps'&&!document.getElementById('apply-adjustment').disabled);
 assert.deepEqual(await page.evaluate(()=>window.ardsResults.map(r=>r.metrics)),original);assert.equal(await page.locator('#resistance-control').isVisible(),false);
 assert.match(await page.locator('.legend').textContent(),/More tissue opened/);
 await page.locator('#mechanics-mode').selectOption('airflow');await page.waitForFunction(()=>window.ardsResults?.[0].trajectory.kind==='frozen-aeration-airflow');
 await page.locator('#resistance').evaluate(el=>{el.value='25';el.dispatchEvent(new Event('input'));});await page.locator('#mechanics-mode').selectOption('recruitment');
 await page.waitForFunction(()=>window.ardsResults?.[0].trajectory.kind==='quasi-static-steps');await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>window.ardsResults[0].trajectory.kind),'quasi-static-steps');
 assert.deepEqual(errors,[]);
 const result={date:new Date().toISOString(),checks:['mode preparation and frozen reference','continuous gas at inspiratory and expiratory pressure steps','computed regional flow RC and emptying','no unsupported plateau or distension output','resistance and rate prediction checks','pause and reduced motion','controls visible and no overflow across five widths/two themes','mode restoration exact','stale mode results ignored','no page errors'],layout};
 await fs.writeFile('benchmarks/results-airflow-browser.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{await browser.close();server?.kill();}
