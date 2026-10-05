import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
const upstream = path.resolve(process.argv[2] || '../explain-trial');
const {createEngine} = await import(pathToFileURL(path.join(upstream,'scripts/_harness.mjs')));
const eng = await createEngine();
const defJSON = JSON.parse(fs.readFileSync(path.join(upstream,'model_definitions/adult_female.json'),'utf8'));
const definition = defJSON.model_definition || defJSON;
const buildStart = performance.now();
const model = eng.build(definition);
const buildMs = performance.now()-buildStart;
if(!model?.models) throw new Error('Explain adult model did not build');
const vent = model.models.Ventilator;
if(vent){vent.switch_ventilator(true);vent.set_vc(8,20,420,1,35,45,0.2);}
if(model.models.Breathing) model.models.Breathing.breathing_enabled=false;
eng.calc(10);
const samples=[];
for(let i=0;i<7;i++) {const t=performance.now();eng.calc(10);samples.push(performance.now()-t);}
const sorted=[...samples].sort((a,b)=>a-b);
const modelNames=Object.keys(model.models);
const out={date:new Date().toISOString(),engine:'Explain Engine',commit:execFileSync('git',['-C',upstream,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),environment:{node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model},scenario:'adult_female',configuration:{peep:8,rr:20,tidalVolume:420,inspiratoryTime:1,flowLMin:35,pressureLimit:45,hold:0.2},modelCount:modelNames.length,stepSize:model.modeling_stepsize,buildMs,warmupSimulatedSeconds:10,simulatedSecondsPerSample:10,samplesMs:samples,medianMs:sorted[3],p95Ms:sorted[6],realTimeFactor:10000/sorted[3],scope:'Sequential windows of an adult whole-body engine. This is an integration feasibility and throughput trial, not an equivalent-workload comparison with ARDS_sim_kh or external physiological validation.',alveolarComponents:modelNames.filter(n=>['ALL','ALR'].includes(n)),recruitmentControllerPresent:!!model.models.Surfactant,ventilatorPresent:!!vent,finiteVentilatorOutputs:vent?Object.fromEntries(['p_plat','p_peak','compliance_static','tidal_volume'].map(k=>[k,Number.isFinite(vent[k])?vent[k]:null])):null};
fs.writeFileSync('benchmarks/results-explain.json',JSON.stringify(out,null,2)+'\n');
eng.log(JSON.stringify(out,null,2));
