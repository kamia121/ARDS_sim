import {RECRUITMENT_COPY,AIRFLOW_COPY,ELI5_COPY,PHASE_COPY} from './learner-copy.js';
import {frameReadout,UNIFIED_KIND} from './readout.js';
import {UNIFIED_LESSONS,unifiedQuestion,UNIFIED_HELP} from './unified-teaching.js';
import {expansionColor,EXPANSION_THRESHOLD,OPEN_FILL_MIN,SQUARE_MIN_OPEN,RING_GAIN,RING_MIN_OPEN,EXTRA_AIR_RING_FRACTION} from './map-color.js';
import {pleuralField,framePleural} from './pleural-readout.js';
import {sampleTrajectory,frameLabel,transitionFrame,loopTransitionFrame,displaySegment,displayElapsed} from './playback.js';
import {LESSONS,METRIC_HELP,METRIC_NUMBERS,explainComparison,explainAdjustment,predictionQuestion,evaluatePrediction,FLOW_LESSONS,airflowQuestion} from './teaching.js';
const $=id=>document.getElementById(id);
const worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
let request=0,compareId=0,lastResults=null,lastSweep=null,deviceResults=null,sweepId=0,benchmarkId=0,phase='ee',timer,positions={};
let baseline=null,baselineConfig=null,pendingBaseline=false,comparisonFresh=true,baselineRequest=0,comparisonConfig=null,baselineExpected=null,compareContext=null,acceptedStateToken=null,acceptedConfig=null;
const selectedUnits={a:null,b:null};
const readoutCells={a:null,b:null},mapReadoutCells={a:null,b:null},readoutSignature={a:'',b:''};
let currentFrames=[],currentFrameIndex=0,replayTime=0,raf=0,playing=false,wantPlayback=false,playStart=0,playOffset=0,prediction=null,predictionPending=null,attempts=0,correctAttempts=0,scenarioEpoch=0;
const HOLD=.45, TRANSITION=.5, LOOP_TRANSITION=.35;
const playbackOptions=()=>({hold:isUnified()?0:HOLD,eiTransition:TRANSITION,loopTransition:LOOP_TRANSITION,loop:$('loop-breath').checked});
let viewBookmark=null,resumeElapsed=null,displayKind=null;
const pleuralContexts=new WeakMap();
const getPleuralField=r=>{if(!pleuralContexts.has(r))pleuralContexts.set(r,pleuralField(r.trajectory,r.units));return pleuralContexts.get(r);};
let displayFrames=null;
let sweepIndex=0,sweepPlaying=false,sweepTimer=0,sweepScales=null;
const scoredQuestions=new Set();
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
const mapGeometry={};
let recruitmentLesson='recruitment';
const recruitmentOptions=$('lesson').innerHTML;
const isAirflow=()=>$('mechanics-mode').value==='airflow';
const isUnified=()=>$('mechanics-mode').value==='unified';
const isUnifiedKind=r=>r?.trajectory?.kind===UNIFIED_KIND;
const flowParams=()=>({R0:+$('resistance').value/1000,Rp:.004});
const UNIFIED_FIELDS={rp:['u-rp',1,20,4],spread:['u-spread',0,1,0],dependency:['u-dependency',0,2,0],conductance:['u-conductance',.05,1,1],patency:['u-patency',1,2,1],aeration:['u-aeration',.002,.05,.01],stiffness:['u-stiffness',0,24,12],ti:['u-ti',.2,.6,1/3],limit:['u-limit',20,80,45]};
const CUSTOM_FIELDS={diff:['u-diff',0,1,null],openShift:['u-open-shift',-15,30,0],closeShift:['u-close-shift',-15,15,0],tauOpen:['u-tau-open',.25,4,1],tauClose:['u-tau-close',.25,4,1],initOpen:['u-init-open',0,1,null]};
const boundedField=(spec,raw=$(spec[0]).value)=>{const [,lo,hi,def]=spec;if(raw===''||raw===null||raw===undefined)return def;const v=Number(raw);return Number.isFinite(v)?Math.min(hi,Math.max(lo,v)):def;};
const unifiedValue=name=>{const v=boundedField(UNIFIED_FIELDS[name]);return name==='ti'&&Math.abs(v-1/3)<.0006?1/3:v;};
const customValue=name=>boundedField(CUSTOM_FIELDS[name]);
function mechanics(){return {R0:+$('resistance').value/1000,Rp:unifiedValue('rp')/1000,resistanceSpread:unifiedValue('spread'),resistanceDependency:unifiedValue('dependency'),residualConductance:unifiedValue('conductance'),patencyPower:unifiedValue('patency'),residualAeration:unifiedValue('aeration'),compressionStiffness:unifiedValue('stiffness')};}
function recruitability(){
  if(!$('u-custom').checked)return null;
  const out={openingShift:customValue('openShift'),closingShift:customValue('closeShift'),tauOpenScale:customValue('tauOpen'),tauCloseScale:customValue('tauClose')};
  const diff=customValue('diff'),init=customValue('initOpen');if(diff!==null)out.difficultFraction=diff;if(init!==null)out.initialOpenFraction=init;return out;
}
const configKey=()=>isUnified()?JSON.stringify({config:config(),mechanics:mechanics(),limits:[unifiedValue('limit'),unifiedValue('ti')],experiment:experiment()}):JSON.stringify(config());
const currentQuestion=()=>isUnified()?unifiedQuestion($('lesson').value,$('learner-level').value):isAirflow()?airflowQuestion($('lesson').value,$('learner-level').value):predictionQuestion($('lesson').value,$('learner-level').value);
const currentLesson=()=>isUnified()?UNIFIED_LESSONS[$('lesson').value]:isAirflow()?FLOW_LESSONS[$('lesson').value]:LESSONS[$('lesson').value];
const unifiedOptions=Object.entries(UNIFIED_LESSONS).map(([key,l])=>`<option value="${key}">${l.name}</option>`).join('');
const airflowOptions='<option value="flow-resistance">Resistance: pressure cost and emptying</option><option value="flow-rate">Rate: shorter expiration</option>';
Object.assign(METRIC_HELP,{
 uEnd:'Total gas in the lung at the end of the final expiration. It includes the gas held at the set PEEP and any extra gas that has not finished leaving.',
 uRest:'The volume the lung would settle at for the set PEEP if every region kept its end-of-breath opening and no air were moving. This gas is held by PEEP, not trapped. It is a model reference, not a measurement, and it ignores later opening or closing.',
 uResidual:'End gas minus the PEEP-held reference. Positive: extra gas has not finished leaving. Near zero: total gas matches the reference, but individual regions may still differ. Negative means gas is below the current reference; redistribution or continued opening can change that comparison. It is not a measured auto-PEEP.',
 uPositive:'Adds only the regions that are above their own PEEP-held reference. It is larger than the whole-lung difference when some regions are below theirs.',
 uRemaining:'Modelled pressure inside each region’s airspace minus the between-breath airway pressure at the end of expiration. It is a model value, not a measured auto-PEEP.',
 uExhaled:'Gas that left the lung between the end of inspiration and the end of expiration.',
 openEnd:'The tissue-weighted share of open tissue after the final expiration.'
});
const UNIFIED_PHASE={'Before inspiration':'Start of the last recorded breath. Some gas may remain from earlier breaths. Whether a region opens depends on the pressure across it.','Inspiration':'Flow carries gas in through resistance. Dots grow as regions open, expand, or both.','End inspiration':'The last moment of inspiration. Airway pressure includes resistance. No pause is simulated, so there is no plateau.','Start expiration':'Airway pressure drops to PEEP at once. Gas volume does not jump; it falls only as air leaves through the airways.','Expiration':'Blue rings mark regions whose airspace pressure is at least 1 cmH2O above the airway level. Gas can stay at PEEP without being trapped.','End expiration':'End of this recorded breath. Compare end gas with the volume held at PEEP; a positive difference indicates extra gas above that reference in this model.'};
const UNIFIED_ELI5='Picture air pockets joined to straws. Air in makes dots grow; air out makes them shrink. A big lung can stay big for two different reasons. Some air is simply held at the PEEP you set, so it is meant to stay. Other air has not finished leaving because the straws take time. A pocket can also open or close while this happens. A blue ring while breathing out means that pocket’s inside pressure is still at least 1 cmH2O above the between-breath airway pressure. Blue is not a diagnosis, and red marks an assumed expansion level, not injury.';
const labelFor=(frame,index,trajectory)=>{const name=frameLabel(frame,index,trajectory);return trajectory.kind===UNIFIED_KIND&&name==='Pressure release'?'Start expiration':name;};
const colors={};
function refreshColors(){const css=getComputedStyle(document.documentElement);for(const [key,token] of Object.entries({a:'--mon-current',b:'--mon-snap',open:'--open',cyclic:'--cyclic',over:'--over',closed:'--closed',surface:'--surface-2',grid:'--mon-grid',ink:'--ink'}))colors[key]=css.getPropertyValue(token).trim();}
refreshColors();
const fmt=(x,n=0)=>{if(!Number.isFinite(x))return '--';const text=x.toFixed(n);return Number(text)===0?Math.abs(x).toFixed(n):text;};
const pct=x=>Number.isFinite(x)?fmt(x*100)+'%':'--';
function experiment(){return {drive:$('pressure-drive').value,posture:$('posture').value,chestLoad:+$('chest-load').value,proneGradientFactor:.5};}
function settings(){const e=experiment(),unified=isUnified();return {peep:+$('peep').value,vt:+$('vt').value,rr:+$('rr').value,pressureLimit:unified?unifiedValue('limit'):45,...(unified?{inspiratoryFraction:unifiedValue('ti')}:{}),...(e.drive!=='airway'||e.posture!=='supine'||e.chestLoad?{experiment:e}:{})};}
function restoreExperiment(s={}){const e=s.experiment||{};$('pressure-drive').value=e.drive||'airway';$('posture').value=e.posture||'supine';$('chest-load').value=e.chestLoad||0;updateExperimentViews();}
function updateExperimentViews(){
 const external=$('pressure-drive').value==='external';$('chest-load-value').textContent=$('chest-load').value;
 $('peep-label').textContent=external?'Negative pressure at expiration':'PEEP';
 $('peep-help').textContent=external?'Magnitude of continuous negative external pressure; airway remains at zero.':'Positive end-expiratory pressure: airway pressure remaining between breaths.';
 $('sweep').disabled=external||isAirflow()||isUnified();
 $('experiment-scope').textContent=isUnified()?(external?'Pressure outside the chest falls while the airway stays at zero. The model’s pressure across each region is unchanged; the airway and pleural numbers shift. Effects on the circulation are not included.':'Chest load raises the pressure around the lung; it is a pressure change, not kilograms. Prone changes how that surrounding pressure varies from front to back. Changing these starts fresh lungs.'):isAirflow()?'This airflow view holds the open tissue fixed. Use the recruitment view to change how pressure is applied, body position, or chest load.':external?'This model can fill the lung by lowering pressure outside the chest. The same pressure difference gives the same expansion. Effects on the circulation are not included.':'Chest load raises the pressure around the lung; it is a pressure change, not kilograms. Prone changes how that surrounding pressure varies from front to back.';
 for(const k of ['pressure-drive','posture','chest-load'])$(k).disabled=isAirflow();
 document.querySelectorAll('.map-wrap .orientation:last-child').forEach(el=>el.textContent=$('posture').value==='prone'?'Dorsal · posterior · prone-nondependent':'Dorsal · posterior · supine-dependent');
 if(external)$('sweep-caption').textContent='Return to positive airway pressure to run the PEEP sweep.';
}

