import {simulateAirflow,AIRFLOW_INFO} from './airflow.js';
import {createPatient,MODEL_INFO} from './engine.js';
import {normalizeExperiment,isDefaultExperiment,simulateExperiment,withoutExperiment} from './experiments.js';
import {createUnifiedPatient} from './unified-patient.js';
import {simulateUnifiedExperiment,normalizeMechanics,UNIFIED_INFO} from './unified.js';

/** Retained-state compare session: one accepted state plus at most one tentative candidate. */
export function createSession(){
  let accepted=null,candidate=null,lastId=-Infinity; // {token,key,patients,experiment}

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
      if(accepted.mode==='unified')throw new Error('Changing mechanics mode requires fresh lungs');
      if(baseStateToken==null||baseStateToken!==accepted.token)throw new Error(`baseStateToken ${baseStateToken} does not match last acknowledged token ${accepted.token}`);
      if(key!==accepted.key)throw new Error('config does not match the accepted state; send reset:true');
      patients=structuredClone(accepted.patients);
    }
    lastId=id;
    const experiment=normalizeExperiment(settings?.experiment);
    const results=patients.map(p=>({...simulateExperiment(p,settings,{breaths:10,dt:0.1,recordTrajectory:data.recordTrajectory===true,recordPleuralField:data.recordPleuralField===true&&data.recordTrajectory===true}),phenotype:p.kind,seed:p.seed}));
    candidate={token:id,key,patients,experiment,mode:'legacy'};
    return {id,type:'compare',config:structuredClone(config),results,modelInfo:MODEL_INFO,stateToken:id};
  }

  function airflow(data){
    const {id,config,settings,params,baseStateToken}=data;
    if(!Number.isFinite(id)||id<=lastId)throw new RangeError('Airflow id must increase');
    if(!accepted||baseStateToken!==accepted.token)throw new Error('Airflow requires the current acknowledged recruitment reference');
    if(accepted.mode==='unified')throw new Error('Airflow requires a recruitment reference, not unified state');
    const key=JSON.stringify(config);if(key!==accepted.key)throw new Error('Airflow configuration differs from its frozen reference; prepare fresh lungs');
    if(!isDefaultExperiment(settings?.experiment)||!isDefaultExperiment(accepted.experiment))throw new Error('Airflow trials are not available for a nondefault experiment (requested or in the accepted state)');
    lastId=id;candidate=null;
    const airflowSettings=withoutExperiment(settings);
    const results=accepted.patients.map(p=>({...simulateAirflow(structuredClone(p),airflowSettings,{params,recordTrajectory:true,recordPleuralField:data.recordPleuralField===true}),phenotype:p.kind,seed:p.seed}));
    return {id,type:'airflow',config:structuredClone(config),results,modelInfo:AIRFLOW_INFO,baseStateToken:accepted.token};
  }
  function unified(data){
    const {id,config,settings,reset,baseStateToken}=data;
    if(!Number.isFinite(id)||id<=lastId)throw new RangeError('Unified id must increase');
    candidate=null;
    if(!Array.isArray(config)||!config.length||config.some(c=>!c||typeof c!=='object'))throw new TypeError('config must be a non-empty array');
    const mechanics=normalizeMechanics(data.mechanics);
    const key=JSON.stringify({config,mechanics});
    let patients;
    if(reset===true)patients=config.map(c=>createUnifiedPatient(c.kind,c.seed,512,c.pbw,c.recruitability));
    else{
      if(!accepted||accepted.mode!=='unified'||baseStateToken!==accepted.token)throw new Error('Unified breathing requires the current acknowledged unified state or reset:true');
      if(key!==accepted.key)throw new Error('Patient or mechanics configuration changed; send reset:true');
      if(JSON.stringify(normalizeExperiment(settings?.experiment))!==JSON.stringify(accepted.experiment))throw new Error('Pressure source, posture or chest load changed; send reset:true');
      patients=structuredClone(accepted.patients);
    }
    lastId=id;
    const results=patients.map(p=>({...simulateUnifiedExperiment(p,settings,{mechanics,breaths:10,recordTrajectory:data.recordTrajectory===true,recordPleuralField:data.recordPleuralField===true&&data.recordTrajectory===true}),phenotype:p.kind,seed:p.seed}));
    candidate={token:id,key,patients,mode:'unified',experiment:normalizeExperiment(settings?.experiment)};
    return {id,type:'unified',config:structuredClone(config),results,modelInfo:UNIFIED_INFO,stateToken:id};
  }
  function acceptState({id}){
    if(candidate&&candidate.token===id){accepted=candidate;candidate=null;return {id,type:'state-accepted',stateToken:accepted.token};}
    return {id,type:'state-ignored',stateToken:accepted?accepted.token:null};
  }

  return {handle(data){
    if(data?.type==='compare')return compare(data);
    if(data?.type==='airflow')return airflow(data);
    if(data?.type==='unified')return unified(data);
    if(data?.type==='accept-state')return acceptState(data);
    throw new TypeError(`Unsupported session message type: ${data?.type}`);
  }};
}
