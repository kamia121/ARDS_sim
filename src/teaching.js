export const LESSONS = {
  recruitment: {name:'PEEP and recruitability',kinds:['high','low'],baseline:{peep:8,vt:6,rr:20,pbw:70},adjustment:{peep:12},objective:'Explain why the same PEEP increase can produce different aeration and distension responses.',prediction:'Before applying: which patient will gain more aerated tissue, and could distension increase in both?',reflection:'Compare the aeration gain and distension change in A and B. Explain why a lower driving pressure alone cannot establish benefit.',instruction:'Compare the same PEEP increase in lungs with different assumed opening thresholds. Look for aeration gain, driving-pressure change, and increased regional distension.'},
  wall: {name:'Chest-wall pressure',kinds:['high','wall'],baseline:{peep:8,vt:6,rr:20,pbw:70},adjustment:{peep:12},objective:'Separate the chest-wall contribution to airway pressure from the pressure across lung tissue.',prediction:'Before applying: will a higher airway pressure in B necessarily mean a higher transpulmonary pressure?',reflection:'Use airway minus pleural pressure in each patient. Explain how chest-wall load changes the interpretation of airway pressure.',instruction:'These patients share the same seeded lung assumptions. Patient B has greater chest-wall load. Compare airway pressure with mean transpulmonary pressure; airway pressure alone cannot separate lung from chest-wall load.'},
  volume: {name:'Tidal volume and regional distension',kinds:['high','high'],baseline:{peep:8,vt:6,rr:20,pbw:70},adjustment:{vt:8},objective:'Explain how added tidal volume changes global elastic pressure and regional distension in identical lungs.',prediction:'Before applying: where will the extra volume go, and what may happen to driving pressure and distension?',reflection:'Check delivered volume alongside driving pressure and the distension proxy. Explain why global compliance cannot rule out regional distension.',instruction:'Use identical seeded lungs and raise tidal volume from 6 to 8 mL/kg PBW. Observe delivered volume, driving pressure, and the fraction above the assumed distension threshold.'},
  'pressure-drive': {name:'Airway vs external pressure drive',kinds:['high','high'],baseline:{peep:8,vt:6,rr:20,pbw:70},adjustment:{'pressure-drive':'external'},objective:'Distinguish where the driving pressure is applied from the pressure across lung tissue.',prediction:'Before applying: if the same breath is driven by external negative pressure, which pressure readouts change and which stay the same?',reflection:'Compare mean pleural pressure with transpulmonary pressure and distension. Explain why the pressure across lung tissue can match while airway and pleural pressures differ.',instruction:'After applying the change, both patients receive the same requested breath through an ideal uniform-transmission external drive. Compare each with its positive-pressure baseline. Airway pressure readouts become zero and pleural pressure shifts lower; transpulmonary pressure, volumes and aeration are the same by construction. This does not show that either drive is preferable.'},
  prone: {name:'Prone posture and the pleural gradient',kinds:['high','low'],baseline:{peep:8,vt:6,rr:20,pbw:70},adjustment:{posture:'prone'},objective:'Explain how reversing and flattening an assumed pleural-pressure gradient can redistribute regional pressure while anatomical thresholds stay fixed.',prediction:'Before applying: which patient will show a change in expiratory aeration, and could end-inspiratory distension change as well?',reflection:'Compare each patient’s aeration and distension changes. Explain which results depend on the assumed gradient and which on the fixed anatomical opening thresholds.',instruction:'After applying the change, both seeded lungs enter an assumed prone state: the pleural gradient is reversed and halved, the tissue-weighted mean pleural pressure at the same gas volume is preserved, and opening thresholds and perfusion weights remain anatomical. The gradient factor is an assumption, not a measurement; the outcome depends on lung phenotype.'},
  'chest-load': {name:'Static chest-wall load',kinds:['healthyDependent','high'],baseline:{peep:8,vt:6,rr:20,pbw:70},adjustment:{'chest-load':5},objective:'Show that a static pleural-pressure offset acts separately from chest-wall stiffness, and that its effect depends on the starting lung volume.',prediction:'Before applying: will a 5 cmH2O static offset change end-expiratory gas volume the same way in both patients?',reflection:'Compare gas volume, aeration and driving pressure in A and B. Explain why compliance can move in either direction depending on where each lung starts.',instruction:'A chest-load of 5 cmH2O adds a uniform static offset to pleural pressure. It is not a mass or a stiffness change: chest-wall elastance is unchanged. Compliance can rise or fall depending on the starting volume and recruitment state.'},
  'healthy-dependent': {name:'Dependent closure in otherwise healthy mechanics',kinds:['healthy','healthyDependent'],baseline:{peep:2,vt:6,rr:20,pbw:70},adjustment:{peep:10},objective:'Illustrate how a modest, assumed dependent closing tendency can respond to PEEP in lungs with otherwise preserved mechanics.',prediction:'Before applying: will raising PEEP change the open fraction and driving pressure more in B than in A?',reflection:'Compare aeration, within-breath opening and driving pressure in A and B. Explain why this is a teaching construct and not a statement that every healthy lung has closed dependent regions.',instruction:'Patient B has the same seeded healthy mechanics plus a deterministic dependent closing tendency. This is a teaching model with assumed constants, not a clinical calibration; dependent closure is not always present in healthy lungs.'}
};
export const METRIC_HELP = {
  delivery:'The gas volume delivered in the breath, compared with the requested amount. Check this first: a pressure ceiling can prevent the full breath from being delivered.',
  eelv:'Gas volume remaining at expiration. It can rise because more tissue aerates or because already aerated units expand. A higher value alone does not establish benefit.',
  pplat:'Quasi-static end-inspiratory airway pressure. It includes both lung and chest-wall loads. This model does not perform a clinical inspiratory-hold measurement.',
  dp:'Plateau pressure minus PEEP. At the same delivered tidal volume, a lower value means a lower global elastic pressure requirement. Regional distension may still increase.',
  crs:'Delivered tidal volume divided by driving pressure. Higher compliance means more volume per unit of elastic pressure in this model; it does not prove a safer setting.',
  openEE:'Tissue-weighted aerated fraction at expiration. An increase means more of the assumed tissue remains open. It does not predict oxygenation or clinical outcome.',
  cyclic:'Positive change in open fraction from expiration to inspiration. It can indicate within-breath recruitment, but this snapshot comparison does not independently measure expiratory closure or injury.',
  over:'Aerated tissue above the assumed fully open volume-ratio cutoff of 1.65, relative to that region at 5 cmH2O transpulmonary pressure. Red highlights possible excessive stretch, a potential injury mechanism. This does not predict or detect tissue damage, and no red does not establish safety.',
  closedPerfusion:'Closed tissue weighted by a fixed anatomical dorsal weighting proxy. In a prone experiment the weighting stays anatomical and is not always gravitationally dependent. This is a proxy only; it does not predict shunt or gas exchange.'
};
export const VT_DISPLAY_TOLERANCE_ML=1;
const signed=(v,n=1)=>`${v>=0?'+':''}${v.toFixed(n)}`;
export function explainComparison(before,after){
  const a=(after.openEE-before.openEE)*100,d=after.dp-before.dp,h=(after.over-before.over)*100;
  const compliance=Number.isFinite(before.crs)&&Number.isFinite(after.crs)?` compliance ${signed(after.crs-before.crs)} mL/cmH2O;`:"";
  const delivery=Number.isFinite(before.vtDelivered)&&Number.isFinite(after.vtDelivered)?` Delivered tidal volume ${before.vtDelivered.toFixed(0)} → ${after.vtDelivered.toFixed(0)} mL.`:'';
  const changes=`Aerated tissue ${signed(a)} percentage points; driving pressure ${signed(d)} cmH2O;${compliance} distension proxy ${signed(h)} percentage points.${delivery}`;
  const volumeKnown=Number.isFinite(before.vtDelivered)&&Number.isFinite(after.vtDelivered);
  const volumeChanged=volumeKnown&&Math.abs(after.vtDelivered-before.vtDelivered)>VT_DISPLAY_TOLERANCE_ML;
  const dpWord=d<-.5?'falls':d>.5?'rises':'changes little';
  let meaning;
  if(a>1 && h>1)meaning='More tissue is aerated, while more aerated tissue also crosses the assumed distension threshold. This is a recruitment–distension tradeoff.';
  else if(a<-1){
    const distension=h>1?'the distension proxy rises, so lost aeration does not exclude increased regional distension':h<-1?'the distension proxy falls':'the distension proxy changes little';
    meaning=`Aerated tissue is lost (derecruitment in this model), and ${distension}. Driving pressure ${dpWord}; interpret this elastic pressure alongside how much tissue remains aerated.`;
  }
  else if(a<=1 && h>1)meaning='There is little additional aeration, while the distension proxy increases. In this model, the adjustment mainly adds load to the aerated lung.';
  else if(a>1 && d<-.5 && h<=1 && volumeKnown && !volumeChanged)meaning='More tissue aerates and driving pressure falls at similar delivered volume, with little change in the distension proxy. This describes a mechanical change in the model; it does not establish clinical benefit.';
  else if(a>1 && h<=1)meaning='More tissue is aerated, with little change in the distension proxy. Interpret this together with delivered volume and pressure.';
  else meaning='The metrics change in different ways or only slightly. Assess aeration, delivered volume, elastic pressure and distension together rather than judging one number alone.';
  if(volumeChanged)meaning+=` Delivered tidal volume differs by more than ${VT_DISPLAY_TOLERANCE_ML} mL, so a driving-pressure change is not a like-for-like comparison at equal volume. Read pressure and respiratory compliance alongside the actual delivered volume and distension.`;
  if(before.limited||after.limited)meaning+=' The pressure ceiling was reached in at least one comparison state. Compare requested and delivered tidal volume; reduced delivered volume changes the pressure interpretation.';
  return {changes,meaning,pressure:`At inspiration: airway ${after.pplat.toFixed(1)} − mean pleural ${after.meanPleuralEI.toFixed(1)} = mean transpulmonary ${after.transpulmonaryEI.toFixed(1)} cmH2O. Pleural pressure changes ${(after.meanPleuralEI-after.meanPleuralEE).toFixed(1)} cmH2O within the displayed breath.`,scope:'This explains a model response; it does not select a clinically optimal PEEP or establish treatment benefit.'};
}

