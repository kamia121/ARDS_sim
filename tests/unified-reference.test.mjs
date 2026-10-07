/*
 * Independent numerical verification of the unified nonlinear-flow kernel (src/unified.js).
 *
 * Part A (reference self-checks) never touches src/unified.js and always runs: it certifies the reference
 * (own elastic law, own ODE, own dense RK4, own equilibrium root, analytic linear solution) before it is used
 * to judge production.
 * Part B compares production (advanceUnified / evaluateUnified / relaxedUnified / elasticPressure /
 * simulateUnified / simulateUnifiedExperiment) against that reference. If src/unified.js is not present these
 * tests are SKIPPED with an explicit reason; a skip is not a pass.
 *
 * Assumed API (from /private/tmp/ards-sonnet-unified-engine.txt, not yet verified against code):
 *   buildUnifiedNetwork(patient, settings, mechanics) -> net (net.mult: per-unit resistance multipliers m_i)
 *   elasticPressure(net, i, V, f) -> {pressure, dV?, df?, kneeReached?}   (dV, df read as dE/dV, dE/df)
 *   evaluateUnified(net, {volume, open}, drive) / advanceUnified(net, state, h, drive) with drive
 *     {mode:'vc', value: mL/s} or {mode:'pc', value: absolute Paw}; result {state:{volume,open}, flow, q, pressure,
 *     nodePressure, integratedFlow, massResidual, numerics, ...}
 *   relaxedUnified(net, open, peep) -> {volumes, totalVolume, meanPleural}
 *   simulateUnified / simulateUnifiedExperiment(patient, settings, options) -> {trajectory:{frames,...}, metrics, ...}
 * Mechanics key names resistanceSpread / resistanceDependency are a guess from the contract text.
 * Tolerances below are draft thresholds chosen before any production run; they are not tuned to pass.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPatient, regionalVolume } from '../src/engine.js';
import * as R from './unified-reference.mjs';

let U = null, loadError = null;
try { U = await import('../src/unified.js'); } catch (error) { loadError = error; }
const kernelMissing = loadError !== null && loadError.code === 'ERR_MODULE_NOT_FOUND' && /unified\.js/.test(String(loadError.message));
const SKIP = kernelMissing ? 'src/unified.js not present yet: production comparison NOT run' : false;
const K = () => { if (!U) throw loadError; return U; };

const TOL = {
  massAbs: 1e-8,           // per-step gas-volume invariance / quadrature, mL
  rk4SelfAbs: 1e-6,        // reference RK4 h=1e-4 vs h=2e-4, mL
  pointRel: 1e-8,          // instantaneous evaluate() agreement (relative to scale)
  orderLo: 1.6, orderHi: 2.6,   // SDIRK2 observed order window
  finestErrorFraction: 5e-3,    // finest-h error as a fraction of the state excursion
  relaxedAbs: 1e-6         // relaxedUnified vs independent root, mL per unit
};
const near = (a, b, abs, rel = 0, label = '') => assert.ok(Math.abs(a - b) <= abs + rel * Math.max(Math.abs(a), Math.abs(b)), `${label} ${a} vs ${b} (|diff| ${Math.abs(a - b)} > ${abs} + ${rel}*scale)`);
const refinementCount = numerics => Object.entries(numerics ?? {}).reduce((s, [k, v]) => s + (/refine|halv|substep/i.test(k) && typeof v === 'number' ? v : 0), 0);

// ===================================================================================================
// Case builders (parameters only; shared by reference-only checks and production comparisons)
// ===================================================================================================
const SETTINGS = { peep: 5, vt: 6, rr: 20, pressureLimit: 60 };

function linearPatient(N) {
  return R.makePatient(Array.from({ length: N }, () => ({ weight: 1, dep: 0.5, rest: 500, capacity: 3500, stiffness: 15, linearCompliance: 40, fixedOpen: true, f: 0.5 })));
}
const LINEAR_MECH = { residualConductance: 0.3, patencyPower: 2 };

const NL2 = () => R.makePatient([
  { weight: 0.4, dep: 0.2, capacity: 3000, rest: 600, stiffness: 15, popen: 3, pclose: -4, tauOpen: 0.5, tauClose: 1.5, f: 0.5 },
  { weight: 0.6, dep: 0.8, capacity: 3500, rest: 800, stiffness: 18, popen: 1, pclose: -6, tauOpen: 0.7, tauClose: 2.0, f: 0.4 }
]);
const NL4 = () => R.makePatient([
  { weight: 0.15, dep: 0.1, capacity: 3000, rest: 600, stiffness: 14, popen: 3, pclose: -4, tauOpen: 0.5, tauClose: 1.5, f: 0.55 },
  { weight: 0.25, dep: 0.4, capacity: 3400, rest: 700, stiffness: 16, popen: 2, pclose: -5, tauOpen: 0.6, tauClose: 1.8, f: 0.5 },
  { weight: 0.3, dep: 0.7, capacity: 3600, rest: 800, stiffness: 18, popen: 1, pclose: -6, tauOpen: 0.7, tauClose: 2.0, f: 0.45 },
  { weight: 0.3, dep: 0.95, capacity: 3200, rest: 650, stiffness: 20, popen: 0.5, pclose: -7, tauOpen: 0.8, tauClose: 2.2, f: 0.4 }
]);
const CASE2 = [
  { name: 'N2 PC phi=1', patient: NL2, mech: {}, peep: 5, drive: { mode: 'pc', value: 22 }, T: 0.4, hs: [0.02, 0.01, 0.005] },
  { name: 'N2 VC phi=1', patient: NL2, mech: {}, peep: 5, drive: { mode: 'vc', value: 150 }, T: 0.4, hs: [0.02, 0.01, 0.005] },
  { name: 'N4 PC phi=0.3 power=2', patient: NL4, mech: { residualConductance: 0.3, patencyPower: 2 }, peep: 5, drive: { mode: 'pc', value: 22 }, T: 0.4, hs: [0.02, 0.01, 0.005] },
  { name: 'N4 VC phi=0.3 power=2', patient: NL4, mech: { residualConductance: 0.3, patencyPower: 2 }, peep: 5, drive: { mode: 'vc', value: 150 }, T: 0.4, hs: [0.02, 0.01, 0.005] },
  { name: 'N4 PC heterogeneous resistance', patient: NL4, mech: { resistanceSpread: 0.6, resistanceDependency: 0.8 }, peep: 5, drive: { mode: 'pc', value: 22 }, T: 0.4, hs: [0.02, 0.01, 0.005], heterogeneous: true }
];

// Zero net flow: open thresholds far below the actual recoil so f must rise at fixed gas volume.
const ZERO_FLOW = () => R.makePatient([
  { weight: 0.2, dep: 0.1, capacity: 3000, rest: 600, stiffness: 14, popen: 0.5, pclose: -30, tauOpen: 0.5, f: 0.3 },
  { weight: 0.3, dep: 0.4, capacity: 3400, rest: 700, stiffness: 16, popen: 0.5, pclose: -30, tauOpen: 0.6, f: 0.3 },
  { weight: 0.3, dep: 0.7, capacity: 3600, rest: 800, stiffness: 18, popen: 0.5, pclose: -30, tauOpen: 0.7, f: 0.3 },
  { weight: 0.2, dep: 0.95, capacity: 3200, rest: 650, stiffness: 20, popen: 0.5, pclose: -30, tauOpen: 0.8, f: 0.3 }
]);

const GEOM_PEEP = 8, GEOM_START_PRESSURE = 30, GEOM_MECH = { Rp: 0.0015 }, GEOM_H = 0.005, GEOM_T = 5;
function geometryPatient() {
  const p = createPatient('high', 13791, 6);
  p.units.forEach(u => { u.fixedOpen = true; });
  return p;
}

function setupCase(patient, mech, peep, multipliers = null) {
  const sys = R.makeSystem(patient, mech, multipliers);
  const f0 = Float64Array.from(patient.units, u => u.f);
  const rest = R.relaxedRoot(sys, f0, peep);
  return { patient, sys, f0, V0: rest.V, y0: R.packState(rest.V, f0) };
}
const stateOf = (V, f) => ({ volume: Float64Array.from(V), open: Float64Array.from(f) });
function buildNet(patient, mech, peep = SETTINGS.peep) { return K().buildUnifiedNetwork(patient, { ...SETTINGS, peep }, mech); }
function multipliersOf(net, n, expectOnes) {
  if (net.mult === undefined) { assert.ok(expectOnes, 'net.mult missing but resistance heterogeneity requested'); return null; }
  assert.equal(net.mult.length, n);
  const m = Float64Array.from(net.mult);
  for (const x of m) assert.ok(x > 0 && Number.isFinite(x));
  if (expectOnes) for (const x of m) assert.equal(x, 1, 'resistance multiplier must be exactly 1 at default spread/dependency');
  else assert.ok(m.some(x => Math.abs(x - 1) > 1e-6), 'heterogeneity requested but every multiplier is 1');
  return m;
}

function runProduction(net, V0, f0, drive, h, T) {
  const steps = Math.round(T / h);
  let state = stateOf(V0, f0);
  const log = { maxMass: 0, maxInvariance: 0, maxVcFreebie: 0, refinements: 0, minV: Infinity, minF: Infinity, maxF: -Infinity, steps: [], numerics: null };
  for (let k = 0; k < steps; k++) {
    const before = R.sum(state.volume), r = K().advanceUnified(net, state, h, drive), after = R.sum(r.state.volume);
    assert.ok(r.state.volume instanceof Float64Array && r.state.open instanceof Float64Array);
    log.maxMass = Math.max(log.maxMass, Math.abs(r.massResidual));
    log.maxInvariance = Math.max(log.maxInvariance, Math.abs(after - before - r.integratedFlow));
    if (drive.mode === 'vc') log.maxVcFreebie = Math.max(log.maxVcFreebie, Math.abs(after - before - drive.value * h));
    log.refinements += refinementCount(r.numerics);
    for (let i = 0; i < r.state.volume.length; i++) { log.minV = Math.min(log.minV, r.state.volume[i]); log.minF = Math.min(log.minF, r.state.open[i]); log.maxF = Math.max(log.maxF, r.state.open[i]); }
    log.numerics = r.numerics; log.last = r;
    state = r.state;
  }
  return { state, log };
}

// ===================================================================================================
// PART A - reference self-certification (always runs)
// ===================================================================================================
test('A1 reference elastic law: legacy match, monotone, C1 at rest and knee, positive, closed-form inverse', () => {
  const mech = R.mechanics();
  const patients = [createPatient('high', 13791, 32), createPatient('healthy', 4242, 32)];
  for (const p of patients) for (const u of p.units) {
    // Matches the engine's old positive-pressure inverse law for T well below the knee (z = 0.95 needs T of about 200+).
    for (const f of [0.2, 0.5, 1]) for (let T = 0; T <= 80; T += 5) {
      const V = R.aeration(mech, f) * regionalVolume(u, T), e = R.elasticOfVolume(u, V, f, mech);
      near(e.E, T, 1e-9, 1e-9, `legacy match T=${T}`);
      if (T > 0) assert.equal(e.region, 'main');
    }
    // Monotone and C1 across rest and knee.
    const knee = R.kneeOf(u, mech);
    let prev = -Infinity;
    for (let s = u.rest * Math.exp(-8); s < knee.sKnee + 2 * u.capacity; s *= 1.01) {
      const e = R.elasticOfSpecific(u, s, mech);
      assert.ok(e.E > prev, `E must increase with s at ${s}`);
      assert.ok(e.dEds > 0);
      prev = e.E;
    }
    for (const s0 of [u.rest, knee.sKnee]) {
      const d = 1e-6 * s0, lo = R.elasticOfSpecific(u, s0 - d, mech), hi = R.elasticOfSpecific(u, s0 + d, mech);
      near(lo.dEds, hi.dEds, 1e-4 * hi.dEds, 0, 'slope continuity (C1; second derivative may jump, so the one-sided gap is O(offset))');
      near(lo.E, hi.E, 3e-6 * hi.dEds * s0 + 1e-9, 0, 'value continuity');
    }
    near(R.elasticOfSpecific(u, u.rest, mech).E, 0, 1e-12);
    // Closed-form inverse round trip and positive specific volume for arbitrarily negative recoil.
    for (const E of [-5000, -200, -50, -5, -1e-3, 0, 1e-3, 5, 50, 150, knee.Eknee, knee.Eknee + 40, 2000]) {
      const s = R.specificOfPressure(u, E, mech);
      assert.ok(s > 0, `inverse specific volume must be positive for E=${E}`);
      near(R.elasticOfSpecific(u, s, mech).E, E, 1e-9, 1e-11, `round trip E=${E}`);
    }
  }
});

test('A2 reference elastic derivatives dE/dV and dE/df match finite differences in every branch', () => {
  const mech = R.mechanics();
  const u = createPatient('high', 1, 1).units[0], a = R.aeration(mech, 0.6), knee = R.kneeOf(u, mech);
  for (const s of [u.rest * 0.2, u.rest * 0.9, u.rest * 1.2, u.rest + 0.5 * u.capacity, knee.sKnee * 0.999, knee.sKnee * 1.2]) {
    const V = u.weight * a * s, f = 0.6, e = R.elasticOfVolume(u, V, f, mech);
    const dV = 1e-6 * V, df = 1e-6;
    const fdV = (R.elasticOfVolume(u, V + dV, f, mech).E - R.elasticOfVolume(u, V - dV, f, mech).E) / (2 * dV);
    const fdf = (R.elasticOfVolume(u, V, f + df, mech).E - R.elasticOfVolume(u, V, f - df, mech).E) / (2 * df);
    near(e.dEdV, fdV, 1e-5 * Math.abs(fdV));
    near(e.dEdf, fdf, 1e-5 * Math.abs(fdf));
  }
});

test('A3 reference RK4 reproduces the analytic homogeneous linear PC/VC solution and the Jacobian time constant', () => {
  for (const N of [1, 3]) {
    const patient = linearPatient(N), sys = R.makeSystem(patient, LINEAR_MECH), an = R.homogeneousLinear(patient, LINEAR_MECH);
    near(an.Rtot, 0.008 + 0.004 / ((0.3 + 0.7 * an.a) ** 2), 1e-15);
    near(an.Cunit, an.a * 40, 1e-12);
    const f0 = Float64Array.from(patient.units, u => u.f), V0 = new Float64Array(N).fill(an.restVolume(5) / N);
    const root = R.relaxedRoot(sys, f0, 5);
    near(R.sum(root.V), an.restVolume(5), 1e-9, 1e-12, 'linear rest volume');
    // eigenvalue of the V-Jacobian: slowest mode is the total-volume mode with rate 1/(Rtot*Ceff)
    const rates = R.rateExtremes(R.volumeJacobian(sys, V0, f0, { mode: 'pc', value: 5 }));
    near(-1 / rates.lambdaSlow, an.tau, 1e-7 * an.tau, 0, 'tau from Jacobian');
    // pressure step
    const step = R.integrate(sys, R.packState(V0, f0), { mode: 'pc', value: 15 }, 0.4, 1e-4);
    near(R.sum(step.V), an.pressureStep(5, 15, 0.4), 1e-6, 0, 'RK4 pressure step');
    for (let i = 0; i < N; i++) near(step.V[i], an.pressureStep(5, 15, 0.4) / N, 1e-6);
    near(step.Qint, an.pressureStep(5, 15, 0.4) - an.restVolume(5), 1e-8, 0, 'RK4 quadrature of Q equals volume change');
    // volume control
    const vc = R.integrate(sys, R.packState(V0, f0), { mode: 'vc', value: 100 }, 0.4, 1e-4);
    near(R.sum(vc.V), an.restVolume(5) + 40, 1e-9, 1e-12, 'VC total volume');
    near(vc.end.Paw, an.volumeFlowPaw(an.restVolume(5) + 40, 100), 1e-8, 1e-12, 'VC required Paw');
  }
});

for (const cfg of CASE2) {
  test(`A4 reference ${cfg.name}: RK4 self-convergence, quadrature invariance, smooth physical path`, t => {
    const c = setupCase(cfg.patient(), cfg.mech, cfg.peep);
    const fine = R.integrate(c.sys, c.y0, cfg.drive, cfg.T, 1e-4), coarse = R.integrate(c.sys, c.y0, cfg.drive, cfg.T, 2e-4);
    assert.ok(R.maxAbsDiff(fine.y, coarse.y) < TOL.rk4SelfAbs, `RK4 self-convergence ${R.maxAbsDiff(fine.y, coarse.y)}`);
    near(R.sum(fine.V) - R.sum(c.V0), fine.Qint, 1e-9, 0, 'RK4 volume change equals quadrature of its own net flow');
    if (cfg.drive.mode === 'vc') near(R.sum(fine.V) - R.sum(c.V0), cfg.drive.value * cfg.T, 1e-9, 0, 'VC total volume = Q T');
    assert.ok(!fine.path.regimeChanged, 'an f-rate threshold regime change would make the order test invalid');
    assert.ok(fine.path.minGap > 0.05, `threshold gap too small: ${fine.path.minGap}`);
    assert.ok(fine.path.minV > 0 && fine.path.minF > 0 && fine.path.maxF < 1);
    assert.ok(fine.path.minSpecificOverRest > 1, 'path must stay above the rest specific volume (no sub-rest branch)');
    const df = R.maxAbsDiff(fine.f, c.f0);
    assert.ok(df > 0.02, `f must evolve measurably, max |df| = ${df}`);
    t.diagnostic(`${cfg.name}: |dV|max=${R.maxAbsDiff(fine.V, c.V0).toFixed(2)} mL, |df|max=${df.toFixed(3)}, Paw ${fine.first.Paw.toFixed(2)}->${fine.end.Paw.toFixed(2)}, minGap=${fine.path.minGap.toFixed(2)}`);
  });
}

test('A5 reference zero-net-flow: gas conserved, f rises at fixed gas, pressure falls', t => {
  const c = setupCase(ZERO_FLOW(), {}, 10), drive = { mode: 'vc', value: 0 };
  const run = R.integrate(c.sys, c.y0, drive, 0.5, 1e-4);
  near(R.sum(run.V), R.sum(c.V0), 1e-9, 0, 'total gas');
  assert.ok(!run.path.regimeChanged && run.path.minGap > 0.05);
  const df = Array.from(run.f, (x, i) => x - c.f0[i]);
  assert.ok(df.every(x => x > 0.01), `every unit must open: ${df}`);
  assert.ok(R.maxAbsDiff(run.V, c.V0) > 1, 'regional redistribution expected');
  assert.ok(run.end.Paw < run.first.Paw - 0.5, `pressure must come down: ${run.first.Paw} -> ${run.end.Paw}`);
  t.diagnostic(`zero-flow: Paw ${run.first.Paw.toFixed(3)} -> ${run.end.Paw.toFixed(3)}, df=${df.map(x => x.toFixed(3))}, |dV|max=${R.maxAbsDiff(run.V, c.V0).toFixed(3)}`);
});

test('A6 reference frozen-f geometry: relaxed root has zero flow and long PC relaxes onto it', t => {
  const patient = geometryPatient(), sys = R.makeSystem(patient, GEOM_MECH), f0 = Float64Array.from(patient.units, u => u.f);
  const hi = R.relaxedRoot(sys, f0, GEOM_START_PRESSURE), lo = R.relaxedRoot(sys, f0, GEOM_PEEP);
  const e = R.evaluate(sys, lo.V, f0, { mode: 'pc', value: GEOM_PEEP });
  for (const x of e.dV) assert.ok(Math.abs(x) < 1e-6, `root flow ${x}`);
  const rates = R.rateExtremes(R.volumeJacobian(sys, lo.V, f0, { mode: 'pc', value: GEOM_PEEP }));
  const tauSlow = -1 / rates.lambdaSlow, hMax = 2.5 / -rates.lambdaFast;
  assert.ok(GEOM_T / tauSlow >= 11, `5 s must span >= 11 slow time constants, got ${(GEOM_T / tauSlow).toFixed(2)}`);
  assert.ok(2e-4 < hMax, `RK4 h=2e-4 unstable vs fastest rate (hMax ${hMax})`);
  const run = R.integrate(sys, R.packState(hi.V, f0), { mode: 'pc', value: GEOM_PEEP }, GEOM_T, 5e-4);
  const err = R.maxAbsDiff(run.V, lo.V), scale = R.maxAbsDiff(hi.V, lo.V);
  assert.ok(err < 3 * Math.exp(-GEOM_T / tauSlow) * scale + 1e-6, `RK4 not relaxed: ${err}`);
  t.diagnostic(`geometry: tauSlow=${tauSlow.toFixed(3)} s, fast rate=${rates.lambdaFast.toFixed(1)}/s, excursion=${scale.toFixed(1)} mL, residual=${err.toExponential(2)} mL, total ${R.sum(hi.V).toFixed(0)} -> ${R.sum(lo.V).toFixed(0)}`);
});

// ===================================================================================================
// PART B - production against the reference (skipped, not passed, while src/unified.js is absent)
// ===================================================================================================
test('B0 src/unified.js loads and exports the contract API', { skip: SKIP }, () => {
  const mod = K();
  for (const name of ['UNIFIED_INFO', 'DEFAULT_MECHANICS', 'normalizeMechanics', 'buildUnifiedNetwork', 'elasticPressure', 'evaluateUnified', 'relaxedUnified', 'advanceUnified', 'simulateUnified']) assert.ok(name in mod, `missing export ${name}`);
});

test('B1 case 1 analytic homogeneous linear fixed-f: PC step response, order ~2 on h=.05/.025/.0125', { skip: SKIP }, t => {
  for (const N of [1, 3]) {
    const patient = linearPatient(N), an = R.homogeneousLinear(patient, LINEAR_MECH), net = buildNet(patient, LINEAR_MECH);
    multipliersOf(net, N, true);
    const f0 = Float64Array.from(patient.units, u => u.f), V0 = new Float64Array(N).fill(an.restVolume(5) / N);
    const T = 0.4, hs = [0.05, 0.025, 0.0125], drive = { mode: 'pc', value: 15 }, exact = an.pressureStep(5, 15, T);
    const errs = hs.map(h => {
      const { state, log } = runProduction(net, V0, f0, drive, h, T);
      assert.equal(log.refinements, 0, 'order test requires no internal step refinement');
      assert.ok(log.maxMass < TOL.massAbs && log.maxInvariance < TOL.massAbs, `mass ${log.maxMass} ${log.maxInvariance}`);
      for (let i = 0; i < N; i++) assert.equal(state.open[i], f0[i], 'fixedOpen must freeze f exactly');
      return Math.abs(R.sum(state.volume) - exact);
    });
    const orders = R.observedOrders(hs, errs);
    t.diagnostic(`N=${N} tau=${an.tau.toFixed(4)} errors=${errs.map(e => e.toExponential(2))} orders=${orders.map(o => o.toFixed(2))}`);
    for (const o of orders) assert.ok(o > TOL.orderLo && o < TOL.orderHi, `observed order ${o}`);
    assert.ok(errs[2] < TOL.finestErrorFraction * Math.abs(exact - an.restVolume(5)));
  }
});

test('B1 case 1 analytic homogeneous linear fixed-f: VC total volume V0+Qt and required Paw match analytic Rtot/Ceff', { skip: SKIP }, () => {
  for (const N of [1, 3]) {
    const patient = linearPatient(N), an = R.homogeneousLinear(patient, LINEAR_MECH), net = buildNet(patient, LINEAR_MECH);
    const f0 = Float64Array.from(patient.units, u => u.f), V0 = new Float64Array(N).fill(an.restVolume(5) / N), Q = 100, h = 0.025;
    let state = stateOf(V0, f0);
    for (let k = 1; k <= 16; k++) {
      const r = K().advanceUnified(net, state, h, { mode: 'vc', value: Q });
      state = r.state;
      const V = an.restVolume(5) + Q * k * h;
      near(R.sum(state.volume), V, 1e-8, 1e-12, `VC total volume step ${k}`);
      near(r.pressure, an.volumeFlowPaw(V, Q), 1e-7, 1e-10, `VC required Paw step ${k}`);
      near(r.q, Q, 1e-9);
      for (let i = 0; i < N; i++) near(state.volume[i], V / N, 1e-8, 1e-12);
    }
  }
});

test('B1 case 1: PC pressure law value at rest matches analytic (evaluateUnified, no step)', { skip: SKIP }, () => {
  const patient = linearPatient(1), an = R.homogeneousLinear(patient, LINEAR_MECH), net = buildNet(patient, LINEAR_MECH);
  const V0 = an.restVolume(5), r = K().evaluateUnified(net, stateOf([V0], [0.5]), { mode: 'vc', value: 0 });
  near(r.pressure, 5, 1e-9, 0, 'required Paw at the analytic rest volume must equal PEEP');
  near(r.q, 0, 1e-12);
  const p = K().evaluateUnified(net, stateOf([V0], [0.5]), { mode: 'pc', value: 15 });
  near(p.q, (15 - 5) / an.Rtot, 1e-9, 1e-10, 'initial step flow = dP/Rtot');
});

for (const cfg of CASE2) {
  test(`B2 case 2 nonlinear evolving f, ${cfg.name}: instantaneous evaluation vs reference`, { skip: SKIP }, () => {
    const patient = cfg.patient(), net = buildNet(patient, cfg.mech, cfg.peep), n = patient.units.length;
    const m = multipliersOf(net, n, !cfg.heterogeneous), c = setupCase(patient, cfg.mech, cfg.peep, m);
    const mid = R.integrate(c.sys, c.y0, cfg.drive, cfg.T / 2, 1e-4);
    for (const [V, f] of [[c.V0, c.f0], [mid.V, mid.f]]) {
      const ref = R.evaluate(c.sys, V, f, cfg.drive), got = K().evaluateUnified(net, stateOf(V, f), cfg.drive);
      const scale = Math.max(...ref.dV.map(Math.abs), 1);
      for (let i = 0; i < n; i++) near(got.flow[i], ref.dV[i], TOL.pointRel * scale, 0, `unit flow ${i}`);
      near(got.q, ref.Q, TOL.pointRel * scale, 0, 'net flow');
      near(got.pressure, ref.Paw, 1e-7, TOL.pointRel, 'Paw');
      near(got.nodePressure, ref.Pnode, 1e-7, TOL.pointRel, 'node pressure');
    }
  });

  test(`B2 case 2 nonlinear evolving f, ${cfg.name}: SDIRK2 vs dense RK4 h=1e-4, order, mass, bounds`, { skip: SKIP }, t => {
    const patient = cfg.patient(), net = buildNet(patient, cfg.mech, cfg.peep), n = patient.units.length;
    const m = multipliersOf(net, n, !cfg.heterogeneous), c = setupCase(patient, cfg.mech, cfg.peep, m);
    const truth = R.integrate(c.sys, c.y0, cfg.drive, cfg.T, 1e-4);
    assert.ok(!truth.path.regimeChanged && truth.path.minGap > 0.05, 'reference path must be smooth for an order test');
    const excursionV = R.maxAbsDiff(truth.V, c.V0), excursionF = R.maxAbsDiff(truth.f, c.f0);
    const errV = [], errF = [], errTotal = [];
    for (const h of cfg.hs) {
      const { state, log } = runProduction(net, c.V0, c.f0, cfg.drive, h, cfg.T);
      assert.ok(log.maxMass < TOL.massAbs, `reported massResidual ${log.maxMass}`);
      assert.ok(log.maxInvariance < TOL.massAbs, `recomputed sum dV - integratedFlow ${log.maxInvariance}`);
      if (cfg.drive.mode === 'vc') assert.ok(log.maxVcFreebie < TOL.massAbs, `VC sum dV must equal Q h independently of any stage quadrature: ${log.maxVcFreebie}`);
      assert.ok(log.minV > 0 && log.minF >= 0 && log.maxF <= 1, `bounds V>${log.minV} f in [${log.minF}, ${log.maxF}]`);
      errV.push(R.maxAbsDiff(state.volume, truth.V)); errF.push(R.maxAbsDiff(state.open, truth.f));
      errTotal.push(Math.abs(R.sum(state.volume) - R.sum(truth.V)));
      t.diagnostic(`${cfg.name} h=${h}: refinements=${log.refinements} numerics=${JSON.stringify(log.numerics)}`);
    }
    const orders = R.observedOrders(cfg.hs, errV), ordersF = R.observedOrders(cfg.hs, errF);
    t.diagnostic(`${cfg.name}: errV=${errV.map(e => e.toExponential(2))} orders V=${orders.map(o => o.toFixed(2))} errF=${errF.map(e => e.toExponential(2))} orders f=${ordersF.map(o => o.toFixed(2))} errTotal=${errTotal.map(e => e.toExponential(2))}`);
    for (const o of [...orders, ...ordersF]) assert.ok(o > TOL.orderLo && o < TOL.orderHi, `observed order ${o}`);
    assert.ok(errV.at(-1) < TOL.finestErrorFraction * excursionV, `finest V error ${errV.at(-1)} vs excursion ${excursionV}`);
    assert.ok(errF.at(-1) < TOL.finestErrorFraction * excursionF, `finest f error ${errF.at(-1)} vs excursion ${excursionF}`);
    if (cfg.drive.mode === 'vc') assert.ok(errTotal.every(e => e < 1e-8), 'VC total volume must be exact for every h');
  });
}

test('B3 case 3 zero net flow (VC Q=0) while opening changes f: gas conserved, pressure falls, f cannot create gas', { skip: SKIP }, t => {
  const patient = ZERO_FLOW(), c = setupCase(patient, {}, 10), net = buildNet(patient, {}, 10), drive = { mode: 'vc', value: 0 };
  const truth = R.integrate(c.sys, c.y0, drive, 0.5, 1e-4);
  const p0 = K().evaluateUnified(net, stateOf(c.V0, c.f0), drive).pressure;
  near(p0, truth.first.Paw, 1e-7, TOL.pointRel, 'initial required pressure');
  const { state, log } = runProduction(net, c.V0, c.f0, drive, 0.01, 0.5);
  assert.ok(log.maxVcFreebie < TOL.massAbs && log.maxInvariance < TOL.massAbs, `gas created by f update: ${log.maxVcFreebie}`);
  near(R.sum(state.volume), R.sum(c.V0), 1e-8, 1e-12, 'total gas after the run');
  for (let i = 0; i < c.f0.length; i++) assert.ok(state.open[i] > c.f0[i] + 0.01, `unit ${i} should open`);
  const pEnd = log.last.pressure;
  assert.ok(pEnd < p0 - 0.5, `actual pressure must come down: ${p0} -> ${pEnd}`);
  near(pEnd, truth.end.Paw, 0.05, 0, 'end pressure vs RK4 reference');
  assert.ok(R.maxAbsDiff(state.volume, c.V0) > 1, 'regional redistribution expected');
  near(R.maxAbsDiff(state.volume, truth.V), 0, 0.05 * R.maxAbsDiff(truth.V, c.V0), 0, 'regional volumes vs RK4 reference');
  t.diagnostic(`zero-flow production: Paw ${p0.toFixed(3)} -> ${pEnd.toFixed(3)} (ref ${truth.end.Paw.toFixed(3)}), numerics=${JSON.stringify(log.numerics)}`);
});

test('B4 case 4 pressure law: public elasticPressure vs reference (old law, sub-rest barrier, knee, derivatives)', { skip: SKIP }, () => {
  const mech = R.mechanics(), patient = createPatient('high', 13791, 24), net = buildNet(patient, {});
  const ep = (i, V, f) => K().elasticPressure(net, i, V, f);
  for (let i = 0; i < patient.units.length; i++) {
    const u = patient.units[i];
    for (const f of [0.2, 0.5, 1]) {
      const a = R.aeration(mech, f);
      for (let T = 0; T <= 80; T += 5) near(ep(i, a * regionalVolume(u, T), f).pressure, T, 1e-8, 1e-9, `old law T=${T} f=${f}`);
      const knee = R.kneeOf(u, mech);
      let prev = -Infinity;
      for (const s of [u.rest * 0.05, u.rest * 0.3, u.rest * 0.8, u.rest * 0.999, u.rest, u.rest * 1.001, u.rest + 0.5 * u.capacity, knee.sKnee * 0.999, knee.sKnee, knee.sKnee * 1.001, knee.sKnee + u.capacity]) {
        const V = u.weight * a * s, ref = R.elasticOfVolume(u, V, f, mech), got = ep(i, V, f);
        near(got.pressure, ref.E, 1e-8, 1e-9, `E at s=${s}`);
        assert.ok(got.pressure > prev, 'production elasticPressure must be strictly monotone in V');
        prev = got.pressure;
        if (Number.isFinite(got.dV)) near(got.dV, ref.dEdV, 1e-7 * Math.abs(ref.dEdV), 0, 'dE/dV');
        if (Number.isFinite(got.df)) near(got.df, ref.dEdf, 1e-7 * Math.abs(ref.dEdf), 0, 'dE/df');
        if (got.kneeReached !== undefined && s > knee.sKnee * (1 + 1e-9)) assert.ok(got.kneeReached, `kneeReached flag above knee at s=${s}`);
        if (got.kneeReached !== undefined && s < knee.sKnee * (1 - 1e-9)) assert.ok(!got.kneeReached, `kneeReached flag below knee at s=${s}`);
      }
      const V = u.weight * a * u.rest, d = 1e-6 * V;
      near((ep(i, V + d, f).pressure - ep(i, V, f).pressure) / d, (ep(i, V, f).pressure - ep(i, V - d, f).pressure) / d, 1e-4 * Math.abs(R.elasticOfVolume(u, V, f, mech).dEdV), 0, 'C1 at rest specific volume');
    }
  }
});

test('B5 case 5 frozen f, actual geometry: long PC at PEEP relaxes onto the independent relaxed root; relaxedUnified agrees', { skip: SKIP }, t => {
  const patient = geometryPatient(), net = buildNet(patient, GEOM_MECH, GEOM_PEEP), n = patient.units.length;
  const m = multipliersOf(net, n, true), c = setupCase(patient, GEOM_MECH, GEOM_PEEP, m);
  const hi = R.relaxedRoot(c.sys, c.f0, GEOM_START_PRESSURE), lo = R.relaxedRoot(c.sys, c.f0, GEOM_PEEP);
  const rates = R.rateExtremes(R.volumeJacobian(c.sys, lo.V, c.f0, { mode: 'pc', value: GEOM_PEEP })), tauSlow = -1 / rates.lambdaSlow;
  const rel = K().relaxedUnified(net, Float64Array.from(c.f0), GEOM_PEEP);
  for (let i = 0; i < n; i++) near(rel.volumes[i], lo.V[i], TOL.relaxedAbs, 1e-8, `relaxed volume unit ${i}`);
  near(rel.totalVolume, lo.total, TOL.relaxedAbs * n, 1e-8, 'relaxed total volume');
  near(rel.meanPleural, R.evaluate(c.sys, lo.V, c.f0, { mode: 'pc', value: GEOM_PEEP }).meanPleural, 1e-6, 1e-8, 'relaxed mean pleural pressure');
  const { state, log } = runProduction(net, hi.V, c.f0, { mode: 'pc', value: GEOM_PEEP }, GEOM_H, GEOM_T);
  const scale = R.maxAbsDiff(hi.V, lo.V), allowed = 3 * Math.exp(-GEOM_T / tauSlow) * scale + 1e-6;
  const err = R.maxAbsDiff(state.volume, lo.V);
  t.diagnostic(`frozen-f: tauSlow=${tauSlow.toFixed(3)} s, error to independent root ${err.toExponential(2)} mL (allowed ${allowed.toExponential(2)}), refinements=${log.refinements}`);
  assert.ok(err < allowed, `not relaxed onto the independent root: ${err} > ${allowed}`);
  assert.ok(log.maxMass < TOL.massAbs && log.maxInvariance < TOL.massAbs);
  for (let i = 0; i < n; i++) assert.equal(state.open[i], c.f0[i], 'frozen f must not change');
  assert.ok(log.minV > 0);
  // Not-converged honesty: a 0.05 s run must NOT be reported anywhere near the relaxed state.
  const short = runProduction(net, hi.V, c.f0, { mode: 'pc', value: GEOM_PEEP }, GEOM_H, 0.05);
  assert.ok(R.maxAbsDiff(short.state.volume, lo.V) > 0.05 * scale, 'short run unexpectedly relaxed');
});

test('B6 case 6 simulateUnified smoke: extreme VT and caps, frame continuity of gas and f, internal consistency', { skip: SKIP }, t => {
  const base = createPatient('high', 13791, 48);
  const scenarios = [
    { name: 'VT 1 mL/kg', settings: { peep: 5, vt: 1, rr: 20, pressureLimit: 45 } },
    { name: 'VT 14 mL/kg high cap', settings: { peep: 8, vt: 14, rr: 12, pressureLimit: 150 } },
    { name: 'VT 14 mL/kg low cap', settings: { peep: 8, vt: 14, rr: 12, pressureLimit: 30 } }
  ];
  for (const sc of scenarios) {
    const patient = structuredClone(base), res = K().simulateUnified(patient, sc.settings, { breaths: 3, dt: 0.1, recordTrajectory: true });
    const frames = (res.trajectory ?? res).frames;
    assert.ok(Array.isArray(frames) && frames.length > 4, `${sc.name}: frames`);
    let maxFlow = 0;
    for (const fr of frames) maxFlow = Math.max(maxFlow, Math.abs(fr.flow));
    for (let k = 0; k < frames.length; k++) {
      const fr = frames[k];
      assert.ok(Number.isFinite(fr.volume) && fr.volume > 0, `${sc.name}: volume frame ${k}`);
      near(R.sum(fr.unitVolume), fr.volume, 1e-6, 1e-9, `${sc.name}: sum unitVolume`);
      assert.ok(Array.from(fr.unitOpen).every(x => x >= 0 && x <= 1), `${sc.name}: unitOpen bounds`);
      if (fr.unitFlow) near(R.sum(fr.unitFlow), fr.flow, 1e-6, 1e-9, `${sc.name}: sum unitFlow`);
      assert.ok(fr.pressure <= sc.settings.pressureLimit + 1e-5 || fr.phase !== 'inspiration', `${sc.name}: pressure above ceiling in inspiration: ${fr.pressure}`);
      if (k === 0) continue;
      const prev = frames[k - 1], dt = fr.time - prev.time;
      assert.ok(dt >= -1e-12, `${sc.name}: time must not go backwards`);
      if (dt < 1e-9) {
        near(fr.volume, prev.volume, 1e-8, 1e-12, `${sc.name}: gas volume jumped across a zero-time frame ${k}`);
        near(R.maxAbsDiff(fr.unitOpen, prev.unitOpen), 0, 1e-12, 0, `${sc.name}: f jumped across a zero-time frame ${k}`);
        near(R.maxAbsDiff(fr.unitVolume, prev.unitVolume), 0, 1e-8, 1e-12, `${sc.name}: regional gas jumped across a zero-time frame ${k}`);
      } else {
        const bound = 1.25 * dt * Math.max(Math.abs(fr.flow), Math.abs(prev.flow)) + 1e-6;
        assert.ok(Math.abs(fr.volume - prev.volume) <= bound, `${sc.name}: gas change ${fr.volume - prev.volume} between frames ${k - 1},${k} exceeds flow bound ${bound}`);
      }
    }
    const m = res.metrics ?? {};
    if (m.converged !== undefined) { assert.equal(typeof m.converged, 'boolean'); assert.ok(Number.isFinite(m.periodicResidual), 'periodicResidual must be reported with converged'); }
    t.diagnostic(`${sc.name}: frames=${frames.length}, max|flow|=${maxFlow.toFixed(1)} mL/s, converged=${m.converged}, periodicResidual=${m.periodicResidual}, numerics=${JSON.stringify(res.unified?.numerics ?? null).slice(0, 300)}`);
  }
});

test('B6 case 6 NPV translation: external drive re-expresses the matched airway-drive run (full simulate)', { skip: SKIP }, () => {
  const base = createPatient('high', 13791, 48), settings = { peep: 8, vt: 6, rr: 20, pressureLimit: 45 }, opts = { breaths: 3, dt: 0.1, recordTrajectory: true };
  const airway = K().simulateUnified(structuredClone(base), settings, opts);
  const npv = K().simulateUnifiedExperiment(structuredClone(base), { ...settings, experiment: { drive: 'external' } }, opts);
  const a = (airway.trajectory ?? airway).frames, e = (npv.trajectory ?? npv).frames;
  assert.equal(e.length, a.length);
  for (let k = 0; k < a.length; k++) {
    const p = a[k].pressure;
    near(e[k].time, a[k].time, 1e-12);
    assert.equal(e[k].pressure, 0, 'airway pressure must be zero under external drive');
    near(e[k].externalPressure, -p, 1e-9, 0, 'external pressure');
    near(e[k].transrespPressure, p, 1e-9, 0, 'transrespiratory pressure');
    near(e[k].volume, a[k].volume, 1e-9, 1e-12, 'gas volume');
    near(R.maxAbsDiff(e[k].unitVolume, a[k].unitVolume), 0, 1e-9, 0, 'regional gas');
    near(R.maxAbsDiff(e[k].unitOpen, a[k].unitOpen), 0, 1e-12, 0, 'open fraction');
    near(e[k].flow, a[k].flow, 1e-9, 1e-12, 'flow');
    near(e[k].meanPleural, a[k].meanPleural - p, 1e-9, 1e-12, 'mean pleural shift');
    near(e[k].meanAlveolar, a[k].meanAlveolar - p, 1e-9, 1e-12, 'mean alveolar shift');
    for (let i = 0; i < a[k].unitAlveolar.length; i++) near(e[k].unitAlveolar[i], a[k].unitAlveolar[i] - p, 1e-9, 1e-12, 'unit alveolar shift');
    near(e[k].meanAlveolar - e[k].meanPleural, a[k].meanAlveolar - a[k].meanPleural, 1e-9, 1e-12, 'true transpulmonary pressure unchanged');
  }
});
