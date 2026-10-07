import { MODEL_INFO, MAX_TRAJECTORY_VALUES } from './engine.js';
import { applyExperiment, isDefaultExperiment, normalizeExperiment, withoutExperiment } from './experiments.js';

/*
 * Unified nonlinear-flow regional lung kernel (educational, uncalibrated). See docs/UNIFIED_MODEL_SPEC.md.
 *
 * State per unit: gas volume V_i (mL, changed ONLY by flow) and recruitment fraction f_i (changes the pressure at
 * fixed gas, never the gas). Gas-holding fraction a_i = res + (1-res) f_i, specific volume s_i = V_i/(w_i a_i),
 * local elastic pressure E_i = Phi_i(s_i) = alveolar minus pleural pressure, Ppl_i = B + gradient dep_i + Ecw (sum V - Vref),
 * flow q_i = g_i(f_i) (Pnode - Ppl_i - E_i), V_i' = q_i, f_i' = legacy opening/closing law driven by E_i.
 * Integration is SDIRK2 (gamma = 1 - 1/sqrt 2) with an O(N) damped Newton method (local 2x2 per unit plus a scalar Schur
 * complement for the common airway/pleural coupling), exact derivatives, domain line search and adaptive halving.
 */

const GAMMA = 1 - Math.SQRT1_2;
const STIFF_LIMIT = 1 + Math.SQRT2;
const MAX_ITERATIONS = 25;
const RES_VOLUME = 1e-9;
const RES_OPEN = 1e-12;
const MAX_DEPTH = 8;
const UNIQUENESS_LIMIT = 0.8;
const BISECTION_ITERATIONS = 44;
const PEEP_FLOOR_TOLERANCE = 1e-12;
const SEED_XOR = 0x5bd1e995;
const MAX_TOTAL_STEPS = 1e6;
const VERSION = 1;

export const DEFAULT_MECHANICS = Object.freeze({
  R0: 0.008, Rp: 0.004, resistanceSpread: 0, resistanceDependency: 0, residualAeration: 0.01,
  residualConductance: 1, patencyPower: 1, kneeFraction: 0.95, compressionStiffness: 12
});
const MECHANICS_BOUNDS = Object.freeze({
  R0: { min: 0, max: 1 }, Rp: { min: 0, max: 1, minExclusive: true }, resistanceSpread: { min: 0, max: 2 },
  resistanceDependency: { min: 0, max: 3 }, residualAeration: { min: 0.001, max: 0.05 },
  residualConductance: { min: 0.01, max: 1 }, patencyPower: { min: 1, max: 3 }, kneeFraction: { min: 0.8, max: 0.98 },
  compressionStiffness: { min: 0, max: 32 }
});
const DEFAULT_SETTINGS = Object.freeze({ peep: 8, vt: 6, rr: 20, pressureLimit: 45, inspiratoryFraction: 1 / 3 });

export const UNIFIED_INFO = Object.freeze({
  version: VERSION,
  name: 'Unified nonlinear-flow regional lung kernel',
  calibration: 'Uncalibrated and not validated against clinical data. Defaults are illustrative; no treatment recommendation is implied.',
  defaults: DEFAULT_MECHANICS,
  bounds: MECHANICS_BOUNDS,
  settingsDefaults: DEFAULT_SETTINGS,
  units: { R0: 'cmH2O*s/mL', Rp: 'cmH2O*s/mL (unit conductance = weight/(Rp m))', volume: 'mL', pressure: 'cmH2O', time: 's', flow: 'mL/s' },
  assumptions: Object.freeze([
    'Gas volume of every unit changes only through flow; recruitment f changes the elastic pressure at fixed gas, not the gas. The incompressible gas-volume balance is an approximation, not full molar or energy conservation.',
    'Recruitment follows the legacy opening/closing rate law but is driven by the actual local elastic pressure E_i = alveolar minus pleural pressure, not by airway pressure.',
    'Residual aeration res is a numerical/physical floor on gas-holding tissue; residual conductance and patency power are not validated airway-sealing measurements.',
    'Below rest volume a smooth C1 stiffened logarithmic barrier is used; compressionStiffness (default 12) is an assumed parameter with no clinical calibration. Above the knee fraction the law continues linearly (C1) and the kneeReached flag is raised.',
    'The airway has one common central resistance R0 and a quenched per-unit resistance multiplier; there is no inertance, flow limitation, spontaneous effort or gas exchange.',
    'Volume control imposes constant flow VT/Ti until the pressure ceiling is reached, then latches to pressure control at the ceiling for the rest of inspiration; expiration is pressure control at PEEP. No end-inspiratory or end-expiratory hold is simulated, so no plateau pressure, compliance or measured auto-PEEP exists.',
    'The resting PEEP reference is the relaxed state at the final recruitment fractions; it does not predict a long exhalation during which recruitment would keep changing.',
    'Palv_i minus PEEP at end expiration is a modelled local pressure; it is not a measured auto-PEEP.'
  ]),
  numerics: Object.freeze({ scheme: 'SDIRK2, gamma = 1 - 1/sqrt(2)', maxIterations: MAX_ITERATIONS, residualVolumeMl: RES_VOLUME, residualOpen: RES_OPEN, maxRefinementDepth: MAX_DEPTH, uniquenessLimit: UNIQUENESS_LIMIT, stiffNonmonotoneLimit: STIFF_LIMIT })
});

// ----------------------------------------------------------------------------------------------------------------
// validation helpers

const isPlain = value => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

