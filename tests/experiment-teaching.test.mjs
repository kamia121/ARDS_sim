import test from 'node:test';
import assert from 'node:assert/strict';
import {LESSONS,METRIC_HELP,METRIC_NUMBERS,predictionQuestion,evaluatePrediction,explainAdjustment,lessonSettings} from '../src/teaching.js';
import {createPatient} from '../src/engine.js';
import {simulateExperiment} from '../src/experiments.js';
import {frameReadout} from '../src/readout.js';

const NEW=['pressure-drive','prone','chest-load','healthy-dependent'];
const settingsFor=(lesson,adjust)=>lessonSettings({...lesson.baseline,...adjust});
const run=(key,levelList=['student','resident','fellow'])=>{
 const lesson=LESSONS[key];
 const before=lesson.kinds.map(k=>simulateExperiment(createPatient(k,13791),settingsFor(lesson,{})));
 const after=lesson.kinds.map(k=>simulateExperiment(createPatient(k,13791),settingsFor(lesson,lesson.adjustment)));
 return levelList.map(level=>({level,q:predictionQuestion(key,level),before,after}));
};

test('new lessons are defined with the specified kinds, baselines and flat adjustment names',()=>{
 assert.deepEqual(NEW.map(k=>LESSONS[k].kinds),[['high','high'],['high','low'],['healthyDependent','high'],['healthy','healthyDependent']]);
 for(const k of NEW.slice(0,3))assert.deepEqual(LESSONS[k].baseline,{peep:8,vt:6,rr:20,pbw:70});
 assert.deepEqual(LESSONS['healthy-dependent'].baseline,{peep:2,vt:6,rr:20,pbw:70});
 assert.deepEqual(LESSONS['pressure-drive'].adjustment,{'pressure-drive':'external'});
 assert.deepEqual(LESSONS.prone.adjustment,{posture:'prone'});
 assert.deepEqual(LESSONS['chest-load'].adjustment,{'chest-load':5});
 assert.deepEqual(LESSONS['healthy-dependent'].adjustment,{peep:10});
 for(const k of NEW)for(const f of ['name','objective','prediction','reflection','instruction'])assert.ok(LESSONS[k][f].length>20);
});

test('questions use the specified metrics and patients, with no predetermined answers',()=>{
 const spec={
  'pressure-drive':[['meanPleuralEI'],['transpulmonaryEI'],['over']],
  prone:[['openEE',0],['over',1],['transpulmonaryEI',0]],
  'chest-load':[['eelv',0],['openEE',1],['dp',1]],
  'healthy-dependent':[['openEE',1],['cyclic',1],['dp',1]]
 };
 for(const [key,rows] of Object.entries(spec))['student','resident','fellow'].forEach((level,i)=>{
  const q=predictionQuestion(key,level);
  assert.equal(q.metric,rows[i][0],`${key} ${level}`);
  if(rows[i][1]!==undefined)assert.equal(q.patient,rows[i][1]);
  assert.equal('expected' in q,false);
 });
 const q=predictionQuestion('chest-load','student');
 assert.equal(q.scale,.001);assert.equal(q.band,.01);assert.equal(q.unit,'L');
 assert.equal(predictionQuestion('chest-load','fellow').band,.5);
});

test('predictions match actual simulated directions for every new lesson and level',()=>{
 for(const key of NEW)for(const {q,before,after} of run(key)){
  const a=before[q.patient].metrics[q.metric]*q.scale,b=after[q.patient].metrics[q.metric]*q.scale;
  assert.ok(Number.isFinite(a)&&Number.isFinite(b),`${key} ${q.metric}`);
  const expected=b-a>q.band?'up':b-a<-q.band?'down':'same';
  const r=evaluatePrediction(q,before,after,expected);
  assert.equal(r.expected,expected);assert.equal(r.correct,true);assert.ok(r.observed.includes(q.unit));
 }
});

test('lessonSettings maps flat names to the engine experiment object and leaves ventilator keys flat',()=>{
 assert.deepEqual(lessonSettings({peep:8,'pressure-drive':'external',posture:'prone','chest-load':5}),{peep:8,experiment:{drive:'external',posture:'prone',chestLoad:5}});
 assert.deepEqual(lessonSettings({peep:8,vt:6}),{peep:8,vt:6});
});

test('pressure-drive readouts move in the documented directions',()=>{
 const [s,r,f]=run('pressure-drive');
 const dir=({q,before,after})=>evaluatePrediction(q,before,after,'same').expected;
 assert.equal(dir(s),'down');
 assert.equal(dir(r),'same');
 assert.equal(dir(f),'same');
});

