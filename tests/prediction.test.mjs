import test from 'node:test';
import assert from 'node:assert/strict';
import {LESSONS,predictionQuestion,evaluatePrediction,lessonSettings} from '../src/teaching.js';
import {createPatient} from '../src/engine.js';
import {simulateExperiment as simulate} from '../src/experiments.js';

test('all scenario/level predictions are checked against actual seeded model outputs',()=>{
 for(const [key,lesson] of Object.entries(LESSONS)){
  const before=lesson.kinds.map(kind=>simulate(createPatient(kind,13791),lesson.baseline));
  const after=lesson.kinds.map(kind=>simulate(createPatient(kind,13791),lessonSettings({...lesson.baseline,...lesson.adjustment})));
  for(const level of ['student','resident','fellow']){
   const q=predictionQuestion(key,level),a=q.betweenPatients?after[0].metrics[q.metric]:before[q.patient].metrics[q.metric],b=after[q.patient].metrics[q.metric];
   const expected=(b-a)*q.scale>q.band?'up':(b-a)*q.scale<-q.band?'down':'same';
   const answer=evaluatePrediction(q,before,after,expected);
   assert.equal(answer.expected,expected);assert.equal(answer.correct,true);assert.ok(answer.observed.includes(q.unit));
   assert.equal(evaluatePrediction(q,before,after,expected==='up'?'down':'up').correct,false);
  }
 }
});
test('unavailable measurements and skipped predictions never receive a false score',()=>{
 const q=predictionQuestion('volume','fellow');
 assert.equal(evaluatePrediction(q,[],[],null).correct,null);
 assert.equal(evaluatePrediction(q,[{metrics:{crs:30}}],[{metrics:{crs:null}}],'down').expected,null);
 assert.equal(evaluatePrediction(q,[{metrics:{crs:30}}],[{metrics:{crs:20}}],null).correct,null);
});
test('little-change bands are explicit display choices including their boundaries',()=>{
 const q=predictionQuestion('recruitment','fellow'),before=[{metrics:{dp:10}}];
 assert.equal(evaluatePrediction(q,before,[{metrics:{dp:10.5}}],'same').correct,true);
 assert.equal(evaluatePrediction(q,before,[{metrics:{dp:10.51}}],'up').correct,true);
 assert.equal(evaluatePrediction(q,before,[{metrics:{dp:9.49}}],'down').correct,true);
});
