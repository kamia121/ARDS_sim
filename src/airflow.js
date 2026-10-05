import { frozenReference, MAX_TRAJECTORY_VALUES } from './engine.js';

/*
 * Frozen-aeration chord RC airflow experiment (educational, uncalibrated).
 *
 * The accepted recruitment fraction f of every unit is frozen. A dt=0 reference solve at PEEP (EE) and at EE+VT
 * (EI) gives each unit a chord compliance C_i = (v_i(EI)-v_i(EE))/deltaZ. With x_i the unit gas volume above its
 * relaxed frozen PEEP volume, X = sum x_i, Q = sum x_i', g_i = 1/R_i = weight_i/Rp, G = sum g_i, the linear network
 *   Paw - PEEP = R0 Q + R_i x_i' + x_i/C_i + Ecw X        (Ecw = common chest-wall elastance)
 * is  M x' + K x = p 1,  M = diag(R_i) + R0 11^T,  K = diag(1/C_i) + Ecw 11^T,  p = Paw - PEEP.
 * Pressure control: Q = [G (p - Ecw X) - sum g_i x_i/C_i] / (1 + R0 G).
 * Volume control at imposed Q: x_i' = g_i (Q/G + S/G - x_i/C_i), S = sum g_j x_j/C_j, and
 *   Paw = PEEP + R0 Q + Q/G + S/G + Ecw X (Ecw cancels from the distribution, not from the opening pressure).
 * Time stepping is SDIRK2 (gamma = 1 - 1/sqrt(2), L-stable, stiffly accurate) with O(N) Sherman-Morrison stage
 * solves. There is no state clipping and no hidden chord extrapolation: excursions outside [0, refDelta_i] are flagged.
 */

const GAMMA = 1 - Math.SQRT1_2;
const DEFAULT_PARAMS = Object.freeze({ R0: 0.008, Rp: 0.004 });
export const NEGATIVE_VOLUME_TOLERANCE_ML = 1e-6;
// Exceeds the 1e-5 mL tolerance of the engine's dt=0 volume solve that defines refDelta.
export const CHORD_TOLERANCE_ML = 1e-4;
const PEEP_FLOOR_TOLERANCE = 1e-12;
const BISECTION_ITERATIONS = 60;

export const AIRFLOW_INFO = Object.freeze({
  version: 1,
  name: 'Frozen-aeration chord RC airflow experiment',
  defaults: DEFAULT_PARAMS,
  units: { R0: 'cmH2O*s/mL (central airway)', Rp: 'cmH2O*s/mL (unit resistance R_i = Rp/weight_i)', volume: 'mL', pressure: 'cmH2O', time: 's' },
  calibration: 'Uncalibrated and not validated against clinical data; default resistances are illustrative.',
  assumptions: Object.freeze([
    'Recruitment fraction f is frozen at the accepted patient state for the whole experiment (no opening, closing, or hysteresis).',
    'Each unit is a linear chord compliance between the frozen dt=0 PEEP state and the frozen dt=0 end-inspiratory reference state; no extrapolation correction is applied and excursions outside the chord range are flagged.',
    'Default central and parallel resistance scales are 8 and 4 cmH2O*s/L respectively, uncalibrated and not scaled by body weight. Inactive chord paths retain reference gas but carry no flow.',
    'Unit resistance is Rp divided by tissue weight; a common central resistance R0 and common chest-wall elastance Ecw couple all units; no inertance, flow limitation, or spontaneous effort.',
    'Volume control imposes constant flow VT/Ti until the pressure ceiling is reached, then the remainder of inspiration is pressure-controlled at the ceiling (no switch back); expiration is pressure-controlled at PEEP.',
    'Virtual end-hold pressure and virtual auto-PEEP are hypothetical long-equilibration quantities; no physical end-inspiratory hold or measured auto-PEEP is simulated.',
    'Periodic steady state is accepted when the sum of absolute regional end-expiratory volume changes falls below the tolerance; otherwise the result is reported as not converged.'
  ]),
  numerics: Object.freeze({ scheme: 'SDIRK2, gamma = 1 - 1/sqrt(2), Sherman-Morrison stage solves', negativeVolumeToleranceMl: NEGATIVE_VOLUME_TOLERANCE_ML, chordToleranceMl: CHORD_TOLERANCE_ML, ceilingEvent: 'endpoint-pressure bisection with stage checks and substep refinement', negativeExcess: 'Negative excess volume x_i is allowed; only negative ABSOLUTE regional volume beyond the tolerance is rejected.' })
});

