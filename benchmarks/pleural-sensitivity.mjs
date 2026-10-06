// Numerical sensitivity of the bounded pressure-observable layer (src/pleural-readout.js).
//   node benchmarks/pleural-sensitivity.mjs
// Writes raw JSON (benchmarks/pleural-sensitivity.json) and a compact report (docs/PLEURAL_SENSITIVITY.md); both are gitignored.
// The numbers describe this uncalibrated educational model only; they are not validation and not clinical findings.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createPatient, regionalVolume, MODEL_INFO } from '../src/engine.js';
import { simulateExperiment } from '../src/experiments.js';
import { PLEURAL_READOUT_INFO, framePleural, pleuralField } from '../src/pleural-readout.js';

const RAW = fileURLToPath(new URL('./pleural-sensitivity.json', import.meta.url));
const REPORT = fileURLToPath(new URL('../docs/PLEURAL_SENSITIVITY.md', import.meta.url));
const KINDS = ['high', 'low', 'wall', 'healthy', 'healthyDependent'];
const SEEDS = [13791, 4242];
const BASE = { peep: 8, vt: 6, rr: 20, pressureLimit: 45 };
const OPTS = { breaths: 10, dt: 0.1 };
const DES = [0.5, 0.6, 0.65, 0.7, 0.8];
const OFFSETS = [-10, 0, 10];
const POSTURES = [
  { name: 'supine', experiment: {} },
  { name: 'prone k=0', experiment: { posture: 'prone', proneGradientFactor: 0 } },
  { name: 'prone k=0.5', experiment: { posture: 'prone', proneGradientFactor: 0.5 } },
  { name: 'prone k=1', experiment: { posture: 'prone', proneGradientFactor: 1 } }
];
const RATIO = 1.65, REFERENCE_TP = MODEL_INFO.referenceTranspulmonaryPressure;
const THRESHOLDS = [1.5, 1.65, 1.8], PEEPS = [8, 12, 16], VTS = [6, 8];
const PERCENTILES = [0.05, 0.25, 0.5, 0.75, 0.95];

const f = (x, d = 3) => x == null ? 'n/a' : typeof x === 'boolean' ? String(x) : (Number(x) + 0).toFixed(d);
const pct = x => `${(100 * x).toFixed(1)}%`;
const lohi = (a, d = 2) => { const lo = Math.min(...a), hi = Math.max(...a); return f(lo, d) === f(hi, d) ? f(lo, d) : `${f(lo, d)}..${f(hi, d)}`; };
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');
const sci = x => Number(x).toExponential(1);

const raw = { schema: 'pleural-sensitivity/1', generatedAt: new Date().toISOString(), node: process.version, modelVersion: MODEL_INFO.version, readoutInfo: PLEURAL_READOUT_INFO, base: BASE, options: OPTS, seeds: SEEDS };
const md = [];

// 1. Pes surrogate sample coordinate and offset -----------------------------------------------------------------
const verification = { maxAnalyticDeviation: 0, maxEeVsEiDeviation: 0, maxSwingDeviation: 0, maxPlSwingDeviation: 0, maxOffsetDeviation: 0, maxPlSignDeviation: 0, maxPawSumDeviation: 0 };
const track = (key, value) => { verification[key] = Math.max(verification[key], Math.abs(value)); };
const cells = [], geometry = [];
for (const kind of KINDS) for (const seed of SEEDS) for (const posture of POSTURES) {
  const result = simulateExperiment(createPatient(kind, seed), { ...BASE, experiment: posture.experiment }, { ...OPTS, recordTrajectory: true, recordPleuralField: true });
  const t = result.trajectory, ee = t.frames[0], ei = t.frames[t.eiIndex], reference = pleuralField(t, result.units);
  geometry.push({ kind, seed, posture: posture.name, gradient: reference.gradient, depMean: reference.depMean, depMin: reference.depMin, depMax: reference.depMax });
  for (const dEs of DES) {
    const zeroOffset = framePleural(ee, pleuralField(t, result.units, { esophagealDependency: dEs, pesOffset: 0 })).pesModel - ee.meanPleural;
    for (const offset of OFFSETS) {
      const field = pleuralField(t, result.units, { esophagealDependency: dEs, pesOffset: offset });
      const a = framePleural(ee, field), b = framePleural(ei, field);
      const pesMeanEE = a.pesModel - ee.meanPleural, pesMeanEI = b.pesModel - ei.meanPleural;
      const plMeanDiffEE = a.plEs - a.plMean, plMeanDiffEI = b.plEs - b.plMean;
      track('maxAnalyticDeviation', pesMeanEE - (field.gradient * (dEs - field.depMean) + offset));
      track('maxEeVsEiDeviation', pesMeanEE - pesMeanEI);
      track('maxSwingDeviation', (b.pesModel - a.pesModel) - (ei.meanPleural - ee.meanPleural));
      track('maxPlSwingDeviation', (b.plEs - a.plEs) - (b.plMean - a.plMean));
      track('maxPlSignDeviation', plMeanDiffEE + pesMeanEE);
      track('maxPawSumDeviation', a.plEs + a.pesModel - ee.pressure);
      track('maxOffsetDeviation', pesMeanEE - zeroOffset - offset);
      cells.push({ kind, seed, posture: posture.name, dEs, offset, gradient: field.gradient, depMean: field.depMean, pesMinusMeanEE: pesMeanEE, pesMinusMeanEI: pesMeanEI, plEsMinusPlMeanEE: plMeanDiffEE, plEsMinusPlMeanEI: plMeanDiffEI, pesSwing: b.pesModel - a.pesModel, meanPplSwing: ei.meanPleural - ee.meanPleural, plEsEE: a.plEs, plEsEI: b.plEs, plMeanEE: a.plMean, plMeanEI: b.plMean });
    }
  }
}
for (const [key, value] of Object.entries(verification)) assert.ok(value < 1e-9, `${key} ${value}`);
raw.pes = { dEs: DES, offsets: OFFSETS, postures: POSTURES, verification, geometry, cells };

