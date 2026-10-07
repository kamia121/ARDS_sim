import {mkdir,writeFile} from 'node:fs/promises';
import {createPatient,simulate} from '../src/engine.js';
import {EXPANSION_THRESHOLD,OPEN_FILL_MIN} from '../src/map-color.js';
const rows=[];
for(const kind of ['high','low'])for(const peep of [4,12,20,24])for(const vt of [1,2,6,14]){
 const patient=createPatient(kind,13791),r=simulate(patient,{peep,vt,rr:20,pressureLimit:45},{recordTrajectory:true,recordPleuralField:true}),t=r.trajectory,m=t.pleural,ei=t.frames[t.eiIndex];
 const hard=r.units.filter(u=>u.popen>=38),tps=hard.map(u=>ei.pressure-ei.meanPleural-m.gradient*(u.dep-m.depMean));
 const grayStretch=r.units.reduce((s,u)=>s+u.weight*u.openEI*(u.openEI<=OPEN_FILL_MIN&&u.strainEI>EXPANSION_THRESHOLD),0);
 rows.push({kind,peep,vt,delivered:r.metrics.vtDelivered,eelv:r.metrics.eelv,openBefore:r.metrics.openEE,stretchShare:r.metrics.over,limited:r.metrics.limited,hardWeight:hard.reduce((s,u)=>s+u.weight,0),hardGasEE:hard.reduce((s,u)=>s+u.volumeEE,0),hardGasEI:hard.reduce((s,u)=>s+u.volumeEI,0),hardTpRange:[Math.min(...tps),Math.max(...tps)],hardOpeningRange:[Math.min(...hard.map(u=>u.popen)),Math.max(...hard.map(u=>u.popen))],grayStretchShare:grayStretch,dynamicAirTrapping:'not modeled in quasistatic mode'});
}
await mkdir('docs',{recursive:true});await writeFile('benchmarks/extreme-audit.json',JSON.stringify({source:'legacy quasi-static model, seed13791,512units,10breaths,dt0.1,PBW70; not clinical data',rows},null,2)+'\n');
const n=x=>Number(x).toFixed(2);
await writeFile('docs/EXTREME_AUDIT.md','# Legacy extremes audit\n\nQuasi-static mode has no resistance and cannot calculate dynamic air trapping. Values are uncalibrated model outputs, not clinical findings. Hard units have opening pressures38–58cmH2O across the lung, not airway pressure. Grey fill can hide expansion of their small open fraction.\n\n|Kind|PEEP|VT mL/kg|Delivered mL|Before-breath gas mL|Open %|Stretch %|Hard-unit TP at EI|Hard-unit gas EE→EI|Gray above cutoff %|Limited|\n|---|---|---|---|---|---|---|---|---|---|---|\n'+rows.map(r=>`|${r.kind}|${r.peep}|${r.vt}|${n(r.delivered)}|${n(r.eelv)}|${n(100*r.openBefore)}|${n(100*r.stretchShare)}|${r.hardTpRange.map(n).join('..')}|${n(r.hardGasEE)}→${n(r.hardGasEI)}|${n(100*r.grayStretchShare)}|${r.limited}|`).join('\n')+'\n');console.log('32 extreme cases recorded; raw data/report remain ignored.');
