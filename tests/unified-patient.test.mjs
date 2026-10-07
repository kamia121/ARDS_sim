import test from 'node:test';
import assert from 'node:assert/strict';
import { createPatient } from '../src/engine.js';
import { RECRUITABILITY_DEFAULTS, normalizeRecruitability, createUnifiedPatient } from '../src/unified-patient.js';

const KINDS = ['high', 'low', 'wall', 'healthy', 'healthyDependent'];
const SEEDS = [13791, 4242];
const COUNTS = [64, 512];
const PBWS = [70, 100];
const UNIT_INTRINSIC = ['id', 'dep', 'weight', 'capacity', 'rest', 'stiffness', 'rateWidth', 'perfusion'];
const TOP_INTRINSIC = ['kind', 'seed', 'pbw', 'count', 'baselinePleural', 'pleuralGradient', 'chestWallElastance', 'chestWallReferenceVolume', 'elapsed', 'breaths'];
// Ordinary opening thresholds stay below 38 for every kind, so the default difficult range identifies difficult units.
const isHard = u => u.popen >= 38;
const hardIds = p => p.units.filter(isHard).map(u => u.id);
const same = (a, b, label) => assert.ok(Object.is(a, b), `${label}: ${a} !== ${b}`);

test('defaults table is complete, frozen and normalizer returns fresh full config', () => {
  assert.deepEqual(Object.keys(RECRUITABILITY_DEFAULTS).sort(), [...KINDS].sort());
  const fractions = { high: 0.08, low: 0.68, wall: 0.08, healthy: 0, healthyDependent: 0 };
  for (const kind of KINDS) {
    const d = RECRUITABILITY_DEFAULTS[kind];
    assert.equal(d.difficultFraction, fractions[kind]);
    assert.deepEqual([d.difficultOpenMin, d.difficultOpenMax, d.openingShift, d.closingShift, d.tauOpenScale, d.tauCloseScale, d.initialOpenFraction], [38, 58, 0, 0, 1, 1, null]);
    assert.ok(Object.isFrozen(d));
    const n = normalizeRecruitability(kind);
    assert.deepStrictEqual(n, d);
    assert.notEqual(n, d);
    n.openingShift = 5;
    assert.equal(RECRUITABILITY_DEFAULTS[kind].openingShift, 0);
    assert.deepStrictEqual(normalizeRecruitability(kind, n), n);
  }
  const resolved = normalizeRecruitability('high', { difficultFraction: 0.5, initialOpenFraction: 0.4 });
  assert.equal(resolved.difficultFraction, 0.5);
  assert.equal(resolved.initialOpenFraction, 0.4);
  assert.equal(resolved.difficultOpenMax, 58);
});

test('empty, resolved-default and explicit-default overrides return the exact original patient', () => {
  for (const kind of KINDS) for (const seed of SEEDS) for (const count of COUNTS) for (const pbw of PBWS) {
    const original = createPatient(kind, seed, count, pbw);
    const resolved = normalizeRecruitability(kind, {});
    for (const overrides of [undefined, {}, resolved, { ...RECRUITABILITY_DEFAULTS[kind], initialOpenFraction: undefined }, { difficultFraction: RECRUITABILITY_DEFAULTS[kind].difficultFraction, tauOpenScale: 1 }]) {
      const p = overrides === undefined ? createUnifiedPatient(kind, seed, count, pbw) : createUnifiedPatient(kind, seed, count, pbw, overrides);
      assert.deepStrictEqual(p, original, `${kind}/${seed}/${count}/${pbw}`);
      assert.ok(!('recruitability' in p));
    }
  }
  assert.deepStrictEqual(createUnifiedPatient(), createPatient());
});

