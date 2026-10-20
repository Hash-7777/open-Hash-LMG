// Mastering to the loudness the platforms play at.
//
// Video platforms turn louder uploads down to about -14 LUFS
// integrated, so a louder master only loses its dynamics. master() measures
// integrated loudness the ITU-R BS.1770 way (K weighting, 400 ms blocks with
// 75 percent overlap, an absolute gate at -70 LUFS and a relative gate 10 LU
// below), measures true peak at four times oversampling, then gains and limits
// in turns until it reads -14 LUFS with true peaks under -1 dBTP.

import { SR } from './synth.js';

// BS.1770 K-weighting coefficients at 48 kHz.
const SHELF = { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [1, -1.69065929318241, 0.73248077421585] };
const HIPASS = { b: [1.0, -2.0, 1.0], a: [1, -1.99004745483398, 0.99007225036621] };

function biquad(x, { b, a }) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

export function integratedLufs(L, R) {
  const kl = biquad(biquad(L, SHELF), HIPASS), kr = biquad(biquad(R, SHELF), HIPASS);
  const block = Math.round(0.4 * SR), hop = Math.round(0.1 * SR);
  const powers = [];
  for (let i = 0; i + block <= kl.length; i += hop) {
    let sl = 0, sr = 0;
    for (let j = i; j < i + block; j++) { sl += kl[j] * kl[j]; sr += kr[j] * kr[j]; }
    powers.push(sl / block + sr / block);
  }
  if (!powers.length) return -Infinity;
  const lufs = (p) => -0.691 + 10 * Math.log10(p + 1e-12);
  const abs = powers.filter((p) => lufs(p) > -70);
  if (!abs.length) return -Infinity;
  const rel = lufs(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const gated = abs.filter((p) => lufs(p) > rel);
  return lufs(gated.reduce((a, b) => a + b, 0) / gated.length);
}

// Windowed-sinc interpolation taps for 4x oversampling.
const OS = 4, HALF = 12;
const TAPS = (() => {
  const t = [];
  for (let ph = 0; ph < OS; ph++) {
    const row = [];
    for (let k = -HALF + 1; k <= HALF; k++) {
      const x = k - ph / OS;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / HALF);
      row.push(sinc * w);
    }
    t.push(row);
  }
  return t;
})();

export function truePeakDb(L, R) {
  let peak = 0;
  for (const x of [L, R]) {
    for (let i = HALF; i < x.length - HALF; i++) {
      const a = Math.abs(x[i]);
      if (a > peak) peak = a;
      // Only look between samples near a loud one: the rest cannot exceed it.
      if (a < peak * 0.7) continue;
      for (let ph = 1; ph < OS; ph++) {
        const row = TAPS[ph];
        let s = 0;
        for (let k = 0; k < row.length; k++) s += x[i - HALF + 1 + k] * row[k];
        const v = Math.abs(s);
        if (v > peak) peak = v;
      }
    }
  }
  return 20 * Math.log10(peak + 1e-12);
}

// A lookahead peak limiter. need[i] is the gain sample i can take; m[i] is the
// smallest need over the next 2w samples; the applied gain at j is the average
// of m over the w samples ending at j. Every m in that average covers j, so the
// gain never exceeds what any sample allows, and it falls smoothly before a
// peak instead of jumping on it.
export function limit(L, R, ceiling, lookMs = 4) {
  const w = Math.max(2, Math.round((lookMs / 1000) * SR));
  const n = L.length;
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    need[i] = a > ceiling ? ceiling / a : 1;
  }
  const m = new Float32Array(n);
  const dq = new Int32Array(n);
  let head = 0, tail = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (tail > head && need[dq[tail - 1]] >= need[i]) tail--;
    dq[tail++] = i;
    while (dq[head] > i + 2 * w - 1) head++;
    m[i] = need[dq[head]];
  }
  let acc = 0;
  for (let j = 0; j < n; j++) {
    acc += m[j];
    if (j >= w) acc -= m[j - w];
    const g = acc / Math.min(j + 1, w);
    L[j] *= g;
    R[j] *= g;
  }
}

// Gains and limits until the master reads the target. Returns what it measured.
export function master(L, R, { target = -14, ceiling = -1 } = {}) {
  let lufs = integratedLufs(L, R);
  if (!Number.isFinite(lufs)) return { lufs, truePeak: -Infinity };
  let ceil = 10 ** (ceiling / 20);
  for (let pass = 0; pass < 5; pass++) {
    const gain = 10 ** ((target - lufs) / 20);
    for (let i = 0; i < L.length; i++) { L[i] *= gain; R[i] *= gain; }
    limit(L, R, ceil * 0.97);
    lufs = integratedLufs(L, R);
    const tp = truePeakDb(L, R);
    if (Math.abs(lufs - target) < 0.3 && tp <= ceiling) return { lufs, truePeak: tp };
    // A limiter only holds peaks between samples if its own ceiling sits under
    // the target, so it tightens each turn the true peak is still over.
    if (tp > ceiling) ceil *= 10 ** ((ceiling - tp) / 20) * 0.98;
  }
  // Last resort: a plain gain that keeps the peak under the ceiling, even if
  // that leaves the master a little quiet.
  const tp = truePeakDb(L, R);
  if (tp > ceiling) {
    const g = 10 ** ((ceiling - tp - 0.1) / 20);
    for (let i = 0; i < L.length; i++) { L[i] *= g; R[i] *= g; }
  }
  return { lufs: integratedLufs(L, R), truePeak: truePeakDb(L, R) };
}
