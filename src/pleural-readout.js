/*
 * Bounded pressure-observable layer (educational, uncalibrated). Pure functions over recorded trajectory frames.
 * Regional pleural pressure is the model's exact local field Ppl(d) = meanPpl + g*(d - depMean), where d is the fixed
 * anatomical dependency coordinate (0 ventral .. 1 dorsal) and g the patient pleural gradient. See docs/PLEURAL_MODEL_SPEC.md.
 */
export const PLEURAL_READOUT_INFO = Object.freeze({
  version: 1,
  name: 'Esophageal surrogate (model): pleural pressure sampled at an assumed dependency coordinate',
  esophagealDependency: 0.65,
  offset: 0,
  offsetRange: Object.freeze([-10, 10]),
  calibration: 'Uncalibrated surrogate. The sample coordinate and offset are assumptions; no balloon mechanics, esophageal wall, cardiac artifact or measurement process is modeled.',
  limitation: 'The pleural gradient is linear in dependency, so the modeled surrogate swing equals the tissue-weighted mean pleural swing for every sample coordinate.'
});

const WEIGHT_SUM_TOLERANCE = 1e-9;
const DEPENDENCY_MEAN_TOLERANCE = 1e-12;
const isNum = x => typeof x === 'number' && Number.isFinite(x);
const isUnit = x => isNum(x) && x >= 0 && x <= 1;

/**
 * Validated per-trajectory pleural field, or null when the trajectory carries no pleural metadata.
 * `units` supplies tissue weights and dependency; the stored mean dependency is verified, never recomputed.
 */
export function pleuralField(trajectory, units, { esophagealDependency = PLEURAL_READOUT_INFO.esophagealDependency, pesOffset = PLEURAL_READOUT_INFO.offset } = {}) {
  const meta = trajectory?.pleural;
  if (meta == null) return null;
  if (typeof meta !== 'object' || !isNum(meta.gradient) || !isNum(meta.depMean) || !isUnit(meta.depMean)) throw new RangeError('pleural metadata needs a finite gradient and depMean within 0..1');
  if (!Array.isArray(units) || units.length === 0) throw new TypeError('units must be a non-empty array of {weight, dep}');
  if (!isUnit(esophagealDependency)) throw new RangeError('esophagealDependency must be a finite number within 0..1');
  const [lo, hi] = PLEURAL_READOUT_INFO.offsetRange;
  if (!isNum(pesOffset) || pesOffset < lo || pesOffset > hi) throw new RangeError(`pesOffset must be a finite number within ${lo}..${hi}`);
  let weightSum = 0, meanD = 0, depMin = Infinity, depMax = -Infinity;
  for (const u of units) {
    if (u == null || !isNum(u.weight) || !(u.weight > 0)) throw new RangeError('unit weights must be finite and positive');
    if (!isUnit(u.dep)) throw new RangeError('unit dependency must be finite within 0..1');
    weightSum += u.weight; meanD += u.weight * u.dep;
    if (u.dep < depMin) depMin = u.dep;
    if (u.dep > depMax) depMax = u.dep;
  }
  if (Math.abs(weightSum - 1) > WEIGHT_SUM_TOLERANCE) throw new RangeError('unit weights must sum to 1');
  if (Math.abs(meanD - meta.depMean) > DEPENDENCY_MEAN_TOLERANCE) throw new RangeError('unit dependency mean does not match pleural metadata');
  const frames = trajectory.frames;
  if (Array.isArray(frames)) for (const frame of frames) if (frame?.unitVolume?.length !== units.length) throw new RangeError('units length must match frame.unitVolume');
  return { gradient: meta.gradient, depMean: meta.depMean, depMin, depMax, dEs: esophagealDependency, offset: pesOffset };
}

/**
 * Scalar pressure observables for one frame. Pes is a model sample, not a balloon measurement; plEs = Paw - Pes
 * and is not alveolar transpulmonary pressure during flow. Allocates no per-unit arrays; never mutates inputs.
 */
export function framePleural(frame, field) {
  if (field == null) return null;
  if (frame == null || !isNum(frame.pressure) || !isNum(frame.meanPleural)) throw new TypeError('frame needs finite pressure and meanPleural');
  if (typeof field !== 'object') throw new TypeError('field must come from pleuralField');
  const { gradient, depMean, depMin, depMax, dEs, offset } = field;
  if (![gradient, depMean, depMin, depMax, dEs, offset].every(isNum) || !isUnit(dEs) || !isUnit(depMean)) throw new RangeError('field values must be finite with dependency coordinates within 0..1');
  const paw = frame.pressure, meanPpl = frame.meanPleural;
  const pplAt = d => {
    if (!isUnit(d)) throw new RangeError('dependency coordinate must be a finite number within 0..1');
    return meanPpl + gradient * (d - depMean);
  };
  const pplVentral = pplAt(0), pplDorsal = pplAt(1), pesModel = pplAt(dEs) + offset;
  return {
    pplVentral, pplDorsal, pesModel,
    plEs: paw - pesModel, plMean: paw - meanPpl, plVentral: paw - pplVentral, plDorsal: paw - pplDorsal,
    assumedGradient: gradient, pplAt
  };
}
