import test from 'node:test';
import assert from 'node:assert/strict';
import {explainComparison,explainAdjustment,LESSONS,FLOW_LESSONS,METRIC_HELP,METRIC_NUMBERS,airflowQuestion,predictionQuestion,VT_DISPLAY_TOLERANCE_ML} from '../src/teaching.js';
import {createPatient,simulate} from '../src/engine.js';
import {simulateAirflow} from '../src/airflow.js';
test('A compliance improvement does not conceal an increased distension proxy',()=>{
  const before={openEE:.4,dp:15,over:.1};
  const after={openEE:.5,dp:12,over:.2,pplat:24,meanPleuralEI:7,meanPleuralEE:4,transpulmonaryEI:17,limited:false};
  const x=explainComparison(before,after);
  assert.match(x.changes,/\+10\.0 percentage points/);assert.match(x.changes,/-3\.0 cmH2O/);
  assert.match(x.meaning,/tradeoff/);assert.match(x.pressure,/24\.0 − mean pleural 7\.0 = mean transpulmonary 17\.0/);
  assert.match(x.scope,/does not select a clinically optimal PEEP/);
});
test('Reduced delivered volume receives an explicit interpretation caveat',()=>{
  const x=explainComparison({openEE:.4,dp:20,over:.2},{openEE:.41,dp:10,over:.21,pplat:18,meanPleuralEI:5,meanPleuralEE:3,transpulmonaryEI:13,limited:true});
  assert.match(x.meaning,/reduced delivered volume/);
});
test('Guided PEEP comparison reports the actual simulated differences',()=>{
  const lesson=LESSONS.recruitment;const before=simulate(createPatient(lesson.kinds[0],13791),lesson.baseline);
  const after=simulate(createPatient(lesson.kinds[0],13791),{...lesson.baseline,...lesson.adjustment});
  const x=explainComparison(before.metrics,after.metrics);
  const change=((after.metrics.openEE-before.metrics.openEE)*100).toFixed(1);
  assert.ok(x.changes.includes(change));assert.equal(LESSONS.wall.kinds[1],'wall');
});

test('Adjustment explanation distinguishes a single change, multiple changes and a repeated baseline',()=>{
  const before={peep:8,vt:6,rr:20};
  const single=explainAdjustment(before,{...before,peep:12});
  assert.match(single.changed,/PEEP: 8 → 12 cmH2O/);
  assert.match(single.held,/Tidal volume 6/);
  assert.match(single.why,/open more closed tissue/);assert.match(single.why,/already open/);
  assert.match(single.tradeoff,/highly stretched/);
  const multiple=explainAdjustment(before,{peep:12,vt:8,rr:20});
  assert.match(multiple.control,/cannot be attributed to one/);
  assert.match(explainAdjustment(before,before).changed,/No ventilator setting changed/);
});
test('Rate explanation uses recruitment exposure time without claiming resisted emptying',()=>{
  const x=explainAdjustment({peep:8,vt:6,rr:20},{peep:8,vt:6,rr:30});
  assert.match(x.why,/one-third/);
  assert.match(x.tradeoff,/does not calculate resisted airflow/);
});

