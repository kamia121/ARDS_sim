import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleTrajectory,frameLabel,transitionFrame,loopTransitionFrame,displaySegment,displayElapsed} from '../src/playback.js';
const mk=(time,phase,volume,pressure,u,ceil=false)=>({time,phase,pressure,volume,meanPleural:volume/10,open:volume,ceilingActive:ceil,unitOpen:Float64Array.from(u),unitVolume:Float64Array.from(u.map(x=>x*2))});
const tr=()=>({kind:'quasi-static-steps',cycle:3,ti:1,eiIndex:2,releaseIndex:3,frames:[
  mk(0,'start',0,5,[0,0]),mk(.5,'inspiration',200,15,[1,0]),mk(1,'inspiration',400,25,[1,1],true),
  mk(1,'release',100,5,[1,0]),mk(2,'expiration',60,5,[1,0]),mk(3,'expiration',20,5,[0,0])]});
const dump=t=>JSON.stringify(t,(k,v)=>ArrayBuffer.isView(v)?[...v]:v);
test('exact timestamps return computed frames by reference; duplicate picks EI',()=>{
  const t=tr();
  for(const [time,i] of [[0,0],[.5,1],[1,2],[2,4],[3,5]]){
    const s=sampleTrajectory(t,time);assert.equal(s.frame,t.frames[i]);assert.equal(s.index,i);assert.equal(s.interpolated,false);
  }
  assert.equal(sampleTrajectory(t,99).frame,t.frames[5]);
  assert.equal(sampleTrajectory(t,-4).frame,t.frames[0]);
});
test('just after ti starts from release, never interpolating from EI',()=>{
  const t=tr(),s=sampleTrajectory(t,1+1e-9);
  assert.equal(s.interpolated,true);assert.equal(s.index,3);assert.equal(s.frame.phase,'expiration');
  assert.ok(Math.abs(s.frame.volume-100)<1e-6);assert.ok(Math.abs(s.frame.pressure-5)<1e-6);
});
test('interpolates scalars and arrays within segments with weights',()=>{
  const t=tr();
  const a=sampleTrajectory(t,.25);
  assert.equal(a.index,0);assert.equal(a.frame.phase,'inspiration');assert.equal(a.frame.volume,100);
  assert.deepEqual([...a.frame.unitOpen],[.5,0]);assert.deepEqual([...a.frame.unitVolume],[1,0]);
  assert.ok(a.frame.unitOpen instanceof Float64Array);assert.notEqual(a.frame.unitOpen,t.frames[0].unitOpen);
  const b=sampleTrajectory(t,.75);assert.equal(b.frame.ceilingActive,true);assert.equal(b.frame.volume,300);
  const c=sampleTrajectory(t,1.5);
  assert.equal(c.index,3);assert.equal(c.frame.volume,80);assert.deepEqual([...c.frame.unitOpen],[1,0]);assert.equal(c.frame.ceilingActive,false);
  const d=sampleTrajectory(t,2.75);assert.equal(d.index,4);assert.equal(d.frame.volume,30);assert.deepEqual([...d.frame.unitOpen],[.25,0]);
});
test('sampling does not mutate trajectory',()=>{
  const t=tr(),snap=dump(t);
  for(const x of [0,.3,1,1.0001,2.5,3])sampleTrajectory(t,x);
  assert.equal(dump(t),snap);
});
test('malformed input throws',()=>{
  assert.throws(()=>sampleTrajectory({frames:[]},0),/no frames/);
  assert.throws(()=>sampleTrajectory(null,0),/required/);
  assert.throws(()=>sampleTrajectory({...tr(),releaseIndex:2},0),/eiIndex/);
  assert.throws(()=>sampleTrajectory(tr(),NaN),/number/);
});
test('frame labels',()=>{
  const t=tr(),L=i=>frameLabel(t.frames[i],i,t);
  assert.deepEqual([0,1,2,3,4,5].map(L),['Before inspiration','Inspiration','End inspiration','Pressure release','Expiration','End expiration']);
});
test('interpolated states are labeled by phase rather than mistaken for exact boundary frames',()=>{
 const t=tr();
 const first=sampleTrajectory(t,.25),release=sampleTrajectory(t,1.01);
 assert.equal(frameLabel(first.frame,first.index,t),'Inspiration');
 assert.equal(frameLabel(release.frame,release.index,t),'Expiration');
});

