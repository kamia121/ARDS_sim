import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleTrajectory,frameLabel} from '../src/playback.js';
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
