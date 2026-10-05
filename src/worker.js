import {createPatient,sweep} from './engine.js';
import {benchmarkDevice} from './benchmark.js';
import {createSession} from './session.js';
const session=createSession();
self.onmessage=async({data})=>{
  const {id,type,config,settings}=data;
  try{
    if(type==='compare'||type==='accept-state'||type==='airflow'){
      const result=session.handle(data),buffers=new Set();
      for(const r of result.results||[]){if(r.trajectory?.frozenOpen)buffers.add(r.trajectory.frozenOpen.buffer);for(const frame of r.trajectory?.frames||[])for(const key of ['unitOpen','unitVolume','unitFlow'])if(frame[key])buffers.add(frame[key].buffer);}
      self.postMessage(result,[...buffers]);
    }else if(type==='sweep'){
      const results=config.map(c=>sweep(createPatient(c.kind,c.seed,512,c.pbw),settings));
      self.postMessage({id,type,results});
    }else if(type==='benchmark'){
      const results=await benchmarkDevice(message=>self.postMessage({id,type:'benchmark-progress',message}));
      self.postMessage({id,type,results});
    }
  }catch(error){self.postMessage({id,type:'error',message:error.message,requestType:type});}
};
