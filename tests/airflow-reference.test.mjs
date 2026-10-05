import test from 'node:test';
import assert from 'node:assert/strict';
import { createPatient } from '../src/engine.js';
import { buildFrozenNetwork, advanceNetwork } from '../src/airflow.js';

// ---------------------------------------------------------------- independent dense reference toolkit
const GAMMA = 1 - 1 / Math.sqrt(2);

function close(actual, expected, { rel = 1e-10, abs = 1e-10 } = {}, label = '') {
  const tol = abs + rel * Math.abs(expected);
  assert.ok(Math.abs(actual - expected) <= tol, `${label} ${actual} differs from ${expected} by ${Math.abs(actual - expected)} (tol ${tol})`);
}
function closeArr(actual, expected, opts, label = '') {
  assert.equal(actual.length, expected.length, `${label} length`);
  for (let i = 0; i < expected.length; i++) close(actual[i], expected[i], opts, `${label}[${i}]`);
}

// Gaussian elimination with partial pivoting; A is an array of rows, B an array of right-hand-side columns.
function solveDense(A, bs) {
  const n = A.length, m = A.map((row, i) => [...row, ...bs.map(b => b[i])]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    assert.ok(Math.abs(m[p][c]) > 1e-300, 'singular reference matrix');
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = c + 1; r < n; r++) {
      const f = m[r][c] / m[c][c];
      for (let k = c; k < m[r].length; k++) m[r][k] -= f * m[c][k];
    }
  }
  return bs.map((_, col) => {
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
      let s = m[r][n + col];
      for (let k = r + 1; k < n; k++) s -= m[r][k] * x[k];
      x[r] = s / m[r][r];
    }
    return x;
  });
}
const solve1 = (A, b) => solveDense(A, [b])[0];
const matVec = (A, x) => A.map(row => row.reduce((s, v, j) => s + v * x[j], 0));
const matMul = (A, B) => A.map(row => B[0].map((_, j) => row.reduce((s, v, k) => s + v * B[k][j], 0)));
const sum = a => a.reduce((s, v) => s + v, 0);

// exp(A) by scaling and squaring with a long Taylor series; sufficient to ~1e-15 relative for the small matrices used here.
function expm(A) {
  const n = A.length;
  const norm = Math.max(...A.map(row => sum(row.map(Math.abs))));
  const s = Math.max(0, Math.ceil(Math.log2(Math.max(norm, 1e-300) / 0.25)));
  const B = A.map(row => row.map(v => v / 2 ** s));
  let term = A.map((row, i) => row.map((_, j) => (i === j ? 1 : 0))), E = term.map(row => [...row]);
  for (let k = 1; k <= 24; k++) {
    term = matMul(term, B).map(row => row.map(v => v / k));
    E = E.map((row, i) => row.map((v, j) => v + term[i][j]));
  }
  for (let k = 0; k < s; k++) E = matMul(E, E);
  return E;
}

// ---------------------------------------------------------------- fixtures: fixed-open linear patient with exact chords
const DEFAULT_SETTINGS = { peep: 8, vt: 6, rr: 20 };
const BASELINE_PLEURAL = 2, REFERENCE_VOLUME = 1500, REST = 1500;

// Per-unit chord compliance is C_i = weight_i * linearCompliance_i exactly; resistance is Rp / weight_i.
function makeFixture({ weights, compliance, Ecw = 0.005, R0 = 0.01, Rp = 0.02, settings = DEFAULT_SETTINGS }) {
  const n = weights.length, total = sum(weights), w = weights.map(v => v / total);
  const patient = createPatient('high', 5, n, 70);
  patient.baselinePleural = BASELINE_PLEURAL;
  patient.pleuralGradient = 0;
  patient.chestWallElastance = Ecw;
  patient.chestWallReferenceVolume = REFERENCE_VOLUME;
  patient.units = patient.units.map((u, i) => ({ ...u, weight: w[i], dep: 0, rest: REST, linearCompliance: compliance[i], f: 1, fixedOpen: true }));
  const spec = { n, C: w.map((wi, i) => wi * compliance[i]), R: w.map(wi => Rp / wi), R0, Ecw, peep: settings.peep, w, compliance, Rp };
  spec.sumC = sum(spec.C);
  spec.G = sum(spec.R.map(r => 1 / r));
  return { patient, spec, settings, network: buildFrozenNetwork(patient, settings, { R0, Rp }) };
}