test('non-default configuration changes only threshold, tau and f fields, with metadata', () => {
  const overrides = { difficultFraction: 0.3, difficultOpenMin: 20, difficultOpenMax: 60, openingShift: 2, closingShift: -1, tauOpenScale: 2, tauCloseScale: 0.5, initialOpenFraction: 0.5 };
  for (const kind of KINDS) for (const seed of SEEDS) for (const count of COUNTS) for (const pbw of PBWS) {
    const original = createPatient(kind, seed, count, pbw), p = createUnifiedPatient(kind, seed, count, pbw, overrides);
    assert.deepEqual(Object.keys(p).sort(), [...Object.keys(original), 'recruitability'].sort());
    assert.deepStrictEqual(p.recruitability, normalizeRecruitability(kind, overrides));
    for (const key of TOP_INTRINSIC) same(p[key], original[key], key);
    assert.equal(p.units.length, original.units.length);
    p.units.forEach((u, i) => {
      const o = original.units[i];
      assert.deepEqual(Object.keys(u).sort(), Object.keys(o).sort());
      for (const key of UNIT_INTRINSIC) same(u[key], o[key], `${kind} unit ${i} ${key}`);
      same(u.tauOpen, o.tauOpen * 2, 'tauOpen');
      same(u.tauClose, o.tauClose * 0.5, 'tauClose');
    });
    assert.equal(p.units.reduce((s, u) => s + u.weight, 0), original.units.reduce((s, u) => s + u.weight, 0));
  }
});

test('difficultFraction yields nested difficult membership with all other unit geometry unchanged', () => {
  for (const kind of KINDS) for (const seed of SEEDS) {
    const original = createPatient(kind, seed, 512, 70);
    const levels = [0, 0.3, 0.7, 1].map(difficultFraction => createUnifiedPatient(kind, seed, 512, 70, { difficultFraction }));
    const sets = levels.map(hardIds);
    assert.equal(sets[0].length, 0, `${kind} fraction 0`);
    assert.equal(sets[3].length, 512, `${kind} fraction 1`);
    for (let i = 0; i < 3; i++) {
      const next = new Set(sets[i + 1]);
      assert.ok(sets[i].every(id => next.has(id)), `${kind} nested ${i}`);
      assert.ok(sets[i + 1].length >= sets[i].length);
    }
    // Broad binomial sanity (about 5 standard deviations), not a calibration check.
    for (const [i, fraction] of [[1, 0.3], [2, 0.7]]) {
      const sd = Math.sqrt(512 * fraction * (1 - fraction));
      assert.ok(Math.abs(sets[i].length - 512 * fraction) < 5 * sd, `${kind}/${seed} ${fraction}: ${sets[i].length}`);
    }
    levels.forEach(p => p.units.forEach((u, i) => {
      const o = original.units[i];
      for (const key of [...UNIT_INTRINSIC, 'tauOpen', 'tauClose', 'f']) same(u[key], o[key], `${kind} ${i} ${key}`);
      assert.ok(u.popen < 59 + 1e-9 && u.pclose <= u.popen - 0.5);
      const l0 = levels[0].units[i], l3 = levels[3].units[i];
      if (!hardIds(p).includes(i)) same(u.popen, l0.popen, 'ordinary popen is fraction independent');
      else same(u.popen, l3.popen, 'difficult popen is fraction independent');
    }));
    // The default difficult range matches the original, so the original difficult units are reproduced by fraction 1 and ordinary ones by fraction 0.
    original.units.forEach((o, i) => {
      if (isHard(o)) same(levels[3].units[i].popen, o.popen, `${kind} hard ${i}`);
      else same(levels[0].units[i].popen, o.popen, `${kind} ordinary ${i}`);
    });
    // Returning to the default fraction reproduces the original exactly.
    const back = createUnifiedPatient(kind, seed, 512, 70, { difficultFraction: RECRUITABILITY_DEFAULTS[kind].difficultFraction });
    assert.deepStrictEqual(back, original);
  }
});

test('difficult opening range is configurable and honoured', () => {
  for (const kind of KINDS) {
    const p = createUnifiedPatient(kind, 13791, 512, 70, { difficultFraction: 1, difficultOpenMin: 70, difficultOpenMax: 90 });
    const ds = kind === 'healthyDependent' ? p.units.map(u => 1 * Math.max(0, (u.dep - 0.6) / 0.4)) : p.units.map(() => 0);
    p.units.forEach((u, i) => assert.ok(u.popen >= 70 + ds[i] && u.popen <= 90 + ds[i] + 1e-9, `${kind} ${u.popen}`));
    const point = createUnifiedPatient(kind, 13791, 64, 70, { difficultFraction: 1, difficultOpenMin: 50, difficultOpenMax: 50 });
    point.units.forEach((u, i) => same(u.popen, 50 + (kind === 'healthyDependent' ? Math.max(0, (u.dep - 0.6) / 0.4) : 0), `${kind} point range`));
  }
});

