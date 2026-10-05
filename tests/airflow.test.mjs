import test from 'node:test';
import assert from 'node:assert/strict';
import { createPatient, frozenReference, MAX_TRAJECTORY_VALUES } from '../src/engine.js';
import { AIRFLOW_INFO, NEGATIVE_VOLUME_TOLERANCE_ML, advanceNetwork, buildFrozenNetwork, evaluateFlow, simulateAirflow } from '../src/airflow.js';

const near = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b} (tol ${tol})`);
const sum = arr => Array.from(arr).reduce((s, x) => s + x, 0);
const PEEP = 8, SETTINGS = { peep: PEEP, vt: 6, rr: 20 };

/** Fixed-open linear patient: unit volume = w*(rest + lc*tp), so the chord compliance is exactly w*lc. */
function linearPatient(specs, { ew = 0.01, grad = 0, offset = 2, vref = 2000 } = {}) {
  const p = createPatient('healthy', 1, specs.length);
  Object.assign(p, { baselinePleural: offset, pleuralGradient: grad, chestWallElastance: ew, chestWallReferenceVolume: vref });
  specs.forEach((s, i) => Object.assign(p.units[i], { weight: s.w, rest: s.rest ?? 1000 * s.w, linearCompliance: s.lc, f: s.f ?? 1, fixedOpen: true, dep: s.dep ?? 0 }));
  return p;
}
const advanceMany = (net, x0, T, steps, drive) => {
  let x = Float64Array.from(x0), integrated = 0, last;
  for (let k = 0; k < steps; k++) { last = advanceNetwork(net, x, T / steps, drive); x = last.x; integrated += last.integratedFlow; }
  return { x, last, integrated };
};
// Single-compartment analytic solution of M x' + K x = p with M = R0 + Rp, K = 1/C + Ecw.
const analyticPC = ({ C, Ecw, R0, Rp }, p, x0, t) => { const K = 1 / C + Ecw, M = R0 + Rp, xinf = p / K; return xinf + (x0 - xinf) * Math.exp(-K * t / M); };

test('frozenReference is readonly, keeps f bitwise, honours VT and the dt0 ceiling', () => {
  for (const kind of ['high', 'low', 'wall', 'healthy']) {
    const p = createPatient(kind, 99, 96);
    p.units.forEach((u, i) => { u.f = (i % 7) / 6; });
    const before = structuredClone(p), f = p.units.map(u => u.f);
    const ref = frozenReference(p, { peep: 10, vt: kind === 'healthy' ? 4 : 6 });
    assert.deepStrictEqual(p, before, kind);
    ref.ee.units.forEach((u, i) => { assert.ok(Object.is(u.f, f[i])); assert.ok(Object.is(ref.ei.units[i].f, f[i])); });
    near(ref.ee.pressure, 10, 1e-6); near(ref.ei.volume - ref.ee.volume, ref.targetVT, 1e-4, kind);
    near(sum(ref.ee.units.map(u => u.v)), ref.ee.volume, 1e-6); assert.ok(ref.deltaZ > 0 && ref.limited === false);
    assert.equal(ref.settings.peep, 10);
  }
  const p = createPatient('low', 3, 64), lim = frozenReference(p, { peep: 8, vt: 12, pressureLimit: 14 });
  assert.equal(lim.limited, true); near(lim.ei.pressure, 14, 1e-6); assert.ok(lim.ei.volume - lim.ee.volume < lim.targetVT);
  assert.throws(() => frozenReference(p, { peep: 8, pressureLimit: 8 }), RangeError);
  assert.throws(() => frozenReference(p, { peep: -1 }), RangeError);
  assert.throws(() => frozenReference(null, {}), TypeError);
  const closed = createPatient('high', 3, 8); closed.units.forEach(u => { u.f = 0; });
  assert.throws(() => frozenReference(closed, {}), RangeError);
});

test('AIRFLOW_INFO states version, defaults and uncalibrated frozen assumptions', () => {
  assert.equal(AIRFLOW_INFO.version, 1);
  assert.deepEqual({ ...AIRFLOW_INFO.defaults }, { R0: 0.008, Rp: 0.004 });
  assert.match(AIRFLOW_INFO.calibration, /Uncalibrated/);
  assert.ok(AIRFLOW_INFO.assumptions.some(a => /frozen/i.test(a)));
  assert.ok(Object.isFrozen(AIRFLOW_INFO));
});

test('network arrays follow the contract: chord C, R = Rp/weight, inactive paths skipped', () => {
  const p = createPatient('high', 5, 64);
  p.units[3].f = 0; p.units[4].weight = 0;
  const before = structuredClone(p), net = buildFrozenNetwork(p, SETTINGS, { R0: 0.01, Rp: 0.02 }), ref = net.reference;
  assert.deepStrictEqual(p, before);
  for (const key of ['C', 'R', 'baseVolume', 'frozenOpen', 'refDelta', 'weights', 'dep']) assert.ok(net[key] instanceof Float64Array && net[key].length === 64, key);
  assert.equal(net.active[3], 0); assert.equal(net.active[4], 0); assert.equal(net.C[3], 0);
  for (const i of net.activeIndices) {
    near(net.C[i], (ref.ei.units[i].v - ref.ee.units[i].v) / ref.deltaZ, 1e-12); near(net.R[i], 0.02 / p.units[i].weight, 1e-12);
    assert.ok(Number.isFinite(net.R[i]) && net.C[i] > 0);
  }
  near(net.sumC * ref.deltaZ, ref.ei.volume - ref.ee.volume, 1e-8);
  assert.equal(net.R0, 0.01); assert.equal(net.Rp, 0.02);
  near(net.complianceInput, 1 / (1 / net.sumC + p.chestWallElastance), 1e-12);
  near(net.tauEquivalent, (0.01 + 1 / net.G) * net.complianceInput, 1e-12);
  const defaults = buildFrozenNetwork(p, SETTINGS);
  assert.equal(defaults.R0, 0.008); assert.equal(defaults.Rp, 0.004);
});

test('invalid params, null reference and bad step inputs are rejected', () => {
  const p = createPatient('high', 5, 16), net = buildFrozenNetwork(p, SETTINGS), x = new Float64Array(16);
  for (const bad of [{ R0: -0.001 }, { Rp: 0 }, { Rp: -1 }, { R0: NaN }, { Rp: Infinity }, { foo: 1 }]) assert.throws(() => buildFrozenNetwork(p, SETTINGS, bad), RangeError, JSON.stringify(bad));
  for (const bad of [{ R0: '1' }, null, [], 4]) assert.throws(() => buildFrozenNetwork(p, SETTINGS, bad), TypeError);
  assert.throws(() => buildFrozenNetwork(null, SETTINGS), TypeError);
  assert.throws(() => buildFrozenNetwork({ units: [] }, SETTINGS), TypeError);
  const closed = createPatient('high', 5, 8); closed.units.forEach(u => { u.f = 0; });
  assert.throws(() => buildFrozenNetwork(closed, SETTINGS), RangeError);
  for (const h of [0, -1, NaN, Infinity, '1']) assert.throws(() => advanceNetwork(net, x, h, { mode: 'pc', value: 10 }), RangeError, String(h));
  assert.throws(() => advanceNetwork(net, x, 0.1, { mode: 'xx', value: 10 }), TypeError);
  assert.throws(() => advanceNetwork(net, x, 0.1, { mode: 'pc', value: NaN }), TypeError);
  assert.throws(() => advanceNetwork(net, new Float64Array(3), 0.1, { mode: 'pc', value: 10 }), TypeError);
  assert.throws(() => advanceNetwork(net, [...x], 0.1, { mode: 'pc', value: 10 }), TypeError);
  assert.throws(() => advanceNetwork(null, x, 0.1, { mode: 'pc', value: 10 }), TypeError);
  assert.throws(() => advanceNetwork(net, x, 0.1), TypeError);
  assert.throws(() => simulateAirflow(p, SETTINGS, { params: { Rp: 0 } }), RangeError);
  for (const bad of [{ dt: 0 }, { dt: 2 }, { substeps: 0 }, { substeps: 1.5 }, { minBreaths: 5, maxBreaths: 4 }, { periodicTolerance: 0 }, { periodicTolerance: NaN }]) assert.throws(() => simulateAirflow(p, SETTINGS, bad), RangeError, JSON.stringify(bad));
  assert.throws(() => simulateAirflow(p, SETTINGS, { recordTrajectory: 1 }), TypeError);
});

test('N=1 SDIRK PC and VC match analytic solutions including central resistance and chest wall', () => {
  const params = { R0: 0.005, Rp: 0.01 }, C = 50, Ecw = 0.01;
  const net = buildFrozenNetwork(linearPatient([{ w: 1, lc: C }], { ew: Ecw }), SETTINGS, params);
  near(net.C[0], C, 1e-9); near(net.R[0], 0.01, 1e-15); assert.equal(net.G, 100);
  const x0 = Float64Array.of(7), p = 10, T = 0.6, K = 1 / C + Ecw, M = 0.015;
  const pc = advanceMany(net, x0, T, 96, { mode: 'pc', value: PEEP + p });
  const exact = analyticPC({ C, Ecw, R0: 0.005, Rp: 0.01 }, p, 7, T);
  near(pc.x[0], exact, 2e-5 * Math.abs(exact), 'PC state');
  near(pc.last.q, (p - K * pc.x[0]) / M, 1e-12, 'PC closed-form flow');
  near(pc.last.flow[0], pc.last.q, 1e-12); assert.equal(pc.last.pressure, PEEP + p);
  near(pc.integrated, exact - 7, 2e-5 * Math.abs(exact - 7), 'PC quadrature volume');
  const Q = 80, vc = advanceMany(net, x0, T, 6, { mode: 'vc', value: Q });
  near(vc.x[0], 7 + Q * T, 1e-9, 'VC linear volume');
  near(vc.last.pressure, PEEP + (0.005 + 0.01) * Q + (7 + Q * T) * K, 1e-9, 'VC pressure with R0, Rp and chest wall');
  near(vc.last.q, Q, 1e-12); near(vc.last.flow[0], Q, 1e-12); near(vc.integrated, Q * T, 1e-9);
  assert.deepEqual(vc.last.stagePressures.length, 2);
  near(evaluateFlow(net, x0, { mode: 'pc', value: PEEP }).q, -K * 7 / M, 1e-12, 'pressure-release flow');
});

test('homogeneous normalized Cl/w networks reduce to N=1 for N=1..128', () => {
  const params = { R0: 0.004, Rp: 0.012 }, Cl = 45, Ecw = 0.008, X0 = 12, T = 0.5;
  const ref = advanceMany(buildFrozenNetwork(linearPatient([{ w: 1, lc: Cl }], { ew: Ecw }), SETTINGS, params), Float64Array.of(X0), T, 10, { mode: 'pc', value: PEEP + 9 });
  const refVc = advanceMany(buildFrozenNetwork(linearPatient([{ w: 1, lc: Cl }], { ew: Ecw }), SETTINGS, params), Float64Array.of(X0), T, 10, { mode: 'vc', value: 30 });
  const fine = advanceMany(buildFrozenNetwork(linearPatient([{ w: 1, lc: Cl }], { ew: Ecw }), SETTINGS, params), Float64Array.of(X0), T, 80, { mode: 'pc', value: PEEP + 9 }), exact = analyticPC({ C: Cl, Ecw, R0: 0.004, Rp: 0.012 }, 9, X0, T);
  near(fine.x[0], exact, 1e-5 * Math.abs(exact), 'N=1 analytic');
  for (let N = 1; N <= 128; N *= 2) {
    const net = buildFrozenNetwork(linearPatient(Array.from({ length: N }, () => ({ w: 1 / N, lc: Cl })), { ew: Ecw }), SETTINGS, params);
    near(net.G, 1 / 0.012, 1e-9 * net.G); near(net.sumC, Cl, 1e-9);
    const x0 = new Float64Array(N).fill(X0 / N), pc = advanceMany(net, x0, T, 10, { mode: 'pc', value: PEEP + 9 }), vc = advanceMany(net, x0, T, 10, { mode: 'vc', value: 30 });
    near(sum(pc.x), ref.x[0], 1e-9, `PC N=${N}`); near(sum(vc.x), refVc.x[0], 1e-9, `VC N=${N}`);
    near(pc.last.q, ref.last.q, 1e-9); near(vc.last.pressure, refVc.last.pressure, 1e-9, `VC pressure N=${N}`);
    for (let i = 0; i < N; i++) near(pc.x[i], ref.x[0] / N, 1e-9 / N);
  }
});

test('step mass quadrature closes per step and per breath', () => {
  const net = buildFrozenNetwork(linearPatient([{ w: 0.2, lc: 30 }, { w: 0.5, lc: 90 }, { w: 0.3, lc: 15, dep: 0.2 }], { ew: 0.015 }), SETTINGS, { R0: 0.006, Rp: 0.02 });
  let x = Float64Array.of(3, -1, 2);
  for (const drive of [{ mode: 'pc', value: PEEP + 12 }, { mode: 'vc', value: 90 }, { mode: 'pc', value: PEEP }, { mode: 'vc', value: 0 }]) {
    for (const h of [0.002, 0.05, 1]) {
      const r = advanceNetwork(net, x, h, drive);
      near(sum(r.x) - sum(x), r.integratedFlow, 1e-10, `${drive.mode} h=${h}`); assert.ok(Math.abs(r.massResidual) < 1e-10);
      x = r.x;
    }
  }
  const p = createPatient('high', 11, 96), r = simulateAirflow(p, { peep: 10, vt: 6 }, { minBreaths: 3 });
  near(r.metrics.vtDelivered, r.trajectory.frames[r.trajectory.eiIndex].volume - r.trajectory.frames[0].volume, 1e-9);
  near(r.metrics.vtDelivered, r.targetVT, 1e-9); near(r.metrics.volumeError, 0, 1e-9); assert.ok(Math.abs(r.metrics.volumeResidual) < 1e-9);
  assert.ok(r.airflow.massResidualStepMax < 1e-9 && Math.abs(r.airflow.massResidualBreath) < 1e-9);
  assert.equal(r.metrics.limited, false);
});

test('zero PC state at PEEP is a fixed point', () => {
  const net = buildFrozenNetwork(createPatient('high', 7, 48), SETTINGS);
  const r = advanceNetwork(net, new Float64Array(48), 0.1, { mode: 'pc', value: PEEP });
  assert.ok(r.x.every(v => v === 0) && r.flow.every(v => v === 0));
  assert.equal(r.q, 0); assert.equal(r.integratedFlow, 0); assert.deepEqual(r.stagePressures, [PEEP, PEEP]); assert.equal(r.massResidual, 0);
});

test('closed VC Q=0 allows pendelluft to the analytic equilibrium pressure without changing total X', () => {
  const params = { R0: 0.003, Rp: 0.01 }, Ecw = 0.02, specs = [{ w: 0.3, lc: 40 }, { w: 0.7, lc: 80 }];
  const net = buildFrozenNetwork(linearPatient(specs, { ew: Ecw }), SETTINGS, params);
  const [C1, C2] = [net.C[0], net.C[1]], [g1, g2] = [net.g[0], net.g[1]], x0 = Float64Array.of(30, 10), X = 40, T = 0.8;
  const lambda = g1 * g2 / (g1 + g2) * (1 / C1 + 1 / C2), delta0 = x0[0] / C1 - x0[1] / C2;
  const exact = advanceMany(net, x0, T, 400, { mode: 'vc', value: 0 }), delta = delta0 * Math.exp(-lambda * T);
  near(sum(exact.x), X, 1e-10, 'total volume unchanged'); near(exact.integrated, 0, 1e-10);
  const u1 = (X + C2 * delta) / (C1 + C2), u2 = (X - C1 * delta) / (C1 + C2);
  near(exact.x[0] / C1, u1, 1e-6, 'u1'); near(exact.x[1] / C2, u2, 1e-6, 'u2');
  near(exact.last.pressure, PEEP + (g1 * u1 + g2 * u2) / (g1 + g2) + Ecw * X, 1e-6, 'closed-system pressure');
  const long = advanceMany(net, x0, 200, 40, { mode: 'vc', value: 0 }), Ceq = 1 / (1 / (C1 + C2) + Ecw);
  near(long.x[0], X * C1 / (C1 + C2), 1e-9); near(long.x[1], X * C2 / (C1 + C2), 1e-9);
  near(long.last.pressure, PEEP + X / Ceq, 1e-9, 'analytic equilibrium pressure'); near(sum(long.x), X, 1e-10);
  assert.ok(x0[0] === 30 && Math.abs(long.last.q) < 1e-9);
});

test('SDIRK is second order in h for PC and VC heterogeneous networks', () => {
  const net = buildFrozenNetwork(linearPatient([{ w: 0.25, lc: 35 }, { w: 0.55, lc: 70 }, { w: 0.2, lc: 18 }], { ew: 0.012 }), SETTINGS, { R0: 0.006, Rp: 0.03 });
  const x0 = Float64Array.of(4, 1, 6), T = 0.6;
  for (const drive of [{ mode: 'pc', value: PEEP + 14 }, { mode: 'vc', value: 40 }]) {
    const truth = advanceMany(net, x0, T, 2048, drive).x, err = steps => Math.max(...Array.from(advanceMany(net, x0, T, steps, drive).x, (v, i) => Math.abs(v - truth[i])));
    const e = [4, 8, 16, 32].map(err);
    for (let k = 1; k < e.length; k++) { const ratio = e[k - 1] / e[k]; assert.ok(ratio > 3.5 && ratio < 4.6, `${drive.mode} order ratio ${ratio} (${e})`); }
  }
  const x = Float64Array.of(1, 2, 3), copy = Float64Array.from(x), before = structuredClone(net);
  const a = advanceNetwork(net, x, 0.1, { mode: 'pc', value: 20 }), b = advanceNetwork(net, x, 0.1, { mode: 'pc', value: 20 });
  assert.deepStrictEqual(a, b); assert.deepStrictEqual(x, copy); assert.deepStrictEqual(net, before);
});

test('state is never clipped: negative excess volume passes through advanceNetwork', () => {
  const net = buildFrozenNetwork(linearPatient([{ w: 0.5, lc: 40 }, { w: 0.5, lc: 40 }]), SETTINGS);
  const r = advanceNetwork(net, Float64Array.of(-500, -400), 0.01, { mode: 'pc', value: PEEP });
  assert.ok(r.x[0] < -100 && r.x[1] < -100 && r.x.every(Number.isFinite));
});

test('simulateAirflow is deterministic, pure, structured-cloneable and has the contract result shape', () => {
  const p = createPatient('high', 4242, 96), before = structuredClone(p);
  const a = simulateAirflow(p, { peep: 10, vt: 6, rr: 18 }, { minBreaths: 4, maxBreaths: 20 }), b = simulateAirflow(p, { peep: 10, vt: 6, rr: 18 }, { minBreaths: 4, maxBreaths: 20 });
  assert.deepStrictEqual(p, before); assert.deepStrictEqual(a, b); assert.deepStrictEqual(structuredClone(a), a);
  const m = a.metrics;
  for (const key of ['pplat', 'dp', 'crs', 'over', 'cyclic', 'closedPerfusion', 'transpulmonaryEI']) assert.equal(m[key], null, key);
  for (const key of ['eelv', 'vtDelivered', 'ppeak', 'openEE', 'openEI', 'meanPleuralEE', 'meanPleuralEI', 'volumeError', 'volumeResidual', 'retainedVolume', 'tauEquivalent', 'complianceInput', 'virtualEndHoldPressure', 'virtualAutoPeep', 'periodicResidual', 'extrapolatedWeight']) assert.ok(Number.isFinite(m[key]), key);
  assert.equal(typeof m.converged, 'boolean'); assert.equal(typeof m.limited, 'boolean');
  assert.equal(a.maxPressure, m.ppeak); assert.equal(a.targetVT, 6 * p.pbw); assert.equal(a.airflow.version, 1);
  assert.deepEqual(a.airflow.params, { R0: 0.008, Rp: 0.004 }); assert.equal(a.simulatedSeconds, a.breaths * (60 / 18));
  assert.match(a.labels.virtualAutoPeep, /Hypothetical/);
  const net = buildFrozenNetwork(p, { peep: 10, vt: 6, rr: 18 });
  near(m.openEE, p.units.reduce((s, u) => s + u.weight * u.f, 0), 1e-12); assert.equal(m.openEE, m.openEI);
  near(m.tauEquivalent, net.tauEquivalent, 1e-12); near(m.virtualAutoPeep, m.retainedVolume / net.complianceInput, 1e-12);
  a.units.forEach((u, i) => {
    assert.ok(Object.is(u.openEE, p.units[i].f) && Object.is(u.openEI, p.units[i].f) && Object.is(u.state, p.units[i].f));
    assert.equal(u.id, p.units[i].id); assert.equal(u.strainEI, null); assert.equal(u.popen, p.units[i].popen);
    near(u.volumeEI - u.volumeEE, a.trajectory.frames[a.trajectory.eiIndex].unitVolume[i] - a.trajectory.frames[0].unitVolume[i], 1e-9);
    if (u.active) { near(u.tauLocal, u.resistance * u.compliance, 1e-12); assert.ok(u.relaxedVolume > 0); } else assert.equal(u.tauLocal, null);
  });
  near(sum(a.units.map(u => u.volumeEE)), m.eelv, 1e-7);
  const off = simulateAirflow(p, { peep: 10, vt: 6, rr: 18 }, { minBreaths: 4, maxBreaths: 20, recordTrajectory: false });
  assert.equal('trajectory' in off, false); assert.deepStrictEqual(off.metrics, m); assert.deepStrictEqual(off.pv, a.pv);
});

test('trajectory frames, release step and PV mapping', () => {
  const rr = 13, dt = 0.1, cycle = 60 / rr, ti = cycle / 3, ni = Math.ceil(ti / dt), ne = Math.ceil((cycle - ti) / dt);
  const p = createPatient('wall', 21, 64), r = simulateAirflow(p, { peep: 8, vt: 6, rr }, { dt, minBreaths: 3 }), t = r.trajectory, f = t.frames;
  assert.equal(t.kind, 'frozen-aeration-airflow'); assert.equal(t.cycle, cycle); assert.equal(t.ti, ti);
  assert.equal(t.eiIndex, ni+1); assert.equal(t.releaseIndex, ni + 2); assert.equal(f.length, ni + ne + 3);
  assert.deepEqual(f.map(x => x.phase), ['start', ...Array(ni+1).fill('inspiration'), 'release', ...Array(ne).fill('expiration')]);
  assert.equal(f[0].time, 0); assert.equal(f[t.eiIndex].time, ti); assert.equal(f[t.releaseIndex].time, ti); assert.equal(f.at(-1).time, cycle);
  f.forEach((fr, k) => { if (k > 0 && k !== t.releaseIndex && k !== 1) assert.ok(fr.time > f[k - 1].time, `time ${k}`); assert.ok(!('unitOpen' in fr)); });
  assert.ok(t.frozenOpen instanceof Float64Array); t.frozenOpen.forEach((v, i) => assert.ok(Object.is(v, p.units[i].f)));
  const ei = f[t.eiIndex], rel = f[t.releaseIndex];
  assert.ok(Object.is(ei.volume, rel.volume)); assert.ok(ei.unitVolume.every((v, i) => Object.is(v, rel.unitVolume[i])));
  assert.equal(rel.pressure, 8); assert.ok(ei.pressure > 8); assert.equal(f[0].pressure, 8); assert.equal(rel.ceilingActive, false);
  assert.ok(ei.flow > 0 && rel.flow < 0 && ei.flow !== rel.flow, 'flow jumps at release');
  assert.equal(ei.pressure, r.pv[t.eiIndex].pressure); assert.equal(r.pv.length, f.length);
  f.forEach((fr, k) => { assert.equal(r.pv[k].volume, fr.volume); assert.equal(r.pv[k].pressure, fr.pressure); assert.equal(r.pv[k].phase, k <= t.eiIndex ? 'inflation' : 'deflation'); });
  const relFlow = evaluateFlow(buildFrozenNetwork(p, { peep: 8, vt: 6, rr }), Float64Array.from(rel.unitVolume, (v, i) => v - buildFrozenNetwork(p, { peep: 8, vt: 6, rr }).baseVolume[i]), { mode: 'pc', value: 8 });
  near(relFlow.q, rel.flow, 1e-9); rel.unitFlow.forEach((v, i) => near(v, relFlow.flow[i], 1e-9));
  const net = buildFrozenNetwork(p, { peep: 8, vt: 6, rr });
  f.forEach((fr, k) => {
    near(sum(fr.unitVolume), fr.volume, 1e-7, `frame ${k} volume`); near(sum(fr.unitFlow), fr.flow, 1e-8, `frame ${k} flow`);
    near(fr.meanPleural, net.meanPleuralEE + net.Ecw * (fr.volume - net.eeVolume), 1e-9); assert.equal(fr.open, r.metrics.openEE);
  });
  assert.equal(f[0].volume, r.metrics.eelv); assert.equal(ei.meanPleural, r.metrics.meanPleuralEI); assert.equal(f[0].meanPleural, r.metrics.meanPleuralEE);
  assert.equal(new Set(f.flatMap(x => [x.unitVolume.buffer, x.unitFlow.buffer])).size, f.length * 2);
  assert.equal(Math.max(...f.slice(0, t.eiIndex + 1).map(x => x.pressure)), r.metrics.ppeak);
});

test('trajectory recording respects the frames x units cap', () => {
  const big = createPatient('high', 1, 10000), before = structuredClone(big);
  assert.throws(() => simulateAirflow(big, {}, { recordTrajectory: true, minBreaths: 1, maxBreaths: 1 }), RangeError);
  assert.deepStrictEqual(big, before);
  const frames = 33, atCap = Math.floor(MAX_TRAJECTORY_VALUES / frames), ok = simulateAirflow(createPatient('healthy', 1, atCap), { peep: 5 }, { minBreaths: 1, maxBreaths: 1, substeps: 1 });
  assert.equal(ok.trajectory.frames.length, frames);
  assert.throws(() => simulateAirflow(createPatient('healthy', 1, atCap + 1), { peep: 5 }, { minBreaths: 1, maxBreaths: 1 }), RangeError);
});

test('ceiling at the initial resistive jump switches to PC for the whole inspiration', () => {
  const p = linearPatient([{ w: 0.5, lc: 30 }, { w: 0.5, lc: 30 }]), s = { peep: 8, vt: 6, rr: 20, pressureLimit: 9 };
  const r = simulateAirflow(p, s, { params: { R0: 0.05, Rp: 0.05 }, minBreaths: 2 }), t = r.trajectory;
  assert.equal(r.metrics.limited, true); assert.equal(r.airflow.ceilingEvent.initial, true); assert.equal(r.airflow.ceilingEvent.time, 0);
  assert.ok(r.airflow.ceilingEvent.pressure > 9);
  const insp = t.frames.filter(f => f.phase === 'inspiration');
  assert.ok(insp.every(f => f.ceilingActive && f.pressure === 9)); assert.ok(r.metrics.vtDelivered < r.targetVT);
  assert.ok(t.frames.every(f => f.pressure <= 9)); assert.equal(r.metrics.ppeak, 9); assert.ok(insp[0].flow < r.targetVT / t.ti);
  assert.equal(t.frames[0].ceilingActive, false); assert.ok(t.frames.filter(f => f.phase !== 'inspiration').every(f => !f.ceilingActive));
});

test('late ceiling event is located by bisection and never switches back', () => {
  const p = linearPatient([{ w: 0.3, lc: 30, dep: 0 }, { w: 0.7, lc: 60 }], { ew: 0.01 }), s = { peep: 8, vt: 6, rr: 20 };
  const free = simulateAirflow(p, s, { minBreaths: 3 }), limit = 8 + 0.6 * (free.metrics.ppeak - 8);
  assert.equal(free.metrics.limited, false); assert.equal(free.airflow.ceilingEvent, null);
  const r = simulateAirflow(p, { ...s, pressureLimit: limit }, { minBreaths: 3 }), t = r.trajectory, ev = r.airflow.ceilingEvent;
  assert.equal(r.metrics.limited, true); assert.equal(ev.initial, false); assert.ok(ev.time > 0 && ev.time < t.ti, `event time ${ev.time}`);
  near(ev.pressure, limit, 1e-9, 'event pressure reaches the ceiling');
  const insp = t.frames.filter(f => f.phase === 'inspiration'), q = r.targetVT / t.ti;
  assert.ok(t.frames.every(f => f.pressure <= limit), 'no pressure above the limit'); assert.ok(r.metrics.ppeak <= limit);
  const firstActive = insp.findIndex(f => f.ceilingActive);
  assert.ok(firstActive > 0); assert.ok(insp.slice(firstActive).every(f => f.ceilingActive && f.pressure === limit));
  assert.ok(insp.slice(0, firstActive).every(f => !f.ceilingActive && Math.abs(f.flow - q) < 1e-9 && f.pressure < limit + 1e-12));
  assert.ok(insp[firstActive].flow < q); assert.ok(r.metrics.vtDelivered < r.targetVT && r.metrics.vtDelivered > 0.5 * r.targetVT);
  const flows = insp.slice(firstActive).map(f => f.flow); assert.ok(flows.every((v, k) => k === 0 || v < flows[k - 1]), 'PC flow decays monotonically');
  near(r.metrics.vtDelivered, t.frames[t.eiIndex].volume - t.frames[0].volume, 1e-9);
});

test('release is a continuous-gas pressure and flow step; expiration recovers volume', () => {
  const p = linearPatient([{ w: 1, lc: 50 }], { ew: 0.01 }), params = { R0: 0.005, Rp: 0.01 };
  const r = simulateAirflow(p, SETTINGS, { params, minBreaths: 2 }), t = r.trajectory, ei = t.frames[t.eiIndex], rel = t.frames[t.releaseIndex];
  const net = buildFrozenNetwork(p, SETTINGS, params), K = 1 / 50 + 0.01, M = 0.015, XEI = ei.volume - net.eeVolume;
  near(rel.flow, -K * XEI / M, 1e-10); near(ei.flow, r.targetVT / t.ti, 1e-10);
  near(ei.pressure, PEEP + (M) * ei.flow + K * XEI, 1e-8);
  const exp = t.frames.filter(f => f.phase === 'expiration');
  assert.ok(exp.every((f, k) => f.pressure === PEEP && (k === 0 || f.volume < exp[k - 1].volume)));
  const kept = Math.exp(-K * (t.cycle - t.ti) / M);
  near(1 - r.metrics.fractionEmptied, kept, 1e-4, 'expiration decay'); near(r.metrics.retainedVolume, XEI * kept, 1e-2); near(r.metrics.virtualAutoPeep, r.metrics.retainedVolume * K, 1e-9);
  assert.ok(r.metrics.converged);
  near(r.metrics.virtualEndHoldPressure, PEEP + XEI * (1 / 50 + 0.01), 1e-8);
  near(r.metrics.tauEquivalent, 0.015 / K, 1e-12); near(r.metrics.complianceInput, 1 / K, 1e-12);
});

test('slow units retain volume; regional fractions are unclamped and chord excursions are quantified', () => {
  const p = linearPatient([{ w: 0.1, lc: 400 }, { w: 0.9, lc: 60 }], { ew: 0.05 }), s = { peep: 8, vt: 6, rr: 30 };
  const r = simulateAirflow(p, s, { params: { R0: 0.0005, Rp: 0.002 }, minBreaths: 3, maxBreaths: 40 }), [slow, fast] = r.units;
  assert.ok(r.metrics.converged); assert.ok(r.metrics.retainedVolume > 1, `retained ${r.metrics.retainedVolume}`);
  assert.ok(r.metrics.virtualAutoPeep > 0); assert.ok(r.metrics.fractionEmptied > 0 && r.metrics.fractionEmptied < 1);
  assert.ok(slow.fractionEmptied > 0 && slow.fractionEmptied < 1, 'slow unit does not overshoot');
  assert.ok(fast.fractionEmptied > 1, `chest-wall undershoot of the fast unit is not clamped: ${fast.fractionEmptied}`);
  near(r.units.reduce((a, u) => a + u.volumeEE - u.relaxedVolume, 0), r.metrics.retainedVolume, r.metrics.periodicResidual + 1e-9, 'start excess differs from end excess by the periodic residual');
  assert.ok(r.metrics.extrapolatedWeight > 0 && r.metrics.extrapolatedWeight <= 1);
  assert.ok(r.units.every(u => u.chordExcursion >= 0) && r.units.some(u => u.chordExcursion > 0));
  const e = r.airflow.chordExcursion;
  near(e.maxMl, Math.max(...r.units.map(u => u.chordExcursion)), 0); assert.ok(e.maxRelative > 0 && e.weightedMeanRelative > 0 && e.weightedMeanRelative <= e.maxRelative);
  // Retained volume pushes X_EI beyond the chord reference (VT) at RR20; with full expiration (RR5) a homogeneous unit stays in range.
  assert.ok(simulateAirflow(linearPatient([{ w: 1, lc: 50 }]), SETTINGS, { minBreaths: 2 }).metrics.extrapolatedWeight === 1);
  const homo = simulateAirflow(linearPatient([{ w: 1, lc: 50 }]), { ...SETTINGS, rr: 5 }, { minBreaths: 2 });
  assert.equal(homo.metrics.extrapolatedWeight, 0); assert.equal(homo.airflow.chordExcursion.maxMl, 0);
});

test('forced non-convergence is reported and convergence needs minBreaths', () => {
  const p = createPatient('high', 4242, 64), s = { peep: 10, vt: 6, rr: 30 };
  const bad = simulateAirflow(p, s, { minBreaths: 1, maxBreaths: 1, periodicTolerance: 1e-12 });
  assert.equal(bad.metrics.converged, false); assert.equal(bad.breaths, 1); assert.ok(bad.metrics.periodicResidual > 1e-12);
  const capped = simulateAirflow(p, s, { minBreaths: 2, maxBreaths: 3, periodicTolerance: 1e-14 });
  assert.equal(capped.metrics.converged, false); assert.equal(capped.breaths, 3);
  const good = simulateAirflow(p, s, { minBreaths: 3, maxBreaths: 60, periodicTolerance: 0.5 });
  assert.equal(good.metrics.converged, true); assert.ok(good.breaths >= 3 && good.breaths <= 60); assert.ok(good.metrics.periodicResidual < 0.5);
});

test('negative absolute regional volume is rejected, not clipped', () => {
  assert.equal(NEGATIVE_VOLUME_TOLERANCE_ML, 1e-6);
  // Unit B has exactly zero relaxed volume (tp = 0 at EE, grad = z_EE fixed by unit A alone) but a positive chord;
  // chest-wall coupling to the slower unit A drives B below its relaxed volume during expiration.
  const p = linearPatient([{ w: 0.1, lc: 400, rest: 0, dep: 0 }, { w: 0.9, lc: 60, rest: 0, dep: 1 }], { ew: 0.05, grad: 2, offset: 2, vref: 0 });
  const net = buildFrozenNetwork(p, { peep: 8, vt: 6, rr: 30 }, { R0: 0.0005, Rp: 0.002 });
  assert.ok(Math.abs(net.baseVolume[1]) < 1e-9 && net.active[1] === 1);
  assert.throws(() => simulateAirflow(p, { peep: 8, vt: 6, rr: 30 }, { params: { R0: 0.0005, Rp: 0.002 }, minBreaths: 2 }), /Negative absolute regional volume/);
  assert.throws(() => simulateAirflow(p, { peep: 8, vt: 6, rr: 30 }, { params: { R0: 0.0005, Rp: 0.002 }, minBreaths: 2, recordTrajectory: false }), RangeError);
});

test('unresponsive chord paths retain their reference gas volume without hidden mass loss',()=>{
 const p=linearPatient([{w:.5,lc:100,rest:2000},{w:.5,lc:0,rest:2000}]);
 const net=buildFrozenNetwork(p,SETTINGS);assert.equal(net.active[1],0);assert.ok(net.baseVolume[1]>0);
 const r=simulateAirflow(p,SETTINGS,{minBreaths:2});
 for(const frame of r.trajectory.frames){near(frame.unitVolume[1],net.baseVolume[1],1e-12);near(sum(frame.unitVolume),frame.volume,1e-7);assert.equal(frame.unitFlow[1],0);}
 assert.equal(r.units[1].tauLocal,null);
 assert.throws(()=>advanceNetwork(net,Float64Array.from([0,1]),.1,{mode:'pc',value:8}),/inactive/);
});
test('inspiratory onset is an explicit pressure/flow step with continuous gas volume',()=>{
 const p=linearPatient([{w:1,lc:100,rest:2000}]);const r=simulateAirflow(p,SETTINGS,{minBreaths:2});
 const [before,after]=r.trajectory.frames;
 assert.equal(before.time,0);assert.equal(after.time,0);assert.equal(before.volume,after.volume);
 assert.deepEqual(before.unitVolume,after.unitVolume);assert.ok(after.pressure>before.pressure);assert.ok(after.flow>before.flow);
 near(after.flow,r.targetVT/r.trajectory.ti,1e-9);
});
