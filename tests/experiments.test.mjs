import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPatient, simulate, sweep, MODEL_INFO, PARAMETER_TABLE } from '../src/engine.js';
import { normalizeExperiment, applyExperiment, simulateExperiment, sweepExperiment, isDefaultExperiment } from '../src/experiments.js';
import { createSession } from '../src/session.js';

const near = (a, b, tol, label = '') => assert.ok(Math.abs(a - b) <= tol, `${label} ${a} differs from ${b} by more than ${tol}`);
const snap = x => structuredClone(x);
const OPTS = { breaths: 4, dt: 0.1 };
const S = { peep: 8, vt: 6, rr: 20, pressureLimit: 45 };
const dropExperimentEcho = result => {
  const { conditions, settings: { experiment, ...rest }, trajectory, ...others } = result;
  const stripped = trajectory && { ...trajectory, frames: trajectory.frames.map(({ externalPressure, transrespPressure, ...frame }) => frame) };
  return { ...others, settings: rest, ...(stripped ? { trajectory: stripped } : {}) };
};
const meanDep = p => p.units.reduce((s, u) => s + u.weight * u.dep, 0);

// ---- defaults are the original engine -------------------------------------------------------------------------------------
test('original 16-case golden fixture still reproduces exactly (read-only check)', { skip: !existsSync(fileURLToPath(new URL('../benchmarks/experiment-golden.json', import.meta.url))) && 'local golden fixture not present' }, () => {
  const out = execFileSync(process.execPath, [fileURLToPath(new URL('../benchmarks/experiment-golden.mjs', import.meta.url)), '--check'], { encoding: 'utf8' });
  const report = JSON.parse(out);
  assert.equal(report.cases, 16); assert.equal(report.passed, 16); assert.deepEqual(report.failures, []);
});

test('default experiments equal original simulate/sweep exactly, with no extra result fields', () => {
  const defaults = [undefined, null, {}, { drive: 'airway', posture: 'supine', chestLoad: 0 }, { posture: 'supine', proneGradientFactor: 0.9 }];
  for (const kind of ['high', 'healthy', 'healthyDependent']) {
    const ref = simulate(createPatient(kind, 5, 64), S, { ...OPTS, recordTrajectory: true });
    for (const experiment of defaults) {
      const p = createPatient(kind, 5, 64), settings = experiment === undefined ? S : { ...S, experiment };
      const r = simulateExperiment(p, settings, { ...OPTS, recordTrajectory: true });
      assert.deepStrictEqual(r, ref);
      assert.equal('conditions' in r, false); assert.equal('experiment' in r.settings, false);
      const q = createPatient(kind, 5, 64); simulate(q, S, { ...OPTS, recordTrajectory: true });
      assert.deepStrictEqual(p, q);
    }
  }
  const direct = sweep(createPatient('high', 3), S), viaExperiment = sweepExperiment(createPatient('high', 3), { ...S, experiment: { proneGradientFactor: 0.2 } });
  assert.deepStrictEqual(viaExperiment, direct);
});

test('default experiment retains patient state exactly like original simulate', () => {
  const a = createPatient('low', 9, 64), b = createPatient('low', 9, 64);
  simulate(a, S, OPTS); simulateExperiment(b, { ...S, experiment: { drive: 'airway' } }, OPTS);
  assert.deepStrictEqual(b, a);
});

