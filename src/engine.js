/** Educational passive, quasi-static adult lung model. No clinical calibration. */
export const PARAMETER_TABLE = {
  high: { capacity: 4600, rest: 900, stiffness: 17, pleural: 2, gradient: 5, ew: 0.006, reference: 1200, initial: 0.38 },
  low: { capacity: 4600, rest: 900, stiffness: 17, pleural: 2, gradient: 5, ew: 0.006, reference: 1200, initial: 0.38 },
  wall: { capacity: 4600, rest: 900, stiffness: 17, pleural: 7, gradient: 5, ew: 0.013, reference: 1200, initial: 0.38 },
  healthy: { capacity: 3000, rest: 1500, stiffness: 12, pleural: 0.5, gradient: 2, ew: 0.01, reference: 2000, initial: 0.995 },
  healthyDependent: { capacity: 3000, rest: 1500, stiffness: 12, pleural: 0.5, gradient: 2, ew: 0.01, reference: 2000, initial: 0.995 }
};
const PARAMETERS = PARAMETER_TABLE;
export const MODEL_INFO = Object.freeze({
  name: 'Reduced adult regional lung model', version: '1.1.0',
  parameterRegimes: PARAMETER_TABLE,
  calibration: 'No adult CT, EIT, pressure-volume, recruitment, or outcome datasets were used for calibration or validation.',
  distributions: { dependency: 'Uniform [0,1]; fixed anatomical dorsal coordinate, initially supine-dependent', rawWeight: 'Uniform [0.7,1.3], normalized to total 1', capacityMultiplier: 'Uniform [0.75,1.25]', stiffnessMultiplier: 'Uniform [0.8,1.2]', difficultFraction: 'high/wall 0.08; low 0.68; healthy/healthyDependent 0', openingThreshold: 'ARDS ordinary:6+15U+6dependency; difficult:38+20U; healthy:0.3+3U', closingThreshold: 'ARDS:0.5+6U+3dependency; healthy:-3+2U; constrained below opening threshold by at least0.5', openingTau: '0.35+1.2U seconds', closingTau: '1.3+3U seconds', recruitmentRate: 'threshold excess/(3+excess)/tau', initialRecruitment: 'ARDS:clamp(0.38+0.4*(0.5-dependency)+0.1*(U-0.5),0,1); healthy:0.995', perfusionWeight: 'tissueWeight*(0.5+dependency)', bodySize: 'Volumes and chest-wall reference scale with PBW/70; wall elastance scales inversely', healthyDependentAdjustment: 'Same parameters and random draw sequence as healthy, then deterministic s=max(0,(dependency-0.6)/0.4): f=0.995-0.6s; openingThreshold+=1*s; closingThreshold=min(adjusted openingThreshold-0.5, healthy closingThreshold+3.5s)', random: 'Mulberry32 seeded pseudo-random samples; sequential Monte Carlo units' },
  purpose: 'Illustrative mechanics and pressure/time-dependent recruitment; not a clinical predictor or ventilator recommendation.',
  units: { pressure: 'cmH2O', volume: 'mL', time: 's', elastance: 'cmH2O/mL', vt: 'mL/kg predicted body weight' },
  assumptions: [
    'Passive patient; uniform airway pressure; no airway resistance, inertance, flow limitation, spontaneous effort, gas exchange, or vascular dynamics.',
    'Each regional unit represents a weighted tissue fraction; fractional recruitment f persists between calls. Functional aerated fractions are tissue-weighted, not unit counts.',
    'Regional transpulmonary pressure equals airway pressure minus baseline pleural pressure, a schematic pleural gradient across the fixed dorsal coordinate, and chest-wall elastance times gas volume above an explicitly assumed reference volume.',
    'Open-unit gas volume is weight times [rest volume + capacity*positive(TP)/(stiffness+positive(TP))]. This saturating law has decreasing compliance at positive TP; negative TP retains the assumed residual open-unit gas volume.',
    'Opening occurs only above popen; closure only below pclose. Distinct thresholds and finite first-order rates create pressure/time hysteresis. Rates approach inverse opening/closure time constants with increasing threshold excess.',
    'Volume control uses a prescribed linear inspiratory volume ramp over one-third of the cycle. Expiration is represented by instantaneous pressure reduction to PEEP followed by pressure-controlled state evolution; plotted PV curves are quasi-static paths, not realistic dynamic waveforms.',
    'Volume-control pressure is solved with recruitment coupled to the timestep. PEEP is the inspiratory pressure floor. A pressure ceiling explicitly reduces delivered volume whenever the target cannot be attained.',
    'The distension proxy is based on an assumed fully open regional gas-volume ratio Vopen(EI)/Vopen(TP=5) above 1.65. Its reference is the same fully open region at TP=5 cmH2O, not FRC or the end-expiratory volume; this is not VT/FRC and is not a validated overdistension or injury threshold.',
    'Closed perfusion is a perfusion-weighted closed tissue fraction proxy using a fixed anatomical dorsal weighting; it does not reverse with posture and is not a clinical shunt fraction.',
    'Phenotypes are illustrative parameter regimes with seeded heterogeneity, not fitted adult clinical cohorts; no outcomes or sweep trends are prescribed.',
    'An optional linearCompliance field and fixedOpen recruitment flag exist solely for analytic numerical verification; default phenotypes use the nonlinear model.',
    'No surface-tension energy balance, recruitment energy, airway network, regional interactions beyond common chest-wall recoil, or patient-specific calibration of chest-wall reference volume is modeled.',
    'The healthyDependent kind is an illustrative dependent-region variant of healthy: identical parameters and random draws, with the most dependent tissue (dependency above 0.6) given lower initial aeration and higher opening/closing thresholds. Its adjustment constants are assumed, not fitted to any clinical data, and do not claim that every healthy lung has partly closed dependent regions.',
    'Optional experiments (src/experiments.js) transform a clone of the patient: a chest-load pleural offset added to baseline pleural pressure, and a prone mirrored/flattened pleural gradient that keeps the supine tissue-weighted mean pleural pressure at fixed gas volume and keeps anatomical dependency, thresholds and perfusion fixed. Prone gradient factor is an assumed schematic parameter, not a measured value, and no improvement is implied.',
    'Negative-pressure external drive is an ideal uniform-transmission re-expression of the matched volume-control solution (no circulation, abdomen, leak or tank dynamics): airway pressure is 0, body-surface pressure is minus the original airway pressure, and transpulmonary pressure and regional states are identical. The pressure limit applies to the effective drive (default 45) and is not a calibrated tank-ventilator limit.',
    'Numerical resolution, timestep, prior recruitment state, respiratory rate, and sweep dwell time affect results. Sweeps start from a fresh seeded patient by default (or clone current state on request) and preserve hysteresis within each ascending/descending path.'
  ],
  highStrainCutoff: 1.65, referenceTranspulmonaryPressure: 5,
  phenotypes: {
    high: 'Heterogeneous opening thresholds with substantial potentially recruitable tissue.',
    low: 'Similar reduced capacity but more tissue with opening thresholds beyond usual pressures; low achievable recruitment.',
    wall: 'Same seeded lung and initial recruitment assumptions as high; greater baseline pleural offset and chest-wall elastance.',
    healthy: 'Lower opening thresholds, initially near-complete recruitment, and open-region parameters illustrating preserved mechanics.',
    healthyDependent: 'Healthy parameters and random draws with deterministic extra dependent-region closure tendency (lower initial f, higher thresholds above dependency 0.6); illustrative, not fitted.'
  }
});