test('prone, chest-load and healthy-dependent lessons produce real model differences',()=>{
 for(const key of ['prone','chest-load']){
  const [s]=run(key,['student']);
  const changed=s.after.some((x,i)=>x.metrics.eelv!==s.before[i].metrics.eelv||x.metrics.openEE!==s.before[i].metrics.openEE);
  assert.ok(changed,key);
 }
 const [s]=run('healthy-dependent',['student']);
 assert.ok(s.after[1].metrics.openEE>=s.before[1].metrics.openEE);
});

test('lesson text states assumptions and avoids unsupported claims',()=>{
 const text=k=>[LESSONS[k].instruction,LESSONS[k].objective,LESSONS[k].reflection,LESSONS[k].prediction].join(' ');
 assert.match(text('prone'),/assumed/);assert.match(text('prone'),/not a measurement/);
 assert.match(text('chest-load'),/static/);assert.match(text('chest-load'),/stiffness/);assert.match(text('chest-load'),/rise or fall|either direction/);
 assert.match(text('healthy-dependent'),/teaching/);assert.match(text('healthy-dependent'),/not always present/);
 assert.match(text('pressure-drive'),/ideal uniform-transmission/);
 for(const k of NEW)assert.doesNotMatch(text(k),/oxygen|hemodynamic|injury|safer|recommend|improv/i);
 assert.doesNotMatch(METRIC_HELP.closedPerfusion,/oxygen/i);
 assert.match(METRIC_HELP.closedPerfusion,/fixed anatomical dorsal weighting/);
 assert.match(METRIC_HELP.closedPerfusion,/not always gravitationally dependent/);
 assert.match(METRIC_HELP.closedPerfusion,/does not predict shunt/);
});

const base={peep:8,vt:6,rr:20};
test('default experiments leave explainAdjustment output exactly as before',()=>{
 const plain=explainAdjustment(base,{...base,peep:12});
 const withDefaults=explainAdjustment({...base,experiment:{drive:'airway',posture:'supine',chestLoad:0}},{...base,peep:12,'pressure-drive':'airway',posture:'supine','chest-load':0});
 assert.deepEqual(withDefaults,plain);
 assert.equal('conditions' in plain,false);
 assert.match(plain.held,/^Held constant: Tidal volume 6 mL\/kg PBW; Respiratory rate 20 \/min\.$/);
 assert.equal(explainAdjustment(base,base).held,'Held constant: PEEP 8 cmH2O; Tidal volume 6 mL/kg PBW; Respiratory rate 20 /min.');
});

test('a single experiment change is recognized from nested or flat controls and is attributed to one adjustment',()=>{
 for(const after of [{...base,experiment:{drive:'external'}},{...base,'pressure-drive':'external'}]){
  const x=explainAdjustment(base,after);
  assert.match(x.changed,/Pressure drive: airway → external\./);
  assert.match(x.held,/PEEP 8 cmH2O/);assert.match(x.held,/Posture supine/);assert.match(x.held,/Chest-wall load 0 cmH2O/);
  assert.doesNotMatch(x.control,/Multiple controls/);
  assert.match(x.conditions,/uniform-transmission/);assert.doesNotMatch(x.conditions,/Prone|static pleural/);
 }
 const prone=explainAdjustment(base,{...base,posture:'prone'});
 assert.match(prone.changed,/Posture: supine → prone/);assert.match(prone.why,/reverses and halves/);assert.match(prone.conditions,/assumed/);
 const load=explainAdjustment({...base,experiment:{chestLoad:0}},{...base,experiment:{chestLoad:5}});
 assert.match(load.changed,/Chest-wall load: 0 → 5 cmH2O/);assert.match(load.conditions,/not mass or stiffness/);
 assert.match(load.tradeoff,/either direction/);
});

test('an experiment already active in both states is held, and a ventilator-only change is still single',()=>{
 const exp={...base,posture:'prone'};
 const x=explainAdjustment(exp,{...exp,peep:12});
 assert.match(x.changed,/^PEEP: 8 → 12 cmH2O\.$/);
 assert.match(x.held,/Posture prone/);assert.doesNotMatch(x.control,/Multiple controls/);
 assert.match(x.conditions,/Prone/);
});

