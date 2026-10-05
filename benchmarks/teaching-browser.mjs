import fs from 'node:fs/promises';import {spawn} from 'node:child_process';import {once} from 'node:events';import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const server=spawn(process.execPath,['scripts/serve.mjs'],{stdio:['ignore','pipe','inherit']});let browser;
try{
 await once(server.stdout,'data');
 const args=process.env.CHROME_ARGS_FILE?JSON.parse(await fs.readFile(process.env.CHROME_ARGS_FILE,'utf8')):[];
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE_PATH||undefined,args});
 const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5173');await page.waitForFunction(()=>!document.getElementById('apply-adjustment').disabled);
 assert.equal(await page.title(),'ARDS_Sims | Regional lung mechanics');assert.equal(await page.locator('h1').textContent(),'Regional lung mechanics');
 assert.equal(await page.locator('#seed-a').inputValue(),await page.locator('#seed-b').inputValue());
 await page.locator('#apply-adjustment').click();await page.waitForFunction(()=>window.ardsResults[0].settings.peep===12&&document.querySelectorAll('#comparison-explanation article').length===2);
 assert.match(await page.locator('#comparison-explanation').textContent(),/tradeoff|mechanical|load/);
 await page.locator('#patient-a button[aria-label="Explain Respiratory compliance"]').click();assert.match(await page.locator('#patient-a .metric-description').textContent(),/does not prove a safer/);
 await page.screenshot({path:'benchmarks/preview-teaching.png',fullPage:true});
 await page.locator('#lesson').selectOption('wall');await page.waitForFunction(()=>window.ardsResults[1].phenotype==='wall'&&!document.getElementById('apply-adjustment').disabled);
 assert.deepEqual(await page.evaluate(()=>window.ardsResults.map(x=>x.seed)),[13791,13791]);
 await page.locator('#apply-adjustment').click();await page.waitForFunction(()=>window.ardsResults[0].settings.peep===12);
 assert.match(await page.locator('#comparison-explanation').textContent(),/mean pleural/);
 await page.locator('#lesson').selectOption('volume');await page.waitForFunction(()=>window.ardsResults[1].phenotype==='high'&&window.ardsResults[0].settings.vt===6);
 await page.locator('#apply-adjustment').click();await page.waitForFunction(()=>window.ardsResults[0].targetVT===560);
 await page.locator('#guided-mode').uncheck();await page.locator('#rr').evaluate(el=>{el.value='21';el.dispatchEvent(new Event('input'));});
 await page.waitForFunction(()=>window.ardsResults[0].settings.rr===21);assert.match(await page.locator('#status').textContent(),/Prior recruitment state retained/);
 await page.goto('http://127.0.0.1:5173/?peep=16&vt=7&seed-a=23');await page.waitForFunction(()=>window.ardsResults);
 assert.equal(await page.locator('#peep').inputValue(),'16');assert.equal(await page.locator('#vt').inputValue(),'7');assert.equal(await page.locator('#seed-a').inputValue(),'23');
 assert.deepEqual(errors,[]);
 const result={date:new Date().toISOString(),checks:['professional title and name','same-seed guided baseline','PEEP adjustment with two patient explanations','accessible compliance definition','wall comparison with pleural-pressure explanation','tidal-volume comparison','explicit state-retaining history mode','scenario link settings preserved','no page errors']};
 await fs.writeFile('benchmarks/results-teaching-browser.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser?.close();server.kill();}
