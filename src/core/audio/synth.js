// Sound sources for the score, written as plain arithmetic on sample arrays so
// a film's music is the same on every machine and needs no audio device.
//
// Sound design (a low pad, a round kick, a sub on the off-beat, soft ticks, a
// boom, a swell, a bell) and a few played instruments for the grooves in
// grooves.js (a mallet, a plucked string, an electric piano, a synth pluck, a
// pluck bass, a clap, a shaker). Every noise source is seeded.

import { rand } from '../engine/math.js';

export const SR = 48000;
const TAU = Math.PI * 2;

// A sine table is several times faster than Math.sin in the hot loops.
const TABLE_BITS = 13, TABLE = new Float32Array((1 << TABLE_BITS) + 1);
for (let i = 0; i <= 1 << TABLE_BITS; i++) TABLE[i] = Math.sin((i / (1 << TABLE_BITS)) * TAU);
export function sinp(phase) {
  // phase in turns
  const p = phase - Math.floor(phase);
  const x = p * (1 << TABLE_BITS);
  const i = x | 0, f = x - i;
  return TABLE[i] + (TABLE[i + 1] - TABLE[i]) * f;
}

export class Bus {
  constructor(seconds) {
    this.n = Math.ceil(seconds * SR);
    this.L = new Float32Array(this.n);
    this.R = new Float32Array(this.n);
  }
  // Adds a mono or stereo buffer at time t with gain and pan (-1..1).
  add(sig, t, gain = 1, pan = 0) {
    const start = Math.round(t * SR);
    const mono = !Array.isArray(sig);
    const sl = mono ? sig : sig[0], sr = mono ? sig : sig[1];
    const gl = gain * (pan > 0 ? 1 - pan : 1), gr = gain * (pan < 0 ? 1 + pan : 1);
    const a = Math.max(0, -start), b = Math.min(sl.length, this.n - start);
    for (let i = a; i < b; i++) { this.L[start + i] += sl[i] * gl; this.R[start + i] += sr[i] * gr; }
  }
}

// A soft pad note: a few detuned harmonics with slow attack and release.
export function pad(freq, dur, seed = 1, { harmonics = 5, tilt = 1.7, attack = 0.9, release = 1.2, detune = 0.0022 } = {}) {
  const n = Math.ceil(dur * SR), out = new Float32Array(n);
  const r = rand(seed);
  for (let h = 1; h <= harmonics; h++) {
    for (const d of [-detune, detune]) {
      const inc = (freq * h * (1 + d)) / SR, amp = 1 / h ** tilt;
      let ph = r();
      for (let i = 0; i < n; i++) { out[i] += sinp(ph) * amp; ph += inc; }
    }
  }
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] *= Math.min(1, t / attack) * Math.max(0, Math.min(1, (dur - t) / release)) * 0.22;
  }
  return out;
}

// A round, short kick: a falling sine with a soft click, gently saturated.
export function kick(seed = 3) {
  const n = Math.ceil(0.42 * SR), out = new Float32Array(n);
  const r = rand(seed);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 46 + 70 * Math.exp(-t * 38);
    ph += f / SR;
    out[i] = Math.tanh(1.6 * sinp(ph) * Math.exp(-t * 7.5)) + (r() * 2 - 1) * 0.22 * Math.exp(-t * 300);
  }
  return out;
}

// A sub-bass note, saturated so its harmonics carry on phone speakers.
export function sub(freq, dur = 0.22) {
  const n = Math.ceil(dur * SR), out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += freq / SR;
    const env = Math.min(1, t / 0.006) * Math.exp(-t * 9);
    out[i] = Math.tanh(2.4 * sinp(ph) * env) * 0.8;
  }
  return out;
}

// One-pole filtered noise: high-passed for ticks and hats, band-limited for snaps.
function noise(n, seed, hp = 0.9, lp = 0) {
  const r = rand(seed), out = new Float32Array(n);
  let prev = 0, hpOut = 0, lpOut = 0;
  for (let i = 0; i < n; i++) {
    const x = r() * 2 - 1;
    hpOut = hp * (hpOut + x - prev);
    prev = x;
    lpOut = lp ? lpOut + lp * (hpOut - lpOut) : hpOut;
    out[i] = lpOut;
  }
  return out;
}

export function tick(seed = 5) {
  const n = Math.ceil(0.03 * SR), out = noise(n, seed, 0.97);
  for (let i = 0; i < n; i++) out[i] *= Math.exp((-i / SR) * 170);
  return out;
}

