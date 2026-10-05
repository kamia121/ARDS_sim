import assert from 'node:assert/strict';
import { createPatient, simulate, sweep, regionalVolume, MODEL_INFO } from '../src/engine.js';

const results = [];
function test(name, fn) {
  const start = performance.now();
  try { const evidence = fn(); results.push({ name, pass: true, ms: performance.now() - start, evidence }); }
  catch (error) { results.push({ name, pass: false, error: error.message }); console.error(`FAIL ${name}: ${error.stack}`); }
}
const near = (actual, expected, tol = 1e-4) => assert.ok(Math.abs(actual - expected) <= tol, `${actual} differs from ${expected} by more than ${tol}`);
const clone = p => JSON.parse(JSON.stringify(p));
function linearPatient({ offset = 2, elastance = 0.01 } = {}) {
  const p = createPatient('healthy', 1, 1);
  Object.assign(p, { baselinePleural: offset, pleuralGradient: 0, chestWallElastance: elastance, chestWallReferenceVolume: 2000 });
  Object.assign(p.units[0], { weight: 1, rest: 2000, linearCompliance: 100, f: 1, fixedOpen: true });
  return p;
}

test('Independent analytic linear compartment reference', () => {
  // V = V0 + Cl*(P - offset - Ew*(V - Vref)); Cresp = 1/(1/Cl + Ew).
  const peep = 8, vt = 420, cl = 100, ew = 0.01, offset = 2, v0 = 2000, vref = 2000;
  const eelv = (v0 + cl * (peep - offset + ew * vref)) / (1 + cl * ew);
  const crs = 1 / (1 / cl + ew), expectedPlateau = peep + vt / crs;
  const { metrics: m } = simulate(linearPatient(), { peep, vt: 6 }, { breaths: 2 });
  near(m.eelv, eelv); near(m.pplat, expectedPlateau); near(m.vtDelivered, vt); near(m.crs, crs);
  return { expected: { eelv, crs, expectedPlateau }, measured: m };
});

test('Volume conservation and regional volume sums at attainable targets', () => {
  const cases = [];
  for (const kind of ['high', 'low', 'wall', 'healthy']) {
    const r = simulate(createPatient(kind), { peep: 10, vt: 6 });
    assert.equal(r.metrics.limited, false); near(r.metrics.volumeResidual, 0, 1e-4); near(r.metrics.vtDelivered, 420, 1e-4);
    near(r.units.reduce((s, u) => s + u.volumeEE, 0), r.metrics.eelv);
    near(r.units.reduce((s, u) => s + u.volumeEI - u.volumeEE, 0), r.metrics.vtDelivered);
    assert.ok(r.pv.every(point => Number.isFinite(point.volume) && Number.isFinite(point.pressure)));
    cases.push({ kind, volumeError: r.metrics.volumeError });
  }
  return cases;
});

test('Pressure ceiling reduces delivered VT, including target beyond capacity', () => {
  const r = simulate(createPatient('low'), { peep: 8, vt: 10, pressureLimit: 20 });
  assert.equal(r.metrics.limited, true); near(r.metrics.volumeResidual, 0, 1e-4); assert.ok(r.metrics.vtDelivered < 700); assert.ok(r.metrics.volumeError < 0);
  assert.ok(r.pv.every(p => p.pressure <= 20 + 1e-6));
  const extreme = simulate(createPatient('healthy'), { peep: 45, vt: 30, pressureLimit: 45 });
  assert.equal(extreme.metrics.limited, true); assert.ok(extreme.metrics.vtDelivered < 1e-3);
  return { ordinary: r.metrics, beyondCapacity: extreme.metrics };
});

test('Nonlinear constitutive curve is monotone and stiffens at high positive TP', () => {
  const p = createPatient();
  for (const u of p.units) {
    let previous = regionalVolume(u, -5);
    for (let tp = -4; tp <= 100; tp++) { const v = regionalVolume(u, tp); assert.ok(v >= previous); previous = v; }
    const lowCompliance = regionalVolume(u, 6) - regionalVolume(u, 5);
    const highCompliance = regionalVolume(u, 31) - regionalVolume(u, 30);
    assert.ok(highCompliance < lowCompliance);
  }
  return { unitsChecked: p.count };
});

test('Persistent state creates recruitment hysteresis and sweep isolates original', () => {
  const p = createPatient(), before = JSON.stringify(p);
  const r = sweep(p, { vt: 6 }, { peeps: [4, 8, 12, 16, 20], breaths: 10 });
  assert.equal(JSON.stringify(p), before);
  const up8 = r.ascending.find(x => x.peep === 8), down8 = r.descending.find(x => x.peep === 8);
  assert.ok(down8.openEE > up8.openEE + 0.02);
  const patient = createPatient(); simulate(patient, { peep: 20 });
  assert.deepEqual(sweep(patient, {}, { peeps: [4, 8, 12, 16, 20] }), r);
  assert.notDeepEqual(sweep(patient, {}, { peeps: [4, 8, 12, 16, 20], initialState: 'current' }), r);
  assert.notEqual(JSON.stringify(patient.units.map(u => u.f)), JSON.stringify(p.units.map(u => u.f)));
  return { up8: up8.openEE, down8: down8.openEE, path: r };
});

