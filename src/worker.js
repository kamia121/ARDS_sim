import {createPatient} from './engine.js';
import {sweepExperiment} from './experiments.js';
import {benchmarkDevice} from './benchmark.js';
import {createSession} from './session.js';
const session=createSession();
self.onmessage=async({data})=>{
  const {id,type,config,settings}=data;
  try{
    if(type==='compare'||type==='accept-state'||type==='airflow'||type==='unified'){
      const handled=session.handle(data),result=type==='unified'?structuredClone(handled):handled,buffers=new Set();
      // Unified frames may share arrays with the retained candidate: transfer a separate clone.
      for(const r of result.results||[]){if(r.trajectory?.frozenOpen)buffers.add(r.trajectory.frozenOpen.buffer);for(const frame of r.trajectory?.frames||[])for(const key of ['unitOpen','unitVolume','unitRatio','unitFlow','unitAlveolar'])if(frame[key])buffers.add(frame[key].buffer);}
      self.postMessage(result,[...buffers]);
    }else if(type==='sweep'){
      const results=config.map(c=>sweepExperiment(createPatient(c.kind,c.seed,512,c.pbw),settings));
      self.postMessage({id,type,results});
    }else if(type==='benchmark'){
      const results=await benchmarkDevice(message=>self.postMessage({id,type:'benchmark-progress',message}));
      self.postMessage({id,type,results});
    }
  }catch(error){self.postMessage({id,type:'error',message:error.message,requestType:type});}
};