md.push('# Pleural pressure-observable sensitivity', '',
  'Generated by `node benchmarks/pleural-sensitivity.mjs`. Numbers describe the uncalibrated educational model only. They are not validation, not clinical findings, and not a treatment recommendation.', '',
  `Common setup: PEEP ${BASE.peep}, VT ${BASE.vt} mL/kg PBW, RR ${BASE.rr}, pressure limit ${BASE.pressureLimit}, ${OPTS.breaths} breaths, dt ${OPTS.dt} s, 512 units, seeds ${SEEDS.join('/')}, fresh patient per run (no carried state). Phenotypes: ${KINDS.join(', ')}.`, '',
  '## 1. Esophageal surrogate sample coordinate and offset', '',
  `Model Pes is the local pleural pressure at an assumed dependency coordinate dEs plus an assumed offset: Pes = Ppl(dEs) + offset, Ppl(d) = meanPpl + g (d - depMean). Defaults dEs ${PLEURAL_READOUT_INFO.esophagealDependency}, offset ${PLEURAL_READOUT_INFO.offset}, offset range ${PLEURAL_READOUT_INFO.offsetRange.join('..')}. dEs is a sample point on the model's fixed anatomical dependency coordinate (0 ventral, 1 dorsal). It is a geometry choice of this model, not an actual-balloon prediction: no balloon mechanics, esophageal wall, cardiac artifact or measurement process is modeled.`, '',
  `Verified over ${cells.length} cells (dEs x offset x posture x phenotype x seed):`, '',
  table(['Check', 'Max absolute deviation'], [
    ['Pes - meanPpl equals g(dEs - depMean) + offset analytically', sci(verification.maxAnalyticDeviation)],
    ['Pes - meanPpl at EE equals value at EI (constant in the breath)', sci(verification.maxEeVsEiDeviation)],
    ['EE->EI Pes swing minus mean-Ppl swing (pressure EOEI swing difference)', sci(verification.maxSwingDeviation)],
    ['EE->EI PLes swing minus PLmean swing', sci(verification.maxPlSwingDeviation)],
    ['(PLes - PLmean) + (Pes - meanPpl)', sci(verification.maxPlSignDeviation)],
    ['PLes + Pes - Paw', sci(verification.maxPawSumDeviation)],
    ['Offset +/-10 changes Pes - meanPpl by exactly the offset', sci(verification.maxOffsetDeviation)]
  ]), '',
  'Because the pleural gradient is linear in dependency and constant within a run, Pes - mean Ppl does not change between EE and EI: the surrogate tidal swing equals the tissue-weighted mean-Ppl swing for every dEs and offset. dEs and offset therefore shift the absolute surrogate level only. This is a limitation of the model, not a finding.', '',
  'PLes - PLmean = -(Pes - meanPpl) exactly. A nonzero offset shifts Pes by +offset and PLes by -offset at every frame (offset -10 / +10 verified above).', '',
  '### Pes - mean Ppl (cmH2O), offset 0, EE (identical at EI), range across seeds', '');
{
  const rows = [];
  for (const kind of KINDS) for (const posture of POSTURES) {
    const sel = cells.filter(c => c.kind === kind && c.posture === posture.name && c.offset === 0), geo = geometry.filter(g => g.kind === kind && g.posture === posture.name);
    rows.push([kind, posture.name, lohi(geo.map(g => g.gradient)), lohi(geo.map(g => g.depMean), 3), ...DES.map(d => lohi(sel.filter(c => c.dEs === d).map(c => c.pesMinusMeanEE)))]);
  }
  md.push(table(['Phenotype', 'Posture', 'g (cmH2O)', 'depMean', ...DES.map(d => `dEs ${d}`)], rows), '',
    'The tissue-weighted mean dependency is near 0.5; a supine dEs above it samples the dependent side (Pes above mean Ppl for a positive gradient). In prone cases the gradient is mirrored and flattened, so the same dEs gives a value on the other side of mean Ppl (k=0 removes the gradient and leaves only the offset). Offsets of +/-10 add exactly +/-10 to every entry.', '');
}

