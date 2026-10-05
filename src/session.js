import {createPatient,simulate,MODEL_INFO} from './engine.js';

/** Retained-state compare session: one accepted state plus at most one tentative candidate. */
export function createSession(){
  let accepted=null,candidate=null,lastId=-Infinity; // {token,key,patients}

  function compare(data){
    const {id,config,settings,reset,baseStateToken}=data;
    if(!Number.isFinite(id)||id<=lastId)throw new RangeError(`Compare id must be a finite number greater than the previous compare id (${lastId})`);
    candidate=null; // A newer request supersedes even a candidate preceding a failed run.
    if(!Array.isArray(config)||config.length===0||config.some(c=>c==null||typeof c!=='object'))throw new TypeError('config must be a non-empty array of patient configurations');
    const key=JSON.stringify(config);
    let patients;
    if(reset===true){
      patients=config.map(c=>createPatient(c.kind,c.seed,512,c.pbw));
    }else{
      if(!accepted)throw new Error('No accepted state; send reset:true for a fresh comparison');
      if(baseStateToken==null||baseStateToken!==accepted.token)throw new Error(`baseStateToken ${baseStateToken} does not match last acknowledged token ${accepted.token}`);
      if(key!==accepted.key)throw new Error('config does not match the accepted state; send reset:true');
      patients=structuredClone(accepted.patients);
    }
    lastId=id;
    const results=patients.map(p=>({...simulate(p,settings,{breaths:10,dt:0.1,recordTrajectory:data.recordTrajectory===true}),phenotype:p.kind,seed:p.seed}));
    candidate={token:id,key,patients};
    return {id,type:'compare',config:structuredClone(config),results,modelInfo:MODEL_INFO,stateToken:id};
  }

  function acceptState({id}){
    if(candidate&&candidate.token===id){accepted=candidate;candidate=null;return {id,type:'state-accepted',stateToken:accepted.token};}
    return {id,type:'state-ignored',stateToken:accepted?accepted.token:null};
  }

  return {handle(data){
    if(data?.type==='compare')return compare(data);
    if(data?.type==='accept-state')return acceptState(data);
    throw new TypeError(`Unsupported session message type: ${data?.type}`);
  }};
}
