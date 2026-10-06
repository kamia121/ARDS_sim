import test from 'node:test';
import assert from 'node:assert/strict';
import { createPatient, simulate, MAX_TRAJECTORY_VALUES } from '../src/engine.js';

const KINDS = ['high', 'low', 'wall', 'healthy'];
const CASES = [
  ...KINDS.map(kind => ({ name: kind, kind, settings: { peep: 10, vt: 6 }, options: { breaths: 3 } })),
  ...KINDS.map(kind => ({ name: `${kind} RR13`, kind, settings: { peep: 8, vt: 7, rr: 13 }, options: { breaths: 2, dt: 0.07 } })),
  { name: 'low pressure limited', kind: 'low', settings: { peep: 8, vt: 10, pressureLimit: 20 }, options: { breaths: 3 } },
  { name: 'high pressure limited', kind: 'high', settings: { peep: 12, vt: 12, pressureLimit: 24 }, options: { breaths: 2 } }
];
const run = (c, record) => {
  const patient = createPatient(c.kind, 4242, 96);
  const result = simulate(patient, c.settings, { ...c.options, recordTrajectory: record });
  return { patient, result };
};
const without = ({ trajectory, ...rest }) => rest;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);
const sum = arr => arr.reduce((s, x) => s + x, 0);

test('recording does not change results or carried patient state', () => {
  for (const c of CASES) {
    const off = run(c, false), on = run(c, true);
    assert.equal('trajectory' in off.result, false, c.name);
    assert.deepStrictEqual(without(on.result), off.result, c.name);
    assert.deepStrictEqual(on.patient, off.patient, c.name);
    const explicit = simulate(createPatient(c.kind, 4242, 96), c.settings, { ...c.options });
    assert.deepStrictEqual(explicit, off.result, c.name);
  }
});

test('frame 0 and EI frame equal unit snapshots and aggregate metrics', () => {
  for (const c of CASES) {
    const { result: r } = run(c, true), t = r.trajectory, f0 = t.frames[0], ei = t.frames[t.eiIndex];
    assert.equal(t.kind, 'quasi-static-steps');
    assert.equal(f0.phase, 'start'); assert.equal(f0.time, 0);
    assert.equal(f0.pressure, r.settings.peep);
    assert.equal(f0.volume, r.metrics.eelv); assert.equal(f0.open, r.metrics.openEE); assert.equal(f0.meanPleural, r.metrics.meanPleuralEE);
    assert.equal(ei.phase, 'inspiration');
    assert.equal(ei.pressure, r.metrics.pplat); assert.equal(ei.open, r.metrics.openEI); assert.equal(ei.meanPleural, r.metrics.meanPleuralEI);
    near(ei.volume - f0.volume, r.metrics.vtDelivered, 1e-9, c.name);
    r.units.forEach((u, i) => {
      assert.equal(f0.unitOpen[i], u.openEE, c.name); assert.equal(f0.unitVolume[i], u.volumeEE, c.name);
      assert.equal(ei.unitOpen[i], u.openEI, c.name); assert.equal(ei.unitVolume[i], u.volumeEI, c.name);
    });
    assert.equal(t.frames[t.eiIndex].volume, r.pv[t.eiIndex].volume); assert.equal(f0.volume, r.pv[0].volume);
  }
});

test('frame volumes match PV output and final frame equals stored recruitment state', () => {
  for (const c of CASES) {
    const { result: r } = run(c, true), t = r.trajectory, last = t.frames.at(-1);
    const insp = t.frames.filter(f => f.phase === 'inspiration'), exp = t.frames.filter(f => f.phase === 'expiration');
    insp.forEach((f, k) => { assert.equal(f.volume, r.pv[k + 1].volume, c.name); assert.equal(f.pressure, r.pv[k + 1].pressure, c.name); });
    exp.forEach((f, k) => { assert.equal(f.volume, r.pv[insp.length + 1 + k].volume, c.name); assert.equal(f.pressure, r.settings.peep); });
    assert.equal(last.phase, 'expiration');
    r.units.forEach((u, i) => assert.equal(last.unitOpen[i], u.state, c.name));
  }
});