const HETERO5 = { weights: [0.1, 0.3, 0.15, 0.25, 0.2], compliance: [20, 70, 35, 55, 110] };
const HETERO2 = { weights: [0.3, 0.7], compliance: [20, 80] };

function seedState(n, scale = 25) {
  return Float64Array.from({ length: n }, (_, i) => scale * Math.sin(1.7 * i + 0.4) - 3 * i);
}

// Dense M = diag(R_i) + R0 11^T and K = diag(1/C_i) + Ecw 11^T from the specification (not from the network under test).
function denseMK(spec) {
  const M = [], K = [];
  for (let i = 0; i < spec.n; i++) {
    M.push(Array.from({ length: spec.n }, (_, j) => (i === j ? spec.R[i] : 0) + spec.R0));
    K.push(Array.from({ length: spec.n }, (_, j) => (i === j ? 1 / spec.C[i] : 0) + spec.Ecw));
  }
  return { M, K };
}

// Reference SDIRK2 step using only dense solves. PC: (M + aK) k = p 1 - K b. VC: same equations with unknown Paw and sum(k) = Q.
function referenceStep(spec, x0, h, mode, value) {
  const { M, K } = denseMK(spec), n = spec.n, a = GAMMA * h;
  const MaK = M.map((row, i) => row.map((v, j) => v + a * K[i][j]));
  const stage = base => {
    const Kb = matVec(K, base);
    if (mode === 'pc') {
      const p = value - spec.peep;
      return { k: solve1(MaK, Kb.map(v => p - v)), p };
    }
    const aug = MaK.map(row => [...row, -1]);
    aug.push([...new Array(n).fill(1), 0]);
    const sol = solve1(aug, [...Kb.map(v => -v), value]);
    return { k: sol.slice(0, n), p: sol[n] };
  };
  const s1 = stage(Array.from(x0));
  const y1 = Array.from(x0, (v, i) => v + a * s1.k[i]);
  const b2 = Array.from(x0, (v, i) => v + h * (1 - GAMMA) * s1.k[i]);
  const s2 = stage(b2);
  const x = b2.map((v, i) => v + a * s2.k[i]);
  const q1 = sum(s1.k), q2 = sum(s2.k);
  return { x, y1, flow: s2.k, q: q2, pressure: spec.peep + s2.p, stagePressures: [spec.peep + s1.p, spec.peep + s2.p], integratedFlow: h * ((1 - GAMMA) * q1 + GAMMA * q2) };
}

function assertStepMatches(result, ref, label) {
  const scale = Math.max(1, ...ref.x.map(Math.abs));
  const opts = { rel: 1e-9, abs: 1e-9 * scale };
  closeArr(result.x, ref.x, opts, `${label} x`);
  closeArr(result.flow, ref.flow, { rel: 1e-9, abs: 1e-9 * Math.max(1, ...ref.flow.map(Math.abs)) }, `${label} flow`);
  close(result.q, ref.q, { rel: 1e-9, abs: 1e-9 * scale }, `${label} q`);
  close(result.pressure, ref.pressure, { rel: 1e-10, abs: 1e-9 }, `${label} pressure`);
  closeArr(result.stagePressures, ref.stagePressures, { rel: 1e-10, abs: 1e-9 }, `${label} stagePressures`);
  close(result.integratedFlow, ref.integratedFlow, { rel: 1e-9, abs: 1e-9 * scale }, `${label} integratedFlow`);
  assert.ok(Math.abs(result.massResidual) <= 1e-9 * scale, `${label} massResidual ${result.massResidual}`);
  assert.ok(result.x instanceof Float64Array && result.flow instanceof Float64Array);
}

