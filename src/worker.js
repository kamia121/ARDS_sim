import {createPatient,sweep} from './engine.js';
import {benchmarkDevice} from './benchmark.js';
import {createSession} from './session.js';
const session=createSession();
self.onmessage=async({data})=>{
  const {id,type,config,settings}=data;
  try{
    if(type==='compare'||type==='accept-state'){
      self.postMessage(session.handle(data));
    }else if(type==='sweep'){
      const results=config.map(c=>sweep(createPatient(c.kind,c.seed,512,c.pbw),settings));
      self.postMessage({id,type,results});
    }else if(type==='benchmark'){
      const results=await benchmarkDevice(message=>self.postMessage({id,type:'benchmark-progress',message}));
      self.postMessage({id,type,results});
    }
  }catch(error){self.postMessage({id,type:'error',message:error.message,requestType:type});}
};
