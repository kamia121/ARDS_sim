import test from 'node:test';
import assert from 'node:assert/strict';
import {frameReadout} from '../src/readout.js';
import {createPatient,simulate} from '../src/engine.js';
const frame={pressure:20,meanPleural:7,volume:2400,flow:-200};
test('pressure readouts distinguish airway difference from lung-distending pressure during flow',()=>{
  const quasi=frameReadout(frame,'quasi-static-steps',2000),flow=frameReadout(frame,'frozen-aeration-airflow',2000);
  assert.equal(quasi.find(x=>x.key==='pl').value,13);assert.match(quasi.find(x=>x.key==='pl').label,/PL/);
  assert.equal(flow.find(x=>x.key==='pl').label,'Airway − pleural');assert.match(flow.find(x=>x.key==='pl').note,/not alveolar/);
  assert.equal(quasi.find(x=>x.key==='palv').value,20);assert.equal(flow.find(x=>x.key==='palv').value,null);
  for(const rows of [quasi,flow])assert.equal(rows.find(x=>x.key==='pes').value,null);
  assert.equal(flow.find(x=>x.key==='flow').value,-.2);assert.equal(quasi.find(x=>x.key==='flow').value,null);
  assert.equal(quasi.find(x=>x.key==='delta').value,400);
});
test('quasi-static readout PL equals tissue-weighted regional transpulmonary pressure',()=>{
  const p=createPatient('wall',77,64),r=simulate(p,{peep:8,vt:6},{recordTrajectory:true});
  const dep=p.units.reduce((a,u)=>a+u.weight*u.dep,0);
  for(const f of r.trajectory.frames){
    const expected=p.baselinePleural+p.pleuralGradient*dep+p.chestWallElastance*(f.volume-p.chestWallReferenceVolume);
    assert.ok(Math.abs(f.meanPleural-expected)<1e-12);
    const mean=p.units.reduce((sum,u)=>sum+u.weight*(f.pressure-expected-p.pleuralGradient*(u.dep-dep)),0);
    assert.ok(Math.abs(frameReadout(f,r.trajectory.kind,0).find(x=>x.key==='pl').value-mean)<1e-12);
  }
});
