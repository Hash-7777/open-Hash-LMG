// Keyframes edited by hand: a key at the playhead holds the value there, a
// keyed value changed at the playhead records a key, a key taken away leaves
// the value it held, opacity keys stay right against the layer's own opacity,
// and the previous and next keys are found; the result survives normalising.

import assert from 'node:assert/strict';
import { section, claim, done } from './lib/check.mjs';
import { keyAt, valueAt, setKey, keyHere, removeKey, clearKeys, setAt, keyTimes, nextKey, SAME_KEY } from '../../src/core/scene/keys-edit.js';
import { normalizeScene } from '../../src/core/scene/normalize.js';
import { layerState } from '../../src/core/engine/motion.js';

const layer = (extra = {}) => ({ id: 't', type: 'text', text: 'Hi', x: 0.5, y: 0.5, scale: 1, rotate: 0, opacity: 1, at: 0, until: 4, ...extra });

section('A key at the playhead');
await claim('a first key holds the value the property has there; a second makes it move between them', () => {
  const L = layer({ x: 0.3 });
  keyHere(L, 'x', 1);
  assert.deepEqual(L.keys.x, [[1, 0.3]]);
  setAt(L, 'x', 3, 0.7);
  assert.deepEqual(L.keys.x, [[1, 0.3], [3, 0.7]]);
  const mid = valueAt(L, 'x', 2);
  assert.ok(mid > 0.3 && mid < 0.7, `between the keys: ${mid}`);
});
await claim('a value changed where a key already is replaces that key, keeping its curve', () => {
  const L = layer({ keys: { y: [[1, 0.2], [2, 0.4, 'outExpo']] } });
  setAt(L, 'y', 2 + SAME_KEY / 2, 0.9);
  assert.deepEqual(L.keys.y, [[1, 0.2], [2, 0.9, 'outExpo']]);
  assert.equal(keyAt(L.keys.y, 2.02), -1, 'a moment more than a frame away is another key');
});
await claim('a property with no keys is simply set', () => {
  const L = layer();
  setAt(L, 'scale', 2, 1.5);
  assert.equal(L.scale, 1.5); assert.equal(L.keys, undefined);
});

section('Taking keys away');
await claim('removing the last key of a property leaves the value it held as the layer’s own', () => {
  const L = layer();
  setKey(L, 'rotate', 1, 30);
  removeKey(L, 'rotate', 1);
  assert.equal(L.rotate, 30); assert.equal(L.keys.rotate, undefined);
});
await claim('clearing every key keeps each property at its first key', () => {
  const L = layer({ keys: { x: [[0, 0.2], [2, 0.8]], scale: [[1, 2]] } });
  clearKeys(L);
  assert.equal(L.x, 0.2); assert.equal(L.scale, 2); assert.deepEqual(L.keys, {});
});

section('Opacity, which keys multiply');
await claim('keying a layer drawn at half opacity keeps it at half, and the film draws what the panel shows', () => {
  const L = layer({ opacity: 0.5 });
  keyHere(L, 'opacity', 1);
  setAt(L, 'opacity', 3, 0.2);
  assert.equal(L.opacity, 1);
  assert.equal(valueAt(L, 'opacity', 1), 0.5);
  const { scene } = normalizeScene({ format: 'lmg.scene/1', aspect: '16:9', scenes: [{ id: 's', duration: 4, layers: [{ ...L, in: { preset: 'none' } }] }] });
  const N = scene.scenes[0].layers[0];
  assert.ok(Math.abs(layerState(N, 3).opacity - 0.2) < 1e-9);
  assert.ok(Math.abs(layerState(N, 1).opacity - 0.5) < 1e-9);
});

section('Going from key to key');
await claim('the keys of every shown property are listed once, in order, with the previous and next found', () => {
  const L = layer({ keys: { x: [[0.5, 0.1], [2, 0.2]], opacity: [[2, 1], [3.5, 0]], size: [[9, 50]] } });
  assert.deepEqual(keyTimes(L), [0.5, 2, 3.5]);
  assert.equal(nextKey(L, 2, 1), 3.5); assert.equal(nextKey(L, 2, -1), 0.5);
  assert.equal(nextKey(L, 3.5, 1), null); assert.equal(nextKey(L, 0.5, -1), null);
});
await claim('keys set by hand survive normalising unchanged', () => {
  const L = layer();
  keyHere(L, 'x', 0.5); setAt(L, 'x', 2.25, 0.8); keyHere(L, 'scale', 1);
  const once = normalizeScene({ format: 'lmg.scene/1', aspect: '16:9', scenes: [{ id: 's', duration: 4, layers: [L] }] }).scene.scenes[0].layers[0];
  assert.deepEqual(once.keys, { x: [[0.5, 0.5], [2.25, 0.8]], scale: [[1, 1]] });
});

done();