const CONTROLS = {
  peep: {label:'PEEP',unit:'cmH2O',why:'PEEP sets the airway pressure remaining at expiration. Changing it shifts the pressure across lung tissue, which can change how much tissue stays open and how much already open tissue expands.',tradeoff:'Compare aeration gain with regional distension. More aeration or lower driving pressure alone does not establish benefit.'},
  vt: {label:'Tidal volume',unit:'mL/kg PBW',why:'Tidal volume sets the added gas volume requested for each inspiration. The model solves the pressure needed to deliver that volume through the currently aerated tissue and chest wall.',tradeoff:'Compare actual delivered volume, driving pressure and regional distension. A pressure ceiling may prevent delivery of the requested volume.'},
  rr: {label:'Respiratory rate',unit:'/min',why:'Respiratory rate sets breath duration. Inspiration occupies one-third of each cycle; changing the rate changes the time available for modeled tissue opening and closing over ten breaths.',tradeoff:'Aeration can change because exposure time changes. This quasi-static model does not calculate resisted airflow, air trapping or gas exchange.'}
};
const EXPERIMENT_DEFAULTS={'pressure-drive':'airway',posture:'supine','chest-load':0};
const EXPERIMENT_FIELDS={'pressure-drive':'drive',posture:'posture','chest-load':'chestLoad'};
const EXPERIMENT_CONTROLS={
  'pressure-drive':{label:'Pressure drive',unit:'',why:'Pressure drive sets where the breath pressure is applied. In this ideal model an external drive re-expresses the same breath: airway pressure readouts become zero and pleural pressure shifts lower, while transpulmonary pressure, volumes and aeration are unchanged.',tradeoff:'Compare transpulmonary pressure and distension rather than airway pressure alone. Airway-based plateau pressure, driving pressure and compliance are not reported for external drive.'},
  posture:{label:'Posture',unit:'',why:'Prone posture reverses and halves the assumed pleural-pressure gradient while preserving its tissue-weighted mean; opening thresholds and perfusion weights remain anatomical.',tradeoff:'The result depends on the assumed gradient and on how much tissue lies near its opening or closing pressure. It may differ between phenotypes and does not generalize to a patient.'},
  'chest-load':{label:'Chest-wall load',unit:'cmH2O',why:'Chest-wall load is a static uniform offset to pleural pressure. It is separate from chest-wall stiffness, which is unchanged, and its effect depends on the starting lung volume.',tradeoff:'Compliance and driving pressure can move in either direction depending on the starting volume and recruitment state.'}
};
const experimentValue=(settings,key)=>{
  const flat=settings?.[key];if(flat!==undefined)return flat;
  const nested=settings?.experiment?.[EXPERIMENT_FIELDS[key]];
  return nested!==undefined?nested:EXPERIMENT_DEFAULTS[key];
};
export function lessonSettings(settings){
  const out={},experiment={};
  for(const [key,value] of Object.entries(settings||{})){
    if(EXPERIMENT_FIELDS[key])experiment[EXPERIMENT_FIELDS[key]]=value;else out[key]=value;
  }
  return Object.keys(experiment).length?{...out,experiment}:out;
}
export function flattenControls(settings){
  const flat={peep:settings?.peep,vt:settings?.vt,rr:settings?.rr};
  for(const key of Object.keys(EXPERIMENT_DEFAULTS))flat[key]=experimentValue(settings,key);
  return flat;
}
const experimentActive=flat=>Object.keys(EXPERIMENT_DEFAULTS).some(key=>flat[key]!==EXPERIMENT_DEFAULTS[key]);
function experimentConditions(before,after){
  const on=key=>before[key]!==EXPERIMENT_DEFAULTS[key]||after[key]!==EXPERIMENT_DEFAULTS[key];
  const parts=[];
  if(on('pressure-drive'))parts.push('External drive is an ideal uniform-transmission equivalent of the matched airway-pressure breath: airway pressure readouts are zero, external pressure is the negative of the original airway pressure, and transpulmonary pressure, volumes and aeration are identical by construction. No circulation, abdomen or leak is modeled.');
  if(on('posture'))parts.push('Prone posture uses an assumed reversed gradient at half the supine magnitude; this factor is a schematic assumption, and the tissue-weighted mean pleural pressure at the same gas volume, thresholds and perfusion weights are preserved.');
  if(on('chest-load'))parts.push('Chest-wall load is a static pleural-pressure offset in cmH2O, not mass or stiffness; chest-wall elastance is unchanged.');
  return parts.join(' ');
}
export function explainAdjustment(beforeSettings,afterSettings){
  const before=flattenControls(beforeSettings),after=flattenControls(afterSettings);
  const active=experimentActive(before)||experimentActive(after);
  const names=active?[...Object.keys(CONTROLS),...Object.keys(EXPERIMENT_CONTROLS)]:Object.keys(CONTROLS);
  const def=key=>CONTROLS[key]||EXPERIMENT_CONTROLS[key];
  const text=(key,v)=>`${v}${def(key).unit?' '+def(key).unit:''}`;
  const move=key=>CONTROLS[key]?`${before[key]} → ${after[key]} ${CONTROLS[key].unit}`:`${before[key]} → ${text(key,after[key])}`;
  const keys=names.filter(key=>before[key]!==after[key]);
  const changed=keys.map(key=>`${def(key).label}: ${move(key)}`);
  const held=names.filter(key=>!keys.includes(key)).map(key=>`${def(key).label} ${text(key,after[key])}`);
  const result={
    changed:changed.length?changed.join('; ')+'.':(active?'No setting or experiment control changed from baseline.':'No ventilator setting changed from baseline.'),
    held:held.length?'Held constant: '+held.join('; ')+'.':(active?'All six controls changed.':'All three ventilator controls changed.'),
    why:keys.length?keys.map(key=>def(key).why).join(' '):'These fresh seeded patients repeat the baseline settings and ten-breath exposure.',
    tradeoff:keys.length?keys.map(key=>def(key).tradeoff).join(' '):'Apply one adjustment to examine a mechanical tradeoff.',
    control:keys.length>1?'Multiple controls changed. These differences cannot be attributed to one '+(active?'adjustment':'ventilator adjustment')+'. Reset the lesson baseline to compare one variable.':'Same seeds, body weight and initial state; ten breaths per setting. This controls the comparison but does not guarantee steady state.'
  };
  if(active)result.conditions=experimentConditions(before,after);
  return result;
}