// ---------------------------------------------------------------- tests of the reference tools themselves
test('reference tools: dense solve and expm are self-consistent', () => {
  const A = [[4, 1, 2], [1, 5, 0.5], [2, 0.5, 6]], b = [1, -2, 3];
  const x = solve1(A, b);
  closeArr(matVec(A, x), b, { rel: 1e-13, abs: 1e-13 }, 'A x');
  const th = 0.9, R = expm([[0, -th], [th, 0]]);
  close(R[0][0], Math.cos(th), { rel: 1e-14, abs: 1e-14 }); close(R[1][0], Math.sin(th), { rel: 1e-14, abs: 1e-14 });
  const D = expm([[-3, 0], [0, 0.5]]);
  close(D[0][0], Math.exp(-3), { rel: 1e-13 }); close(D[1][1], Math.exp(0.5), { rel: 1e-13 }); close(D[0][1], 0, { abs: 1e-15 });
});

// ---------------------------------------------------------------- frozen network construction
test('frozen chord network equals weight*linearCompliance, Rp/weight, and the analytic PEEP baseline', () => {
  for (const params of [HETERO2, HETERO5]) {
    const { network, spec, patient } = makeFixture(params);
    assert.ok(network.C instanceof Float64Array && network.R instanceof Float64Array);
    assert.equal(network.n, spec.n);
    closeArr(network.C, spec.C, { rel: 1e-9 }, 'C');
    closeArr(network.R, spec.R, { rel: 1e-12 }, 'R');
    closeArr(network.weights, spec.w, { rel: 1e-14 }, 'weights');
    assert.deepEqual(Array.from(network.activeIndices), spec.w.map((_, i) => i));
    assert.equal(network.R0, 0.01);
    assert.equal(network.Ecw, 0.005);
    assert.equal(network.peep, DEFAULT_SETTINGS.peep);
    // PEEP relaxed state: P = z + pleural + Ecw (V - Vref) with V = sum w rest + sumC z (linear, uniform pleural gradient 0).
    const z = (spec.peep - BASELINE_PLEURAL - spec.Ecw * (REST - REFERENCE_VOLUME)) / (1 + spec.Ecw * spec.sumC);
    closeArr(network.baseVolume, spec.w.map((wi, i) => wi * (REST + spec.compliance[i] * z)), { rel: 1e-9 }, 'baseVolume');
    // the frozen chord must not depend on the chest wall (it only changes the baseline), nor on resistance parameters
    const other = makeFixture({ ...params, Ecw: 0, R0: 0.2, Rp: 0.07 });
    closeArr(other.network.C, spec.C, { rel: 1e-9 }, 'C independent of Ecw/R0/Rp');
    closeArr(other.network.R, spec.w.map(wi => 0.07 / wi), { rel: 1e-12 }, 'R scales with Rp');
    assert.equal(patient.units[0].f, 1);
  }
});

// ---------------------------------------------------------------- implicit-stage equality against dense solves
const COEFFICIENTS = [
  { label: 'R0+Ecw', R0: 0.01, Ecw: 0.005 },
  { label: 'no central R', R0: 0, Ecw: 0.005 },
  { label: 'no chest wall', R0: 0.01, Ecw: 0 },
  { label: 'neither', R0: 0, Ecw: 0 },
  { label: 'large central R', R0: 0.5, Ecw: 0.02 }
];