function checkParams(params) {
  if (params == null || typeof params !== 'object' || Array.isArray(params)) throw new TypeError('params must be an object');
  for (const key of Object.keys(params)) if (key !== 'R0' && key !== 'Rp') throw new RangeError(`Unknown airflow parameter: ${key}`);
  const { R0, Rp } = { ...DEFAULT_PARAMS, ...params };
  if (typeof R0 !== 'number' || typeof Rp !== 'number') throw new TypeError('R0 and Rp must be numbers');
  if (!Number.isFinite(R0) || R0 < 0) throw new RangeError('R0 must be finite and non-negative');
  if (!Number.isFinite(Rp) || Rp <= 0) throw new RangeError('Rp must be finite and positive');
  return { R0, Rp };
}

/** Build the frozen-aeration network from a readonly dt=0 reference; never mutates the patient. */
export function buildFrozenNetwork(patient, settings = {}, params = {}) {
  const { R0, Rp } = checkParams(params);
  const reference = frozenReference(patient, settings);
  const Ecw = patient.chestWallElastance;
  if (!Number.isFinite(Ecw) || Ecw < 0) throw new RangeError('chestWallElastance must be finite and non-negative');
  const n = patient.units.length, { deltaZ } = reference;
  const C = new Float64Array(n), R = new Float64Array(n), g = new Float64Array(n), baseVolume = new Float64Array(n), frozenOpen = new Float64Array(n), refDelta = new Float64Array(n), weights = new Float64Array(n), dep = new Float64Array(n), active = new Uint8Array(n);
  const indices = [];
  let G = 0, sumC = 0;
  for (let i = 0; i < n; i++) {
    const u = patient.units[i], a = reference.ee.units[i], b = reference.ei.units[i];
    weights[i] = u.weight; dep[i] = u.dep; frozenOpen[i] = a.f; baseVolume[i] = a.v;
    const dv = b.v - a.v, c = dv / deltaZ, r = Rp / u.weight;
    refDelta[i] = dv;
    if (!(u.weight > 0) || !(c > 0) || !Number.isFinite(1 / c) || !Number.isFinite(r) || !(r > 0)) continue;
    C[i] = c; R[i] = r; g[i] = 1 / r; active[i] = 1; indices.push(i); G += g[i]; sumC += c;
  }
  if (indices.length === 0) throw new RangeError('Frozen reference has no active (positive chord compliance) units');
  const complianceInput = 1 / (1 / sumC + Ecw);
  return {
    n, C, R, g, baseVolume, frozenOpen, refDelta, weights, dep, active, activeIndices: Uint32Array.from(indices), activeCount: indices.length,
    R0, Rp, Ecw, G, sumC, complianceInput, tauEquivalent: (R0 + 1 / G) * complianceInput,
    peep: reference.settings.peep, settings: reference.settings, targetVT: reference.targetVT, deltaZ, depMean: reference.depMean,
    eeVolume: reference.ee.volume, eiVolume: reference.ei.volume,
    meanPleuralEE: patient.baselinePleural + patient.pleuralGradient * reference.depMean + Ecw * (reference.ee.volume - patient.chestWallReferenceVolume),
    reference
  };
}

function checkNetwork(net) {
  if (net == null || typeof net !== 'object' || !Number.isInteger(net.n) || net.n < 1) throw new TypeError('network is required');
  for (const key of ['C', 'R', 'g']) if (!(net[key] instanceof Float64Array) || net[key].length !== net.n) throw new TypeError(`network.${key} must be a Float64Array of length n`);
  if (!(net.activeIndices instanceof Uint32Array) || net.activeIndices.length === 0) throw new TypeError('network.activeIndices must be a non-empty Uint32Array');
  for (const key of ['R0', 'Ecw', 'G', 'peep']) if (!Number.isFinite(net[key])) throw new TypeError(`network.${key} must be finite`);
}

