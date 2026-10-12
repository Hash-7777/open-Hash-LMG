// Time and number helpers. Pure: the same inputs always give the same output,
// which is what makes a frame at time t identical on every render.

import { resolveEase } from './ease.js';
import { parseColor, mixColor, toCss } from '../util/color.js';

export const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const mix = (a, b, f) => a + (b - a) * f;
export const remap = (v, a0, a1, b0, b1) => b0 + ((v - a0) / ((a1 - a0) || 1e-9)) * (b1 - b0);
export const smoothstep = (a, b, v) => {
  const x = clamp((v - a) / ((b - a) || 1e-9));
  return x * x * (3 - 2 * x);
};

// Progress of t through [t0, t0 + dur], eased, clamped to 0..1.
export function progress(t, t0, dur, e = 'outCubic') {
  if (dur <= 0) return t >= t0 ? 1 : 0;
  return resolveEase(e)(clamp((t - t0) / dur));
}

// A value moving from `from` to `to` over [t0, t1].
export function tween(t, t0, t1, from, to, e = 'outCubic') {
  return lerpValue(from, to, progress(t, t0, t1 - t0, e));
}

// Interpolates numbers, arrays of numbers, and colours (any CSS colour string).
export function lerpValue(a, b, f) {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * f;
  if (Array.isArray(a) && Array.isArray(b)) return a.map((v, i) => lerpValue(v, b[i] ?? v, f));
  if (typeof a === 'string' && typeof b === 'string') {
    const ca = parseColor(a), cb = parseColor(b);
    if (ca && cb) return toCss(mixColor(ca, cb, f));
    return f < 0.5 ? a : b;
  }
  return f < 0.5 ? a : b;
}

// Keyframes: [[time, value, ease?], ...] sorted by time. The ease on a key
// shapes the segment that ARRIVES at it. Before the first key the first value
// holds; after the last, the last value holds.
export function keys(t, list) {
  if (!Array.isArray(list) || list.length === 0) return undefined;
  if (t <= list[0][0]) return list[0][1];
  for (let i = 1; i < list.length; i++) {
    const [t1, v1, e] = list[i];
    if (t <= t1) {
      const [t0, v0] = list[i - 1];
      const f = resolveEase(e || 'inOutCubic')(clamp((t - t0) / ((t1 - t0) || 1e-9)));
      return lerpValue(v0, v1, f);
    }
  }
  return list[list.length - 1][1];
}

// A spring released at t0, from 0 toward 1. With the default damping ratio of 1
// it is critically damped: it arrives as fast as a spring can without passing
// the target. Lower `ratio` below 1 only on purpose; the linter notices.
export function spring(t, t0, { freq = 2.2, ratio = 1 } = {}) {
  const x = t - t0;
  if (x <= 0) return 0;
  const w = 2 * Math.PI * freq;
  if (ratio >= 1) return 1 - (1 + w * x) * Math.exp(-w * x);
  const wd = w * Math.sqrt(1 - ratio * ratio);
  const env = Math.exp(-ratio * w * x);
  return 1 - env * (Math.cos(wd * x) + ((ratio * w) / wd) * Math.sin(wd * x));
}

// A seeded generator (mulberry32). rand(seed)() gives the same sequence for the
// same seed on every machine. Math.random is replaced by one of these inside the
// render worker, so even code that reaches for it stays deterministic.
export function rand(seed = 1) {
  let a = (Math.floor(Math.abs(seed) * 1e6) ^ 0x9e3779b9) >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// A hash of an integer to 0..1, for noise lattices.
function hash1(n) {
  let x = (n * 374761393) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

// Smooth value noise in one dimension, about -1..1. Drifting backgrounds and
// slow camera float use it: it never starts or stops, so it does not pull the
// eye away from what does.
export function noise(x, seed = 0) {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = hash1(i + seed * 7919), b = hash1(i + 1 + seed * 7919);
  return (a + (b - a) * u) * 2 - 1;
}

// Two-dimensional value noise, about -1..1.
export function noise2(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const h = (a, b) => hash1(a * 73856093 + b * 19349663 + seed * 83492791);
  const v00 = h(ix, iy), v10 = h(ix + 1, iy), v01 = h(ix, iy + 1), v11 = h(ix + 1, iy + 1);
  const a = v00 + (v10 - v00) * ux, b = v01 + (v11 - v01) * ux;
  return (a + (b - a) * uy) * 2 - 1;
}

// Seconds per beat, and the time of beat n, for cutting on a music grid.
export const beatLength = (bpm) => 60 / (bpm || 120);
export const snapToBeat = (t, bpm, division = 1) => {
  const step = beatLength(bpm) / division;
  return Math.round(t / step) * step;
};