// ---- healthyDependent -------------------------------------------------------------------------------------------------------
test('healthyDependent shares healthy parameters and the random draw sequence, adjusting only dependent units', () => {
  assert.equal(MODEL_INFO.version, '1.1.0');
  assert.deepEqual(PARAMETER_TABLE.healthyDependent, PARAMETER_TABLE.healthy);
  assert.ok(MODEL_INFO.phenotypes.healthyDependent && MODEL_INFO.assumptions.some(a => a.includes('healthyDependent')));
  assert.deepStrictEqual(PARAMETER_TABLE.healthy, { capacity: 3000, rest: 1500, stiffness: 12, pleural: 0.5, gradient: 2, ew: 0.01, reference: 2000, initial: 0.995 });
  for (const [seed, pbw] of [[13791, 70], [4242, 55], [77, 90]]) {
    const h = createPatient('healthy', seed, 512, pbw), d = createPatient('healthyDependent', seed, 512, pbw);
    assert.equal(d.kind, 'healthyDependent');
    for (const key of ['seed', 'pbw', 'count', 'baselinePleural', 'pleuralGradient', 'chestWallElastance', 'chestWallReferenceVolume', 'elapsed', 'breaths']) assert.equal(d[key], h[key], key);
    let adjusted = 0, clamped = 0;
    d.units.forEach((u, i) => {
      const w = h.units[i], s = Math.max(0, (w.dep - 0.6) / 0.4);
      for (const key of ['id', 'dep', 'weight', 'capacity', 'rest', 'stiffness', 'tauOpen', 'tauClose', 'rateWidth', 'perfusion']) assert.equal(u[key], w[key], `${key} ${i}`);
      assert.equal(u.f, 0.995 - 0.6 * s); assert.equal(u.popen, w.popen + 1 * s);
      assert.equal(u.pclose, Math.min(u.popen - 0.5, w.pclose + 3.5 * s));
      assert.ok(u.pclose <= u.popen - 0.5);
      if (s === 0) assert.deepStrictEqual(u, w); else { adjusted++; if (w.pclose + 3.5 * s > u.popen - 0.5) clamped++; }
    });
    assert.ok(adjusted > 0.3 * 512 && adjusted < 0.5 * 512, `adjusted ${adjusted}`);
    assert.ok(clamped > 0 && clamped < 0.1 * 512, `threshold clamp fraction ${clamped / 512} must be reported and small`);
    test.diagnostic?.(`healthyDependent seed ${seed}: threshold-clamped unit fraction ${(clamped / 512).toFixed(4)}`);
  }
  assert.throws(() => createPatient('healthyDepend'), /Unknown phenotype/);
});

test('healthyDependent: initial closed tissue is the dependent weighted mean and PEEP response spans a broad range', () => {
  const peeps = [0, 2, 5, 8, 10];
  for (const seed of [13791, 4242, 77, 5]) {
    const d = createPatient('healthyDependent', seed), h = createPatient('healthy', seed);
    const expectedClosed = d.units.reduce((s, u) => s + u.weight * 0.6 * Math.max(0, (u.dep - 0.6) / 0.4), 0);
    near(d.units.reduce((s, u) => s + u.weight * (1 - u.f), 0), expectedClosed + 0.005, 1e-12, 'initial closed');
    assert.ok(expectedClosed > 0.05 && expectedClosed < 0.25);
    assert.ok(d.units.every(u => u.f >= 0.395 && u.f <= 0.995));
    const open = peeps.map(peep => simulate(createPatient('healthyDependent', seed), { peep, vt: 6, rr: 20 }, { breaths: 10, dt: 0.1 }).metrics.openEE);
    for (let i = 1; i < open.length; i++) assert.ok(open[i] >= open[i - 1] - 1e-12, `monotone PEEP response seed ${seed}: ${open}`);
    assert.ok(1 - open[0] > 0.03 && 1 - open[0] < 0.15, `PEEP 0 closed fraction ${1 - open[0]}`);
    assert.ok(open[4] > 0.99, `PEEP 10 aerated ${open[4]}`);
    const healthy0 = simulate(h, { peep: 0, vt: 6, rr: 20 }, { breaths: 10, dt: 0.1 }).metrics.openEE;
    assert.ok(healthy0 > open[0]);
  }
});

