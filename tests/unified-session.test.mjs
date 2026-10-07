import test from 'node:test';
import assert from 'node:assert/strict';
import {createSession} from '../src/session.js';
const config=[{kind:'high',seed:13791,pbw:70}];
const settings={peep:8,vt:1,rr:40,pressureLimit:45};
const request=(id,extra={})=>({id,type:'unified',config,settings,reset:true,recordTrajectory:true,recordPleuralField:true,...extra});
test('unified session only retains acknowledged compatible state',()=>{
 const s=createSession(),a=s.handle(request(1));assert.equal(a.type,'unified');
 assert.throws(()=>s.handle(request(2,{reset:false,baseStateToken:1})),/acknowledged/);
 const b=s.handle(request(3));s.handle({type:'accept-state',id:3});
 const c=s.handle(request(4,{reset:false,baseStateToken:3}));assert.equal(c.stateToken,4);assert.ok(c.results[0].metrics.endVolume>0);
 s.handle({type:'accept-state',id:4});
 assert.throws(()=>s.handle(request(5,{reset:false,baseStateToken:4,mechanics:{R0:.02}})),/configuration/);
 assert.equal(s.handle({type:'accept-state',id:5}).type,'state-ignored');
});
test('unified gas state survives transferring an outbound clone',()=>{
 const s=createSession(),a=s.handle(request(1));
 const outbound=structuredClone(a),buffers=new Set();
 for(const f of outbound.results[0].trajectory.frames)for(const k of ['unitOpen','unitVolume','unitRatio','unitFlow','unitAlveolar'])if(f[k])buffers.add(f[k].buffer);
 structuredClone(outbound,{transfer:[...buffers]});
 s.handle({type:'accept-state',id:1});
 const retained=s.handle(request(2,{reset:false,baseStateToken:1}));assert.ok(Number.isFinite(retained.results[0].metrics.endVolume));
});
test('unified and legacy state lineages cannot be mixed',()=>{
 const s=createSession();s.handle(request(1));s.handle({type:'accept-state',id:1});
 assert.throws(()=>s.handle({id:2,type:'compare',config,settings,reset:false,baseStateToken:1}),/fresh lungs/);
 assert.throws(()=>s.handle({id:3,type:'airflow',config,settings,baseStateToken:1}),/recruitment reference/);
 const legacy=s.handle({id:4,type:'compare',config,settings,reset:true});assert.equal(legacy.type,'compare');s.handle({type:'accept-state',id:4});
 assert.throws(()=>s.handle(request(5,{reset:false,baseStateToken:4})),/acknowledged unified/);
});