for (const [name, params] of [['N=2', HETERO2], ['N=5', HETERO5]]) {
  test(`pressure-control SDIRK2 step equals dense reference (${name}), toggling central R and chest wall`, () => {
    for (const toggle of COEFFICIENTS) {
      const { network, spec } = makeFixture({ ...params, ...toggle });
      for (const h of [0.002, 0.05, 0.4, 3, 400]) {
        for (const paw of [spec.peep, spec.peep + 12, 3]) { // 3 < PEEP exercises negative driving pressure
          const x0 = seedState(spec.n), copy = Float64Array.from(x0);
          const res = advanceNetwork(network, x0, h, { mode: 'pc', value: paw });
          assert.deepEqual(x0, copy, 'input state must not be mutated');
          assertStepMatches(res, referenceStep(spec, x0, h, 'pc', paw), `${toggle.label} h=${h} paw=${paw}`);
          assert.equal(res.pressure, paw);
        }
      }
    }
  });

  test(`volume-control SDIRK2 step equals dense DAE reference (${name}), toggling central R and chest wall`, () => {
    for (const toggle of COEFFICIENTS) {
      const { network, spec } = makeFixture({ ...params, ...toggle });
      for (const h of [0.002, 0.05, 0.4, 3, 400]) {
        for (const Q of [140, 0, -60]) {
          const x0 = seedState(spec.n);
          const res = advanceNetwork(network, x0, h, { mode: 'vc', value: Q });
          assertStepMatches(res, referenceStep(spec, x0, h, 'vc', Q), `${toggle.label} h=${h} Q=${Q}`);
          close(res.q, Q, { rel: 1e-9, abs: 1e-9 }, 'imposed net flow');
        }
      }
    }
  });
}

test('every PC and VC step conserves mass: sum(dx) equals the stage-quadrature volume', () => {
  const { network, spec } = makeFixture(HETERO5);
  const x0 = seedState(spec.n);
  for (const drive of [{ mode: 'pc', value: 20 }, { mode: 'vc', value: 90 }]) {
    for (const h of [0.01, 0.7, 50]) {
      const res = advanceNetwork(network, x0, h, drive), dX = sum(Array.from(res.x)) - sum(Array.from(x0));
      close(dX, res.integratedFlow, { rel: 1e-9, abs: 1e-8 }, `${drive.mode} h=${h}`);
      assert.ok(Math.abs(res.massResidual) < 1e-8);
    }
  }
});

// ---------------------------------------------------------------- volume control: invariants
test('volume control: net mass moves exactly by Q*h and central R / chest wall only shift pressure', () => {
  const base = makeFixture({ ...HETERO5, R0: 0.01, Ecw: 0.005 });
  const noEcw = makeFixture({ ...HETERO5, R0: 0.01, Ecw: 0 });
  const noR0 = makeFixture({ ...HETERO5, R0: 0, Ecw: 0.005 });
  const x0 = seedState(5);
  for (const [Q, h] of [[140, 0.3], [-45, 0.05], [0, 5], [210, 2]]) {
    const a = advanceNetwork(base.network, x0, h, { mode: 'vc', value: Q });
    const b = advanceNetwork(noEcw.network, x0, h, { mode: 'vc', value: Q });
    const c = advanceNetwork(noR0.network, x0, h, { mode: 'vc', value: Q });
    for (const r of [a, b, c]) {
      close(sum(Array.from(r.x)) - sum(Array.from(x0)), Q * h, { rel: 1e-10, abs: 1e-9 }, 'net mass');
      close(r.integratedFlow, Q * h, { rel: 1e-12, abs: 1e-10 }, 'integrated flow');
      close(sum(Array.from(r.flow)), Q, { rel: 1e-10, abs: 1e-9 }, 'sum regional flow');
    }
    // Ecw cancels from the distribution (same x, same regional flows) but not from the opening pressure.
    closeArr(a.x, b.x, { rel: 1e-9, abs: 1e-9 }, 'x independent of Ecw');
    closeArr(a.flow, b.flow, { rel: 1e-9, abs: 1e-9 }, 'flow independent of Ecw');
    close(a.pressure - b.pressure, 0.005 * sum(Array.from(a.x)), { rel: 1e-8, abs: 1e-8 }, 'pressure shift = Ecw X');
    // R0 shifts airway pressure by R0 * Q at every stage and does not touch the distribution.
    closeArr(a.x, c.x, { rel: 1e-9, abs: 1e-9 }, 'x independent of R0');
    close(a.pressure - c.pressure, 0.01 * Q, { rel: 1e-8, abs: 1e-8 }, 'pressure shift = R0 Q');
    close(a.stagePressures[0] - c.stagePressures[0], 0.01 * Q, { rel: 1e-8, abs: 1e-8 }, 'stage 1 shift = R0 Q');
  }
});