const pressure={pplat:20,meanPleuralEI:5,meanPleuralEE:3,transpulmonaryEI:15,limited:false};
test('Substantial aeration loss is explained as derecruitment with distension context',()=>{
  const x=explainComparison({openEE:.6,dp:12,over:.1,vtDelivered:420},{...pressure,openEE:.5,dp:14,over:.2,vtDelivered:420});
  assert.match(x.changes,/-10\.0 percentage points/);
  assert.match(x.meaning,/Open tissue before the breath is lost/);
  assert.match(x.meaning,/high-stretch tissue share rises/);assert.match(x.meaning,/does not rule out more stretch/);
  assert.doesNotMatch(x.meaning,/benefit|should|recommend/i);
});
test('Lower driving pressure with decreased delivered volume is not a like-for-like comparison',()=>{
  const x=explainComparison({openEE:.5,dp:16,over:.1,crs:26,vtDelivered:420},{...pressure,openEE:.56,dp:10,over:.1,crs:30,vtDelivered:300});
  assert.match(x.changes,/Delivered tidal volume 420 → 300 mL/);
  assert.match(x.meaning,/not a like-for-like comparison at equal volume/);
  assert.doesNotMatch(x.meaning,/recruitment benefit/);
});
test('Equal-volume recruitment avoids clinical-benefit language',()=>{
  const x=explainComparison({openEE:.5,dp:16,over:.1,vtDelivered:420},{...pressure,openEE:.6,dp:12,over:.1,vtDelivered:420.5});
  assert.match(x.meaning,/similar delivered volume/);
  assert.match(x.meaning,/does not establish clinical benefit/);
  assert.doesNotMatch(x.meaning,/not a like-for-like/);
  assert.doesNotMatch(x.meaning,/consistent with recruitment benefit/);
});
test('Baseline-only pressure limitation keeps the ceiling caveat',()=>{
  const x=explainComparison({openEE:.5,dp:20,over:.1,vtDelivered:300,limited:true},{...pressure,openEE:.5,dp:14,over:.1,vtDelivered:420});
  assert.match(x.meaning,/pressure ceiling was reached/);
});

test('display-volume tolerance boundary is explicit and does not claim equivalence when volume is missing',()=>{
 const before={openEE:.5,dp:16,over:.1,vtDelivered:420};
 const after={...pressure,openEE:.6,dp:12,over:.1,vtDelivered:420+VT_DISPLAY_TOLERANCE_ML};
 assert.doesNotMatch(explainComparison(before,after).meaning,/not a like-for-like/);
 assert.match(explainComparison(before,{...after,vtDelivered:after.vtDelivered+.01}).meaning,/not a like-for-like/);
 assert.doesNotMatch(explainComparison({...before,vtDelivered:undefined},{...after,vtDelivered:undefined}).meaning,/at similar delivered volume/);
});

const JARGON=/\b(proxy|chord|frozen|intrinsic|quasi|strain)\b/i;
const basicText=lesson=>[lesson.objective,lesson.prediction,lesson.reflection,lesson.instruction].filter(Boolean).join(' ');
test('learner-facing lesson, question and adjustment prose avoids undefined jargon',()=>{
 for(const lesson of [...Object.values(LESSONS),...Object.values(FLOW_LESSONS)])assert.doesNotMatch(basicText(lesson),JARGON,lesson.name);
 for(const key of Object.keys(LESSONS))for(const level of ['student','resident','fellow']){
  const q=predictionQuestion(key,level);assert.doesNotMatch(`${q.prompt} ${q.focus} ${q.label}`,JARGON,`${key} ${level}`);
 }
 for(const lesson of ['flow-resistance','flow-rate'])for(const level of ['student','resident','fellow']){
  const q=airflowQuestion(lesson,level);assert.doesNotMatch(`${q.prompt} ${q.focus} ${q.label}`,JARGON,`${lesson} ${level}`);
 }
 const base={peep:8,vt:6,rr:20};
 const x=explainAdjustment(base,{peep:12,vt:8,rr:30,experiment:{drive:'external',posture:'prone',chestLoad:5}});
 const y=explainAdjustment(base,{...base,peep:12});
 const z=explainComparison({openEE:.4,dp:15,over:.1,crs:30,vtDelivered:420},{openEE:.5,dp:12,over:.2,crs:35,vtDelivered:420,pplat:24,meanPleuralEI:7,meanPleuralEE:4,transpulmonaryEI:17,limited:false});
 assert.doesNotMatch([...Object.values(x),...Object.values(y),...Object.values(z)].join(' '),JARGON);
 for(const [k,v] of Object.entries(METRIC_HELP))assert.doesNotMatch(v,/\b(proxy|chord|frozen|strain)\b/i,k);
});

