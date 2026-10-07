import {writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {createUnifiedPatient} from '../src/unified-patient.js';
import {simulateUnifiedExperiment} from '../src/unified.js';
const rows=[];
function run(label,kind,settings,options={},recruitability={}){
 const p=createUnifiedPatient(kind,13791,128,70,recruitability),start=performance.now();
 try{
  const r=simulateUnifiedExperiment(p,settings,{breaths:10,recordTrajectory:false,...options}),m=r.metrics;
  rows.push({label,kind,settings,options,recruitability,ms:performance.now()-start,metrics:Object.fromEntries(['vtDelivered','ppeak','endVolume','restingPEEPVolume','dynamicResidual','sumPositiveRegionalResidual','openEnd','over','cyclic','periodicResidual','converged','belowRestCompressionIndex'].map(k=>[k,m[k]])),numerics:r.unified?.numerics});
 }catch(e){rows.push({label,kind,settings,options,recruitability,ms:performance.now()-start,error:e.message});}
}
for(const kind of ['high','low'])for(const peep of [4,20])for(const vt of [1,6,14])for(const h of [.025,.0125,.00625])run('extreme-timestep',kind,{peep,vt,rr:20,pressureLimit:45},{h});
const base={peep:20,vt:1,rr:40,pressureLimit:45};
for(const kind of ['high','low']){
 for(const residualAeration of [.002,.01,.05])run('residual-aeration',kind,base,{mechanics:{residualAeration}});
 for(const peep of [0,4])for(const chestLoad of [0,15])for(const compressionStiffness of [0,12,24])run('sub-rest-compression',kind,{...base,peep,experiment:{chestLoad}},{mechanics:{compressionStiffness}});
 for(const residualConductance of [.1,.5,1])run('residual-conductance',kind,base,{mechanics:{residualConductance,patencyPower:2,R0:.02,Rp:.01}});
 // high/low share geometry: overriding their only difference produces duplicate cases.
 if(kind==='high')for(const difficultFraction of [0,.4,.8])run('recruitability',kind,{peep:20,vt:6,rr:20,pressureLimit:45},{},{difficultFraction});
}
for(const rr of [8,20,40])for(const Rp of [.004,.02])run('emptying-time','high',{peep:8,vt:6,rr,pressureLimit:45},{mechanics:{Rp,R0:.02,resistanceSpread:.8,resistanceDependency:1}});
for(const peep of [0,20])for(const vt of [1,14])run('pressure-posture-load','low',{peep,vt,rr:40,pressureLimit:45,experiment:{drive:'external',posture:'prone',chestLoad:15}});
const failures=rows.filter(r=>r.error),pairs=[];
for(let i=0;i<36;i+=3){const a=rows[i],b=rows[i+1],c=rows[i+2];const keys=Object.keys(a.metrics||{}).filter(k=>[a,b,c].every(r=>typeof r.metrics?.[k]==='number'));pairs.push({kind:a.kind,peep:a.settings.peep,vt:a.settings.vt,deltas:a.error||b.error||c.error?null:Object.fromEntries(keys.map(k=>[k,b.metrics[k]-a.metrics[k]])),fineDeltas:a.error||b.error||c.error?null:Object.fromEntries(keys.map(k=>[k,c.metrics[k]-b.metrics[k]])),observedOrder:a.error||b.error||c.error?null:Object.fromEntries(keys.filter(k=>Math.abs(b.metrics[k]-a.metrics[k])>1e-9&&Math.abs(c.metrics[k]-b.metrics[k])>1e-9).map(k=>[k,Math.log2(Math.abs((b.metrics[k]-a.metrics[k])/(c.metrics[k]-b.metrics[k])))]))});}
const result={date:new Date().toISOString(),model:'unified nonlinear flow; 128 schematic units, seed13791, PBW70, 10 breaths',uncalibrated:true,rows,pairs,failures:failures.length};
await writeFile('benchmarks/unified-sensitivity.json',JSON.stringify(result,null,2));
await writeFile('docs/UNIFIED_SENSITIVITY.md','# Unified model numerical and parameter sensitivity\n\nRaw results: `benchmarks/unified-sensitivity.json` (local, excluded from web app). These are numerical/assumption checks, not clinical validation.\n\n'+rows.map(r=>`- ${r.label}: ${r.kind}, PEEP ${r.settings.peep}, VT ${r.settings.vt}, RR ${r.settings.rr}: ${r.error||JSON.stringify(r.metrics)}; ${r.ms.toFixed(1)} ms`).join('\n')+'\n\nTimestep differences (fine minus coarse):\n\n'+JSON.stringify(pairs,null,2)+'\n');
console.log(JSON.stringify({cases:rows.length,failures:failures.length,totalMs:rows.reduce((s,r)=>s+r.ms,0),pairs},null,2));
if(failures.length)process.exitCode=1;
