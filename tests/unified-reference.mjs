/*
 * Independent numerical reference for the unified nonlinear-flow kernel (educational, uncalibrated).
 *
 * Nothing here imports src/unified.js. The ONLY shared inputs with production are parameter values:
 * the patient object, the ventilator drive and the mechanics overrides (R0, Rp, residualAeration,
 * residualConductance, patencyPower, kneeFraction, compressionStiffness), plus the per-unit resistance
 * multipliers m_i (net.rMultiplier) which are a seeded draw and are passed in AFTER the production network
 * is built, as a parameter only. No production physics result (volumes, pressures, flows) is used here.
 *
 * Model (written independently from the kernel contract):
 *   a_i      = fres + (1 - fres) f_i                       aeration factor
 *   s_i      = V_i / (w_i a_i)                              specific volume
 *   E_i      = Phi_i(s_i)                                   elastic recoil (see elasticOfSpecific)
 *   Ppl_i    = B + gradient dep_i + Ecw (sum V - Vref)       pleural pressure
 *   Palv_i   = Ppl_i + E_i
 *   g_i      = w_i / (Rp m_i) [phi + (1 - phi) a_i]^power    unit conductance
 *   dV_i/dt  = g_i (Pnode - Palv_i)
 *   PC: Pnode = (Paw + R0 sum g Palv) / (1 + R0 sum g)       (Paw given)
 *   VC: Pnode = (Q + sum g Palv) / sum g,  Paw = Pnode + R0 Q (Q given)
 *   df_i/dt  = (1-f) ex/(3+ex)/tauOpen   if E > popen,  ex = E - popen
 *            = -f   ex/(3+ex)/tauClose   if E < pclose, ex = pclose - E,  0 in between, 0 if fixedOpen
 * The state is (V, f). Gas volume changes only through flow; f changes pressure at fixed gas.
 */

export const DEFAULT_MECH = Object.freeze({
  R0: 0.008, Rp: 0.004, resistanceSpread: 0, resistanceDependency: 0,
  residualAeration: 0.01, residualConductance: 1, patencyPower: 1, kneeFraction: 0.95, compressionStiffness: 12
});
export const mechanics = (overrides = {}) => ({ ...DEFAULT_MECH, ...overrides });

// ---------------------------------------------------------------------------------------------------
// Patient construction for toy cases (same field names as engine.createPatient units)
// ---------------------------------------------------------------------------------------------------
export function makePatient(specs, opts = {}) {
  const raw = specs.reduce((sum, u) => sum + (u.weight ?? 1), 0);
  const units = specs.map((u, id) => {
    const unit = { id, dep: 0.5, capacity: 3500, rest: 700, stiffness: 15, popen: 10, pclose: 3, tauOpen: 0.6, tauClose: 2, rateWidth: 3, f: 0.5, ...u, weight: (u.weight ?? 1) / raw };
    if (unit.perfusion === undefined) unit.perfusion = 0.5 + unit.dep;
    return unit;
  });
  return { kind: 'high', seed: 1, pbw: 70, count: units.length, baselinePleural: 2, pleuralGradient: 5, chestWallElastance: 0.006, chestWallReferenceVolume: 1200, units, elapsed: 0, breaths: 0, ...opts };
}

// ---------------------------------------------------------------------------------------------------
// Elastic law: specific volume s -> recoil pressure E, and its closed-form inverse
// ---------------------------------------------------------------------------------------------------
export function kneeOf(u, mech) {
  const kn = mech.kneeFraction, sKnee = u.rest + u.capacity * kn;
  return { sKnee, Eknee: u.stiffness * kn / (1 - kn), slope: u.stiffness / (u.capacity * (1 - kn) ** 2) };
}

/** {E, dEds, region}; region 'linear' | 'sub' (s<rest) | 'main' | 'knee' (linear tangent above the knee). */
export function elasticOfSpecific(u, s, mech) {
  if (u.linearCompliance != null) return { E: (s - u.rest) / u.linearCompliance, dEds: 1 / u.linearCompliance, region: 'linear' };
  if (!(s > 0)) throw new RangeError(`specific volume must be positive, got ${s}`);
  const r = u.rest, c = u.capacity, k = u.stiffness, kappa = mech.compressionStiffness;
  const knee = kneeOf(u, mech);
  if (s >= knee.sKnee) return { E: knee.Eknee + knee.slope * (s - knee.sKnee), dEds: knee.slope, region: 'knee' };
  if (s >= r) { const z = (s - r) / c; return { E: k * z / (1 - z), dEds: k / (c * (1 - z) ** 2), region: 'main' }; }
  const A = k * r / c, x = Math.log(s / r);
  return { E: A * (x - kappa * x * x), dEds: A * (1 - 2 * kappa * x) / s, region: 'sub' };
}