test('opening and closing shifts preserve hysteresis and move thresholds monotonically', () => {
  for (const kind of KINDS) for (const seed of SEEDS) {
    const original = createPatient(kind, seed, 512, 70);
    for (const openingShift of [-15, 0, 30]) {
      const lo = createUnifiedPatient(kind, seed, 512, 70, { openingShift, closingShift: -15 });
      const mid = createUnifiedPatient(kind, seed, 512, 70, { openingShift, closingShift: 0 });
      const hi = createUnifiedPatient(kind, seed, 512, 70, { openingShift, closingShift: 15 });
      original.units.forEach((o, i) => {
        for (const p of [lo, mid, hi]) {
          const u = p.units[i];
          assert.ok(Number.isFinite(u.popen) && Number.isFinite(u.pclose));
          assert.ok(u.pclose <= u.popen - 0.5, `${kind} ${i} ${openingShift}`);
          assert.ok(Math.abs(u.popen - (o.popen + openingShift)) < 1e-12);
        }
        assert.ok(lo.units[i].pclose <= mid.units[i].pclose && mid.units[i].pclose <= hi.units[i].pclose);
        if (openingShift <= 0) assert.ok(mid.units[i].pclose <= o.pclose + 1e-12);
      });
    }
    // Closing-only shift keeps opening thresholds exactly and lowers closing thresholds.
    const down = createUnifiedPatient(kind, seed, 512, 70, { closingShift: -15 });
    down.units.forEach((u, i) => { same(u.popen, original.units[i].popen, 'popen'); assert.ok(u.pclose <= original.units[i].pclose); });
  }
});

test('time-constant scales stay positive and scale the original values', () => {
  for (const kind of KINDS) {
    const original = createPatient(kind, 4242, 64, 70);
    for (const [a, b] of [[0.25, 4], [4, 0.25], [1, 3]]) {
      const p = createUnifiedPatient(kind, 4242, 64, 70, { tauOpenScale: a, tauCloseScale: b });
      p.units.forEach((u, i) => {
        assert.ok(u.tauOpen > 0 && u.tauClose > 0);
        assert.ok(Math.abs(u.tauOpen - original.units[i].tauOpen * a) < 1e-12);
        assert.ok(Math.abs(u.tauClose - original.units[i].tauClose * b) < 1e-12);
        same(u.popen, original.units[i].popen, 'popen');
        same(u.pclose, original.units[i].pclose, 'pclose');
        same(u.f, original.units[i].f, 'f');
      });
    }
  }
});

test('initial open fraction is the configured distribution; omission keeps the preset distribution', () => {
  const presetBase = { high: 0.38, low: 0.38, wall: 0.38, healthy: 0.995, healthyDependent: 0.995 };
  for (const kind of KINDS) for (const seed of SEEDS) {
    const original = createPatient(kind, seed, 512, 70);
    const omitted = createUnifiedPatient(kind, seed, 512, 70, { openingShift: 1 });
    omitted.units.forEach((u, i) => same(u.f, original.units[i].f, `${kind} omitted f`));
    const preset = createUnifiedPatient(kind, seed, 512, 70, { initialOpenFraction: presetBase[kind] });
    assert.deepEqual(preset.recruitability.initialOpenFraction, presetBase[kind]);
    preset.units.forEach((u, i) => same(u.f, original.units[i].f, `${kind} preset-valued f`));

    const sample = [0, 0.1, 0.5, 0.9, 1].map(b => createUnifiedPatient(kind, seed, 512, 70, { initialOpenFraction: b }));
    sample.forEach((p, k) => p.units.forEach((u, i) => {
      assert.ok(u.f >= 0 && u.f <= 1);
      same(u.dep, original.units[i].dep, 'dep');
      if (k > 0) assert.ok(u.f >= sample[k - 1].units[i].f, `${kind} monotone in base`);
    }));
    if (kind === 'healthy') {
      assert.ok(sample.every((p, k) => p.units.every(u => u.f === [0, 0.1, 0.5, 0.9, 1][k])));
    } else if (kind === 'healthyDependent') {
      sample.forEach((p, k) => p.units.forEach(u => {
        const s = Math.max(0, (u.dep - 0.6) / 0.4);
        same(u.f, Math.min(1, Math.max(0, [0, 0.1, 0.5, 0.9, 1][k] - 0.6 * s)), 'healthyDependent f');
      }));
    } else {
      assert.ok(sample[0].units.some(u => u.f === 0) && sample[4].units.some(u => u.f === 1));
      const mean = p => p.units.reduce((s, u) => s + u.weight * u.f, 0);
      assert.ok(mean(sample[1]) < mean(sample[3]));
    }
  }
});

