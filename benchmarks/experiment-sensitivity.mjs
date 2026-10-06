// Numerical sensitivity of the healthyDependent kind and the prone / chest-load / negative-pressure experiments.
//   node benchmarks/experiment-sensitivity.mjs
// Writes raw JSON (benchmarks/experiment-sensitivity.json) and a compact report (docs/EXPERIMENT_SENSITIVITY.md); both are gitignored.
// The numbers describe this uncalibrated educational model only; they are not validation and not clinical findings.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createPatient, MODEL_INFO } from '../src/engine.js';
import { simulateExperiment } from '../src/experiments.js';

const RAW = fileURLToPath(new URL('./experiment-sensitivity.json', import.meta.url));
const REPORT = fileURLToPath(new URL('../docs/EXPERIMENT_SENSITIVITY.md', import.meta.url));
const SEEDS = [13791, 4242, 77];
const BASE = { vt: 6, rr: 20, pressureLimit: 45 };
const OPTS = { breaths: 10, dt: 0.1 };
const ANCHOR_PEEPS = [0, 2, 5, 8, 10];
const KEYS = ['eelv', 'openEE', 'openEI', 'cyclic', 'over', 'closedPerfusion', 'pplat', 'dp', 'crs', 'meanPleuralEE', 'meanPleuralEI', 'transpulmonaryEI', 'vtDelivered', 'limited'];
const pick = m => Object.fromEntries(KEYS.map(k => [k, m[k]]));
const run = (patient, peep, experiment, opts = OPTS) => pick(simulateExperiment(patient, { ...BASE, peep, ...(experiment ? { experiment } : {}) }, { ...opts }).metrics);
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const f = (x, d = 3) => x == null ? 'n/a' : typeof x === 'boolean' ? String(x) : Number(x).toFixed(d);
const pct = x => `${(100 * x).toFixed(1)}%`;
const range = (a, d = 3) => `${f(Math.min(...a), d)}..${f(Math.max(...a), d)}`;
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');

const raw = { schema: 'experiment-sensitivity/1', generatedAt: new Date().toISOString(), node: process.version, modelVersion: MODEL_INFO.version, base: BASE, options: OPTS, seeds: SEEDS };
const md = [];

// 1. healthyDependent construction and PEEP response ---------------------------------------------------------
const clampStats = patient => {
  let count = 0, weight = 0, dependentCount = 0, dependentWeight = 0;
  for (const u of patient.units) if (u.dep > 0.6) { dependentCount++; dependentWeight += u.weight; }
  const healthy = createPatient('healthy', patient.seed, patient.count, patient.pbw);
  patient.units.forEach((u, i) => {
    const s = Math.max(0, (u.dep - 0.6) / 0.4), unclamped = healthy.units[i].pclose + 3.5 * s;
    if (unclamped > u.popen - 0.5) { count++; weight += u.weight; }
  });
  const weightedF = patient.units.reduce((a, u) => a + u.weight * u.f, 0);
  return { units: patient.units.length, thresholdClampedUnits: count, thresholdClampedUnitFraction: count / patient.units.length, thresholdClampedWeightFraction: weight, dependentUnitFraction: dependentCount / patient.units.length, dependentWeightFraction: dependentWeight, initialWeightedF: weightedF };
};
const anchors = { seeds: {}, aggregate: {} };
for (const seed of SEEDS) {
  const byKind = {};
  for (const kind of ['healthyDependent', 'healthy']) {
    byKind[kind] = { construction: kind === 'healthyDependent' ? clampStats(createPatient(kind, seed)) : { initialWeightedF: createPatient(kind, seed).units.reduce((a, u) => a + u.weight * u.f, 0) }, peep: {} };
    for (const peep of ANCHOR_PEEPS) byKind[kind].peep[peep] = run(createPatient(kind, seed), peep);
  }
  anchors.seeds[seed] = byKind;
}
raw.healthyDependentAnchors = anchors;
md.push('# Experiment sensitivity record', '', `Generated ${raw.generatedAt} with node ${process.version}, model ${MODEL_INFO.version}. 512 units, PBW 70, VT 6 mL/kg, RR 20, pressure limit 45, ten breaths, dt 0.1 s, fresh patient per run. Raw numbers: benchmarks/experiment-sensitivity.json. Illustrative uncalibrated model: no clinical fitting or validation is implied.`, '');
md.push('## 1. healthyDependent PEEP response (EE aerated tissue fraction, tissue weighted)', '');
md.push(table(['PEEP', ...SEEDS.map(s => `seed ${s}`), 'healthy (same seeds)'], ANCHOR_PEEPS.map(peep => [String(peep), ...SEEDS.map(s => pct(anchors.seeds[s].healthyDependent.peep[peep].openEE)), SEEDS.map(s => pct(anchors.seeds[s].healthy.peep[peep].openEE)).join(' / ')])), '');
md.push('Other metrics at seed 13791 (healthyDependent):', '');
md.push(table(['PEEP', 'EELV mL', 'closed-perfusion proxy', 'pplat', 'dp', 'high volume-ratio fraction', 'limited'], ANCHOR_PEEPS.map(peep => { const m = anchors.seeds[13791].healthyDependent.peep[peep]; return [String(peep), f(m.eelv, 0), f(m.closedPerfusion, 4), f(m.pplat, 2), f(m.dp, 2), f(m.over, 4), String(m.limited)]; })), '');
md.push('Construction (threshold clamp = closing threshold limited to opening threshold minus 0.5):', '');
md.push(table(['seed', 'initial weighted f', 'dependency>0.6 weight', 'clamped units', 'clamped weight'], SEEDS.map(s => { const c = anchors.seeds[s].healthyDependent.construction; return [String(s), f(c.initialWeightedF, 4), f(c.dependentWeightFraction, 3), `${c.thresholdClampedUnits}/${c.units} (${pct(c.thresholdClampedUnitFraction)})`, pct(c.thresholdClampedWeightFraction)]; })), '');