/** Closed-form inverse E -> s (s > 0 always for nonlinear units). */
export function specificOfPressure(u, E, mech) {
  if (u.linearCompliance != null) return u.rest + u.linearCompliance * E;
  const r = u.rest, c = u.capacity, k = u.stiffness, kappa = mech.compressionStiffness;
  const knee = kneeOf(u, mech);
  if (E >= knee.Eknee) return knee.sKnee + (E - knee.Eknee) / knee.slope;
  if (E >= 0) return r + c * E / (k + E);
  const A = k * r / c;
  const x = kappa > 0 ? (2 * E / A) / (1 + Math.sqrt(1 - 4 * kappa * E / A)) : E / A;
  return r * Math.exp(x);
}

export const aeration = (mech, f) => mech.residualAeration + (1 - mech.residualAeration) * f;

/** Elastic pressure and partial derivatives at gas volume V and open fraction f. */
export function elasticOfVolume(u, V, f, mech) {
  const a = aeration(mech, f), s = V / (u.weight * a), e = elasticOfSpecific(u, s, mech);
  return { E: e.E, dEdV: e.dEds / (u.weight * a), dEdf: -e.dEds * s * (1 - mech.residualAeration) / a, s, a, region: e.region };
}

// ---------------------------------------------------------------------------------------------------
// ODE system
// ---------------------------------------------------------------------------------------------------
export function makeSystem(patient, mechOverrides = {}, multipliers = null) {
  const mech = mechanics(mechOverrides), n = patient.units.length;
  const m = new Float64Array(n).fill(1);
  if (multipliers) {
    if (multipliers.length !== n) throw new RangeError('multiplier length mismatch');
    for (let i = 0; i < n; i++) { if (!(multipliers[i] > 0) || !Number.isFinite(multipliers[i])) throw new RangeError('multipliers must be positive and finite'); m[i] = multipliers[i]; }
  }
  const wsum = patient.units.reduce((s, u) => s + u.weight, 0);
  if (Math.abs(wsum - 1) > 1e-12) throw new RangeError(`weights must sum to 1, got ${wsum}`);
  return { n, units: patient.units, mech, m, B: patient.baselinePleural, grad: patient.pleuralGradient, Ecw: patient.chestWallElastance, Vref: patient.chestWallReferenceVolume };
}

function fRate(u, f, E) {
  if (u.fixedOpen === true) return { df: 0, regime: 0 };
  const width = u.rateWidth ?? 3;
  if (E > u.popen) { const ex = E - u.popen; return { df: (1 - f) * ex / (width + ex) / u.tauOpen, regime: 1, gap: ex }; }
  if (E < u.pclose) { const ex = u.pclose - E; return { df: -f * ex / (width + ex) / u.tauClose, regime: -1, gap: ex }; }
  return { df: 0, regime: 0, gap: Math.min(E - u.pclose, u.popen - E) };
}

/** Full right-hand side at state (V, f) for drive {mode:'pc'|'vc', value}. */
export function evaluate(sys, V, f, drive) {
  const { n, units, mech, m, B, grad, Ecw, Vref } = sys;
  if (drive.mode !== 'pc' && drive.mode !== 'vc') throw new TypeError('drive.mode must be pc or vc');
  let Vt = 0;
  for (let i = 0; i < n; i++) Vt += V[i];
  const E = new Float64Array(n), Palv = new Float64Array(n), g = new Float64Array(n), dV = new Float64Array(n), df = new Float64Array(n), regime = new Int8Array(n), gap = new Float64Array(n), spec = new Float64Array(n);
  const ppl = i => B + grad * units[i].dep + Ecw * (Vt - Vref);
  let Sg = 0, SgP = 0;
  for (let i = 0; i < n; i++) {
    const u = units[i], a = aeration(mech, f[i]), e = elasticOfVolume(u, V[i], f[i], mech);
    E[i] = e.E; spec[i] = e.s; Palv[i] = ppl(i) + e.E;
    g[i] = u.weight / (mech.Rp * m[i]) * (mech.residualConductance + (1 - mech.residualConductance) * a) ** mech.patencyPower;
    Sg += g[i]; SgP += g[i] * Palv[i];
    const r = fRate(u, f[i], e.E); df[i] = r.df; regime[i] = r.regime; gap[i] = r.gap ?? Infinity;
  }
  let Pnode, Q, Paw;
  if (drive.mode === 'pc') { Paw = drive.value; Pnode = (Paw + mech.R0 * SgP) / (1 + mech.R0 * Sg); Q = Sg * Pnode - SgP; }
  else { Q = drive.value; Pnode = (Q + SgP) / Sg; Paw = Pnode + mech.R0 * Q; }
  for (let i = 0; i < n; i++) dV[i] = g[i] * (Pnode - Palv[i]);
  return { Paw, Pnode, Q, dV, df, E, Palv, g, regime, gap, spec, total: Vt, meanPleural: B + grad * units.reduce((s, u) => s + u.weight * u.dep, 0) + Ecw * (Vt - Vref) };
}