test('airflow inlet and outlet discontinuities preserve volume and are not interpolated as volume jumps',()=>{
 const t=tr();t.kind='frozen-aeration-airflow';t.frames.splice(1,0,{...t.frames[0],phase:'inspiration',pressure:15});t.eiIndex++;t.releaseIndex++;
 t.frames[t.releaseIndex]={...t.frames[t.releaseIndex],volume:t.frames[t.eiIndex].volume,unitVolume:t.frames[t.eiIndex].unitVolume};
 const afterStart=sampleTrajectory(t,1e-9);assert.ok(afterStart.frame.pressure>14.99);
 assert.equal(frameLabel(t.frames[t.releaseIndex],t.releaseIndex,t),'Start expiration');
 const afterRelease=sampleTrajectory(t,1+1e-9);assert.ok(afterRelease.frame.volume>399.99);assert.equal(afterRelease.frame.pressure,5);
});

test('transitionFrame returns EI and release by reference at endpoints',()=>{
  const t=tr();
  assert.equal(transitionFrame(t,0),t.frames[2]);
  assert.equal(transitionFrame(t,1),t.frames[3]);
});
test('transitionFrame blends EI to release purely at the same time with typed arrays',()=>{
  const t=tr(),snap=dump(t),f=transitionFrame(t,.25);
  assert.equal(f.phase,'transition');assert.equal(f.time,1);
  assert.equal(f.volume,325);assert.equal(f.pressure,20);assert.equal(f.ceilingActive,true);
  assert.ok(f.unitOpen instanceof Float64Array&&f.unitVolume instanceof Float64Array);
  assert.deepEqual([...f.unitOpen],[1,.75]);assert.deepEqual([...f.unitVolume],[2,1.5]);
  assert.notEqual(f.unitOpen,t.frames[2].unitOpen);
  for(const w of [.1,.5,.9]){const g=transitionFrame(t,w);assert.ok(Number.isFinite(g.volume)&&Number.isFinite(g.pressure)&&g.time===1);assert.ok([...g.unitOpen,...g.unitVolume].every(Number.isFinite));}
  assert.equal(dump(transitionFrame(t,.5)),dump(transitionFrame(t,.5)));
  assert.equal(dump(t),snap);
});
test('transitionFrame carries unitRatio and release unitOpen equals EI',()=>{
  const t=tr();t.frames.forEach(fr=>{fr.unitRatio=Float64Array.from([1,1.5]);});
  t.frames[3].unitRatio=Float64Array.from([1.2,1.7]);t.frames[3].unitOpen=Float64Array.from(t.frames[2].unitOpen);
  const f=transitionFrame(t,.5);
  assert.ok(f.unitRatio instanceof Float64Array);assert.ok(Math.abs(f.unitRatio[0]-1.1)<1e-12&&Math.abs(f.unitRatio[1]-1.6)<1e-12);
  assert.deepEqual([...f.unitOpen],[...t.frames[2].unitOpen]);
});
test('transitionFrame rejects invalid weights, airflow and malformed trajectories',()=>{
  for(const w of [-0.001,1.001,NaN,Infinity,-Infinity,'0.5',null,undefined])assert.throws(()=>transitionFrame(tr(),w),/weight/);
  const a=tr();a.kind='frozen-aeration-airflow';
  assert.throws(()=>transitionFrame(a,.5),/quasi-static/);
  assert.throws(()=>transitionFrame(null,.5),/required/);
  assert.throws(()=>transitionFrame({...tr(),releaseIndex:2},.5),/eiIndex/);
});