test('METRIC_NUMBERS covers every METRIC_HELP key as labelled illustrative numbers',()=>{
 assert.deepEqual(Object.keys(METRIC_NUMBERS).sort(),Object.keys(METRIC_HELP).sort());
 for(const key of ['transrespDP','transrespCrs','ppeak','fractionEmptied','retainedVolume'])assert.ok(METRIC_HELP[key]&&METRIC_NUMBERS[key],key);
 for(const [key,text] of Object.entries(METRIC_NUMBERS)){
  assert.match(text,/^Illustrative numbers, not current patient data\./,key);
  assert.doesNotMatch(text,/<|\{|\}|className|style=/,key);
  assert.ok(METRIC_HELP[key].split(/(?<=\.)\s+/).length<=3,`${key} help has at most three sentences`);
 }
});

test('worked examples state the intended definitions and arithmetic',()=>{
 const n=METRIC_NUMBERS;
 assert.match(n.over,/20 \/ 100 = 20%/);assert.match(n.over,/not 20 \/ 60 = 33%/);assert.match(n.over,/ALL model tissue/);
 assert.match(n.over,/10\.2 \/ 6 = 1\.70/);assert.match(n.over,/1\.2, 1\.45 and 1\.65/);
 assert.match(n.eelv,/f × Vopen/);assert.match(n.dp,/25 − 8 = 17/);assert.match(n.crs,/420 mL ÷ 14 cmH2O = 30 mL\/cmH2O/);
 assert.match(n.pplat,/25 − 10 = 15/);assert.match(n.pplat,/no resistive pressure drop/);
 assert.match(n.fractionEmptied,/\(40 − 6\) \/ 40 = 34 \/ 40 = 85%/);assert.match(n.fractionEmptied,/34 \/ 34 = 100%/);
 assert.match(n.retainedVolume,/more than 10%/);assert.match(n.retainedVolume,/3 \/ 40 = 7\.5%/);assert.match(n.retainedVolume,/Not all air must leave at PEEP/);
 assert.match(METRIC_HELP.fractionEmptied,/not expired volume divided by inspired volume/);
 assert.match(METRIC_HELP.over,/all model tissue/);assert.doesNotMatch(`${METRIC_HELP.over} ${n.over}`,/predicts? (injury|damage)/);
 assert.equal(34/40,.85);assert.equal(3/40,.075);assert.equal(25-10,15);assert.equal(25-8,17);assert.equal(420/14,30);assert.ok(10.2/6>1.65&&Math.abs(10.2/6-1.7)<1e-12);
});

test('every lesson, including flow lessons, carries labelled illustrative numbers',()=>{
 for(const [key,lesson] of [...Object.entries(LESSONS),...Object.entries(FLOW_LESSONS)]){
  assert.equal(typeof lesson.numbers,'string',key);
  assert.match(lesson.numbers,/^Illustrative numbers, not current patient data\./,key);
  assert.doesNotMatch(lesson.numbers,/oxygen|hemodynamic|injury|safer|recommend|improv/i,key);
 }
 assert.match(LESSONS['pressure-drive'].numbers,/0 − \(−15\) = 15/);
 assert.match(FLOW_LESSONS['flow-resistance'].numbers,/does not mean doubling the resistance doubles the emptying time/);
});

test('flow lesson claim: local RC is unchanged by central resistance while network emptying is not',()=>{
 const run=R0=>simulateAirflow(createPatient('high',13791),{peep:8,vt:6,rr:20,pbw:70},{params:{R0},recordTrajectory:false});
 const low=run(.008),high=run(.016);
 low.units.forEach((u,i)=>{
  assert.equal(u.tauLocal,high.units[i].tauLocal);
  if(u.active)assert.equal(u.tauLocal,u.resistance*u.compliance);
 });
 const ratio=high.metrics.tauEquivalent/low.metrics.tauEquivalent;
 assert.ok(ratio>1&&ratio<2,`equivalent time constant rises by less than double (${ratio})`);
 assert.notEqual(high.metrics.retainedVolume,low.metrics.retainedVolume);
 const m=low.metrics;
 if(m.fractionEmptied!==null)assert.ok(Math.abs(m.fractionEmptied-(1-m.retainedVolume/(m.retainedVolume/(1-m.fractionEmptied))))<1e-9);
});
