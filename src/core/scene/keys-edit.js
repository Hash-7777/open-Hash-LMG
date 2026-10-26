// Keyframes edited by hand, as a video editor does: a value keyed at the
// playhead, a key taken away, the previous and next key to jump to.
//
// A layer's keys are { prop: [[t, value, ease?], ...] } in scene seconds,
// sorted by time (normalize.js). With keys, a property's value at a moment is
// the keys' value there; opacity keys are multiplied by the layer's own
// opacity (motion.js), so a keyed opacity is kept with the layer's own at one.
//
// Pure: each function changes the layer it is given, or reads it.

import { keys as keyValue } from '../engine/math.js';

// The properties the inspector keys, in the order it shows them.
export const KEYED = ['x', 'y', 'scale', 'rotate', 'opacity'];

// Two keys closer than this are one key: about a frame at 60 fps.
export const SAME_KEY = 1 / 120;

const round = (t) => +t.toFixed(3);

// The index of the key at time t, or -1.
export function keyAt(list, t) {
  return (list || []).findIndex((k) => Math.abs(k[0] - t) <= SAME_KEY);
}

// The value a property has at time t: its keys there, or the layer's own.
export function valueAt(L, prop, t) {
  const list = L.keys?.[prop];
  if (!list?.length) return L[prop];
  const v = keyValue(t, list);
  return prop === 'opacity' ? v * L.opacity : v;
}

// Puts a key for prop at time t with value v, replacing one already there.
// The first key a property gets starts its keys; an opacity being keyed
// moves the layer's own opacity into the keys.
export function setKey(L, prop, t, v) {
  L.keys ||= {};
  if (prop === 'opacity' && L.opacity !== 1) {
    const own = L.opacity;
    L.keys.opacity = (L.keys.opacity || []).map(([kt, kv, e]) => (e === undefined ? [kt, kv * own] : [kt, kv * own, e]));
    L.opacity = 1;
  }
  const list = (L.keys[prop] || []).slice();
  const i = keyAt(list, t);
  if (i >= 0) list[i] = [list[i][0], v, ...(list[i].length > 2 ? [list[i][2]] : [])];
  else list.push([round(t), v]);
  list.sort((a, b) => a[0] - b[0]);
  L.keys[prop] = list;
  return L;
}

// A key at the playhead holding the value the property has there now.
export function keyHere(L, prop, t) {
  return setKey(L, prop, t, valueAt(L, prop, t));
}

// Takes away the key at time t. A property left with no keys keeps the value
// it had there, as its own.
export function removeKey(L, prop, t) {
  const list = L.keys?.[prop];
  const i = keyAt(list, t);
  if (i < 0) return L;
  const held = valueAt(L, prop, t);
  const rest = list.filter((_, k) => k !== i);
  if (rest.length) L.keys[prop] = rest;
  else clearKeys(L, prop, held);
  return L;
}

// Takes away every key of one property (keeping the value given, or the
// first key's) or, with no property named, of all of them.
export function clearKeys(L, prop = null, keep = undefined) {
  if (!L.keys) return L;
  for (const p of prop ? [prop] : Object.keys(L.keys)) {
    const list = L.keys[p];
    if (!list?.length) continue;
    const v = keep !== undefined && prop ? keep : list[0][1] * (p === 'opacity' ? L.opacity : 1);
    if (typeof v === 'number') L[p] = p === 'opacity' ? Math.min(1, Math.max(0, v)) : v;
    delete L.keys[p];
  }
  return L;
}

// Sets a property by hand at time t: a keyed property gets a key there, as a
// video editor records a change at the playhead; any other is simply set.
export function setAt(L, prop, t, v) {
  if (L.keys?.[prop]?.length) return setKey(L, prop, t, v);
  L[prop] = v;
  return L;
}

// Every moment any shown property has a key, in order.
export function keyTimes(L) {
  const out = [];
  for (const p of KEYED) for (const [t] of L.keys?.[p] || []) if (!out.some((x) => Math.abs(x - t) <= SAME_KEY)) out.push(t);
  return out.sort((a, b) => a - b);
}

// The nearest key before or after t (dir -1 or 1), or null.
export function nextKey(L, t, dir) {
  const list = keyTimes(L);
  return dir < 0 ? list.filter((k) => k < t - SAME_KEY).pop() ?? null : list.find((k) => k > t + SAME_KEY) ?? null;
}
