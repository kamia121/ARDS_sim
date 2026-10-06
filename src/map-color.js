import {MODEL_INFO} from './engine.js';
export const EXPANSION_THRESHOLD=MODEL_INFO.highStrainCutoff;
const GREEN = [0x25, 0x98, 0x80], YELLOW = [0xd9, 0xb8, 0x3f], RED = [0xcf, 0x60, 0x4e];
const GREEN_END = 1.2, YELLOW_AT = 1.45, RED_START = EXPANSION_THRESHOLD;

const mix = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));
const hex = rgb => '#' + rgb.map(x => x.toString(16).padStart(2, '0')).join('');

// Illustrative display anchors only; not clinical thresholds.
export function expansionColor(ratio) {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio <= GREEN_END) return hex(GREEN);
  if (ratio >= RED_START) return hex(RED);
  if (ratio <= YELLOW_AT) return hex(mix(GREEN, YELLOW, (ratio - GREEN_END) / (YELLOW_AT - GREEN_END)));
  return hex(mix(YELLOW, RED, (ratio - YELLOW_AT) / (RED_START - YELLOW_AT)));
}