test('invalid kinds, shapes, types and ranges are rejected', () => {
  const bad = (overrides, ErrorType, kind = 'high') => assert.throws(() => createUnifiedPatient(kind, 1, 8, 70, overrides), ErrorType, JSON.stringify(overrides));
  assert.throws(() => createUnifiedPatient('nope'), RangeError);
  assert.throws(() => normalizeRecruitability('nope', {}), RangeError);
  assert.throws(() => normalizeRecruitability('constructor', {}), RangeError);
  assert.throws(() => normalizeRecruitability(undefined, {}), RangeError);
  for (const overrides of [null, [], 'x', 3, () => ({}), new Map(), new (class A {})()]) bad(overrides, TypeError);
  for (const key of ['other', 'difficultfraction', '__proto__x', 'constructor']) bad({ [key]: 1 }, RangeError);
  bad({ difficultFraction: 0.5, extra: 0 }, RangeError);
  for (const key of Object.keys(RECRUITABILITY_DEFAULTS.high)) {
    for (const value of [NaN, Infinity, -Infinity, '0.5', true, {}, []]) bad({ [key]: value }, TypeError);
  }
  assert.doesNotThrow(() => normalizeRecruitability('high', { initialOpenFraction: null }));
  const limits = [['difficultFraction', 0, 1], ['difficultOpenMin', 0, 120], ['difficultOpenMax', 0, 120], ['openingShift', -15, 30], ['closingShift', -15, 15], ['tauOpenScale', 0.25, 4], ['tauCloseScale', 0.25, 4], ['initialOpenFraction', 0, 1]];
  for (const [key, lo, hi] of limits) {
    const patch = value => key === 'difficultOpenMin' ? { difficultOpenMin: value, difficultOpenMax: 120 } : key === 'difficultOpenMax' ? { difficultOpenMax: value, difficultOpenMin: 0 } : { [key]: value };
    assert.doesNotThrow(() => normalizeRecruitability('high', patch(lo)), `${key} min`);
    assert.doesNotThrow(() => normalizeRecruitability('high', patch(hi)), `${key} max`);
    assert.throws(() => normalizeRecruitability('high', patch(lo - 1e-9)), RangeError, `${key} below`);
    assert.throws(() => normalizeRecruitability('high', patch(hi + 1e-9)), RangeError, `${key} above`);
  }
  bad({ difficultOpenMin: 59 }, RangeError);
  bad({ difficultOpenMax: 37 }, RangeError);
  bad({ difficultOpenMin: 60, difficultOpenMax: 59 }, RangeError);
  assert.doesNotThrow(() => normalizeRecruitability('high', { difficultOpenMin: 58 }));
  assert.throws(() => createUnifiedPatient('high', NaN, 8, 70, { openingShift: 1 }), TypeError);
  assert.throws(() => createUnifiedPatient('high', 1, 0, 70, { openingShift: 1 }), RangeError);
  assert.throws(() => createUnifiedPatient('high', 1, 8, -1, { openingShift: 1 }), RangeError);
});

test('construction is deterministic, structured-clone safe and does not mutate inputs or shared state', () => {
  const overrides = Object.freeze({ difficultFraction: 0.4, openingShift: 3, initialOpenFraction: 0.6 });
  const snapshot = structuredClone(overrides);
  const defaultsBefore = structuredClone(RECRUITABILITY_DEFAULTS);
  for (const kind of KINDS) {
    const a = createUnifiedPatient(kind, 99, 128, 80, overrides), b = createUnifiedPatient(kind, 99, 128, 80, structuredClone(overrides));
    assert.deepStrictEqual(a, b);
    assert.deepStrictEqual(structuredClone(a), a);
    assert.notEqual(a.recruitability, overrides);
    a.recruitability.openingShift = -10;
    a.units[0].popen = -1000;
    assert.deepStrictEqual(createUnifiedPatient(kind, 99, 128, 80, overrides), b);
    assert.deepStrictEqual(createUnifiedPatient(kind, 99, 128, 80), createPatient(kind, 99, 128, 80));
  }
  assert.deepStrictEqual(overrides, snapshot);
  assert.deepStrictEqual(RECRUITABILITY_DEFAULTS, defaultsBefore);
});