// 2. Analytic 1.65 crossing-pressure distribution ----------------------------------------------------------------
// ratio(tp) = (rest + cap*tp/(s+tp)) / (rest + cap*5/(s+5)) (weight cancels). ratio = R needs a = (R*V5 - rest)/cap < 1.
const crossing = (u, ratio) => {
  const v5 = u.rest + u.capacity * REFERENCE_TP / (u.stiffness + REFERENCE_TP), a = (ratio * v5 - u.rest) / u.capacity;
  if (!(a < 1)) return null;
  return a <= 0 ? 0 : u.stiffness * a / (1 - a);
};
const weightedPercentile = (sorted, totalWeight, q) => { let cum = 0; for (const s of sorted) { cum += s.weight; if (cum >= q * totalWeight - 1e-15) return s.tp; } return sorted.at(-1).tp; };
let maxInversion = 0;
const crossings = [];
for (const kind of KINDS) for (const seed of SEEDS) {
  const patient = createPatient(kind, seed), reachable = [];
  let unreachable = 0, unreachableCount = 0, total = 0;
  for (const u of patient.units) {
    total += u.weight;
    const tp = crossing(u, RATIO);
    if (tp == null) { unreachable += u.weight; unreachableCount++; continue; }
    const check = regionalVolume(u, tp) / regionalVolume(u, REFERENCE_TP);
    maxInversion = Math.max(maxInversion, Math.abs(check - RATIO));
    reachable.push({ tp, weight: u.weight });
  }
  reachable.sort((a, b) => a.tp - b.tp);
  const reachableWeight = reachable.reduce((s, r) => s + r.weight, 0);
  crossings.push({ kind, seed, units: patient.units.length, reachableCount: reachable.length, unreachableCount, unreachableWeightFraction: unreachable / total, min: reachable[0]?.tp ?? null, max: reachable.at(-1)?.tp ?? null, percentiles: Object.fromEntries(PERCENTILES.map(q => [`p${100 * q}`, reachable.length ? weightedPercentile(reachable, reachableWeight, q) : null])) });
}
assert.ok(maxInversion < 1e-9, `analytic inversion deviation ${maxInversion}`);
raw.crossing = { ratio: RATIO, referenceTranspulmonaryPressure: REFERENCE_TP, maxInversionDeviation: maxInversion, rows: crossings };
md.push(`## 2. Regional TP at which the Vopen/Vopen(TP=${REFERENCE_TP}) ratio crosses ${RATIO}`, '',
  `For each unit the saturating law gives ratio(TP) = (rest + cap TP/(s + TP)) / (rest + cap ${REFERENCE_TP}/(s + ${REFERENCE_TP})); the tissue weight cancels. Setting ratio = ${RATIO} and inverting analytically gives TP = s a/(1 - a) with a = (${RATIO} V${REFERENCE_TP} - rest)/cap. When a >= 1 the ratio only approaches its asymptote and the crossing is unreachable at any finite TP. Inversion was verified against regionalVolume (max |ratio - ${RATIO}| = ${sci(maxInversion)}). Percentiles are tissue-weighted over reachable units. TP is regional transpulmonary pressure (Paw - local Ppl); the airway pressure needed in a given unit is TP plus that unit's Ppl.`, '',
  table(['Phenotype', 'Seed', 'Unreachable units', 'Unreachable tissue', 'min TP', 'P5', 'P25', 'P50', 'P75', 'P95', 'max TP'],
    crossings.map(c => [c.kind, c.seed, `${c.unreachableCount}/${c.units}`, pct(c.unreachableWeightFraction), f(c.min, 1), ...PERCENTILES.map(q => f(c.percentiles[`p${100 * q}`], 1)), f(c.max, 1)])), '');