test('unit volumes sum to frame volume and weighted unit f equals open', () => {
  for (const c of CASES) {
    const { patient, result: r } = run(c, true);
    for (const [k, f] of r.trajectory.frames.entries()) {
      near(sum(Array.from(f.unitVolume)), f.volume, 1e-7, `${c.name} frame ${k} volume`);
      near(patient.units.reduce((s, u, i) => s + u.weight * f.unitOpen[i], 0), f.open, 1e-12, `${c.name} frame ${k} open`);
      assert.ok(f.open >= 0 && f.open <= 1 + 1e-12);
      assert.ok(f.unitOpen.every(x => x >= 0 && x <= 1));
      const depMean = patient.units.reduce((s, u) => s + u.weight * u.dep, 0);
      near(f.meanPleural, patient.baselinePleural + patient.pleuralGradient * depMean + patient.chestWallElastance * (f.volume - patient.chestWallReferenceVolume), 1e-12);
    }
  }
});

test('timestamps for non-divisor RR13, indices, phases and duplicate release time', () => {
  const rr = 13, dt = 0.1, cycle = 60 / rr, ti = cycle / 3, te = cycle - ti;
  const ni = Math.ceil(ti / dt), ne = Math.ceil(te / dt), stepI = ti / ni, stepE = te / ne;
  assert.ok(Math.abs(ni * dt - ti) > 1e-6);
  const r = simulate(createPatient('high', 7, 64), { peep: 8, vt: 6, rr }, { breaths: 3, dt, recordTrajectory: true }), t = r.trajectory;
  assert.equal(t.cycle, cycle); assert.equal(t.ti, ti);
  assert.equal(t.eiIndex, ni); assert.equal(t.releaseIndex, ni + 1);
  assert.equal(t.frames.length, ni + ne + 2);
  assert.deepEqual(t.frames.map(f => f.phase), ['start', ...Array(ni).fill('inspiration'), 'release', ...Array(ne).fill('expiration')]);
  assert.equal(t.frames[0].time, 0);
  for (let j = 1; j < ni; j++) assert.equal(t.frames[j].time, j * stepI);
  assert.equal(t.frames[t.eiIndex].time, ti); assert.equal(t.frames[t.releaseIndex].time, ti);
  for (let j = 0; j < ne - 1; j++) assert.equal(t.frames[t.releaseIndex + 1 + j].time, ti + (j + 1) * stepE);
  assert.equal(t.frames.at(-1).time, cycle);
  t.frames.forEach((f, k) => {
    assert.ok(f.time >= 0 && f.time <= cycle);
    if (k > 0) assert.ok(f.time >= t.frames[k - 1].time);
    if (k > 0 && k !== t.releaseIndex) assert.ok(f.time > t.frames[k - 1].time, `strictly increasing at ${k}`);
  });
  assert.equal(r.pv.length, ni + ne + 1);
});

test('release is a non-committing PEEP step at EI recruitment state', () => {
  for (const c of CASES) {
    const { result: r } = run(c, true), t = r.trajectory, ei = t.frames[t.eiIndex], rel = t.frames[t.releaseIndex];
    assert.equal(rel.phase, 'release'); assert.equal(rel.time, ei.time);
    assert.equal(rel.pressure, r.settings.peep);
    for (let i = 0; i < ei.unitOpen.length; i++) assert.equal(rel.unitOpen[i], ei.unitOpen[i], c.name);
    assert.equal(rel.open, ei.open);
    assert.ok(rel.volume <= ei.volume + 1e-9, c.name);
    assert.equal(rel.ceilingActive, false);
    assert.equal(t.frames[t.releaseIndex + 1].phase, 'expiration');
  }
});

test('ceilingActive marks inspiratory ceiling branch only', () => {
  const free = run(CASES[0], true).result.trajectory;
  assert.ok(free.frames.every(f => f.ceilingActive === false));
  const limited = run(CASES.find(c => c.name === 'low pressure limited'), true).result;
  const t = limited.trajectory;
  assert.equal(limited.metrics.limited, true);
  assert.ok(t.frames.some(f => f.phase === 'inspiration' && f.ceilingActive));
  assert.ok(t.frames.filter(f => f.phase !== 'inspiration').every(f => !f.ceilingActive));
  assert.equal(t.frames[t.eiIndex].ceilingActive, true);
  assert.ok(Math.abs(t.frames[t.eiIndex].pressure - 20) < 1e-6);
});

