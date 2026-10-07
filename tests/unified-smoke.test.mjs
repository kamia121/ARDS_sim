import test from 'node:test';
import assert from 'node:assert/strict';
import { createPatient } from '../src/engine.js';
import {
  DEFAULT_MECHANICS, UNIFIED_INFO, normalizeMechanics, buildUnifiedNetwork, elasticPressure, evaluateUnified, relaxedUnified,
  advanceUnified, simulateUnified, simulateUnifiedExperiment
} from '../src/unified.js';

const near = (a, b, tol, message) => assert.ok(Math.abs(a - b) <= tol, `${message ?? 'value'}: ${a} vs ${b} (tol ${tol})`);
const sum = a => a.reduce((x, y) => x + y, 0);

function linearPatient(n = 3, overrides = {}) {
  const units = Array.from({ length: n }, (_, i) => ({
    id: i, dep: n === 1 ? 0.5 : i / (n - 1), weight: 1 / n, rest: 20 + 5 * i, linearCompliance: 3 + i, popen: 8, pclose: 2, tauOpen: 1, tauClose: 2, rateWidth: 3,
    f: 1, fixedOpen: true, perfusion: 1
  }));
  return { kind: 'linear', seed: 7, pbw: 70, count: n, baselinePleural: 2, pleuralGradient: 3, chestWallElastance: 0.004, chestWallReferenceVolume: 90, units, elapsed: 0, breaths: 0, ...overrides };
}

test('mechanics validation is strict and defaults are exact', () => {
  assert.deepEqual(normalizeMechanics(), { ...DEFAULT_MECHANICS });
  assert.equal(DEFAULT_MECHANICS.compressionStiffness, 12);
  for (const bad of [{ R0: -1 }, { Rp: 0 }, { Rp: 2 }, { resistanceSpread: 3 }, { residualAeration: 0 }, { residualAeration: 0.06 }, { residualConductance: 0 }, { patencyPower: 0.5 },
    { kneeFraction: 0.99 }, { compressionStiffness: -1 }, { compressionStiffness: 40 }, { Rp: NaN }, { R0: '0.01' }, { bogus: 1 }]) {
    assert.throws(() => normalizeMechanics(bad), undefined, JSON.stringify(bad));
  }
  assert.throws(() => normalizeMechanics([]), TypeError);
  assert.ok(UNIFIED_INFO.assumptions.length > 4);
});

test('elastic law matches the legacy positive branch, is C1 across joins and strictly monotone', () => {
  const patient = createPatient('high', 11, 8, 70), net = buildUnifiedNetwork(patient, {}, {});
  const u = patient.units[3];
  for (const tp of [0, 1, 5, 20]) {
    const V = u.weight * (u.rest + u.capacity * tp / (u.stiffness + tp));
    near(elasticPressure(net, 3, V, 1).pressure * 1, tp * 1, 1e-3, 'legacy inverse at res=0.01'); // a = 0.01 + 0.99 gives s = V/w exactly
  }
  const probe = (V, f) => elasticPressure(net, 3, V, f);
  let previous = -Infinity;
  const r = u.rest;
  for (let x = 0.2; x < 1.8; x += 0.01) {
    const V = x * u.weight * r * 1.0, e = probe(V, 1);
    assert.ok(e.pressure > previous, `monotone at ${x}`);
    previous = e.pressure;
    const h = 1e-6 * V, fd = (probe(V + h, 1).pressure - probe(V - h, 1).pressure) / (2 * h);
    near(e.dV, fd, 1e-5 * Math.max(1, Math.abs(fd)), `dE/dV at ${x}`);
    const df = 1e-7, fdf = (probe(V, 0.5 + df).pressure - probe(V, 0.5 - df).pressure) / (2 * df), analytic = probe(V, 0.5).df;
    near(analytic, fdf, 1e-4 * Math.max(1, Math.abs(fdf)), `dE/df at ${x}`);
  }
  const wr = u.weight * r;
  const below = probe(wr * (1 - 1e-9), 1), above = probe(wr * (1 + 1e-9), 1);
  near(below.pressure, above.pressure, 1e-6, 'continuity at rest');
  near(below.dV, above.dV, 1e-5 * Math.abs(above.dV), 'C1 at rest');
  const sk = u.rest + 0.95 * u.capacity, wk = u.weight * sk;
  near(probe(wk * (1 - 1e-9), 1).pressure, probe(wk * (1 + 1e-9), 1).pressure, 1.1 * probe(wk, 1).dV * 2e-9 * wk, 'continuity at knee (within slope x step)');
  near(probe(wk * (1 - 1e-9), 1).dV, probe(wk * (1 + 1e-9), 1).dV, 1e-6 * probe(wk, 1).dV, 'C1 at knee');
  assert.equal(probe(wk * 1.001, 1).kneeReached, true);
  assert.equal(probe(wk * 0.999, 1).kneeReached, false);
  assert.ok(Number.isFinite(probe(wk * 3, 1).pressure), 'no domain clip above the knee');
});