// These bands simplify the displayed prediction exercise; they are not clinical cutoffs.
const QUESTIONS={
 recruitment:{
  student:{metric:'openEE',patient:0,label:'Open lung at expiration',scale:100,unit:'%',band:1,prompt:'PEEP 8 → 12: will more of A’s lung stay open between breaths?',focus:'Watch the grey regions: do more remain open when the breath ends?'},
  resident:{metric:'over',patient:1,label:'B’s distension proxy',scale:100,unit:'%',band:1,prompt:'PEEP 8 → 12: how will B’s end-inspiratory distension marker change?',focus:'Recruitment and regional overstretch can increase together. Inspect end inspiration.'},
  fellow:{metric:'dp',patient:0,label:'A’s driving pressure',scale:1,unit:'cmH2O',band:.5,prompt:'At the same tidal volume, how will A’s driving pressure change after the PEEP increase?',focus:'Compare pressure cost with regional distension; a global improvement can hide a regional tradeoff.'}
 },
 wall:{
  student:{metric:'pplat',patient:1,label:'B’s end-inspiratory airway pressure',scale:1,unit:'cmH2O',band:.5,prompt:'With a stiffer chest wall, how will B’s airway pressure change when PEEP rises?',focus:'Airway pressure includes both the lung and the chest wall.'},
  resident:{metric:'transpulmonaryEI',patient:1,label:'B vs A lung-distending pressure',scale:1,unit:'cmH2O',band:.5,betweenPatients:true,prompt:'At matched settings, is B’s lung-distending pressure higher, similar, or lower than A’s?',focus:'Subtract pleural pressure before interpreting the lung load; airway pressure alone is incomplete.'},
  fellow:{metric:'dp',patient:1,label:'B’s driving pressure',scale:1,unit:'cmH2O',band:.5,prompt:'At unchanged tidal volume, how will B’s driving pressure respond to the PEEP increase?',focus:'Chest-wall load changes lung volume and recruitment, as well as the pressure partition.'}
 },
 volume:{
  student:{metric:'dp',patient:0,label:'A’s driving pressure',scale:1,unit:'cmH2O',band:.5,prompt:'Tidal volume 6 → 8 mL/kg: how will A’s driving pressure change?',focus:'A larger breath asks the aerated lung and chest wall to accommodate more volume.'},
  resident:{metric:'over',patient:0,label:'A’s distension proxy',scale:100,unit:'%',band:1,prompt:'With a larger tidal volume, how will A’s end-inspiratory distension marker change?',focus:'Watch the red regions at full inspiration; more volume may stretch already open tissue.'},
  fellow:{metric:'crs',patient:0,label:'A’s respiratory compliance',scale:1,unit:'mL/cmH2O',band:1,prompt:'As tidal volume rises, how will A’s respiratory compliance change?',focus:'The pressure-volume relation stiffens as open regions distend; compliance is not constant.'}
 },
 'pressure-drive':{
  student:{metric:'meanPleuralEI',patient:1,label:'B’s mean pleural pressure at inspiration',scale:1,unit:'cmH2O',band:.5,prompt:'With the same breath driven externally, how will B’s end-inspiratory mean pleural pressure change?',focus:'Compare where the pressure is applied: the airway stays at zero while the body surface carries the drive.'},
  resident:{metric:'transpulmonaryEI',patient:1,label:'B’s end-inspiratory transpulmonary pressure',scale:1,unit:'cmH2O',band:.5,prompt:'How will B’s transpulmonary pressure at inspiration change under external drive?',focus:'Transpulmonary pressure is airway minus pleural pressure; consider what shifts in both terms.'},
  fellow:{metric:'over',patient:1,label:'B’s distension proxy',scale:100,unit:'%',band:1,prompt:'Under external drive, how will B’s end-inspiratory distension marker change?',focus:'Regional distension follows the pressure across lung tissue in this model.'}
 },
 prone:{
  student:{metric:'openEE',patient:0,label:'A’s open lung at expiration',scale:100,unit:'%',band:1,prompt:'In the assumed prone state, how will A’s open lung at expiration change?',focus:'The pleural gradient is assumed reversed and halved; thresholds stay anatomical.'},
  resident:{metric:'over',patient:1,label:'B’s distension proxy',scale:100,unit:'%',band:1,prompt:'How will B’s end-inspiratory distension marker change in the assumed prone state?',focus:'Regional pressure shifts with the assumed gradient while the weighted mean is preserved.'},
  fellow:{metric:'transpulmonaryEI',patient:0,label:'A’s mean end-inspiratory transpulmonary pressure',scale:1,unit:'cmH2O',band:.5,prompt:'How will A’s mean transpulmonary pressure at inspiration change?',focus:'The weighted mean pleural pressure is preserved at fixed gas volume, but volumes may shift.'}
 },
 'chest-load':{
  student:{metric:'eelv',patient:0,label:'A’s end-expiratory lung volume',scale:.001,unit:'L',band:.01,prompt:'With a static 5 cmH2O chest-wall load, how will A’s end-expiratory gas volume change?',focus:'A static pleural offset lowers the pressure across the lung at the same airway pressure.'},
  resident:{metric:'openEE',patient:1,label:'B’s open lung at expiration',scale:100,unit:'%',band:1,prompt:'How will B’s open fraction at expiration change under the static load?',focus:'The response depends on where B’s thresholds lie relative to the new transpulmonary pressure.'},
  fellow:{metric:'dp',patient:1,label:'B’s driving pressure',scale:1,unit:'cmH2O',band:.5,prompt:'How will B’s driving pressure change under the static load?',focus:'Compliance can move either way; the load is not a stiffness change.'}
 },
 'healthy-dependent':{
  student:{metric:'openEE',patient:1,label:'B’s open lung at expiration',scale:100,unit:'%',band:1,prompt:'PEEP 2 → 10: how will B’s open lung at expiration change?',focus:'B has a modeled dependent closing tendency; A does not.'},
  resident:{metric:'cyclic',patient:1,label:'B’s within-breath opening',scale:100,unit:'%',band:1,prompt:'How will B’s cyclic opening change after the PEEP increase?',focus:'Cyclic opening is the open-fraction change from expiration to inspiration.'},
  fellow:{metric:'dp',patient:1,label:'B’s driving pressure',scale:1,unit:'cmH2O',band:.5,prompt:'At the same tidal volume, how will B’s driving pressure change?',focus:'This is a teaching construct; dependent closure is not always present in healthy lungs.'}
 }
};
export function predictionQuestion(lesson,level='student'){
 return QUESTIONS[lesson]?.[level]||QUESTIONS.recruitment.student;
}
export function evaluatePrediction(question,before,after,prediction){
 const initial=question.betweenPatients?after[0]?.metrics[question.metric]:before[question.patient]?.metrics[question.metric];
 const final=after[question.patient]?.metrics[question.metric];
 if(!Number.isFinite(initial)||!Number.isFinite(final))return {expected:null,correct:null,observed:'This measure is unavailable for this comparison.'};
 const a=initial*question.scale,b=final*question.scale,d=b-a;
 const expected=d>question.band?'up':d<-question.band?'down':'same';
 const observed=question.betweenPatients?`${question.label}: A ${a.toFixed(1)} vs B ${b.toFixed(1)} ${question.unit}.`:`${question.label}: ${a.toFixed(1)} → ${b.toFixed(1)} ${question.unit}.`;
 return {expected,correct:['up','same','down'].includes(prediction)?prediction===expected:null,observed};
}

