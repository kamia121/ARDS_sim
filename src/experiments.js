import { createPatient, simulate, sweep } from './engine.js';

/** Illustrative, uncalibrated experiment transforms applied to a clone of the patient; see docs/EXPERIMENT_MODEL_SPEC.md. */
export const DEFAULT_EXPERIMENT = Object.freeze({ drive: 'airway', posture: 'supine', chestLoad: 0, proneGradientFactor: 0.5 });
const KEYS = Object.keys(DEFAULT_EXPERIMENT);
export const MAX_CHEST_LOAD = 15;

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function normalizeExperiment(experiment) {
  if (experiment == null) return { ...DEFAULT_EXPERIMENT };
  if (!isPlainObject(experiment)) throw new TypeError('experiment must be an object');
  const unknown = Object.keys(experiment).filter(key => !KEYS.includes(key));
  if (unknown.length) throw new RangeError(`Unknown experiment field: ${unknown.join(', ')}`);
  const e = { ...DEFAULT_EXPERIMENT };
  for (const key of KEYS) if (experiment[key] !== undefined) e[key] = experiment[key];
  if (e.drive !== 'airway' && e.drive !== 'external') throw new RangeError("experiment.drive must be 'airway' or 'external'");
  if (e.posture !== 'supine' && e.posture !== 'prone') throw new RangeError("experiment.posture must be 'supine' or 'prone'");
  for (const [key, max] of [['chestLoad', MAX_CHEST_LOAD], ['proneGradientFactor', 1]]) {
    if (typeof e[key] !== 'number' || !Number.isFinite(e[key]) || e[key] < 0 || e[key] > max) throw new RangeError(`experiment.${key} must be a finite number 0..${max}`);
  }
  return e;
}

// proneGradientFactor has no effect while supine, so it does not make an experiment non-default.
export const isDefaultExperiment = experiment => {
  const e = normalizeExperiment(experiment);
  return e.drive === 'airway' && e.posture === 'supine' && e.chestLoad === 0;
};

/** Settings without the experiment field; returns the same object when it has none. */
export function withoutExperiment(settings) {
  if (settings == null || !Object.hasOwn(settings, 'experiment')) return settings;
  const { experiment, ...rest } = settings;
  return rest;
}

/** Pure: returns a transformed deep clone and never mutates the supplied patient. */
export function applyExperiment(patient, experiment) {
  const e = normalizeExperiment(experiment), clone = structuredClone(patient);
  clone.baselinePleural += e.chestLoad;
  if (e.posture === 'prone') {
    const g = patient.pleuralGradient, k = e.proneGradientFactor;
    let meanDep = 0;
    for (const u of patient.units) meanDep += u.weight * u.dep;
    clone.pleuralGradient = -k * g;
    clone.baselinePleural += (1 + k) * g * meanDep;
  }
  return clone;
}

function describe(e, ventSettings, result, translate) {
  const m = result.metrics, pplat = m.pplat, peep = ventSettings.peep;
  return {
    drive: e.drive, posture: e.posture, chestLoad: e.chestLoad, gradientFactor: e.proneGradientFactor, experiment: e,
    pExtEE: translate ? -peep : 0, pExtEI: translate ? -pplat : 0,
    airwayEE: translate ? 0 : peep, airwayEI: translate ? 0 : pplat,
    transrespDP: m.dp, transrespCrs: m.crs,
    maxDrivePressure: result.maxPressure, drivePressureLimit: result.settings.pressureLimit,
    limitNote: 'The pressure limit applies to the effective drive (default 45 cmH2O); it is not a calibrated tank-ventilator limit.'
  };
}

export function simulateExperiment(patient, settings = {}, options = {}) {
  const e = normalizeExperiment(settings?.experiment), vent = withoutExperiment(settings);
  if (isDefaultExperiment(e)) return simulate(patient, vent, options);
  const clone = applyExperiment(patient, e), result = simulate(clone, vent, options);
  patient.units.forEach((u, i) => { u.f = clone.units[i].f; });
  patient.elapsed = clone.elapsed; patient.breaths = clone.breaths;
  const external = e.drive === 'external';
  result.conditions = describe(e, result.settings, result, external);
  result.settings = { ...result.settings, experiment: { ...e } };
  if (result.trajectory) {
    for (const frame of result.trajectory.frames) {
      const pressure = frame.pressure;
      if (external) { frame.pressure = 0; frame.meanPleural -= pressure; frame.externalPressure = -pressure; frame.transrespPressure = pressure; }
      else { frame.externalPressure = 0; frame.transrespPressure = pressure; }
    }
  }
  if (external) {
    const m = result.metrics, peep = result.settings.peep, ei = m.pplat;
    m.meanPleuralEE -= peep; m.meanPleuralEI -= ei;
    m.pplat = 0; m.dp = 0; m.crs = null;
    result.pv = result.pv.map(point => ({ volume: point.volume, pressure: 0, phase: point.phase, transresp: point.pressure }));
  }
  return result;
}

export function sweepExperiment(patient, settings = {}, options = {}) {
  const e = normalizeExperiment(settings?.experiment), vent = withoutExperiment(settings);
  if (isDefaultExperiment(e)) return sweep(patient, vent, options);
  if (e.drive === 'external') throw new RangeError('External-drive experiments are not available for PEEP sweeps in this release');
  const { peeps = [4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24], breaths = 10, dt = 0.1, initialState = 'fresh' } = options;
  if (!Array.isArray(peeps) || peeps.length < 2 || peeps.some(p => !Number.isFinite(p))) throw new RangeError('Supply at least two finite PEEP values');
  const ascendingPeeps = [...new Set(peeps)].sort((a, b) => a - b);
  if (ascendingPeeps.length < 2) throw new RangeError('Supply at least two distinct PEEP values');
  if (!['fresh', 'current'].includes(initialState)) throw new RangeError('initialState must be fresh or current');
  const working = initialState === 'current' ? structuredClone(patient) : createPatient(patient.kind, patient.seed, patient.count, patient.pbw);
  const run = peep => ({ peep, ...simulateExperiment(working, { ...vent, peep, experiment: e }, { breaths, dt }).metrics });
  const ascending = ascendingPeeps.map(run), descending = [...ascendingPeeps].reverse().map(run);
  return { ascending, descending, breathsPerStep: breaths, dt, initialStateSource: initialState === 'fresh' ? 'Fresh seeded patient; sequential ascending then descending path' : 'Clone of supplied current state; sequential ascending then descending path', experiment: { ...e } };
}