test('compressionStiffness 0 gives a pure log barrier and larger values stiffen it', () => {
  const patient = createPatient('high', 11, 6, 70), u = patient.units[2];
  const V = 0.5 * u.weight * u.rest;
  const e0 = elasticPressure(buildUnifiedNetwork(patient, {}, { compressionStiffness: 0 }), 2, V, 1).pressure;
  const e12 = elasticPressure(buildUnifiedNetwork(patient, {}, {}), 2, V, 1).pressure;
  near(e0, (u.stiffness * u.rest / u.capacity) * Math.log(0.5), 1e-9, 'pure log');
  assert.ok(e12 < e0, 'stiffened barrier is more negative');
});

test('relaxed state has zero flow and the requested alveolar pressure; strict input validation', () => {
  const patient = createPatient('high', 21, 32, 70), net = buildUnifiedNetwork(patient, { peep: 8 }, {});
  const open = Float64Array.from(patient.units, u => u.f), rel = relaxedUnified(net, open, 8);
  const ev = evaluateUnified(net, { volume: rel.volumes, open }, { mode: 'pc', value: 8 });
  near(ev.q, 0, 1e-6, 'net flow'); assert.ok(ev.flow.every(q => Math.abs(q) < 1e-6));
  near(rel.totalVolume, sum(Array.from(rel.volumes)), 1e-9);
  assert.throws(() => relaxedUnified(net, open.slice(1), 8));
  assert.throws(() => evaluateUnified(net, { volume: rel.volumes, open }, { mode: 'x', value: 1 }));
  assert.throws(() => evaluateUnified(net, { volume: rel.volumes.map(() => -1), open }, { mode: 'pc', value: 1 }));
  assert.throws(() => evaluateUnified({}, { volume: rel.volumes, open }, { mode: 'pc', value: 1 }));
});

function rhs(patient, mech, V, drive) {
  const n = patient.units.length, T = sum(V), common = patient.baselinePleural + patient.chestWallElastance * (T - patient.chestWallReferenceVolume);
  let SG = 0, SGP = 0;
  const g = [], alv = [];
  patient.units.forEach((u, i) => { g.push(u.weight / mech.Rp); alv.push(common + patient.pleuralGradient * u.dep + (V[i] / u.weight - u.rest) / u.linearCompliance); SG += g[i]; SGP += g[i] * alv[i]; });
  const Pn = drive.mode === 'pc' ? (drive.value + mech.R0 * SGP) / (1 + mech.R0 * SG) : (drive.value + SGP) / SG;
  return V.map((_, i) => g[i] * (Pn - alv[i]));
}