const air=()=>{const t=tr();t.kind='frozen-aeration-airflow';const shared=Float64Array.from([1,1]);t.frames.forEach(f=>{f.unitOpen=shared;});
  t.frames[0]={...t.frames[0],pressure:0,volume:0};t.frames[1]={...t.frames[0],phase:'inspiration',pressure:15};return t;};
test('loopTransitionFrame returns last/start by reference at endpoints',()=>{
  const t=tr();assert.equal(loopTransitionFrame(t,0),t.frames[5]);assert.equal(loopTransitionFrame(t,1),t.frames[0]);
});
test('loopTransitionFrame blends last to first, pins time, never mutates',()=>{
  const t=tr(),f=loopTransitionFrame(t,.25);
  assert.equal(f.phase,'loop-transition');assert.equal(f.time,3);
  assert.equal(f.volume,15);assert.equal(f.pressure,5);assert.ok(f.unitOpen instanceof Float64Array);
  assert.deepEqual([...f.unitOpen],[0,0]);assert.notEqual(f.unitOpen,t.frames[5].unitOpen);
  t.frames[5].unitOpen=Float64Array.from([1,0]);t.frames[5].volume=40;
  const g=loopTransitionFrame(t,.5);assert.equal(g.volume,20);assert.deepEqual([...g.unitOpen],[.5,0]);assert.equal(g.time,3);
  const s2=dump(t);loopTransitionFrame(t,.7);assert.equal(dump(t),s2);
});
test('loopTransitionFrame works on airflow with shared frozen unitOpen and leaves it intact',()=>{
  const t=air(),shared=t.frames[0].unitOpen,snap=dump(t);
  const f=loopTransitionFrame(t,.5);
  assert.notEqual(f.unitOpen,shared);assert.deepEqual([...f.unitOpen],[1,1]);assert.equal(f.time,3);
  assert.equal(f.volume,10);
  assert.equal(dump(t),snap);assert.deepEqual([...shared],[1,1]);
});
test('loopTransitionFrame validates',()=>{
  for(const w of [-1,2,NaN,Infinity,'0',null,undefined])assert.throws(()=>loopTransitionFrame(tr(),w),/weight/);
  assert.throws(()=>loopTransitionFrame(null,.5),/required/);
});
test('displaySegment boundaries with defaults (quasi-static)',()=>{
  const t=tr(),S=e=>displaySegment(t,e);
  const P=3+.45+.5+.35;
  assert.deepEqual(S(0),{segment:'inspiration',replayTime:0,weight:0,period:P});
  assert.equal(S(.5).segment,'inspiration');assert.equal(S(.5).replayTime,.5);
  assert.deepEqual([S(1).segment,S(1).replayTime,S(1).weight],['hold',1,0]);
  assert.equal(S(1.449).segment,'hold');
  assert.deepEqual([S(1.45).segment,S(1.45).replayTime,S(1.45).weight],['ei-transition',1,0]);
  assert.equal(S(1.7).weight,.5);
  assert.deepEqual([S(1.95).segment,S(1.95).replayTime,S(1.95).weight],['expiration',1,0]);
  assert.equal(S(2.95).replayTime,2);
  assert.deepEqual([S(3.95).segment,S(3.95).replayTime,S(3.95).weight],['loop-transition',3,0]);
  assert.ok(Math.abs(S(4.125).weight-.5)<1e-12);
  assert.equal(S(P).segment,'done');assert.equal(S(P+100).segment,'done');assert.equal(S(P).weight,1);
});
test('displaySegment zero-length boundaries choose coherent half-open segments',()=>{
  const t=tr();
  assert.equal(displaySegment(t,1,{hold:0}).segment,'ei-transition');
  assert.equal(displaySegment(t,1,{hold:0,eiTransition:0}).segment,'expiration');
  assert.equal(displaySegment(t,1,{hold:0,eiTransition:0}).replayTime,1);
  assert.equal(displaySegment(t,0,{hold:0,eiTransition:0,loopTransition:0}).segment,'inspiration');
  assert.equal(displaySegment(t,3,{hold:0,eiTransition:0,loopTransition:0}).segment,'done');
  assert.equal(displaySegment(t,3,{hold:0,eiTransition:0,loopTransition:.2}).segment,'loop-transition');
});
test('displaySegment airflow has no EI blend; onset and release are not blended with first opening',()=>{
  const t=air(),o={hold:.4};
  assert.equal(displaySegment(t,0,o).period,3+.4+.35);
  assert.equal(displaySegment(t,1.2,o).segment,'hold');
  const x=displaySegment(t,1.4,o);assert.deepEqual([x.segment,x.replayTime,x.weight],['expiration',1,0]);
  assert.equal(displaySegment(t,1.4+.5,{...o,eiTransition:9}).replayTime,1.5);
  assert.equal(displaySegment(t,1.4,{...o,eiTransition:9}).segment,'expiration');
  assert.equal(displayElapsed(t,1,3,o),1.4);
  const first=sampleTrajectory(t,1e-9);assert.ok(first.frame.pressure>14.99);
  assert.equal(displaySegment(t,1e-9,o).segment,'inspiration');
});
test('displaySegment loop=false has no extra end pause',()=>{
  const t=tr(),o={loop:false,loopTransition:5};
  const P=3+.45+.5;
  assert.equal(displaySegment(t,0,o).period,P);
  assert.equal(displaySegment(t,P-1e-9,o).segment,'expiration');
  assert.equal(displaySegment(t,P,o).segment,'done');
});
test('displaySegment validates elapsed and options',()=>{
  const t=tr();
  for(const e of [-1,NaN,Infinity,'1',null,undefined])assert.throws(()=>displaySegment(t,e),/elapsed/);
  for(const k of ['hold','eiTransition','loopTransition'])for(const v of [-1,NaN,Infinity,'1',null])assert.throws(()=>displaySegment(t,0,{[k]:v}),new RegExp(k));
  assert.throws(()=>displaySegment(t,0,{loop:'yes'}),/loop/);
  assert.throws(()=>displaySegment(t,0,null),/options/);
  assert.throws(()=>displaySegment(null,0),/required/);
  assert.throws(()=>displaySegment({...tr(),releaseIndex:2},0),/eiIndex/);
});
test('displayElapsed maps model time and frame to wall clock',()=>{
  const t=tr(),o={hold:.45,eiTransition:.5};
  assert.equal(displayElapsed(t,.5,1,o),.5);
  assert.equal(displayElapsed(t,1,2,o),1);
  assert.equal(displayElapsed(t,1,3,o),1.95);
  assert.equal(displayElapsed(t,2,4,o),2.95);
  assert.equal(displayElapsed(t,3,5,o),3.95);
  assert.equal(displayElapsed(t,0,0,o),0);
  assert.equal(displayElapsed(t,99,5,o),3.95);
  assert.equal(displaySegment(t,displayElapsed(t,3,5,o),o).segment,'loop-transition');
  assert.equal(displaySegment(t,displayElapsed(t,1,3,o),o).segment,'expiration');
  assert.equal(displaySegment(t,displayElapsed(t,1,2,o),o).segment,'hold');
  for(const time of [NaN,Infinity,'1'])assert.throws(()=>displayElapsed(t,time,0),/time/);
  for(const i of [-1,6,1.5,NaN,undefined])assert.throws(()=>displayElapsed(t,1,i),/index/);
  assert.throws(()=>displayElapsed(t,1,2,{hold:-1}),/hold/);
});
test('raw trajectory data and its start/end differences are untouched by display helpers',()=>{
  const t=tr(),snap=dump(t);
  for(const e of [0,.7,1,1.45,1.7,2,3.9,4.1,9]){const s=displaySegment(t,e);if(s.segment==='ei-transition')transitionFrame(t,s.weight);if(s.segment==='loop-transition')loopTransitionFrame(t,s.weight);}
  assert.equal(dump(t),snap);assert.equal(t.frames[5].volume-t.frames[0].volume,20);
});