test('two simultaneous changes are never labeled as a single adjustment',()=>{
 const two=explainAdjustment(base,{...base,posture:'prone','chest-load':5});
 assert.match(two.control,/Multiple controls changed/);
 assert.match(two.changed,/Posture/);assert.match(two.changed,/Chest-wall load/);
 const mixed=explainAdjustment(base,{...base,peep:12,experiment:{drive:'external'}});
 assert.match(mixed.control,/Multiple controls changed/);
 assert.match(mixed.changed,/PEEP: 8 → 12/);assert.match(mixed.changed,/Pressure drive/);
 const all=explainAdjustment(base,{peep:12,vt:8,rr:30,experiment:{drive:'external',posture:'prone',chestLoad:5}});
 assert.equal(all.held,'All six controls changed.');
});

test('experiment explanations make no safety, oxygenation, hemodynamic or injury claims',()=>{
 const x=explainAdjustment(base,{...base,experiment:{drive:'external',posture:'prone',chestLoad:5}});
 assert.doesNotMatch(Object.values(x).join(' '),/oxygen|hemodynamic|injury|safer|recommend|benefit/i);
});

test('experiment lesson numbers are labelled, assumption-bearing and make no clinical claims',()=>{
 for(const k of NEW){
  assert.match(LESSONS[k].numbers,/^Illustrative numbers, not current patient data\./,k);
  assert.doesNotMatch(LESSONS[k].numbers,/oxygen|hemodynamic|injury|safer|recommend|improv|benefit/i,k);
 }
 assert.match(LESSONS['pressure-drive'].numbers,/25 − 10 = 15/);assert.match(LESSONS['pressure-drive'].numbers,/ideal uniform transmission/);
 assert.match(LESSONS.prone.numbers,/6\.8/);assert.match(LESSONS.prone.numbers,/4\.1/);assert.match(LESSONS.prone.numbers,/mean stays 5/);
 assert.match(LESSONS['chest-load'].numbers,/420 mL breath/);assert.match(LESSONS['chest-load'].numbers,/not targets/);
 assert.match(LESSONS.volume.numbers,/10\.2 \/ 6 = 1\.70/);assert.match(LESSONS.recruitment.numbers,/20 \/ 100 = 20% of ALL tissue/);
 assert.match(METRIC_NUMBERS.transrespDP,/17 cmH2O/);assert.match(METRIC_HELP.transrespCrs,/uniform-transmission/);
});

test('prone lesson arithmetic: the same mean pleural pressure is kept while the regional value moves',()=>{
 const mean=5,meanPos=.5,pos=.8,supine=mean+6*(pos-meanPos),prone=mean-3*(pos-meanPos);
 assert.ok(Math.abs(supine-6.8)<1e-12&&Math.abs(prone-4.1)<1e-12);
 assert.ok(Math.abs((20-supine)-13.2)<1e-12&&Math.abs((20-prone)-15.9)<1e-12);
});

test('readout notes are plain, keep keys, labels and values, and do not promise that each region fills',()=>{
 const frame={pressure:20,meanPleural:7,volume:2400,flow:-200},pleural={pesModel:8,plEs:12,pplVentral:5,pplDorsal:10};
 const keys=['external','drive','paw','ppl','pl','volume','delta','flow','pes','plEs','pplVentral','pplDorsal','palv'];
 for(const kind of ['quasi-static-steps','frozen-aeration-airflow'])for(const p of [null,pleural]){
  const rows=frameReadout(frame,kind,2000,p);
  assert.deepEqual(rows.map(r=>r.key),keys);
  for(const r of rows){assert.ok(r.note.length>20,r.key);assert.doesNotMatch(r.note,/each region (fills|opens)|every region (fills|opens)/i,r.key);}
 }
 const flow=frameReadout(frame,'frozen-aeration-airflow',2000,pleural),quasi=frameReadout(frame,'quasi-static-steps',2000,pleural);
 const note=(rows,key)=>rows.find(r=>r.key===key).note;
 assert.equal(flow.find(r=>r.key==='paw').label,'Airway · Paw');assert.equal(quasi.find(r=>r.key==='pl').value,13);
 assert.match(note(quasi,'ppl'),/^Average pressure around the lung/);assert.match(note(quasi,'ppl'),/not a measurement/);
 assert.match(note(quasi,'external'),/outside of the body/);assert.match(note(quasi,'paw'),/pressure inside the airspaces/);
 assert.match(note(flow,'paw'),/flow resistance|airflow resistance/);assert.match(note(flow,'pl'),/not alveolar/);
 assert.match(note(flow,'plEs'),/not alveolar/);assert.match(note(flow,'palv'),/own alveolar pressure/);
 assert.match(note(quasi,'pes'),/not a balloon measurement/);assert.match(note(quasi,'pes'),/not.*whole-lung mean/);
 assert.match(note(quasi,'pes'),/matches the whole-lung mean/);
});