// ---- validation ---------------------------------------------------------------------------------------------------------------
test('normalizeExperiment validates enums, ranges and unknown fields', () => {
  assert.deepStrictEqual(normalizeExperiment(), { drive: 'airway', posture: 'supine', chestLoad: 0, proneGradientFactor: 0.5 });
  assert.deepStrictEqual(normalizeExperiment({ posture: 'prone', chestLoad: 15, proneGradientFactor: 1 }), { drive: 'airway', posture: 'prone', chestLoad: 15, proneGradientFactor: 1 });
  assert.deepStrictEqual(normalizeExperiment({ chestLoad: 0, proneGradientFactor: 0 }).proneGradientFactor, 0);
  assert.equal(isDefaultExperiment({ posture: 'prone' }), false); assert.equal(isDefaultExperiment({ chestLoad: 1 }), false); assert.equal(isDefaultExperiment({ drive: 'external' }), false); assert.equal(isDefaultExperiment(), true);
  const bad = [{ drive: 'tank' }, { drive: 'AIRWAY' }, { posture: 'standing' }, { posture: 1 }, { chestLoad: -0.01 }, { chestLoad: 15.01 }, { chestLoad: NaN }, { chestLoad: Infinity }, { chestLoad: '3' }, { chestLoad: null }, { proneGradientFactor: -0.1 }, { proneGradientFactor: 1.01 }, { proneGradientFactor: NaN }, { proneGradientFactor: '0.5' }, { unknown: 1 }, { Posture: 'prone' }];
  for (const e of bad) assert.throws(() => normalizeExperiment(e), RangeError, JSON.stringify(e));
  for (const e of ['prone', 3, true, []]) assert.throws(() => normalizeExperiment(e), TypeError);
  const p = createPatient('high', 1, 16), before = snap(p);
  for (const e of bad) {
    assert.throws(() => simulateExperiment(p, { ...S, experiment: e }, OPTS), RangeError);
    assert.throws(() => sweepExperiment(p, { ...S, experiment: e }), RangeError);
  }
  assert.deepStrictEqual(p, before);
});

test('failed nondefault runs and invalid ventilator settings leave the patient untouched', () => {
  const p = createPatient('high', 2, 32), before = snap(p);
  assert.throws(() => simulateExperiment(p, { ...S, peep: -1, experiment: { posture: 'prone' } }, OPTS), /Invalid ventilator settings/);
  assert.throws(() => simulateExperiment(p, { ...S, experiment: { chestLoad: 3 } }, { breaths: 0 }), RangeError);
  assert.deepStrictEqual(p, before);
});

// ---- chest load and prone transforms --------------------------------------------------------------------------------------------
test('applyExperiment is pure, never accumulates, and keeps anatomy, thresholds and perfusion fixed', () => {
  const p = createPatient('high', 21, 64); simulate(p, S, OPTS);
  const before = snap(p), exp = { posture: 'prone', proneGradientFactor: 0.4, chestLoad: 3 };
  const a = applyExperiment(p, exp), b = applyExperiment(p, exp);
  assert.deepStrictEqual(p, before); assert.notEqual(a, p); assert.notEqual(a.units, p.units); assert.notEqual(a.units[0], p.units[0]);
  assert.deepStrictEqual(a, b);
  const g = p.pleuralGradient, k = 0.4;
  assert.equal(a.pleuralGradient, -k * g);
  near(a.baselinePleural, p.baselinePleural + 3 + (1 + k) * g * meanDep(p), 1e-12);
  assert.equal(a.chestWallElastance, p.chestWallElastance); assert.equal(a.chestWallReferenceVolume, p.chestWallReferenceVolume);
  assert.deepStrictEqual(a.units, p.units);
  near(a.baselinePleural + a.pleuralGradient * meanDep(p), p.baselinePleural + 3 + g * meanDep(p), 1e-12, 'weighted mean pleural at fixed volume (plus load)');
  for (const u of p.units) near((a.pleuralGradient) * (u.dep - meanDep(p)), -k * g * (u.dep - meanDep(p)), 1e-12);
  const supine = applyExperiment(p, { chestLoad: 3 });
  assert.equal(supine.pleuralGradient, p.pleuralGradient); assert.equal(supine.baselinePleural, p.baselinePleural + 3);
  const mirrored = applyExperiment(p, { posture: 'prone', proneGradientFactor: 1 }), flat = applyExperiment(p, { posture: 'prone', proneGradientFactor: 0 });
  assert.equal(mirrored.pleuralGradient, -g); assert.equal(flat.pleuralGradient === 0, true);
  near(flat.baselinePleural, p.baselinePleural + g * meanDep(p), 1e-12);
  for (const u of p.units) near(mirrored.baselinePleural + mirrored.pleuralGradient * u.dep, p.baselinePleural + g * (2 * meanDep(p) - u.dep), 1e-12, 'mirror about the weighted mean');
  assert.deepStrictEqual(applyExperiment(p, { drive: 'external' }), p);
});