export function hat(seed = 7) {
  const n = Math.ceil(0.12 * SR), out = noise(n, seed, 0.95);
  for (let i = 0; i < n; i++) out[i] *= Math.exp((-i / SR) * 32) * 0.8;
  return out;
}

export function snap(seed = 9) {
  const n = Math.ceil(0.25 * SR), out = noise(n, seed, 0.8, 0.35);
  for (let i = 0; i < n; i++) out[i] *= Math.exp((-i / SR) * 26) * 1.4;
  return out;
}

// A deep boom for reveals.
export function boom(seed = 11) {
  const n = Math.ceil(3.2 * SR), out = new Float32Array(n);
  const nz = noise(n, seed, 0.6, 0.05);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (30 + 34 * Math.exp(-t * 2.2)) / SR;
    out[i] = Math.tanh(1.8 * sinp(ph) * Math.exp(-t * 1.3)) + nz[i] * Math.exp(-t * 6) * 0.9;
  }
  return out;
}

// A rising swell into a reveal: filtered noise and a gliding tone, cut sharp.
export function swell(dur, seed = 13) {
  const n = Math.ceil(dur * SR), out = new Float32Array(n);
  const nz = noise(n, seed, 0.85, 0.3);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const p = i / n, t = i / SR;
    ph += (110 + 330 * p * p) / SR;
    out[i] = (nz[i] * 0.7 * p ** 2.5 + sinp(ph) * p ** 3 * 0.25) * Math.min(1, (dur - t) / 0.02);
  }
  return out;
}

// A short air movement for a transition.
export function whoosh(dur = 0.45, seed = 17) {
  const n = Math.ceil(dur * SR), out = new Float32Array(n);
  const nz = noise(n, seed, 0.9, 0.25);
  for (let i = 0; i < n; i++) {
    const p = i / n;
    out[i] = nz[i] * Math.sin(Math.PI * p) ** 2 * 0.6;
  }
  return out;
}

// A glassy bell: a sine with inharmonic partials that die faster.
export function bell(freq, dur = 2.4) {
  const n = Math.ceil(dur * SR), out = new Float32Array(n);
  let p1 = 0, p2 = 0, p3 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    p1 += freq / SR; p2 += (freq * 2.76) / SR; p3 += (freq * 5.4) / SR;
    out[i] = (sinp(p1) + 0.35 * sinp(p2) * Math.exp(-t * 4) + 0.2 * sinp(p3) * Math.exp(-t * 9)) * Math.exp(-t * 2.2) * Math.min(1, t / 0.003);
  }
  return out;
}

// A soft single hit for a cut: a short low thump with a little air.
export function hit(seed = 19) {
  const n = Math.ceil(0.6 * SR), out = new Float32Array(n);
  const nz = noise(n, seed, 0.7, 0.2);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (60 + 40 * Math.exp(-t * 20)) / SR;
    out[i] = sinp(ph) * Math.exp(-t * 9) * 0.9 + nz[i] * Math.exp(-t * 30) * 0.4;
  }
  return out;
}

// A small stereo reverb, returned as its wet signal: eight combs and four all-passes per side, with the
// right side's delays offset so the tail is wide. Cheap, smooth and seed-free.
export function reverb(L, R, { size = 0.84, damp = 0.25, wet = 0.3 } = {}) {
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((d) => Math.round(d * SR / 44100));
  const alls = [556, 441, 341, 225].map((d) => Math.round(d * SR / 44100));
  const run = (inp, spread) => {
    const n = inp.length, out = new Float32Array(n);
    for (const d0 of combs) {
      const d = d0 + spread, buf = new Float32Array(d);
      let idx = 0, store = 0;
      for (let i = 0; i < n; i++) {
        const y = buf[idx];
        store = y * (1 - damp) + store * damp;
        buf[idx] = inp[i] * 0.015 + store * size;
        out[i] += y;
        if (++idx >= d) idx = 0;
      }
    }
    for (const d0 of alls) {
      const d = d0 + spread, buf = new Float32Array(d);
      let idx = 0;
      for (let i = 0; i < n; i++) {
        const b = buf[idx];
        const y = -out[i] + b;
        buf[idx] = out[i] + b * 0.5;
        out[i] = y;
        if (++idx >= d) idx = 0;
      }
    }
    return out;
  };
  const wl = run(L, 0), wr = run(R, 23);
  for (let i = 0; i < wl.length; i++) { wl[i] *= wet; wr[i] *= wet; }
  return [wl, wr];
}

// ---- played instruments ------------------------------------------------------

const attackOf = (t, a) => Math.min(1, t / a);

