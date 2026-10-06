import test from 'node:test';
import assert from 'node:assert/strict';
import { createPatient, regionalVolume, simulate, MODEL_INFO } from '../src/engine.js';
import { simulateAirflow } from '../src/airflow.js';
import { simulateExperiment } from '../src/experiments.js';
import { createSession } from '../src/session.js';
import { PLEURAL_READOUT_INFO, framePleural, pleuralField } from '../src/pleural-readout.js';

const PRESETS = ['high', 'low', 'wall', 'healthy', 'healthyDependent'];
const EXPERIMENTS = [
  {},
  { posture: 'prone', proneGradientFactor: 0 }, { posture: 'prone', proneGradientFactor: 0.5 }, { posture: 'prone', proneGradientFactor: 1 },
  { chestLoad: 5 }, { chestLoad: 15 },
  { drive: 'external' }, { drive: 'external', posture: 'prone', proneGradientFactor: 0.5, chestLoad: 5 }
];
const SEED = 4242, COUNT = 96, SETTINGS = { peep: 8, vt: 6, rr: 20 };
const near = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b} (tol ${tol})`);
const runExperiment = (kind, experiment, record = true, settings = SETTINGS) => {
  const patient = createPatient(kind, SEED, COUNT);
  const result = simulateExperiment(patient, { ...settings, experiment }, { breaths: 3, recordTrajectory: true, recordPleuralField: record });
  return { patient, result, field: pleuralField(result.trajectory, result.units) };
};
const label = (kind, e) => `${kind} ${JSON.stringify(e)}`;
const stripPleural = result => { const copy = { ...result }; if (copy.trajectory) { const { pleural, ...rest } = copy.trajectory; copy.trajectory = rest; } return copy; };

test('stored frames obey the original regional constitutive identities at the reconstructed local pleural pressure', () => {
  for (const kind of PRESETS) for (const e of EXPERIMENTS) {
    const { result, field } = runExperiment(kind, e), original = createPatient(kind, SEED, COUNT);
    for (const frame of result.trajectory.frames) {
      const fp = framePleural(frame, field);
      // Volume-solved inspiration frames reproduce Paw exactly; pressure-solved frames (start, release, expiration, ceiling) carry the engine's 1e-8 cmH2O pressure-solve residual.
      const ratioTolerance = frame.phase === 'inspiration' && !frame.ceilingActive ? 1e-12 : 1e-9;
      original.units.forEach((u, i) => {
        const tp = frame.pressure - fp.pplAt(u.dep), full = regionalVolume(u, tp), reference = regionalVolume(u, MODEL_INFO.referenceTranspulmonaryPressure);
        near(frame.unitVolume[i], frame.unitOpen[i] * full, 1e-8, `${label(kind, e)} volume unit ${i}`);
        near(frame.unitRatio[i], full / reference, ratioTolerance, `${label(kind, e)} ratio unit ${i}`);
      });
    }
  }
});

test('local field keeps the weighted mean, the exact slope, the Pes identities and the model swing limitation', () => {
  for (const kind of PRESETS) for (const e of EXPERIMENTS) {
    const { patient, result, field } = runExperiment(kind, e), name = label(kind, e), t = result.trajectory;
    const expectedGradient = e.posture === 'prone' ? -(e.proneGradientFactor ?? 0.5) * patient.pleuralGradient : patient.pleuralGradient;
    near(field.gradient, expectedGradient, 1e-12, name);
    for (const frame of t.frames) {
      const fp = framePleural(frame, field);
      let mean = 0;
      for (const u of result.units) mean += u.weight * fp.pplAt(u.dep);
      near(mean, frame.meanPleural, 1e-10, `${name} weighted mean`);
      near(fp.pplAt(1) - fp.pplAt(0), field.gradient, 1e-10, `${name} slope`);
      near((fp.pplAt(0.9) - fp.pplAt(0.2)) / 0.7, field.gradient, 1e-10, `${name} interior slope`);
      near(fp.pplDorsal - fp.pplVentral, field.gradient, 1e-10, name);
      assert.equal(fp.assumedGradient, field.gradient);
      const sign = Math.sign(fp.pplDorsal - fp.pplVentral);
      if (e.posture === 'prone' && e.proneGradientFactor > 0) assert.equal(sign, -1, name);
      if (e.posture !== 'prone') assert.equal(sign, 1, name);
      near(fp.plMean, frame.pressure - frame.meanPleural, 1e-12, name);
      near(fp.plVentral, frame.pressure - fp.pplVentral, 1e-12, name);
      near(fp.plDorsal, frame.pressure - fp.pplDorsal, 1e-12, name);
      near(fp.plEs + fp.pesModel, frame.pressure, 1e-12, `${name} PL+Pes=Paw`);
      const atMean = framePleural(frame, { ...field, dEs: field.depMean });
      near(atMean.pesModel, frame.meanPleural, 1e-12, `${name} Pes at weighted mean`);
      const shifted = framePleural(frame, pleuralField(t, result.units, { esophagealDependency: field.dEs, pesOffset: 3 }));
      near(shifted.pesModel - fp.pesModel, 3, 1e-12, name); near(shifted.plEs - fp.plEs, -3, 1e-12, name);
      near(shifted.plEs + shifted.pesModel, frame.pressure, 1e-12, name);
      assert.equal(fp.pesModel, fp.pplAt(field.dEs) + field.offset);
    }
    const ei = t.frames[t.eiIndex], ee = t.frames[0], swing = result.metrics.meanPleuralEI - result.metrics.meanPleuralEE;
    near(ei.meanPleural - ee.meanPleural, swing, 1e-10, name);
    for (const dEs of [0, 0.2, 0.5, 0.65, 0.8, 1]) {
      const f = pleuralField(t, result.units, { esophagealDependency: dEs, pesOffset: -7 });
      near(framePleural(ei, f).pesModel - framePleural(ee, f).pesModel, swing, 1e-10, `${name} Pes swing at dEs ${dEs}`);
    }
  }
});

test('external drive transforms Pes by minus the source airway pressure and leaves derived PL unchanged', () => {
  for (const kind of PRESETS) for (const base of [{}, { posture: 'prone', proneGradientFactor: 0.5 }, { chestLoad: 10 }]) {
    const air = runExperiment(kind, base), ext = runExperiment(kind, { ...base, drive: 'external' }), name = label(kind, base);
    assert.equal(air.result.trajectory.frames.length, ext.result.trajectory.frames.length);
    assert.deepStrictEqual(ext.field, air.field);
    air.result.trajectory.frames.forEach((frame, k) => {
      const a = framePleural(frame, air.field), x = framePleural(ext.result.trajectory.frames[k], ext.field);
      assert.equal(ext.result.trajectory.frames[k].pressure, 0);
      near(x.pesModel, a.pesModel - frame.pressure, 1e-10, `${name} frame ${k} Pes`);
      near(x.pplVentral, a.pplVentral - frame.pressure, 1e-10, name); near(x.pplDorsal, a.pplDorsal - frame.pressure, 1e-10, name);
      near(x.plEs, a.plEs, 1e-10, `${name} frame ${k} PLes`); near(x.plMean, a.plMean, 1e-10, name);
      near(x.plVentral, a.plVentral, 1e-10, name); near(x.plDorsal, a.plDorsal, 1e-10, name);
    });
  }
});

test('airflow frames carry the mean, slope and continuous Ppl through the Paw step at release', () => {
  for (const kind of ['healthy', 'high', 'wall']) for (const posture of ['supine', 'prone']) {
    const base = createPatient(kind, 7, 64);
    const patient = posture === 'prone' ? Object.assign(base, { pleuralGradient: -0.5 * base.pleuralGradient }) : base;
    const before = structuredClone(patient);
    const result = simulateAirflow(patient, SETTINGS, { recordPleuralField: true }), t = result.trajectory, name = `${kind} ${posture}`;
    assert.deepStrictEqual(patient, before);
    assert.deepStrictEqual(Object.keys(t.pleural).sort(), ['depMean', 'gradient']);
    assert.equal(t.pleural.gradient, patient.pleuralGradient); assert.equal(t.pleural.depMean, result.airflow.reference.depMean);
    const field = pleuralField(t, result.units);
    for (const frame of t.frames) {
      const fp = framePleural(frame, field);
      let mean = 0;
      for (const u of result.units) mean += u.weight * fp.pplAt(u.dep);
      near(mean, frame.meanPleural, 1e-10, name); near(fp.pplDorsal - fp.pplVentral, field.gradient, 1e-10, name);
      near(fp.plEs + fp.pesModel, frame.pressure, 1e-12, name);
    }
    const ei = t.frames[t.eiIndex], release = t.frames[t.releaseIndex];
    assert.equal(ei.phase, 'inspiration'); assert.equal(release.phase, 'release');
    assert.notEqual(release.pressure, ei.pressure, `${name} Paw steps at release`);
    assert.equal(release.meanPleural, ei.meanPleural);
    const a = framePleural(ei, field), b = framePleural(release, field);
    for (const d of [0, 0.3, 0.65, 1]) assert.equal(b.pplAt(d), a.pplAt(d), `${name} Ppl(${d}) continuous`);
    assert.equal(b.pesModel, a.pesModel);
    near(b.plEs - a.plEs, release.pressure - ei.pressure, 1e-12, name);
  }
});

test('flag on and off differ only by trajectory.pleural and leave patient state exact', () => {
  for (const kind of PRESETS) for (const settings of [{ peep: 10, vt: 6 }, { peep: 8, vt: 10, pressureLimit: 20, rr: 13 }]) {
    const run = options => { const patient = createPatient(kind, SEED, COUNT); return { patient, result: simulate(patient, settings, { breaths: 3, ...options }) }; };
    const off = run({ recordTrajectory: true }), on = run({ recordTrajectory: true, recordPleuralField: true }), plain = run({}), explicitFalse = run({ recordTrajectory: true, recordPleuralField: false });
    assert.deepStrictEqual(stripPleural(on.result), off.result, kind);
    assert.deepStrictEqual(on.patient, off.patient, kind);
    assert.deepStrictEqual(explicitFalse.result, off.result, kind);
    assert.equal('pleural' in off.result.trajectory, false);
    assert.equal('trajectory' in plain.result, false);
    assert.deepStrictEqual(Object.keys(on.result.trajectory.pleural), ['gradient', 'depMean']);
    assert.equal(on.result.trajectory.pleural.gradient, on.patient.pleuralGradient);
    let dep = 0;
    for (const u of on.patient.units) dep += u.weight * u.dep;
    assert.equal(on.result.trajectory.pleural.depMean, dep);
  }
  for (const kind of PRESETS) for (const e of EXPERIMENTS) {
    const off = runExperiment(kind, e, false), on = runExperiment(kind, e, true);
    assert.deepStrictEqual(stripPleural(on.result), off.result, label(kind, e));
    assert.deepStrictEqual(on.patient, off.patient, label(kind, e));
    assert.equal(off.field, null);
  }
  const airflowPatient = () => createPatient('healthy', 7, 64);
  const aOff = simulateAirflow(airflowPatient(), SETTINGS, {}), aOn = simulateAirflow(airflowPatient(), SETTINGS, { recordPleuralField: true });
  assert.equal('pleural' in aOff.trajectory, false);
  assert.deepStrictEqual(stripPleural(aOn), aOff);
});

test('flag type and pairing are validated by the engine and airflow', () => {
  const p = () => createPatient('healthy', 1, 32);
  for (const bad of [1, 'true', null, {}]) {
    assert.throws(() => simulate(p(), SETTINGS, { recordTrajectory: true, recordPleuralField: bad }), TypeError);
    assert.throws(() => simulateAirflow(p(), SETTINGS, { recordPleuralField: bad }), TypeError);
  }
  assert.throws(() => simulate(p(), SETTINGS, { recordPleuralField: true }), RangeError);
  assert.throws(() => simulate(p(), SETTINGS, { recordTrajectory: false, recordPleuralField: true }), RangeError);
  assert.throws(() => simulateAirflow(p(), SETTINGS, { recordTrajectory: false, recordPleuralField: true }), RangeError);
  assert.equal(simulate(p(), SETTINGS, { recordPleuralField: false }).trajectory, undefined);
  const noTrajectory = simulateAirflow(p(), SETTINGS, { recordTrajectory: false });
  assert.equal(noTrajectory.trajectory, undefined);
});

test('session forwards the flag only when requested and airflow prepare without a trajectory cannot throw', () => {
  const session = createSession(), config = [{ kind: 'healthy', seed: 3, pbw: 70 }, { kind: 'high', seed: 4, pbw: 70 }], settings = { peep: 8, vt: 6, rr: 20 };
  const compare = (id, extra) => session.handle({ type: 'compare', id, config, settings, reset: true, ...extra });
  const plain = compare(1, {});
  assert.ok(plain.results.every(r => r.trajectory === undefined));
  const noTrajectory = compare(2, { recordPleuralField: true });
  assert.ok(noTrajectory.results.every(r => r.trajectory === undefined));
  const trajectoryOnly = compare(3, { recordTrajectory: true });
  assert.ok(trajectoryOnly.results.every(r => r.trajectory && !('pleural' in r.trajectory)));
  assert.ok(compare(4, { recordTrajectory: true, recordPleuralField: 'true' }).results.every(r => !('pleural' in r.trajectory)));
  const both = compare(5, { recordTrajectory: true, recordPleuralField: true });
  both.results.forEach((r, i) => {
    assert.deepStrictEqual(Object.keys(r.trajectory.pleural), ['gradient', 'depMean']);
    assert.ok(pleuralField(r.trajectory, r.units) !== null, config[i].kind);
  });
  assert.deepStrictEqual(session.handle({ type: 'accept-state', id: 5 }), { id: 5, type: 'state-accepted', stateToken: 5 });
  const airflow = (id, extra) => session.handle({ type: 'airflow', id, config, settings, baseStateToken: 5, ...extra });
  assert.ok(airflow(6, {}).results.every(r => r.trajectory && !('pleural' in r.trajectory)));
  const flagged = airflow(7, { recordPleuralField: true });
  flagged.results.forEach(r => { assert.deepStrictEqual(Object.keys(r.trajectory.pleural), ['gradient', 'depMean']); assert.ok(pleuralField(r.trajectory, r.units)); });
  assert.ok(airflow(8, { recordPleuralField: 1 }).results.every(r => !('pleural' in r.trajectory)));
});

test('missing context returns null and non-finite or inconsistent inputs are rejected', () => {
  const { result, field } = runExperiment('high', {}), t = result.trajectory, units = result.units, frame = t.frames[3];
  assert.equal(pleuralField(undefined, units), null); assert.equal(pleuralField(null, units), null);
  assert.equal(pleuralField({ frames: t.frames }, units), null);
  assert.equal(pleuralField(runExperiment('high', {}, false).result.trajectory, units), null);
  assert.equal(framePleural(frame, null), null); assert.equal(framePleural(frame, undefined), null);
  const withMeta = pleural => ({ ...t, pleural });
  for (const bad of [{ gradient: NaN, depMean: field.depMean }, { gradient: Infinity, depMean: field.depMean }, { gradient: 1, depMean: NaN }, { gradient: 1, depMean: -0.01 }, { gradient: 1, depMean: 1.01 }, { gradient: '5', depMean: 0.5 }, { gradient: field.gradient, depMean: field.depMean + 1e-9 }]) {
    assert.throws(() => pleuralField(withMeta(bad), units), RangeError, JSON.stringify(bad));
  }
  assert.throws(() => pleuralField(t, undefined), TypeError);
  assert.throws(() => pleuralField(t, []), TypeError);
  assert.throws(() => pleuralField(t, units.slice(1)), RangeError);
  assert.throws(() => pleuralField(t, units.map(u => ({ ...u, weight: u.weight * 1.001 }))), RangeError);
  assert.throws(() => pleuralField(t, units.map((u, i) => i === 0 ? { ...u, weight: 0 } : u)), RangeError);
  assert.throws(() => pleuralField(t, units.map((u, i) => i === 0 ? { ...u, weight: NaN } : u)), RangeError);
  assert.throws(() => pleuralField(t, units.map((u, i) => i === 0 ? { ...u, dep: 1.2 } : u)), RangeError);
  assert.throws(() => pleuralField(t, units.map((u, i) => i === 0 ? { ...u, dep: NaN } : u)), RangeError);
  assert.throws(() => pleuralField({ ...t, frames: [{ unitVolume: new Float64Array(3) }] }, units), RangeError);
  for (const dEs of [-0.01, 1.01, NaN, Infinity, '0.5']) assert.throws(() => pleuralField(t, units, { esophagealDependency: dEs }), RangeError, String(dEs));
  for (const pesOffset of [-10.01, 10.01, NaN, -Infinity, '1']) assert.throws(() => pleuralField(t, units, { pesOffset }), RangeError, String(pesOffset));
  for (const [dEs, pesOffset] of [[0, -10], [1, 10]]) assert.ok(pleuralField(t, units, { esophagealDependency: dEs, pesOffset }));
  const frameBefore = structuredClone(frame), fieldBefore = structuredClone(field);
  const fp = framePleural(frame, field);
  assert.deepStrictEqual(frame, frameBefore); assert.deepStrictEqual(field, fieldBefore);
  for (const d of [-0.001, 1.001, NaN, Infinity, '0.5', undefined]) assert.throws(() => fp.pplAt(d), RangeError, String(d));
  assert.doesNotThrow(() => { fp.pplAt(0); fp.pplAt(1); });
  for (const bad of [{ ...frame, pressure: NaN }, { ...frame, meanPleural: Infinity }, { ...frame, pressure: undefined }]) assert.throws(() => framePleural(bad, field), TypeError);
  assert.throws(() => framePleural(null, field), TypeError);
  for (const bad of [{ ...field, gradient: NaN }, { ...field, dEs: 2 }, { ...field, depMean: -1 }, { ...field, offset: Infinity }, { ...field, depMax: NaN }]) assert.throws(() => framePleural(frame, bad), RangeError);
  assert.deepStrictEqual(Object.keys(fp).sort(), ['assumedGradient', 'plDorsal', 'plEs', 'plMean', 'plVentral', 'pplAt', 'pplDorsal', 'pplVentral', 'pesModel'].sort());
  assert.deepStrictEqual(Object.keys(field).sort(), ['depMax', 'depMean', 'depMin', 'dEs', 'gradient', 'offset'].sort());
  near(field.depMin, Math.min(...units.map(u => u.dep)), 0); near(field.depMax, Math.max(...units.map(u => u.dep)), 0);
});

test('readout info records the assumed, uncalibrated surrogate and defaults', () => {
  assert.equal(Object.isFrozen(PLEURAL_READOUT_INFO), true);
  assert.equal(PLEURAL_READOUT_INFO.version, 1);
  assert.equal(PLEURAL_READOUT_INFO.esophagealDependency, 0.65);
  assert.equal(PLEURAL_READOUT_INFO.offset, 0);
  assert.deepStrictEqual([...PLEURAL_READOUT_INFO.offsetRange], [-10, 10]);
  assert.match(PLEURAL_READOUT_INFO.calibration, /Uncalibrated/);
  assert.match(PLEURAL_READOUT_INFO.calibration, /no balloon/i);
  const { result } = runExperiment('wall', {});
  const defaults = pleuralField(result.trajectory, result.units);
  assert.equal(defaults.dEs, 0.65); assert.equal(defaults.offset, 0);
});