test('chest load equals a raised pleural baseline and the unloaded problem at PEEP-L and limit-L', () => {
  const load = 3;
  for (const kind of ['high', 'healthyDependent']) {
    const loaded = createPatient(kind, 31, 128), manual = createPatient(kind, 31, 128), unloaded = createPatient(kind, 31, 128);
    manual.baselinePleural += load;
    const r = simulateExperiment(loaded, { ...S, experiment: { chestLoad: load } }, { ...OPTS, recordTrajectory: true });
    const m = simulate(manual, S, { ...OPTS, recordTrajectory: true });
    assert.deepStrictEqual(dropExperimentEcho(r), m);
    assert.deepStrictEqual(loaded.units.map(u => u.f), manual.units.map(u => u.f));
    assert.equal(loaded.baselinePleural, createPatient(kind, 31, 128).baselinePleural);
    const u = simulate(unloaded, { ...S, peep: S.peep - load, pressureLimit: S.pressureLimit - load }, { ...OPTS, recordTrajectory: true });
    for (const key of ['eelv', 'vtDelivered', 'openEE', 'openEI', 'cyclic', 'over', 'closedPerfusion', 'transpulmonaryEI']) near(r.metrics[key], u.metrics[key], 2e-4, key);
    near(r.metrics.pplat, u.metrics.pplat + load, 1e-6); near(r.metrics.dp, u.metrics.dp, 1e-6); near(r.metrics.meanPleuralEE, u.metrics.meanPleuralEE + load, 1e-6);
    r.units.forEach((x, i) => { near(x.openEE, u.units[i].openEE, 1e-5); near(x.volumeEI, u.units[i].volumeEI, 1e-3); near(x.state, u.units[i].state, 1e-5); });
    assert.equal(r.metrics.limited, u.metrics.limited);
    assert.equal(r.conditions.chestLoad, load); assert.equal(r.conditions.pExtEE, 0);
    r.trajectory.frames.forEach(frame => { assert.equal(frame.externalPressure, 0); assert.equal(frame.transrespPressure, frame.pressure); });
  }
  const limited = simulateExperiment(createPatient('high', 31, 128), { ...S, pressureLimit: 20, experiment: { chestLoad: 4 } }, OPTS);
  const limitedRef = simulate(createPatient('high', 31, 128), { ...S, peep: S.peep - 4, pressureLimit: 16 }, OPTS);
  assert.equal(limited.metrics.limited, true); assert.equal(limitedRef.metrics.limited, true);
  near(limited.metrics.vtDelivered, limitedRef.metrics.vtDelivered, 1e-3); near(limited.metrics.pplat, 20, 1e-6);
});

