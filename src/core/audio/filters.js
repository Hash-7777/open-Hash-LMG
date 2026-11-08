// Second-order filters on sample arrays, and the same filters run forward
// then backward, which cancels their phase: the band they pass lines up with
// the signal it came from, so it can be taken back out of that signal.
//
// A Butterworth section run both ways has the magnitude 1 / (1 + (f / fc)^4)
// for a low-pass (and its mirror for a high-pass), with no phase shift.

import { SR } from './synth.js';

function coeffs(kind, fc, q = Math.SQRT1_2) {
  const w = (2 * Math.PI * Math.min(fc, SR * 0.45)) / SR, cw = Math.cos(w), al = Math.sin(w) / (2 * q);
  let b0, b1, b2;
  if (kind === 'low') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; }
  else if (kind === 'high') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; }
  else { b0 = al; b1 = 0; b2 = -al; } // band: unit gain at fc
  const a0 = 1 + al;
  return [b0 / a0, b1 / a0, b2 / a0, (-2 * cw) / a0, (1 - al) / a0];
}

// One pass of a section over x, in place, forward or backward.
function pass(x, [b0, b1, b2, a1, a2], backward = false) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const n = x.length;
  for (let k = 0; k < n; k++) {
    const i = backward ? n - 1 - k : k;
    const v = x[i];
    const y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = y;
    x[i] = y;
  }
  return x;
}

// A filtered copy of x: kind 'low', 'high' or 'band' at fc, one way only.
export function filter(x, kind, fc, q) {
  return pass(Float32Array.from(x), coeffs(kind, fc, q));
}

// A copy of x holding only the band from lo to hi, with no phase shift.
export function bandZeroPhase(x, lo, hi) {
  const y = Float32Array.from(x);
  const H = coeffs('high', lo), L = coeffs('low', hi);
  pass(y, H); pass(y, H, true);
  pass(y, L); pass(y, L, true);
  return y;
}

// The gain at frequency f of bandZeroPhase(lo, hi), for the checks.
export const bandGain = (f, lo, hi) => (1 / (1 + (lo / Math.max(f, 1e-9)) ** 4)) * (1 / (1 + (f / hi) ** 4));
