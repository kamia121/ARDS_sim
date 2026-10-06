import test from 'node:test';
import assert from 'node:assert/strict';
import {WORKED_EXAMPLES,AIRFLOW_COPY,RECRUITMENT_COPY,ELI5_COPY} from '../src/learner-copy.js';
import {EXPANSION_THRESHOLD,EXTRA_AIR_RING_FRACTION} from '../src/map-color.js';
import {createPatient,simulate,MODEL_INFO} from '../src/engine.js';
import {simulateAirflow} from '../src/airflow.js';
const near=(a,b,t=1e-10)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
test('worked examples distinguish opening, expansion, total-tissue share and reference-gas emptying',()=>{
 const e=WORKED_EXAMPLES;
 near(e.opening.fBefore*e.opening.vOpen,4);near(e.opening.fAfter*e.opening.vOpen,4.8);near(e.stretch.f*e.stretch.vOpenAfter,5);
 near(e.ratio.current/e.ratio.reference,1.7);assert.ok(e.ratio.current/e.ratio.reference>EXPANSION_THRESHOLD);
 near(e.share.markedOpen/e.share.total,.2);assert.notEqual(e.share.markedOpen/e.share.total,e.share.markedOpen/e.share.open);
 near((e.emptying.peak-e.emptying.end)/e.emptying.peak,.85);assert.equal(e.emptying.start,e.emptying.end);
 near((e.emptying.peak-e.emptying.end)/(e.emptying.peak-e.emptying.start),1);assert.ok(e.emptying.end/e.emptying.peak>EXTRA_AIR_RING_FRACTION);assert.ok(e.emptying.smallEnd/e.emptying.peak<EXTRA_AIR_RING_FRACTION);assert.ok(e.emptying.smallEnd>0);
 assert.deepEqual(e.rc.map(x=>Math.round(100*Math.exp(-x.te/x.tau))),[14,37,26]);
 near(e.pressure.paw-e.pressure.ppl,15);near(e.pressure.paw-e.pressure.resistiveDrop-e.pressure.ppl,12);
 near(e.pes.mean+e.pes.gradient*(e.pes.dEs-e.pes.depMean)+e.pes.offset,10.75);
});
test('the stretch share really uses all tissue weight and partial opening, not dot counts',()=>{
 const p=createPatient('high',13791),r=simulate(p,{peep:16,vt:8});
 near(r.units.reduce((s,u)=>s+u.weight,0),1);
 const openEI=r.units.reduce((s,u)=>s+u.weight*u.openEI,0),marked=r.units.reduce((s,u)=>s+u.weight*u.openEI*(u.strainEI>EXPANSION_THRESHOLD),0);
 near(marked,r.metrics.over);near(openEI,r.metrics.openEI);assert.notEqual(marked,marked/openEI);
 assert.equal(EXPANSION_THRESHOLD,MODEL_INFO.highStrainCutoff);
});
test('extra-air release is referenced to resting PEEP, not the start of this recorded breath',()=>{
 const p=createPatient('high',13791);simulate(p,{peep:8,vt:6,rr:20});
 const r=simulateAirflow(p,{peep:8,vt:6,rr:30},{params:{R0:.016,Rp:.004}}),t=r.trajectory,ei=t.frames[t.eiIndex],end=t.frames.at(-1),base=r.units.reduce((sum,u)=>sum+u.relaxedVolume,0);
 const peakExtra=ei.volume-base,endExtra=end.volume-base;
 near((peakExtra-endExtra)/peakExtra,r.metrics.fractionEmptied,1e-9);near(endExtra,r.metrics.retainedVolume,1e-8);
 assert.ok(Math.abs((ei.volume-end.volume)/(ei.volume-t.frames[0].volume)-r.metrics.fractionEmptied)>1e-4);
});
test('simple mode and explanation layers stay available without redefining the model',()=>{
 for(const mode of [RECRUITMENT_COPY,AIRFLOW_COPY]){assert.ok(mode.sections.length>=4);assert.ok(mode.numbers.length>=4);for(const x of mode.sections)assert.ok(x.text.split(/\s+/).length<=70);}
 for(const text of Object.values(ELI5_COPY))assert.ok(text.split(/\s+/).length<=80);
 assert.match(RECRUITMENT_COPY.sections.map(x=>x.text).join(' '),/not the percentage of lung that is injured/);
 assert.match(AIRFLOW_COPY.sections.map(x=>x.text).join(' '),/earlier breath/);
 assert.match(AIRFLOW_COPY.numbers.map(x=>x.scope).join(' '),/isolated formula as an exact prediction/);
});