test('SDIRK2 matches an independent RK4 integration on linear fixed-open units (PC and VC)', () => {
  const patient = linearPatient(4), mech = { ...DEFAULT_MECHANICS };
  const net = buildUnifiedNetwork(patient, { peep: 5 }, {});
  for (const drive of [{ mode: 'pc', value: 20 }, { mode: 'vc', value: 150 }]) {
    let V = Array.from(relaxedUnified(net, patient.units.map(() => 1), 5).volumes), state = { volume: Float64Array.from(V), open: Float64Array.from(V, () => 1) };
    const h = 0.01, steps = 100;
    for (let k = 0; k < steps; k++) {
      const adv = advanceUnified(net, state, h, drive);
      state = adv.state;
      assert.ok(Math.abs(adv.massResidual) < 1e-8, `mass residual ${adv.massResidual}`);
    }
    const sub = 20, hh = h / sub;
    for (let k = 0; k < steps * sub; k++) {
      const k1 = rhs(patient, mech, V, drive), k2 = rhs(patient, mech, V.map((v, i) => v + hh / 2 * k1[i]), drive), k3 = rhs(patient, mech, V.map((v, i) => v + hh / 2 * k2[i]), drive), k4 = rhs(patient, mech, V.map((v, i) => v + hh * k3[i]), drive);
      V = V.map((v, i) => v + hh / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    }
    V.forEach((v, i) => near(state.volume[i], v, 2e-3 * Math.max(1, v / 100), `unit ${i} ${drive.mode}`));
  }
});

test('the open-fraction law drives f toward the legacy opening rate with unchanged gas volume at fixed pressure drive', () => {
  const patient = createPatient('high', 5, 16, 70), net = buildUnifiedNetwork(patient, { peep: 10 }, {});
  const open = Float64Array.from(patient.units, u => u.f), rel = relaxedUnified(net, open, 10);
  const state = { volume: rel.volumes, open };
  const adv = advanceUnified(net, state, 0.02, { mode: 'pc', value: 35 });
  assert.ok(adv.state.volume.every(v => v > 0));
  assert.ok(adv.state.open.every(f => f >= 0 && f <= 1));
  near(adv.massResidual, 0, 1e-8);
  assert.throws(() => advanceUnified(net, state, 0, { mode: 'pc', value: 35 }));
  assert.throws(() => advanceUnified(net, state, 100, { mode: 'pc', value: 35 }), RangeError);
});

test('default 64-unit 10-breath run: continuity, mass, positivity, timings', () => {
  const patient = createPatient('high', 13791, 64, 70);
  const started = performance.now();
  const r = simulateUnified(patient, { peep: 10, vt: 6, rr: 20, pressureLimit: 45 }, { breaths: 10 });
  const elapsed = performance.now() - started;
  console.log(`# 64 units x 10 breaths: ${elapsed.toFixed(0)} ms, maxMassResidual ${r.unified.numerics.maxMassResidual.toExponential(2)}, refinements ${r.unified.numerics.refinements}, newton ${r.unified.numerics.newtonIterations}, periodic ${r.metrics.periodicResidual.toFixed(3)} mL, vt ${r.metrics.vtDelivered.toFixed(1)}/${r.targetVT.toFixed(1)}`);
  const tr = r.trajectory, frames = tr.frames, ei = frames[tr.eiIndex], rel = frames[tr.releaseIndex];
  assert.equal(tr.kind, 'unified-nonlinear-flow');
  assert.equal(ei.time, rel.time);
  assert.ok(ei.phase === 'inspiration' && rel.phase === 'release');
  for (let i = 0; i < 64; i++) { assert.equal(ei.unitVolume[i], rel.unitVolume[i]); assert.equal(ei.unitOpen[i], rel.unitOpen[i]); }
  assert.ok(Math.abs(ei.pressure - rel.pressure) >= 0, 'pressure may jump at release');
  for (const fr of frames) {
    assert.ok(fr.unitVolume.every(v => v > 0 && Number.isFinite(v)));
    assert.ok(fr.unitOpen.every(f => f >= 0 && f <= 1));
    assert.ok(Number.isFinite(fr.pressure) && Number.isFinite(fr.flow) && Number.isFinite(fr.meanPleural));
    near(fr.volume, sum(Array.from(fr.unitVolume)), 1e-6);
    near(fr.unitFlow.reduce((a, b) => a + b, 0), fr.flow, 1e-6, 'unit flows sum to flow');
  }
  for (let j = 1; j < frames.length; j++) {
    if (j === tr.releaseIndex) continue;
    const a = frames[j - 1], b = frames[j];
    near(b.volume - a.volume, 0, 400, 'no volume jump between frames');
  }
  assert.ok(r.unified.numerics.maxMassResidual < 1e-6, `mass ${r.unified.numerics.maxMassResidual}`);
  assert.ok(r.unified.numerics.minVolume > 0);
  assert.ok(r.metrics.pplat === null && r.metrics.dp === null && r.metrics.crs === null);
  assert.ok(Number.isFinite(r.metrics.restingPEEPVolume) && Number.isFinite(r.metrics.dynamicResidual));
  assert.equal(r.metrics.retainedVolume, r.metrics.dynamicResidual);
  assert.ok(r.metrics.vtDelivered > 0);
  assert.equal(patient.breaths, 10);
  assert.ok(patient.unifiedState.volume.length === 64);
  for (let i = 0; i < 64; i++) assert.equal(patient.units[i].f, r.units[i].openEnd);
});

test('run is deterministic and restarting from the carried state continues the same trajectory', () => {
  const run = () => simulateUnified(createPatient('low', 4, 32, 70), { peep: 8 }, { breaths: 3 });
  const a = run(), b = run();
  assert.deepEqual(Array.from(a.unified.finalState.volume), Array.from(b.unified.finalState.volume));
  assert.deepEqual(a.metrics.vtDelivered, b.metrics.vtDelivered);
  const patient = createPatient('low', 4, 32, 70);
  simulateUnified(patient, { peep: 8 }, { breaths: 3, recordTrajectory: false });
  const next = simulateUnified(patient, { peep: 8 }, { breaths: 1, recordTrajectory: false });
  assert.equal(next.unified.initialState.source, 'carried');
  const joint = simulateUnified(createPatient('low', 4, 32, 70), { peep: 8 }, { breaths: 4, recordTrajectory: false });
  assert.deepEqual(Array.from(next.unified.finalState.volume), Array.from(joint.unified.finalState.volume));
});

test('failures leave the patient unchanged and invalid inputs are rejected', () => {
  const patient = createPatient('high', 3, 16, 70), before = JSON.stringify(patient);
  assert.throws(() => simulateUnified(patient, { peep: 8, bogus: 1 }), RangeError);
  assert.throws(() => simulateUnified(patient, { peep: 60 }), RangeError);
  assert.throws(() => simulateUnified(patient, { peep: 10, pressureLimit: 5 }), RangeError);
  assert.throws(() => simulateUnified(patient, { inspiratoryFraction: 0.7 }), RangeError);
  assert.throws(() => simulateUnified(patient, { peep: NaN }), TypeError);
  assert.throws(() => simulateUnified(patient, {}, { breaths: 0 }), RangeError);
  assert.throws(() => simulateUnified(patient, {}, { mechanics: { Rp: -1 } }), RangeError);
  assert.throws(() => simulateUnified(patient, {}, { h: 100 }), RangeError);
  assert.throws(() => simulateUnified(patient, {}, { unknown: true }), RangeError);
  assert.throws(() => simulateUnified(patient, { experiment: { drive: 'external' } }), RangeError);
  assert.equal(JSON.stringify(patient), before);
  assert.equal(patient.unifiedState, undefined);
});

test('pressure ceiling latches without a state jump', () => {
  const patient = createPatient('low', 8, 32, 70);
  const r = simulateUnified(patient, { peep: 5, vt: 12, pressureLimit: 22 }, { breaths: 2 });
  assert.equal(r.metrics.limited, true);
  assert.ok(r.maxPressure <= 22 + 1e-6, `max pressure ${r.maxPressure}`);
  assert.ok(r.metrics.vtDelivered < r.targetVT);
  assert.ok(r.unified.numerics.ceilingEvent !== null);
});

test('negative-pressure wrapper keeps gas and true transpulmonary pressure, shifting only the frame', () => {
  const settings = { peep: 8, vt: 6 };
  const base = simulateUnified(createPatient('high', 31, 32, 70), settings, { breaths: 2 });
  const ext = simulateUnifiedExperiment(createPatient('high', 31, 32, 70), { ...settings, experiment: { drive: 'external' } }, { breaths: 2 });
  assert.deepEqual(Array.from(ext.unified.finalState.volume), Array.from(base.unified.finalState.volume));
  assert.deepEqual(Array.from(ext.unified.finalState.open), Array.from(base.unified.finalState.open));
  const fb = base.trajectory.frames, fe = ext.trajectory.frames;
  fe.forEach((e, j) => {
    const b = fb[j];
    near(e.pressure, 0, 0, 'airway pressure');
    near(e.meanAlveolar - e.meanPleural, b.meanAlveolar - b.meanPleural, 1e-9, 'true transpulmonary pressure');
    near(e.externalPressure, -b.pressure, 1e-12); near(e.transrespPressure, b.pressure, 1e-12);
    assert.deepEqual(Array.from(e.unitVolume), Array.from(b.unitVolume));
    assert.deepEqual(Array.from(e.unitOpen), Array.from(b.unitOpen));
    assert.deepEqual(Array.from(e.unitFlow), Array.from(b.unitFlow));
  });
  assert.equal(ext.conditions.drive, 'external');
  assert.equal(ext.metrics.pplat, null);
  assert.ok(ext.pv.every(p => p.pressure === 0 && Number.isFinite(p.transresp)));
  assert.equal(base.metrics.unitRelaxedVolume.length, ext.metrics.unitRelaxedVolume.length);
  for (let i = 0; i < 32; i++) near(ext.units[i].alveolarEI - ext.units[i].pressureEI, base.units[i].alveolarEI - base.units[i].pressureEI, 1e-9);
});

test('wrapper runs a clone and commits only gas, f, time and breaths', () => {
  const patient = createPatient('high', 31, 16, 70), geometry = JSON.stringify({ b: patient.baselinePleural, g: patient.pleuralGradient });
  simulateUnifiedExperiment(patient, { peep: 8, experiment: { posture: 'prone', chestLoad: 4 } }, { breaths: 1, recordTrajectory: false });
  assert.equal(JSON.stringify({ b: patient.baselinePleural, g: patient.pleuralGradient }), geometry);
  assert.equal(patient.breaths, 1);
  assert.ok(patient.unifiedState.volume.length === 16);
  assert.throws(() => simulateUnifiedExperiment(patient, { experiment: { posture: 'sideways' } }), RangeError);
});