test('nondefault results carry the normalized experiment, conditions and limit metadata; counters and f commit once', () => {
  const p = createPatient('high', 41, 64), cycle = 60 / S.rr;
  const r = simulateExperiment(p, { ...S, experiment: { posture: 'prone', proneGradientFactor: 0.25, chestLoad: 2 } }, OPTS);
  assert.deepStrictEqual(r.settings.experiment, { drive: 'airway', posture: 'prone', chestLoad: 2, proneGradientFactor: 0.25 });
  assert.deepStrictEqual(r.conditions.experiment, r.settings.experiment);
  const c = r.conditions;
  assert.equal(c.posture, 'prone'); assert.equal(c.gradientFactor, 0.25); assert.equal(c.chestLoad, 2); assert.equal(c.drive, 'airway');
  assert.equal(c.pExtEE, 0); assert.equal(c.pExtEI, 0); assert.equal(c.airwayEE, S.peep); assert.equal(c.airwayEI, r.metrics.pplat);
  assert.equal(c.transrespDP, r.metrics.dp); assert.equal(c.transrespCrs, r.metrics.crs);
  assert.equal(c.maxDrivePressure, r.maxPressure); assert.equal(c.drivePressureLimit, 45); assert.match(c.limitNote, /not a calibrated tank/);
  assert.equal(p.breaths, 4); near(p.elapsed, cycle * 4, 1e-9); assert.equal(r.totalElapsed, p.elapsed);
  const g0 = createPatient('high', 41, 64);
  assert.equal(p.baselinePleural, g0.baselinePleural); assert.equal(p.pleuralGradient, g0.pleuralGradient);
  p.units.forEach((u, i) => { assert.equal(u.f, r.units[i].state); assert.equal(u.popen, g0.units[i].popen); assert.equal(u.pclose, g0.units[i].pclose); assert.equal(u.dep, g0.units[i].dep); });
  const manual = applyExperiment(g0, { posture: 'prone', proneGradientFactor: 0.25, chestLoad: 2 }); simulate(manual, S, OPTS);
  assert.deepStrictEqual(p.units.map(u => u.f), manual.units.map(u => u.f));
  simulateExperiment(p, { ...S, experiment: { posture: 'prone', proneGradientFactor: 0.25, chestLoad: 2 } }, OPTS);
  assert.equal(p.breaths, 8); assert.equal(p.baselinePleural, g0.baselinePleural); assert.equal(p.pleuralGradient, g0.pleuralGradient);
});

test('prone from supine history is not applied twice: switching posture reuses the supplied recruitment state only', () => {
  const p = createPatient('high', 51, 64); simulate(p, S, OPTS);
  const state = snap(p);
  const prone = simulateExperiment(snap(p), { ...S, experiment: { posture: 'prone' } }, OPTS);
  const again = simulateExperiment(snap(state), { ...S, experiment: { posture: 'prone' } }, OPTS);
  assert.deepStrictEqual(prone, again);
  const back = simulateExperiment(p, { ...S }, OPTS);
  const ref = simulate(snap(state), S, OPTS);
  assert.deepStrictEqual(back, ref);
});