function checkDrive(drive) {
  const { mode, value } = drive ?? {};
  if (mode !== 'pc' && mode !== 'vc') throw new TypeError("mode must be 'pc' or 'vc'");
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('value must be a finite number');
  return { mode, value };
}

function totals(net, y) {
  let X = 0, S = 0;
  for (const i of net.activeIndices) { X += y[i]; S += net.g[i] * y[i] / net.C[i]; }
  return { X, S };
}

// Net flow Q and airway pressure for a drive at state y.
function scalars(net, y, mode, value) {
  const { X, S } = totals(net, y), { G, R0, Ecw, peep } = net;
  if (mode === 'pc') return { Q: (G * (value - peep - Ecw * X) - S) / (1 + R0 * G), P: value };
  return { Q: value, P: peep + R0 * value + value / G + S / G + Ecw * X };
}

function flowAt(net, y, mode, value) {
  const { Q, P } = scalars(net, y, mode, value), { X, S } = totals(net, y), { G, Ecw, R0, peep, g, C } = net;
  const flow = new Float64Array(net.n);
  const drive = mode === 'pc' ? value - peep - Ecw * X - R0 * Q : Q / G + S / G;
  for (const i of net.activeIndices) flow[i] = g[i] * (drive - y[i] / C[i]);
  return { flow, q: Q, pressure: P };
}

/** Instantaneous per-unit and net flow for a state and drive; pure helper (used for the pressure-release jump). */
export function evaluateFlow(network, x, drive) {
  checkNetwork(network);
  if (!(x instanceof Float64Array) || x.length !== network.n) throw new TypeError('x must be a Float64Array of length n');
  const { mode, value } = checkDrive(drive);
  return flowAt(network, x, mode, value);
}

// Solve (M + a K) k = p 1 - K b for the stage derivative k; M + aK = diag(R_i + a/C_i) + (R0 + a Ecw) 11^T.
function stagePC(net, a, b, p, k) {
  const { activeIndices: act, R, C, Ecw, R0 } = net;
  let Xb = 0;
  for (const i of act) Xb += b[i];
  const c = R0 + a * Ecw;
  let s1 = 0, s2 = 0;
  for (const i of act) { const D = R[i] + a / C[i]; s1 += (p - b[i] / C[i] - Ecw * Xb) / D; s2 += 1 / D; }
  const tau = c * s1 / (1 + c * s2);
  for (const i of act) k[i] = (p - b[i] / C[i] - Ecw * Xb - tau) / (R[i] + a / C[i]);
}

// Solve (I - aA) k = A b + g Q/G with A = -diag(g_i/C_i) + g (g/C)^T / G; I - aA = diag(1 + a g_i/C_i) - (a/G) g (g/C)^T.
function stageVC(net, a, b, Q, k) {
  const { activeIndices: act, g, C, G } = net;
  let Sb = 0;
  for (const i of act) Sb += g[i] * b[i] / C[i];
  const lead = (Sb + Q) / G;
  let vw = 0, den = 0;
  for (const i of act) { const d = 1 + a * g[i] / C[i]; vw += g[i] / C[i] * g[i] * (lead - b[i] / C[i]) / d; den += g[i] / d; }
  const coef = a / G * vw / (den / G);
  for (const i of act) { const d = 1 + a * g[i] / C[i]; k[i] = (g[i] * (lead - b[i] / C[i]) + coef * g[i]) / d; }
}

/**
 * One pure SDIRK2 step of length h from excess volumes x. mode 'pc': value is absolute Paw (cmH2O);
 * mode 'vc': value is net flow (mL/s). Returns end-of-step x, per-unit flow, net flow q, Paw 'pressure' at the end
 * of the step (equals stagePressures[1]), the stage-quadrature volume, and the mass residual
 * (sum of x change minus integratedFlow, computed from closed-form stage flows).
 */