test('volume control at Q=0 shows signed regional flows (pendelluft) with zero net flow and constant total volume', () => {
  const { network, spec } = makeFixture({ weights: [0.2, 0.5, 0.3], compliance: [30, 60, 40] });
  // unit 0 over-distended relative to its compliance, unit 1 under-filled, unit 2 balanced-ish
  const x0 = Float64Array.from([60, 5, 10]);
  const h = 1e-3;
  const res = advanceNetwork(network, x0, h, { mode: 'vc', value: 0 });
  assert.ok(Array.from(res.flow).some(v => v < -1e-3) && Array.from(res.flow).some(v => v > 1e-3), 'flows must have both signs');
  assert.ok(res.flow[0] < 0 && res.flow[1] > 0, 'gas moves from the over-filled unit to the under-filled unit');
  close(sum(Array.from(res.flow)), 0, { abs: 1e-9 }, 'net flow');
  close(sum(Array.from(res.x)), sum(Array.from(x0)), { abs: 1e-9 }, 'total volume');
  // regional flow law q_i = g_i (S/G - x_i/C_i), evaluated independently at the returned state
  const g = spec.R.map(r => 1 / r), S = sum(Array.from(res.x, (v, i) => g[i] * v / spec.C[i]));
  closeArr(res.flow, Array.from(res.x, (v, i) => g[i] * (S / spec.G - v / spec.C[i])), { rel: 1e-9, abs: 1e-9 }, 'regional flow law');
});

test('long equilibration: VC Q=0 and PC reach the analytic virtual pressure and compliance distribution', () => {
  for (const params of [HETERO2, HETERO5]) {
    for (const Ecw of [0, 0.005, 0.03]) {
      const { network, spec } = makeFixture({ ...params, Ecw });
      const stiffness = 1 / spec.sumC + spec.Ecw; // 1/(effective compliance)
      // L-stable SDIRK2 damps like 1/(h lambda) per step, not exponentially, so equilibrate with many moderate steps.
      const relax = (from, drive, steps = 300, h = 2) => {
        let state = from, last = null;
        for (let s = 0; s < steps; s++) { last = advanceNetwork(network, state, h, drive); state = last.x; }
        return last;
      };
      const x0 = seedState(spec.n), X = sum(Array.from(x0));
      const settled = relax(x0, { mode: 'vc', value: 0 }); // total volume stays fixed while the distribution relaxes
      close(sum(Array.from(settled.x)), X, { rel: 1e-9, abs: 1e-8 }, 'X conserved');
      closeArr(settled.x, spec.C.map(c => c * X / spec.sumC), { rel: 1e-8, abs: 1e-7 }, 'x_i = C_i X / sumC');
      close(settled.pressure, spec.peep + X * stiffness, { rel: 1e-9, abs: 1e-8 }, 'virtual pressure');
      closeArr(settled.flow, new Array(spec.n).fill(0), { abs: 1e-7 }, 'flows vanish');
      // pressure control at the virtual pressure leaves the equilibrated state at rest
      const hold = advanceNetwork(network, settled.x, 5, { mode: 'pc', value: spec.peep + X * stiffness });
      closeArr(hold.x, settled.x, { rel: 1e-8, abs: 1e-7 }, 'PC at virtual pressure is stationary');
      // and PC at a different pressure converges to X = p / stiffness with x_i = C_i (p - Ecw X)
      const p = 14, far = relax(settled.x, { mode: 'pc', value: spec.peep + p });
      close(sum(Array.from(far.x)), p / stiffness, { rel: 1e-8, abs: 1e-7 }, 'PC equilibrium volume');
      closeArr(far.x, spec.C.map(c => c * (p - spec.Ecw * p / stiffness)), { rel: 1e-8, abs: 1e-7 }, 'PC equilibrium distribution');
    }
  }
});

