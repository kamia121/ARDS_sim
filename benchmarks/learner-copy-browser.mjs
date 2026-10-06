import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright';
const server=spawn(process.execPath,['scripts/serve.mjs'],{stdio:['ignore','pipe','inherit']});await once(server.stdout,'data');
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>window.ardsResults?.[0].trajectory);
 const original=await page.evaluate(()=>({results:JSON.stringify(window.ardsResults),renders:window.ardsRenderCounter,feedback:document.getElementById('prediction-feedback').textContent}));
 assert.equal(await page.locator('#eli5-toggle').getAttribute('aria-expanded'),'false');await page.locator('#map-a').scrollIntoViewIfNeeded();const scroll=await page.evaluate(()=>scrollY);
 await page.locator('#eli5-toggle').click();assert.equal(await page.locator('#eli5-panel').isVisible(),true);assert.match(await page.locator('#eli5-text').textContent(),/Opening more pockets is different/);
 assert.ok(Math.abs(await page.evaluate(()=>scrollY)-scroll)<2);
 const bounds=await page.locator('#eli5-panel').boundingBox();assert.ok(bounds.y>=0&&bounds.y+bounds.height<=900);
 await page.locator('#eli5-toggle').focus();await page.keyboard.press('Space');assert.equal(await page.locator('#eli5-panel').isHidden(),true);assert.equal(await page.locator('#play-breath').getAttribute('aria-pressed'),'false');
 await page.locator('#eli5-toggle').click();await page.keyboard.press('Escape');assert.equal(await page.locator('#eli5-toggle').getAttribute('aria-expanded'),'false');
 assert.equal(await page.evaluate(()=>JSON.stringify(window.ardsResults)),original.results);assert.equal(await page.evaluate(()=>window.ardsRenderCounter),original.renders);assert.equal(await page.locator('#prediction-feedback').textContent(),original.feedback);
 await page.locator('#map-help').evaluate(e=>e.open=true);assert.match(await page.locator('#map-help').textContent(),/Opening more lung tissue and stretching open tissue are different/);
 const numbers=page.locator('#map-help > .numbers-explainer');assert.equal(await numbers.evaluate(e=>e.open),false);await numbers.locator(':scope > summary').click();
 const share=page.locator('#map-help .number-topic').filter({hasText:'A percentage of all modeled tissue'});await share.evaluate(e=>e.open=true);assert.match(await share.textContent(),/20\/100 = 20%/);assert.match(await share.textContent(),/20\/60 ≈ 33%/);
 const ratio=page.locator('#map-help .number-topic').filter({hasText:'The color ratio compares'});await ratio.evaluate(e=>e.open=true);assert.match(await ratio.textContent(),/10\.2 ÷ 6 = 1\.70/);assert.match(await ratio.textContent(),/not established injury thresholds/);
 await page.locator('#learner-level').selectOption('fellow');assert.equal(await numbers.evaluate(e=>e.open),true,'learner level does not hide or force-close math');
 await page.locator('#map-help').evaluate(e=>e.open=false);await page.locator('#eli5-toggle').click();await page.locator('#mechanics-mode').selectOption('airflow');await page.waitForFunction(()=>window.ardsResults?.[0].trajectory.kind==='frozen-aeration-airflow');
 assert.equal(await page.locator('#eli5-panel').isVisible(),true);assert.match(await page.locator('#eli5-text').textContent(),/connected to straws/);await page.locator('#eli5-close').click();
 await page.locator('#map-help').evaluate(e=>e.open=true);assert.match(await page.locator('#map-help').textContent(),/earlier breath/);assert.match(await page.locator('#map-help').textContent(),/No ring can still mean/);
 await page.locator('#map-help > .numbers-explainer').evaluate(e=>e.open=true);const empty=page.locator('#map-help .number-topic').filter({hasText:'The released percentage and the blue ring'});await empty.evaluate(e=>e.open=true);assert.match(await empty.textContent(),/85% released/);assert.match(await empty.textContent(),/7\.5%/);
 const rc=page.locator('#map-help .number-topic').filter({hasText:'A simpler example: one isolated region'});await rc.evaluate(e=>e.open=true);assert.match(await rc.textContent(),/14%/);assert.match(await rc.textContent(),/37%/);assert.match(await rc.textContent(),/26%/);
 await page.locator('#patient-a button[aria-label="Explain Extra air released"]').click();assert.match(await page.locator('#patient-a .metric-description').textContent(),/Illustrative numbers/);assert.equal(await page.locator('#patient-a .metric-description details').evaluate(e=>e.open),false);
 for(const theme of ['light','dark'])for(const width of [1280,900,800,390,320]){
  await page.emulateMedia({colorScheme:theme});await page.setViewportSize({width,height:900});await page.locator('#map-help').evaluate(e=>e.open=false);await page.locator('#map-a').scrollIntoViewIfNeeded();await page.waitForTimeout(100);await page.locator('#eli5-toggle').click();const b=await page.locator('#eli5-panel').boundingBox();assert.ok(b.x>=0&&b.x+b.width<=width+1&&b.y>=0&&b.y+b.height<=900+1,theme+'/'+width);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);const visible=await page.evaluate(()=>[...document.querySelectorAll('.controls input')].every(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}));assert.equal(visible,true);if(width===390)await page.screenshot({path:'benchmarks/preview-eli5-'+theme+'.png'});await page.locator('#eli5-close').click();
 }
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>document.getElementById('play-breath').disabled);assert.equal(await page.locator('#eli5-toggle').isEnabled(),true);await page.locator('#eli5-toggle').click();assert.equal(await page.locator('#eli5-panel').isVisible(),true);
 assert.deepEqual(errors,[]);console.log('ELI5, keyboard disclosure, state preservation, two-layer map/metric math and responsive reference theme passed.');
}finally{await browser.close();server.kill();}