export function advanceNetwork(network, x, h, drive) {
  checkNetwork(network);
  if (!(x instanceof Float64Array) || x.length !== network.n) throw new TypeError('x must be a Float64Array of length n');
  if (typeof h !== 'number' || !(h > 0) || !Number.isFinite(h)) throw new RangeError('h must be positive and finite');
  for(let i=0;i<network.n;i++)if(!Number.isFinite(x[i])||(!network.active[i]&&x[i]!==0))throw new RangeError('Invalid excess-volume state on an inactive or non-finite path');
  const { mode, value } = checkDrive(drive), { n, activeIndices: act } = network, a = GAMMA * h;
  const x0 = new Float64Array(n), b2 = new Float64Array(n), y1 = new Float64Array(n), xn = new Float64Array(n), k1 = new Float64Array(n), k2 = new Float64Array(n);
  for (const i of act) x0[i] = x[i];
  const solve = mode === 'pc' ? (base, k) => stagePC(network, a, base, value - network.peep, k) : (base, k) => stageVC(network, a, base, value, k);
  solve(x0, k1);
  for (const i of act) y1[i] = x0[i] + a * k1[i];
  for (const i of act) b2[i] = x0[i] + h * (1 - GAMMA) * k1[i];
  solve(b2, k2);
  for (const i of act) xn[i] = b2[i] + a * k2[i];
  const s1 = scalars(network, y1, mode, value), end = flowAt(network, xn, mode, value);
  const integratedFlow = h * ((1 - GAMMA) * s1.Q + GAMMA * end.q);
  let sumNew = 0, sumOld = 0;
  for (const i of act) { sumNew += xn[i]; sumOld += x0[i]; }
  return { x: xn, flow: end.flow, q: end.q, pressure: end.pressure, integratedFlow, massResidual: sumNew - sumOld - integratedFlow, stagePressures: [s1.P, end.pressure] };
}

function checkOptions(options) {
  if (options == null || typeof options !== 'object') throw new TypeError('options must be an object');
  const { params = {}, dt = 0.1, substeps = 4, minBreaths = 10, maxBreaths = 60, periodicTolerance = 0.5, recordTrajectory = true } = options;
  if (typeof recordTrajectory !== 'boolean') throw new TypeError('recordTrajectory must be a boolean');
  if (typeof dt !== 'number' || !(dt > 0 && dt <= 1)) throw new RangeError('dt must be in (0, 1] s');
  if (!Number.isInteger(substeps) || substeps < 1 || substeps > 1000) throw new RangeError('substeps must be an integer 1..1000');
  if (!Number.isInteger(minBreaths) || minBreaths < 1 || !Number.isInteger(maxBreaths) || maxBreaths < minBreaths || maxBreaths > 1000) throw new RangeError('breaths must satisfy 1 <= minBreaths <= maxBreaths <= 1000');
  if (typeof periodicTolerance !== 'number' || !(periodicTolerance > 0) || !Number.isFinite(periodicTolerance)) throw new RangeError('periodicTolerance must be positive and finite');
  return { params, dt, substeps, minBreaths, maxBreaths, periodicTolerance, recordTrajectory };
}

