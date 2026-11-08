// The release score: one calm, bright piece for a product film narrated over
// its whole length, and the mix that keeps every word of the voice clear.
//
// Everything is built from pure tones: no detuned voices beating against each
// other, no noise risers, no tremolo, no booms. One progression (I maj9, vi 11,
// IV maj9, V sus, two bars each) carries the film, and the product's motif,
// a few notes over the tonic, opens every quiet stretch and blooms on every
// hit, so the film has one tune of its own. The rhythm sits low (a soft kick,
// a sub, a plucked bass) and the sparkle high (an arpeggio two octaves up);
// the middle, where a voice lives, is left to the voice.
//
// Sections (sound.release.sections, [t, kind]):
//   still  a slow pad and a soft piano chord at each change; the motif at its start
//   move   adds the sub, the arpeggio, a kick on every beat with a tick off it,
//          and a plucked bass on eighths
//   lift   the arpeggio doubles, a clap on two and four, ticks on sixteenths
//   out    the pad and the motif, resolving
// Each hit (sound.release.hits) gets a swell of the pad and a chord that blooms
// with the motif an octave up.
//
// The mix: every voice line is brought to a speaking level and the music to a
// bed under it; the music dips by `duck` dB under each line, eased over a third
// of a second, and the voice's own band (700 Hz to 4.5 kHz) is carved a further
// `carve` dB out of it; a soft click sits on each pointer click and light ticks
// under typing; the master lands at -14 LUFS with true peaks under -1 dBTP.

import { Bus, SR, sinp, reverb } from './synth.js';
import { master, integratedLufs } from './master.js';
import { bandZeroPhase, filter } from './filters.js';
import { rand } from '../engine/math.js';

export const RELEASE_KINDS = ['still', 'move', 'lift', 'out'];
export const CUE_KINDS = ['click', 'type'];
const PROG = [[[0, 4, 7, 11, 14], 0], [[-3, 0, 4, 7, 14], -3], [[-7, -3, 0, 4, 9], -7], [[-5, -1, 2, 4, 9], -5]];
export const RELEASE_DEFAULTS = { motif: [4, 7, 11, 9], bright: true, duck: 11, carve: 6, music: 0 };
const BED_LUFS = -13.2, VOICE_LUFS = -16;

// ---- the score's own instruments, as plain arithmetic ------------------------

const env = (n, a, r) => {
  const e = new Float32Array(n).fill(1), na = Math.min(n, Math.round(a * SR)), nr = Math.min(n, Math.round(r * SR));
  for (let i = 0; i < na; i++) e[i] = (i / na) ** 2;
  for (let i = 0; i < nr; i++) e[n - nr + i] *= (1 - i / nr) ** 2;
  return e;
};
function tone(n, parts, shape) {
  const out = new Float32Array(n);
  for (const [f, a, decay] of parts) {
    if (f >= 9000) continue;
    const inc = f / SR, m = decay ? Math.exp(-decay / SR) : 1;
    let ph = 0, g = a;
    for (let i = 0; i < n; i++) { out[i] += g * sinp(ph); ph += inc; g *= m; }
  }
  const e = shape;
  for (let i = 0; i < n; i++) out[i] *= e[i];
  return out;
}
export function piano(f, vel = 0.5, dur = 3.5, att = 0.006) {
  const n = Math.ceil(dur * SR), k = 0.7 + f / 1200;
  const out = tone(n, [[f, 1, 1.4 * k], [2 * f, 0.42, 2.4 * k], [3 * f, 0.16, 3.6 * k], [4 * f, 0.06, 5 * k]], env(n, att, 0.4));
  for (let i = 0; i < n; i++) out[i] *= vel * 0.32;
  return out;
}
const padTone = (f, dur, bright = 0.3) => { const n = Math.ceil(dur * SR); const o = tone(n, [[f, 1, 0], [2 * f, 0.28, 0], [3 * f, bright * 0.12, 0]], env(n, Math.min(1.4, dur * 0.4), Math.min(1.6, dur * 0.4))); for (let i = 0; i < n; i++) o[i] *= 0.06; return o; };
const subTone = (f, dur) => { const n = Math.ceil(dur * SR); const o = tone(n, [[f, 1, 0]], env(n, 0.05, 0.4)); for (let i = 0; i < n; i++) o[i] *= 0.22; return o; };
function kickTone(g = 1) {
  const n = Math.ceil(0.42 * SR), out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR; ph += (45 + 75 * Math.exp(-t * 28)) / SR; out[i] = sinp(ph) * Math.exp(-t * 9) * 0.5 * g; }
  return out;
}
function clapTone(seed = 31) {
  const n = Math.ceil(0.16 * SR), r = rand(seed);
  const x = filter(Float32Array.from({ length: n }, () => r() * 2 - 1), 'band', 2400, 0.9);
  let peak = 1e-9; for (const v of x) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let e = 0;
    for (const d of [0, 0.009, 0.018]) if (t >= d) e += Math.exp(-(t - d) * (d < 0.018 ? 90 : 26));
    x[i] = (x[i] / peak) * e * 0.05;
  }
  return x;
}
const pluckTone = (f, dur = 0.32) => { const n = Math.ceil(dur * SR); const o = tone(n, [[f, 1, 9], [2 * f, 0.35, 27]], env(n, 0.004, 0.05)); for (let i = 0; i < n; i++) o[i] *= 0.16; return o; };
const tickTone = () => tone(Math.ceil(0.02 * SR), [[7800, 0.05, 260]], new Float32Array(Math.ceil(0.02 * SR)).fill(1));