function derivative(sys, y, drive) {
  const n = sys.n, e = evaluate(sys, y.subarray(0, n), y.subarray(n), drive), d = new Float64Array(2 * n);
  d.set(e.dV); d.set(e.df, n);
  return { d, Q: e.Q };
}

/** One classical RK4 step on y = [V..., f...]; Qint is the RK4 quadrature of net flow over the step. */
export function rk4Step(sys, y, h, drive) {
  const L = y.length, tmp = new Float64Array(L);
  const stage = (base, k, c) => { for (let j = 0; j < L; j++) tmp[j] = base[j] + c * k[j]; return derivative(sys, tmp, drive); };
  const s1 = derivative(sys, y, drive), s2 = stage(y, s1.d, h / 2), s3 = stage(y, s2.d, h / 2), s4 = stage(y, s3.d, h);
  const out = new Float64Array(L);
  for (let j = 0; j < L; j++) out[j] = y[j] + h / 6 * (s1.d[j] + 2 * s2.d[j] + 2 * s3.d[j] + s4.d[j]);
  return { y: out, Qint: h / 6 * (s1.Q + 2 * s2.Q + 2 * s3.Q + s4.Q) };
}

/**
 * Dense fixed-step RK4 from y0 over [0,T]. onStep(t, y) is called at t=0 and after every step.
 * Returns the final state, final evaluation, integrated net flow and path diagnostics used to certify that
 * the comparison problem is smooth (no f-threshold crossing) and stays in the physical domain.
 */
export function integrate(sys, y0, drive, T, h, onStep = null) {
  const steps = Math.round(T / h);
  if (Math.abs(steps * h - T) > 1e-9) throw new RangeError('T must be a multiple of h');
  const n = sys.n;
  let y = Float64Array.from(y0), t = 0, Qint = 0;
  const first = evaluate(sys, y.subarray(0, n), y.subarray(n), drive);
  const regime0 = Int8Array.from(first.regime);
  const path = { minV: Infinity, minF: Infinity, maxF: -Infinity, minGap: Infinity, regimeChanged: false, minSpecificOverRest: Infinity, maxPaw: -Infinity, minPaw: Infinity };
  const track = (e, yy) => {
    for (let i = 0; i < n; i++) {
      path.minV = Math.min(path.minV, yy[i]); path.minF = Math.min(path.minF, yy[n + i]); path.maxF = Math.max(path.maxF, yy[n + i]);
      path.minGap = Math.min(path.minGap, e.gap[i]);
      if (e.regime[i] !== regime0[i]) path.regimeChanged = true;
      path.minSpecificOverRest = Math.min(path.minSpecificOverRest, e.spec[i] / sys.units[i].rest);
    }
    path.maxPaw = Math.max(path.maxPaw, e.Paw); path.minPaw = Math.min(path.minPaw, e.Paw);
  };
  track(first, y);
  if (onStep) onStep(0, y);
  for (let k = 0; k < steps; k++) {
    const r = rk4Step(sys, y, h, drive);
    y = r.y; Qint += r.Qint; t = (k + 1) * h;
    track(evaluate(sys, y.subarray(0, n), y.subarray(n), drive), y);
    if (onStep) onStep(t, y);
  }
  const end = evaluate(sys, y.subarray(0, n), y.subarray(n), drive);
  return { y, V: y.slice(0, n), f: y.slice(n), end, first, Qint, path };
}

export const packState = (V, f) => { const y = new Float64Array(V.length + f.length); y.set(V); y.set(f, V.length); return y; };

// ---------------------------------------------------------------------------------------------------
// Relaxed (zero-flow) root at fixed f: E_i + Ppl_i(sum V) = P for every unit, solved by bisection on total volume
// ---------------------------------------------------------------------------------------------------
export function relaxedRoot(sys, f, pressure) {
  const { n, units, mech, B, grad, Ecw, Vref } = sys;
  const volumesAt = Vt => {
    const V = new Float64Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const u = units[i], E = pressure - (B + grad * u.dep + Ecw * (Vt - Vref));
      V[i] = u.weight * aeration(mech, f[i]) * specificOfPressure(u, E, mech);
      sum += V[i];
    }
    return { V, sum };
  };
  let lo = -1e5, hi = 1e5;
  if (!(volumesAt(lo).sum - lo > 0) || !(volumesAt(hi).sum - hi < 0)) throw new RangeError('relaxed root bracket failed');
  for (let it = 0; it < 300; it++) {
    const mid = 0.5 * (lo + hi);
    if (volumesAt(mid).sum - mid > 0) lo = mid; else hi = mid;
    if (hi - lo < 1e-13 * Math.max(1, Math.abs(mid))) break;
  }
  const total = 0.5 * (lo + hi), { V } = volumesAt(total);
  let sum = 0;
  for (const v of V) sum += v;
  return { V, total: sum, bracketTotal: total };
}