/** Periodic-steady-state frozen-aeration airflow simulation. Does not mutate the patient. */
export function simulateAirflow(patient, settings = {}, options = {}) {
  const { params, dt, substeps, minBreaths, maxBreaths, periodicTolerance, recordTrajectory } = checkOptions(options);
  const net = buildFrozenNetwork(patient, settings, params), s = net.settings, { n, activeIndices: act } = net;
  const { peep, pressureLimit: ceiling } = s, targetVT = net.targetVT;
  const cycle = 60 / s.rr, ti = cycle / 3, te = cycle - ti, Qt = targetVT / ti;
  const ni = Math.ceil(ti / dt), stepI = ti / ni, ne = Math.ceil(te / dt), stepE = te / ne;
  if (recordTrajectory && (ni + ne + 3) * n > MAX_TRAJECTORY_VALUES) throw new RangeError(`Trajectory recording needs ${ni + ne + 3} frames x ${n} units, exceeding the ${MAX_TRAJECTORY_VALUES} limit`);
  const sumX = x => { let t = 0; for (const i of act) t += x[i]; return t; };
  const checkVolumes = x => {
    for (const i of act) if (!Number.isFinite(x[i]) || net.baseVolume[i] + x[i] < -NEGATIVE_VOLUME_TOLERANCE_ML) throw new RangeError(`Negative absolute regional volume in unit ${i}: ${net.baseVolume[i] + x[i]} mL (tolerance ${NEGATIVE_VOLUME_TOLERANCE_ML})`);
  };

  let x = new Float64Array(n), prevEnd = new Float64Array(n), prevXEnd = 0, converged = false, last = null, breathCount = 0;
  for (let b = 0; b < maxBreaths; b++) {
    const xStart = Float64Array.from(x), XStart = sumX(xStart), frames = [], pv = [], excursion = new Float64Array(n);
    let ppeak = peep, ceilingActive = false, ceilingEvent = null, floorSteps = 0, vtQuad = 0, massMax = 0, quadAll = 0;
    const publish = (time, phase, pressure, X, y, flowResult, active) => {
      checkVolumes(y);
      const volume = net.eeVolume + X;
      pv.push({ volume, pressure, phase: phase === 'start' || phase === 'inspiration' ? 'inflation' : 'deflation' });
      if (!recordTrajectory) return;
      const unitVolume = new Float64Array(n);
      for (let i=0;i<n;i++) unitVolume[i] = net.baseVolume[i] + y[i];
      frames.push({ time, phase, pressure, flow: flowResult.q, volume, meanPleural: net.meanPleuralEE + net.Ecw * X, open: wopen, ceilingActive: active, unitVolume, unitFlow: flowResult.flow });
    };
    const noteStep = res => {
      for (const i of act) {
        const tol = CHORD_TOLERANCE_ML, ex = res.x[i] < -tol ? -res.x[i] : res.x[i] > net.refDelta[i] + tol ? res.x[i] - net.refDelta[i] : 0;
        if (ex > excursion[i]) excursion[i] = ex;
      }
      checkVolumes(res.x);
      massMax = Math.max(massMax, Math.abs(res.massResidual)); quadAll += res.integratedFlow;
      if (![...res.stagePressures, res.q, res.integratedFlow, res.massResidual].every(Number.isFinite)) throw new Error('Non-finite airflow step result');
    };
    const pcStep = (y, h, value) => advanceNetwork(net, y, h, { mode: 'pc', value });
    const inspirationStep = (h, t, depth = 0) => {
      if (ceilingActive) return pcStep(x, h, ceiling);
      const P0 = scalars(net, x, 'vc', Qt).P;
      if (P0 > ceiling) {
        ceilingActive = true; ceilingEvent = { time: t, pressure: P0, initial: t === 0 };
        return pcStep(x, h, ceiling);
      }
      const vc = (y, hh) => advanceNetwork(net, y, hh, { mode: 'vc', value: Qt });
      const over = r => r.stagePressures[0] > ceiling || r.stagePressures[1] > ceiling;
      const trial = vc(x, h);
      if (!over(trial)) {
        if (Math.min(P0, ...trial.stagePressures) < peep - PEEP_FLOOR_TOLERANCE) { floorSteps++; return pcStep(x, h, peep); }
        ppeak = Math.max(ppeak, P0, trial.pressure);
        return trial;
      }
      if(trial.pressure<=ceiling&&trial.stagePressures[0]>ceiling){
        if(depth>=30)throw new Error('Cannot resolve a pressure-ceiling stage excursion');
        const left=inspirationStep(h/2,t,depth+1);noteStep(left);x=left.x;vtQuad+=left.integratedFlow;
        return inspirationStep(h/2,t+h/2,depth+1);
      }
      let lo = 0, hi = h, loRes = null;
      for (let it = 0; it < BISECTION_ITERATIONS; it++) {
        const mid = (lo + hi) / 2, r = vc(x, mid);
        if (r.pressure>ceiling) hi = mid; else { lo = mid; loRes = r; }
      }
      ceilingActive = true; ceilingEvent = { time: t + lo, pressure: loRes ? loRes.pressure : P0, initial: false };
      if (!loRes) return pcStep(x, h, ceiling);
      noteStep(loRes); x = loRes.x; vtQuad += loRes.integratedFlow; ppeak = Math.max(ppeak, P0, loRes.pressure);
      return pcStep(x, h - lo, ceiling);
    };

    const wopen = (() => { let w = 0; for (let i = 0; i < n; i++) w += net.weights[i] * net.frozenOpen[i]; return w; })();
    publish(0, 'start', peep, XStart, xStart, flowAt(net, x, 'pc', peep), false);
    const startVC=flowAt(net,x,'vc',Qt);
    if(startVC.pressure>ceiling){ceilingActive=true;ceilingEvent={time:0,pressure:startVC.pressure,initial:true};}
    const opening=ceilingActive?flowAt(net,x,'pc',ceiling):startVC.pressure<peep?flowAt(net,x,'pc',peep):startVC;
    ppeak=Math.max(ppeak,opening.pressure);publish(0,'inspiration',opening.pressure,XStart,xStart,opening,ceilingActive);
    for (let j = 1; j <= ni; j++) {
      let res;
      for (let k = 0; k < substeps; k++) {
        res = inspirationStep(stepI / substeps, (j - 1) * stepI + k * stepI / substeps);
        noteStep(res); x = res.x; vtQuad += res.integratedFlow;
        if (ceilingActive) ppeak = Math.max(ppeak, ceiling);
      }
      publish(j === ni ? ti : j * stepI, 'inspiration', res.pressure, sumX(x), x, { flow: res.flow, q: res.q }, ceilingActive);
    }
    const xEI = Float64Array.from(x), XEI = sumX(xEI);
    publish(ti, 'release', peep, XEI, xEI, flowAt(net, xEI, 'pc', peep), false);
    for (let j = 0; j < ne; j++) {
      let res;
      for (let k = 0; k < substeps; k++) { res = pcStep(x, stepE / substeps, peep); noteStep(res); x = res.x; }
      publish(j === ne - 1 ? cycle : ti + (j + 1) * stepE, 'expiration', peep, sumX(x), x, { flow: res.flow, q: res.q }, false);
    }
    breathCount = b + 1;
    const XEnd = sumX(x);
    let unitResidual = 0, l1Residual=0;
    for (const i of act){const change=Math.abs(x[i]-prevEnd[i]);unitResidual=Math.max(unitResidual,change);l1Residual+=change;}
    last = { xStart, XStart, xEI, XEI, xEnd: Float64Array.from(x), XEnd, frames, pv, excursion, ppeak, ceilingActive, ceilingEvent, floorSteps, vtQuad, massMax, breathMass: XEnd - XStart - quadAll, residual: l1Residual, totalResidual:Math.abs(XEnd-prevXEnd), unitResidual, wopen };
    prevEnd = Float64Array.from(x); prevXEnd = XEnd;
    if (breathCount >= minBreaths && last.residual < periodicTolerance) { converged = true; break; }
  }

  const { xStart, XStart, xEI, XEI, xEnd, XEnd } = last, { Ecw } = net;
  let extrapolated = 0, weightTotal = 0, maxRelative = 0, meanRelative = 0, maxMl = 0;
  for (let i = 0; i < n; i++) {
    weightTotal += net.weights[i]; maxMl = Math.max(maxMl, last.excursion[i]);
    if (last.excursion[i] > 0) extrapolated += net.weights[i];
    if (net.active[i] === 1) { const rel = last.excursion[i] / net.refDelta[i]; maxRelative = Math.max(maxRelative, rel); meanRelative += net.weights[i] * rel; }
  }
  const units = patient.units.map((u, i) => {
    const on = net.active[i] === 1, base = net.baseVolume[i], emptied = xEI[i] - xEnd[i];
    return {
      id: u.id, dep: u.dep, weight: u.weight, openEE: net.frozenOpen[i], openEI: net.frozenOpen[i], volumeEE: base + xStart[i], volumeEI: base + xEI[i],
      strainEI: null, state: net.frozenOpen[i], popen: u.popen, pclose: u.pclose,
      resistance: on ? net.R[i] : null, compliance: net.C[i], tauLocal: on ? net.R[i] * net.C[i] : null,
      fractionEmptied: on && xEI[i] > 1e-9 ? emptied / xEI[i] : null, relaxedVolume: base, refDelta: net.refDelta[i], active: on, chordExcursion: last.excursion[i]
    };
  });
  const metrics = {
    eelv: net.eeVolume + XStart, vtDelivered: last.vtQuad, ppeak: last.ppeak, pplat: null, dp: null, crs: null,
    openEE: last.wopen, openEI: last.wopen, cyclic: null, over: null, closedPerfusion: null,
    meanPleuralEE: net.meanPleuralEE + Ecw * XStart, meanPleuralEI: net.meanPleuralEE + Ecw * XEI, transpulmonaryEI: null,
    volumeError: last.vtQuad - targetVT, volumeResidual: (XEI - XStart) - last.vtQuad, limited: last.ceilingActive,
    fractionEmptied: XEI > 1e-9 ? (XEI - XEnd) / XEI : null, retainedVolume: XEnd,
    tauEquivalent: net.tauEquivalent, complianceInput: net.complianceInput,
    virtualEndHoldPressure: peep + XEI / net.complianceInput, virtualAutoPeep: XEnd / net.complianceInput,
    periodicResidual: last.residual, converged, extrapolatedWeight: weightTotal > 0 ? extrapolated / weightTotal : 0
  };
  const ref = net.reference;
  const result = {
    metrics, units, pv: last.pv, settings: s, targetVT, maxPressure: last.ppeak, simulatedSeconds: breathCount * cycle, breaths: breathCount, dt,
    labels: {
      eelv: 'Start-of-final-breath gas volume (frozen-aeration airflow model)', state: 'Recruitment fraction frozen at the accepted state; not updated by this experiment',
      virtualEndHoldPressure: 'Hypothetical equilibrated pressure from end-inspiratory excess volume; no physical hold is simulated',
      virtualAutoPeep: 'Hypothetical equilibrated pressure of retained volume; not a measured auto-PEEP',
      retainedVolume: 'End-expiratory volume above the relaxed frozen PEEP reference', unavailable: 'pplat, dp, crs, over, cyclic, closedPerfusion and transpulmonaryEI are not defined by this model'
    },
    airflow: {
      version: AIRFLOW_INFO.version, params: { R0: net.R0, Rp: net.Rp }, dt, substeps, minBreaths, maxBreaths, periodicTolerance,
      chordExcursion: { maxMl, maxRelative, weightedMeanRelative: weightTotal > 0 ? meanRelative / weightTotal : 0 }, ceilingEvent: last.ceilingEvent, floorSteps: last.floorSteps, periodicResidualTotal: last.totalResidual, periodicResidualUnitMax: last.unitResidual, massResidualStepMax: last.massMax, massResidualBreath: last.breathMass,
      reference: {
        deltaZ: net.deltaZ, limited: ref.limited, targetVT: ref.targetVT, eeVolume: net.eeVolume, eiVolume: net.eiVolume, eePressure: ref.ee.pressure, eiPressure: ref.ei.pressure,
        depMean: net.depMean, sumC: net.sumC, G: net.G, Ecw, activeCount: net.activeCount, inactiveCount: n - net.activeCount, meanPleuralEE: net.meanPleuralEE
      }
    }
  };
  if (recordTrajectory) result.trajectory = { kind: 'frozen-aeration-airflow', cycle, ti, eiIndex: ni + 1, releaseIndex: ni + 2, frozenOpen: Float64Array.from(net.frozenOpen), frames: last.frames };
  return result;
}