// ---- the score ----------------------------------------------------------------

// Builds the score alone, a stereo pair as long as the film plus a tail.
export function releaseScore(doc) {
  const R = { ...RELEASE_DEFAULTS, ...(doc.sound.release || {}) };
  const beat = 60 / doc.bpm, bar = 4 * beat;
  const dur = doc.duration;
  const tonic = 220 * 2 ** ((doc.sound.key || 0) / 12);
  const semi = (k) => tonic * 2 ** (k / 12);
  const secs = [...(R.sections?.length ? R.sections : [[0, 'move']])].sort((a, b) => a[0] - b[0]).concat([[dur + 4, 'tail']]);
  const kindAt = (t) => { let k = secs[0][1]; for (const [s, kk] of secs) if (t >= s) k = kk; return k; };
  const dry = new Bus(dur + 4), wet = new Bus(dur + 4);
  // Constant-power pan, and a share of each sound sent to the room (a bus's
  // pan of -1 or 1 writes one side only).
  const add = (sig, t, g = 1, pan = 0, w = 0.3) => {
    const l = g * Math.sqrt(0.5 * (1 - pan)), r = g * Math.sqrt(0.5 * (1 + pan));
    dry.add(sig, t, l * (1 - w), -1); dry.add(sig, t, r * (1 - w), 1);
    wet.add(sig, t, l * w, -1); wet.add(sig, t, r * w, 1);
  };
  for (let b = 0; b * 2 * bar <= dur + 2 * bar; b++) {
    const t0 = b * 2 * bar, k = kindAt(t0 + 1e-3);
    if (k === 'tail') break;
    const [tones, root] = PROG[b % 4];
    const bright = { still: 0.2, move: 0.35, lift: 0.6, out: 0.15 }[k] ?? 0.3;
    for (const st of tones.slice(1)) add(padTone(semi(st), 2 * bar + 1.6, bright), t0 - 0.2, 1, 0.3 * Math.sin(st), 0.55);
    add(piano(semi(root), 0.42, 4), t0, 1, -0.1, 0.4);
    for (const st of tones.slice(1, 3)) add(piano(semi(st), 0.26, 4), t0 + 0.03, 1, 0.15, 0.45);
    if (k === 'move' || k === 'lift') {
      add(subTone(semi(root - 24), 2 * bar), t0, 1, 0, 0.05);
      const arp = [tones[1], tones[2], tones[3], tones[4], tones[3], tones[2]];
      const step = k === 'move' ? beat / 2 : beat / 4;
      for (let e = 0; e < Math.round((2 * bar) / step); e++) {
        const v = (k === 'move' ? 0.16 : 0.12) * (e % 4 === 0 ? 1.15 : 1);
        add(piano(semi(arp[e % arp.length] + 24), v, 1.2), t0 + e * step, 1, 0.45 * Math.sin(e), 0.5);
      }
    }
  }
  const K = [kickTone(0.8), kickTone(0.55), kickTone(0.9), kickTone(0.6)], T = tickTone(), C = clapTone();
  for (let i = 0; i * beat <= dur + beat; i++) {
    const t = i * beat, k = kindAt(t + 1e-4), bb = i % 4, on = bb === 0 || bb === 2;
    if (k === 'move' && (on || R.bright)) {
      add(K[on ? 0 : 1], t, 1, 0, 0.05);
      if (R.bright) add(T, t + beat / 2, 1, 0.35, 0.2);
    }
    if (k === 'lift') {
      add(K[on ? 2 : 3], t, 1, 0, 0.05);
      add(T, t + beat / 2, 1, 0.35, 0.2);
      if (R.bright) {
        if (bb === 1 || bb === 3) add(C, t, 1, -0.1, 0.35);
        for (const q of [1, 3]) add(T, t + (q * beat) / 4, 0.6, -0.35, 0.2);
      }
    }
    if (R.bright && (k === 'move' || k === 'lift')) {
      const root = PROG[Math.floor(t / (2 * bar)) % 4][1];
      add(pluckTone(semi(root - 12)), t, 1, 0, 0.08);
      add(pluckTone(semi(root)), t + beat / 2, 1, 0, 0.08);
    }
  }
  for (const [s, kk] of secs) {
    if ((kk === 'still' || kk === 'out') && s < dur) R.motif.forEach((m, j) => add(piano(semi(m + 12), 0.4, 4), s + 0.2 + j * beat * 0.75, 1, -0.15 + 0.15 * j, 0.55));
  }
  for (const h of R.hits || []) {
    for (const st of [0, 7, 16]) {
      const sw = padTone(semi(st), 1.6, 0.4);
      for (let i = 0; i < sw.length; i++) sw[i] *= (i / sw.length) ** 2 * 2.2;
      add(sw, h - 1.6, 1, 0, 0.6);
    }
    for (const st of [-12, 0, 7, 11, 16]) add(piano(semi(st), 0.45, 5), h, 1, (0.1 * st) / 16, 0.5);
    R.motif.forEach((m, j) => add(piano(semi(m + 24), 0.32, 4), h + 0.35 + j * beat * 0.5, 1, 0.2, 0.6));
  }
  // The room: a wide hall on a send kept between 220 Hz and 4.5 kHz.
  const sl = filter(filter(wet.L, 'high', 220), 'low', 4500), sr = filter(filter(wet.R, 'high', 220), 'low', 4500);
  const [hl, hr] = reverb(sl, sr, { size: 0.88, damp: 0.3, wet: 1 });
  const L = dry.L, Rr = dry.R;
  for (let i = 0; i < L.length; i++) { L[i] += hl[i] * 0.6 + sl[i] * 0.25; Rr[i] += hr[i] * 0.6 + sr[i] * 0.25; }
  // Fade after the film, then a soft limit.
  let peak = 1e-9;
  for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(Rr[i]));
  for (let i = 0; i < L.length; i++) {
    const f = Math.min(1, Math.max(0, 1 - (i / SR - dur) / 3.5));
    L[i] = Math.tanh((L[i] / peak) * 1.2) * 0.85 * f;
    Rr[i] = Math.tanh((Rr[i] / peak) * 1.2) * 0.85 * f;
  }
  return { left: L, right: Rr };
}