export const FLOW_LESSONS={
 'flow-resistance':{name:'Resistance and emptying',kinds:['high','low'],baseline:{peep:8,vt:6,rr:20,pbw:70,resistance:8},adjustment:{resistance:16},instruction:'Increase central airway resistance while keeping aeration fixed. Compare pressure cost, flow and gas remaining after expiration.',reflection:'A local regional RC estimate excludes shared airway resistance and chest-wall coupling. Does local RC alone explain the observed emptying? '},
 'flow-rate':{name:'Shorter expiration',kinds:['high','low'],baseline:{peep:8,vt:6,rr:20,pbw:70,resistance:8},adjustment:{rr:30},instruction:'Raise respiratory rate at the same requested tidal volume. Inspiration and expiration both become shorter; aeration is held fixed.',reflection:'Compare the end-expiratory flow with retained excess volume. The model may not return to its relaxed PEEP volume before the next breath.'}
};
export function airflowQuestion(lesson,level='student'){
 const resistance=lesson==='flow-resistance';
 if(level==='resident')return {metric:'ppeak',patient:0,label:'A’s peak airway pressure',scale:1,unit:'cmH2O',band:.5,prompt:resistance?'Resistance 8 → 16: how will A’s peak airway pressure change?':'Rate 20 → 30: how will A’s peak airway pressure change at the same tidal volume?',focus:'Airway opening pressure includes resistive pressure. It is not a measured plateau.'};
 if(level==='fellow')return {metric:'fractionEmptied',patient:0,label:'A’s fraction of excess gas emptied',scale:100,unit:'%',band:1,prompt:resistance?'As central resistance rises, how will the fraction of excess gas emptied change?':'With shorter expiration, how will the fraction of excess gas emptied change?',focus:'The fraction is relative to the frozen relaxed PEEP volume; local RC is not the full coupled-network emptying time.'};
 return {metric:'retainedVolume',patient:0,label:'A’s excess gas retained at expiration',scale:1,unit:'mL',band:.5,prompt:resistance?'Resistance 8 → 16: will more excess gas remain after expiration?':'Rate 20 → 30: will more excess gas remain after expiration?',focus:'Watch the flow approach zero. If gas is still leaving when expiration ends, emptying is incomplete in this model.'};
}
Object.assign(METRIC_HELP,{
 ppeak:'Peak pressure at the airway opening, including central and regional resistive loads. This is not plateau pressure.',
 fractionEmptied:'Fraction of gas above the relaxed frozen PEEP reference removed during expiration: (EI excess − end-expiratory excess) / EI excess. It is not expired tidal volume divided by inspired tidal volume.',
 retainedVolume:'End-expiratory gas above the relaxed PEEP volume with aeration held fixed. This is a model quantity, not a measured clinical intrinsic PEEP.',
 tauEquivalent:'A single-compartment-equivalent time constant from effective resistance and frozen chord respiratory compliance. It is exact for a homogeneous network, not each heterogeneous region.',
 complianceInput:'Frozen-aeration chord compliance plus chest-wall coupling, used as an input to the airflow experiment. It is not measured dynamic compliance.',
 virtualEndHoldPressure:'Pressure estimated after hypothetical complete equilibration at fixed end-inspiratory total gas volume. No actual occlusion maneuver is simulated.',
 virtualAutoPeep:'Excess pressure estimated after hypothetical complete equilibration of end-expiratory excess gas. This is not a measured clinical auto-PEEP.'
});
