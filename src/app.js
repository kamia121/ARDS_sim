import {LESSONS,METRIC_HELP,explainComparison,explainAdjustment} from './teaching.js';
const $=id=>document.getElementById(id);
const worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
let request=0,compareId=0,lastResults=null,lastSweep=null,deviceResults=null,sweepId=0,phase='ee',timer,positions={};
let baseline=null,baselineConfig=null,pendingBaseline=true,comparisonFresh=true,baselineRequest=0,comparisonConfig=null;
const colors={};
function refreshColors(){const css=getComputedStyle(document.documentElement);for(const [key,token] of Object.entries({a:'--mon-current',b:'--mon-snap',open:'--open',cyclic:'--cyclic',over:'--over',closed:'--closed',surface:'--surface-2',grid:'--mon-grid'}))colors[key]=css.getPropertyValue(token).trim();}
refreshColors();
const fmt=(x,n=0)=>Number.isFinite(x)?x.toFixed(n):'--';
const pct=x=>fmt(x*100)+'%';
function settings(){return {peep:+$('peep').value,vt:+$('vt').value,rr:+$('rr').value,pressureLimit:45};}
function config(){return ['a','b'].map(k=>({kind:$('kind-'+k).value,seed:Number($('seed-'+k).value)>>>0,pbw:+$('pbw').value}));}
function labels(){for(const k of ['peep','vt','rr','pbw'])$(k+'-value').textContent=$(k).value;}
function compare(reset=false){comparisonFresh=reset||$('guided-mode').checked;labels();$('comparison-explanation').replaceChildren();$('adjustment-explanation').replaceChildren();$('status').textContent='Simulating 10 breaths in each patient...';compareId=++request;comparisonConfig=JSON.stringify(config());if(pendingBaseline)baselineRequest=compareId;worker.postMessage({id:compareId,type:'compare',config:config(),settings:settings(),reset:comparisonFresh});}
function schedule(reset=false){clearTimeout(timer);timer=setTimeout(()=>compare(reset),130);}
function metric(label,value,unit='',secondary=false,helpKey=''){
  const e=document.createElement('div');e.className='metric'+(secondary?' secondary':'');
  const v=document.createElement('strong');v.textContent=value+' ';const u=document.createElement('small');u.textContent=unit;v.append(u);
  const l=document.createElement('span');l.className='metric-label';const name=document.createElement('span');name.textContent=label;l.append(name);
  if(helpKey){const b=document.createElement('button');b.type='button';b.className='metric-help-button';b.textContent='?';b.setAttribute('aria-label','Explain '+label);b.addEventListener('click',()=>{e.closest('.patient').querySelector('.metric-description').textContent=METRIC_HELP[helpKey];});l.append(b);}
  e.append(v,l);return e;
}
function updateMetrics(k,result){
  const m=result.metrics,box=$('metrics-'+k);box.replaceChildren(
    metric('End-expiratory gas volume',fmt(m.eelv/1000,2),'L',false,'eelv'),metric('Plateau airway pressure',fmt(m.pplat,1),'cmH2O',false,'pplat'),
    metric('Driving pressure',fmt(m.dp,1),'cmH2O',false,'dp'),metric('Respiratory compliance',fmt(m.crs),'mL/cmH2O',false,'crs'),
    metric('Aerated tissue at expiration',pct(m.openEE),'',true,'openEE'),metric('Distension proxy at inspiration',pct(m.over),'',true,'over')
  );
  const patient=$('patient-'+k);
  let pressure=patient.querySelector('.pressure-summary');if(!pressure){pressure=document.createElement('p');pressure.className='pressure-summary';patient.append(pressure);}
  pressure.textContent=`Mean pleural pressure: ${fmt(m.meanPleuralEE,1)} at expiration → ${fmt(m.meanPleuralEI,1)} cmH2O at inspiration. Mean transpulmonary pressure at inspiration: ${fmt(m.pplat,1)} − ${fmt(m.meanPleuralEI,1)} = ${fmt(m.transpulmonaryEI,1)} cmH2O.`;
  let help=patient.querySelector('.metric-description');if(!help){help=document.createElement('p');help.className='metric-description';help.setAttribute('aria-live','polite');help.textContent='Select a metric’s ? button for its definition and interpretation.';patient.append(help);}
  let advanced=patient.querySelector('.advanced-metrics');if(!advanced){advanced=document.createElement('details');advanced.className='advanced-metrics';const summary=document.createElement('summary');summary.textContent='Additional model measures';advanced.append(summary);const values=document.createElement('div');values.className='metrics';advanced.append(values);patient.append(advanced);}
  advanced.querySelector('.metrics').replaceChildren(metric('Intratidal aeration gain',pct(m.cyclic),'',true,'cyclic'),metric('Perfusion-weighted closed fraction',pct(m.closedPerfusion),'',true,'closedPerfusion'));
  const delivery=$('delivery-'+k);delivery.className='delivery'+(m.limited?' limited':'');
  delivery.textContent=`VT ${fmt(m.vtDelivered)} / ${fmt(result.targetVT??settings().vt*+$('pbw').value)} mL delivered. `+(m.limited?'45 cmH2O pressure ceiling limited delivery.':'');
  if(m.limited)delivery.setAttribute('role','alert');else delivery.removeAttribute('role');
}
function renderTeaching(){
  const output=$('comparison-explanation');output.replaceChildren();$('adjustment-explanation').replaceChildren();
  if(!baseline||!lastResults)return;
  if(comparisonConfig!==baselineConfig||JSON.stringify(config())!==baselineConfig){$('baseline-status').textContent='Patient configuration changed. Set a new baseline before interpreting differences.';return;}
  if(!$('guided-mode').checked){$('baseline-status').textContent='Pressure-history mode: recruitment state is retained. Use fresh patients for a controlled comparison.';return;}
  const adjustment=explainAdjustment(baseline[0].settings,lastResults[0].settings);
  $('baseline-status').textContent='Comparing the recorded baseline with the last completed simulation.';
  for(const [key,label] of [['changed','What changed'],['held','What stayed the same'],['why','Why the model responds'],['tradeoff','Tradeoff to recognize'],['control','Comparison conditions']]){
    const p=document.createElement('p'),strong=document.createElement('strong');strong.textContent=label+': ';p.append(strong,adjustment[key]);$('adjustment-explanation').append(p);
  }
  lastResults.forEach((r,i)=>{
    const x=explainComparison(baseline[i].metrics,r.metrics),article=document.createElement('article'),h=document.createElement('h3');h.textContent='Patient '+(i?'B':'A');article.append(h);
    for(const [key,label] of [['changes','Observed changes'],['meaning','Interpretation'],['pressure','Pressure across lung tissue'],['scope','Model scope']]){const p=document.createElement('p'),strong=document.createElement('strong');p.className=key;strong.textContent=label+': ';p.append(strong,x[key]);article.append(p);}output.append(article);
  });
}
function updateLesson(){
  const lesson=LESSONS[$('lesson').value];
  $('lesson-instruction').textContent=lesson.instruction;
  $('lesson-objective').textContent=lesson.objective;
  $('lesson-prediction').textContent=lesson.prediction;
  $('lesson-reflection').textContent=lesson.reflection;
}
function setLessonBaseline(){
  const lesson=LESSONS[$('lesson').value];
  for(const [key,value] of Object.entries(lesson.baseline))$(key).value=value;
  for(const [i,k] of ['a','b'].entries()){$('kind-'+k).value=lesson.kinds[i];$('seed-'+k).value=13791;}
  $('guided-mode').checked=true;updateLesson();$('apply-adjustment').disabled=true;
  pendingBaseline=true;baseline=null;$('comparison-explanation').replaceChildren();$('adjustment-explanation').replaceChildren();invalidateSweep();clearTimeout(timer);compare(true);
}
$('set-baseline').addEventListener('click',setLessonBaseline);
$('lesson').addEventListener('change',setLessonBaseline);
$('apply-adjustment').addEventListener('click',()=>{
  if(!baseline||JSON.stringify(config())!==baselineConfig){setLessonBaseline();return;}
  $('guided-mode').checked=true;
  for(const key of ['peep','vt','rr'])$(key).value=baseline[0].settings[key];
  for(const [key,value] of Object.entries(LESSONS[$('lesson').value].adjustment))$(key).value=value;
  invalidateSweep();clearTimeout(timer);compare(true);
});
$('guided-mode').addEventListener('change',()=>{clearTimeout(timer);compare();});
function drawMap(k,result){
  const canvas=$('map-'+k),width=canvas.clientWidth,height=canvas.clientHeight,dpr=window.devicePixelRatio||1;
  canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.clearRect(0,0,width,height);
  const cx=width/2,gap=width*.04,rx=Math.min(width*.22,100),ry=height*.46,cy=height/2;
  for(const side of [-1,1]){ctx.fillStyle=colors.surface;ctx.beginPath();ctx.ellipse(cx+side*(rx+gap),cy,rx+8,ry+7,side*-.08,0,2*Math.PI);ctx.fill();}
  positions[k]=[];
  result.units.forEach((u,i)=>{
    const side=i%2?-1:1,dep=u.dep,y=cy+(dep-.5)*2*ry*.95;
    const envelope=Math.sqrt(Math.max(.06,1-((y-cy)/ry)**2));
    const jitter=(((Math.imul(i+1,2654435761)>>>0)%10000)/10000-.5)*2;
    const x=cx+side*(rx+gap)+jitter*rx*.90*envelope;
    const f=phase==='ee'?u.openEE:u.openEI;
    const high=phase==='ei'&&u.strainEI>1.65&&f>.2;
    const cyclic=Math.abs(u.openEI-u.openEE)>.08&&Math.max(u.openEI,u.openEE)>.15;
    const state=high?'over':cyclic?'cyclic':f>.35?'open':'closed';
    const radius=Math.max(2.2,Math.min(4.4,width/100))*(.7+.35*Math.sqrt(Math.max(0,f)));
    ctx.globalAlpha=state==='closed'?.85:.42+.58*f;ctx.fillStyle=colors[state];ctx.beginPath();ctx.arc(x,y,radius,0,2*Math.PI);ctx.fill();
    if(state==='cyclic'){ctx.globalAlpha=1;ctx.strokeStyle=colors.cyclic;ctx.lineWidth=.7;ctx.stroke();}
    positions[k].push({x,y,u,state});
  });ctx.globalAlpha=1;
  canvas.setAttribute('aria-label',`Patient ${k.toUpperCase()}: ${phase==='ee'?'end expiration':'end inspiration'}. Aerated fraction ${pct(phase==='ee'?result.metrics.openEE:result.metrics.openEI)}, high strain at inspiration ${pct(result.metrics.over)}. Schematic distribution; select a unit for details.`);
}
for(const k of ['a','b'])$('map-'+k).addEventListener('click',event=>{
  const rect=event.currentTarget.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;
  const nearest=positions[k]?.reduce((best,p)=>((p.x-x)**2+(p.y-y)**2)<best.distance?{...p,distance:(p.x-x)**2+(p.y-y)**2}:best,{distance:Infinity});
  if(nearest?.u&&nearest.distance<500){const u=nearest.u;$('unit-'+k).textContent=`Unit ${u.id}: open ${pct(u.openEE)} at expiration / ${pct(u.openEI)} at inspiration. Volume ratio ${fmt(u.strainEI,2)} at inspiration. Opening ${fmt(u.popen,1)}, closing ${fmt(u.pclose,1)} cmH2O transpulmonary pressure.`;}
});
const NS='http://www.w3.org/2000/svg';
function svgEl(tag,attrs={},text){const e=document.createElementNS(NS,tag);Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,String(v)));if(text!=null)e.textContent=text;return e;}
function baseChart(svg,xDomain,yDomain,xLabel,yLabel){
  const w=svg.clientWidth||500,h=260,left=58,right=15,top=24,bottom=50;
  svg.setAttribute('viewBox',`0 0 ${w} ${h}`);svg.replaceChildren();
  const x=v=>left+(v-xDomain[0])/(xDomain[1]-xDomain[0])*(w-left-right),y=v=>h-bottom-(v-yDomain[0])/(yDomain[1]-yDomain[0])*(h-top-bottom);
  for(let i=0;i<=4;i++){
    const v=yDomain[0]+i*(yDomain[1]-yDomain[0])/4;
    svg.append(svgEl('line',{x1:left,y1:y(v),x2:w-right,y2:y(v),stroke:colors.grid,'stroke-width':.6}));
    svg.append(svgEl('text',{x:left-8,y:y(v)+4,'text-anchor':'end'},fmt(v,yDomain[1]<=1?1:0)));
  }
  for(let i=0;i<=4;i++){
    const v=xDomain[0]+i*(xDomain[1]-xDomain[0])/4;
    svg.append(svgEl('text',{x:x(v),y:h-bottom+22,'text-anchor':'middle'},fmt(v,xDomain[1]<=10?1:0)));
  }
  svg.append(svgEl('line',{x1:left,y1:h-bottom,x2:w-right,y2:h-bottom,stroke:'#7E918B'}));
  svg.append(svgEl('text',{x:(left+w-right)/2,y:h-8,'text-anchor':'middle'},xLabel));
  svg.append(svgEl('text',{x:15,y:top+(h-top-bottom)/2,transform:`rotate(-90 15 ${top+(h-top-bottom)/2})`,'text-anchor':'middle'},yLabel));
  return {x,y,w,h,left,right,top,bottom};
}
function line(svg,points,scales,color,dash='',opacity=1){
  if(!points.length)return;const d=points.map((p,i)=>`${i?'L':'M'}${scales.x(p.x).toFixed(2)},${scales.y(p.y).toFixed(2)}`).join(' ');
  svg.append(svgEl('path',{d,fill:'none',stroke:color,'stroke-width':2,'stroke-dasharray':dash,opacity,'stroke-linejoin':'round'}));
}
function drawPV(){
  const svg=$('pv-chart');if(!lastResults)return;
  const points=lastResults.flatMap(r=>r.pv).filter(p=>Number.isFinite(p.volume)&&Number.isFinite(p.pressure));
  const xmin=Math.max(0,Math.floor(Math.min(...points.map(p=>p.volume))/250)*.25-.1),xmax=Math.ceil(Math.max(...points.map(p=>p.volume))/250)*.25+.1;
  const ymax=Math.max(30,Math.ceil(Math.max(...points.map(p=>p.pressure))/5)*5+5);
  const s=baseChart(svg,[xmin,xmax],[0,ymax],'Total gas volume (L)','Airway pressure (cmH2O)');
  lastResults.forEach((r,i)=>line(svg,r.pv.map(p=>({x:p.volume/1000,y:p.pressure})),s,i?colors.b:colors.a));
}
function drawSweep(){
  const svg=$('sweep-chart'),s=baseChart(svg,[4,24],[0,100],'PEEP (cmH2O)','Tissue fraction (%)');
  if(!lastSweep){svg.append(svgEl('text',{x:(s.left+s.w-s.right)/2,y:120,'text-anchor':'middle'},'No PEEP sweep results'));return;}
  lastSweep.forEach((r,i)=>{
    const c=i?colors.b:colors.a;
    line(svg,r.ascending.filter(p=>p.peep>=4).map(p=>({x:p.peep,y:p.openEE*100})),s,c);
    line(svg,r.ascending.filter(p=>p.peep>=4).map(p=>({x:p.peep,y:p.over*100})),s,c,'6 4');
    line(svg,r.descending.filter(p=>p.peep>=4).map(p=>({x:p.peep,y:p.openEE*100})),s,c,'2 4',.4);
  });
  svg.setAttribute('aria-label','PEEP sweep: solid lines show ascending aerated tissue; dashed lines show ascending high-strain tissue; faint dotted lines show descending aeration. Patient A green, Patient B blue.');
}
function render(){if(lastResults){['a','b'].forEach((k,i)=>{updateMetrics(k,lastResults[i]);drawMap(k,lastResults[i]);});drawPV();}drawSweep();}
worker.onmessage=({data})=>{
  if(data.type==='compare'){
    if(data.id!==compareId)return;lastResults=data.results;window.ardsResults=lastResults;
    $('status').textContent=`10 breaths simulated at RR ${lastResults[0].settings.rr}/min. ${comparisonFresh?'Fresh seeded patients for this comparison.':'Prior recruitment state retained.'} Pressure ceiling: 45 cmH2O.`;
    if(pendingBaseline&&data.id===baselineRequest){baseline=structuredClone(lastResults);baselineConfig=comparisonConfig;pendingBaseline=false;$('apply-adjustment').disabled=false;$('baseline-status').textContent=`Baseline recorded: PEEP ${baseline[0].settings.peep} cmH2O, VT ${baseline[0].settings.vt} mL/kg PBW, respiratory rate ${baseline[0].settings.rr}/min. Apply the adjustment, then compare the model responses below.`;$('comparison-explanation').replaceChildren();$('adjustment-explanation').replaceChildren();}else renderTeaching();
    render(); window.ardsRenderCounter=(window.ardsRenderCounter||0)+1;
    const list=document.createElement('ul');for(const item of data.modelInfo.assumptions||[]){const li=document.createElement('li');li.textContent=item;list.append(li);} $('model-info').replaceChildren(list);
  }else if(data.type==='sweep'){
    if(data.id!==sweepId)return;lastSweep=data.results;window.ardsSweep=lastSweep;drawSweep();$('sweep').disabled=false;$('sweep').textContent='Run PEEP sweep';
    $('sweep-caption').textContent='A green / B blue. Solid: ascending aerated fraction. Dashed: ascending high-strain fraction. Faint dotted: descending aeration. Fresh seeded patients; 10 breaths per PEEP step; active state preserved.';
  }else if(data.type==='benchmark-progress'){$('benchmark-status').textContent=data.message;}
  else if(data.type==='benchmark'){
    deviceResults=data.results;window.ardsBenchmark=deviceResults;$('benchmark-rows').replaceChildren();
    for(const r of deviceResults.rows){const row=document.createElement('tr');for(const v of [r.units,fmt(r.medianMs,1)+' ms',fmt(r.p95Ms,1)+' ms',fmt(r.realTimeFactor,1)+'x']){const td=document.createElement('td');td.textContent=v;row.append(td);}$('benchmark-rows').append(row);}
    $('benchmark-status').textContent=`Completed ${new Date(deviceResults.date).toLocaleString()}. Seven timed runs per size; engine only.`;$('run-benchmark').disabled=false;$('export-benchmark').disabled=false;
  }else if(data.type==='error'){
    const target=data.requestType==='benchmark'?'benchmark-status':'status';$(target).textContent='Simulation error: '+data.message;$(target).setAttribute('role','alert');$('sweep').disabled=false;$('run-benchmark').disabled=false;
  }
};
worker.onerror=event=>{$('status').textContent='The simulation could not load: '+event.message;$('status').setAttribute('role','alert');};
function invalidateSweep(){lastSweep=null;sweepId=0;window.ardsSweep=null;$('sweep').disabled=false;$('sweep').textContent='Run PEEP sweep';$('sweep-caption').textContent='Run a fresh standardized sweep for these settings.';drawSweep();}
for(const k of ['peep','vt','rr'])$(k).addEventListener('input',()=>{if(k!=='peep')invalidateSweep();labels();schedule();});
$('pbw').addEventListener('input',()=>{invalidateSweep();labels();schedule(true);});
for(const k of ['a','b'])for(const type of ['kind','seed'])$(type+'-'+k).addEventListener('change',()=>{
  const seed=$('seed-'+k);if(!Number.isFinite(Number(seed.value))||Number(seed.value)<0||Number(seed.value)>4294967295)seed.value=k==='a'?13791:14602;
  invalidateSweep();schedule();
});
for(const p of ['ee','ei'])$(p).addEventListener('click',()=>{phase=p;for(const q of ['ee','ei'])$(q).setAttribute('aria-pressed',String(q===p));render();});
$('reset').addEventListener('click',()=>{clearTimeout(timer);invalidateSweep();compare(true);});
$('new-seeds').addEventListener('click',()=>{const seeds=new Uint32Array(2);crypto.getRandomValues(seeds);$('seed-a').value=seeds[0];$('seed-b').value=seeds[1];invalidateSweep();compare(true);});
$('share').addEventListener('click',async()=>{
  const url=new URL(location.href);url.search='';for(const k of ['peep','vt','rr','pbw','kind-a','kind-b','seed-a','seed-b'])url.searchParams.set(k,$(k).value);
  try{await navigator.clipboard.writeText(url.href);$('status').textContent='Scenario link copied. It recreates the seeds and settings from fresh state; pressure history is not included.';}
  catch{window.prompt('Copy this scenario link. It starts from fresh state.',url.href);}
});
$('sweep').addEventListener('click',()=>{$('sweep').disabled=true;$('sweep').textContent='Sweeping...';sweepId=++request;worker.postMessage({id:sweepId,type:'sweep',config:config(),settings:settings()});});
$('run-benchmark').addEventListener('click',()=>{$('run-benchmark').disabled=true;worker.postMessage({id:++request,type:'benchmark'});});
$('export-benchmark').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(deviceResults,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='ARDS-Sim-device-benchmark.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
const tabs=[...document.querySelectorAll('[role=tab]')];
function selectTab(tab){for(const t of tabs){const active=t===tab;t.classList.toggle('active',active);t.setAttribute('aria-selected',String(active));$(t.getAttribute('aria-controls')).hidden=!active;}if(tab.id==='tab-explore')render();}
tabs.forEach((tab,index)=>{tab.addEventListener('click',()=>selectTab(tab));tab.addEventListener('keydown',e=>{if(['ArrowRight','ArrowLeft','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length;tabs[next].focus();selectTab(tabs[next]);}});});
window.addEventListener('resize',()=>{clearTimeout(window.ardsResize);window.ardsResize=setTimeout(render,100);});
const params=new URLSearchParams(location.search);
for(const k of ['peep','vt','rr','pbw'])if(params.has(k)){const el=$(k),v=Number(params.get(k));if(Number.isFinite(v)&&v>=+el.min&&v<=+el.max)el.value=v;}
for(const k of ['a','b']){const kind=params.get('kind-'+k);if(['high','low','wall','healthy'].includes(kind))$('kind-'+k).value=kind;const seed=Number(params.get('seed-'+k));if(params.has('seed-'+k)&&Number.isInteger(seed)&&seed>=0&&seed<=4294967295)$('seed-'+k).value=seed;}
labels();drawSweep();if(params.size){updateLesson();compare(true);}else setLessonBaseline();

const themeMedia=window.matchMedia('(prefers-color-scheme: dark)');
function currentTheme(){return document.documentElement.dataset.theme|| (themeMedia.matches?'dark':'light');}
function updateTheme(){ $('theme-toggle').textContent=currentTheme()==='dark'?'Light mode':'Dark mode';refreshColors();render();}
$('theme-toggle').addEventListener('click',()=>{
  const next=currentTheme()==='dark'?'light':'dark';document.documentElement.dataset.theme=next;
  try{localStorage.setItem('ards-theme',next);}catch{}
  updateTheme();
});
themeMedia.addEventListener('change',updateTheme);updateTheme();
