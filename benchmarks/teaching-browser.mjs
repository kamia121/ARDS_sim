import fs from 'node:fs/promises';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {spawn} from 'node:child_process';import {once} from 'node:events';import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const server=spawn(process.execPath,['scripts/serve.mjs'],{stdio:['ignore','pipe','inherit']});let browser;
try{
 await once(server.stdout,'data');
 const args=process.env.CHROME_ARGS_FILE?JSON.parse(await fs.readFile(process.env.CHROME_ARGS_FILE,'utf8')):[];
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE_PATH||undefined,args});
 const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>!document.getElementById('apply-adjustment').disabled);
 assert.equal(await page.title(),'ARDS Sim | Regional lung mechanics');assert.equal(await page.locator('h1').textContent(),'Regional lung mechanics');
 assert.equal(await page.locator('.wordmark').textContent(),'ARDS Sim');
 assert.equal(await page.locator('.edition').count(),0);
 assert.match(await page.locator('#lesson-objective').textContent(),/open.*stretch/);
 assert.match(await page.locator('#lesson-prediction').textContent(),/PEEP 8 → 12/);
 await page.locator('#patient-a .unit-inspection summary').click();await page.locator('#unit-select-a').fill('0');
 assert.match(await page.locator('#unit-a').textContent(),/Region 0:/);
 const beforeUnit=await page.locator('#unit-a').textContent();
 assert.equal(await page.locator('#seed-a').inputValue(),await page.locator('#seed-b').inputValue());
 await page.locator('#apply-adjustment').click();await page.waitForFunction(()=>window.ardsResults[0].settings.peep===12&&document.querySelectorAll('#comparison-explanation article').length===2);
 assert.match(await page.locator('#comparison-explanation').textContent(),/tradeoff|mechanical|load/);
 assert.match(await page.locator('#adjustment-explanation').textContent(),/PEEP: 8 → 12 cmH2O/);
 assert.match(await page.locator('#adjustment-explanation').textContent(),/Why the model responds/);
 assert.notEqual(await page.locator('#unit-a').textContent(),beforeUnit);
 const expectedUnit=await page.evaluate(()=>{const u=window.ardsResults[0].units[0];return Math.round(u.openEE*100)+'% before inspiration / '+Math.round(u.openEI*100)+'% at end inspiration';});
 assert.ok((await page.locator('#unit-a').textContent()).includes(expectedUnit));
 assert.equal(await page.locator('#pv-chart path').count(),6);
 assert.doesNotMatch(await page.locator('body').innerText(),/\bstrain\b/i);
 await page.locator('#vt').evaluate(el=>{el.value='7';el.dispatchEvent(new Event('input'));});
 await page.waitForFunction(()=>window.ardsResults[0].settings.vt===7);
 assert.match(await page.locator('#adjustment-explanation').textContent(),/Multiple controls changed/);
 await page.locator('#apply-adjustment').click();
 await page.waitForFunction(()=>window.ardsResults[0].settings.vt===6);
 assert.match(await page.locator('#adjustment-explanation').textContent(),/Tidal volume 6 mL\/kg PBW/);
 assert.doesNotMatch(await page.locator('#adjustment-explanation').textContent(),/Multiple controls changed/);
 await page.locator('#patient-a .advanced-metrics summary').click();await page.locator('#patient-a button[aria-label="Explain Respiratory compliance"]').click();assert.match(await page.locator('#patient-a .metric-description').textContent(),/not.*prove|does not.*safe|does not.*show|cannot.*show/i);
 await page.screenshot({path:'benchmarks/preview-teaching.png',fullPage:true});
 await page.locator('#lesson').selectOption('wall');await page.waitForFunction(()=>window.ardsResults[1].phenotype==='wall'&&!document.getElementById('apply-adjustment').disabled);
 assert.deepEqual(await page.evaluate(()=>window.ardsResults.map(x=>x.seed)),[13791,13791]);
 await page.locator('#apply-adjustment').click();await page.waitForFunction(()=>window.ardsResults[0].settings.peep===12);
 assert.match(await page.locator('#comparison-explanation').textContent(),/mean pleural/);
 assert.match(await page.locator('#lesson-objective').textContent(),/chest wall.*lung/);
 await page.locator('#lesson').selectOption('volume');await page.waitForFunction(()=>window.ardsResults[1].phenotype==='high'&&window.ardsResults[0].settings.vt===6);
 await page.locator('#apply-adjustment').click();await page.waitForFunction(()=>window.ardsResults[0].targetVT===560);
 assert.match(await page.locator('#adjustment-explanation').textContent(),/Tidal volume: 6 → 8/);
 assert.match(await page.locator('#lesson-reflection').textContent(),/volume.*delivered|delivered.*volume/i);
 await page.locator('#scenario-details').evaluate(el=>el.open=true);await page.locator('#guided-mode').uncheck();await page.locator('#rr').evaluate(el=>{el.value='21';el.dispatchEvent(new Event('input'));});
 await page.waitForFunction(()=>window.ardsResults[0].settings.rr===21);assert.match(await page.locator('#status').textContent(),/Prior recruitment state retained/);
 await page.goto('http://127.0.0.1:5173/?peep=16&vt=7&seed-a=23');await page.waitForFunction(()=>window.ardsResults);
 assert.equal(await page.locator('#peep').inputValue(),'16');assert.equal(await page.locator('#vt').inputValue(),'7');assert.equal(await page.locator('#seed-a').inputValue(),'23');
 assert.equal(await page.locator('#apply-adjustment').isDisabled(),true);
 assert.match(await page.locator('#baseline-status').textContent(),/Custom scenario/);
 assert.deepEqual(errors,[]);
 // Match the reference palette and verify theme persistence and system preferences.
 await page.emulateMedia({colorScheme:'light'});
 assert.equal(await page.locator('.masthead').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(14, 43, 115)');
 await page.locator('#theme-toggle').click();
 assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
 assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(17, 22, 21)');
 await page.reload();await page.waitForFunction(()=>window.ardsResults);
 assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
 await page.locator('#set-baseline').click();await page.waitForFunction(()=>!document.getElementById('apply-adjustment').disabled);
 await page.locator('#apply-adjustment').click();await page.waitForFunction(()=>document.querySelectorAll('#comparison-explanation article').length===2);
 for(const theme of ['dark','light']){
  if(await page.locator('html').getAttribute('data-theme')!==theme)await page.locator('#theme-toggle').click();
  for(const width of [1280,390,320]){
   await page.setViewportSize({width,height:900});await page.evaluate(()=>document.fonts.ready);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${theme} overflow at ${width}`);
   if(width===390)await page.screenshot({path:`benchmarks/preview-teaching-${theme}-mobile-top.png`});
   if(width!==320)await page.screenshot({path:`benchmarks/preview-teaching-${theme}-${width}.png`,fullPage:true});
  }
 }
 await page.evaluate(()=>localStorage.removeItem('ards-theme'));await page.emulateMedia({colorScheme:'dark'});
 await page.reload();await page.waitForFunction(()=>window.ardsResults);
 assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(17, 22, 21)');
 assert.equal(await page.locator('#theme-toggle').textContent(),'Light mode');
 const renderBeforePbw=await page.evaluate(()=>window.ardsRenderCounter);
 await page.locator('#pbw').evaluate(el=>{el.value='80';el.dispatchEvent(new Event('input'));});
 await page.waitForFunction(n=>window.ardsRenderCounter>n&&window.ardsResults[0].targetVT===560,renderBeforePbw);
 assert.equal(await page.locator('#adjustment-explanation').textContent(),'');
 assert.match(await page.locator('#baseline-status').textContent(),/configuration changed/);
 assert.deepEqual(errors,[]);
 // Deterministic delayed-response tests exercise the UI's baseline and stale-message handling.
 const race=await browser.newPage();race.on('pageerror',e=>errors.push(e.message));
 await race.addInitScript(()=>{
  const NativeWorker=window.Worker;window.__held=[];window.__hold=true;
  window.Worker=class extends NativeWorker{
   set onmessage(handler){window.__deliver=data=>handler({data});super.onmessage=event=>{if(event.data.type==='compare'&&window.__hold)window.__held.push(event.data);else handler(event);};}
  };
 });
 await race.goto('http://127.0.0.1:5173');await race.waitForFunction(()=>window.__held.length===1);
 const staleId=await race.evaluate(()=>window.__held[0].id);
 await race.locator('#peep').evaluate(el=>{el.value=14;el.dispatchEvent(new Event('input'));});
 await race.locator('#kind-b').selectOption('wall');
 assert.equal(await race.locator('#apply-adjustment').isDisabled(),true);
 await race.waitForFunction(()=>window.__held.length===2);
 await race.evaluate(()=>{window.__deliver(window.__held[0]);window.__deliver(window.__held[1]);});
 assert.equal(await race.locator('#apply-adjustment').isDisabled(),true);
 assert.equal(await race.evaluate(()=>window.ardsResults[0].settings.peep),14);
 await race.locator('#set-baseline').click();await race.waitForFunction(()=>window.__held.length===3);
 await race.locator('#scenario-details').evaluate(el=>el.open=true);await race.locator('#guided-mode').uncheck();await race.waitForFunction(()=>window.__held.length===4);
 await race.evaluate(()=>{window.__deliver(window.__held[2]);window.__deliver(window.__held[3]);});
 assert.equal(await race.locator('#apply-adjustment').isDisabled(),true);
 assert.match(await race.locator('#baseline-status').textContent(),/interrupted/);
 await race.evaluate(()=>{window.__hold=false;});
 await race.locator('#set-baseline').click();await race.waitForFunction(()=>!document.getElementById('apply-adjustment').disabled);
 assert.equal(await race.locator('#peep').inputValue(),'8');
 const stableStatus=await race.locator('#status').textContent();
 await race.evaluate(id=>window.__deliver({id,type:'error',requestType:'compare',message:'stale injected error'}),staleId);
 assert.equal(await race.locator('#status').textContent(),stableStatus);
 // A view-only change does not start a new comparison or invalidate the baseline.
 const acceptedCount=await race.evaluate(()=>window.ardsRenderCounter);
 await race.locator('#patient-a .unit-inspection').evaluate(el=>el.open=true);await race.locator('#unit-select-a').fill('5');await race.locator('#ei').click();
 assert.equal(await race.evaluate(()=>window.ardsRenderCounter),acceptedCount);
 assert.equal(await race.locator('#apply-adjustment').isDisabled(),false);
 await race.close();assert.deepEqual(errors,[]);
 const result={date:new Date().toISOString(),provenance:{checkpoint:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),scriptSha256:createHash('sha256').update(await fs.readFile('benchmarks/teaching-browser.mjs')).digest('hex'),sourceSha256:Object.fromEntries(await Promise.all(['src/app.js','src/playback.js','src/worker.js','src/session.js','src/engine.js','src/teaching.js','index.html','styles.css'].map(async file=>[file,createHash('sha256').update(await fs.readFile(file)).digest('hex')]))),workingTree:'integration changes present at run'},checks:['professional title and name','same-seed guided baseline','PEEP adjustment with two patient explanations','accessible compliance definition','wall comparison with pleural-pressure explanation','tidal-volume comparison','explicit state-retaining history mode','scenario link settings preserved','single-control lesson adjustment restored after free exploration','multiple-control attribution caveat','per-lesson objective and reflection','ARDS Sim branding without edition label','reference palette and persistent light/dark theme','system dark preference','320/390/1280 layouts in both themes','body-weight change invalidates comparison','keyboard unit selection and current details after adjustment','disconnected inspiratory/expiratory PV paths','consistent distension labels','custom scenario cannot silently become a lesson baseline','pending baseline edits and history toggle cancel baseline capture','stale errors ignored','view-only inputs preserve baseline','no page errors']};
 await fs.writeFile('benchmarks/results-teaching-browser.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser?.close();server.kill();}
