import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createPatient, simulate, sweep, MODEL_INFO, PARAMETER_TABLE } from '../src/engine.js';

const settings = { peep: 12, vt: 6, rr: 20, pressureLimit: 45 };
const quantile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b), position = (sorted.length - 1) * q;
  const lower = Math.floor(position), upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
};
const describe = values => {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return { mean, sampleSD: Math.sqrt(values.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (values.length - 1)), min: Math.min(...values), max: Math.max(...values) };
};
const timings = [];
for (const count of [128, 512, 2048]) {
  const run = () => simulate(createPatient('high', 13791, count), settings, { breaths: 10, dt: 0.1 });
  for (let i = 0; i < 5; i++) run();
  const samplesMs = [];
  for (let i = 0; i < 21; i++) { const start = performance.now(); run(); samplesMs.push(performance.now() - start); }
  timings.push({ count, warmup: 5, repetitions: 21, samplesMs, p50Ms: quantile(samplesMs, 0.5), p95Ms: quantile(samplesMs, 0.95), workload: 'Create fresh seeded high-recruitability patient and simulate 10 breaths (30 simulated seconds), dt=0.1 s.' });
}
const sweepSamplesMs = [];
for (let i = 0; i < 2; i++) sweep(createPatient(), settings);
for (let i = 0; i < 7; i++) { const start = performance.now(); sweep(createPatient(), settings); sweepSamplesMs.push(performance.now() - start); }
const timestepRuns = [0.1, 0.05, 0.025, 0.0125].map(dt => ({ dt, metrics: simulate(createPatient('high'), settings, { dt }).metrics }));
const reference = timestepRuns.at(-1).metrics;
const timestepConvergence = timestepRuns.slice(0, -1).map(run => ({ dt: run.dt, pplatRelativeDifferencePercent: 100 * Math.abs(run.metrics.pplat - reference.pplat) / reference.pplat, eelvRelativeDifferencePercent: 100 * Math.abs(run.metrics.eelv - reference.eelv) / reference.eelv, openEEAbsoluteDifference: Math.abs(run.metrics.openEE - reference.openEE), openEERelativeDifferencePercent: 100 * Math.abs(run.metrics.openEE - reference.openEE) / reference.openEE, highStrainFractionAbsoluteDifference: Math.abs(run.metrics.over - reference.over) }));
const seeds = [17, 31, 53, 79, 101, 211, 397, 733, 1193, 13791];
const seedRuns = seeds.map(seed => ({ seed, metrics: simulate(createPatient('high', seed), settings).metrics }));
const seedVariability = Object.fromEntries(['openEE', 'pplat', 'eelv', 'over'].map(key => [key, describe(seedRuns.map(run => run.metrics[key]))]));
const resolutionRuns = [128, 512, 2048].map(count => ({ count, seeds: seeds.map(seed => ({ seed, metrics: simulate(createPatient('high', seed, count), settings).metrics })) }));
const resolutionSummary = resolutionRuns.map(run => ({ count: run.count, openEE: describe(run.seeds.map(row => row.metrics.openEE)), pplat: describe(run.seeds.map(row => row.metrics.pplat)) }));
const recruitmentResponse = seeds.map(seed => {
  const path = kind => sweep(createPatient(kind, seed), settings, { peeps: [4, 8, 12, 16, 20] }).ascending;
  const high = path('high'), low = path('low');
  return { seed, highOpenEEGain: high.at(-1).openEE - high[0].openEE, lowOpenEEGain: low.at(-1).openEE - low[0].openEE, high, low };
});
const result = {
  generatedAt: new Date().toISOString(),
  environment: { node: process.version, v8: process.versions.v8, platform: process.platform, architecture: process.arch, cpu: os.cpus()[0]?.model, logicalCPUCount: os.cpus().length, totalMemoryBytes: os.totalmem(), operatingSystem: `${os.type()} ${os.release()}` },
  scope: 'Node.js on this host, no browser timing claim. Pure-model runtime includes patient creation. JIT warmed; no manual GC, samples retain ordinary scheduling/GC variability. Other simulators with different step sizes, equations, and model counts are not equal-workload comparisons.',
  settings, modelVersion: MODEL_INFO.version, parameterRegimes: PARAMETER_TABLE,
  simulationTimings: timings,
  standardizedSweepTiming: { count: 512, warmup: 2, repetitions: 7, samplesMs: sweepSamplesMs, p50Ms: quantile(sweepSamplesMs, 0.5), p95Ms: quantile(sweepSamplesMs, 0.95), workload: '11 PEEP steps ascending then 11 descending, 10 breaths/step, fresh seeded initial state, dt=0.1 s' },
  timestepRuns, timestepConvergence, timestepReference: 'dt=0.0125 s; refinement evidence, not proof of exact solution',
  seedRuns, seedVariability, resolutionRuns, resolutionSummary,
  resolutionInterpretation: 'Unit count changes stochastic sampling. Reported across-seed means and SD distinguish sample variation from timestep error; no deterministic mesh-convergence claim.',
  recruitmentResponse, calibration: MODEL_INFO.calibration,
  interpretation: 'Recruitment response is measured from simulated paths. Phenotype opening-threshold distributions were chosen to illustrate differing recruitability and are not clinical calibration. Hard high-strain cutoff causes greater numerical sensitivity than smooth mechanics.'
};
const output = fileURLToPath(new URL('./results-engine.json', import.meta.url));
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ output, simulationTimings: timings.map(({ count, p50Ms, p95Ms }) => ({ count, p50Ms, p95Ms })), sweepP50Ms: result.standardizedSweepTiming.p50Ms, sweepP95Ms: result.standardizedSweepTiming.p95Ms, timestepConvergence, seedVariability, resolutionSummary }, null, 2));
