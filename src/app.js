import {sampleTrajectory,frameLabel} from './playback.js';
import {LESSONS,METRIC_HELP,explainComparison,explainAdjustment,predictionQuestion,evaluatePrediction,FLOW_LESSONS,airflowQuestion} from './teaching.js';
const $=id=>document.getElementById(id);
const worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
let request=0,compareId=0,lastResults=null,lastSweep=null,deviceResults=null,sweepId=0,benchmarkId=0,phase='ee',timer,positions={};
let baseline=null,baselineConfig=null,pendingBaseline=false,comparisonFresh=true,baselineRequest=0,comparisonConfig=null,baselineExpected=null,compareContext=null,acceptedStateToken=null,acceptedConfig=null;
const selectedUnits={a:null,b:null};
let currentFrames=[],currentFrameIndex=0,replayTime=0,raf=0,playing=false,wantPlayback=false,playStart=0,playOffset=0,prediction=null,predictionPending=null,attempts=0,correctAttempts=0,scenarioEpoch=0;
const scoredQuestions=new Set();
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
const mapGeometry={};
let recruitmentLesson='recruitment';
const recruitmentOptions=$('lesson').innerHTML,recruitmentLegend=document.querySelector('.legend').innerHTML,recruitmentHelp=$('map-help').innerHTML;
const isAirflow=()=>$('mechanics-mode').value==='airflow';
const flowParams=()=>({R0:+$('resistance').value/1000,Rp:.004});
const currentQuestion=()=>isAirflow()?airflowQuestion($('lesson').value,$('learner-level').value):predictionQuestion($('lesson').value,$('learner-level').value);
const currentLesson=()=>isAirflow()?FLOW_LESSONS[$('lesson').value]:LESSONS[$('lesson').value];
const colors={};
function refreshColors(){const css=getComputedStyle(document.documentElement);for(const [key,token] of Object.entries({a:'--mon-current',b:'--mon-snap',open:'--open',cyclic:'--cyclic',over:'--over',closed:'--closed',surface:'--surface-2',grid:'--mon-grid'}))colors[key]=css.getPropertyValue(token).trim();}
refreshColors();
const fmt=(x,n=0)=>Number.isFinite(x)?x.toFixed(n):'--';
const pct=x=>Number.isFinite(x)?fmt(x*100)+'%':'--';
function settings(){return {peep:+$('peep').value,vt:+$('vt').value,rr:+$('rr').value,pressureLimit:45};}
function config(){return ['a','b'].map(k=>({kind:$('kind-'+k).value,seed:Number($('seed-'+k).value)>>>0,pbw:+$('pbw').value}));}
function labels(){for(const k of ['peep','vt','rr','pbw','resistance'])$(k+'-value').textContent=$(k).value;}
function clearComparison(){ $('comparison-explanation').replaceChildren();$('adjustment-explanation').replaceChildren(); }
function invalidateComparison(configurationChanged=false){
  pausePlayback(false);predictionPending=null;$('prediction-feedback').textContent='';compareId=++request;compareContext=null;clearComparison();
  if(pendingBaseline||configurationChanged){
    pendingBaseline=false;baseline=null;baselineConfig=null;baselineExpected=null;baselineRequest=0;
    $('apply-adjustment').disabled=true;
    $('baseline-status').textContent=configurationChanged?'Patient configuration changed. Set a new lesson baseline before interpreting differences.':'Baseline preparation interrupted. Set the lesson baseline again before applying its adjustment.';
  }
  $('status').textContent='Settings changed; awaiting a completed simulation.';
  for(const k of ['a','b'])$('patient-'+k).setAttribute('aria-busy','true');
}
function compare(reset=false,recordBaseline=false){
  pausePlayback(false);comparisonFresh=isAirflow()||reset||$('guided-mode').checked||acceptedStateToken===null||acceptedConfig!==JSON.stringify(config());labels();clearComparison();
  $('status').textContent=isAirflow()?'Computing pressure-driven airflow and emptying…':'Simulating 10 breaths in each patient...';$('status').removeAttribute('role');
  compareId=++request;const currentConfig=config(),currentSettings=settings();comparisonConfig=JSON.stringify(currentConfig);
  const prepareAirflow=isAirflow()&&(acceptedStateToken===null||acceptedConfig!==comparisonConfig||(reset&&recordBaseline));
  compareContext={id:compareId,config:comparisonConfig,settings:currentSettings,fresh:comparisonFresh,mode:$('mechanics-mode').value,params:flowParams(),prepareAirflow,recordBaseline};
  if(recordBaseline){baselineRequest=compareId;baselineExpected={...compareContext,lesson:$('lesson').value};}
  worker.postMessage({id:compareId,type:isAirflow()&&!prepareAirflow?'airflow':'compare',config:currentConfig,settings:currentSettings,params:flowParams(),reset:prepareAirflow||comparisonFresh,baseStateToken:acceptedStateToken,recordTrajectory:!prepareAirflow});
}
function schedule(reset=false,configurationChanged=false){invalidateComparison(configurationChanged);clearTimeout(timer);timer=setTimeout(()=>compare(reset),130);}
function metric(label,value,unit='',secondary=false,helpKey='',delta=''){
  const e=document.createElement('div');e.className='metric'+(secondary?' secondary':'');
  const v=document.createElement('strong');v.textContent=value+' ';const u=document.createElement('small');u.textContent=unit;v.append(u);
  const l=document.createElement('span');l.className='metric-label';const name=document.createElement('span');name.textContent=label;l.append(name);
  if(helpKey){const b=document.createElement('button');b.type='button';b.className='metric-help-button';b.textContent='?';b.setAttribute('aria-label','Explain '+label);b.addEventListener('click',()=>{e.closest('.patient').querySelector('.metric-description').textContent=METRIC_HELP[helpKey];});l.append(b);}
  e.append(v,l);if(delta){const chip=document.createElement('small');chip.className='metric-delta';chip.textContent=delta;e.append(chip);}return e;
}
function updateMetrics(k,result){
  if(result.trajectory?.kind==='frozen-aeration-airflow'){updateAirflowMetrics(k,result);return;}
  const m=result.metrics,box=$('metrics-'+k),before=comparisonFresh&&$('guided-mode').checked?baseline?.[k==='a'?0:1]?.metrics:null;
  const delta=(key,multiplier=1,unit='')=>{if(!before||!Number.isFinite(before[key])||!Number.isFinite(m[key]))return '';const v=Number(fmt((m[key]-before[key])*multiplier,1));return `${v>0?'+':''}${fmt(v,1)} ${unit} from baseline`;};
  box.replaceChildren(
    metric('Delivered / requested',`${fmt(m.vtDelivered)} / ${fmt(result.targetVT)}`,'mL',false,'delivery',delta('vtDelivered',1,'mL')),
    metric('Driving pressure',fmt(m.dp,1),'cmH2O',false,'dp',delta('dp',1,'cmH2O')),
    metric('Open between breaths',pct(m.openEE),'',true,'openEE',delta('openEE',100,'pp')),
    metric('Distension at end inspiration',pct(m.over),'',true,'over',delta('over',100,'pp'))
  );
  const patient=$('patient-'+k);
  let pressure=patient.querySelector('.pressure-summary');if(!pressure){pressure=document.createElement('p');pressure.className='pressure-summary';patient.append(pressure);}
  pressure.textContent=`Mean pleural pressure: ${fmt(m.meanPleuralEE,1)} at expiration → ${fmt(m.meanPleuralEI,1)} cmH2O at inspiration. Mean transpulmonary pressure at inspiration: ${fmt(m.pplat,1)} − ${fmt(m.meanPleuralEI,1)} = ${fmt(m.transpulmonaryEI,1)} cmH2O.`;
  let help=patient.querySelector('.metric-description');if(!help){help=document.createElement('p');help.className='metric-description';help.setAttribute('aria-live','polite');help.textContent='';patient.append(help);}
  let advanced=patient.querySelector('.advanced-metrics');if(!advanced){advanced=document.createElement('details');advanced.className='advanced-metrics';const summary=document.createElement('summary');summary.textContent='Additional model measures';advanced.append(summary);const values=document.createElement('div');values.className='metrics';advanced.append(values);patient.append(advanced);}
  advanced.querySelector('.metrics').replaceChildren(metric('Respiratory compliance',fmt(m.crs),'mL/cmH2O',false,'crs'),metric('End-expiratory gas volume',fmt(m.eelv/1000,2),'L',false,'eelv'),metric('Plateau airway pressure',fmt(m.pplat,1),'cmH2O',false,'pplat'),metric('Intratidal aeration gain',pct(m.cyclic),'',true,'cyclic'),metric('Perfusion-weighted closed fraction',pct(m.closedPerfusion),'',true,'closedPerfusion'));
  advanced.append(pressure);
  const delivery=$('delivery-'+k);delivery.className='delivery'+(m.limited?' limited':'');
  delivery.textContent=(m.limited?`${fmt(result.settings.pressureLimit)} cmH2O pressure ceiling reached during inspiration; check actual delivered volume.`:'');
  if(m.limited)delivery.setAttribute('role','alert');else delivery.removeAttribute('role');
}
function renderTeaching(){
  const output=$('comparison-explanation');output.replaceChildren();$('adjustment-explanation').replaceChildren();
  if(!baseline||!lastResults)return;
  if(comparisonConfig!==baselineConfig||JSON.stringify(config())!==baselineConfig){$('baseline-status').textContent='Patient configuration changed. Set a new baseline before interpreting differences.';return;}
  if(!comparisonFresh||!$('guided-mode').checked){$('baseline-status').textContent='Pressure-history mode: recruitment state is retained. Use fresh patients for a controlled comparison.';return;}
  if(isAirflow()){renderAirflowTeaching();return;}
  const adjustment=explainAdjustment(baseline[0].settings,lastResults[0].settings);
  if(!predictionPending)$('prediction-feedback').textContent=adjustment.changed+(adjustment.control.startsWith('Multiple')?' Multiple controls changed; isolate one change to explain its effect.':'');
  $('baseline-status').textContent='Comparing the recorded baseline with the last completed simulation.';
  for(const [key,label] of [['changed','What changed'],['held','What stayed the same'],['why','Why the model responds'],['tradeoff','Tradeoff to recognize'],['control','Comparison conditions']]){
    const p=document.createElement('p'),strong=document.createElement('strong');strong.textContent=label+': ';p.append(strong,adjustment[key]);$('adjustment-explanation').append(p);
  }
  lastResults.forEach((r,i)=>{
    const x=explainComparison(baseline[i].metrics,r.metrics),article=document.createElement('article'),h=document.createElement('h3');h.textContent='Patient '+(i?'B':'A');article.append(h);
    for(const [key,label] of [['changes','Observed changes'],['meaning','Why it matters'],...($('lesson').value==='wall'||$('learner-level').value==='fellow'?[['pressure','Pressure across lung tissue']]:[])]){const p=document.createElement('p'),strong=document.createElement('strong');p.className=key;strong.textContent=label+': ';p.append(strong,x[key]);article.append(p);}output.append(article);
  });
}
function updateLesson(){
  const lesson=currentLesson();
  $('lesson-instruction').textContent=lesson.instruction;
  $('lesson-objective').textContent=lesson.objective||lesson.instruction;
  updateQuestion();
  $('lesson-reflection').textContent=lesson.reflection;
}
function updateQuestion(){
  const q=currentQuestion();$('lesson-prediction').textContent=q.prompt;
  const names=q.betweenPatients?{up:'Higher in B',same:'Similar',down:'Lower in B'}:{up:'Increase',same:'Little change',down:'Decrease'};
  for(const b of document.querySelectorAll('[data-prediction]')){b.textContent=names[b.dataset.prediction];b.setAttribute('aria-pressed',String(b.dataset.prediction===prediction));}
  $('lesson-objective').textContent=q.focus;
  $('prediction-band').textContent=`For this exercise, similar/little change means within ±${q.band} ${q.unit==='%'?'percentage point':q.unit}. This is a display band, not clinical significance.`;
}
for(const b of document.querySelectorAll('[data-prediction]'))b.addEventListener('click',()=>{
  prediction=b.dataset.prediction;updateQuestion();$('prediction-feedback').textContent='Prediction recorded. Apply the change, then compare.';
});
$('learner-level').addEventListener('change',()=>{for(const b of document.querySelectorAll('[data-prediction]'))b.disabled=false;prediction=null;predictionPending=null;$('prediction-feedback').textContent='';updateQuestion();renderFrame();});
function setLessonBaseline(){
  pausePlayback();scenarioEpoch++;prediction=null;predictionPending=null;$('prediction-feedback').textContent='';
  for(const b of document.querySelectorAll('[data-prediction]'))b.disabled=false;
  const lesson=currentLesson();
  for(const [key,value] of Object.entries(lesson.baseline))$(key).value=value;
  for(const [i,k] of ['a','b'].entries()){$('kind-'+k).value=lesson.kinds[i];$('seed-'+k).value=13791;}
  $('guided-mode').checked=true;updateLesson();$('apply-adjustment').disabled=true;
  pendingBaseline=true;baseline=null;baselineExpected=null;$('comparison-explanation').replaceChildren();$('adjustment-explanation').replaceChildren();invalidateSweep();clearTimeout(timer);compare(true,true);
}
$('set-baseline').addEventListener('click',setLessonBaseline);
$('lesson').addEventListener('change',setLessonBaseline);
$('apply-adjustment').addEventListener('click',()=>{
  if(!baseline||JSON.stringify(config())!==baselineConfig){setLessonBaseline();return;}
  $('guided-mode').checked=true;
  for(const key of ['peep','vt','rr'])$(key).value=baseline[0].settings[key];
  if(isAirflow())$('resistance').value=baseline[0].airflow.params.R0*1000;
  for(const [key,value] of Object.entries(currentLesson().adjustment))$(key).value=value;
  $('prediction-feedback').textContent=prediction?'Testing your prediction…':'Applying the change…';
  predictionPending={question:currentQuestion(),prediction,before:baseline,lesson:$('lesson').value,level:$('learner-level').value,key:`${$('mechanics-mode').value}/${scenarioEpoch}/${$('lesson').value}/${$('learner-level').value}`};
  for(const b of document.querySelectorAll('[data-prediction]'))b.disabled=true;
  wantPlayback=!reducedMotion.matches;invalidateSweep();clearTimeout(timer);compare(true);predictionPending.id=compareId;
});
$('guided-mode').addEventListener('change',()=>{invalidateComparison();clearTimeout(timer);compare();});
function drawMap(k,result,frame){
  const canvas=$('map-'+k),width=canvas.clientWidth,height=canvas.clientHeight,dpr=window.devicePixelRatio||1,key=`${width}/${height}/${dpr}`;
  let geo=mapGeometry[k];
  if(!geo||geo.key!==key||geo.units!==result.units){
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    const cx=width/2,gap=width*.04,rx=Math.min(width*.22,100),ry=height*.43,cy=height/2;
    geo={key,units:result.units,cx,gap,rx,ry,cy,points:result.units.map((u,i)=>{const side=i%2?-1:1,y=(u.dep-.5)*2*ry*.95,envelope=Math.sqrt(Math.max(.06,1-(y/ry)**2)),jitter=(((Math.imul(i+1,2654435761)>>>0)%10000)/10000-.5)*2;return {side,dx:jitter*rx*.90*envelope,dy:y};})};mapGeometry[k]=geo;
  }
  const {cx,gap,rx,ry,cy}=geo,ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
  const ei=result.trajectory?.frames[result.trajectory.eiIndex],volume=frame?.volume??(phase==='ei'?result.metrics.eelv+result.metrics.vtDelivered:result.metrics.eelv);
  const sharedPeak=Math.max(...lastResults.map(r=>r.trajectory?.frames[r.trajectory.eiIndex].volume||r.metrics.eelv+r.metrics.vtDelivered));
  const scale=Math.sqrt(Math.max(0,volume)/sharedPeak);
  for(const side of [-1,1]){ctx.fillStyle=colors.surface;ctx.beginPath();ctx.ellipse(cx+side*(rx+gap),cy,(rx+6)*scale,(ry+5)*scale,side*-.08,0,2*Math.PI);ctx.fill();}
  positions[k]=[];
  result.units.forEach((u,i)=>{
    const pos=geo.points[i],x=cx+pos.side*(rx+gap)+pos.dx*scale,y=cy+pos.dy*scale;
    const f=frame?frame.unitOpen[i]:phase==='ei'?u.openEI:u.openEE;
    const atEI=frame?frame===ei:phase==='ei',high=atEI&&u.strainEI>1.65&&f>.2;
    const flowMode=result.trajectory?.kind==='frozen-aeration-airflow',cyclic=!flowMode&&f-u.openEE>.08&&f>.15;
    const state=high?'over':f>.35?'open':'closed';
    const v=frame?frame.unitVolume[i]:phase==='ei'?u.volumeEI:u.volumeEE;
    const radius=Math.max(1.15,Math.sqrt(Math.max(0,v)*12/Math.PI));
    ctx.globalAlpha=state==='closed'?.75:.4+.6*f;ctx.fillStyle=colors[state];ctx.beginPath();ctx.arc(x,y,radius,0,2*Math.PI);ctx.fill();
    if(cyclic){ctx.globalAlpha=1;ctx.strokeStyle=colors.cyclic;ctx.lineWidth=1;ctx.stroke();}
    if(high){ctx.globalAlpha=Math.max(.2,f);ctx.strokeStyle=colors.over;ctx.lineWidth=1.2;ctx.strokeRect(x-radius-1,y-radius-1,2*radius+2,2*radius+2);}
    if(flowMode&&u.active&&u.volumeEI-u.relaxedVolume>1e-9&&v-u.relaxedVolume>.1*(u.volumeEI-u.relaxedVolume)){ctx.globalAlpha=.8;ctx.strokeStyle='#798ec5';ctx.lineWidth=.8;ctx.beginPath();ctx.arc(x,y,radius+1.2,0,2*Math.PI);ctx.stroke();}
    positions[k].push({x,y,u,state});
  });ctx.globalAlpha=1;
  const name=frame&&result.trajectory?frameLabel(frame,currentFrameIndex,result.trajectory):phase==='ei'?'end inspiration':'before inspiration';
  canvas.setAttribute('aria-label',`Patient ${k.toUpperCase()}: ${name}. Open tissue ${pct(frame?.open??result.metrics.openEE)}. End-inspiratory distension proxy ${pct(result.metrics.over)}. Select a region or enter its number.`);
}
function updateUnitDetail(k,result){
  const id=selectedUnits[k],u=id===null?null:result?.units.find(unit=>unit.id===id);
  const current=currentFrames[k==='a'?0:1];
  const text=u?`Unit ${u.id}: open ${pct(u.openEE)} before inspiration / ${pct(u.openEI)} at end inspiration. Fully open volume ratio ${fmt(u.strainEI,2)} at inspiration. Opening ${fmt(u.popen,1)}, closing ${fmt(u.pclose,1)} cmH2O transpulmonary pressure.`:'Select a lung unit on the map or enter its number to inspect the current result.';
  if(u&&result.trajectory?.kind==='frozen-aeration-airflow'){const i=result.units.indexOf(u),q=current?.unitFlow?.[i],node=current?current.pressure-result.airflow.params.R0*current.flow:null,palv=Number.isFinite(node)&&u.active?node-u.resistance*q:null;const detail=`Region ${u.id}: flow ${fmt(q,2)} mL/s (+ in, − out); intrinsic RC ${Number.isFinite(u.tauLocal)&&u.tauLocal<.001?'<0.001':fmt(u.tauLocal,3)} s; excess gas emptied ${Number.isFinite(u.fractionEmptied)?pct(u.fractionEmptied):'--'}; alveolar pressure ${fmt(palv,1)} cmH2O. RC excludes shared resistance and chest wall.${Number.isFinite(u.fractionEmptied)&&(u.fractionEmptied>1||u.fractionEmptied<0)?' The regional fraction can exceed its relaxed reference through redistribution.':''}`;$('unit-'+k).textContent=detail;return;}
  const display=u&&current?text+` Selected phase: open ${pct(current.unitOpen[u.id])}, gas volume ${fmt(current.unitVolume[u.id],2)} mL.`:text;
  if($('unit-'+k).textContent!==display)$('unit-'+k).textContent=display;
}
for(const [i,k] of ['a','b'].entries()){
  $('map-'+k).addEventListener('click',event=>{
    const rect=event.currentTarget.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;
    const nearest=positions[k]?.reduce((best,p)=>((p.x-x)**2+(p.y-y)**2)<best.distance?{...p,distance:(p.x-x)**2+(p.y-y)**2}:best,{distance:Infinity});
    if(nearest?.u&&nearest.distance<500){selectedUnits[k]=nearest.u.id;$('unit-select-'+k).value=nearest.u.id;updateUnitDetail(k,lastResults?.[i]);}
  });
  $('unit-select-'+k).addEventListener('input',()=>{
    const value=$('unit-select-'+k).value,id=Number(value);
    if(value!==''&&Number.isInteger(id)&&lastResults?.[i].units.some(u=>u.id===id)){selectedUnits[k]=id;updateUnitDetail(k,lastResults[i]);}
    else if(value===''){selectedUnits[k]=null;updateUnitDetail(k,lastResults?.[i]);}
    else $('unit-'+k).textContent='Enter a whole-number unit from 0 to 511.';
  });
}
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
  const s=baseChart(svg,[xmin,xmax],[0,ymax],'Total gas volume (L)','Airway pressure (cmH2O)');window.ardsPVScales=s;
  lastResults.forEach((r,i)=>{const t=r.trajectory;if(t){const a=t.frames[t.eiIndex],b=t.frames[t.releaseIndex];line(svg,[{x:a.volume/1000,y:a.pressure},{x:b.volume/1000,y:b.pressure}],s,i?colors.b:colors.a,'3 4',.65);}for(const phase of ['inflation','deflation'])line(svg,r.pv.filter(p=>p.phase===phase).map(p=>({x:p.volume/1000,y:p.pressure})),s,i?colors.b:colors.a);});
}
function drawSweep(){
  const svg=$('sweep-chart'),s=baseChart(svg,[4,24],[0,100],'PEEP (cmH2O)','Tissue fraction (%)');
  if(!lastSweep){svg.append(svgEl('text',{x:(s.left+s.w-s.right)/2,y:120,'text-anchor':'middle'},'No PEEP sweep results'));return;}
  lastSweep.forEach((r,i)=>{
    const c=i?colors.b:colors.a;
    line(svg,r.ascending.filter(p=>p.peep>=4).map(p=>({x:p.peep,y:p.openEE*100})),s,c);
    line(svg,r.ascending.filter(p=>p.peep>=4).map(p=>({x:p.peep,y:p.over*100})),s,c,'6 4');
    line(svg,r.descending.filter(p=>p.peep>=4).map(p=>({x:p.peep,y:p.openEE*100})),s,c,'2 4',.4);
    for(const p of r.ascending.filter(p=>p.peep>=4&&p.limited))svg.append(svgEl('circle',{cx:s.x(p.peep),cy:s.y(p.openEE*100),r:5,fill:'none',stroke:'#E8B962','stroke-width':2},null));
  });
  svg.setAttribute('aria-label','PEEP sweep: solid lines show ascending aerated tissue; dashed lines show ascending distension proxy; faint dotted lines show descending aeration. Patient A green, Patient B blue. Outlined markers indicate inspiratory pressure-ceiling exposure.');
}
function render(){if(lastResults){['a','b'].forEach((k,i)=>{updateMetrics(k,lastResults[i]);drawMap(k,lastResults[i],currentFrames[i]);updateUnitDetail(k,lastResults[i]);});drawPV();drawFlow();renderFrame();}drawSweep();}
worker.onmessage=({data})=>{
  if(data.type==='compare'||data.type==='airflow'){
    if(data.id!==compareId||compareContext?.id!==data.id||compareContext.mode!==$('mechanics-mode').value)return;
    if(JSON.stringify(data.config)!==compareContext.config||compareContext.config!==JSON.stringify(config())||JSON.stringify(compareContext.settings)!==JSON.stringify(settings()))return;
    if(isAirflow()&&JSON.stringify(compareContext.params)!==JSON.stringify(flowParams()))return;
    if(data.type==='compare'){acceptedStateToken=data.stateToken;acceptedConfig=compareContext.config;worker.postMessage({id:data.stateToken,type:'accept-state'});}
    if(compareContext.prepareAirflow){const capture=compareContext.recordBaseline;compare(false,capture);return;}
    if(data.type==='airflow')for(const result of data.results)for(const frame of result.trajectory.frames)frame.unitOpen=result.trajectory.frozenOpen;
    lastResults=data.results;window.ardsResults=lastResults;comparisonFresh=compareContext.fresh;replayTime=0;currentFrameIndex=0;currentFrames=lastResults.map(r=>r.trajectory?.frames[0]);
    for(const k of ['a','b'])$('patient-'+k).removeAttribute('aria-busy');
    $('status').textContent=data.type==='airflow'?`Frozen aeration · ${lastResults[0].breaths}/${lastResults[1].breaths} settling breaths · ${lastResults.every(r=>r.metrics.converged)?'near-periodic cycle':'periodicity criterion not reached'}.`:`10 breaths simulated at RR ${lastResults[0].settings.rr}/min. ${comparisonFresh?'Fresh seeded patients for this comparison.':'Prior recruitment state retained.'} Pressure ceiling: ${fmt(lastResults[0].settings.pressureLimit)} cmH2O.`;
    if(pendingBaseline&&data.id===baselineRequest&&baselineExpected?.fresh&&baselineExpected.config===compareContext.config&&JSON.stringify(baselineExpected.settings)===JSON.stringify(compareContext.settings)&&baselineExpected.lesson===$('lesson').value&&baselineExpected.mode===$('mechanics-mode').value){baseline=lastResults.map(({trajectory,...summary})=>structuredClone(summary));baselineConfig=comparisonConfig;pendingBaseline=false;$('apply-adjustment').disabled=false;$('baseline-status').textContent='Baseline ready. Predict, then apply the change.';$('comparison-explanation').replaceChildren();$('adjustment-explanation').replaceChildren();}else renderTeaching();
    if(predictionPending?.id===data.id&&predictionPending.lesson===$('lesson').value&&predictionPending.level===$('learner-level').value){
      const answer=evaluatePrediction(predictionPending.question,predictionPending.before,lastResults,predictionPending.prediction);
      if(answer.correct!==null&&!scoredQuestions.has(predictionPending.key)){scoredQuestions.add(predictionPending.key);attempts++;if(answer.correct)correctAttempts++;}
      $('prediction-feedback').textContent=(answer.correct===true?'Prediction matched. ':answer.correct===false?'Different from your prediction. ':'Observe the result. ')+answer.observed+' '+predictionPending.question.focus+(answer.correct!==null?` (${correctAttempts}/${attempts} predictions matched this session.)`:'');
      predictionPending=null;
    }
    render();if(wantPlayback&&!reducedMotion.matches){$('patient-a').scrollIntoView({block:'start',behavior:'auto'});startPlayback();} window.ardsRenderCounter=(window.ardsRenderCounter||0)+1;
    const list=document.createElement('ul');for(const item of data.modelInfo.assumptions||[]){const li=document.createElement('li');li.textContent=item;list.append(li);} $('model-info').replaceChildren(list);
  }else if(data.type==='sweep'){
    if(data.id!==sweepId)return;lastSweep=data.results;window.ardsSweep=lastSweep;drawSweep();$('sweep').disabled=false;$('sweep').textContent='Run PEEP sweep';
    $('sweep-caption').textContent='A green / B blue. Solid: ascending aerated fraction. Dashed: ascending distension proxy. Outlined markers: inspiratory pressure ceiling reached; final delivery may differ. Faint dotted: descending aeration. Fresh seeded patients; 10 breaths per PEEP step; active state preserved.';
  }else if(data.type==='benchmark-progress'){if(data.id===benchmarkId)$('benchmark-status').textContent=data.message;}
  else if(data.type==='benchmark'){
    if(data.id!==benchmarkId)return;deviceResults=data.results;window.ardsBenchmark=deviceResults;$('benchmark-rows').replaceChildren();
    for(const r of deviceResults.rows){const row=document.createElement('tr');for(const v of [r.units,fmt(r.medianMs,1)+' ms',fmt(r.p95Ms,1)+' ms',fmt(r.realTimeFactor,1)+'x']){const td=document.createElement('td');td.textContent=v;row.append(td);}$('benchmark-rows').append(row);}
    $('benchmark-status').textContent=`Completed ${new Date(deviceResults.date).toLocaleString()}. Seven timed runs per size; engine only.`;$('run-benchmark').disabled=false;$('export-benchmark').disabled=false;
  }else if(data.type==='error'){
    const currentId=data.requestType==='benchmark'?benchmarkId:data.requestType==='sweep'?sweepId:(data.requestType==='compare'||data.requestType==='airflow')?compareId:null;if(data.id!==currentId)return;
    if(data.requestType==='airflow'){predictionPending=null;lastResults=null;currentFrames=[];$('play-breath').disabled=true;$('breath-frame').disabled=true;for(const k of ['a','b']){$('metrics-'+k).replaceChildren();$('live-'+k).textContent='No valid airflow result for these settings.';const c=$('map-'+k);c.getContext('2d').clearRect(0,0,c.width,c.height);}}
    if(data.requestType==='compare'||data.requestType==='airflow'){pendingBaseline=false;$('apply-adjustment').disabled=true;for(const k of ['a','b'])$('patient-'+k).removeAttribute('aria-busy');}
    const target=data.requestType==='benchmark'?'benchmark-status':'status';$(target).textContent='Simulation error: '+data.message;$(target).setAttribute('role','alert');if(data.requestType==='sweep'){$('sweep').disabled=false;$('sweep').textContent='Run PEEP sweep';}if(data.requestType==='benchmark')$('run-benchmark').disabled=false;
  }
};
worker.onerror=event=>{$('status').textContent='The simulation could not load: '+event.message;$('status').setAttribute('role','alert');};
function invalidateSweep(){lastSweep=null;sweepId=0;window.ardsSweep=null;$('sweep').disabled=false;$('sweep').textContent='Run PEEP sweep';$('sweep-caption').textContent='Run a fresh standardized sweep for these settings.';drawSweep();}
for(const k of ['peep','vt','rr'])$(k).addEventListener('input',()=>{if(k!=='peep')invalidateSweep();labels();schedule();});
$('resistance').addEventListener('input',()=>{labels();schedule();});
$('pbw').addEventListener('input',()=>{invalidateSweep();labels();schedule(true,true);});
for(const k of ['a','b'])for(const type of ['kind','seed'])$(type+'-'+k).addEventListener('change',()=>{
  const seed=$('seed-'+k);if(!Number.isFinite(Number(seed.value))||Number(seed.value)<0||Number(seed.value)>4294967295)seed.value=k==='a'?13791:14602;
  invalidateSweep();schedule(false,true);
});
$('ee').addEventListener('click',()=>inspectFrame(0));
$('ei').addEventListener('click',()=>inspectFrame(lastResults?.[0].trajectory?.eiIndex??0));
$('release-breath').addEventListener('click',()=>inspectFrame(lastResults?.[0].trajectory?.releaseIndex??0));
$('end-expiration').addEventListener('click',()=>inspectFrame((lastResults?.[0].trajectory?.frames.length??1)-1));
$('reset').addEventListener('click',()=>{invalidateComparison();clearTimeout(timer);invalidateSweep();compare(true);});
$('new-seeds').addEventListener('click',()=>{const seeds=new Uint32Array(2);crypto.getRandomValues(seeds);invalidateComparison(true);$('seed-a').value=seeds[0];$('seed-b').value=seeds[1];invalidateSweep();compare(true);});
$('share').addEventListener('click',async()=>{
  const url=new URL(location.href);url.search='';for(const k of ['peep','vt','rr','pbw','kind-a','kind-b','seed-a','seed-b'])url.searchParams.set(k,$(k).value);
  if(isAirflow()){url.searchParams.set('mode','airflow');url.searchParams.set('resistance',$('resistance').value);}
  try{await navigator.clipboard.writeText(url.href);$('status').textContent='Scenario link copied. It recreates the seeds and settings from fresh state; pressure history is not included.';}
  catch{window.prompt('Copy this scenario link. It starts from fresh state.',url.href);}
});
$('sweep').addEventListener('click',()=>{$('sweep').disabled=true;$('sweep').textContent='Sweeping...';sweepId=++request;worker.postMessage({id:sweepId,type:'sweep',config:config(),settings:settings()});});
$('run-benchmark').addEventListener('click',()=>{$('run-benchmark').disabled=true;benchmarkId=++request;worker.postMessage({id:benchmarkId,type:'benchmark'});});
$('export-benchmark').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(deviceResults,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='ARDS-Sim-device-benchmark.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
const tabs=[...document.querySelectorAll('[role=tab]')];
function selectTab(tab){pausePlayback();for(const t of tabs){const active=t===tab;t.classList.toggle('active',active);t.setAttribute('aria-selected',String(active));$(t.getAttribute('aria-controls')).hidden=!active;}if(tab.id==='tab-explore')render();}
tabs.forEach((tab,index)=>{tab.addEventListener('click',()=>selectTab(tab));tab.addEventListener('keydown',e=>{if(['ArrowRight','ArrowLeft','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length;tabs[next].focus();selectTab(tabs[next]);}});});
window.addEventListener('resize',()=>{clearTimeout(window.ardsResize);window.ardsResize=setTimeout(render,100);});
function pausePlayback(clearIntent=true){
  if(raf)cancelAnimationFrame(raf);raf=0;playing=false;if(clearIntent)wantPlayback=false;
  $('play-breath').textContent='Play breath';$('play-breath').setAttribute('aria-pressed','false');
}
function inspectFrame(index){
  pausePlayback();const t=lastResults?.[0].trajectory;if(!t)return;
  const i=Math.max(0,Math.min(t.frames.length-1,Math.trunc(index)||0)),frame=t.frames[i];replayTime=frame.time;currentFrameIndex=i;currentFrames=lastResults.map(r=>r.trajectory.frames[i]);renderFrame(true);
}
function renderFrame(announce=false){
  const trajectory=lastResults?.[0].trajectory;if(!trajectory)return;
  const selected=trajectory.frames[currentFrameIndex],name=frameLabel(currentFrames[0]||selected,currentFrameIndex,trajectory);
  $('play-breath').disabled=reducedMotion.matches||!trajectory.frames.length;$('play-breath').textContent=reducedMotion.matches?'Motion reduced':playing?'Pause':'Play breath';
  $('breath-frame').disabled=false;$('breath-frame').max=trajectory.frames.length-1;$('breath-frame').value=currentFrameIndex;
  $('breath-frame').setAttribute('aria-valuetext',`${name}, ${fmt(replayTime,2)} seconds`);
  $('breath-phase').textContent=`${name==='End inspiration'&&playing?'End inspiration (inspect)':name} · ${fmt(replayTime,2)} / ${fmt(trajectory.cycle,2)} s`;
  $('ee').setAttribute('aria-pressed',String(currentFrameIndex===0&&!playing));$('ei').setAttribute('aria-pressed',String(currentFrames[0]===trajectory.frames[trajectory.eiIndex]));$('release-breath').setAttribute('aria-pressed',String(currentFrames[0]===trajectory.frames[trajectory.releaseIndex]));$('end-expiration').setAttribute('aria-pressed',String(currentFrameIndex===trajectory.frames.length-1));
  const label=name;
  const phasePrompts={
    'Before inspiration':'Grey regions contribute less to the breath. Watch whether they open as pressure rises.',
    'Inspiration':'Open regions fill with gas. Orange rings appear where more tissue opens during the breath.',
    'End inspiration':'Compare the recruited areas with the red squares: more lung can open while other regions overstretch.',
    'Start expiration':'Airway pressure returns to PEEP, but regional gas volume is continuous and begins to empty through resistance.',
    'Pressure release':'Gas volume drops immediately as pressure returns to PEEP; this model has no airway resistance.',
    'Expiration':'PEEP is the pressure left between breaths. Watch which regions stay open and which lose aeration.',
    'End expiration':'This is the end of the recorded breath. Compare with the start; ten breaths need not be steady state.'
  };
  $('phase-story').textContent=reducedMotion.matches?'Motion is reduced. Use the phase buttons or scrubber to inspect the computed breath.':phasePrompts[label]||phasePrompts.Inspiration;
  if(trajectory.kind==='frozen-aeration-airflow'&&!reducedMotion.matches){const messages={'Before inspiration':'This is gas remaining from the preceding cycle. Aeration is held fixed.','Inspiration':'Flow fills the fixed open regions. Airway pressure includes the resistive load.','End inspiration':'Flow is still entering at this snapshot. The displayed peak pressure is not a measured plateau.','Start expiration':'Pressure returns to PEEP, while gas volume remains continuous and flow turns outward.','Expiration':'Gas leaves through resistance. Watch the expiratory flow approach zero.','End expiration':'Compare remaining gas and end-expiratory flow before the next breath begins.'};$('phase-story').textContent=messages[name]||messages.Inspiration;}
  if(currentFrames.some(f=>f?.ceilingActive))$('phase-story').textContent='The pressure ceiling constrains this part of inspiration. Compare delivered with requested volume.';
  lastResults.forEach((r,i)=>{const frame=currentFrames[i];if(!frame)return;const k=i?'b':'a';drawMap(k,r,frame);$('live-'+k).textContent=r.trajectory.kind==='frozen-aeration-airflow'?`${fmt(frame.volume/1000,2)} L · Paw ${fmt(frame.pressure,1)} cmH2O · Flow ${fmt(frame.flow/1000,2)} L/s`:$('lesson').value==='wall'||$('learner-level').value!=='student'?`${fmt(frame.volume/1000,2)} L · ${pct(frame.open)} open · Paw ${fmt(frame.pressure,1)} − Ppl ${fmt(frame.meanPleural,1)} = PL ${fmt(frame.pressure-frame.meanPleural,1)} cmH2O`:`${fmt(frame.volume/1000,2)} L · Paw ${fmt(frame.pressure,1)} cmH2O · ${pct(frame.open)} open`;$('unit-'+k).setAttribute('aria-live',playing?'off':'polite');if(!playing||(r.trajectory.kind==='frozen-aeration-airflow'&&selectedUnits[k]!==null))updateUnitDetail(k,r);});
  if(isAirflow()&&window.ardsFlowScales){const scales=window.ardsFlowScales;document.querySelectorAll('#flow-chart .breath-cursor').forEach(e=>e.remove());currentFrames.forEach((frame,i)=>$('flow-chart').append(svgEl('circle',{class:'breath-cursor',cx:scales.x(replayTime),cy:scales.y(frame.flow/1000),r:4,fill:i?colors.b:colors.a})));}
  if(announce)$('breath-announce').textContent=$('breath-phase').textContent;
  if(window.ardsPVScales){const scales=window.ardsPVScales;document.querySelectorAll('#pv-chart .breath-cursor').forEach(e=>e.remove());currentFrames.forEach((frame,i)=>{if(frame)$('pv-chart').append(svgEl('circle',{class:'breath-cursor',cx:scales.x(frame.volume/1000),cy:scales.y(frame.pressure),r:4,fill:i?colors.b:colors.a,stroke:'#fff','stroke-width':1}));});}
}
function tickPlayback(now){
  if(!playing||document.hidden||$('explore').hidden||reducedMotion.matches){pausePlayback();return;}
  const drawStart=performance.now();
  const t=lastResults[0].trajectory,elapsed=(now-playStart)/1000+playOffset,hold=.45;
  replayTime=elapsed<t.ti?elapsed:elapsed<t.ti+hold?t.ti:elapsed-hold;
  replayTime=Math.min(t.cycle,replayTime);
  const samples=lastResults.map(r=>sampleTrajectory(r.trajectory,replayTime));currentFrames=samples.map(s=>s.frame);currentFrameIndex=samples[0].index;
  window.ardsAnimationCounter=(window.ardsAnimationCounter||0)+1;renderFrame();
  if(window.ardsReplayTimings.length<240)window.ardsReplayTimings.push(performance.now()-drawStart);
  if(replayTime>=t.cycle){pausePlayback();renderFrame(true);return;}
  raf=requestAnimationFrame(tickPlayback);
}
function startPlayback(){
  const t=lastResults?.[0].trajectory;if(!t||reducedMotion.matches||document.hidden||$('explore').hidden)return;
  pausePlayback(false);if(replayTime>=t.cycle){replayTime=0;currentFrameIndex=0;}
  wantPlayback=true;playing=true;playOffset=replayTime+(currentFrameIndex>=t.releaseIndex?.45:0);playStart=performance.now();window.ardsReplayTimings=[];
  $('play-breath').textContent='Pause';$('play-breath').setAttribute('aria-pressed','true');raf=requestAnimationFrame(tickPlayback);
}
$('play-breath').addEventListener('click',()=>{if(playing){pausePlayback();renderFrame(true);}else startPlayback();});
$('breath-frame').addEventListener('input',()=>inspectFrame(+$('breath-frame').value));
document.addEventListener('keydown',event=>{if($('explore').hidden||event.target.closest('input,select,textarea,button,a,summary'))return;if(event.key===' '){event.preventDefault();if(playing){pausePlayback();renderFrame(true);}else startPlayback();}else if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();const last=(lastResults?.[0].trajectory?.frames.length??1)-1;inspectFrame(Math.max(0,Math.min(last,currentFrameIndex+(event.key==='ArrowRight'?1:-1))));}});
document.addEventListener('visibilitychange',()=>{if(document.hidden)pausePlayback();});
reducedMotion.addEventListener('change',()=>{if(reducedMotion.matches)inspectFrame(currentFrameIndex);else renderFrame(true);});
const dockObserver=new ResizeObserver(()=>{
  document.documentElement.style.setProperty('--control-dock-height',`${document.querySelector('.control-dock').getBoundingClientRect().height}px`);
  document.documentElement.style.setProperty('--breath-panel-height',`${document.querySelector('.breath-panel').getBoundingClientRect().height}px`);
});dockObserver.observe(document.querySelector('.control-dock'));dockObserver.observe(document.querySelector('.breath-panel'));
function updateModeViews(){
  $('resistance-control').hidden=!isAirflow();$('mode-context').hidden=!isAirflow();$('flow-panel').hidden=!isAirflow();$('sweep-panel').hidden=isAirflow();
  $('guided-mode').disabled=isAirflow();$('release-breath').textContent=isAirflow()?'Exp start':'Release';
  document.querySelector('.legend').innerHTML=isAirflow()?'<span><i class="closed"></i>Less aerated (fixed)</span><span><i class="open"></i>Aerated (fixed)</span><span><i class="retained-gas"></i>Gas above relaxed volume</span>':recruitmentLegend;
  $('map-help').innerHTML=isAirflow()?'<summary>What does airflow mode show?</summary><div class="meaning-grid"><p>Aeration is held fixed while gas moves through linear airway resistances. Dot area follows actual model gas volume; the blue outline marks more than 10% of that region’s end-inspiratory excess still present (a display threshold).</p><p>Intrinsic regional RC is an isolated estimate. Shared central resistance and the chest wall couple the regions, so actual emptying need not follow that local time constant.</p><p>The emptying fraction uses excess gas above the relaxed frozen PEEP reference. It is different from the exhaled/inspired tidal-volume ratio. Equilibration pressures are hypothetical estimates, not measured plateau or clinical auto-PEEP.</p></div>':recruitmentHelp;
  $('pv-caption').textContent=isAirflow()?'Airway pressure includes resistance. At expiration onset, pressure changes while gas volume remains continuous; the volume then falls as air flows out.':'Watch the cursor move with the breath. A steeper path means more pressure is needed to add volume. Dashed release is instantaneous in this model.';
}
$('mechanics-mode').addEventListener('change',()=>{
  pausePlayback();invalidateComparison(true);lastResults=null;currentFrames=[];$('play-breath').disabled=true;$('breath-frame').disabled=true;
  for(const k of ['a','b']){$('metrics-'+k).replaceChildren();$('live-'+k).textContent='Preparing experiment…';const c=$('map-'+k);c.getContext('2d').clearRect(0,0,c.width,c.height);}
  if(isAirflow()){recruitmentLesson=$('lesson').value;$('lesson').innerHTML='<option value="flow-resistance">Resistance: pressure cost and emptying</option><option value="flow-rate">Rate: shorter expiration</option>';}else{$('lesson').innerHTML=recruitmentOptions;$('lesson').value=recruitmentLesson;}
  updateModeViews();setLessonBaseline();
});
function updateAirflowMetrics(k,result){
  const m=result.metrics,box=$('metrics-'+k);box.replaceChildren(metric('Delivered / requested',`${fmt(m.vtDelivered)} / ${fmt(result.targetVT)}`,'mL',false,'delivery'),metric('Peak airway pressure',fmt(m.ppeak,1),'cmH2O',false,'ppeak'),metric('Excess gas emptied',pct(m.fractionEmptied),'',true,'fractionEmptied'),metric('Excess gas retained',fmt(m.retainedVolume,1),'mL',true,'retainedVolume'));
  const patient=$('patient-'+k);let help=patient.querySelector('.metric-description');if(!help){help=document.createElement('p');help.className='metric-description';help.setAttribute('aria-live','polite');patient.append(help);}help.textContent='';
  let advanced=patient.querySelector('.advanced-metrics');if(!advanced){advanced=document.createElement('details');advanced.className='advanced-metrics';advanced.innerHTML='<summary>Additional model measures</summary><div class="metrics"></div>';patient.append(advanced);}
  advanced.querySelector('.metrics').replaceChildren(metric('Equivalent RC estimate',fmt(m.tauEquivalent,3),'s',false,'tauEquivalent'),metric('Frozen chord compliance',fmt(m.complianceInput,1),'mL/cmH2O',false,'complianceInput'),metric('Hypothetical end-hold pressure',fmt(m.virtualEndHoldPressure,1),'cmH2O',false,'virtualEndHoldPressure'),metric('Hypothetical excess PEEP',fmt(m.virtualAutoPeep,1),'cmH2O',false,'virtualAutoPeep'));
  let pressure=patient.querySelector('.pressure-summary');if(!pressure){pressure=document.createElement('p');pressure.className='pressure-summary';advanced.append(pressure);}pressure.textContent=`Periodicity residual ${fmt(m.periodicResidual,3)} mL. ${m.converged?'Convergence criterion reached.':'Settling cap reached; this trial is not near periodic.'} Chord-range excursions: ${pct(m.extrapolatedWeight)} of tissue weight; maximum ${pct(result.airflow.chordExcursion.maxRelative)} of that region’s reference breath-volume increment. This linear approximation is not calibrated outside its reference chord.`;
  $('delivery-'+k).textContent=m.limited?'Pressure-limited model: flow falls to hold the pressure ceiling; check delivered volume.':'';
}
function renderAirflowTeaching(){
  const pieces=[];for(const key of ['peep','vt','rr'])if(baseline[0].settings[key]!==lastResults[0].settings[key])pieces.push(`${key.toUpperCase()} ${baseline[0].settings[key]} → ${lastResults[0].settings[key]}`);
  if(baseline[0].airflow.params.R0!==lastResults[0].airflow.params.R0)pieces.push(`central resistance ${baseline[0].airflow.params.R0*1000} → ${lastResults[0].airflow.params.R0*1000} cmH2O·s/L`);
  if(!predictionPending)$('prediction-feedback').textContent=pieces.length?pieces.join('; ')+(pieces.length>1?'. Multiple controls changed.':'.'):'No setting change from the airflow baseline.';
  $('adjustment-explanation').textContent='Aeration is fixed. Resistance and the available expiratory time determine gas movement through this coupled network.';
  lastResults.forEach((r,i)=>{const article=document.createElement('article'),h=document.createElement('h3'),p=document.createElement('p');h.textContent='Patient '+(i?'B':'A');p.textContent=`Peak airway pressure ${fmt(baseline[i].metrics.ppeak,1)} → ${fmt(r.metrics.ppeak,1)} cmH2O; retained excess gas ${fmt(baseline[i].metrics.retainedVolume,1)} → ${fmt(r.metrics.retainedVolume,1)} mL; fraction of excess gas emptied ${pct(baseline[i].metrics.fractionEmptied)} → ${pct(r.metrics.fractionEmptied)}. Local RC estimates exclude the shared central resistance and chest wall.`;article.append(h,p);$('comparison-explanation').append(article);});
}
function drawFlow(){
  if(!isAirflow()||!lastResults?.[0].trajectory)return;
  const all=lastResults.flatMap(r=>r.trajectory.frames.map(f=>f.flow/1000)),lo=Math.min(-.2,...all),hi=Math.max(.2,...all),s=baseChart($('flow-chart'),[0,lastResults[0].trajectory.cycle],[lo,hi],'Time (s)','Flow (L/s)');window.ardsFlowScales=s;
  lastResults.forEach((r,i)=>line($('flow-chart'),r.trajectory.frames.map(f=>({x:f.time,y:f.flow/1000})),s,i?colors.b:colors.a));
}
updateModeViews();
const params=new URLSearchParams(location.search);
for(const k of ['peep','vt','rr','pbw'])if(params.has(k)){const el=$(k),v=Number(params.get(k));if(Number.isFinite(v)&&v>=+el.min&&v<=+el.max)el.value=v;}
for(const k of ['a','b']){const kind=params.get('kind-'+k);if(['high','low','wall','healthy'].includes(kind))$('kind-'+k).value=kind;const seed=Number(params.get('seed-'+k));if(params.has('seed-'+k)&&Number.isInteger(seed)&&seed>=0&&seed<=4294967295)$('seed-'+k).value=seed;}
if(params.get('mode')==='airflow'){$('mechanics-mode').value='airflow';$('lesson').innerHTML='<option value="flow-resistance">Resistance: pressure cost and emptying</option><option value="flow-rate">Rate: shorter expiration</option>';const r=Number(params.get('resistance'));if(r>=2&&r<=30)$('resistance').value=r;updateModeViews();}
labels();drawSweep();if(params.size){updateLesson();$('baseline-status').textContent='Custom scenario loaded. Set the lesson baseline to begin its guided comparison.';compare(true);}else setLessonBaseline();

const themeMedia=window.matchMedia('(prefers-color-scheme: dark)');
function currentTheme(){return document.documentElement.dataset.theme|| (themeMedia.matches?'dark':'light');}
function updateTheme(){ $('theme-toggle').textContent=currentTheme()==='dark'?'Light mode':'Dark mode';refreshColors();render();}
$('theme-toggle').addEventListener('click',()=>{
  const next=currentTheme()==='dark'?'light':'dark';document.documentElement.dataset.theme=next;
  try{localStorage.setItem('ards-theme',next);}catch{}
  updateTheme();
});
themeMedia.addEventListener('change',updateTheme);updateTheme();