// ---- the mix --------------------------------------------------------------------

// How far the music is lowered at each sample: 1 between lines, eased down
// over a third of a second around each line (from a quarter second before it
// to half a second after). Returns the share of the dip (0..1) per sample.
export function duckShape(n, voices) {
  const mask = new Float32Array(n);
  for (const v of voices) {
    const a = Math.max(0, Math.round((v.t - 0.25) * SR)), b = Math.min(n, Math.round((v.t + v.samples.length / SR + 0.5) * SR));
    for (let i = a; i < b; i++) mask[i] = 1;
  }
  const k = Math.round(0.33 * SR), out = new Float32Array(n);
  let acc = 0;
  for (let i = 0; i < n + k; i++) {
    if (i < n) acc += mask[i];
    if (i - k >= 0) acc -= mask[i - k];
    const j = i - (k >> 1);
    if (j >= 0 && j < n) out[j] = acc / k;
  }
  return out;
}

const clickTone = (r) => { const n = Math.ceil(0.05 * SR); const o = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / SR; o[i] = Math.sin(2 * Math.PI * 1900 * t) * Math.exp(-t * 260) + 0.5 * Math.sin(2 * Math.PI * 900 * t) * Math.exp(-t * 180); } const nz = filter(Float32Array.from({ length: n }, () => r() * 2 - 1), 'high', 3000); for (let i = 0; i < n; i++) o[i] += nz[i] * Math.exp((-i / SR) * 400) * 0.3; return o; };
const keyTone = (r) => { const n = Math.ceil(0.025 * SR); const o = filter(filter(Float32Array.from({ length: n }, () => r() * 2 - 1), 'high', 2500), 'low', 9000); for (let i = 0; i < n; i++) o[i] *= Math.exp((-i / SR) * 380); return o; };

