import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright';

const server=process.env.ARDS_REPLAY_EXTERNAL_SERVER?null:spawn(process.execPath,['scripts/serve.mjs'],{stdio:['ignore','pipe','inherit']});
if(server)await once(server.stdout,'data');
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>window.ardsResults?.[0].trajectory);
 assert.equal(await page.locator('#play-breath').getAttribute('aria-pressed'),'false');
 const start=await page.locator('#map-a').evaluate(el=>el.toDataURL());
 await page.locator('#ei').click();assert.notEqual(await page.locator('#map-a').evaluate(el=>el.toDataURL()),start);
 const ei=await page.locator('#live-a').textContent();await page.locator('#release-breath').click();
 assert.notEqual(await page.locator('#live-a').textContent(),ei);assert.match(await page.locator('#breath-phase').textContent(),/Pressure release/);
 await page.locator('#ee').click();await page.locator('#play-breath').click();await page.waitForFunction(()=>window.ardsAnimationCounter>10);
 await page.locator('#play-breath').click();const count=await page.evaluate(()=>window.ardsAnimationCounter);await page.waitForTimeout(350);
 assert.equal(await page.evaluate(()=>window.ardsAnimationCounter),count,'paused replay schedules no frames');
 await page.locator('#ee').click();await page.locator('#play-breath').click();await page.locator('#tab-model').click();
 const hiddenCount=await page.evaluate(()=>window.ardsAnimationCounter);await page.waitForTimeout(350);
 assert.equal(await page.evaluate(()=>window.ardsAnimationCounter),hiddenCount,'another workspace pauses replay');
 await page.locator('#tab-explore').click();
 await page.locator('[data-prediction="up"]').click();await page.locator('#apply-adjustment').click();
 await page.waitForFunction(()=>document.getElementById('prediction-feedback').textContent.includes('Prediction matched'));
 assert.match(await page.locator('#prediction-feedback').textContent(),/1\/1/);
 await page.locator('#ei').click();await page.locator('#apply-adjustment').click();
 await page.waitForFunction(()=>window.ardsResults[0].settings.peep===12&&document.getElementById('prediction-feedback').textContent.includes('matched'));
 assert.match(await page.locator('#prediction-feedback').textContent(),/1\/1/,'reapplying the same prediction is not a new scored attempt');
 await page.locator('#ei').click();
 for(const level of ['resident','fellow']){
  await page.locator('#learner-level').selectOption(level);assert.equal(await page.locator('[data-prediction="down"]').isDisabled(),false);
  assert.ok((await page.locator('#lesson-prediction').textContent()).length>20);
 }
 await page.locator('#set-baseline').click();await page.waitForFunction(()=>!document.getElementById('apply-adjustment').disabled);
 await page.locator('#learner-level').selectOption('student');
 await page.locator('[data-prediction="down"]').click();await page.locator('#apply-adjustment').click();
 await page.waitForFunction(()=>document.getElementById('prediction-feedback').textContent.includes('Different from your prediction'));
 await page.locator('#ei').click();
 // Native slider editing during a playing breath must replace the result safely.
 await page.locator('#play-breath').click();await page.locator('#vt').evaluate(el=>{el.value='7';el.dispatchEvent(new Event('input'));});
 await page.waitForFunction(()=>window.ardsResults[0].settings.vt===7);await page.locator('#ei').click();
 assert.match(await page.locator('#prediction-feedback').textContent(),/Multiple controls changed/);
 const layout=[];
 for(const scheme of ['light','dark']){
  await page.emulateMedia({colorScheme:scheme});
  for(const width of [1280,900,800,390,320]){
   await page.setViewportSize({width,height:900});await page.locator('#map-b').scrollIntoViewIfNeeded();await page.waitForTimeout(120);
   const result=await page.evaluate(()=>{const d=document.querySelector('.control-dock').getBoundingClientRect(),sliders=[...document.querySelectorAll('.controls input')].map(e=>e.getBoundingClientRect());return {overflow:document.documentElement.scrollWidth>innerWidth,visible:sliders.every(r=>r.top>=0&&r.bottom<=innerHeight),dockTop:d.top};});
   assert.equal(result.overflow,false,`overflow ${scheme}/${width}`);assert.equal(result.visible,true,`sliders visible with model ${scheme}/${width}`);
   layout.push({scheme,width,...result});
   if(width===390)await page.screenshot({path:`benchmarks/preview-replay-${scheme}-mobile.png`});
  }
 }
 await page.emulateMedia({reducedMotion:'reduce'});
 const motionCount=await page.evaluate(()=>window.ardsAnimationCounter||0);await page.waitForTimeout(350);
 assert.equal(await page.locator('#play-breath').isDisabled(),true);
 await page.locator('#set-baseline').click();await page.waitForFunction(()=>!document.getElementById('apply-adjustment').disabled);
 await page.locator('#apply-adjustment').click();await page.waitForFunction(()=>window.ardsResults[0].settings.peep===12);await page.waitForTimeout(350);
 assert.equal(await page.evaluate(()=>window.ardsAnimationCounter||0),motionCount,'reduced motion does not autoplay');
 await page.locator('#ei').click();assert.match(await page.locator('#breath-phase').textContent(),/End inspiration/);
 await page.emulateMedia({reducedMotion:'no-preference'});await page.setViewportSize({width:1280,height:900});
 await page.locator('#ee').click();await page.locator('#play-breath').click();
 await page.waitForFunction(()=>document.getElementById('breath-phase').textContent.startsWith('End expiration'),null,{timeout:10000});
 assert.equal(await page.locator('#play-breath').getAttribute('aria-pressed'),'false');
 const timings=await page.evaluate(()=>window.ardsReplayTimings),sorted=[...timings].sort((a,b)=>a-b);
 const result={date:new Date().toISOString(),browser:browser.version(),checks:['recorded frame replay','different inspiration/release maps','pause stops scheduling','hidden workspace pauses','correct and incorrect prediction feedback','repeat result not rescored','level-specific prompts','fresh trajectory on live adjustment','sliders visible at model in both themes and five widths','reduced motion discrete inspection','one-shot replay stops at final expiration','no page errors'],layout,pairedReplayJsMs:{samples:timings,median:sorted[Math.floor(sorted.length/2)],p95:sorted[Math.floor(sorted.length*.95)]},scope:'JS sampling and paired map/cursor/readout draw on local headless Chromium; does not isolate compositor frame presentation or benchmark a physical phone.'};
 assert.deepEqual(errors,[]);await fs.writeFile('benchmarks/results-replay-browser.json',JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({checks:result.checks.length,layout,medianJsMs:result.pairedReplayJsMs.median,p95JsMs:result.pairedReplayJsMs.p95},null,2));
}finally{await browser.close();server?.kill();}