export function normalizeMechanics(params) {
  if (params == null) return { ...DEFAULT_MECHANICS };
  if (!isPlain(params)) throw new TypeError('mechanics must be a plain object');
  for (const key of Reflect.ownKeys(params)) {
    if (typeof key !== 'string' || !Object.hasOwn(MECHANICS_BOUNDS, key)) throw new RangeError(`Unknown unified mechanics parameter: ${String(key)}`);
  }
  const out = { ...DEFAULT_MECHANICS };
  for (const key of Object.keys(MECHANICS_BOUNDS)) {
    const value = params[key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${key} must be a finite number`);
    const { min, max, minExclusive } = MECHANICS_BOUNDS[key];
    if (minExclusive ? !(value > min) : value < min) throw new RangeError(`${key} must be ${minExclusive ? 'greater than' : 'at least'} ${min}`);
    if (value > max) throw new RangeError(`${key} must be at most ${max}`);
    out[key] = value;
  }
  return out;
}

export function normalizeUnifiedSettings(settings) {
  if (settings == null) return { ...DEFAULT_SETTINGS };
  if (!isPlain(settings)) throw new TypeError('settings must be a plain object');
  const s = { ...DEFAULT_SETTINGS };
  for (const key of Reflect.ownKeys(settings)) {
    if (typeof key !== 'string') throw new RangeError('Invalid setting key');
    if (key === 'experiment') {
      if (settings.experiment != null && !isDefaultExperiment(settings.experiment)) throw new RangeError('A non-default settings.experiment must be applied through simulateUnifiedExperiment');
      continue;
    }
    if (!Object.hasOwn(DEFAULT_SETTINGS, key)) throw new RangeError(`Unknown unified setting: ${key}`);
    if (settings[key] === undefined) continue;
    if (typeof settings[key] !== 'number' || !Number.isFinite(settings[key])) throw new TypeError(`${key} must be a finite number`);
    s[key] = settings[key];
  }
  if (s.peep < 0 || s.peep > 50 || s.vt < 0.1 || s.vt > 30 || s.rr < 1 || s.rr > 100 || s.pressureLimit < s.peep || s.pressureLimit > 150 || s.inspiratoryFraction < 0.2 || s.inspiratoryFraction > 0.6) {
    throw new RangeError('Invalid ventilator settings: peep 0..50, vt 0.1..30 mL/kg, rr 1..100, peep <= pressureLimit <= 150, inspiratoryFraction 0.2..0.6');
  }
  return s;
}

function mulberry(seed) {
  let s = seed >>> 0;
  return () => { s += 0x6D2B79F5; let t = Math.imul(s ^ s >>> 15, 1 | s); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const finiteNumber = (x, name) => { if (typeof x !== 'number' || !Number.isFinite(x)) throw new TypeError(`${name} must be a finite number`); };
const positive = (x, name) => { finiteNumber(x, name); if (!(x > 0)) throw new RangeError(`${name} must be positive`); };

function checkPatient(patient) {
  if (patient == null || typeof patient !== 'object' || !Array.isArray(patient.units) || patient.units.length === 0) throw new TypeError('patient with a non-empty units array is required');
  for (const key of ['baselinePleural', 'pleuralGradient', 'chestWallReferenceVolume', 'seed', 'pbw']) finiteNumber(patient[key], key);
  finiteNumber(patient.chestWallElastance, 'chestWallElastance');
  if (patient.chestWallElastance < 0) throw new RangeError('chestWallElastance must be non-negative');
  positive(patient.pbw, 'pbw');
}

// ----------------------------------------------------------------------------------------------------------------
// network

const NETWORKS = new WeakSet();
const WORKSPACES = new WeakMap();

export function buildUnifiedNetwork(patient, settings = {}, mechanics = {}) {
  const mech = normalizeMechanics(mechanics), s = normalizeUnifiedSettings(settings);
  checkPatient(patient);
  const n = patient.units.length, knee = mech.kneeFraction, T5 = MODEL_INFO.referenceTranspulmonaryPressure;
  const mk = () => new Float64Array(n);
  const w = mk(), dep = mk(), rest = mk(), cap = mk(), stiff = mk(), lc = mk(), popen = mk(), pclose = mk(), tauO = mk(), tauC = mk(), width = mk();
  const mult = mk(), g0 = mk(), s5 = mk(), perf = mk(), sk = mk(), Ek = mk(), slopeK = mk(), A = mk();
  const linear = new Uint8Array(n), fixed = new Uint8Array(n), ids = new Array(n);
  const random = mulberry((patient.seed ^ SEED_XOR) >>> 0);
  let wSum = 0, depSum = 0, maxRate = 0, sumG0 = 0;
  for (let i = 0; i < n; i++) {
    const u = patient.units[i];
    if (u == null || typeof u !== 'object') throw new TypeError(`unit ${i} must be an object`);
    for (const key of ['weight', 'dep', 'rest', 'popen', 'pclose', 'tauOpen', 'tauClose']) finiteNumber(u[key], `unit ${i} ${key}`);
    positive(u.weight, `unit ${i} weight`); positive(u.rest, `unit ${i} rest`); positive(u.tauOpen, `unit ${i} tauOpen`); positive(u.tauClose, `unit ${i} tauClose`);
    const rw = u.rateWidth === undefined ? 3 : u.rateWidth;
    positive(rw, `unit ${i} rateWidth`);
    ids[i] = u.id ?? i; w[i] = u.weight; dep[i] = u.dep; rest[i] = u.rest; popen[i] = u.popen; pclose[i] = u.pclose; tauO[i] = u.tauOpen; tauC[i] = u.tauClose; width[i] = rw;
    fixed[i] = u.fixedOpen ? 1 : 0;
    perf[i] = Number.isFinite(u.perfusion) ? u.perfusion : 0.5 + u.dep;
    if (u.linearCompliance != null) {
      positive(u.linearCompliance, `unit ${i} linearCompliance`);
      linear[i] = 1; lc[i] = u.linearCompliance; s5[i] = u.rest + u.linearCompliance * T5;
    } else {
      positive(u.capacity, `unit ${i} capacity`); positive(u.stiffness, `unit ${i} stiffness`);
      cap[i] = u.capacity; stiff[i] = u.stiffness;
      s5[i] = u.rest + u.capacity * T5 / (u.stiffness + T5);
      sk[i] = u.rest + knee * u.capacity; Ek[i] = u.stiffness * knee / (1 - knee); slopeK[i] = u.stiffness / (u.capacity * (1 - knee) ** 2); A[i] = u.stiffness * u.rest / u.capacity;
    }
    // One draw per unit from a separate stream so the legacy patient draws are never disturbed.
    const U = random();
    mult[i] = Math.exp(mech.resistanceSpread * (2 * U - 1) + mech.resistanceDependency * (u.dep - 0.5));
    g0[i] = u.weight / (mech.Rp * mult[i]);
    wSum += u.weight; depSum += u.weight * u.dep; sumG0 += g0[i];
    if (!fixed[i]) maxRate = Math.max(maxRate, 1 / u.tauOpen, 1 / u.tauClose);
  }
  const net = {
    kind: 'unified-network', version: VERSION, n, w, dep, rest, cap, stiff, lc, linear, fixed, popen, pclose, tauO, tauC, width, mult, g0, s5, perf, sk, Ek, slopeK, A, ids,
    res: mech.residualAeration, om: 1 - mech.residualAeration, phiC: mech.residualConductance, power: mech.patencyPower, knee, kappa: mech.compressionStiffness,
    R0: mech.R0, Rp: mech.Rp, B: patient.baselinePleural, grad: patient.pleuralGradient, Ecw: patient.chestWallElastance, Vref: patient.chestWallReferenceVolume,
    depMean: depSum / wSum, wSum, sumG0, maxRate, pbw: patient.pbw, targetVT: s.vt * patient.pbw, settings: s, mechanics: mech, seed: patient.seed
  };
  Object.freeze(net);
  NETWORKS.add(net);
  return net;
}

function checkNet(net) {
  if (net === null || typeof net !== 'object' || !NETWORKS.has(net)) throw new TypeError('a network from buildUnifiedNetwork is required');
}

function checkState(net, state) {
  if (state == null || typeof state !== 'object') throw new TypeError('state must be {volume, open}');
  const { volume, open } = state, n = net.n;
  for (const [name, arr] of [['volume', volume], ['open', open]]) {
    if (!(arr instanceof Float64Array || Array.isArray(arr)) || arr.length !== n) throw new TypeError(`state.${name} must be an array of length ${n}`);
  }
  for (let i = 0; i < n; i++) {
    if (!(volume[i] > 0) || !Number.isFinite(volume[i])) throw new RangeError(`state.volume[${i}] must be positive and finite`);
    if (!(open[i] >= 0 && open[i] <= 1)) throw new RangeError(`state.open[${i}] must be in [0, 1]`);
  }
}

function checkDrive(drive) {
  const { mode, value } = drive ?? {};
  if (mode !== 'pc' && mode !== 'vc') throw new TypeError("mode must be 'pc' or 'vc'");
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('value must be a finite number');
  return { mode, value };
}

// ----------------------------------------------------------------------------------------------------------------
// constitutive law

let PHI_SLOPE = 0;
let PHI_BRANCH = 0; // 0 linear test unit, 1 sub-rest barrier, 2 legacy positive branch, 3 linear knee extension

function phi(net, i, s) {
  if (net.linear[i]) { PHI_BRANCH = 0; PHI_SLOPE = 1 / net.lc[i]; return (s - net.rest[i]) * PHI_SLOPE; }
  const r = net.rest[i];
  if (s >= r) {
    const c = net.cap[i], k = net.stiff[i], z = (s - r) / c;
    if (z <= net.knee) { const omz = 1 - z; PHI_BRANCH = 2; PHI_SLOPE = k / (c * omz * omz); return k * z / omz; }
    PHI_BRANCH = 3; PHI_SLOPE = net.slopeK[i];
    return net.Ek[i] + PHI_SLOPE * (s - net.sk[i]);
  }
  const u = Math.log(s / r), kap = net.kappa, Ai = net.A[i];
  PHI_BRANCH = 1; PHI_SLOPE = Ai * (1 - 2 * kap * u) / s;
  return Ai * (u - kap * u * u);
}

function invPhi(net, i, E) {
  if (net.linear[i]) return net.rest[i] + net.lc[i] * E;
  const r = net.rest[i];
  if (E >= 0) {
    if (E <= net.Ek[i]) return r + net.cap[i] * E / (net.stiff[i] + E);
    return net.sk[i] + (E - net.Ek[i]) / net.slopeK[i];
  }
  const e = E / net.A[i], kap = net.kappa;
  const u = kap === 0 ? e : 2 * e / (1 + Math.sqrt(1 - 4 * kap * e));
  return r * Math.exp(u);
}

const BRANCH_NAMES = ['linear', 'sub-rest', 'legacy', 'knee'];

/** Local elastic alveolar-minus-pleural pressure of unit i at gas volume V and recruitment f, with exact derivatives. */
export function elasticPressure(net, i, V, f) {
  checkNet(net);
  if (!Number.isInteger(i) || i < 0 || i >= net.n) throw new RangeError('unit index out of range');
  if (typeof V !== 'number' || !(V > 0) || !Number.isFinite(V)) throw new RangeError('V must be positive and finite');
  if (typeof f !== 'number' || !(f >= 0 && f <= 1)) throw new RangeError('f must be in [0, 1]');
  const a = net.res + net.om * f, s = V / (net.w[i] * a), E = phi(net, i, s), slope = PHI_SLOPE;
  return {
    pressure: E, dV: slope / (net.w[i] * a), df: -slope * s * net.om / a, specificVolume: s, aeration: a, slope,
    ratio: s / net.s5[i], branch: BRANCH_NAMES[PHI_BRANCH], kneeReached: PHI_BRANCH === 3
  };
}

// ----------------------------------------------------------------------------------------------------------------
// state-only fields and algebraic closure

function stateFields(net, V, f) {
  const { n, w, dep, s5, res, om, phiC, power, g0, grad } = net;
  let T = 0;
  for (let i = 0; i < n; i++) T += V[i];
  const common = net.B + net.Ecw * (T - net.Vref);
  const ppl = new Float64Array(n), elastic = new Float64Array(n), alveolar = new Float64Array(n), ratio = new Float64Array(n), conductance = new Float64Array(n), compliance = new Float64Array(n), specific = new Float64Array(n);
  let wAlv = 0, wOpen = 0, kneeW = 0, subW = 0;
  for (let i = 0; i < n; i++) {
    const a = res + om * f[i], s = V[i] / (w[i] * a), E = phi(net, i, s);
    if (PHI_BRANCH === 3) kneeW += w[i]; else if (PHI_BRANCH === 1) subW += w[i];
    const p = common + grad * dep[i];
    ppl[i] = p; elastic[i] = E; alveolar[i] = p + E; ratio[i] = s / s5[i]; specific[i] = s; compliance[i] = w[i] * a / PHI_SLOPE;
    const ga = phiC + (1 - phiC) * a;
    conductance[i] = power === 1 ? g0[i] * ga : g0[i] * Math.pow(ga, power);
    wAlv += w[i] * (p + E); wOpen += w[i] * f[i];
  }
  return { total: T, ppl, elastic, alveolar, ratio, conductance, compliance, specific, meanPleural: common + grad * net.depMean, meanAlveolar: wAlv / net.wSum, open: wOpen / net.wSum, kneeWeight: kneeW / net.wSum, subRestWeight: subW / net.wSum };
}

function closure(net, fields, mode, value) {
  const { n, R0 } = net, G = fields.conductance, alv = fields.alveolar;
  let SG = 0, SGP = 0;
  for (let i = 0; i < n; i++) { SG += G[i]; SGP += G[i] * alv[i]; }
  if (mode === 'vc') { const Pn = (value + SGP) / SG; return { Pn, Q: value, Paw: Pn + R0 * value }; }
  const Pn = (value + R0 * SGP) / (1 + R0 * SG);
  return { Pn, Q: SG * Pn - SGP, Paw: value };
}

function rateOf(net, i, E, f) {
  if (net.fixed[i]) return 0;
  const x = E - net.popen[i];
  if (x > 0) return (1 - f) * x / (net.width[i] + x) / net.tauO[i];
  const y = net.pclose[i] - E;
  if (y > 0) return -f * y / (net.width[i] + y) / net.tauC[i];
  return 0;
}

function evaluateInternal(net, V, f, mode, value) {
  const fields = stateFields(net, V, f), c = closure(net, fields, mode, value), n = net.n;
  const flow = new Float64Array(n), openRate = new Float64Array(n);
  for (let i = 0; i < n; i++) { flow[i] = fields.conductance[i] * (c.Pn - fields.alveolar[i]); openRate[i] = rateOf(net, i, fields.elastic[i], f[i]); }
  return {
    mode, drive: value, flow, q: c.Q, pressure: c.Paw, nodePressure: c.Pn, totalVolume: fields.total, meanPleural: fields.meanPleural, meanAlveolar: fields.meanAlveolar,
    open: fields.open, unitAlveolar: fields.alveolar, unitPleural: fields.ppl, unitElastic: fields.elastic, unitRatio: fields.ratio, unitConductance: fields.conductance,
    unitCompliance: fields.compliance, openRate, kneeWeight: fields.kneeWeight, subRestWeight: fields.subRestWeight
  };
}

/** Instantaneous algebraic closure (node pressure, per-unit flows) at a state for a drive; no time step. */
export function evaluateUnified(net, state, drive) {
  checkNet(net); checkState(net, state);
  const { mode, value } = checkDrive(drive);
  return evaluateInternal(net, state.volume, state.open, mode, value);
}

function airwayPressure(net, V, f, mode, value) {
  const fields = stateFields(net, V, f), c = closure(net, fields, mode, value);
  return { Paw: c.Paw, Q: c.Q, T: fields.total };
}

// ----------------------------------------------------------------------------------------------------------------
// static relaxed (zero-flow) state

export function relaxedUnified(net, open, peep) {
  checkNet(net);
  const n = net.n;
  if (!(open instanceof Float64Array || Array.isArray(open)) || open.length !== n) throw new TypeError(`open must be an array of length ${n}`);
  for (let i = 0; i < n; i++) if (!(open[i] >= 0 && open[i] <= 1)) throw new RangeError(`open[${i}] must be in [0, 1]`);
  finiteNumber(peep, 'peep');
  const { w, dep, res, om, Ecw, grad } = net;
  const volumes = new Float64Array(n);
  const sums = T => {
    const common = net.B + Ecw * (T - net.Vref);
    let sumV = 0, sumD = 0;
    for (let i = 0; i < n; i++) {
      const s = invPhi(net, i, peep - common - grad * dep[i]);
      if (!(s > 0) || !Number.isFinite(s)) throw new RangeError(`Relaxed state has a non-positive specific volume in unit ${i}`);
      phi(net, i, s);
      const wa = w[i] * (res + om * open[i]);
      volumes[i] = wa * s; sumV += volumes[i]; sumD += wa / PHI_SLOPE;
    }
    return { sumV, sumD };
  };
  let lo = 0, hi = Math.max(sums(0).sumV, 1e-9), T = hi, iterations = 0;
  for (; iterations < 200; iterations++) {
    const { sumV, sumD } = sums(T), F = T - sumV;
    if (Math.abs(F) <= 1e-10 + 1e-13 * Math.abs(T)) break;
    if (F > 0) hi = T; else lo = T;
    let next = T - F / (1 + Ecw * sumD);
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    if (next === T) break;
    T = next;
  }
  if (iterations >= 200) throw new Error('Relaxed state solve failed to converge');
  const fields = stateFields(net, volumes, open);
  const unitAlveolar = new Float64Array(n).fill(peep);
  let total = 0;
  for (let i = 0; i < n; i++) total += volumes[i];
  return {
    volumes, totalVolume: total, peep, meanPleural: fields.meanPleural, meanAlveolar: peep, unitPleural: fields.ppl, unitElastic: fields.elastic, unitAlveolar,
    unitRatio: fields.ratio, iterations, kneeWeight: fields.kneeWeight, subRestWeight: fields.subRestWeight
  };
}

// ----------------------------------------------------------------------------------------------------------------
// SDIRK2 stage solver

function makePoint(n) {
  const mk = () => new Float64Array(n);
  return { V: mk(), f: mk(), RV: mk(), Rf: mk(), i00: mk(), i01: mk(), i10: mk(), i11: mk(), G: mk(), qV: mk(), qf: mk(), q: mk(), r: mk(), lam: mk(), Pn: 0, T: 0, RT: 0, RP: 0, sumq: 0, sumV: 0, merit: 0, conv: false, bad: false, kneeW: 0, subW: 0 };
}

function workspace(net) {
  let ws = WORKSPACES.get(net);
  if (!ws) {
    const n = net.n, mk = () => new Float64Array(n);
    ws = { p: [makePoint(n), makePoint(n), makePoint(n), makePoint(n)], dV: mk(), df: mk(), al: mk(), ga: mk(), be: mk(), et: mk(), y0V: mk(), y0f: mk(), b2V: mk(), b2f: mk(), fscale: 1, dPn: 0, dT: 0 };
    WORKSPACES.set(net, ws);
  }
  return ws;
}

function evalPoint(net, ws, pt, a, bV, bf, mode, value) {
  const { n, w, dep, g0, popen, pclose, tauO, tauC, width, fixed, res, om, phiC, power, grad, Ecw, R0 } = net;
  const V = pt.V, f = pt.f, Pn = pt.Pn, T = pt.T, fs = ws.fscale;
  const common = net.B + Ecw * (T - net.Vref);
  let sumV = 0, sumq = 0, sumG = 0, maxRV = 0, maxRf = 0, meritV = 0, meritF = 0, kneeW = 0, subW = 0, bad = false;
  for (let i = 0; i < n; i++) {
    const Vi = V[i], fi = f[i], wi = w[i], ai = res + om * fi;
    const s = Vi / (wi * ai), E = phi(net, i, s), sl = PHI_SLOPE;
    if (PHI_BRANCH === 3) kneeW += wi; else if (PHI_BRANCH === 1) subW += wi;
    const eV = sl / (wi * ai), ef = -sl * s * om / ai;
    const d = Pn - (common + grad * dep[i]) - E;
    const ga = phiC + (1 - phiC) * ai;
    let G, Gp;
    if (power === 1) { G = g0[i] * ga; Gp = g0[i] * (1 - phiC) * om; }
    else { const gp = Math.pow(ga, power - 1); G = g0[i] * gp * ga; Gp = g0[i] * power * gp * (1 - phiC) * om; }
    const q = G * d, qV = -G * eV, qf = Gp * d - G * ef;
    let r = 0, rE = 0, rf = 0;
    if (!fixed[i]) {
      const x = E - popen[i];
      if (x > 0) { const den = width[i] + x, rho = x / den / tauO[i]; r = (1 - fi) * rho; rE = (1 - fi) * width[i] / (den * den) / tauO[i]; rf = -rho; }
      else {
        const y = pclose[i] - E;
        if (y > 0) { const den = width[i] + y, rho = y / den / tauC[i]; r = -fi * rho; rE = fi * width[i] / (den * den) / tauC[i]; rf = -rho; }
      }
    }
    const JVV = 1 - a * qV, JVf = -a * qf, JfV = -a * rE * eV, Jff = 1 - a * (rE * ef + rf);
    const det = JVV * Jff - JVf * JfV;
    if (!(det > 1e-10)) bad = true;
    const idet = 1 / det;
    pt.i00[i] = Jff * idet; pt.i01[i] = -JVf * idet; pt.i10[i] = -JfV * idet; pt.i11[i] = JVV * idet;
    pt.G[i] = G; pt.qV[i] = qV; pt.qf[i] = qf; pt.q[i] = q; pt.r[i] = r; pt.lam[i] = G * eV;
    const RV = Vi - bV[i] - a * q, Rf = fi - bf[i] - a * r;
    pt.RV[i] = RV; pt.Rf[i] = Rf;
    const aRV = Math.abs(RV), aRf = Math.abs(Rf);
    if (aRV > maxRV) maxRV = aRV;
    if (aRf > maxRf) maxRf = aRf;
    meritV += RV * RV; meritF += Rf * Rf;
    sumV += Vi; sumq += q; sumG += G;
  }
  pt.RT = T - sumV;
  pt.RP = mode === 'pc' ? Pn + R0 * sumq - value : sumq - value;
  pt.sumq = sumq; pt.sumV = sumV; pt.kneeW = kneeW; pt.subW = subW; pt.bad = bad;
  const ps = mode === 'pc' ? a * net.sumG0 : a, gp = pt.RP * ps;
  pt.merit = meritV + meritF * fs * fs + pt.RT * pt.RT + gp * gp;
  pt.conv = !bad && maxRV <= RES_VOLUME && maxRf <= RES_OPEN && Math.abs(pt.RT) <= RES_VOLUME && Math.abs(gp) <= RES_VOLUME;
}

function direction(net, ws, pt, a, mode) {
  const { n, Ecw, R0 } = net, { dV, df, al, ga, be, et } = ws;
  let SA = 0, SB = 0, QA = 0, QB = 0;
  for (let i = 0; i < n; i++) {
    const rv = pt.RV[i], rf = pt.Rf[i], i00 = pt.i00[i], i10 = pt.i10[i], G = pt.G[i];
    const alpha = -(i00 * rv + pt.i01[i] * rf), gamma = -(i10 * rv + pt.i11[i] * rf), beta = a * G * i00, eta = a * G * i10;
    al[i] = alpha; ga[i] = gamma; be[i] = beta; et[i] = eta;
    SA += alpha; SB += beta;
    QA += pt.qV[i] * alpha + pt.qf[i] * gamma;
    QB += pt.qV[i] * beta + pt.qf[i] * eta + G;
  }
  let psi;
  if (mode === 'pc') psi = (-pt.RP - Ecw * (SA - pt.RT) - R0 * QA) / (1 + Ecw * SB + R0 * QB);
  else psi = -(pt.RP + QA) / QB;
  if (!Number.isFinite(psi)) return false;
  const dT = SA + SB * psi - pt.RT;
  ws.dT = dT; ws.dPn = psi + Ecw * dT;
  for (let i = 0; i < n; i++) { dV[i] = al[i] + be[i] * psi; df[i] = ga[i] + et[i] * psi; }
  return true;
}

function solveStage(net, ws, bV, bf, a, mode, value, ptA, ptB, stats) {
  const n = net.n;
  let cur = ptA, trial = ptB, iters = 0;
  evalPoint(net, ws, cur, a, bV, bf, mode, value);
  for (;;) {
    if (cur.bad || !Number.isFinite(cur.merit)) return { ok: false, reason: 'singular or non-finite local system', iters };
    if (cur.conv) return { ok: true, pt: cur, iters };
    if (iters >= MAX_ITERATIONS) return { ok: false, reason: 'maximum Newton iterations', iters };
    iters++; stats.newtonIterations++;
    if (!direction(net, ws, cur, a, mode)) return { ok: false, reason: 'singular global system', iters };
    const { dV, df } = ws, V = cur.V, f = cur.f;
    let alpha = 1;
    for (let i = 0; i < n; i++) {
      if (dV[i] < 0) { const lim = 0.9 * V[i] / -dV[i]; if (lim < alpha) alpha = lim; }
      if (df[i] < 0) {
        if (f[i] > 0) { const lim = 0.95 * f[i] / -df[i]; if (lim < alpha) alpha = lim; } else if (df[i] > -1e-12) df[i] = 0; else return { ok: false, reason: 'recruitment domain', iters };
      } else if (df[i] > 0) {
        if (f[i] < 1) { const lim = 0.95 * (1 - f[i]) / df[i]; if (lim < alpha) alpha = lim; } else if (df[i] < 1e-12) df[i] = 0; else return { ok: false, reason: 'recruitment domain', iters };
      }
    }
    if (!(alpha > 0)) return { ok: false, reason: 'domain line search', iters };
    let accepted = false;
    for (let ls = 0; ls < 30; ls++) {
      for (let i = 0; i < n; i++) { trial.V[i] = V[i] + alpha * dV[i]; trial.f[i] = f[i] + alpha * df[i]; }
      trial.Pn = cur.Pn + alpha * ws.dPn; trial.T = cur.T + alpha * ws.dT;
      evalPoint(net, ws, trial, a, bV, bf, mode, value);
      if (!trial.bad && Number.isFinite(trial.merit) && (trial.conv || trial.merit <= (1 - 1e-4 * alpha) * cur.merit)) { accepted = true; break; }
      alpha *= 0.5;
    }
    if (!accepted) return { ok: false, reason: 'line search', iters };
    const tmp = cur; cur = trial; trial = tmp;
  }
}

function uniquenessMetric(net, pt, bV) {
  const { n, w, res, om, phiC, power } = net;
  let worst = 0;
  for (let i = 0; i < n; i++) {
    const dV = pt.V[i] - bV[i];
    if (!(dV > 0)) continue;
    const a = res + om * pt.f[i], m = power * (1 - phiC) * a / (phiC + (1 - phiC) * a) * dV / pt.V[i];
    if (m > worst) worst = m;
  }
  return worst;
}

function newStats() {
  return {
    newtonIterations: 0, stages: 0, steps: 0, refinements: 0, maxDepth: 0, failures: 0, uniquenessRefinements: 0, uniquenessUnresolved: 0,
    stiffSteps: 0, stiffUnitsMax: 0, maxHLambda: 0, kneeWeightMax: 0, subRestWeightMax: 0, minVolume: Infinity, minOpen: Infinity, maxOpen: -Infinity, maxMassResidual: 0, maxStageIterations: 0
  };
}

// Count solver work from all attempts, but state excursions only from accepted steps.
function mergeWorkStats(target, source) {
  for (const k of ['newtonIterations','stages','refinements','failures','uniquenessRefinements']) target[k] += source[k];
  for (const k of ['maxDepth','maxStageIterations']) target[k] = Math.max(target[k], source[k]);
}
function mergeAcceptedStats(target, source) {
  for (const k of ['steps','stiffSteps','uniquenessUnresolved']) target[k] += source[k];
  for (const k of ['stiffUnitsMax','maxHLambda','kneeWeightMax','subRestWeightMax','maxOpen','maxMassResidual']) target[k] = Math.max(target[k], source[k]);
  for (const k of ['minVolume','minOpen']) target[k] = Math.min(target[k], source[k]);
}

function sumArray(a) { let t = 0; for (let i = 0; i < a.length; i++) t += a[i]; return t; }

function trySdirk(net, ws, V, f, h, mode, value, stats, depth) {
  const { n } = net, a = GAMMA * h, { y0V, y0f, b2V, b2f } = ws;
  y0V.set(V); y0f.set(f);
  const V0 = sumArray(V);
  ws.fscale = Math.max(V0 / n, 1e-9);
  const [p0, p1, p2, p3] = ws.p;
  p0.V.set(y0V); p0.f.set(y0f);
  const g1 = airwayPressure(net, y0V, y0f, mode, value);
  // Algebraic node pressure at the guess: recompute from the closure to start consistent.
  p0.T = g1.T; p0.Pn = nodeGuess(net, y0V, y0f, mode, value);
  const st1 = solveStage(net, ws, y0V, y0f, a, mode, value, p0, p1, stats);
  stats.stages++;
  if (!st1.ok) { stats.failures++; return { ok: false, reason: `stage 1: ${st1.reason}`, iters: st1.iters }; }
  const S1 = st1.pt;
  if (st1.iters > stats.maxStageIterations) stats.maxStageIterations = st1.iters;
  if (net.phiC < 1 && uniquenessMetric(net, S1, y0V) >= UNIQUENESS_LIMIT) {
    if (depth < MAX_DEPTH) { stats.uniquenessRefinements++; return { ok: false, reason: 'local root uniqueness monitor (stage 1)', iters: st1.iters }; }
    stats.uniquenessUnresolved++;
  }
  for (let i = 0; i < n; i++) { b2V[i] = y0V[i] + (1 - GAMMA) * h * S1.q[i]; b2f[i] = y0f[i] + (1 - GAMMA) * h * S1.r[i]; }
  p2.V.set(S1.V); p2.f.set(S1.f); p2.Pn = S1.Pn; p2.T = S1.T;
  const st2 = solveStage(net, ws, b2V, b2f, a, mode, value, p2, p3, stats);
  stats.stages++;
  if (!st2.ok) { stats.failures++; return { ok: false, reason: `stage 2: ${st2.reason}`, iters: st2.iters }; }
  const S2 = st2.pt;
  if (st2.iters > stats.maxStageIterations) stats.maxStageIterations = st2.iters;
  if (net.phiC < 1 && uniquenessMetric(net, S2, b2V) >= UNIQUENESS_LIMIT) {
    if (depth < MAX_DEPTH) { stats.uniquenessRefinements++; return { ok: false, reason: 'local root uniqueness monitor (stage 2)', iters: st2.iters }; }
    stats.uniquenessUnresolved++;
  }
  V.set(S2.V); f.set(S2.f);
  const Q1 = S1.sumq, Q2 = S2.sumq, integratedFlow = h * ((1 - GAMMA) * Q1 + GAMMA * Q2), V1 = sumArray(V);
  const massResidual = V1 - V0 - integratedFlow;
  const P1 = mode === 'pc' ? value : S1.Pn + net.R0 * Q1, P2 = mode === 'pc' ? value : S2.Pn + net.R0 * Q2;
  stats.steps++;
  let stiff = 0, hl = 0, minV = Infinity, minF = Infinity, maxF = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = h * S2.lam[i];
    if (x > STIFF_LIMIT) stiff++;
    if (x > hl) hl = x;
    if (V[i] < minV) minV = V[i];
    if (f[i] < minF) minF = f[i];
    if (f[i] > maxF) maxF = f[i];
  }
  if (stiff > 0) stats.stiffSteps++;
  if (stiff > stats.stiffUnitsMax) stats.stiffUnitsMax = stiff;
  if (hl > stats.maxHLambda) stats.maxHLambda = hl;
  if (minV < stats.minVolume) stats.minVolume = minV;
  if (minF < stats.minOpen) stats.minOpen = minF;
  if (maxF > stats.maxOpen) stats.maxOpen = maxF;
  stats.kneeWeightMax = Math.max(stats.kneeWeightMax, S2.kneeW / net.wSum);
  stats.subRestWeightMax = Math.max(stats.subRestWeightMax, S2.subW / net.wSum);
  stats.maxMassResidual = Math.max(stats.maxMassResidual, Math.abs(massResidual));
  return { ok: true, q: Q2, pressure: P2, nodePressure: S2.Pn, integratedFlow, massResidual, stagePressures: [P1, P2], T: V1 };
}

function nodeGuess(net, V, f, mode, value) {
  const fields = stateFields(net, V, f);
  return closure(net, fields, mode, value).Pn;
}

function advanceCore(net, ws, V, f, h, mode, value, stats, depth) {
  const r = trySdirk(net, ws, V, f, h, mode, value, stats, depth);
  if (r.ok) return r;
  if (depth >= MAX_DEPTH) throw new Error(`Unified step failed after ${MAX_DEPTH} halvings (h=${h}, ${mode}, ${r.reason})`);
  stats.refinements++;
  if (depth + 1 > stats.maxDepth) stats.maxDepth = depth + 1;
  const first = advanceCore(net, ws, V, f, h / 2, mode, value, stats, depth + 1);
  const second = advanceCore(net, ws, V, f, h / 2, mode, value, stats, depth + 1);
  return {
    ok: true, q: second.q, pressure: second.pressure, nodePressure: second.nodePressure, integratedFlow: first.integratedFlow + second.integratedFlow,
    massResidual: first.massResidual + second.massResidual, stagePressures: first.stagePressures.concat(second.stagePressures), T: second.T
  };
}

function publicNumerics(stats) {
  return {
    newtonIterations: stats.newtonIterations, stages: stats.stages, steps: stats.steps, refinements: stats.refinements, maxRefinementDepth: stats.maxDepth, newtonFailures: stats.failures,
    uniquenessRefinements: stats.uniquenessRefinements, uniquenessUnresolved: stats.uniquenessUnresolved, maxStageIterations: stats.maxStageIterations,
    stiffNonmonotoneSteps: stats.stiffSteps, stiffNonmonotoneUnitsMax: stats.stiffUnitsMax, maxHLambda: stats.maxHLambda,
    kneeWeight: stats.kneeWeightMax, kneeReached: stats.kneeWeightMax > 0, subRestWeight: stats.subRestWeightMax,
    minVolume: stats.minVolume, minOpen: stats.minOpen, maxOpen: stats.maxOpen, maxMassResidual: stats.maxMassResidual
  };
}

/**
 * One SDIRK2 step (with adaptive halving on solver failure) from {volume, open}. drive {mode:'vc', value: Q mL/s} or
 * {mode:'pc', value: absolute Paw}. Returns the new state and the same quantities as evaluateUnified at that state.
 */
export function advanceUnified(net, state, h, drive) {
  checkNet(net); checkState(net, state);
  const { mode, value } = checkDrive(drive);
  if (typeof h !== 'number' || !(h > 0) || !Number.isFinite(h)) throw new RangeError('h must be positive and finite');
  if (h * net.maxRate > 1 + 1e-12) throw new RangeError('h exceeds the inverse of the fastest recruitment time constant');
  const V = Float64Array.from(state.volume), f = Float64Array.from(state.open), stats = newStats();
  const r = advanceCore(net, workspace(net), V, f, h, mode, value, stats, 0);
  const ev = evaluateInternal(net, V, f, mode, value);
  return {
    state: { volume: V, open: f }, flow: ev.flow, q: ev.q, pressure: ev.pressure, nodePressure: ev.nodePressure, meanPleural: ev.meanPleural, meanAlveolar: ev.meanAlveolar,
    unitAlveolar: ev.unitAlveolar, unitRatio: ev.unitRatio, unitPleural: ev.unitPleural, unitElastic: ev.unitElastic, openRate: ev.openRate, totalVolume: ev.totalVolume,
    integratedFlow: r.integratedFlow, massResidual: r.massResidual, stagePressures: r.stagePressures, numerics: publicNumerics(stats)
  };
}

// ----------------------------------------------------------------------------------------------------------------
// patient commit

function commitPatient(patient, { open, state, elapsed, breaths }) {
  const old = patient.units.map(u => u.f), oldState = patient.unifiedState, hadState = Object.hasOwn(patient, 'unifiedState');
  const oldElapsed = patient.elapsed, oldBreaths = patient.breaths, hadElapsed = Object.hasOwn(patient, 'elapsed'), hadBreaths = Object.hasOwn(patient, 'breaths');
  let assigned = 0;
  try {
    for (let i = 0; i < patient.units.length; i++) { patient.units[i].f = open[i]; assigned = i + 1; }
    patient.elapsed = elapsed; patient.breaths = breaths; patient.unifiedState = state;
  } catch (error) {
    for (let i = 0; i < assigned; i++) { try { patient.units[i].f = old[i]; } catch { /* best effort */ } }
    try {
      if (hadElapsed) patient.elapsed = oldElapsed; else delete patient.elapsed;
      if (hadBreaths) patient.breaths = oldBreaths; else delete patient.breaths;
      if (hadState) patient.unifiedState = oldState; else delete patient.unifiedState;
    } catch { /* best effort */ }
    throw error;
  }
}

// ----------------------------------------------------------------------------------------------------------------
// simulation

function checkOptions(options) {
  if (options == null) options = {};
  if (!isPlain(options)) throw new TypeError('options must be a plain object');
  const known = ['breaths', 'dt', 'h', 'recordTrajectory', 'recordPleuralField', 'settle', 'mechanics', 'stateContext', 'periodicTolerance', 'periodicFractionTolerance'];
  for (const key of Reflect.ownKeys(options)) if (typeof key !== 'string' || !known.includes(key)) throw new RangeError(`Unknown unified option: ${String(key)}`);
  const { breaths = 10, dt = 0.1, h = 'auto', recordTrajectory = true, mechanics = {}, stateContext = '', periodicTolerance = 0.5, periodicFractionTolerance = 1e-3 } = options;
  let { recordPleuralField, settle = false } = options;
  if (!Number.isInteger(breaths) || breaths < 1 || breaths > 1000) throw new RangeError('breaths must be an integer 1..1000');
  if (typeof dt !== 'number' || !(dt > 0 && dt <= 1)) throw new RangeError('dt must be in (0, 1] s');
  if (h !== 'auto' && (typeof h !== 'number' || !(h > 0) || !Number.isFinite(h))) throw new RangeError("h must be 'auto' or a positive finite number");
  if (typeof recordTrajectory !== 'boolean') throw new TypeError('recordTrajectory must be a boolean');
  if (recordPleuralField !== undefined && typeof recordPleuralField !== 'boolean') throw new TypeError('recordPleuralField must be a boolean');
  if (recordPleuralField === true && !recordTrajectory) throw new RangeError('recordPleuralField requires recordTrajectory');
  recordPleuralField = recordTrajectory && recordPleuralField !== false;
  if (typeof stateContext !== 'string') throw new TypeError('stateContext must be a string');
  for (const [name, value] of [['periodicTolerance', periodicTolerance], ['periodicFractionTolerance', periodicFractionTolerance]]) {
    if (typeof value !== 'number' || !(value > 0) || !Number.isFinite(value)) throw new RangeError(`${name} must be positive and finite`);
  }
  let settleOptions = null;
  if (settle === true) settle = {};
  if (settle !== false) {
    if (!isPlain(settle)) throw new TypeError('settle must be a boolean or a plain object');
    for (const key of Reflect.ownKeys(settle)) if (key !== 'maxBreaths') throw new RangeError(`Unknown settle option: ${String(key)}`);
    const maxBreaths = settle.maxBreaths === undefined ? 60 : settle.maxBreaths;
    if (!Number.isInteger(maxBreaths) || maxBreaths < breaths || maxBreaths > 1000) throw new RangeError('settle.maxBreaths must be an integer between breaths and 1000');
    settleOptions = { maxBreaths };
  }
  return { breaths, dt, h, recordTrajectory, recordPleuralField, settle: settleOptions, mechanics, stateContext, periodicTolerance, periodicFractionTolerance };
}

function carriedStateProblem(us, patient, n, context, mechanics) {
  if (us == null || typeof us !== 'object') return 'no carried gas state';
  const { volume, open } = us;
  if (!(volume instanceof Float64Array || Array.isArray(volume)) || !(open instanceof Float64Array || Array.isArray(open)) || volume.length !== n || open.length !== n) return 'carried gas state has a different unit count';
  if ((us.context ?? '') !== context) return 'carried gas state belongs to a different geometry context';
  if (us.mechanics !== JSON.stringify(mechanics)) return 'carried gas state belongs to different mechanics';
  for (let i = 0; i < n; i++) {
    if (!(volume[i] > 0) || !Number.isFinite(volume[i]) || !(open[i] >= 0 && open[i] <= 1)) return 'carried gas state is invalid';
    if (open[i] !== patient.units[i].f) return 'carried recruitment differs from patient.units f';
  }
  return null;
}

const weighted = (net, arr) => { let t = 0; for (let i = 0; i < net.n; i++) t += net.w[i] * arr[i]; return t / net.wSum; };

export function simulateUnified(patient, settings = {}, options = {}) {
  const opts = checkOptions(options);
  const net = buildUnifiedNetwork(patient, settings, opts.mechanics);
  const { n, w } = net, s = net.settings, ws = workspace(net);
  for (let i = 0; i < n; i++) if (!(patient.units[i].f >= 0 && patient.units[i].f <= 1)) throw new RangeError(`unit ${i} f must be in [0, 1]`);
  const { peep, pressureLimit: limit } = s, cycle = 60 / s.rr, ti = cycle * s.inspiratoryFraction, te = cycle - ti, Qt = net.targetVT / ti;
  const ni = Math.max(1, Math.ceil(ti / opts.dt - 1e-9)), ne = Math.max(1, Math.ceil(te / opts.dt - 1e-9)), frameI = ti / ni, frameE = te / ne;
  if (opts.recordTrajectory && (ni + ne + 3) * n > MAX_TRAJECTORY_VALUES) throw new RangeError(`Trajectory recording needs ${ni + ne + 3} frames x ${n} units, exceeding the ${MAX_TRAJECTORY_VALUES} limit`);
  let hTarget;
  if (opts.h === 'auto') { hTarget = Math.min(0.025, ti / 20, te / 20); if (net.maxRate > 0) hTarget = Math.min(hTarget, 1 / net.maxRate); }
  else { hTarget = opts.h; if (hTarget * net.maxRate > 1 + 1e-12) throw new RangeError('h exceeds the inverse of the fastest recruitment time constant'); }
  const mI = Math.max(1, Math.ceil(frameI / hTarget - 1e-9)), mE = Math.max(1, Math.ceil(frameE / hTarget - 1e-9)), hI = frameI / mI, hE = frameE / mE;
  const maxBreaths = opts.settle ? opts.settle.maxBreaths : opts.breaths;
  if ((ni * mI + ne * mE) * maxBreaths > MAX_TOTAL_STEPS) throw new RangeError('Requested time step and breath count exceed the step budget');

  let V, f = Float64Array.from(patient.units, u => u.f), source = 'relaxed', reason = null;
  const problem = patient.unifiedState === undefined ? 'no carried gas state' : carriedStateProblem(patient.unifiedState, patient, n, opts.stateContext, net.mechanics);
  if (problem === null) { V = Float64Array.from(patient.unifiedState.volume); f = Float64Array.from(patient.unifiedState.open); source = 'carried'; }
  else { V = Float64Array.from(relaxedUnified(net, f, peep).volumes); reason = problem; }
  const initialVolume = Float64Array.from(V), initialOpen = Float64Array.from(f);

  const stats = newStats();
  let last = null, breathsRun = 0, converged = false;
  for (let b = 0; b < maxBreaths; b++) {
    const record = opts.recordTrajectory && b >= opts.breaths - 1;
    const startV = Float64Array.from(V), startF = Float64Array.from(f), frames = record ? [] : null, pv = [];
    let latched = false, ceilingEvent = null, floorSteps = 0, ppeak = peep, vtQuad = 0, quadAll = 0, massMax = 0, lastDrive = { mode: 'pc', value: peep };
    const note = r => {
      if (![r.q, r.pressure, r.integratedFlow, r.massResidual].every(Number.isFinite)) throw new Error('Non-finite unified step result');
      massMax = Math.max(massMax, Math.abs(r.massResidual)); quadAll += r.integratedFlow;
    };
    const publish = (time, phase, drive) => {
      const inflation = phase === 'start' || phase === 'inspiration';
      if (!record) { const e = airwayPressure(net, V, f, drive.mode, drive.value); pv.push({ volume: e.T, pressure: e.Paw, phase: inflation ? 'inflation' : 'deflation' }); return e.Paw; }
      const e = evaluateInternal(net, V, f, drive.mode, drive.value);
      pv.push({ volume: e.totalVolume, pressure: e.pressure, phase: inflation ? 'inflation' : 'deflation' });
      frames.push({
        time, phase, pressure: e.pressure, flow: e.q, volume: e.totalVolume, meanPleural: e.meanPleural, meanAlveolar: e.meanAlveolar, open: e.open, ceilingActive: phase === 'inspiration' && latched,
        unitVolume: Float64Array.from(V), unitOpen: Float64Array.from(f), unitFlow: e.flow, unitAlveolar: e.unitAlveolar, unitRatio: e.unitRatio
      });
      return e.pressure;
    };
    const pcStep = (hh, value) => {
      const r = advanceCore(net, ws, V, f, hh, 'pc', value, stats, 0);
      note(r); lastDrive = { mode: 'pc', value };
      return r;
    };
    const inspirationStep = (hh, t, depth) => {
      if (latched) { const r = pcStep(hh, limit); vtQuad += r.integratedFlow; ppeak = Math.max(ppeak, limit); return; }
      const P0 = airwayPressure(net, V, f, 'vc', Qt).Paw;
      if (P0 > limit) { latched = true; ceilingEvent = { time: t, pressure: P0, initial: t === 0 }; const r = pcStep(hh, limit); vtQuad += r.integratedFlow; ppeak = Math.max(ppeak, limit); return; }
      if (P0 < peep - PEEP_FLOOR_TOLERANCE) { floorSteps++; const r = pcStep(hh, peep); vtQuad += r.integratedFlow; return; }
      const trialStats = newStats(), tV = Float64Array.from(V), tF = Float64Array.from(f), trial = advanceCore(net, ws, tV, tF, hh, 'vc', Qt, trialStats, 0);
      mergeWorkStats(stats, trialStats);
      const stageMax = Math.max(...trial.stagePressures);
      if (stageMax <= limit) {
        if (Math.min(P0, ...trial.stagePressures) < peep - PEEP_FLOOR_TOLERANCE) { floorSteps++; const r = pcStep(hh, peep); vtQuad += r.integratedFlow; return; }
        mergeAcceptedStats(stats, trialStats); V.set(tV); f.set(tF); note(trial); lastDrive = { mode: 'vc', value: Qt };
        vtQuad += trial.integratedFlow; ppeak = Math.max(ppeak, P0, stageMax);
        return;
      }
      if (trial.pressure <= limit) {
        if (depth >= 30) throw new Error('Cannot resolve a pressure-ceiling stage excursion');
        inspirationStep(hh / 2, t, depth + 1); inspirationStep(hh / 2, t + hh / 2, depth + 1);
        return;
      }
      let lo = 0, hi = hh, loRes = null, loV = null, loF = null, loStats = null;
      for (let it = 0; it < BISECTION_ITERATIONS; it++) {
        const mid = (lo + hi) / 2, probeStats = newStats(), mV = Float64Array.from(V), mF = Float64Array.from(f), r = advanceCore(net, ws, mV, mF, mid, 'vc', Qt, probeStats, 0);
        mergeWorkStats(stats, probeStats);
        if (Math.max(r.pressure, ...r.stagePressures) > limit) hi = mid; else { lo = mid; loRes = r; loV = mV; loF = mF; loStats = probeStats; }
      }
      if (loRes && Math.min(P0, ...loRes.stagePressures) < peep - PEEP_FLOOR_TOLERANCE) {
        if (depth >= 30) throw new Error('Cannot resolve a pressure-floor stage excursion');
        inspirationStep(hh / 2, t, depth + 1); inspirationStep(hh / 2, t + hh / 2, depth + 1); return;
      }
      latched = true; ceilingEvent = { time: t + lo, pressure: loRes ? loRes.pressure : P0, initial: false };
      if (loRes) { mergeAcceptedStats(stats, loStats); V.set(loV); f.set(loF); note(loRes); vtQuad += loRes.integratedFlow; ppeak = Math.max(ppeak, P0, loRes.pressure, ...loRes.stagePressures); lastDrive = { mode: 'vc', value: Qt }; }
      const r = pcStep(hh - lo, limit); vtQuad += r.integratedFlow; ppeak = Math.max(ppeak, limit);
    };

    publish(0, 'start', { mode: 'pc', value: peep });
    const startVC = airwayPressure(net, V, f, 'vc', Qt).Paw;
    if (startVC > limit) { latched = true; ceilingEvent = { time: 0, pressure: startVC, initial: true }; lastDrive = { mode: 'pc', value: limit }; }
    else if (startVC < peep) lastDrive = { mode: 'pc', value: peep };
    else lastDrive = { mode: 'vc', value: Qt };
    ppeak = Math.max(ppeak, publish(0, 'inspiration', lastDrive));
    for (let j = 1; j <= ni; j++) {
      for (let k = 0; k < mI; k++) inspirationStep(hI, (j - 1) * frameI + k * hI, 0);
      ppeak = Math.max(ppeak, publish(j === ni ? ti : j * frameI, 'inspiration', lastDrive));
    }
    const eiV = Float64Array.from(V), eiF = Float64Array.from(f), airwayEI = airwayPressure(net, V, f, lastDrive.mode, lastDrive.value).Paw;
    publish(ti, 'release', { mode: 'pc', value: peep });
    for (let j = 1; j <= ne; j++) {
      for (let k = 0; k < mE; k++) pcStep(hE, peep);
      publish(j === ne ? cycle : ti + j * frameE, 'expiration', { mode: 'pc', value: peep });
    }
    breathsRun = b + 1;
    const endV = Float64Array.from(V), endF = Float64Array.from(f);
    let l1 = 0, frac = 0;
    for (let i = 0; i < n; i++) { l1 += Math.abs(endV[i] - startV[i]); frac += w[i] * Math.abs(endF[i] - startF[i]); }
    frac /= net.wSum;
    last = { startV, startF, eiV, eiF, endV, endF, frames, pv, ppeak, latched, ceilingEvent, floorSteps, vtQuad, massMax, breathMass: sumArray(endV) - sumArray(startV) - quadAll, airwayEI, residual: l1, fractionResidual: frac };
    converged = l1 < opts.periodicTolerance && frac < opts.periodicFractionTolerance;
    if (breathsRun >= opts.breaths && (!opts.settle || converged)) break;
  }

  const { startV, startF, eiV, eiF, endV, endF } = last;
  const ee = stateFields(net, startV, startF), ei = stateFields(net, eiV, eiF), end = stateFields(net, endV, endF), rel = relaxedUnified(net, endF, peep);
  const totalStart = ee.total, totalEI = ei.total, totalEnd = end.total, ratioCut = MODEL_INFO.highStrainCutoff;
  let over = 0, cyclic = 0, closedPerf = 0, perfTotal = 0, positiveResidual = 0, palvMean = 0, palvMax = -Infinity, belowRestCompressionIndex = 0;
  const unitRelaxed = Float64Array.from(rel.volumes), unitPalvMinusPeep = new Float64Array(n);
  const units = new Array(n);
  for (let i = 0; i < n; i++) {
    over += w[i] * startFOrEI(eiF[i], ei.ratio[i] > ratioCut);
    cyclic += w[i] * Math.max(0, eiF[i] - startF[i]);
    const pw = w[i] * net.perf[i]; closedPerf += pw * (1 - startF[i]); perfTotal += pw;
    positiveResidual += Math.max(0, endV[i] - unitRelaxed[i]);
    unitPalvMinusPeep[i] = end.alveolar[i] - peep;
    palvMean += w[i] * unitPalvMinusPeep[i]; palvMax = Math.max(palvMax, unitPalvMinusPeep[i]);
    belowRestCompressionIndex += w[i] * Math.max(0, 1 - end.specific[i] / net.rest[i]);
    units[i] = {
      id: net.ids[i], dep: net.dep[i], weight: w[i], rest: net.rest[i], capacity: net.cap[i], stiffness: net.stiff[i], popen: net.popen[i], pclose: net.pclose[i], tauOpen: net.tauO[i], tauClose: net.tauC[i],
      resistanceMultiplier: net.mult[i], openEE: startF[i], openEI: eiF[i], openEnd: endF[i], state: endF[i], volumeEE: startV[i], volumeEI: eiV[i], volumeEnd: endV[i], strainEI: ei.ratio[i],
      relaxedVolumeEnd: unitRelaxed[i], relaxedVolume: unitRelaxed[i], pressureEE: ee.ppl[i], pressureEI: ei.ppl[i], alveolarEE: ee.alveolar[i], alveolarEI: ei.alveolar[i],
      transpulmonaryEE: ee.elastic[i], transpulmonaryEI: ei.elastic[i], resistance: 1 / ei.conductance[i], tauLocal: ei.compliance[i] / ei.conductance[i],
      palvMinusPeep: unitPalvMinusPeep[i]
    };
  }
  over /= net.wSum; cyclic /= net.wSum; palvMean /= net.wSum;
  const vtDelivered = totalEI - totalStart, maxPressure = last.ppeak;
  const metrics = {
    eelv: totalStart, endVolume: totalEnd, vtDelivered, ppeak: last.ppeak, maxPressure, airwayPressureEI: last.airwayEI, pplat: null, dp: null, crs: null,
    openEE: ee.open, openEI: ei.open, openEnd: end.open, cyclic, over, closedPerfusion: closedPerf / perfTotal,
    meanPleuralEE: ee.meanPleural, meanPleuralEI: ei.meanPleural, meanAlveolarEE: ee.meanAlveolar, meanAlveolarEI: ei.meanAlveolar, transpulmonaryEI: ei.meanAlveolar - ei.meanPleural,
    volumeError: vtDelivered - net.targetVT, volumeResidual: vtDelivered - last.vtQuad, limited: last.latched,
    restingPEEPVolume: rel.totalVolume, dynamicResidual: totalEnd - rel.totalVolume, retainedVolume: totalEnd - rel.totalVolume, sumPositiveRegionalResidual: positiveResidual,
    palvMinusPeepMean: palvMean, palvMinusPeepMax: palvMax, exhaledNet: totalEI - totalEnd, fractionEmptied: null, belowRestCompressionIndex,
    unitRelaxedVolume: unitRelaxed, periodicResidual: last.residual, periodicResidualOpen: last.fractionResidual, converged
  };
  const finalState = { volume: Float64Array.from(endV), open: Float64Array.from(endF) };
  const settleMode = opts.settle !== null;
  const result = {
    metrics, units, pv: last.pv, settings: { ...s }, targetVT: net.targetVT, maxPressure, simulatedSeconds: breathsRun * cycle, totalElapsed: (Number.isFinite(patient.elapsed) ? patient.elapsed : 0) + breathsRun * cycle,
    breaths: breathsRun, dt: opts.dt,
    labels: {
      eelv: 'Start-of-final-breath gas volume (unified nonlinear-flow model)', endVolume: 'Gas volume at the end of the final expiration', state: 'Recruitment fraction after the final expiration',
      restingPEEPVolume: 'Relaxed (zero-flow) gas volume at PEEP for the final recruitment fractions; a model reference, not a measurement',
      dynamicResidual: 'End-expiratory gas volume minus the relaxed PEEP volume (signed); not a measured auto-PEEP',
      palvMinusPeep: 'Modelled local alveolar pressure minus PEEP at end expiration; not a measured auto-PEEP',
      unavailable: 'pplat, dp and crs are not defined because no end-inspiratory hold is simulated; fractionEmptied is not defined because recruitment changes the baseline',
      airwayPressureEI: 'Dynamic end-inspiratory airway pressure with flow still on; not a plateau measurement',
      retainedVolume: 'Alias of signed end-volume minus the frozen-current-opening PEEP reference; not measured trapped gas',
      belowRestCompressionIndex: 'Tissue-weighted fractional compression below the assumed open-portion rest size; dimensionless, not a gas volume'
    },
    unified: {
      version: VERSION, mechanics: { ...net.mechanics }, settings: { ...s },
      initialState: { source, reason },
      step: { hTarget, hInspiration: hI, hExpiration: hE, recordDt: opts.dt, inspirationFrameStep: frameI, expirationFrameStep: frameE },
      reference: { endOpen: Float64Array.from(endF), endRestVolumes: Float64Array.from(unitRelaxed) },
      unitPalvMinusPeep,
      numerics: {
        scope: 'Accepted step states across all simulated breaths; solver work counts include rejected trial steps',
        ...publicNumerics(stats), massResidualBreath: last.breathMass, massResidualStepMax: last.massMax, floorSteps: last.floorSteps, ceilingEvent: last.ceilingEvent,
        relaxedIterations: rel.iterations, kneeWeightEnd: end.kneeWeight
      },
      finalState,
      initialStateArrays: { volume: initialVolume, open: initialOpen },
      periodicity: { residual: last.residual, residualOpen: last.fractionResidual, tolerance: opts.periodicTolerance, toleranceOpen: opts.periodicFractionTolerance, converged, breathsRun, settle: settleMode, maxBreaths }
    }
  };
  if (last.frames) {
    result.trajectory = { kind: 'unified-nonlinear-flow', cycle, ti, eiIndex: ni + 1, releaseIndex: ni + 2, frames: last.frames };
    if (opts.recordPleuralField) result.trajectory.pleural = { gradient: patient.pleuralGradient, depMean: net.depMean };
  }
  commitPatient(patient, {
    open: endF, state: { volume: Float64Array.from(endV), open: Float64Array.from(endF), context: opts.stateContext, mechanics: JSON.stringify(net.mechanics) },
    elapsed: (Number.isFinite(patient.elapsed) ? patient.elapsed : 0) + breathsRun * cycle, breaths: (Number.isFinite(patient.breaths) ? patient.breaths : 0) + breathsRun
  });
  return result;
}

const startFOrEI = (f, flag) => flag ? f : 0;

// ----------------------------------------------------------------------------------------------------------------
// negative-pressure (external drive) wrapper

const geometryContext = e => (e.posture === 'supine' && e.chestLoad === 0) ? '' : JSON.stringify([e.posture, e.chestLoad, e.posture === 'prone' ? e.proneGradientFactor : null]);

/**
 * Applies settings.experiment to a clone BEFORE the kernel, copies back only the gas state, f, time and breaths after
 * success, and re-expresses external drive exactly (Paw 0, pleural/alveolar pressures shifted, true transpulmonary unchanged).
 */
export function simulateUnifiedExperiment(patient, settings = {}, options = {}) {
  const e = normalizeExperiment(settings?.experiment), vent = withoutExperiment(settings);
  if (options != null && isPlain(options) && Object.hasOwn(options, 'stateContext')) throw new RangeError('stateContext is managed by simulateUnifiedExperiment');
  const base = options ?? {};
  if (!isPlain(base)) throw new TypeError('options must be a plain object');
  const opts = { ...base, stateContext: geometryContext(e) };
  if (isDefaultExperiment(e)) return simulateUnified(patient, vent, opts);
  const clone = applyExperiment(patient, e), result = simulateUnified(clone, vent, opts);
  commitPatient(patient, { open: Float64Array.from(clone.units, u => u.f), state: clone.unifiedState, elapsed: clone.elapsed, breaths: clone.breaths });
  const external = e.drive === 'external', m = result.metrics, peep = result.settings.peep, airwayEI = m.airwayPressureEI;
  result.conditions = {
    drive: e.drive, posture: e.posture, chestLoad: e.chestLoad, gradientFactor: e.proneGradientFactor, experiment: e,
    pExtEE: external ? -peep : 0, pExtEI: external ? -airwayEI : 0, airwayEE: external ? 0 : peep, airwayEI: external ? 0 : airwayEI,
    maxDrivePressure: result.maxPressure, drivePressureLimit: result.settings.pressureLimit,
    limitNote: 'The pressure limit applies to the effective drive (default 45 cmH2O); it is not a calibrated tank-ventilator limit. No hold is simulated, so there is no plateau pressure.'
  };
  result.settings = { ...result.settings, experiment: { ...e } };
  if (result.trajectory) {
    for (const frame of result.trajectory.frames) {
      const pressure = frame.pressure;
      if (external) {
        frame.pressure = 0; frame.meanPleural -= pressure; frame.meanAlveolar -= pressure; frame.externalPressure = -pressure; frame.transrespPressure = pressure;
        for (let i = 0; i < frame.unitAlveolar.length; i++) frame.unitAlveolar[i] -= pressure;
      } else { frame.externalPressure = 0; frame.transrespPressure = pressure; }
    }
  }
  if (external) {
    m.meanPleuralEE -= peep; m.meanPleuralEI -= airwayEI; m.meanAlveolarEE -= peep; m.meanAlveolarEI -= airwayEI; m.ppeak = 0; m.airwayPressureEI = 0;
    for (const u of result.units) { u.pressureEE -= peep; u.alveolarEE -= peep; u.pressureEI -= airwayEI; u.alveolarEI -= airwayEI; }
    result.pv = result.pv.map(point => ({ volume: point.volume, pressure: 0, phase: point.phase, transresp: point.pressure }));
  }
  return result;
}