// ---------------------------------------------------------------------------------------------------
// Linear algebra and rate estimation (numerical Jacobian of dV/dt wrt V at fixed f)
// ---------------------------------------------------------------------------------------------------
export function solveLinear(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-300) throw new RangeError('singular matrix');
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const q = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= q * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
  return x;
}

export function volumeJacobian(sys, V, f, drive) {
  const n = sys.n, J = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let j = 0; j < n; j++) {
    const d = 1e-5 * Math.max(1, Math.abs(V[j])), up = Float64Array.from(V), dn = Float64Array.from(V);
    up[j] += d; dn[j] -= d;
    const a = evaluate(sys, up, f, drive).dV, b = evaluate(sys, dn, f, drive).dV;
    for (let i = 0; i < n; i++) J[i][j] = (a[i] - b[i]) / (2 * d);
  }
  return J;
}

const matvec = (J, v) => J.map(row => row.reduce((s, x, k) => s + x * v[k], 0));
const dot = (a, b) => a.reduce((s, x, k) => s + x * b[k], 0);
const norm = a => Math.sqrt(dot(a, a));

/** Real-eigenvalue extremes of J: lambdaFast (largest magnitude) and lambdaSlow (smallest magnitude). Throws if not converged. */
export function rateExtremes(J) {
  const n = J.length, seed = Array.from({ length: n }, (_, i) => 1 + 0.37 * i + 0.11 * i * i);
  const iterate = apply => {
    let v = seed.map(x => x / norm(seed)), lam = 0, res = Infinity;
    for (let it = 0; it < 20000; it++) {
      const w = apply(v), nw = norm(w);
      v = w.map(x => x / nw);
      const Jv = matvec(J, v);
      lam = dot(v, Jv) / dot(v, v);
      res = norm(Jv.map((x, k) => x - lam * v[k])) / Math.abs(lam);
      if (res < 1e-9) break;
    }
    if (!(res < 1e-6)) throw new RangeError(`eigenvalue iteration did not converge (residual ${res})`);
    return lam;
  };
  return { lambdaFast: iterate(v => matvec(J, v)), lambdaSlow: iterate(v => solveLinear(J, v)) };
}

// ---------------------------------------------------------------------------------------------------
// Analytic solution for homogeneous linear fixed-f units (identical units, weights sum to 1)
// ---------------------------------------------------------------------------------------------------
export function homogeneousLinear(patient, mechOverrides = {}, multiplier = 1) {
  const mech = mechanics(mechOverrides), u0 = patient.units[0];
  for (const u of patient.units) {
    if (u.linearCompliance == null || u.fixedOpen !== true) throw new RangeError('homogeneous analytic case needs linearCompliance and fixedOpen');
    for (const key of ['linearCompliance', 'rest', 'dep', 'f']) if (u[key] !== u0[key]) throw new RangeError(`units must be identical in ${key}`);
    if (Math.abs(u.weight - patient.units[0].weight) > 1e-14) throw new RangeError('equal weights required');
  }
  const a = aeration(mech, u0.f), conductanceFactor = (mech.residualConductance + (1 - mech.residualConductance) * a) ** mech.patencyPower;
  const Gtot = conductanceFactor / (mech.Rp * multiplier);
  const Rtot = mech.R0 + 1 / Gtot;
  const Cunit = a * u0.linearCompliance;
  const Ecw = patient.chestWallElastance, Ceff = 1 / (1 / Cunit + Ecw);
  const P0 = -u0.rest / u0.linearCompliance + patient.baselinePleural + patient.pleuralGradient * u0.dep - Ecw * patient.chestWallReferenceVolume;
  const tau = Rtot * Ceff;
  return {
    a, conductanceFactor, Gtot, Rtot, Cunit, Ceff, tau, P0, mech,
    restVolume: P => (P - P0) * Ceff,
    pressureStep: (Pfrom, Pto, t) => { const Vinf = (Pto - P0) * Ceff, V0 = (Pfrom - P0) * Ceff; return Vinf + (V0 - Vinf) * Math.exp(-t / tau); },
    volumeFlowPaw: (V, Q) => P0 + V / Ceff + Q * Rtot
  };
}

// ---------------------------------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------------------------------
export const maxAbsDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
export const sum = a => { let s = 0; for (const x of a) s += x; return s; };
/** Observed order between consecutive step sizes: log(e_k/e_{k+1}) / log(h_k/h_{k+1}). */
export const observedOrders = (hs, errs) => errs.slice(0, -1).map((e, k) => Math.log(errs[k] / errs[k + 1]) / Math.log(hs[k] / hs[k + 1]));
