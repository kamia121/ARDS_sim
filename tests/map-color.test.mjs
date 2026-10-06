import {MODEL_INFO} from '../src/engine.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { expansionColor,EXPANSION_THRESHOLD } from '../src/map-color.js';

test('anchors and clamps', () => {
  for (const r of [-5, 0, 1, 1.18, 1.2]) assert.equal(expansionColor(r), '#259880');
  assert.equal(expansionColor(1.45), '#d9b83f');
  for (const r of [1.65, 1.7, 99]) assert.equal(expansionColor(r), '#cf604e');
});
test('midpoints interpolate between anchors', () => {
  assert.equal(expansionColor(1.325), '#7fa860');
  assert.equal(expansionColor(1.55), '#d48c47');
});
test('output is always a lowercase hex color and nonfinite input is green', () => {
  for (const r of [NaN, Infinity, -Infinity, undefined, null, 'x', {}]) assert.equal(expansionColor(r), '#259880');
  for (let r = 1; r <= 1.8; r += 0.013) assert.match(expansionColor(r), /^#[0-9a-f]{6}$/);
});

test('color threshold shares the model distension-proxy cutoff',()=>{assert.equal(EXPANSION_THRESHOLD,MODEL_INFO.highStrainCutoff);});
