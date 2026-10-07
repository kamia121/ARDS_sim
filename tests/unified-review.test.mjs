import test from 'node:test';
import assert from 'node:assert/strict';
import {createPatient} from '../src/engine.js';
import {simulateUnified,simulateUnifiedExperiment} from '../src/unified.js';
import {createSession} from '../src/session.js';
test('pressure ceiling is active only during inspiration, not release or expiration',()=>{
 const r=simulateUnified(createPatient('low',13791,16,70),{peep:8,vt:14,rr:20,pressureLimit:20},{breaths:2});
 assert.equal(r.metrics.limited,true);
 assert.ok(r.trajectory.frames.some(f=>f.ceilingActive));
 assert.ok(r.trajectory.frames.filter(f=>f.phase==='release'||f.phase==='expiration').every(f=>f.ceilingActive===false));
 assert.ok(r.metrics.ppeak<=20+1e-9);
});
test('session ignores pleural-field request when no trajectory is requested',()=>{
 const r=createSession().handle({id:1,type:'unified',reset:true,config:[{kind:'high',seed:13791,pbw:70}],settings:{peep:8,vt:1,rr:40},recordTrajectory:false,recordPleuralField:true});
 assert.equal(r.results[0].trajectory,undefined);
});
test('explicit null wrapper options keep transformed geometry context',()=>{
 const p=createPatient('high',13791,8,70);
 simulateUnifiedExperiment(p,{peep:8,vt:6,rr:20,experiment:{posture:'prone',chestLoad:5}},null);
 assert.notEqual(p.unifiedState.context,'');
 const r=simulateUnifiedExperiment(p,{peep:8,vt:6,rr:20},{breaths:1});
 assert.equal(r.unified.initialState.source,'relaxed');
 assert.match(r.unified.initialState.reason,/geometry/);
});
test('direct engine calls restart incompatible carried mechanics with an explicit reason',()=>{
 const p=createPatient('high',13791,8,70);
 simulateUnified(p,{peep:8,vt:6,rr:20},{breaths:1});
 const r=simulateUnified(p,{peep:8,vt:6,rr:20},{breaths:1,mechanics:{residualAeration:.05}});
 assert.equal(r.unified.initialState.source,'relaxed');
 assert.match(r.unified.initialState.reason,/mechanics/);
});
test('rejected ceiling probes cannot falsely report a pressure-law knee excursion',()=>{
 const p=createPatient('high',13791,1,70);p.units[0].f=.05;p.units[0].fixedOpen=true;
 const r=simulateUnified(p,{peep:8,vt:14,rr:20,pressureLimit:20},{breaths:1,h:.5,dt:1});
 assert.equal(r.metrics.limited,true);
 assert.equal(r.unified.numerics.kneeReached,false);
 assert.equal(r.unified.numerics.kneeWeight,0);
 assert.ok(r.unified.numerics.steps<r.unified.numerics.stages/2,'work counters include rejected probes; accepted steps exclude them');
 const maxVolume=Math.max(...r.trajectory.frames.map(f=>f.unitVolume[0]));
 assert.ok(r.unified.numerics.minVolume>0);
 assert.ok(maxVolume<700);
});