// ---- negative-pressure external drive -----------------------------------------------------------------------------------------------
test('external drive is an exact re-expression of the matched airway-drive solve, per frame and per metric', () => {
  for (const settings of [S, { ...S, peep: 5, pressureLimit: 22 }]) {
    for (const exp of [null, { posture: 'prone', proneGradientFactor: 0.7, chestLoad: 2 }]) {
      const kind = 'high', rec = { ...OPTS, recordTrajectory: true };
      const base = exp ? simulateExperiment(createPatient(kind, 61, 64), { ...settings, experiment: { ...exp, drive: 'airway' } }, rec) : simulate(createPatient(kind, 61, 64), settings, rec);
      const e = simulateExperiment(createPatient(kind, 61, 64), { ...settings, experiment: { ...exp, drive: 'external' } }, rec);
      assert.deepStrictEqual(e.units, base.units); assert.equal(e.targetVT, base.targetVT);
      for (const key of ['eelv', 'vtDelivered', 'openEE', 'openEI', 'cyclic', 'over', 'closedPerfusion', 'transpulmonaryEI', 'volumeError', 'volumeResidual', 'limited']) assert.equal(e.metrics[key], base.metrics[key], key);
      assert.equal(e.metrics.pplat, 0); assert.equal(e.metrics.dp, 0); assert.equal(e.metrics.crs, null);
      assert.equal(e.metrics.meanPleuralEE, base.metrics.meanPleuralEE - settings.peep); assert.equal(e.metrics.meanPleuralEI, base.metrics.meanPleuralEI - base.metrics.pplat);
      near(0 - e.metrics.meanPleuralEI, e.metrics.transpulmonaryEI, 1e-12, 'Paw - Ppl at EI');
      assert.equal(e.maxPressure, base.maxPressure);
      assert.equal(e.conditions.maxDrivePressure, base.maxPressure); assert.equal(e.conditions.drivePressureLimit, settings.pressureLimit);
      assert.equal(e.conditions.transrespDP, base.metrics.dp); assert.equal(e.conditions.transrespCrs, base.metrics.crs);
      assert.equal(e.conditions.pExtEE, -settings.peep); assert.equal(e.conditions.pExtEI, -base.metrics.pplat); assert.equal(e.conditions.airwayEE, 0); assert.equal(e.conditions.airwayEI, 0);
      assert.equal(e.conditions.drive, 'external');
      assert.equal(e.pv.length, base.pv.length);
      e.pv.forEach((pt, i) => { assert.equal(pt.pressure, 0); assert.equal(pt.transresp, base.pv[i].pressure); assert.equal(pt.volume, base.pv[i].volume); assert.equal(pt.phase, base.pv[i].phase); });
      assert.equal(e.trajectory.frames.length, base.trajectory.frames.length);
      e.trajectory.frames.forEach((fr, i) => {
        const o = base.trajectory.frames[i];
        assert.equal(fr.pressure, 0); assert.equal(fr.externalPressure, -o.pressure); assert.equal(fr.transrespPressure, o.pressure);
        assert.equal(fr.meanPleural, o.meanPleural - o.pressure);
        assert.equal(fr.pressure - fr.meanPleural, o.pressure - o.meanPleural, `transpulmonary frame ${i}`);
        for (const key of ['time', 'phase', 'volume', 'open', 'ceilingActive']) assert.equal(fr[key], o[key], key);
        for (const key of ['unitOpen', 'unitVolume', 'unitRatio']) assert.deepStrictEqual(fr[key], o[key], key);
      });
    }
  }
  const limited = simulateExperiment(createPatient('low', 62, 64), { ...S, pressureLimit: 18, experiment: { drive: 'external' } }, OPTS);
  assert.equal(limited.metrics.limited, true); assert.ok(limited.conditions.maxDrivePressure <= 18 + 1e-9); assert.equal(limited.conditions.maxDrivePressure, limited.maxPressure);
});