// 2. healthyDependent perturbations on a cloned healthy preset ----------------------------------------------------
function buildDependent(seed, { d0 = 0.6, fDrop = 0.6, popenAdd = 1, pcloseAdd = 3.5, scale = {} } = {}) {
  const p = createPatient('healthy', seed);
  p.kind = 'healthyDependent';
  for (const u of p.units) {
    const s = Math.max(0, (u.dep - d0) / (1 - d0));
    u.f = 0.995 - fDrop * s; u.popen += popenAdd * s; u.pclose = Math.min(u.pclose + pcloseAdd * s, u.popen - 0.5);
    u.capacity *= scale.capacity ?? 1; u.rest *= scale.rest ?? 1; u.stiffness *= scale.stiffness ?? 1;
  }
  p.baselinePleural *= scale.pleural ?? 1; p.pleuralGradient *= scale.gradient ?? 1; p.chestWallElastance *= scale.ew ?? 1; p.chestWallReferenceVolume *= scale.reference ?? 1;
  return p;
}
for (const seed of SEEDS) assert.ok(JSON.stringify(buildDependent(seed)) === JSON.stringify(createPatient('healthyDependent', seed)), 'perturbation harness must reproduce healthyDependent exactly at the default constants');
const variants = [{ name: 'default', args: {} }];
for (const d0 of [0.5, 0.7]) variants.push({ name: `d0=${d0}`, args: { d0 } });
for (const [name, key] of [['f drop 0.6', 'fDrop'], ['popen add 1', 'popenAdd'], ['pclose add 3.5', 'pcloseAdd']]) for (const m of [0.5, 1.5]) variants.push({ name: `${name} x${m}`, args: { [key]: { fDrop: 0.6, popenAdd: 1, pcloseAdd: 3.5 }[key] * m } });
for (const key of ['capacity', 'rest', 'stiffness', 'pleural', 'gradient', 'ew', 'reference']) for (const m of [0.5, 1.5]) variants.push({ name: `healthy ${key} x${m}`, args: { scale: { [key]: m } } });
const perturb = variants.map(v => ({ name: v.name, args: v.args, seeds: Object.fromEntries(SEEDS.map(seed => [seed, Object.fromEntries(ANCHOR_PEEPS.map(peep => [peep, run(buildDependent(seed, v.args), peep)]))])) }));
raw.healthyDependentPerturbations = perturb;
md.push('## 2. healthyDependent perturbations (cloned healthy preset; EE aerated fraction, mean over seeds, [min..max] in brackets)', '');
md.push(table(['variant', ...ANCHOR_PEEPS.map(p => `PEEP ${p}`)], perturb.map(v => [v.name, ...ANCHOR_PEEPS.map(peep => { const a = SEEDS.map(s => v.seeds[s][peep].openEE); return `${pct(mean(a))} [${pct(Math.min(...a))}..${pct(Math.max(...a))}]`; })])), '');

