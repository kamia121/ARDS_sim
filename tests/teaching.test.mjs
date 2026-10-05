import test from 'node:test';
import assert from 'node:assert/strict';
import {explainComparison,LESSONS} from '../src/teaching.js';
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