// 3. Over-weighted aerated fraction at EI -------------------------------------------------------------------------
const exposure = [];
let maxOverDeviation = 0;
for (const kind of KINDS) for (const peep of PEEPS) for (const vt of VTS) for (const seed of SEEDS) {
  const result = simulateExperiment(createPatient(kind, seed), { ...BASE, peep, vt }, { ...OPTS, recordTrajectory: true });
  const t = result.trajectory, ei = t.frames[t.eiIndex], overweight = {};
  for (const thr of THRESHOLDS) { let s = 0; result.units.forEach((u, i) => { if (ei.unitRatio[i] > thr) s += u.weight * ei.unitOpen[i]; }); overweight[thr] = s; }
  maxOverDeviation = Math.max(maxOverDeviation, Math.abs(overweight[RATIO] - result.metrics.over));
  exposure.push({ kind, peep, vt, seed, overweight, openEI: result.metrics.openEI, pplat: result.metrics.pplat, limited: result.metrics.limited, vtDelivered: result.metrics.vtDelivered });
}
assert.ok(maxOverDeviation < 1e-12, `over mismatch ${maxOverDeviation}`);
raw.exposure = { thresholds: THRESHOLDS, peeps: PEEPS, vts: VTS, maxEngineOverDeviation: maxOverDeviation, rows: exposure };
md.push('## 3. Over-weighted aerated fraction f at EI by threshold', '',
  `Over-weighted f = sum of tissue weight x recruitment fraction f over units whose stored EI ratio Vopen(EI)/Vopen(TP=${REFERENCE_TP}) exceeds the threshold. At ${RATIO} it reproduces the engine metric \`over\` (max deviation ${sci(maxOverDeviation)}). Thresholds ${THRESHOLDS.join('/')} are arbitrary volume-ratio thresholds of this model. They are regional Vopen(EI)/Vopen(TP=${REFERENCE_TP}) ratios, not a global VT/FRC strain, so no numeric cutoff here compares directly with a published strain threshold or with any outcome study. This is a single-breath-state exposure indicator at the final EI; there is no injury classifier and no accumulation over time. Each cell lists seeds ${SEEDS.join(' / ')} (percent of total tissue); runs use VT mL/kg PBW as given and the default 45 cmH2O pressure limit.`, '',
  table(['Phenotype', 'PEEP', 'VT', ...THRESHOLDS.map(t => `f > ${t}`), 'Aerated at EI', 'Pplat', 'Limited'],
    KINDS.flatMap(kind => PEEPS.flatMap(peep => VTS.map(vt => {
      const rows = exposure.filter(e => e.kind === kind && e.peep === peep && e.vt === vt);
      return [kind, peep, vt, ...THRESHOLDS.map(t => rows.map(r => (100 * r.overweight[t]).toFixed(1)).join(' / ')), rows.map(r => (100 * r.openEI).toFixed(1)).join(' / '), rows.map(r => f(r.pplat, 1)).join(' / '), rows.map(r => r.limited ? 'yes' : 'no').join(' / ')];
    })))), '',
  '## Scope and limits', '',
  '- The pleural field is the model\'s exact local relation Ppl(d) = meanPpl + g (d - depMean) over a fixed anatomical dependency coordinate; regional map locations are schematic.',
  '- Pes is a model sample point plus an assumed offset, not a prediction of any esophageal balloon reading; PLes = Paw - Pes is not alveolar transpulmonary pressure during flow.',
  '- Because the gradient is linear, the Pes tidal swing equals the mean-Ppl swing for any dEs.',
  '- No clinical calibration, no validated threshold, no treatment guidance.', '');

await mkdir(path.dirname(RAW), { recursive: true });
await mkdir(path.dirname(REPORT), { recursive: true });
await writeFile(RAW, JSON.stringify(raw, null, 2) + '\n');
await writeFile(REPORT, md.join('\n') + '\n');
console.log(JSON.stringify({ raw: RAW, report: REPORT, pesCells: cells.length, verification, maxInversion, maxOverDeviation, exposureRows: exposure.length }, null, 2));