// ---------------------------------------------------------------- homogeneous reduction to a single RC
test('homogeneous PC network reduces to one RC (R0 + R_i/n, C = 1/(1/sumC + Ecw)) with second-order convergence', () => {
  const n = 4, weights = new Array(n).fill(1), compliance = new Array(n).fill(40);
  const R0 = 0.01, Ecw = 0.005, Rp = 0.02;
  const { network, spec } = makeFixture({ weights, compliance, R0, Ecw, Rp });
  const Req = R0 + spec.R[0] / n, Ceff = 1 / (1 / spec.sumC + Ecw), tau = Req * Ceff;
  close(Req, R0 + Rp, { rel: 1e-12 }); // R_i/n = Rp/(1/n * n) = Rp for equal weights
  const X0 = 30, p = 11, T = 1.2;
  const exact = p * Ceff + (X0 - p * Ceff) * Math.exp(-T / tau);
  const errors = [];
  for (const steps of [6, 12, 24]) {
    let x = Float64Array.from({ length: n }, () => X0 / n);
    for (let s = 0; s < steps; s++) x = advanceNetwork(network, x, T / steps, { mode: 'pc', value: spec.peep + p }).x;
    for (let i = 1; i < n; i++) close(x[i], x[0], { rel: 1e-12, abs: 1e-12 }, 'symmetric units stay equal');
    errors.push(Math.abs(sum(Array.from(x)) - exact));
  }
  assert.ok(errors[0] < 1e-3 * p * Ceff && errors[2] < 6e-5 * p * Ceff, `errors ${errors}`);
  for (let i = 0; i < 2; i++) {
    const ratio = errors[i] / errors[i + 1];
    assert.ok(ratio > 3.5 && ratio < 4.5, `second-order ratio ${ratio}`);
  }
});

test('homogeneous volume control is exact: X = Q t and Paw = PEEP + Req Q + X/Ceff', () => {
  const n = 4, R0 = 0.01, Ecw = 0.005, Rp = 0.02;
  const { network, spec } = makeFixture({ weights: new Array(n).fill(1), compliance: new Array(n).fill(40), R0, Ecw, Rp });
  const Req = R0 + spec.R[0] / n, Q = 120, h = 0.25;
  let x = new Float64Array(n);
  for (let s = 1; s <= 4; s++) {
    const res = advanceNetwork(network, x, h, { mode: 'vc', value: Q });
    x = res.x;
    closeArr(x, new Array(n).fill(Q * h * s / n), { rel: 1e-10, abs: 1e-9 }, 'x');
    close(res.pressure, spec.peep + Req * Q + Q * h * s * (1 / spec.sumC + Ecw), { rel: 1e-10, abs: 1e-9 }, 'pressure');
    closeArr(res.flow, new Array(n).fill(Q / n), { rel: 1e-10, abs: 1e-9 }, 'flow');
  }
});

// ---------------------------------------------------------------- heterogeneous continuous reference
const stepsTo = (network, x0, T, steps, drive) => {
  let x = Float64Array.from(x0), last = null;
  for (let s = 0; s < steps; s++) { last = advanceNetwork(network, x, T / steps, drive); x = last.x; }
  return last;
};
const maxAbsDiff = (a, b) => Math.max(...Array.from(a, (v, i) => Math.abs(v - b[i])));

