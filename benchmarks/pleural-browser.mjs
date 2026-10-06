import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright';
const server=spawn(process.execPath,['scripts/serve.mjs'],{stdio:['ignore','pipe','inherit']});await once(server.stdout,'data');
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>window.ardsResults?.[0].trajectory.pleural);
 assert.equal(await page.locator('.all-pressures').first().evaluate(e=>e.open),false);
 assert.equal(await page.locator('#map-a').evaluate(e=>Boolean(e.compareDocumentPosition(document.getElementById('pressures-a'))&Node.DOCUMENT_POSITION_FOLLOWING)),true);
 assert.match(await page.locator('#stretch-scope').textContent(),/tissue damage is not predicted/);
 await page.locator('#ei').click();
 const verifyPes=async()=>{const expected=await page.evaluate(()=>{const r=window.ardsResults[0],f=r.trajectory.frames[r.trajectory.eiIndex],m=r.trajectory.pleural;return f.meanPleural+m.gradient*(.65-m.depMean);}),value=await page.locator('#pressures-a .pressure-cell').filter({has:page.locator('span',{hasText:'Esophageal surrogate · Pes'})}).locator('strong').textContent();assert.ok(Math.abs(Number(value)-expected)<.051);};
 await verifyPes();
 await page.locator('#unit-select-a').evaluate(e=>{e.value=42;e.dispatchEvent(new Event('input'));});assert.match(await page.locator('#unit-a').textContent(),/Current regional pleural pressure/);
 await page.locator('#map-a').scrollIntoViewIfNeeded();const before=await page.evaluate(()=>({scroll:scrollY,top:document.getElementById('map-a').getBoundingClientRect().top,count:window.ardsRenderCounter})),image=await page.locator('#map-a').evaluate(e=>e.toDataURL());
 await page.locator('#peep').evaluate(e=>{e.value=12;e.dispatchEvent(new Event('input'));});await page.waitForFunction(n=>window.ardsRenderCounter>n,before.count);
 assert.match(await page.locator('#breath-phase').textContent(),/End inspiration/);assert.equal(await page.locator('#play-breath').getAttribute('aria-pressed'),'false');
 assert.ok(Math.abs(await page.evaluate(()=>scrollY)-before.scroll)<=2,'slider update retains viewport');assert.notEqual(await page.locator('#map-a').evaluate(e=>e.toDataURL()),image);await verifyPes();
 // Higher support shows recruitment and more model stretch markers, without an injury outcome.
 const lowOver=await page.evaluate(()=>window.ardsResults[0].metrics.over),riskCount=await page.evaluate(()=>window.ardsRenderCounter);
 await page.locator('#peep').evaluate(e=>{e.value=16;e.dispatchEvent(new Event('input'));});await page.locator('#vt').evaluate(e=>{e.value=8;e.dispatchEvent(new Event('input'));});await page.waitForFunction(n=>window.ardsRenderCounter>n&&window.ardsResults[0].settings.vt===8&&window.ardsResults[0].settings.peep===16,riskCount);
 assert.match(await page.locator('#breath-phase').textContent(),/End inspiration/);assert.ok(await page.evaluate(()=>window.ardsResults[0].metrics.over)>lowOver);await verifyPes();
 await page.screenshot({path:'benchmarks/preview-pleural-high-support.png'});
 // Explicit Apply also preserves the selected phase and never navigates to the card top.
 const applyScroll=await page.evaluate(()=>scrollY),applyCount=await page.evaluate(()=>window.ardsRenderCounter);await page.locator('#apply-adjustment').evaluate(e=>e.click());await page.waitForFunction(n=>window.ardsRenderCounter>n,applyCount);await page.locator('#play-breath').evaluate(e=>e.click());
 assert.ok(Math.abs(await page.evaluate(()=>scrollY)-applyScroll)<=2,'Apply does not move viewport');
 // A rate/volume change during expiration keeps the breath progressing instead of starting over.
 await page.locator('#ee').click();await page.locator('#play-breath').click();await page.waitForFunction(()=>window.ardsDisplaySegment==='expiration'&&window.ardsReplayTime>1.3&&window.ardsReplayTime<2);
 const running=await page.evaluate(()=>({count:window.ardsRenderCounter,fraction:window.ardsReplayTime/window.ardsResults[0].trajectory.cycle}));
 await page.locator('#rr').evaluate(e=>{e.value=30;e.dispatchEvent(new Event('input'));});await page.waitForFunction(n=>window.ardsRenderCounter>n,running.count);
 assert.equal(await page.locator('#play-breath').getAttribute('aria-pressed'),'true');assert.ok(Math.abs(await page.evaluate(()=>window.ardsReplayTime/window.ardsResults[0].trajectory.cycle)-running.fraction)<.15);await page.locator('#play-breath').click();
 // Wrap blending holds calculated pressures and does not solve or grade again.
 await page.locator('#end-expiration').click();const held=await page.locator('#pressures-a').textContent(),state=await page.evaluate(()=>({count:window.ardsRenderCounter,results:JSON.stringify(window.ardsResults),loops:window.ardsLoopCounter||0}));
 await page.locator('#play-breath').click();await page.waitForFunction(()=>window.ardsDisplaySegment==='loop-transition'&&window.ardsDisplayWeight>.25&&window.ardsDisplayWeight<.65,null,{polling:10});
 assert.match(await page.locator('#breath-phase').textContent(),/Replay transition \(visual\)/);assert.equal(await page.locator('#pressures-a').textContent(),held);assert.match(await page.locator('#map-a').getAttribute('aria-label'),/Visual replay transition/);
 await page.locator('#play-breath').evaluate(e=>e.click());assert.match(await page.locator('#breath-phase').textContent(),/End expiration/);
 await page.locator('#play-breath').click();await page.waitForFunction(n=>(window.ardsLoopCounter||0)>n,state.loops);await page.locator('#play-breath').click();assert.equal(await page.evaluate(()=>window.ardsRenderCounter),state.count);assert.equal(await page.evaluate(()=>JSON.stringify(window.ardsResults)),state.results);
 // Prone reverses the slope of the same assumed pressure field, while the local surrogate remains explicit.
 await page.locator('#pressure-experiments').evaluate(e=>e.open=true);await page.locator('#posture').selectOption('prone');await page.waitForFunction(()=>window.ardsResults[0].conditions?.posture==='prone');await page.locator('#ei').click();await verifyPes();
 const slope=await page.locator('#pressure-field-a line[stroke="#9373b5"]').evaluate(e=>Number(e.getAttribute('x2'))-Number(e.getAttribute('x1')));assert.ok(slope<0);
 await page.locator('#pressure-drive').selectOption('external');await page.waitForFunction(()=>window.ardsResults[0].conditions?.drive==='external');await page.locator('#ei').click();await verifyPes();
 await page.locator('.all-pressures').first().evaluate(e=>e.open=true);await page.waitForTimeout(50);await page.reload();await page.waitForFunction(()=>window.ardsResults?.[0].trajectory.pleural);assert.equal(await page.locator('.all-pressures').first().evaluate(e=>e.open),true);await page.locator('.all-pressures').first().evaluate(e=>e.open=false);
 for(const theme of ['light','dark']){await page.emulateMedia({colorScheme:theme});for(const width of [1280,900,800,390,320]){await page.setViewportSize({width,height:900});await page.locator('#map-a').scrollIntoViewIfNeeded();await page.waitForTimeout(120);const r=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,sliders:[...document.querySelectorAll('.controls input')].every(e=>{const b=e.getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight})}));assert.equal(r.overflow,false,theme+'/'+width);assert.equal(r.sliders,true,theme+'/'+width);if(width===390)await page.screenshot({path:'benchmarks/preview-pleural-'+theme+'-mobile.png'});}}
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>document.getElementById('play-breath').disabled);assert.equal(await page.locator('#loop-breath').isDisabled(),true);
 await page.locator('#mechanics-mode').selectOption('airflow');await page.waitForFunction(()=>window.ardsResults?.[0].trajectory.kind==='frozen-aeration-airflow');assert.match(await page.locator('#pressure-field-a').textContent(),/includes resistance/);assert.equal(await page.locator('#stretch-scope').isHidden(),true);assert.match(await page.locator('#pressures-a').textContent(),/Airway − Pes surrogate/);
 assert.deepEqual(errors,[]);console.log('Pleural field and Pes surrogate, visual-first cards, phase/viewport continuity, smooth held-value wraps and flow caveats passed.');
}finally{await browser.close();server.kill();}
