import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright';
const server=spawn(process.execPath,['scripts/serve.mjs'],{stdio:['ignore','pipe','inherit']});await once(server.stdout,'data');
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>window.ardsResults?.[0].trajectory);
 for(const lesson of ['pressure-drive','prone','chest-load','healthy-dependent']){
  await page.locator('#lesson').selectOption(lesson);await page.waitForFunction(()=>!document.getElementById('apply-adjustment').disabled&&document.getElementById('baseline-status').textContent.includes('Baseline ready'));
  const baseline=await page.evaluate(()=>window.ardsResults.map(r=>({metrics:r.metrics,units:r.units,frames:r.trajectory.frames}))),renders=await page.evaluate(()=>window.ardsRenderCounter);
  for(const level of ['student','resident','fellow']){await page.locator('#learner-level').selectOption(level);assert.ok((await page.locator('#lesson-prediction').textContent()).length>20);}
  await page.locator('#learner-level').selectOption('student');await page.locator('[data-prediction="down"]').click();await page.locator('#apply-adjustment').click();await page.waitForFunction(old=>window.ardsRenderCounter>old,renders);await page.locator('#ei').click();
  assert.match(await page.locator('#prediction-feedback').textContent(),/Prediction matched|Different from your prediction/);
  const result=await page.evaluate(()=>window.ardsResults);
  if(lesson==='pressure-drive'){
   for(let i=0;i<2;i++){assert.equal(result[i].conditions.drive,'external');assert.equal(result[i].metrics.pplat,0);assert.equal(result[i].metrics.eelv,baseline[i].metrics.eelv);assert.equal(result[i].metrics.transpulmonaryEI,baseline[i].metrics.transpulmonaryEI);assert.equal(result[i].metrics.meanPleuralEI,baseline[i].metrics.meanPleuralEI-baseline[i].metrics.pplat);}
   assert.match(await page.locator('#pressures-a').textContent(),/External body pressure-/);assert.match(await page.locator('#peep-label').textContent(),/Negative pressure/);assert.equal(await page.locator('#sweep').isDisabled(),true);assert.match(await page.locator('#pv-chart').textContent(),/Transrespiratory drive/);
   await page.locator('#scenario-details').evaluate(e=>e.open=true);assert.match(await page.locator('#comparison-explanation').textContent(),/unchanged/);assert.doesNotMatch(await page.locator('#comparison-explanation').textContent(),/driving pressure falls/);await page.locator('#scenario-details').evaluate(e=>e.open=false);
  }else if(lesson==='prone'){assert.equal(result[0].conditions.posture,'prone');assert.match(await page.locator('#patient-a .orientation').last().textContent(),/prone-nondependent/);}
  else if(lesson==='chest-load'){assert.equal(result[0].conditions.chestLoad,5);assert.ok(result[0].metrics.eelv<baseline[0].metrics.eelv);}
  else {assert.equal(result[1].phenotype,'healthyDependent');assert.ok(baseline[1].metrics.openEE<.99);assert.ok(result[1].metrics.openEE>.99);}
 }
 await page.locator('#pressure-experiments').evaluate(e=>e.open=true);await page.locator('#pressure-drive').selectOption('external');await page.waitForFunction(()=>window.ardsResults?.[0].conditions?.drive==='external');
 await page.locator('#mechanics-mode').selectOption('airflow');await page.waitForFunction(()=>window.ardsResults?.[0].trajectory.kind==='frozen-aeration-airflow');
 assert.equal(await page.locator('#pressure-drive').inputValue(),'airway');for(const k of ['pressure-drive','posture','chest-load'])assert.equal(await page.locator('#'+k).isDisabled(),true);
 await page.locator('#mechanics-mode').selectOption('recruitment');await page.waitForFunction(()=>window.ardsResults?.[0].trajectory.kind==='quasi-static-steps');
 for(const theme of ['light','dark']){await page.emulateMedia({colorScheme:theme});for(const width of [1280,900,800,390,320]){await page.setViewportSize({width,height:900});await page.locator('#pressure-experiments').evaluate(e=>e.open=true);await page.locator('#map-b').scrollIntoViewIfNeeded();await page.waitForTimeout(120);const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,visible:[...document.querySelectorAll('.controls input'),document.getElementById('chest-load')].every(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})}));assert.equal(layout.overflow,false,theme+'/'+width);assert.equal(layout.visible,true,theme+'/'+width);if(width===390)await page.screenshot({path:'benchmarks/preview-experiments-'+theme+'-mobile.png'});}}
 await page.emulateMedia({reducedMotion:'reduce'});await page.locator('#lesson').selectOption('pressure-drive');await page.waitForFunction(()=>!document.getElementById('apply-adjustment').disabled);await page.locator('#apply-adjustment').click();await page.waitForFunction(()=>window.ardsResults?.[0].conditions?.drive==='external');assert.equal(await page.locator('#play-breath').isDisabled(),true);
 await page.goto('http://127.0.0.1:5173/?kind-a=healthyDependent&kind-b=healthy&pressure-drive=external&posture=prone&chest-load=3&peep=2');await page.waitForFunction(()=>window.ardsResults?.[0].conditions?.chestLoad===3);assert.equal(await page.locator('#pressure-drive').inputValue(),'external');assert.equal(await page.locator('#posture').inputValue(),'prone');assert.equal(await page.locator('#kind-a').inputValue(),'healthyDependent');
 assert.deepEqual(errors,[]);console.log('Four physiology lessons, pressure partitioning, load/posture, healthy recruitment, airflow guards, deep links and responsive controls passed.');
}finally{await browser.close();server.kill();}