// 3. prone / chest load ---------------------------------------------------------------------------------------------
const conditions = [{ name: 'supine', experiment: null }];
for (const k of [0, 0.25, 0.5, 1]) conditions.push({ name: `prone k=${k}`, experiment: { posture: 'prone', proneGradientFactor: k } });
for (const chestLoad of [2, 5, 10]) conditions.push({ name: `supine load ${chestLoad}`, experiment: { chestLoad } });
const exp = { cases: [] };
for (const kind of ['high', 'low']) for (const peep of [8, 12]) for (const seed of SEEDS) for (const c of conditions) exp.cases.push({ kind, peep, seed, condition: c.name, experiment: c.experiment, metrics: run(createPatient(kind, seed), peep, c.experiment) });
raw.experiments = exp;
md.push('## 3. Prone gradient factor and chest load (fresh supine-initialized patient, ten breaths)', '', 'Mean over seeds 13791/4242/77; delta columns are versus supine with the same kind/seed/PEEP, shown as mean [min..max]. Prone keeps tissue-weighted mean pleural pressure at fixed gas volume; chest load adds an offset to pleural pressure and raises pplat by load for the same transpulmonary state. Positive and negative deltas are both reported.', '');
for (const kind of ['high', 'low']) for (const peep of [8, 12]) {
  const rows = conditions.map(c => {
    const cases = SEEDS.map(seed => exp.cases.find(x => x.kind === kind && x.peep === peep && x.seed === seed && x.condition === c.name).metrics);
    const sup = SEEDS.map(seed => exp.cases.find(x => x.kind === kind && x.peep === peep && x.seed === seed && x.condition === 'supine').metrics);
    const d = key => cases.map((m, i) => m[key] - sup[i][key]);
    return [c.name, pct(mean(cases.map(m => m.openEE))), `${f(mean(d('openEE')), 4)} [${range(d('openEE'), 4)}]`, f(mean(cases.map(m => m.eelv)), 0), `${f(mean(d('eelv')), 0)} [${range(d('eelv'), 0)}]`, f(mean(cases.map(m => m.closedPerfusion)), 4), `${f(mean(d('closedPerfusion')), 4)} [${range(d('closedPerfusion'), 4)}]`, f(mean(cases.map(m => m.pplat)), 2), f(mean(cases.map(m => m.dp)), 2), f(mean(cases.map(m => m.transpulmonaryEI)), 2), f(mean(cases.map(m => m.over)), 4), String(cases.filter(m => m.limited).length)];
  });
  md.push(`### ${kind}, PEEP ${peep}`, '', table(['condition', 'EE aerated', 'd aerated', 'EELV', 'd EELV', 'closed-perf', 'd closed-perf', 'pplat', 'dp', 'transpulm EI', 'over', 'limited n/3'], rows), '');
}

// healthyDependent under the experiments
const hdRows = [];
for (const peep of [0, 5, 10]) for (const c of conditions) {
  const a = SEEDS.map(seed => run(createPatient('healthyDependent', seed), peep, c.experiment));
  hdRows.push([String(peep), c.name, pct(mean(a.map(m => m.openEE))), range(a.map(m => m.openEE), 4), f(mean(a.map(m => m.closedPerfusion)), 4), f(mean(a.map(m => m.eelv)), 0)]);
}
raw.healthyDependentExperiments = hdRows;
md.push('### healthyDependent under the experiments (mean over seeds)', '', table(['PEEP', 'condition', 'EE aerated', 'range', 'closed-perf', 'EELV'], hdRows), '');