// The whole soundtrack of a release film: the score under the voices, with the
// cues, mastered. voices: [{ t, samples }] mono at 48 kHz. Returns what
// makeScore returns, plus the dip applied to the music, for the checks.
export async function makeRelease(doc, { voices = [], onStage = null } = {}) {
  const R = { ...RELEASE_DEFAULTS, ...(doc.sound.release || {}) };
  const step = async (name) => { if (onStage) await onStage(name); };
  const music = releaseScore(doc);
  await step('score');
  const n = Math.ceil((doc.duration + 0.5) * SR);
  const L = new Float32Array(n), Rr = new Float32Array(n);
  L.set(music.left.subarray(0, n)); Rr.set(music.right.subarray(0, n));
  const ml = integratedLufs(L, Rr);
  const bed = Number.isFinite(ml) ? 10 ** ((BED_LUFS + R.music - ml) / 20) : 1;
  for (let i = 0; i < n; i++) { L[i] *= bed; Rr[i] *= bed; }
  const duck = duckShape(n, voices);
  if (R.carve > 0 && voices.length) {
    const bl = bandZeroPhase(L, 700, 4500), br = bandZeroPhase(Rr, 700, 4500), c = 1 - 10 ** (-R.carve / 20);
    for (let i = 0; i < n; i++) { L[i] -= bl[i] * duck[i] * c; Rr[i] -= br[i] * duck[i] * c; }
  }
  const dip = 1 - 10 ** (-R.duck / 20);
  for (let i = 0; i < n; i++) { const g = 1 - duck[i] * dip; L[i] *= g; Rr[i] *= g; }
  await step('duck');
  const out = new Bus(n / SR);
  out.L.set(L); out.R.set(Rr);
  for (const v of voices) {
    const vl = integratedLufs(v.samples, v.samples);
    out.add(v.samples, v.t, Number.isFinite(vl) ? 10 ** ((VOICE_LUFS - vl) / 20) : 1, 0);
  }
  const r = rand(3);
  for (const [t, kind, len] of R.cues || []) {
    if (kind === 'click') out.add(clickTone(r), t, 0.22);
    else if (kind === 'type') for (let u = t; u < t + (len || 0); u += 0.07 + r() * 0.05) out.add(keyTone(r), u, 0.05, (r() - 0.5) * 0.4);
  }
  await step('cues');
  const measured = master(out.L, out.R, { target: -14, ceiling: -1 });
  await step('master');
  const len = Math.ceil(doc.duration * SR);
  return { left: out.L.slice(0, len), right: out.R.slice(0, len), sampleRate: SR, ...measured, duck: duck.slice(0, len), duckDb: R.duck };
}

// The release score's settings as the scene format keeps them.
export function normalizeRelease(input, duration) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const n = (v, d, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v * 1e4) / 1e4)) : d);
  const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
  const motif = list(input.motif, 6).map((m) => Math.round(n(m, 0, -12, 24)));
  return {
    motif: motif.length >= 2 ? motif : [...RELEASE_DEFAULTS.motif],
    bright: input.bright === undefined ? true : Boolean(input.bright),
    sections: list(input.sections, 100).filter((s) => Array.isArray(s) && RELEASE_KINDS.includes(s[1])).map(([t, k]) => [n(t, 0, 0, duration), k]).sort((a, b) => a[0] - b[0]),
    hits: list(input.hits, 50).map((t) => n(t, 0, 0, duration)).sort((a, b) => a - b),
    cues: list(input.cues, 400).filter((c) => Array.isArray(c) && CUE_KINDS.includes(c[1])).map(([t, k, l]) => (k === 'type' ? [n(t, 0, 0, duration), k, n(l, 0, 0, 30)] : [n(t, 0, 0, duration), k])).sort((a, b) => a[0] - b[0]),
    duck: n(input.duck, RELEASE_DEFAULTS.duck, 0, 24),
    carve: n(input.carve, RELEASE_DEFAULTS.carve, 0, 24),
    music: n(input.music, RELEASE_DEFAULTS.music, -24, 6),
  };
}
