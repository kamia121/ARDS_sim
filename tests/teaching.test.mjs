import test from 'node:test';
import assert from 'node:assert/strict';
import {explainComparison,explainAdjustment,LESSONS,VT_DISPLAY_TOLERANCE_ML} from '../src/teaching.js';
import {createPatient,simulate} from '../src/engine.js';
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
  assert.match(single.why,/already open tissue expands/);
  assert.match(single.tradeoff,/regional distension/);
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
  assert.match(x.meaning,/Aerated tissue is lost/);
  assert.match(x.meaning,/distension proxy rises/);
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