// ---- sweeps ---------------------------------------------------------------------------------------------------------------------------
test('nondefault sweeps run sequentially on one fresh clone; external drive sweeps are rejected', () => {
  const settings = { vt: 6, rr: 20, pressureLimit: 45 }, exp = { posture: 'prone', proneGradientFactor: 0.6, chestLoad: 2 }, peeps = [6, 10, 14];
  const patient = createPatient('high', 71, 64), before = snap(patient);
  const r = sweepExperiment(patient, { ...settings, experiment: exp }, { peeps, breaths: 3 });
  assert.deepStrictEqual(patient, before);
  const manual = createPatient('high', 71, 64), run = peep => ({ peep, ...simulateExperiment(manual, { ...settings, peep, experiment: exp }, { breaths: 3, dt: 0.1 }).metrics });
  const ascending = peeps.map(run), descending = [...peeps].reverse().map(run);
  assert.deepStrictEqual(r.ascending, ascending); assert.deepStrictEqual(r.descending, descending);
  assert.deepStrictEqual(r.experiment, normalizeExperiment(exp)); assert.equal(r.breathsPerStep, 3);
  const fresh = simulateExperiment(createPatient('high', 71, 64), { ...settings, peep: 6, experiment: exp }, { breaths: 3 }).metrics;
  assert.notEqual(r.descending[2].openEE, fresh.openEE);
  const current = createPatient('high', 71, 64); simulate(current, { ...settings, peep: 12 }, OPTS);
  const cb = snap(current), rc = sweepExperiment(current, { ...settings, experiment: exp }, { peeps, breaths: 3, initialState: 'current' });
  assert.deepStrictEqual(current, cb); assert.notDeepEqual(rc.ascending, r.ascending);
  const state = snap(current), m2 = snap(state), run2 = peep => ({ peep, ...simulateExperiment(m2, { ...settings, peep, experiment: exp }, { breaths: 3, dt: 0.1 }).metrics });
  assert.deepStrictEqual(rc.ascending, peeps.map(run2));
  assert.throws(() => sweepExperiment(patient, { ...settings, experiment: { drive: 'external' } }), /External-drive/);
  assert.throws(() => sweepExperiment(patient, { ...settings, experiment: { chestLoad: 1 } }, { peeps: [8] }), /two finite/);
  assert.throws(() => sweepExperiment(patient, { ...settings, experiment: { chestLoad: 1 } }, { initialState: 'x' }), /initialState/);
  const hd = sweepExperiment(createPatient('healthyDependent', 3, 64), { ...settings, experiment: { posture: 'prone' } }, { peeps: [0, 5], breaths: 3 });
  assert.equal(hd.ascending.length, 2); assert.ok(hd.ascending[1].openEE >= hd.ascending[0].openEE);
});

// ---- session and worker ----------------------------------------------------------------------------------------------------------------
const config = [{ kind: 'high', seed: 11, pbw: 70 }, { kind: 'healthyDependent', seed: 12, pbw: 60 }];
const fresh = () => config.map(c => createPatient(c.kind, c.seed, 512, c.pbw));
const cmp = (id, settings, extra = {}) => ({ id, type: 'compare', config, settings, reset: false, ...extra });
const ack = id => ({ id, type: 'accept-state' });
const direct = (patients, settings) => patients.map(p => ({ ...simulateExperiment(p, settings, { breaths: 10, dt: 0.1 }), phenotype: p.kind, seed: p.seed }));
const PRONE = { peep: 8, vt: 6, experiment: { posture: 'prone', proneGradientFactor: 0.5, chestLoad: 1 } };

test('session compare runs experiments, retains state and stores the accepted experiment; invalid requests never promote', () => {
  const s = createSession(), ref = fresh();
  const r1 = s.handle(cmp(1, PRONE, { reset: true }));
  assert.deepStrictEqual(r1.results, direct(ref, PRONE));
  assert.deepStrictEqual(r1.results[0].settings.experiment, normalizeExperiment(PRONE.experiment));
  assert.equal(s.handle(ack(1)).type, 'state-accepted');
  const next = { peep: 12, vt: 6, experiment: { drive: 'external' } };
  assert.deepStrictEqual(s.handle(cmp(2, next, { baseStateToken: 1 })).results, direct(ref, next));
  assert.throws(() => s.handle(cmp(3, { peep: 8, experiment: { posture: 'sideways' } }, { baseStateToken: 1 })), /posture/);
  assert.deepEqual(s.handle(ack(3)), { id: 3, type: 'state-ignored', stateToken: 1 });
  assert.deepEqual(s.handle(ack(2)), { id: 2, type: 'state-ignored', stateToken: 1 });
  assert.throws(() => s.handle(cmp(4, { peep: 8, experiment: { chestLoad: 99 } }, { reset: true })), /chestLoad/);
  assert.deepEqual(s.handle(ack(4)), { id: 4, type: 'state-ignored', stateToken: 1 });
  const fresh5 = fresh(); direct(fresh5, PRONE);
  assert.deepStrictEqual(s.handle(cmp(5, { peep: 6, vt: 6 }, { baseStateToken: 1 })).results, direct(fresh5, { peep: 6, vt: 6 }));
  const def = s.handle(cmp(6, { peep: 8, vt: 6 }, { reset: true }));
  assert.equal('conditions' in def.results[0], false); assert.equal('experiment' in def.results[0].settings, false);
});