test('single fixed-open linear compartment release volume matches analytic expression', () => {
  const peep = 8, cl = 100, ew = 0.01, offset = 2, v0 = 2000, vref = 2000;
  const p = createPatient('healthy', 1, 1);
  Object.assign(p, { baselinePleural: offset, pleuralGradient: 0, chestWallElastance: ew, chestWallReferenceVolume: vref });
  Object.assign(p.units[0], { weight: 1, rest: v0, linearCompliance: cl, f: 1, fixedOpen: true });
  const vt = 6 * p.pbw, crs = 1 / (1 / cl + ew);
  const eelv = (v0 + cl * (peep - offset + ew * vref)) / (1 + cl * ew);
  const r = simulate(p, { peep, vt: 6 }, { breaths: 2, recordTrajectory: true }), t = r.trajectory;
  const rel = t.frames[t.releaseIndex], ei = t.frames[t.eiIndex];
  near(rel.volume, eelv, 1e-6); near(ei.volume, eelv + vt, 1e-6); near(ei.pressure, peep + vt / crs, 1e-6);
  near(rel.volume, ei.volume - crs * (ei.pressure - peep), 1e-6);
  near(rel.unitVolume[0], eelv, 1e-6);
  assert.equal(rel.pressure, peep); assert.equal(rel.open, 1);
  for (const f of t.frames.filter(f => f.phase === 'expiration')) near(f.volume, eelv, 1e-6);
  near(t.frames[0].volume, eelv, 1e-6);
});

test('invalid recordTrajectory types and excessive recording are rejected without side effects', () => {
  for (const bad of ['yes', 1, 0, null, {}, []]) {
    const p = createPatient('high', 1, 8);
    assert.throws(() => simulate(p, {}, { recordTrajectory: bad }), TypeError, String(bad));
    assert.equal(p.breaths, 0); assert.equal(p.elapsed, 0);
  }
  assert.equal(simulate(createPatient('high', 1, 8), {}, { breaths: 1, recordTrajectory: undefined }).trajectory, undefined);

  const big = createPatient('high', 1, 10000);
  const before = structuredClone(big);
  assert.throws(() => simulate(big, {}, { breaths: 1, recordTrajectory: true }), RangeError);
  assert.deepStrictEqual(big, before);

  // Largest unit count under the cap at RR20/dt0.1 (32 frames).
  const frames = 32, atCap = Math.floor(MAX_TRAJECTORY_VALUES / frames);
  const ok = simulate(createPatient('healthy', 1, atCap), { peep: 5 }, { breaths: 1, recordTrajectory: true });
  assert.equal(ok.trajectory.frames.length, frames);
  assert.ok(ok.trajectory.frames.length * atCap <= MAX_TRAJECTORY_VALUES);
  assert.throws(() => simulate(createPatient('healthy', 1, atCap + 1), { peep: 5 }, { breaths: 1, recordTrajectory: true }), RangeError);
  assert.throws(() => simulate(createPatient('high', 1, 8), {}, { breaths: 1, dt: 0.00005, recordTrajectory: true }), RangeError);
});

test('recording is reproducible, structured-cloneable and arrays are independent', () => {
  const c = CASES[4];
  const a = run(c, true).result.trajectory, b = run(c, true).result.trajectory;
  assert.deepStrictEqual(a, b);
  const cloned = structuredClone(a);
  assert.deepStrictEqual(cloned, a);
  assert.ok(cloned.frames.every(f => f.unitOpen instanceof Float64Array && f.unitVolume instanceof Float64Array));
  const buffers = new Set(a.frames.flatMap(f => [f.unitOpen.buffer, f.unitVolume.buffer, f.unitRatio.buffer]));
  assert.equal(buffers.size, a.frames.length * 3);
  const snapshot = Array.from(a.frames[1].unitOpen), before = Array.from(a.frames[0].unitOpen);
  a.frames[0].unitOpen.fill(-1);
  assert.deepStrictEqual(Array.from(a.frames[1].unitOpen), snapshot);
  assert.notDeepEqual(Array.from(a.frames[0].unitOpen), before);
  const p = createPatient(c.kind, 4242, 96), r = simulate(p, c.settings, { ...c.options, recordTrajectory: true });
  const f = p.units.map(u => u.f);
  r.trajectory.frames.forEach(fr => fr.unitOpen.fill(0));
  assert.deepStrictEqual(p.units.map(u => u.f), f);
});

test('display-only unitRatio is finite, typed, and equals EI strainEI exactly', () => {
  for (const c of CASES) {
    const { result: r } = run(c, true), t = r.trajectory, ei = t.frames[t.eiIndex];
    for (const [k, f] of t.frames.entries()) {
      assert.ok(f.unitRatio instanceof Float64Array, `${c.name} frame ${k}`);
      assert.equal(f.unitRatio.length, r.units.length);
      assert.ok(f.unitRatio.every(x => Number.isFinite(x) && x >= 0), `${c.name} frame ${k} finite`);
    }
    r.units.forEach((u, i) => assert.equal(ei.unitRatio[i], u.strainEI, `${c.name} unit ${i}`));
  }
});
