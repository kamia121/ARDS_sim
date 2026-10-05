import {createPatient,simulate,sweep,MODEL_INFO} from './engine.js';
import {benchmarkDevice} from './benchmark.js';
let patients=[],keys=[];
self.onmessage=async({data})=>{
  const {id,type,config,settings}=data;
  try{
    if(type==='compare'){
      config.forEach((c,i)=>{
        const key=JSON.stringify(c);
        if(key!==keys[i]||data.reset){patients[i]=createPatient(c.kind,c.seed,512,c.pbw);keys[i]=key;}
      });
      const results=patients.map(p=>({...simulate(p,settings,{breaths:10,dt:0.1}),phenotype:p.kind,seed:p.seed}));
      self.postMessage({id,type,results,modelInfo:MODEL_INFO});
    }else if(type==='sweep'){
      const results=config.map(c=>sweep(createPatient(c.kind,c.seed,512,c.pbw),settings));
      self.postMessage({id,type,results});
    }else if(type==='benchmark'){
      const results=await benchmarkDevice(message=>self.postMessage({id,type:'benchmark-progress',message}));
      self.postMessage({id,type,results});
    }
  }catch(error){self.postMessage({id,type:'error',message:error.message,requestType:type});}
};