test('heterogeneous 2-unit PC converges at O(h^2) to the continuous matrix-exponential solution', () => {
  const { network, spec } = makeFixture({ ...HETERO2, R0: 0.01, Ecw: 0.005, Rp: 0.02 });
  const { M, K } = denseMK(spec), p = 13, T = 1.5, x0 = [-4, 18];
  // x' = -M^-1 K x + M^-1 p 1 as an augmented linear system z' = B z, z = [x; 1]
  const [MinvOne] = solveDense(M, [[1, 1]]), MinvK = solveDense(M, [K.map(r => r[0]), K.map(r => r[1])]); // columns of M^-1 K
  const B = [0, 1].map(i => [-MinvK[0][i], -MinvK[1][i], p * MinvOne[i]]).concat([[0, 0, 0]]);
  const E = expm(B.map(row => row.map(v => v * T)));
  const exact = matVec(E, [...x0, 1]).slice(0, 2);
  // sanity: the exact solution approaches the analytic equilibrium and slow/fast modes are distinct
  const eq = solve1(K, [p, p]);
  const E1000 = matVec(expm(B.map(row => row.map(v => v * 1000))), [...x0, 1]).slice(0, 2);
  closeArr(E1000, eq, { rel: 1e-9 }, 'reference equilibrium');

  const errors = [], pressures = [];
  for (const steps of [6, 12, 24, 48]) {
    const last = stepsTo(network, x0, T, steps, { mode: 'pc', value: spec.peep + p });
    errors.push(maxAbsDiff(last.x, exact));
    pressures.push(last.pressure);
  }
  for (let i = 0; i < 3; i++) {
    const ratio = errors[i] / errors[i + 1];
    assert.ok(ratio > 3.4 && ratio < 4.6, `second-order ratio ${ratio} (errors ${errors})`);
  }
  assert.ok(errors[3] < 2e-3 * Math.max(...exact.map(Math.abs)), `fine error ${errors[3]}`);
  // the exact net flow follows from the derivative of the exact solution
  const flowExact = matVec(B.slice(0, 2).map(r => r.slice(0, 2)), exact).map((v, i) => v + B[i][2]);
  const fine = stepsTo(network, x0, T, 96, { mode: 'pc', value: spec.peep + p });
  closeArr(fine.flow, flowExact, { rel: 1e-3, abs: 1e-4 }, 'regional flow vs continuous');
  assert.equal(pressures[3], spec.peep + p);
});

test('heterogeneous 3-unit VC converges at O(h^2) to the continuous solution derived from M and K', () => {
  const { network, spec } = makeFixture({ weights: [0.25, 0.45, 0.3], compliance: [15, 90, 40], R0: 0.012, Ecw: 0.004, Rp: 0.03 });
  const n = 3, { M, K } = denseMK(spec), Q = 70, T = 1.2, x0 = [3, -2, 8];
  // k = M^-1 (p 1 - K x) with sum(k) = Q gives x' = A x + f, p = (Q + 1' M^-1 K x) / (1' M^-1 1)
  const MinvOne = solve1(M, new Array(n).fill(1));
  const MinvK = solveDense(M, Array.from({ length: n }, (_, j) => K.map(r => r[j]))); // MinvK[j] = column j
  const s = sum(MinvOne), colSums = MinvK.map(col => sum(col));
  const aug = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) aug[i][j] = (-MinvK[j][i] + MinvOne[i] * colSums[j] / s) * T;
    aug[i][n] = MinvOne[i] * Q / s * T;
  }
  const E = expm(aug), exact = matVec(E, [...x0, 1]).slice(0, n);
  close(sum(exact), sum(x0) + Q * T, { rel: 1e-12, abs: 1e-11 }, 'reference mass');
  const pExact = spec.peep + (Q + sum(exact.map((v, j) => v * colSums[j]))) / s;

  const errors = [], pErrors = [];
  for (const steps of [5, 10, 20, 40]) {
    const last = stepsTo(network, x0, T, steps, { mode: 'vc', value: Q });
    errors.push(maxAbsDiff(last.x, exact));
    pErrors.push(Math.abs(last.pressure - pExact));
  }
  for (const list of [errors, pErrors]) {
    for (let i = 0; i < 3; i++) {
      const ratio = list[i] / list[i + 1];
      assert.ok(ratio > 3.3 && ratio < 4.7, `second-order ratio ${ratio} (errors ${list})`);
    }
  }
  assert.ok(errors[3] < 1e-3 * Math.max(...exact.map(Math.abs)), `fine error ${errors[3]}`);
});
