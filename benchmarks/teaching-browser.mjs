import fs from 'node:fs/promises';import {spawn} from 'node:child_process';import {once} from 'node:events';import assert from 'node:assert/strict';
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
 assert.match(await page.locator('#lesson-objective').textContent(),/same PEEP increase/);
 assert.match(await page.locator('#lesson-prediction').textContent(),/Before applying/);
 assert.equal(await page.locator('#seed-a').inputValue(),await page.locator('#seed-b').inputValue());
 await page.locator('#apply-adjustment').click();await page.waitForFunction(()=>window.ardsResults[0].settings.peep===12&&document.querySelectorAll('#comparison-explanation article').length===2);
 assert.match(await page.locator('#comparison-explanation').textContent(),/tradeoff|mechanical|load/);
 assert.match(await page.locator('#adjustment-explanation').textContent(),/PEEP: 8 → 12 cmH2O/);
 assert.match(await page.locator('#adjustment-explanation').textContent(),/Why the model responds/);
 await page.locator('#vt').evaluate(el=>{el.value='7';el.dispatchEvent(new Event('input'));});
 await page.waitForFunction(()=>window.ardsResults[0].settings.vt===7);
 assert.match(await page.locator('#adjustment-explanation').textContent(),/Multiple controls changed/);
 await page.locator('#apply-adjustment').click();
 await page.waitForFunction(()=>window.ardsResults[0].settings.vt===6);
 assert.match(await page.locator('#adjustment-explanation').textContent(),/Tidal volume 6 mL\/kg PBW/);
 assert.doesNotMatch(await page.locator('#adjustment-explanation').textContent(),/Multiple controls changed/);
 await page.locator('#patient-a button[aria-label="Explain Respiratory compliance"]').click();assert.match(await page.locator('#patient-a .metric-description').textContent(),/does not prove a safer/);
 await page.screenshot({path:'benchmarks/preview-teaching.png',fullPage:true});
 await page.locator('#lesson').selectOption('wall');await page.waitForFunction(()=>window.ardsResults[1].phenotype==='wall'&&!document.getElementById('apply-adjustment').disabled);
 assert.deepEqual(await page.evaluate(()=>window.ardsResults.map(x=>x.seed)),[13791,13791]);
 await page.locator('#apply-adjustment').click();await page.waitForFunction(()=>window.ardsResults[0].settings.peep===12);
 assert.match(await page.locator('#comparison-explanation').textContent(),/mean pleural/);
 assert.match(await page.locator('#lesson-objective').textContent(),/chest-wall contribution/);
 await page.locator('#lesson').selectOption('volume');await page.waitForFunction(()=>window.ardsResults[1].phenotype==='high'&&window.ardsResults[0].settings.vt===6);
 await page.locator('#apply-adjustment').click();await page.waitForFunction(()=>window.ardsResults[0].targetVT===560);
 assert.match(await page.locator('#adjustment-explanation').textContent(),/Tidal volume: 6 → 8/);
 assert.match(await page.locator('#lesson-reflection').textContent(),/delivered volume/);
 await page.locator('#guided-mode').uncheck();await page.locator('#rr').evaluate(el=>{el.value='21';el.dispatchEvent(new Event('input'));});
 await page.waitForFunction(()=>window.ardsResults[0].settings.rr===21);assert.match(await page.locator('#status').textContent(),/Prior recruitment state retained/);
 await page.goto('http://127.0.0.1:5173/?peep=16&vt=7&seed-a=23');await page.waitForFunction(()=>window.ardsResults);
 assert.equal(await page.locator('#peep').inputValue(),'16');assert.equal(await page.locator('#vt').inputValue(),'7');assert.equal(await page.locator('#seed-a').inputValue(),'23');
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
 await page.locator('#pbw').evaluate(el=>{el.value='80';el.dispatchEvent(new Event('input'));});
 await page.waitForFunction(()=>window.ardsResults[0].targetVT===560);
 assert.equal(await page.locator('#adjustment-explanation').textContent(),'');
 assert.match(await page.locator('#baseline-status').textContent(),/configuration changed/);
 assert.deepEqual(errors,[]);
 const result={date:new Date().toISOString(),checks:['professional title and name','same-seed guided baseline','PEEP adjustment with two patient explanations','accessible compliance definition','wall comparison with pleural-pressure explanation','tidal-volume comparison','explicit state-retaining history mode','scenario link settings preserved','single-control lesson adjustment restored after free exploration','multiple-control attribution caveat','per-lesson objective and reflection','ARDS Sim branding without edition label','reference palette and persistent light/dark theme','system dark preference','320/390/1280 layouts in both themes','body-weight change invalidates comparison','no page errors']};
 await fs.writeFile('benchmarks/results-teaching-browser.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser?.close();server.kill();}