function rng(seed) {
  let s = seed >>> 0;
  return () => { s += 0x6D2B79F5; let t = Math.imul(s ^ s >>> 15, 1 | s); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function finite(value, name) { if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`); }

export function createPatient(kind = 'high', seed = 13791, count = 512, pbw = 70) {
  if (!Object.hasOwn(PARAMETERS, kind)) throw new RangeError(`Unknown phenotype: ${kind}`);
  finite(seed, 'seed'); finite(count, 'count'); finite(pbw, 'pbw');
  if (!Number.isInteger(count) || count < 1 || count > 10000 || pbw <= 0) throw new RangeError('count must be an integer 1..10000; pbw must be positive');
  const p = PARAMETERS[kind], random = rng(seed), size = pbw / 70, healthyLike = kind === 'healthy' || kind === 'healthyDependent';
  const units = Array.from({ length: count }, (_, id) => {
    const dep = random(), weight = 0.7 + 0.6 * random(), hetero = 0.75 + 0.5 * random();
    const permanentlyDifficult = random() < (kind === 'low' ? 0.68 : healthyLike ? 0 : 0.08);
    let popen = healthyLike ? 0.3 + 3 * random() : (permanentlyDifficult ? 38 + 20 * random() : 6 + 15 * random() + 6 * dep);
    let pclose = healthyLike ? -3 + 2 * random() : 0.5 + 6 * random() + 3 * dep;
    let f = healthyLike ? p.initial : clamp(p.initial + 0.4 * (0.5 - dep) + 0.1 * (random() - 0.5), 0, 1);
    if (kind === 'healthyDependent') { const s = Math.max(0, (dep - 0.6) / 0.4); f = p.initial - 0.6 * s; popen += 1 * s; pclose += 3.5 * s; }
    return { id, dep, weight, capacity: p.capacity * size * hetero, rest: p.rest * size, stiffness: p.stiffness * (0.8 + 0.4 * random()), popen, pclose: Math.min(pclose, popen - 0.5), tauOpen: 0.35 + 1.2 * random(), tauClose: 1.3 + 3 * random(), rateWidth: 3, f, perfusion: 0.5 + dep };
  });
  const sum = units.reduce((s, u) => s + u.weight, 0);
  units.forEach(u => { u.weight /= sum; });
  return { kind, seed, pbw, count, baselinePleural: p.pleural, pleuralGradient: p.gradient, chestWallElastance: p.ew / size, chestWallReferenceVolume: p.reference * size, units, elapsed: 0, breaths: 0 };
}

/** Public constitutive primitive for inspectable physics and numerical tests. */
export function regionalVolume(unit, tp) {
  if (unit.linearCompliance != null) return unit.weight * Math.max(0, unit.rest + unit.linearCompliance * tp);
  const x = Math.max(tp, 0);
  return unit.weight * (unit.rest + unit.capacity * x / (unit.stiffness + x));
}
function regionalSlope(unit, tp) {
  if (unit.linearCompliance != null) return unit.rest + unit.linearCompliance * tp > 0 ? unit.weight * unit.linearCompliance : 0;
  return tp > 0 ? unit.weight * unit.capacity * unit.stiffness / (unit.stiffness + tp) ** 2 : 0;
}
function nextState(u, tp, dt) {
  if (dt === 0 || u.fixedOpen) return { f: u.f, slope: 0 };
  if (tp > u.popen) {
    const excess = tp - u.popen, rate = excess / (u.rateWidth + excess) / u.tauOpen;
    const retained = Math.exp(-dt * rate);
    return { f: 1 - (1 - u.f) * retained, slope: (1 - u.f) * retained * dt * u.rateWidth / (u.rateWidth + excess) ** 2 / u.tauOpen };
  }
  if (tp < u.pclose) {
    const excess = u.pclose - tp, rate = excess / (u.rateWidth + excess) / u.tauClose;
    const retained = Math.exp(-dt * rate);
    return { f: u.f * retained, slope: u.f * retained * dt * u.rateWidth / (u.rateWidth + excess) ** 2 / u.tauClose };
  }
  return { f: u.f, slope: 0 };
}

// z is airway pressure minus common pleural offset and recoil. This eliminates a nested chest-wall solve.
function evaluate(patient, z, dt, commit = false) {
  let volume = 0, slope = 0;
  for (const u of patient.units) {
    const tp = z - patient.pleuralGradient * u.dep, state = nextState(u, tp, dt), v = regionalVolume(u, tp);
    volume += state.f * v;
    slope += state.slope * v + state.f * regionalSlope(u, tp);
    if (commit) u.f = state.f;
  }
  return { z, volume, slope, pressure: z + patient.baselinePleural + patient.chestWallElastance * (volume - patient.chestWallReferenceVolume) };
}
function solve(patient, target, dt, mode, guess = 10) {
  let lo = -100, hi = 300, z = clamp(guess, lo, hi), e;
  for (let k = 0; k < 45; k++) {
    e = evaluate(patient, z, dt);
    const error = (mode === 'pressure' ? e.pressure : e.volume) - target;
    if (Math.abs(error) < (mode === 'pressure' ? 1e-8 : 1e-5)) return e;
    if (error > 0) hi = z; else lo = z;
    const deriv = mode === 'pressure' ? 1 + patient.chestWallElastance * e.slope : e.slope;
    const next = z - error / deriv;
    z = Number.isFinite(next) && next > lo && next < hi ? next : (lo + hi) / 2;
  }
  e = evaluate(patient, z, dt);
  if (Math.abs((mode === 'pressure' ? e.pressure : e.volume) - target) > 0.001) throw new Error(`Root solve failed for ${mode} target ${target}`);
  return e;
}
function advancePressure(patient, pressure, dt, guess) {
  const e = solve(patient, pressure, dt, 'pressure', guess);
  evaluate(patient, e.z, dt, true);
  return e;
}
function snapshot(patient, e) {
  return patient.units.map(u => ({ f: u.f, v: u.f * regionalVolume(u, e.z - patient.pleuralGradient * u.dep) }));
}
function validateSettings(settings) {
  const s = { peep: 8, vt: 6, rr: 20, pressureLimit: 45, ...settings };
  for (const [k, v] of Object.entries(s)) finite(v, k);
  if (s.peep < 0 || s.peep > 50 || s.vt <= 0 || s.vt > 30 || s.rr <= 0 || s.rr > 100 || s.pressureLimit < s.peep || s.pressureLimit > 150) throw new RangeError('Invalid ventilator settings');
  return s;
}

export const MAX_TRAJECTORY_VALUES = 250000;

export function simulate(patient, settings = {}, { breaths = 10, dt = 0.1, recordTrajectory = false, recordPleuralField = false } = {}) {
  const s = validateSettings(settings);
  if (!Number.isInteger(breaths) || breaths < 1 || breaths > 1000 || !(dt > 0 && dt <= 1)) throw new RangeError('breaths must be 1..1000 and dt 0..1 s');
  if (typeof recordTrajectory !== 'boolean') throw new TypeError('recordTrajectory must be a boolean');
  if (typeof recordPleuralField !== 'boolean') throw new TypeError('recordPleuralField must be a boolean');
  if (recordPleuralField && !recordTrajectory) throw new RangeError('recordPleuralField requires recordTrajectory');
  const cycle = 60 / s.rr, ti = cycle / 3, te = cycle - ti, targetVT = s.vt * patient.pbw;
  if (recordTrajectory) {
    const frameCount = Math.ceil(ti / dt) + Math.ceil(te / dt) + 2;
    if (frameCount * patient.units.length > MAX_TRAJECTORY_VALUES) throw new RangeError(`Trajectory recording needs ${frameCount} frames x ${patient.units.length} units, exceeding the ${MAX_TRAJECTORY_VALUES} limit`);
  }
  let trajDep = 0;
  if (recordTrajectory) for (const u of patient.units) trajDep += u.weight * u.dep;
  let frames = null;
  const addFrame = (time, phase, pressure, volume, z, ceilingActive) => {
    const n = patient.units.length, unitOpen = new Float64Array(n), unitVolume = new Float64Array(n), unitRatio = new Float64Array(n);
    let open = 0;
    for (let i = 0; i < n; i++) {
      const u = patient.units[i], tp = z - patient.pleuralGradient * u.dep, fullyOpen = regionalVolume(u, tp), reference = regionalVolume(u, MODEL_INFO.referenceTranspulmonaryPressure);
      unitOpen[i] = u.f; unitVolume[i] = u.f * fullyOpen; unitRatio[i] = reference > 0 ? fullyOpen / reference : 0; open += u.weight * u.f;
    }
    const meanPleural = patient.baselinePleural + patient.pleuralGradient * trajDep + patient.chestWallElastance * (volume - patient.chestWallReferenceVolume);
    frames.push({ time, phase, pressure, volume, meanPleural, open, ceilingActive, unitOpen, unitVolume, unitRatio });
  };
  let ee, ei, eeState, eiState, limited = false, pv = [], maxPressure = s.peep, finalEffectiveTarget = 0, finalMode = 'volume';
  let zGuess = s.peep - patient.baselinePleural;
  for (let b = 0; b < breaths; b++) {
    const record = recordTrajectory && b === breaths - 1;
    if (record) frames = [];
    ee = advancePressure(patient, s.peep, 0, zGuess); eeState = snapshot(patient, ee);
    if (record) addFrame(0, 'start', s.peep, ee.volume, ee.z, false);
    const baseVolume = ee.volume;
    pv = [{ volume: ee.volume, pressure: s.peep, phase: 'inflation' }];
    limited = false; maxPressure = s.peep;
    const ni = Math.ceil(ti / dt), stepI = ti / ni;
    for (let j = 1; j <= ni; j++) {
      const target = baseVolume + targetVT * j / ni;
      const ceiling = solve(patient, s.pressureLimit, stepI, 'pressure', zGuess);
      let e;
      const ceilingActive = target > ceiling.volume + 1e-5;
      if (ceilingActive) { e = ceiling; limited = true; finalMode = 'pressure'; }
      else {
        e = solve(patient, target, stepI, 'volume', zGuess); finalMode = 'volume';
        if (e.pressure < s.peep) { e = solve(patient, s.peep, stepI, 'pressure', zGuess); finalMode = 'pressure'; }
      }
      evaluate(patient, e.z, stepI, true);
      finalEffectiveTarget = finalMode === 'volume' ? target : solve(patient, e.pressure > s.peep + 1e-5 ? s.pressureLimit : s.peep, 0, 'pressure', e.z).volume;
      zGuess = e.z; ei = e;
      maxPressure = Math.max(maxPressure, e.pressure);
      pv.push({ volume: e.volume, pressure: e.pressure, phase: 'inflation' });
      if (record) addFrame(j === ni ? ti : j * stepI, 'inspiration', e.pressure, e.volume, e.z, ceilingActive);
    }
    eiState = snapshot(patient, ei);
    if (record) {
      const release = solve(patient, s.peep, 0, 'pressure', ei.z);
      addFrame(ti, 'release', s.peep, release.volume, release.z, false);
    }
    const ne = Math.ceil(te / dt), stepE = te / ne;
    for (let j = 0; j < ne; j++) {
      const e = advancePressure(patient, s.peep, stepE, zGuess); zGuess = e.z;
      pv.push({ volume: e.volume, pressure: s.peep, phase: 'deflation' });
      if (record) addFrame(j === ne - 1 ? cycle : ti + (j + 1) * stepE, 'expiration', s.peep, e.volume, e.z, false);
    }
  }
  patient.elapsed += cycle * breaths; patient.breaths += breaths;
  let openEE = 0, openEI = 0, cyclic = 0, over = 0, closedPerfusion = 0, perfusionTotal = 0, depMean = 0;
  const units = patient.units.map((u, i) => {
    const a = eeState[i], b = eiState[i], tp = ei.z - patient.pleuralGradient * u.dep;
    const reference = regionalVolume(u, MODEL_INFO.referenceTranspulmonaryPressure);
    const strainEI = reference > 0 ? regionalVolume(u, tp) / reference : 0;
    openEE += u.weight * a.f; openEI += u.weight * b.f; cyclic += u.weight * Math.max(0, b.f - a.f);
    over += u.weight * b.f * Number(strainEI > MODEL_INFO.highStrainCutoff);
    const perfusion = u.weight * u.perfusion; closedPerfusion += perfusion * (1 - a.f); perfusionTotal += perfusion; depMean += u.weight * u.dep;
    return { id: u.id, dep: u.dep, weight: u.weight, openEE: a.f, openEI: b.f, volumeEE: a.v, volumeEI: b.v, strainEI, state: u.f, popen: u.popen, pclose: u.pclose };
  });
  const vtDelivered = ei.volume - ee.volume, dp = ei.pressure - s.peep;
  const meanPleuralEE = patient.baselinePleural + patient.pleuralGradient * depMean + patient.chestWallElastance * (ee.volume - patient.chestWallReferenceVolume);
  const meanPleuralEI = patient.baselinePleural + patient.pleuralGradient * depMean + patient.chestWallElastance * (ei.volume - patient.chestWallReferenceVolume);
  const result = { metrics: { eelv: ee.volume, vtDelivered, pplat: ei.pressure, dp, crs: dp > 1e-8 ? vtDelivered / dp : null, openEE, openEI, cyclic, over, closedPerfusion: closedPerfusion / perfusionTotal, meanPleuralEE, meanPleuralEI, transpulmonaryEI: ei.pressure - meanPleuralEI, volumeError: vtDelivered - targetVT, volumeResidual: ei.volume - finalEffectiveTarget, limited }, units, pv, settings: s, targetVT, maxPressure, simulatedSeconds: breaths * cycle, totalElapsed: patient.elapsed, breaths, dt, labels: { closedPerfusion: 'Perfusion-weighted closed fraction proxy', over: `Aerated tissue fraction above assumed Vopen(EI)/Vopen(TP5) ratio ${MODEL_INFO.highStrainCutoff}`, eelv: 'Start-of-final-breath end-expiratory gas volume', state: 'Recruitment state after final expiration' } };
  if (frames) result.trajectory = { kind: 'quasi-static-steps', cycle, ti, eiIndex: Math.ceil(ti / dt), releaseIndex: Math.ceil(ti / dt) + 1, frames };
  if (frames && recordPleuralField) result.trajectory.pleural = { gradient: patient.pleuralGradient, depMean: trajDep };
  return result;
}

export function sweep(patient, settings = {}, { peeps = [4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24], breaths = 10, dt = 0.1, initialState = 'fresh' } = {}) {
  if (!Array.isArray(peeps) || peeps.length < 2 || peeps.some(p => !Number.isFinite(p))) throw new RangeError('Supply at least two finite PEEP values');
  const ascendingPeeps = [...new Set(peeps)].sort((a, b) => a - b);
  if (ascendingPeeps.length < 2) throw new RangeError('Supply at least two distinct PEEP values');
  const working = initialState === 'current' ? JSON.parse(JSON.stringify(patient)) : createPatient(patient.kind, patient.seed, patient.count, patient.pbw);
  if (!['fresh', 'current'].includes(initialState)) throw new RangeError('initialState must be fresh or current');
  const run = peep => ({ peep, ...simulate(working, { ...settings, peep }, { breaths, dt }).metrics });
  const ascending = ascendingPeeps.map(run), descending = [...ascendingPeeps].reverse().map(run);
  return { ascending, descending, breathsPerStep: breaths, dt, initialStateSource: initialState === 'fresh' ? 'Fresh seeded patient; sequential ascending then descending path' : 'Clone of supplied current state; sequential ascending then descending path' };
}

/**
 * Readonly dt=0 reference solve with the accepted recruitment fraction f frozen: relaxed PEEP state (EE) and
 * the state at requested EE+VT inside the dt=0 pressure ceiling (EI). Never commits to or mutates the patient.
 */
export function frozenReference(patient, settings = {}) {
  if (patient == null || !Array.isArray(patient.units) || patient.units.length === 0) throw new TypeError('frozenReference requires a patient with units');
  const s = validateSettings(settings), targetVT = s.vt * patient.pbw;
  const guess = s.peep - patient.baselinePleural;
  const describe = e => ({ z: e.z, volume: e.volume, pressure: e.pressure, units: patient.units.map(u => { const tp = e.z - patient.pleuralGradient * u.dep; return { f: u.f, v: u.f * regionalVolume(u, tp), tp }; }) });
  const ee = solve(patient, s.peep, 0, 'pressure', guess);
  const ceiling = solve(patient, s.pressureLimit, 0, 'pressure', ee.z);
  const limited = ee.volume + targetVT > ceiling.volume + 1e-5;
  const ei = limited ? ceiling : solve(patient, ee.volume + targetVT, 0, 'volume', ee.z);
  const deltaZ = ei.z - ee.z;
  if (!(deltaZ > 0) || !(ei.volume - ee.volume > 1e-9)) throw new RangeError('Frozen reference has no available volume between PEEP and the requested end-inspiratory state (zero deltaZ or delta volume)');
  let depMean = 0;
  for (const u of patient.units) depMean += u.weight * u.dep;
  return { settings: s, ee: describe(ee), ei: describe(ei), deltaZ, targetVT, limited, depMean };
}