test('Opening/closure pressure thresholds retain a history-dependent state', () => {
  const p = linearPatient({ offset: 0, elastance: 0 });
  Object.assign(p.units[0], { fixedOpen: false, popen: 15, pclose: 5, f: 0.1 });
  const settings = { peep: 10, vt: 0.01, pressureLimit: 12 };
  const low = simulate(clone(p), settings, { breaths: 1 });
  p.units[0].f = 0.9;
  const high = simulate(clone(p), settings, { breaths: 1 });
  near(low.metrics.openEE, 0.1); near(high.metrics.openEE, 0.9);
  assert.ok(high.metrics.eelv > low.metrics.eelv * 8);
  return { lowState: low.metrics.openEE, highState: high.metrics.openEE };
});

test('Seed repeatability and wall phenotype preserves exact lung assumptions', () => {
  assert.deepEqual(createPatient('high', 17), createPatient('high', 17));
  const high = createPatient('high', 17), wall = createPatient('wall', 17);
  assert.deepEqual(high.units, wall.units); assert.notEqual(high.baselinePleural, wall.baselinePleural); assert.notEqual(high.chestWallElastance, wall.chestWallElastance);
  assert.deepEqual(simulate(createPatient('high', 17)), simulate(createPatient('high', 17)));
  return { seed: 17, unitCount: high.count };
});

test('Chest-wall offset and elastance have distinct analytic effects', () => {
  const base = simulate(linearPatient(), {}), offset = simulate(linearPatient({ offset: 7 }), {}), stiff = simulate(linearPatient({ elastance: 0.02 }), {});
  near(offset.metrics.dp, base.metrics.dp); assert.ok(offset.metrics.eelv < base.metrics.eelv);
  near(stiff.metrics.dp, 420 * (1 / 100 + 0.02)); assert.ok(stiff.metrics.dp > base.metrics.dp);
  return { base: base.metrics, offset: offset.metrics, stiff: stiff.metrics };
});

test('Timestep refinement decreases error against the finer result', () => {
  const runs = [0.1, 0.05, 0.025, 0.0125].map(dt => ({ dt, ...simulate(createPatient('high'), { peep: 12 }, { dt }).metrics }));
  const reference = runs.at(-1);
  const errors = runs.slice(0, -1).map(r => ({ dt: r.dt, pressure: Math.abs(r.pplat - reference.pplat), aeration: Math.abs(r.openEE - reference.openEE), volume: Math.abs(r.eelv - reference.eelv) }));
  for (const key of ['pressure', 'aeration', 'volume']) { assert.ok(errors[1][key] < errors[0][key]); assert.ok(errors[2][key] < errors[1][key]); }
  assert.ok(errors[0].pressure < 0.3); assert.ok(errors[0].aeration < 0.01);
  return { runs, errors, note: 'The discontinuous high-strain cutoff is more resolution-sensitive than smooth mechanics.' };
});

test('Seed variability and measured high versus low recruitment response', () => {
  const values = [], responses = [];
  for (const seed of [17, 31, 53, 79, 13791]) {
    values.push(simulate(createPatient('high', seed)).metrics.openEE);
    const paths = ['high', 'low'].map(kind => sweep(createPatient(kind, seed), {}, { peeps: [4, 8, 12, 16, 20] }).ascending);
    const gains = paths.map(path => path.at(-1).openEE - path[0].openEE);
    assert.ok(gains[0] > gains[1]); responses.push({ seed, highGain: gains[0], lowGain: gains[1] });
  }
  assert.ok(Math.max(...values) - Math.min(...values) > 0.005);
  return { baselineAeration: values, responses };
});

test('Numerical regional resolution is quantified, not assumed identical', () => {
  const runs = [128, 512, 2048].map(count => ({ count, ...simulate(createPatient('high', 13791, count), { peep: 12 }).metrics }));
  const finest = runs.at(-1);
  for (const run of runs) { assert.ok(Math.abs(run.pplat - finest.pplat) < 2); assert.ok(Math.abs(run.openEE - finest.openEE) < 0.06); }
  return { runs, note: 'Changing unit count changes Monte Carlo sampling; this is stochastic regional resolution, not deterministic mesh convergence.' };
});

test('Fractions, serialization, persistent elapsed time and input rejection', () => {
  const p = createPatient(), r = simulate(p);
  for (const name of ['openEE', 'openEI', 'cyclic', 'over', 'closedPerfusion']) assert.ok(r.metrics[name] >= 0 && r.metrics[name] <= 1);
  assert.doesNotThrow(() => JSON.stringify(r)); near(p.elapsed, 30); simulate(p, {}, { breaths: 1 }); near(p.elapsed, 33);
  assert.throws(() => simulate(p, { peep: 20, pressureLimit: 10 })); assert.throws(() => createPatient('bad'));
  assert.ok(MODEL_INFO.assumptions.some(a => a.includes('not a clinical shunt')));
});

const summary = { passed: results.filter(r => r.pass).length, failed: results.filter(r => !r.pass).length, results };
console.log(JSON.stringify(summary, null, 2));
if (summary.failed) process.exitCode = 1;
