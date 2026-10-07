/**
 * Bounded, configurable recruitability layer over createPatient().
 *
 * The original patient is always built first. Only popen, pclose, tauOpen, tauClose and
 * (when initialOpenFraction is given) f are rewritten, using the uniform draws that
 * createPatient consumed for each unit, recovered by replaying its Mulberry32 stream.
 * Educational and uncalibrated, like the model it wraps.
 *
 * Documented choices:
 *  - openingShift applies to every unit, including difficult ones (after the difficult range).
 *  - healthyDependent's dependent-region adjustments (+1*s opening, +3.5*s closing) apply to
 *    every unit regardless of category, so a difficult healthyDependent unit also gets +1*s.
 *  - Closing thresholds always use the original per-kind family, then closingShift, then are
 *    capped at (new opening threshold - 0.5).
 */
import { createPatient } from './engine.js';

const deepFreeze = o => { Object.values(o).forEach(v => { if (v && typeof v === 'object') deepFreeze(v); }); return Object.freeze(o); };

const COMMON = { difficultOpenMin: 38, difficultOpenMax: 58, openingShift: 0, closingShift: 0, tauOpenScale: 1, tauCloseScale: 1, initialOpenFraction: null };
export const RECRUITABILITY_DEFAULTS = deepFreeze({
  high: { difficultFraction: 0.08, ...COMMON },
  low: { difficultFraction: 0.68, ...COMMON },
  wall: { difficultFraction: 0.08, ...COMMON },
  healthy: { difficultFraction: 0, ...COMMON },
  healthyDependent: { difficultFraction: 0, ...COMMON }
});

const RANGES = {
  difficultFraction: [0, 1], difficultOpenMin: [0, 120], difficultOpenMax: [0, 120],
  openingShift: [-15, 30], closingShift: [-15, 15], tauOpenScale: [0.25, 4], tauCloseScale: [0.25, 4],
  initialOpenFraction: [0, 1]
};

function checkKind(kind) {
  if (typeof kind !== 'string' || !Object.hasOwn(RECRUITABILITY_DEFAULTS, kind)) throw new RangeError(`Unknown phenotype: ${String(kind)}`);
}

/** Validate overrides strictly and return the full resolved configuration (fresh object). */
export function normalizeRecruitability(kind, overrides = {}) {
  checkKind(kind);
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) throw new TypeError('recruitability overrides must be a plain object');
  const proto = Object.getPrototypeOf(overrides);
  if (proto !== Object.prototype && proto !== null) throw new TypeError('recruitability overrides must be a plain object');
  const defaults = RECRUITABILITY_DEFAULTS[kind];
  for (const key of Reflect.ownKeys(overrides)) {
    if (typeof key !== 'string' || !Object.hasOwn(RANGES, key)) throw new RangeError(`Unknown recruitability option: ${String(key)}`);
  }
  const out = { ...defaults };
  for (const key of Object.keys(RANGES)) {
    const value = overrides[key];
    if (value === undefined || (key === 'initialOpenFraction' && value === null)) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${key} must be a finite number`);
    const [lo, hi] = RANGES[key];
    if (value < lo || value > hi) throw new RangeError(`${key} must be between ${lo} and ${hi}`);
    out[key] = value;
  }
  if (out.difficultOpenMin > out.difficultOpenMax) throw new RangeError('difficultOpenMin must not exceed difficultOpenMax');
  return out;
}

// Same Mulberry32 algorithm as createPatient's private generator.
function mulberry(seed) {
  let s = seed >>> 0;
  return () => { s += 0x6D2B79F5; let t = Math.imul(s ^ s >>> 15, 1 | s); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

const isDefault = (config, defaults) => Object.keys(defaults).every(k => Object.is(config[k], defaults[k]));

export function createUnifiedPatient(kind = 'high', seed = 13791, count = 512, pbw = 70, overrides = {}) {
  const config = normalizeRecruitability(kind, overrides);
  const patient = createPatient(kind, seed, count, pbw);
  if (isDefault(config, RECRUITABILITY_DEFAULTS[kind])) return patient;

  const healthyLike = kind === 'healthy' || kind === 'healthyDependent';
  const random = mulberry(seed);
  const span = config.difficultOpenMax - config.difficultOpenMin;
  patient.units.forEach(u => {
    // Draw order mirrors createPatient: dep, weight, capacity, hardU, popenU, pcloseU, [fU], stiffness, tauOpen, tauClose.
    const dep = random(); random(); random();
    const hardU = random(), popenU = random(), pcloseU = random();
    const fU = healthyLike ? null : random();
    random();
    const tauOpenU = random(); random();
    if (dep !== u.dep || 0.35 + 1.2 * tauOpenU !== u.tauOpen) throw new Error('Random stream replay diverged from createPatient');

    const s = kind === 'healthyDependent' ? Math.max(0, (dep - 0.6) / 0.4) : 0;
    const hard = hardU < config.difficultFraction;
    let popen = hard ? config.difficultOpenMin + span * popenU : healthyLike ? 0.3 + 3 * popenU : 6 + 15 * popenU + 6 * dep;
    let pclose = healthyLike ? -3 + 2 * pcloseU : 0.5 + 6 * pcloseU + 3 * dep;
    if (kind === 'healthyDependent') { popen += 1 * s; pclose += 3.5 * s; }
    popen += config.openingShift;
    pclose += config.closingShift;
    u.popen = popen;
    u.pclose = Math.min(pclose, popen - 0.5);
    u.tauOpen *= config.tauOpenScale;
    u.tauClose *= config.tauCloseScale;
    if (config.initialOpenFraction !== null) {
      const base = config.initialOpenFraction;
      u.f = kind === 'healthyDependent' ? clamp(base - 0.6 * s, 0, 1)
        : healthyLike ? base
        : clamp(base + 0.4 * (0.5 - dep) + 0.1 * (fU - 0.5), 0, 1);
    }
  });
  patient.recruitability = { ...config };
  return patient;
}
