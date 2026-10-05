import {createPatient,simulate} from './engine.js';
const quantile=(arr,p)=>[...arr].sort((a,b)=>a-b)[Math.min(arr.length-1,Math.ceil(p*arr.length)-1)];
export async function benchmarkDevice(progress=()=>{}){
  const rows=[];
  for(const count of [128,512,2048]){
    progress(`Warming up ${count} units...`);
    simulate(createPatient('high',813, count),{peep:12,vt:6,rr:20,pressureLimit:45},{breaths:10,dt:0.1});
    const samples=[];
    for(let i=0;i<7;i++){
      const patient=createPatient('high',813+i,count);
      const start=performance.now();
      simulate(patient,{peep:12,vt:6,rr:20,pressureLimit:45},{breaths:10,dt:0.1});
      samples.push(performance.now()-start);
      progress(`${count} units: sample ${i+1} of 7`);
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    const medianMs=quantile(samples,0.5);
    rows.push({units:count,breaths:10,dt:0.1,samplesMs:samples,medianMs,p95Ms:quantile(samples,0.95),realTimeFactor:30000/medianMs});
  }
  return {date:new Date().toISOString(),environment:{userAgent:globalThis.navigator?.userAgent||'unavailable',logicalProcessors:globalThis.navigator?.hardwareConcurrency||null},settings:{peep:12,vt:6,rr:20,pbw:70,pressureLimit:45},scope:'Isolated engine throughput in browser worker; excludes plotting and rendering. Warmup and seven fresh-patient runs per size. No CPU throttling.',rows};
}
