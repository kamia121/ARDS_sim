import test from 'node:test';
import assert from 'node:assert/strict';
import {frameReadout} from '../src/readout.js';
import {createPatient} from '../src/engine.js';
import {simulateUnifiedExperiment} from '../src/unified.js';
test('unified live lung pressure uses alveolar pressure rather than upstream airway pressure',()=>{
 const r=simulateUnifiedExperiment(createPatient('high',13791,16,70),{peep:8,vt:6,rr:20},{breaths:2});
 const f=r.trajectory.frames[3],rows=frameReadout(f,r.trajectory.kind,r.trajectory.frames[0].volume),get=k=>rows.find(x=>x.key===k);
 assert.equal(get('pl').value,f.meanAlveolar-f.meanPleural);
 assert.equal(get('palv').value,f.meanAlveolar);
 assert.ok(Math.abs(get('pl').value-(f.pressure-f.meanPleural))>1);
 assert.equal(get('flow').value,f.flow/1000);
});
test('unified external drive preserves true live lung pressure while shifting alveolar and pleural numbers',()=>{
 const settings={peep:8,vt:6,rr:20},a=simulateUnifiedExperiment(createPatient('high',13791,16,70),settings,{breaths:2}),b=simulateUnifiedExperiment(createPatient('high',13791,16,70),{...settings,experiment:{drive:'external'}},{breaths:2});
 for(let i=0;i<a.trajectory.frames.length;i++){
  const af=a.trajectory.frames[i],bf=b.trajectory.frames[i],get=(r,f,k)=>frameReadout(f,r.trajectory.kind,r.trajectory.frames[0].volume).find(x=>x.key===k).value;
  assert.ok(Math.abs(get(a,af,'pl')-get(b,bf,'pl'))<1e-10);
  assert.equal(get(b,bf,'paw'),0);assert.equal(get(a,af,'volume'),get(b,bf,'volume'));
 }
});