// A struck mallet, like a marimba: the note with its bright fourth and tenth
// partials, which die first, and a decay that shortens as the note rises.
export function mallet(freq, dur = 0.7) {
  const n = Math.ceil(dur * SR), out = new Float32Array(n);
  const decay = 5 + freq / 180;
  let p1 = 0, p4 = 0, p10 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    p1 += freq / SR; p4 += (freq * 3.93) / SR; p10 += (freq * 9.8) / SR;
    out[i] = (sinp(p1) + 0.3 * sinp(p4) * Math.exp(-t * 28) + 0.12 * sinp(p10) * Math.exp(-t * 70)) * Math.exp(-t * decay) * attackOf(t, 0.002);
  }
  return out;
}

// A plucked string (a delay line averaging itself), seeded. Brightness is how
// much of each pass is kept unfiltered.
export function pluck(freq, dur = 1.2, seed = 1, bright = 0.5) {
  const n = Math.ceil(dur * SR), out = new Float32Array(n);
  const period = Math.max(2, Math.round(SR / freq));
  const line = noise(period, seed, 0.5, 0.6);
  let idx = 0, prev = 0;
  const keep = 0.996 - (1 - bright) * 0.004;
  for (let i = 0; i < n; i++) {
    const x = line[idx];
    const y = keep * (bright * x + (1 - bright) * 0.5 * (x + prev));
    prev = x;
    line[idx] = y;
    out[i] = x * Math.min(1, (dur - i / SR) / 0.05);
    if (++idx >= period) idx = 0;
  }
  return out;
}

// An electric piano: one sine bending another, bright as the key is struck
// and mellowing as it rings.
export function epiano(freq, dur = 1.8) {
  const n = Math.ceil(dur * SR), out = new Float32Array(n);
  let pc = 0, pm = 0, ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    pc += freq / SR; pm += freq / SR; ph += (freq * 14) / SR;
    const index = 1.8 * Math.exp(-t * 5) + 0.25;
    const tine = 0.06 * sinp(ph) * Math.exp(-t * 40);
    out[i] = (sinp(pc + (index * sinp(pm)) / (2 * Math.PI) * 2) + tine) * Math.exp(-t * 1.4) * attackOf(t, 0.004) * Math.min(1, (dur - t) / 0.15);
  }
  return out;
}

// A synth pluck: a few harmonics of a saw, the upper ones closing first, as
// if a filter swept down. bright sets how long they stay open.
export function synthPluck(freq, dur = 0.35, bright = 1) {
  const n = Math.ceil(dur * SR), out = new Float32Array(n);
  const top = Math.max(1, Math.min(14, Math.floor(7000 / freq)));
  for (let h = 1; h <= top; h++) {
    const inc = (freq * h) / SR, close = 3 + (h * 9) / bright;
    let ph = 0;
    for (let i = 0; i < n; i++) { out[i] += (sinp(ph) / h) * Math.exp((-i / SR) * close); ph += inc; }
  }
  for (let i = 0; i < n; i++) { const t = i / SR; out[i] *= 0.5 * attackOf(t, 0.003) * Math.min(1, (dur - t) / 0.03); }
  return out;
}

// A round pluck bass with enough upper harmonics to carry on a phone.
export function bass(freq, dur = 0.3) {
  const n = Math.ceil(dur * SR), out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += freq / SR;
    const env = attackOf(t, 0.004) * Math.exp(-t * 5) * Math.min(1, (dur - t) / 0.03);
    out[i] = Math.tanh(1.8 * (sinp(ph) + 0.35 * sinp(ph * 2) * Math.exp(-t * 8) + 0.15 * sinp(ph * 3) * Math.exp(-t * 14)) * env) * 0.8;
  }
  return out;
}

// A clap: three quick bursts of band-limited noise and a short tail.
export function clap(seed = 23) {
  const n = Math.ceil(0.3 * SR), out = noise(n, seed, 0.85, 0.4);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const bursts = [0, 0.011, 0.022].reduce((g, s) => g + (t >= s ? Math.exp(-(t - s) * 180) : 0), 0);
    out[i] *= (bursts * 0.7 + Math.exp(-t * 16) * 0.45) * 1.3;
  }
  return out;
}

// A shaker: bright noise that swells in and dies away.
export function shaker(seed = 29) {
  const n = Math.ceil(0.09 * SR), out = noise(n, seed, 0.97);
  for (let i = 0; i < n; i++) { const t = i / SR; out[i] *= attackOf(t, 0.012) * Math.exp(-t * 40) * 0.9; }
  return out;
}