test('airflow rejects any nondefault requested or accepted experiment, even for the same accepted configuration', () => {
  const s = createSession(), A = { peep: 8, vt: 6 };
  s.handle(cmp(1, A, { reset: true })); s.handle(ack(1));
  assert.throws(() => s.handle({ id: 2, type: 'airflow', config, settings: { ...A, experiment: { posture: 'prone' } }, baseStateToken: 1 }), /nondefault experiment/);
  assert.throws(() => s.handle({ id: 2, type: 'airflow', config, settings: { ...A, experiment: { drive: 'external' } }, baseStateToken: 1 }), /nondefault experiment/);
  assert.throws(() => s.handle({ id: 2, type: 'airflow', config, settings: { ...A, experiment: { chestLoad: 20 } }, baseStateToken: 1 }), /chestLoad/);
  const ok = s.handle({ id: 2, type: 'airflow', config, settings: { ...A, experiment: { posture: 'supine', chestLoad: 0, proneGradientFactor: 0.9 } }, params: { R0: 0.016, Rp: 0.004 }, baseStateToken: 1 });
  assert.equal(ok.type, 'airflow');
  assert.ok(ok.results.every(r => !('experiment' in r.settings)));
  const plain = createSession(); plain.handle(cmp(1, A, { reset: true })); plain.handle(ack(1));
  assert.deepStrictEqual(plain.handle({ id: 2, type: 'airflow', config, settings: A, params: { R0: 0.016, Rp: 0.004 }, baseStateToken: 1 }).results, ok.results);
  const t = createSession();
  t.handle(cmp(1, { ...A, experiment: { posture: 'prone' } }, { reset: true })); t.handle(ack(1));
  assert.throws(() => t.handle({ id: 2, type: 'airflow', config, settings: A, baseStateToken: 1 }), /nondefault experiment/);
  assert.throws(() => t.handle({ id: 2, type: 'airflow', config, settings: { ...A, experiment: { drive: 'airway' } }, baseStateToken: 1 }), /nondefault experiment/);
  const retained = t.handle(cmp(3, A, { baseStateToken: 1 }));
  assert.equal(retained.type, 'compare');
  t.handle(ack(3));
  const afterDefault = t.handle({ id: 4, type: 'airflow', config, settings: A, params: { R0: 0.016, Rp: 0.004 }, baseStateToken: 3 });
  assert.equal(afterDefault.type, 'airflow');
});

test('worker sweeps use sweepExperiment and report rejected external sweeps by id', async () => {
  const messages = [];
  globalThis.self = { postMessage: m => messages.push(m) };
  await import('../src/worker.js');
  const send = async data => { messages.length = 0; await self.onmessage({ data }); return [...messages]; };
  const settings = { peep: 8, vt: 6, experiment: { posture: 'prone', chestLoad: 1 } };
  const [sw] = await send({ id: 1, type: 'sweep', config: [config[1]], settings });
  assert.equal(sw.type, 'sweep');
  assert.deepStrictEqual(sw.results[0], sweepExperiment(createPatient('healthyDependent', 12, 512, 60), settings));
  const [plain] = await send({ id: 2, type: 'sweep', config: [config[0]], settings: { peep: 8, vt: 6 } });
  assert.deepStrictEqual(plain.results[0], sweep(createPatient('high', 11, 512, 70), { peep: 8, vt: 6 }));
  const [err] = await send({ id: 3, type: 'sweep', config: [config[0]], settings: { peep: 8, vt: 6, experiment: { drive: 'external' } } });
  assert.equal(err.type, 'error'); assert.equal(err.id, 3); assert.equal(err.requestType, 'sweep'); assert.match(err.message, /External-drive/);
  const [c] = await send({ id: 4, type: 'compare', config, settings: PRONE, reset: true });
  assert.deepStrictEqual(c.results, direct(fresh(), PRONE));
});