function config(){const custom=isUnified()?recruitability():null,target=$('u-target').value;return ['a','b'].map(k=>({kind:$('kind-'+k).value,seed:Number($('seed-'+k).value)>>>0,pbw:+$('pbw').value,...(custom&&(target==='both'||target===k)?{recruitability:{...custom}}:{})}));}
function labels(){for(const k of ['peep','vt','rr','pbw','resistance'])$(k+'-value').textContent=$(k).value;}
function clearComparison(){for(const id of ['comparison-explanation','adjustment-explanation']){$(id).setAttribute('aria-busy','true');$(id).classList.add('stale-result');} }
function invalidateComparison(configurationChanged=false){
  if(configurationChanged)viewBookmark=false;else rememberView();pausePlayback(false);predictionPending=null;$('prediction-feedback').textContent='';compareId=++request;compareContext=null;clearComparison();
  if(pendingBaseline||configurationChanged){
    pendingBaseline=false;baseline=null;baselineConfig=null;baselineExpected=null;baselineRequest=0;
    $('apply-adjustment').disabled=true;
    $('baseline-status').textContent=configurationChanged?'Patient configuration changed. Set a new lesson baseline before interpreting differences.':'Baseline preparation interrupted. Set the lesson baseline again before applying its adjustment.';
  }
  $('status').textContent='Settings changed; awaiting a completed simulation.';
  for(const k of ['a','b'])$('patient-'+k).setAttribute('aria-busy','true');
}
function compare(reset=false,recordBaseline=false){
  rememberView();pausePlayback(false);comparisonFresh=isAirflow()||reset||$('guided-mode').checked||acceptedStateToken===null||acceptedConfig!==configKey();labels();clearComparison();
  $('status').textContent=isUnified()?'Computing opening, expansion and airflow together for 10 breaths…':isAirflow()?'Computing pressure-driven airflow and emptying…':'Simulating 10 breaths in each patient...';$('status').removeAttribute('role');
  compareId=++request;const currentConfig=config(),currentSettings=settings();comparisonConfig=configKey();
  const prepareAirflow=isAirflow()&&(acceptedStateToken===null||acceptedConfig!==comparisonConfig||(reset&&recordBaseline));
  compareContext={id:compareId,config:JSON.stringify(currentConfig),key:comparisonConfig,settings:currentSettings,fresh:comparisonFresh,mode:$('mechanics-mode').value,params:flowParams(),mechanics:isUnified()?mechanics():null,prepareAirflow,recordBaseline};
  if(recordBaseline){baselineRequest=compareId;baselineExpected={...compareContext,lesson:$('lesson').value};}
  if(isUnified()){worker.postMessage({id:compareId,type:'unified',config:currentConfig,mechanics:compareContext.mechanics,settings:currentSettings,reset:comparisonFresh,baseStateToken:acceptedStateToken,recordTrajectory:true,recordPleuralField:true});return;}
  worker.postMessage({id:compareId,type:isAirflow()&&!prepareAirflow?'airflow':'compare',config:currentConfig,settings:currentSettings,params:flowParams(),reset:prepareAirflow||comparisonFresh,baseStateToken:acceptedStateToken,recordTrajectory:!prepareAirflow,recordPleuralField:!prepareAirflow});
}
function schedule(reset=false,configurationChanged=false){invalidateComparison(configurationChanged);clearTimeout(timer);timer=setTimeout(()=>compare(reset),130);}
function metric(label,value,unit='',secondary=false,helpKey='',delta=''){
  const e=document.createElement('div');e.className='metric'+(secondary?' secondary':'');
  const v=document.createElement('strong');v.textContent=value+' ';const u=document.createElement('small');u.textContent=unit;v.append(u);
  const l=document.createElement('span');l.className='metric-label';const name=document.createElement('span');name.textContent=label;l.append(name);
  if(helpKey){const b=document.createElement('button');b.type='button';b.className='metric-help-button';b.textContent='?';b.setAttribute('aria-label','Explain '+label);b.addEventListener('click',()=>renderMetricHelp(e.closest('.patient').querySelector('.metric-description'),helpKey));l.append(b);}
  e.append(v,l);if(delta){const chip=document.createElement('small');chip.className='metric-delta';chip.textContent=delta;e.append(chip);}return e;
}
function updateMetrics(k,result){
  if(result.trajectory?.kind==='frozen-aeration-airflow'){updateAirflowMetrics(k,result);return;}
  if(isUnifiedKind(result)){updateUnifiedMetrics(k,result);return;}
  $('patient-'+k).querySelector('.unified-flags')?.remove();
  const m=result.metrics,box=$('metrics-'+k),before=comparisonFresh&&$('guided-mode').checked?baseline?.[k==='a'?0:1]?.metrics:null;
  const delta=(key,multiplier=1,unit='')=>{if((key==='dp'&&result.conditions?.drive==='external')||!before||!Number.isFinite(before[key])||!Number.isFinite(m[key]))return '';const v=Number(fmt((m[key]-before[key])*multiplier,1));return `${v>0?'+':''}${fmt(v,1)} ${unit} from baseline`;};
  box.replaceChildren(
    metric('Delivered / requested',`${fmt(m.vtDelivered)} / ${fmt(result.targetVT)}`,'mL',false,'delivery',delta('vtDelivered',1,'mL')),
    metric(result.conditions?.drive==='external'?'Transrespiratory pressure swing':'Driving pressure',fmt(result.conditions?.drive==='external'?result.conditions.transrespDP:m.dp,1),'cmH2O',false,result.conditions?.drive==='external'?'transrespDP':'dp',delta('dp',1,'cmH2O')),
    metric('Open tissue before breath',pct(m.openEE),'',true,'openEE',delta('openEE',100,'pp')),
    metric('High-stretch tissue share',pct(m.over),'',true,'over',delta('over',100,'pp'))
  );
  const patient=$('patient-'+k);
  let pressure=patient.querySelector('.pressure-summary');if(!pressure){pressure=document.createElement('p');pressure.className='pressure-summary';patient.append(pressure);}
  pressure.textContent=`Mean pleural pressure: ${fmt(m.meanPleuralEE,1)} at expiration → ${fmt(m.meanPleuralEI,1)} cmH2O at inspiration. Mean transpulmonary pressure at inspiration: ${fmt(m.pplat,1)} − ${fmt(m.meanPleuralEI,1)} = ${fmt(m.transpulmonaryEI,1)} cmH2O.`;
  let help=patient.querySelector('.metric-description');if(!help){help=document.createElement('div');help.className='metric-description';help.setAttribute('aria-live','polite');help.textContent='';patient.append(help);}
  let advanced=patient.querySelector('.advanced-metrics');if(!advanced){advanced=document.createElement('details');advanced.className='advanced-metrics';const summary=document.createElement('summary');summary.textContent='Additional model measures';advanced.append(summary);const values=document.createElement('div');values.className='metrics';advanced.append(values);patient.append(advanced);}
  advanced.querySelector('.metrics').replaceChildren(metric(result.conditions?.drive==='external'?'Transrespiratory compliance':'Respiratory compliance',fmt(result.conditions?.drive==='external'?result.conditions.transrespCrs:m.crs),'mL/cmH2O',false,result.conditions?.drive==='external'?'transrespCrs':'crs'),metric('Air before this breath',fmt(m.eelv/1000,2),'L',false,'eelv'),metric('Plateau airway pressure',fmt(m.pplat,1),'cmH2O',false,'pplat'),metric('Tissue opened during the breath',pct(m.cyclic),'',true,'cyclic'),metric('Perfusion-weighted closed fraction',pct(m.closedPerfusion),'',true,'closedPerfusion'));
  advanced.append(pressure);
  const delivery=$('delivery-'+k);delivery.className='delivery'+(m.limited?' limited':'');
  delivery.textContent=(m.limited?`${fmt(result.settings.pressureLimit)} cmH2O drive-pressure ceiling reached during inspiration; check actual delivered volume.`:'');
  if(m.limited)delivery.setAttribute('role','alert');else delivery.removeAttribute('role');
}
function updateUnifiedMetrics(k,result){
  const m=result.metrics,n=result.unified.numerics,external=result.conditions?.drive==='external',box=$('metrics-'+k),before=comparisonFresh&&$('guided-mode').checked?baseline?.[k==='a'?0:1]?.metrics:null;
  const delta=(key,multiplier=1,unit='')=>{if(!before||!Number.isFinite(before[key])||!Number.isFinite(m[key]))return '';const v=Number(fmt((m[key]-before[key])*multiplier,1));return `${v>0?'+':''}${fmt(v,1)} ${unit} from baseline`;};
  const patient=$('patient-'+k);
  box.replaceChildren(
    metric('Delivered / requested',`${fmt(m.vtDelivered)} / ${fmt(result.targetVT)}`,'mL',false,'delivery',delta('vtDelivered',1,'mL')),
    metric(external?'Peak effective drive':'Peak airway pressure',fmt(external?result.conditions.maxDrivePressure:m.ppeak,1),'cmH2O',false,'ppeak',delta(external?'maxPressure':'ppeak',1,'cmH2O')),
    metric('Gas at end of breath',fmt(m.endVolume/1000,2),'L',false,'uEnd',delta('endVolume',.001,'L')),
    metric('Held at PEEP (reference)',fmt(m.restingPEEPVolume/1000,2),'L',true,'uRest',delta('restingPEEPVolume',.001,'L')),
    metric('Extra gas vs PEEP reference',fmt(m.dynamicResidual,1),'mL',true,'uResidual',delta('dynamicResidual',1,'mL')),
    metric('Open tissue at end',pct(m.openEnd),'',true,'openEnd',delta('openEnd',100,'pp'))
  );
  let pressure=patient.querySelector('.pressure-summary');if(!pressure){pressure=document.createElement('p');pressure.className='pressure-summary';patient.append(pressure);}
  const meanPL=m.meanAlveolarEI-m.meanPleuralEI;
  pressure.textContent=`Mean pleural pressure ${fmt(m.meanPleuralEE,1)} at the start → ${fmt(m.meanPleuralEI,1)} cmH2O at the end of inspiration. Mean alveolar pressure at the end of inspiration ${fmt(m.meanAlveolarEI,1)}, so the average pressure across lung tissue is ${fmt(m.meanAlveolarEI,1)} − ${fmt(m.meanPleuralEI,1)} = ${fmt(meanPL,1)} cmH2O. That is not the airway pressure minus pleural pressure, which also includes the push against flow resistance. Unfinished emptying compares end gas with the volume held at PEEP; opening could still change afterwards.`;
  let help=patient.querySelector('.metric-description');if(!help){help=document.createElement('div');help.className='metric-description';help.setAttribute('aria-live','polite');patient.append(help);}help.textContent='';
  let advanced=patient.querySelector('.advanced-metrics');if(!advanced){advanced=document.createElement('details');advanced.className='advanced-metrics';advanced.innerHTML='<summary>Additional model measures</summary><div class="metrics"></div>';patient.append(advanced);}
  advanced.querySelector('.metrics').replaceChildren(
    metric('Sum of regional extra gas',fmt(m.sumPositiveRegionalResidual,1),'mL',false,'uPositive'),
    metric('Mean pressure above PEEP at end',fmt(m.palvMinusPeepMean,1),'cmH2O',false,'uRemaining'),
    metric('Highest regional pressure above PEEP',fmt(m.palvMinusPeepMax,1),'cmH2O',false,'uRemaining'),
    metric('Open tissue before breath',pct(m.openEE),'',true,'openEE',delta('openEE',100,'pp')),
    metric('High-stretch tissue share',pct(m.over),'',true,'over',delta('over',100,'pp')),
    metric('Tissue opened during the breath',pct(m.cyclic),'',true,'cyclic'),
    metric('Gas leaving during expiration',fmt(m.exhaledNet,1),'mL',false,'uExhaled'),
    metric('Gas before this breath',fmt(m.eelv/1000,2),'L',false,'eelv')
  );
  advanced.append(pressure);
  const notes=[];
  if(m.limited){const e=n.ceilingEvent;notes.push(`${fmt(result.settings.pressureLimit)} cmH2O pressure ceiling reached${e?.initial?' at the start of inspiration':e?` ${fmt(e.time,2)} s into inspiration`:''}; check actual delivered volume against the request.`);}
  const delivery=$('delivery-'+k);delivery.className='delivery'+(m.limited?' limited':'');delivery.textContent=notes[0]||'';
  if(m.limited)delivery.setAttribute('role','alert');else delivery.removeAttribute('role');
  const cues=[];
  if(!m.converged)cues.push(`Not yet repeating: this breath ended ${fmt(m.periodicResidual,1)} mL (summed over regions) and ${fmt(m.periodicResidualOpen*100,2)} points of open fraction away from where it began. Treat end-of-breath values as a snapshot of breath ${result.breaths}.`);
  if(n.uniquenessUnresolved>0)cues.push('Numerical limit: an inflow root-uniqueness check remained unresolved after the maximum refinement. Treat this parameter combination as a model limitation.');
  if(n.kneeReached)cues.push('Some regions reached the stretch-law knee, where the pressure–volume curve is continued linearly.');
  if(n.floorSteps>0)cues.push('Requested flow would have pulled pressure below PEEP in some steps; pressure was held at PEEP instead.');
  if(result.unified.initialState?.source==='relaxed'&&result.unified.initialState.reason&&result.unified.initialState.reason!=='no carried gas state')cues.push('Started from the relaxed state: '+result.unified.initialState.reason+'.');
  let flags=patient.querySelector('.unified-flags');if(!flags){flags=document.createElement('p');flags.className='unified-flags caption';flags.setAttribute('aria-live','polite');delivery.after(flags);}
  flags.textContent=cues.join(' ');flags.hidden=!cues.length;
}
function renderTeaching(){
  const output=$('comparison-explanation');output.replaceChildren();$('adjustment-explanation').replaceChildren();for(const id of ['comparison-explanation','adjustment-explanation']){$(id).removeAttribute('aria-busy');$(id).classList.remove('stale-result');}
  if(!baseline||!lastResults)return;
  if(comparisonConfig!==baselineConfig||configKey()!==baselineConfig){$('baseline-status').textContent='Patient configuration changed. Set a new baseline before interpreting differences.';return;}
  if(!comparisonFresh||!$('guided-mode').checked){$('baseline-status').textContent='Pressure-history mode: recruitment state is retained. Use fresh patients for a controlled comparison.';return;}
  if(isUnified()){renderUnifiedTeaching();return;}
  if(isAirflow()){renderAirflowTeaching();return;}
  const adjustment=explainAdjustment(baseline[0].settings,lastResults[0].settings);
  if(!predictionPending)$('prediction-feedback').textContent=adjustment.changed+(adjustment.control.startsWith('Multiple')?' Multiple controls changed; isolate one change to explain its effect.':'');
  $('baseline-status').textContent='Comparing the recorded baseline with the last completed simulation.';
  for(const [key,label] of [['changed','What changed'],['held','What stayed the same'],['why','Why the model responds'],['tradeoff','Tradeoff to recognize'],['control','Comparison conditions'],...(adjustment.conditions?[['conditions','Experiment assumptions']]:[])]){
    const p=document.createElement('p'),strong=document.createElement('strong');strong.textContent=label+': ';p.append(strong,adjustment[key]);$('adjustment-explanation').append(p);
  }
  lastResults.forEach((r,i)=>{
    const x=explainComparison(baseline[i].metrics,r.metrics);if(r.conditions?.drive==='external'||baseline[i].conditions?.drive==='external'){x.changes=`Open tissue before the breath ${pct(baseline[i].metrics.openEE)} → ${pct(r.metrics.openEE)}; delivered volume ${fmt(baseline[i].metrics.vtDelivered)} → ${fmt(r.metrics.vtDelivered)} mL; mean pressure across the lung ${fmt(baseline[i].metrics.transpulmonaryEI,1)} → ${fmt(r.metrics.transpulmonaryEI,1)} cmH2O.`;x.meaning='The same lung can fill by raising pressure inside or lowering pressure outside. In this simple model, matching that pressure difference gives the same opening and expansion. The airway and surrounding-pressure numbers change, but that alone does not mean the lung is stretched more.';}const article=document.createElement('article'),h=document.createElement('h3');h.textContent='Patient '+(i?'B':'A');article.append(h);
    for(const [key,label] of [['changes','Observed changes'],['meaning','Interpretation'],...($('lesson').value==='wall'||$('learner-level').value==='fellow'?[['pressure','Pressure across lung tissue']]:[])]){const p=document.createElement('p'),strong=document.createElement('strong');p.className=key;strong.textContent=label+': ';p.append(strong,x[key]);article.append(p);}output.append(article);
  });
}
function updateLesson(){
  const lesson=currentLesson();
  $('lesson-instruction').textContent=lesson.instruction;
  $('lesson-objective').textContent=lesson.objective||lesson.instruction;
  updateQuestion();
  $('lesson-reflection').textContent=lesson.reflection;const box=$('lesson-numbers');box.replaceChildren();if(lesson.numbers)box.append(numberDetails(lesson.numbers,'lesson-'+$('lesson').value,'Work through this scenario'));
}
function updateQuestion(){
  const q=currentQuestion();$('lesson-prediction').textContent=q.prompt;
  const names=q.betweenPatients?{up:'Higher in B',same:'Similar',down:'Lower in B'}:{up:'Increase',same:'Little change',down:'Decrease'};
  for(const b of document.querySelectorAll('[data-prediction]')){b.textContent=names[b.dataset.prediction];b.setAttribute('aria-pressed',String(b.dataset.prediction===prediction));}
  $('lesson-objective').textContent='Goal: '+(currentLesson().objective||q.focus);
  $('prediction-band').textContent=`For this exercise, similar/little change means within ±${q.band} ${q.unit==='%'?'percentage point':q.unit}. This is a display band, not clinical significance.`;
}
for(const b of document.querySelectorAll('[data-prediction]'))b.addEventListener('click',()=>{
  prediction=b.dataset.prediction;updateQuestion();$('prediction-feedback').textContent='Prediction recorded. Apply the change, then compare.';
});
$('learner-level').addEventListener('change',()=>{for(const b of document.querySelectorAll('[data-prediction]'))b.disabled=false;prediction=null;predictionPending=null;$('prediction-feedback').textContent='';updateQuestion();renderFrame();});
function setLessonBaseline(){
  viewBookmark=false;pausePlayback();$('pressure-experiments').open=['pressure-drive','prone','chest-load'].includes($('lesson').value);scenarioEpoch++;prediction=null;predictionPending=null;$('prediction-feedback').textContent='';
  for(const b of document.querySelectorAll('[data-prediction]'))b.disabled=false;
  const lesson=currentLesson();restoreExperiment();
  for(const [key,value] of Object.entries(lesson.baseline))$(key).value=value;updateExperimentViews();
  for(const [i,k] of ['a','b'].entries()){$('kind-'+k).value=lesson.kinds[i];$('seed-'+k).value=13791;}
  $('guided-mode').checked=true;updateLesson();$('apply-adjustment').disabled=true;
  pendingBaseline=true;baseline=null;baselineExpected=null;$('comparison-explanation').replaceChildren();$('adjustment-explanation').replaceChildren();invalidateSweep();clearTimeout(timer);compare(true,true);
}
$('set-baseline').addEventListener('click',setLessonBaseline);
$('lesson').addEventListener('change',setLessonBaseline);
$('apply-adjustment').addEventListener('click',()=>{
  if(!baseline||configKey()!==baselineConfig){setLessonBaseline();return;}
  $('guided-mode').checked=true;
  restoreExperiment(baseline[0].settings);for(const key of ['peep','vt','rr'])$(key).value=baseline[0].settings[key];
  if(isAirflow())$('resistance').value=baseline[0].airflow.params.R0*1000;
  if(isUnified())$('resistance').value=Math.round(baseline[0].unified.mechanics.R0*1e6)/1000;
  for(const [key,value] of Object.entries(currentLesson().adjustment))$(key).value=value;updateExperimentViews();
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
    const transitionWeight=frame?.transitionWeight;
    const atEI=frame?frame===ei:phase==='ei',high=(atEI||transitionWeight!==undefined)&&u.strainEI>EXPANSION_THRESHOLD&&f>SQUARE_MIN_OPEN;
    const flowMode=result.trajectory?.kind==='frozen-aeration-airflow',unified=result.trajectory?.kind===UNIFIED_KIND,cyclic=!flowMode&&f-u.openEE>RING_GAIN&&f>RING_MIN_OPEN;
    const state=f>OPEN_FILL_MIN?'open':'closed';
    const v=frame?frame.unitVolume[i]:phase==='ei'?u.volumeEI:u.volumeEE;
    const radius=Math.max(1.15,Math.sqrt(Math.max(0,v)*12/Math.PI));
    ctx.globalAlpha=state==='closed'?.75:.4+.6*f;ctx.fillStyle=state==='open'&&frame?.unitRatio?expansionColor(frame.unitRatio[i]):colors[state];ctx.beginPath();ctx.arc(x,y,radius,0,2*Math.PI);ctx.fill();
    if(cyclic){ctx.globalAlpha=1;ctx.strokeStyle=colors.ink;ctx.lineWidth=1.4;ctx.setLineDash([2,2]);ctx.stroke();ctx.setLineDash([]);}
    if(high){ctx.globalAlpha=Math.max(.2,f)*(1-(transitionWeight??0));ctx.strokeStyle=colors.over;ctx.lineWidth=1.2;ctx.strokeRect(x-radius-1,y-radius-1,2*radius+2,2*radius+2);}
    if(flowMode&&u.active&&u.volumeEI-u.relaxedVolume>1e-9&&v-u.relaxedVolume>EXTRA_AIR_RING_FRACTION*(u.volumeEI-u.relaxedVolume)){ctx.globalAlpha=.8;ctx.strokeStyle='#798ec5';ctx.lineWidth=.8;ctx.beginPath();ctx.arc(x,y,radius+1.2,0,2*Math.PI);ctx.stroke();}
    if(unified&&frame&&(frame.phase==='release'||frame.phase==='expiration')&&frame.unitAlveolar&&frame.unitAlveolar[i]-frame.pressure>=1){ctx.globalAlpha=.9;ctx.strokeStyle='#798ec5';ctx.lineWidth=1.3;ctx.beginPath();ctx.arc(x,y,radius+1.6,0,2*Math.PI);ctx.stroke();}
    positions[k].push({x,y,u,state});
  });ctx.globalAlpha=1;
  const name=frame?.loopWeight!==undefined?'Visual replay transition':frame?.transitionWeight!==undefined?'Visual expiration transition':frame&&result.trajectory?labelFor(frame,currentFrameIndex,result.trajectory):phase==='ei'?'end inspiration':'before inspiration';
  canvas.setAttribute('aria-label',`Patient ${k.toUpperCase()}: ${name}. Open tissue ${pct(frame?.open??result.metrics.openEE)}. End-inspiratory possible excessive-stretch marker ${pct(result.metrics.over)}; not predicted tissue damage. Select a region or enter its number.`);
}
function updateUnitDetail(k,result){
  const id=selectedUnits[k],u=id===null?null:result?.units.find(unit=>unit.id===id);
  const current=currentFrames[k==='a'?0:1];
  const local=current&&result?framePleural(current,getPleuralField(result)):null;
  const pressureDetail=u&&local?` Current regional pleural pressure ${fmt(local.pplAt(u.dep),1)} cmH2O; ${result.trajectory.kind==='frozen-aeration-airflow'?'airway − pleural (includes resistance)':'regional lung-distending pressure'} ${fmt(current.pressure-local.pplAt(u.dep),1)} cmH2O.`:'';
  const text=u?`Region ${u.id}: open ${pct(u.openEE)} before inspiration / ${pct(u.openEI)} at end inspiration. At the end of the breath in, the open part is ${fmt(u.strainEI,2)}× its reference size. Opening starts gradually above ${fmt(u.popen,1)}; closing starts below ${fmt(u.pclose,1)} cmH2O pressure across this region.`:'Select a lung unit on the map or enter its number to inspect the current result.';
  if(u&&isUnifiedKind(result)){
    const i=u.id,q=current?.unitFlow?.[i],palv=current?.unitAlveolar?.[i],ppl=local?local.pplAt(u.dep):null,pl=Number.isFinite(palv)&&Number.isFinite(ppl)?palv-ppl:null,ratio=current?.unitRatio?.[i],above=current&&Number.isFinite(palv)?palv-current.pressure:null;
    const where=pl===null?'':pl>u.popen?'above its opening threshold, so it tends to open':pl<u.pclose?'below its closing threshold, so it tends to close':'between its closing and opening thresholds, so its opening changes little';
    let detail=`Region ${u.id}: open ${pct(u.openEE)} before inspiration / ${pct(u.openEI)} at end inspiration; at the end of inspiration the open part is ${fmt(u.strainEI,2)}× its reference size. Opening starts gradually above ${fmt(u.popen,1)} and closing starts below ${fmt(u.pclose,1)} cmH2O of pressure across this region.`;
    if(current)detail+=` Now: ${pct(current.unitOpen[i])} open, holding ${fmt(current.unitVolume[i],2)} mL; expansion ${fmt(ratio,2)}× reference; flow ${fmt(q,2)} mL/s (+ in, − out).`;
    if(pl!==null)detail+=` Pressure across this region = local alveolar ${fmt(palv,1)} − local pleural ${fmt(ppl,1)} = ${fmt(pl,1)} cmH2O, ${where}. Airway pressure is a different number: it also pays for flow resistance.`;
    if(above!==null&&(current.phase==='release'||current.phase==='expiration'))detail+=` Inside this region the pressure is ${fmt(above,1)} cmH2O above the airway level; a blue ring appears from 1 cmH2O.`;
    detail+=` At the end of the breath it holds ${fmt(u.volumeEnd,2)} mL. At the set PEEP with its final opening it would settle at ${fmt(u.relaxedVolumeEnd,2)} mL: ${fmt(u.volumeEnd-u.relaxedVolumeEnd,2)} mL difference (positive means gas not yet out; negative can occur when gas moves between regions), with ${fmt(u.palvMinusPeep,1)} cmH2O left above the airway level.`;
    if($('unit-'+k).textContent!==detail)$('unit-'+k).textContent=detail;return;
  }
  if(u&&result.trajectory?.kind==='frozen-aeration-airflow'){const i=result.units.indexOf(u),q=current?.unitFlow?.[i],node=current?current.pressure-result.airflow.params.R0*current.flow:null,palv=Number.isFinite(node)&&u.active?node-u.resistance*q:null;const detail=`Region ${u.id}: flow ${fmt(q,2)} mL/s (+ in, − out); its own emptying-time estimate (RC) ${Number.isFinite(u.tauLocal)&&u.tauLocal<.001?'<0.001':fmt(u.tauLocal,3)} s; share of extra air released ${Number.isFinite(u.fractionEmptied)?pct(u.fractionEmptied):'--'}; pressure inside this airspace ${fmt(palv,1)} cmH2O. RC = resistance × compliance for this region alone; the shared airway and chest wall also affect emptying.${Number.isFinite(u.fractionEmptied)&&(u.fractionEmptied>1||u.fractionEmptied<0)?' Air can move between regions; this fraction compares with a resting reference, not with all the air inside.':''}`;$('unit-'+k).textContent=detail+pressureDetail;return;}
  const display=u&&current?text+` Now: ${pct(current.unitOpen[u.id])} open and holding ${fmt(current.unitVolume[u.id],2)} mL of air.`+pressureDetail:text;
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
  const external=lastResults[0].conditions?.drive==='external';
  if(external)$('pv-caption').textContent='Tank mode: the vertical axis shows effective airway-minus-external pressure drive. Airway pressure itself remains zero; live numbers show the negative body and pleural pressures.';
  const plotPressure=p=>external?(p.transresp??p.pressure):p.pressure;
  const points=lastResults.flatMap(r=>r.pv).map(p=>({...p,pressure:plotPressure(p)})).filter(p=>Number.isFinite(p.volume)&&Number.isFinite(p.pressure));
  const xmin=Math.max(0,Math.floor(Math.min(...points.map(p=>p.volume))/250)*.25-.1),xmax=Math.ceil(Math.max(...points.map(p=>p.volume))/250)*.25+.1;
  const ymax=Math.max(30,Math.ceil(Math.max(...points.map(p=>p.pressure))/5)*5+5);
  const s=baseChart(svg,[xmin,xmax],[0,ymax],'Total gas volume (L)',external?'Transrespiratory drive (cmH2O)':'Airway pressure (cmH2O)');window.ardsPVScales={...s,external};
  lastResults.forEach((r,i)=>{const t=r.trajectory;if(t){const a=t.frames[t.eiIndex],b=t.frames[t.releaseIndex];line(svg,[{x:a.volume/1000,y:external?a.transrespPressure:a.pressure},{x:b.volume/1000,y:external?b.transrespPressure:b.pressure}],s,i?colors.b:colors.a,'3 4',.65);}for(const phase of ['inflation','deflation'])line(svg,r.pv.filter(p=>p.phase===phase).map(p=>({x:p.volume/1000,y:plotPressure(p)})),s,i?colors.b:colors.a);});
}
function sweepSteps(){return lastSweep?[...lastSweep[0].ascending.map((_,i)=>({direction:'ascending',i})),...lastSweep[0].descending.map((_,i)=>({direction:'descending',i}))]:[];}
function pauseSweep(announce=false){
  clearTimeout(sweepTimer);sweepTimer=0;sweepPlaying=false;
  $('play-sweep').textContent=reducedMotion.matches?'Motion reduced':sweepIndex===sweepSteps().length-1?'Replay sweep':'Play sweep';
  $('play-sweep').setAttribute('aria-pressed','false');
  if(announce)$('sweep-announce').textContent=$('sweep-readout').textContent;
}
function drawSweep(){
  const svg=$('sweep-chart'),s=baseChart(svg,[4,24],[0,100],'PEEP (cmH2O)','Tissue fraction (%)');sweepScales=s;
  $('play-sweep').disabled=!lastSweep||reducedMotion.matches;$('sweep-frame').disabled=!lastSweep;
  if(!lastSweep){svg.append(svgEl('text',{x:(s.left+s.w-s.right)/2,y:120,'text-anchor':'middle'},'No PEEP sweep results'));return;}
  lastSweep.forEach((r,i)=>{
    const c=i?colors.b:colors.a;
    for(const direction of ['ascending','descending']){
      const points=r[direction];
      line(svg,points.map(p=>({x:p.peep,y:p.openEE*100})),s,c,direction==='ascending'?'':'2 4',.25);
      line(svg,points.map(p=>({x:p.peep,y:p.over*100})),s,c,direction==='ascending'?'6 4':'6 3 2 3',.25);
      for(const p of points.filter(p=>p.limited))svg.append(svgEl('circle',{cx:s.x(p.peep),cy:s.y(p.openEE*100),r:5,fill:'none',stroke:'#b99530','stroke-width':2}));
    }
  });
  svg.setAttribute('aria-label','PEEP sweep. Solid: aerated tissue as PEEP rises. Dashed: tissue above the assumed stretch threshold as PEEP rises. Dotted and dash-dot: corresponding paths as PEEP falls. Patient A green; Patient B blue. Rings indicate the pressure ceiling.');
  renderSweepStep();
}
function renderSweepStep(announce=false){
  if(!lastSweep||!sweepScales)return;
  const steps=sweepSteps();sweepIndex=Math.max(0,Math.min(sweepIndex,steps.length-1));
  const step=steps[sweepIndex],s=sweepScales,svg=$('sweep-chart');svg.querySelector('.sweep-cursor')?.remove();
  const overlay=svgEl('g',{class:'sweep-cursor'});svg.append(overlay);
  const peep=lastSweep[0][step.direction][step.i].peep;
  overlay.append(svgEl('line',{x1:s.x(peep),x2:s.x(peep),y1:s.top,y2:s.h-s.bottom,stroke:colors.ink,'stroke-dasharray':'3 3',opacity:.55}));
  const readouts=[];
  lastSweep.forEach((r,i)=>{
    const c=i?colors.b:colors.a;
    for(const direction of ['ascending','descending']){
      const count=direction==='ascending'?(step.direction==='ascending'?step.i+1:r.ascending.length):(step.direction==='descending'?step.i+1:0),points=r[direction].slice(0,count);
      line(overlay,points.map(p=>({x:p.peep,y:p.openEE*100})),s,c,direction==='ascending'?'':'2 4');
      line(overlay,points.map(p=>({x:p.peep,y:p.over*100})),s,c,direction==='ascending'?'6 4':'6 3 2 3');
    }
    const p=r[step.direction][step.i];
    overlay.append(svgEl('circle',{cx:s.x(peep),cy:s.y(p.openEE*100),r:5,fill:c,stroke:colors.surface,'stroke-width':1}));
    overlay.append(svgEl('rect',{x:s.x(peep)-4,y:s.y(p.over*100)-4,width:8,height:8,fill:colors.surface,stroke:c,'stroke-width':2}));
    readouts.push(`${i?'B':'A'}: open before the breath ${pct(p.openEE)}, high-stretch tissue share ${pct(p.over)}${p.limited?' (pressure ceiling reached)':''}`);
  });
  const text=`PEEP ${peep} cmH2O · ${step.direction==='ascending'?'Rising':'Falling'} · ${sweepIndex+1}/${steps.length} · ${readouts.join(' · ')}`;
  $('sweep-readout').textContent=text;$('sweep-frame').max=steps.length-1;$('sweep-frame').value=sweepIndex;$('sweep-frame').setAttribute('aria-valuetext',text);
  window.ardsSweepIndex=sweepIndex;
  if(announce)$('sweep-announce').textContent=text;
}
function startSweep(){
  if(!lastSweep||reducedMotion.matches||document.hidden||$('explore').hidden||$('sweep-panel').hidden)return;
  pausePlayback();pauseSweep();const steps=sweepSteps(),result=lastSweep;if(sweepIndex>=steps.length-1)sweepIndex=0;
  sweepPlaying=true;$('play-sweep').textContent='Pause sweep';$('play-sweep').setAttribute('aria-pressed','true');renderSweepStep();
  const tick=()=>{
    if(!sweepPlaying||lastSweep!==result||reducedMotion.matches||document.hidden||$('explore').hidden||$('sweep-panel').hidden){pauseSweep();return;}
    if(sweepIndex>=steps.length-1){pauseSweep(true);return;}
    sweepIndex++;renderSweepStep();sweepTimer=setTimeout(tick,sweepIndex===result[0].ascending.length-1?1050:550);
  };
  sweepTimer=setTimeout(tick,550);
}
$('play-sweep').addEventListener('click',()=>{if(sweepPlaying)pauseSweep(true);else startSweep();});
$('sweep-frame').addEventListener('input',()=>{pauseSweep();sweepIndex=+$('sweep-frame').value;renderSweepStep(true);});
function render(){if(lastResults){['a','b'].forEach((k,i)=>{updateMetrics(k,lastResults[i]);drawMap(k,lastResults[i],currentFrames[i]);updateUnitDetail(k,lastResults[i]);});drawPV();drawFlow();renderFrame();}drawSweep();}
worker.onmessage=({data})=>{
  if(data.type==='compare'||data.type==='airflow'||data.type==='unified'){
    if(data.id!==compareId||compareContext?.id!==data.id||compareContext.mode!==$('mechanics-mode').value)return;
    if(JSON.stringify(data.config)!==compareContext.config||compareContext.config!==JSON.stringify(config())||JSON.stringify(compareContext.settings)!==JSON.stringify(settings()))return;
    if(isAirflow()&&JSON.stringify(compareContext.params)!==JSON.stringify(flowParams()))return;
    if(data.type==='unified'&&compareContext.key!==configKey())return;
    if(data.type==='compare'||data.type==='unified'){acceptedStateToken=data.stateToken;acceptedConfig=compareContext.key;worker.postMessage({id:data.stateToken,type:'accept-state'});}
    if(compareContext.prepareAirflow){const capture=compareContext.recordBaseline;compare(false,capture);return;}
    if(data.type==='airflow')for(const result of data.results)for(const frame of result.trajectory.frames)frame.unitOpen=result.trajectory.frozenOpen;
    const bookmark=viewBookmark;viewBookmark=null;lastResults=data.results;window.ardsResults=lastResults;comparisonFresh=compareContext.fresh;restoreView(bookmark);
    for(const k of ['a','b'])$('patient-'+k).removeAttribute('aria-busy');for(const id of ['comparison-explanation','adjustment-explanation']){$(id).removeAttribute('aria-busy');$(id).classList.remove('stale-result');}
    $('status').textContent=data.type==='unified'?`10 breaths of opening, expansion and airflow calculated together at RR ${lastResults[0].settings.rr}/min. ${comparisonFresh?'Fresh seeded patients for this comparison.':'Prior lung state retained.'} ${lastResults.every(r=>r.metrics.converged)?'The last breath nearly repeats the one before.':'The last breath is not yet repeating the one before.'} Pressure limit: ${fmt(lastResults[0].settings.pressureLimit)} cmH2O.`:data.type==='airflow'?`Open tissue held fixed · ${lastResults[0].breaths}/${lastResults[1].breaths} breaths calculated · ${lastResults.every(r=>r.metrics.converged)?'almost repeating now':'still changing from breath to breath'}.`:`10 breaths simulated at RR ${lastResults[0].settings.rr}/min. ${comparisonFresh?'Fresh seeded patients for this comparison.':'Prior recruitment state retained.'} Drive-pressure limit: ${fmt(lastResults[0].settings.pressureLimit)} cmH2O.`;
    if(pendingBaseline&&data.id===baselineRequest&&baselineExpected?.fresh&&baselineExpected.key===compareContext.key&&JSON.stringify(baselineExpected.settings)===JSON.stringify(compareContext.settings)&&baselineExpected.lesson===$('lesson').value&&baselineExpected.mode===$('mechanics-mode').value){baseline=lastResults.map(({trajectory,...summary})=>structuredClone(summary));baselineConfig=comparisonConfig;pendingBaseline=false;$('apply-adjustment').disabled=false;$('baseline-status').textContent='Baseline ready. Predict, then apply the change.';$('comparison-explanation').replaceChildren();$('adjustment-explanation').replaceChildren();}else renderTeaching();
    if(predictionPending?.id===data.id&&predictionPending.lesson===$('lesson').value&&predictionPending.level===$('learner-level').value){
      const answer=evaluatePrediction(predictionPending.question,predictionPending.before,lastResults,predictionPending.prediction);
      if(answer.correct!==null&&!scoredQuestions.has(predictionPending.key)){scoredQuestions.add(predictionPending.key);attempts++;if(answer.correct)correctAttempts++;}
      $('prediction-feedback').textContent=(answer.correct===true?'Prediction matched. ':answer.correct===false?'Different from your prediction. ':'Observe the result. ')+answer.observed+' '+predictionPending.question.focus+(answer.correct!==null?` (${correctAttempts}/${attempts} predictions matched this session.)`:'');
      predictionPending=null;
    }
    render();if(wantPlayback&&!reducedMotion.matches)startPlayback(); window.ardsRenderCounter=(window.ardsRenderCounter||0)+1;
    const list=document.createElement('ul');for(const item of data.modelInfo.assumptions||[]){const li=document.createElement('li');li.textContent=item;list.append(li);} $('model-info').replaceChildren(list);
  }else if(data.type==='sweep'){
    if(data.id!==sweepId)return;pauseSweep();lastSweep=data.results;window.ardsSweep=lastSweep;sweepIndex=sweepSteps().length-1;drawSweep();$('sweep').disabled=false;$('sweep').textContent='Run PEEP sweep';
    $('sweep-caption').textContent='Solid lines: tissue staying open before the next breath as PEEP rises. Dashed: open tissue above the assumed stretch cutoff at the end of the breath in. Dotted paths repeat the comparison as PEEP falls. Rings mark the pressure limit; check delivered volume. Each point uses ten breaths; lines only connect calculated points.';startSweep();
  }else if(data.type==='benchmark-progress'){if(data.id===benchmarkId)$('benchmark-status').textContent=data.message;}
  else if(data.type==='benchmark'){
    if(data.id!==benchmarkId)return;deviceResults=data.results;window.ardsBenchmark=deviceResults;$('benchmark-rows').replaceChildren();
    for(const r of deviceResults.rows){const row=document.createElement('tr');for(const v of [r.units,fmt(r.medianMs,1)+' ms',fmt(r.p95Ms,1)+' ms',fmt(r.realTimeFactor,1)+'x']){const td=document.createElement('td');td.textContent=v;row.append(td);}$('benchmark-rows').append(row);}
    $('benchmark-status').textContent=`Completed ${new Date(deviceResults.date).toLocaleString()}. Seven timed runs per size; engine only.`;$('run-benchmark').disabled=false;$('export-benchmark').disabled=false;
  }else if(data.type==='error'){
    const currentId=data.requestType==='benchmark'?benchmarkId:data.requestType==='sweep'?sweepId:(data.requestType==='compare'||data.requestType==='airflow'||data.requestType==='unified')?compareId:null;if(data.id!==currentId)return;
    if(data.requestType==='airflow'||data.requestType==='unified'){predictionPending=null;lastResults=null;currentFrames=[];$('play-breath').disabled=true;$('breath-frame').disabled=true;for(const k of ['a','b']){$('metrics-'+k).replaceChildren();$('live-'+k).textContent='No valid result for these settings.';const c=$('map-'+k);c.getContext('2d').clearRect(0,0,c.width,c.height);}}
    if(data.requestType==='compare'||data.requestType==='airflow'||data.requestType==='unified'){pendingBaseline=false;$('apply-adjustment').disabled=true;for(const k of ['a','b'])$('patient-'+k).removeAttribute('aria-busy');for(const id of ['comparison-explanation','adjustment-explanation']){$(id).removeAttribute('aria-busy');$(id).classList.remove('stale-result');}}
    for(const id of ['comparison-explanation','adjustment-explanation']){$(id).removeAttribute('aria-busy');}
    const target=data.requestType==='benchmark'?'benchmark-status':'status';$(target).textContent='Simulation error: '+data.message;$(target).setAttribute('role','alert');if(data.requestType==='sweep'){$('sweep').disabled=false;$('sweep').textContent='Run PEEP sweep';}if(data.requestType==='benchmark')$('run-benchmark').disabled=false;
  }
};
worker.onerror=event=>{$('status').textContent='The simulation could not load: '+event.message;$('status').setAttribute('role','alert');};
function invalidateSweep(){pauseSweep();sweepIndex=0;$('sweep-readout').textContent='';lastSweep=null;sweepId=0;window.ardsSweep=null;$('sweep').disabled=false;$('sweep').textContent='Run PEEP sweep';$('sweep-caption').textContent='Run a fresh standardized sweep for these settings.';drawSweep();updateExperimentViews();}
for(const k of ['peep','vt','rr'])$(k).addEventListener('input',()=>{if(k!=='peep')invalidateSweep();labels();schedule();});
for(const [,spec] of [...Object.entries(UNIFIED_FIELDS),...Object.entries(CUSTOM_FIELDS)])$(spec[0]).addEventListener('change',()=>{const el=$(spec[0]);if(el.value!==''||spec[3]!==null)el.value=String(Number(boundedField(spec).toPrecision(6)));if(isUnified()){invalidateSweep();schedule(true,true);}});
$('u-target').addEventListener('change',()=>{if(isUnified()){invalidateSweep();schedule(true,true);}});
$('u-custom').addEventListener('change',()=>{$('u-target').disabled=!$('u-custom').checked;for(const spec of Object.values(CUSTOM_FIELDS))$(spec[0]).disabled=!$('u-custom').checked;if(isUnified()){invalidateSweep();schedule(true,true);}});
$('resistance').addEventListener('input',()=>{labels();if(isUnified()){invalidateSweep();schedule(true,true);}else schedule();});
$('pbw').addEventListener('input',()=>{invalidateSweep();labels();schedule(true,true);});
for(const k of ['a','b'])for(const type of ['kind','seed'])$(type+'-'+k).addEventListener('change',()=>{
  const seed=$('seed-'+k);if(!Number.isFinite(Number(seed.value))||Number(seed.value)<0||Number(seed.value)>4294967295)seed.value=k==='a'?13791:14602;
  invalidateSweep();schedule(false,true);
});
$('ee').addEventListener('click',()=>inspectFrame(0));
$('ei').addEventListener('click',()=>inspectFrame(lastResults?.[0].trajectory?.eiIndex??0));
$('release-breath').addEventListener('click',()=>inspectFrame(lastResults?.[0].trajectory?.releaseIndex??0));
$('end-expiration').addEventListener('click',()=>inspectFrame((lastResults?.[0].trajectory?.frames.length??1)-1));
$('reset').addEventListener('click',()=>{viewBookmark=false;invalidateComparison();clearTimeout(timer);invalidateSweep();compare(true);});
$('new-seeds').addEventListener('click',()=>{viewBookmark=false;const seeds=new Uint32Array(2);crypto.getRandomValues(seeds);invalidateComparison(true);$('seed-a').value=seeds[0];$('seed-b').value=seeds[1];invalidateSweep();compare(true);});
for(const id of ['pressure-drive','posture','chest-load'])$(id).addEventListener(id==='chest-load'?'input':'change',()=>{updateExperimentViews();invalidateComparison();invalidateSweep();clearTimeout(timer);timer=setTimeout(()=>compare(),100);});
$('share').addEventListener('click',async()=>{
  const url=new URL(location.href);url.search='';for(const k of ['peep','vt','rr','pbw','kind-a','kind-b','seed-a','seed-b','pressure-drive','posture','chest-load'])url.searchParams.set(k,$(k).value);
  if(isAirflow()){url.searchParams.set('mode','airflow');url.searchParams.set('resistance',$('resistance').value);}
  if(isUnified()){
    url.searchParams.set('mode','unified');url.searchParams.set('resistance',$('resistance').value);
    for(const [name,spec] of Object.entries(UNIFIED_FIELDS))url.searchParams.set('u-'+name,String(Number(unifiedValue(name).toPrecision(8))));
    const custom=recruitability();if(custom){url.searchParams.set('u-custom','1');url.searchParams.set('u-target',$('u-target').value);for(const [name,spec] of Object.entries(CUSTOM_FIELDS)){const v=customValue(name);if(v!==null)url.searchParams.set('u-'+name,String(Number(v.toPrecision(8))));}}
  }
  try{await navigator.clipboard.writeText(url.href);$('status').textContent='Scenario link copied. It recreates the seeds and settings from fresh state; pressure history is not included.';}
  catch{window.prompt('Copy this scenario link. It starts from fresh state.',url.href);}
});
$('sweep').addEventListener('click',()=>{if(isAirflow()||isUnified()||experiment().drive==='external')return;pauseSweep();$('sweep').disabled=true;$('sweep').textContent='Sweeping...';sweepId=++request;worker.postMessage({id:sweepId,type:'sweep',config:config(),settings:settings()});});
$('run-benchmark').addEventListener('click',()=>{$('run-benchmark').disabled=true;benchmarkId=++request;worker.postMessage({id:benchmarkId,type:'benchmark'});});
$('export-benchmark').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(deviceResults,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='ARDS-Sim-device-benchmark.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
const tabs=[...document.querySelectorAll('[role=tab]')];
function selectTab(tab){pauseSweep();pausePlayback();for(const t of tabs){const active=t===tab;t.classList.toggle('active',active);t.setAttribute('aria-selected',String(active));$(t.getAttribute('aria-controls')).hidden=!active;}if(tab.id==='tab-explore')render();}
tabs.forEach((tab,index)=>{tab.addEventListener('click',()=>selectTab(tab));tab.addEventListener('keydown',e=>{if(['ArrowRight','ArrowLeft','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length;tabs[next].focus();selectTab(tabs[next]);}});});
window.addEventListener('resize',()=>{clearTimeout(window.ardsResize);window.ardsResize=setTimeout(render,100);});
function pausePlayback(clearIntent=true){
  displayFrames=null;displayKind=null;if(raf)cancelAnimationFrame(raf);raf=0;playing=false;if(clearIntent)wantPlayback=false;
  $('play-breath').textContent='Play breath';$('play-breath').setAttribute('aria-pressed','false');
}
function inspectFrame(index){
  pausePlayback();const t=lastResults?.[0].trajectory;if(!t)return;
  const i=Math.max(0,Math.min(t.frames.length-1,Math.trunc(index)||0)),frame=t.frames[i];replayTime=frame.time;currentFrameIndex=i;currentFrames=lastResults.map(r=>r.trajectory.frames[i]);renderFrame(true);
}
function rememberView(){
  if(viewBookmark!==null||!lastResults?.[0].trajectory)return;
  const t=lastResults[0].trajectory,frame=currentFrames[0];
  const names=[[0,'start'],[t.eiIndex,'ei'],[t.releaseIndex,'release'],[t.frames.length-1,'end']];
  const anchor=names.find(([i])=>frame===t.frames[i])?.[1];
  const b={config:acceptedConfig,kind:t.kind,anchor,fraction:replayTime/t.cycle,mode:playing?'play':'inspect'};
  if(playing){
    const elapsed=Math.max(0,(performance.now()-playStart)/1000+playOffset),d=displaySegment(t,elapsed,playbackOptions());
    b.segment=d.segment;
    b.progress=d.segment==='inspiration'?d.replayTime/t.ti:d.segment==='expiration'?(d.replayTime-t.ti)/(t.cycle-t.ti):d.segment==='hold'?(elapsed-t.ti)/playbackOptions().hold:d.weight;
  }
  viewBookmark=b;
}
function restoreView(b){
  const t=lastResults[0].trajectory;replayTime=0;currentFrameIndex=0;resumeElapsed=null;displayFrames=null;displayKind=null;
  if(b&&b.config===compareContext.key&&b.kind===t.kind){
    if(b.mode==='play'){
      const u=Math.max(0,Math.min(1,b.progress)),ei=t.kind==='quasi-static-steps'?TRANSITION:0,H=playbackOptions().hold;
      const elapsed=b.segment==='inspiration'?u*t.ti:b.segment==='hold'?t.ti+u*H:b.segment==='ei-transition'?t.ti+H+u*ei:b.segment==='expiration'?t.ti+H+ei+u*(t.cycle-t.ti):t.cycle+H+ei+u*LOOP_TRANSITION;
      const d=displaySegment(t,elapsed,playbackOptions());replayTime=d.replayTime;
      const sample=d.segment==='expiration'&&replayTime===t.ti?{index:t.releaseIndex}:sampleTrajectory(t,replayTime);currentFrameIndex=sample.index;resumeElapsed=elapsed;
      currentFrames=lastResults.map(r=>d.segment==='expiration'&&replayTime===t.ti?r.trajectory.frames[r.trajectory.releaseIndex]:sampleTrajectory(r.trajectory,replayTime).frame);return;
    }
    const index=b.anchor==='start'?0:b.anchor==='ei'?t.eiIndex:b.anchor==='release'?t.releaseIndex:b.anchor==='end'?t.frames.length-1:null;
    if(index!==null)currentFrameIndex=index;
    else {const target=b.fraction*t.cycle;let best=Infinity;for(let i=0;i<t.frames.length;i++){const distance=Math.abs(t.frames[i].time-target);if(distance<best){best=distance;currentFrameIndex=i;}}}
    replayTime=t.frames[currentFrameIndex].time;
  }
  currentFrames=lastResults.map(r=>r.trajectory?.frames[currentFrameIndex]);
}
function drawPressureField(k,frame,field,p,kind){
  const svg=$('pressure-field-'+k);svg.replaceChildren();
  if(!field||!p){svg.append(svgEl('text',{x:8,y:20},'Pressure field unavailable'));return;}
  const width=svg.clientWidth||350,height=118,left=55,right=20,top=20,bottom=86;
  svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
  const x=v=>left+(Math.max(-50,Math.min(50,v))+50)/100*(width-left-right),y=d=>top+d*(bottom-top);
  for(const v of [-50,0,50]){svg.append(svgEl('line',{x1:x(v),x2:x(v),y1:top,y2:bottom,stroke:colors.grid,'stroke-width':.6}));svg.append(svgEl('text',{x:x(v),y:104,'text-anchor':'middle'},String(v)));}
  svg.append(svgEl('text',{x:2,y:top+4},'Ventral'));svg.append(svgEl('text',{x:2,y:bottom},'Dorsal'));
  const a=p.pplVentral,b=p.pplDorsal,ya=y(0),yb=y(1),paw=frame.pressure,flowish=kind!=='quasi-static-steps',alv=kind===UNIFIED_KIND&&Number.isFinite(frame.meanAlveolar)?frame.meanAlveolar:null;
  svg.append(svgEl('polygon',{points:`${x(paw)},${ya} ${x(a)},${ya} ${x(b)},${yb} ${x(paw)},${yb}`,fill:'#798ec5',opacity:.12}));
  svg.append(svgEl('line',{x1:x(a),x2:x(b),y1:ya,y2:yb,stroke:'#9373b5','stroke-width':2}));
  svg.append(svgEl('line',{x1:x(paw),x2:x(paw),y1:ya,y2:yb,stroke:colors.a,'stroke-width':2}));
  if(alv!==null)svg.append(svgEl('line',{x1:x(alv),x2:x(alv),y1:ya,y2:yb,stroke:colors.b,'stroke-width':2,'stroke-dasharray':'5 3'}));
  svg.append(svgEl('circle',{cx:x(p.pesModel),cy:y(field.dEs),r:4,fill:'#9373b5',stroke:colors.surface,'stroke-width':1}));
  svg.append(svgEl('text',{x:left,y:12},alv===null?'Airway (line) · Pleural (slope) · Pes surrogate (dot)':'Paw · Mean Palv (dashed) · Pleural · Pes'));
  const outside=[paw,a,b,p.pesModel,...(alv===null?[]:[alv])].some(v=>v < -50||v > 50);
  svg.append(svgEl('text',{x:(left+width-right)/2,y:116,'text-anchor':'middle'},outside?'Outside plot range; inspect numeric values':kind===UNIFIED_KIND?'cmH2O · mean PL = mean alveolar − mean pleural':flowish?'cmH2O · airway gap includes resistance':'cmH2O · shaded gap = local lung-distending pressure'));
  svg.setAttribute('aria-label',`Assumed pleural field. Ventral ${fmt(a,1)}, dorsal ${fmt(b,1)}, esophageal surrogate ${fmt(p.pesModel,1)} cmH2O. ${kind===UNIFIED_KIND?`Mean alveolar ${fmt(frame.meanAlveolar,1)} cmH2O; mean lung pressure is mean alveolar minus mean pleural; regional alveolar values differ. Airway-minus-pleural includes resistance.`:kind==='frozen-aeration-airflow'?'Airway-minus-pleural gap includes resistance.':'Gap is local model transpulmonary pressure.'}`);
}
function renderPressures(k,r,frame){
  const field=getPleuralField(r),pressure=framePleural(frame,field),rows=frameReadout(frame,r.trajectory.kind,r.trajectory.frames[0].volume,pressure),root=$('pressures-'+k);
  const signature=rows.map(row=>row.key).join();
  if(!readoutCells[k]||readoutSignature[k]!==signature){
    readoutSignature[k]=signature;root.replaceChildren();readoutCells[k]={};
    for(const row of rows){const cell=document.createElement('div'),label=document.createElement('span'),value=document.createElement('strong'),unit=document.createElement('small');cell.className='pressure-cell';cell.append(label,value,unit);root.append(cell);readoutCells[k][row.key]={cell,label,value,unit};}
  }
  for(const row of rows){const c=readoutCells[k][row.key];c.label.textContent=row.label;c.value.textContent=row.value===null?'—':fmt(row.value,row.key==='volume'||row.key==='flow'?2:row.key==='delta'?0:1);c.unit.textContent=row.unit;c.cell.title=row.note;c.cell.setAttribute('aria-label',`${row.label}: ${c.value.textContent} ${row.unit}. ${row.note}`);}
  const unified=r.trajectory.kind===UNIFIED_KIND,mapKeys=unified?['paw','palv','ppl','pes','pl','volume']:['paw','pes','plEs','volume'],strip=$('map-pressures-'+k);
  strip.classList.toggle('unified-strip',unified);
  if(!mapReadoutCells[k]||Object.keys(mapReadoutCells[k]).join()!==mapKeys.join()){mapReadoutCells[k]={};strip.replaceChildren();for(const key of mapKeys){const cell=document.createElement('span'),label=document.createElement('small'),value=document.createElement('strong');cell.append(label,value);strip.append(cell);mapReadoutCells[k][key]={label,value};}}
  for(const key of mapKeys){const row=rows.find(x=>x.key===key),c=mapReadoutCells[k][key];c.label.textContent=key==='plEs'?(r.trajectory.kind!=='quasi-static-steps'?'Paw − Pes':'PL from Pes'):({volume:'Volume (L)',paw:'Airway · Paw',palv:'Mean alveolar',ppl:'Mean pleural',pl:'Mean lung · PL',pes:'Pes surrogate'}[key]);c.value.textContent=fmt(row.value,key==='volume'?2:1);c.value.title=row.note;c.value.setAttribute('aria-label',row.label+': '+c.value.textContent+' '+row.unit+'. '+row.note);}
  drawPressureField(k,frame,field,pressure,r.trajectory.kind);
  $('pressure-scope-'+k).textContent=(displayKind==='loop'?'Values held at recorded end during visual replay transition. ':displayFrames?'Values held at end inspiration during visual transition. ':'')+'Simulated Pes samples pressure around the lung at one assumed position. It is not a clinical balloon reading.';
  root.setAttribute('aria-live',playing?'off':'polite');
}
function renderFrame(announce=false){
  const trajectory=lastResults?.[0].trajectory;if(!trajectory)return;
  window.ardsReplayTime=replayTime;window.ardsFrameIndex=currentFrameIndex;
  const selected=trajectory.frames[currentFrameIndex],name=labelFor(currentFrames[0]||selected,currentFrameIndex,trajectory);
  $('play-breath').disabled=reducedMotion.matches||!trajectory.frames.length;$('play-breath').textContent=reducedMotion.matches?'Motion reduced':playing?'Pause':'Play breath';
  $('loop-breath').disabled=reducedMotion.matches;
  $('replay-note').textContent=reducedMotion.matches?'Motion reduced: inspect with the phase buttons or scrubber.':'One calculated breath, repeated. Blend transitions are visual.';
  $('breath-frame').disabled=false;$('breath-frame').max=trajectory.frames.length-1;$('breath-frame').value=currentFrameIndex;
  $('breath-frame').setAttribute('aria-valuetext',`${name}, ${fmt(replayTime,2)} seconds`);
  $('breath-phase').textContent=`${name==='End inspiration'&&playing?'End inspiration (inspect)':name} · ${fmt(replayTime,2)} / ${fmt(trajectory.cycle,2)} s`;
  $('ee').setAttribute('aria-pressed',String(currentFrameIndex===0&&!playing));$('ei').setAttribute('aria-pressed',String(currentFrames[0]===trajectory.frames[trajectory.eiIndex]));$('release-breath').setAttribute('aria-pressed',String(currentFrames[0]===trajectory.frames[trajectory.releaseIndex]));$('end-expiration').setAttribute('aria-pressed',String(currentFrameIndex===trajectory.frames.length-1));
  const label=name;
  const messages=isUnified()?UNIFIED_PHASE:PHASE_COPY[isAirflow()?'airflow':'recruitment'];
  $('phase-story').textContent=reducedMotion.matches?'Use the phase buttons to look at each calculated part of the breath.':messages[name]||messages.Inspiration;
  if(currentFrames.some(f=>f?.ceilingActive))$('phase-story').textContent='The model reached its pressure limit here. Check whether it delivered the whole requested breath.';
  lastResults.forEach((r,i)=>{const frame=currentFrames[i];if(!frame)return;const k=i?'b':'a';drawMap(k,r,displayFrames?.[i]??frame);renderPressures(k,r,frame);$('live-'+k).textContent=r.trajectory.kind===UNIFIED_KIND?`${fmt(frame.volume/1000,2)} L · ${pct(frame.open)} open · Paw ${fmt(frame.pressure,1)} cmH2O · Palv ${fmt(frame.meanAlveolar,1)} − Ppl ${fmt(frame.meanPleural,1)} = mean PL ${fmt(frame.meanAlveolar-frame.meanPleural,1)} cmH2O · Flow ${fmt(frame.flow/1000,2)} L/s`:r.trajectory.kind==='frozen-aeration-airflow'?`${fmt(frame.volume/1000,2)} L · Paw ${fmt(frame.pressure,1)} cmH2O · Flow ${fmt(frame.flow/1000,2)} L/s`:$('lesson').value==='wall'||$('learner-level').value!=='student'?`${fmt(frame.volume/1000,2)} L · ${pct(frame.open)} open · Paw ${fmt(frame.pressure,1)} − Ppl ${fmt(frame.meanPleural,1)} = PL ${fmt(frame.pressure-frame.meanPleural,1)} cmH2O`:`${fmt(frame.volume/1000,2)} L · Paw ${fmt(frame.pressure,1)} cmH2O · ${pct(frame.open)} open`;$('unit-'+k).setAttribute('aria-live',playing?'off':'polite');if(!playing||selectedUnits[k]!==null)updateUnitDetail(k,r);});
  if((isAirflow()||isUnified())&&window.ardsFlowScales){const scales=window.ardsFlowScales;document.querySelectorAll('#flow-chart .breath-cursor').forEach(e=>e.remove());currentFrames.forEach((frame,i)=>$('flow-chart').append(svgEl('circle',{class:'breath-cursor',cx:scales.x(replayTime),cy:scales.y(frame.flow/1000),r:4,fill:i?colors.b:colors.a})));}
  if(lastResults[0].conditions?.drive==='external'){$('phase-story').textContent=name==='Inspiration'?'Pressure outside the chest falls to help the lung fill; pressure at the airway opening stays at zero.':name==='End inspiration'?'Zero airway pressure does not mean no push across the lung. Look at the lower pressure around it.':name==='Pressure release'?'Pressure outside the chest returns to its between-breath level. This view calculates an immediate gas release.':'Watch pressure inside and around the lung. This simple model makes matching pushes give matching lung expansion.';}
  if(displayFrames&&displayKind!=='loop'){$('breath-phase').textContent=`Expiration transition (visual) · ${fmt(replayTime,2)} / ${fmt(trajectory.cycle,2)} s`;$('phase-story').textContent='A smooth display blend joins two calculated moments. It is not a new airflow calculation.';}
  if(displayKind==='loop'){const first=trajectory.frames[0],last=trajectory.frames.at(-1);$('breath-phase').textContent='Replay transition (visual)';$('phase-story').textContent=`Same recorded breath: end-to-start difference ${fmt(last.volume-first.volume,1)} mL and ${fmt((last.open-first.open)*100,2)} percentage points of aeration.`;}
  if(announce)$('breath-announce').textContent=$('breath-phase').textContent;
  if(window.ardsPVScales){const scales=window.ardsPVScales;document.querySelectorAll('#pv-chart .breath-cursor').forEach(e=>e.remove());currentFrames.forEach((frame,i)=>{if(frame)$('pv-chart').append(svgEl('circle',{class:'breath-cursor',cx:scales.x(frame.volume/1000),cy:scales.y(scales.external?frame.transrespPressure:frame.pressure),r:4,fill:i?colors.b:colors.a,stroke:'#fff','stroke-width':1}));});}
}
function tickPlayback(now){
  if(!playing||document.hidden||$('explore').hidden||reducedMotion.matches){pausePlayback();return;}
  const drawStart=performance.now(),t=lastResults[0].trajectory;
  let elapsed=Math.max(0,(now-playStart)/1000+playOffset),d=displaySegment(t,elapsed,playbackOptions());
  if(d.segment==='done'&&$('loop-breath').checked){
    const overshoot=elapsed-d.period;elapsed=overshoot<d.period?overshoot:0;playStart=now-elapsed*1000;playOffset=0;
    window.ardsLoopCounter=(window.ardsLoopCounter||0)+1;d=displaySegment(t,elapsed,playbackOptions());
  }
  displayFrames=null;displayKind=null;replayTime=d.replayTime;
  const samples=lastResults.map(r=>d.segment==='expiration'&&replayTime===t.ti?{frame:r.trajectory.frames[r.trajectory.releaseIndex],index:r.trajectory.releaseIndex}:sampleTrajectory(r.trajectory,replayTime));
  currentFrames=samples.map(s=>s.frame);currentFrameIndex=samples[0].index;
  if(d.segment==='ei-transition'||d.segment==='loop-transition'){
    const w=d.weight*d.weight*(3-2*d.weight);displayKind=d.segment==='loop-transition'?'loop':'release';
    displayFrames=lastResults.map(r=>displayKind==='loop'?{...loopTransitionFrame(r.trajectory,w),loopWeight:w}:{...transitionFrame(r.trajectory,w),transitionWeight:w});
  }
  window.ardsDisplaySegment=d.segment;window.ardsDisplayWeight=d.weight;window.ardsAnimationCounter=(window.ardsAnimationCounter||0)+1;renderFrame();
  if(window.ardsReplayTimings.length<240)window.ardsReplayTimings.push(performance.now()-drawStart);
  if(d.segment==='done'){pausePlayback();renderFrame(true);return;}
  raf=requestAnimationFrame(tickPlayback);
}
function startPlayback(){
  pauseSweep();const t=lastResults?.[0].trajectory;if(!t||reducedMotion.matches||document.hidden||$('explore').hidden)return;
  pausePlayback(false);
  if(replayTime>=t.cycle&&!$('loop-breath').checked){replayTime=0;currentFrameIndex=0;resumeElapsed=null;}
  wantPlayback=true;playing=true;playOffset=resumeElapsed??displayElapsed(t,replayTime,currentFrameIndex,playbackOptions());resumeElapsed=null;playStart=performance.now();window.ardsReplayTimings=[];
  $('play-breath').textContent='Pause';$('play-breath').setAttribute('aria-pressed','true');raf=requestAnimationFrame(tickPlayback);
}
$('play-breath').addEventListener('click',()=>{if(playing){pausePlayback();renderFrame(true);}else startPlayback();});
$('loop-breath').addEventListener('change',()=>{if(!$('loop-breath').checked&&displayKind==='loop'){pausePlayback();renderFrame(true);}});
$('breath-frame').addEventListener('input',()=>inspectFrame(+$('breath-frame').value));
document.addEventListener('keydown',event=>{if($('explore').hidden||event.target.closest('input,select,textarea,button,a,summary'))return;if(event.key===' '){event.preventDefault();if(playing){pausePlayback();renderFrame(true);}else startPlayback();}else if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();const last=(lastResults?.[0].trajectory?.frames.length??1)-1;inspectFrame(Math.max(0,Math.min(last,currentFrameIndex+(event.key==='ArrowRight'?1:-1))));}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){pauseSweep();pausePlayback();}});
reducedMotion.addEventListener('change',()=>{pauseSweep();$('play-sweep').disabled=!lastSweep||reducedMotion.matches;if(reducedMotion.matches)inspectFrame(currentFrameIndex);else renderFrame(true);});
const dockObserver=new ResizeObserver(()=>{
  document.documentElement.style.setProperty('--control-dock-height',`${document.querySelector('.control-dock').getBoundingClientRect().height}px`);
  document.documentElement.style.setProperty('--breath-panel-height',`${document.querySelector('.breath-panel').getBoundingClientRect().height}px`);
});dockObserver.observe(document.querySelector('.control-dock'));dockObserver.observe(document.querySelector('.breath-panel'));
let previousMode='recruitment';
function updateModeViews(){
  const flow=isAirflow(),unified=isUnified();
  $('stretch-scope').textContent=unified?'Red warns about possible excessive stretch; it does not count injured tissue.':'These are model stretch markers, not a count of injured lung.';$('stretch-scope').hidden=flow;pauseSweep();if(flow)restoreExperiment();else updateExperimentViews();
  $('resistance-control').hidden=!(flow||unified);$('mode-context').hidden=!(flow||unified);$('flow-panel').hidden=!(flow||unified);$('sweep-panel').hidden=flow||unified;
  $('mode-context').textContent=unified?'Unified experiment: opening, expansion and airflow are calculated together for each region, with no pause. Mechanics settings are shared by both patients, and changing them starts fresh lungs.':'Airflow experiment: aeration is held fixed. Gas moves through assumed resistances and a linear compliance approximation.';
  $('unified-advanced').hidden=!unified;$('unified-custom').hidden=!unified;
  for(const [id,lo,hi] of [['vt',unified?1:4,unified?14:8],['rr',unified?8:12,unified?40:30]]){$(id).min=lo;$(id).max=hi;}
  $('guided-mode').disabled=flow;$('release-breath').textContent=flow||unified?'Exp start':'Release';previousMode=$('mechanics-mode').value;
  renderLegend();renderMapHelp();refreshEli5();
  $('pv-caption').textContent=unified?'The cursor follows the breath. At the start of expiration the airway pressure drops at once (dashed) while gas volume stays put; volume falls only as flow carries air out. No pause is simulated, so no plateau pressure or compliance is shown.':flow?'When the breath in stops, pressure drops first. The gas volume then falls as air works its way out through the airways.':'The cursor follows the breath. A steeper rise means more pressure for the same added air. This recruitment view calculates an instant gas release; the smooth shrinking is visual.';
}
$('mechanics-mode').addEventListener('change',()=>{
  viewBookmark=false;pausePlayback();invalidateComparison(true);lastResults=null;currentFrames=[];$('play-breath').disabled=true;$('breath-frame').disabled=true;
  for(const k of ['a','b']){$('metrics-'+k).replaceChildren();$('live-'+k).textContent='Preparing experiment…';const c=$('map-'+k);c.getContext('2d').clearRect(0,0,c.width,c.height);}
  if(previousMode==='recruitment')recruitmentLesson=$('lesson').value;
  if(isUnified())$('lesson').innerHTML=unifiedOptions;else if(isAirflow())$('lesson').innerHTML=airflowOptions;else{$('lesson').innerHTML=recruitmentOptions;$('lesson').value=recruitmentLesson;}
  updateModeViews();setLessonBaseline();
});
function updateAirflowMetrics(k,result){
  $('patient-'+k).querySelector('.unified-flags')?.remove();
  const m=result.metrics,box=$('metrics-'+k);box.replaceChildren(metric('Delivered / requested',`${fmt(m.vtDelivered)} / ${fmt(result.targetVT)}`,'mL',false,'delivery'),metric('Peak airway pressure',fmt(m.ppeak,1),'cmH2O',false,'ppeak'),metric('Extra air released',pct(m.fractionEmptied),'',true,'fractionEmptied'),metric('Extra air left at end',fmt(m.retainedVolume,1),'mL',true,'retainedVolume'));
  const patient=$('patient-'+k);let help=patient.querySelector('.metric-description');if(!help){help=document.createElement('div');help.className='metric-description';help.setAttribute('aria-live','polite');patient.append(help);}help.textContent='';
  let advanced=patient.querySelector('.advanced-metrics');if(!advanced){advanced=document.createElement('details');advanced.className='advanced-metrics';advanced.innerHTML='<summary>Additional model measures</summary><div class="metrics"></div>';patient.append(advanced);}
  advanced.querySelector('.metrics').replaceChildren(metric('Equivalent RC estimate',fmt(m.tauEquivalent,3),'s',false,'tauEquivalent'),metric('Frozen chord compliance',fmt(m.complianceInput,1),'mL/cmH2O',false,'complianceInput'),metric('Hypothetical end-hold pressure',fmt(m.virtualEndHoldPressure,1),'cmH2O',false,'virtualEndHoldPressure'),metric('Hypothetical excess PEEP',fmt(m.virtualAutoPeep,1),'cmH2O',false,'virtualAutoPeep'));
  let pressure=patient.querySelector('.pressure-summary');if(!pressure){pressure=document.createElement('p');pressure.className='pressure-summary';advanced.append(pressure);}pressure.textContent=`Periodicity residual ${fmt(m.periodicResidual,3)} mL. ${m.converged?'Convergence criterion reached.':'Settling cap reached; this trial is not near periodic.'} Chord-range excursions: ${pct(m.extrapolatedWeight)} of tissue weight; maximum ${pct(result.airflow.chordExcursion.maxRelative)} of that region’s reference breath-volume increment. This linear approximation is not calibrated outside its reference chord.`;
  $('delivery-'+k).textContent=m.limited?'Pressure-limited model: flow falls to hold the pressure ceiling; check delivered volume.':'';
}
function renderUnifiedTeaching(){
  const pieces=[];for(const key of ['peep','vt','rr'])if(baseline[0].settings[key]!==lastResults[0].settings[key])pieces.push(`${key.toUpperCase()} ${baseline[0].settings[key]} → ${lastResults[0].settings[key]}`);
  if(!predictionPending)$('prediction-feedback').textContent=pieces.length?pieces.join('; ')+(pieces.length>1?'. Multiple controls changed.':'.'):'No setting change from the baseline.';
  $('adjustment-explanation').textContent='Opening, expansion and flow are calculated together with continuous gas volume. Compare gas held at PEEP with extra gas that has not finished leaving, and check whether the requested breath was delivered.';
  lastResults.forEach((r,i)=>{const b=baseline[i].metrics,m=r.metrics,article=document.createElement('article'),h=document.createElement('h3'),p=document.createElement('p');h.textContent='Patient '+(i?'B':'A');
    p.textContent=`End-of-breath gas ${fmt(b.endVolume/1000,2)} → ${fmt(m.endVolume/1000,2)} L; held at PEEP (reference) ${fmt(b.restingPEEPVolume/1000,2)} → ${fmt(m.restingPEEPVolume/1000,2)} L; difference ${fmt(b.dynamicResidual,1)} → ${fmt(m.dynamicResidual,1)} mL. Open tissue at the end ${pct(b.openEnd)} → ${pct(m.openEnd)}; high-stretch share ${pct(b.over)} → ${pct(m.over)}; delivered ${fmt(b.vtDelivered)} → ${fmt(m.vtDelivered)} mL; peak airway pressure ${fmt(b.ppeak,1)} → ${fmt(m.ppeak,1)} cmH2O.`;article.append(h,p);$('comparison-explanation').append(article);});
}
function renderAirflowTeaching(){
  const pieces=[];for(const key of ['peep','vt','rr'])if(baseline[0].settings[key]!==lastResults[0].settings[key])pieces.push(`${key.toUpperCase()} ${baseline[0].settings[key]} → ${lastResults[0].settings[key]}`);
  if(baseline[0].airflow.params.R0!==lastResults[0].airflow.params.R0)pieces.push(`central resistance ${baseline[0].airflow.params.R0*1000} → ${lastResults[0].airflow.params.R0*1000} cmH2O·s/L`);
  if(!predictionPending)$('prediction-feedback').textContent=pieces.length?pieces.join('; ')+(pieces.length>1?'. Multiple controls changed.':'.'):'No setting change from the airflow baseline.';
  $('adjustment-explanation').textContent='The amount of open tissue stays the same here. Air still needs time to leave through the airways. More resistance or less time for breathing out can leave more extra air behind.';
  lastResults.forEach((r,i)=>{const article=document.createElement('article'),h=document.createElement('h3'),p=document.createElement('p');h.textContent='Patient '+(i?'B':'A');p.textContent=`Peak airway pressure ${fmt(baseline[i].metrics.ppeak,1)} → ${fmt(r.metrics.ppeak,1)} cmH2O; extra air left ${fmt(baseline[i].metrics.retainedVolume,1)} → ${fmt(r.metrics.retainedVolume,1)} mL; share of extra air released ${pct(baseline[i].metrics.fractionEmptied)} → ${pct(r.metrics.fractionEmptied)}. The region’s own time constant leaves out the shared airway and chest wall.`;article.append(h,p);$('comparison-explanation').append(article);});
}
function drawFlow(){
  if(!(isAirflow()||isUnified())||!lastResults?.[0].trajectory)return;
  const all=lastResults.flatMap(r=>r.trajectory.frames.map(f=>f.flow/1000)),lo=Math.min(-.2,...all),hi=Math.max(.2,...all),s=baseChart($('flow-chart'),[0,lastResults[0].trajectory.cycle],[lo,hi],'Time (s)','Flow (L/s)');window.ardsFlowScales=s;
  lastResults.forEach((r,i)=>line($('flow-chart'),r.trajectory.frames.map(f=>({x:f.time,y:f.flow/1000})),s,i?colors.b:colors.a));
}
for(const [i,el] of [...document.querySelectorAll('.all-pressures')].entries()){const key='ards-all-pressures-'+i;try{el.open=localStorage.getItem(key)==='open';}catch{}el.addEventListener('toggle',()=>{try{localStorage.setItem(key,el.open?'open':'closed');}catch{}});}
const numbersState=new Map();
function numberDetails(records,key,title='Work through the numbers'){
  const details=document.createElement('details'),summary=document.createElement('summary'),content=document.createElement('div');details.className='numbers-explainer';summary.textContent=title;details.append(summary,content);
  details.open=numbersState.get(key)||false;details.addEventListener('toggle',()=>numbersState.set(key,details.open));
  content.setAttribute('aria-live','off');
  if(typeof records==='string'){const p=document.createElement('p');p.textContent=records;content.append(p);}
  else for(const item of records){const topic=document.createElement('details'),head=document.createElement('summary');topic.className='number-topic';head.textContent=item.title;topic.append(head);for(const name of ['formula','example','meaning','scope']){if(!item[name])continue;const p=document.createElement('p');p.className='number-'+name;if(name==='formula'){const code=document.createElement('code');code.textContent=item[name];p.append(code);}else p.textContent=item[name];topic.append(p);}content.append(topic);}
  return details;
}
function renderMapHelp(){
  const copy=isUnified()?UNIFIED_HELP:isAirflow()?AIRFLOW_COPY:RECRUITMENT_COPY,root=$('map-help'),open=root.open;
  root.replaceChildren();const summary=document.createElement('summary');summary.textContent=copy.title;root.append(summary);
  const lead=document.createElement('p');lead.className='watch-lead';lead.textContent=copy.watch;root.append(lead);
  const grid=document.createElement('div');grid.className='meaning-grid';
  for(const item of copy.sections){const p=document.createElement('p'),strong=document.createElement('strong');strong.textContent=item.title+'. ';p.append(strong,item.text);grid.append(p);}root.append(grid,numberDetails(copy.numbers,'map-'+$('mechanics-mode').value));root.open=open;
}
function renderMetricHelp(root,key){
  root.replaceChildren();const p=document.createElement('p');p.textContent=METRIC_HELP[key]||'This value comes from the educational model.';root.append(p);if(METRIC_NUMBERS[key])root.append(numberDetails(METRIC_NUMBERS[key],'metric-'+root.closest('.patient').id+'-'+key));
}
function renderLegend(){
  const legend=document.querySelector('.legend');legend.replaceChildren();
  const items=isUnified()?[['closed','Poorly aerated'],['open','Ventilated'],['expansion-ramp','Expansion'],['cyclic','Opening'],['over','High stretch'],['pressure-ring','Above expiratory pressure']]:isAirflow()?[['closed','Less open (held fixed)'],['open','More open (held fixed)'],['retained-gas','Extra air still here']]:[['closed','Poorly aerated'],['open','Ventilated'],['expansion-ramp','Open part expanding more'],['cyclic','More tissue opened'],['over','High-stretch square']];
  for(const [cls,label] of items){const span=document.createElement('span'),i=document.createElement('i');i.className=cls;span.append(i,label);legend.append(span);}
}
function refreshEli5(){
  $('eli5-text').textContent=isUnified()?UNIFIED_ELI5:ELI5_COPY[isAirflow()?'airflow':'recruitment'];
  $('eli5-panel').setAttribute('aria-label',isUnified()?'ELI5: held air versus air still leaving':isAirflow()?'ELI5: air moving in and out':'ELI5: opening versus stretching');queueEli5Position();
}
function closeEli5(focus=false){$('eli5-panel').hidden=true;$('eli5-toggle').setAttribute('aria-expanded','false');document.querySelector('.breath-panel').classList.remove('eli5-open');if(focus)$('eli5-toggle').focus({preventScroll:true});}
function positionEli5(){if($('eli5-panel').hidden)return;const panel=$('eli5-panel'),bar=document.querySelector('.breath-panel').getBoundingClientRect();panel.style.maxHeight=Math.max(130,Math.min(360,innerHeight-24))+'px';const height=panel.offsetHeight;panel.style.top=Math.max(8,Math.min(bar.bottom+6,innerHeight-height-8))+'px';}
let eli5PositionFrame=0;function queueEli5Position(){if($('eli5-panel').hidden||eli5PositionFrame)return;eli5PositionFrame=requestAnimationFrame(()=>{eli5PositionFrame=0;positionEli5();});}
window.addEventListener('scroll',queueEli5Position,{passive:true});window.addEventListener('resize',queueEli5Position);
$('eli5-toggle').addEventListener('click',()=>{
  if(!$('eli5-panel').hidden){closeEli5();return;}
  refreshEli5();$('eli5-panel').hidden=false;$('eli5-toggle').setAttribute('aria-expanded','true');document.querySelector('.breath-panel').classList.add('eli5-open');
  positionEli5();
});
$('eli5-close').addEventListener('click',()=>closeEli5(true));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('eli5-panel').hidden){event.preventDefault();closeEli5(true);}});
updateModeViews();
const params=new URLSearchParams(location.search);
if(params.get('mode')==='unified'){
  $('mechanics-mode').value='unified';$('lesson').innerHTML=unifiedOptions;
  const r=Number(params.get('resistance'));if(params.has('resistance')&&r>=2&&r<=30)$('resistance').value=r;
  const readField=spec=>{const raw=params.get('u-'+spec.name);if(raw===null||raw==='')return;const v=Number(raw);if(Number.isFinite(v)&&v>=spec[1]&&v<=spec[2])$(spec[0]).value=String(Number(v.toPrecision(6)));};
  for(const [name,spec] of Object.entries(UNIFIED_FIELDS))readField(Object.assign([...spec],{name}));
  if(params.get('u-custom')==='1'){$('u-custom').checked=true;$('u-target').disabled=false;if(['a','b','both'].includes(params.get('u-target')))$('u-target').value=params.get('u-target');for(const [name,spec] of Object.entries(CUSTOM_FIELDS)){$(spec[0]).disabled=false;readField(Object.assign([...spec],{name}));}}
  updateModeViews();
}
for(const k of ['peep','vt','rr','pbw'])if(params.has(k)){const el=$(k),v=Number(params.get(k));if(Number.isFinite(v)&&v>=+el.min&&v<=+el.max)el.value=v;}
for(const k of ['a','b']){const kind=params.get('kind-'+k);if(['high','low','wall','healthy','healthyDependent'].includes(kind))$('kind-'+k).value=kind;const seed=Number(params.get('seed-'+k));if(params.has('seed-'+k)&&Number.isInteger(seed)&&seed>=0&&seed<=4294967295)$('seed-'+k).value=seed;}
if(params.get('mode')==='airflow'){$('mechanics-mode').value='airflow';$('lesson').innerHTML='<option value="flow-resistance">Resistance: pressure cost and emptying</option><option value="flow-rate">Rate: shorter expiration</option>';const r=Number(params.get('resistance'));if(r>=2&&r<=30)$('resistance').value=r;updateModeViews();}
for(const k of ['pressure-drive','posture'])if([...$(k).options].some(o=>o.value===params.get(k)))$(k).value=params.get(k);if(params.has('chest-load')){const v=Number(params.get('chest-load'));if(Number.isFinite(v)&&v>=0&&v<=15)$('chest-load').value=v;}if(isAirflow())restoreExperiment();else updateExperimentViews();
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