// 4. external (negative-pressure) re-expression ---------------------------------------------------------------------
const ext = [];
for (const kind of ['high', 'healthyDependent']) for (const seed of SEEDS) {
  const a = simulateExperiment(createPatient(kind, seed), { ...BASE, peep: 8 }, { ...OPTS, recordTrajectory: true });
  const b = simulateExperiment(createPatient(kind, seed), { ...BASE, peep: 8, experiment: { drive: 'external' } }, { ...OPTS, recordTrajectory: true });
  const unitDiff = Math.max(...a.units.map((u, i) => Math.max(Math.abs(u.openEE - b.units[i].openEE), Math.abs(u.volumeEI - b.units[i].volumeEI))));
  const plDiff = Math.max(...b.trajectory.frames.map((fr, i) => Math.abs((fr.pressure - fr.meanPleural) - (a.trajectory.frames[i].pressure - a.trajectory.frames[i].meanPleural))));
  ext.push({ kind, seed, maxUnitDifference: unitDiff, maxTranspulmonaryFrameDifference: plDiff, airwayPplat: a.metrics.pplat, externalPplat: b.metrics.pplat, transrespDP: b.conditions.transrespDP, pExtEI: b.conditions.pExtEI });
}
raw.externalDrive = ext;
md.push('## 4. Negative-pressure external drive (ideal re-expression of the matched solve)', '', table(['kind', 'seed', 'max abs unit difference', 'max abs frame transpulmonary difference', 'airway pplat', 'external pplat', 'transresp dp', 'external EI pressure'], ext.map(e => [e.kind, String(e.seed), String(e.maxUnitDifference), String(e.maxTranspulmonaryFrameDifference), f(e.airwayPplat, 2), f(e.externalPplat, 2), f(e.transrespDP, 2), f(e.pExtEI, 2)])), '');

// 5. numerical resolution -------------------------------------------------------------------------------------------
const numeric = [];
const numericCases = [
  { label: 'high PEEP12 supine', kind: 'high', peep: 12, experiment: null },
  { label: 'high PEEP12 prone k=0.5', kind: 'high', peep: 12, experiment: { posture: 'prone' } },
  { label: 'high PEEP12 load 5', kind: 'high', peep: 12, experiment: { chestLoad: 5 } },
  { label: 'healthyDependent PEEP0', kind: 'healthyDependent', peep: 0, experiment: null },
  { label: 'healthyDependent PEEP5', kind: 'healthyDependent', peep: 5, experiment: null },
  { label: 'healthyDependent PEEP0 prone k=0.5', kind: 'healthyDependent', peep: 0, experiment: { posture: 'prone' } }
];
for (const c of numericCases) for (const seed of SEEDS) {
  const ref = run(createPatient(c.kind, seed), c.peep, c.experiment, { breaths: 10, dt: 0.1 });
  const fineDt = run(createPatient(c.kind, seed), c.peep, c.experiment, { breaths: 10, dt: 0.05 });
  const long = run(createPatient(c.kind, seed), c.peep, c.experiment, { breaths: 30, dt: 0.1 });
  numeric.push({ ...c, seed, ref, dtDifference: { openEE: fineDt.openEE - ref.openEE, eelv: fineDt.eelv - ref.eelv, pplat: fineDt.pplat - ref.pplat, closedPerfusion: fineDt.closedPerfusion - ref.closedPerfusion }, breathDifference: { openEE: long.openEE - ref.openEE, eelv: long.eelv - ref.eelv, pplat: long.pplat - ref.pplat, closedPerfusion: long.closedPerfusion - ref.closedPerfusion } });
}
raw.numerical = numeric;
md.push('## 5. Numerical resolution and dwell (difference from dt 0.1 s, 10 breaths; seeds 13791/4242/77)', '');
md.push(table(['case', 'dt 0.05: d aerated (min..max)', 'dt 0.05: d EELV mL', 'dt 0.05: d pplat', '30 breaths: d aerated (min..max)', '30 breaths: d EELV mL', '30 breaths: d pplat'], numericCases.map(c => {
  const r = numeric.filter(n => n.label === c.label);
  return [c.label, range(r.map(n => n.dtDifference.openEE), 5), range(r.map(n => n.dtDifference.eelv), 2), range(r.map(n => n.dtDifference.pplat), 3), range(r.map(n => n.breathDifference.openEE), 5), range(r.map(n => n.breathDifference.eelv), 2), range(r.map(n => n.breathDifference.pplat), 3)];
})), '');
md.push('Ten breaths and dt 0.1 s are not converged for every condition; the table is the measured size of that difference in this model.', '');

await mkdir(path.dirname(RAW), { recursive: true });
await mkdir(path.dirname(REPORT), { recursive: true });
await writeFile(RAW, JSON.stringify(raw) + '\n');
await writeFile(REPORT, md.join('\n') + '\n');
console.log(md.join('\n'));
console.log(`\nWrote ${RAW}\nWrote ${REPORT}`);
