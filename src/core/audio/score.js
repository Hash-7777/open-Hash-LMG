// The score: original music fitted to a film's own beat grid and scenes.
//
// It reads the scene document: tempo, where each scene starts, what kind of
// scene it is (the compiler names them hook, title, stat ...), and the hits
// the plan asks for. Scene starts land on the beat, so every cut lands with
// the music, and every reveal lands on a drop.
//
// Three designed flavours:
//   pulse      deep and minimal: dark pad, round kick, off-beat sub, soft ticks
//   soft       a brighter key, a half-time kick and a quiet glass arpeggio
//   cinematic  wide slow chords, a low heartbeat, swells and bells, no drums
// and four played grooves with a melody of each film's own (grooves.js):
// bounce, drive, keys and arp.
//
// The arrangement follows the scene kinds: a hook builds, a reveal drops out
// and lands a boom, feature scenes groove, a quote or a calm scene thins out,
// the end card fades to nothing.

import { Bus, SR, pad, kick, sub, tick, hat, snap, boom, swell, bell, whoosh, hit, reverb } from './synth.js';
import { master, integratedLufs } from './master.js';
import { GROOVES, playGroove, grooveSounds, writeMelody } from './grooves.js';

const A2 = 110;
const semi = (k) => A2 * 2 ** (k / 12);

const CHORDS = {
  pulse: [[[0, 7, 12, 14, 15], 0], [[-4, 3, 7, 12, 16], -4], [[-7, 0, 5, 8, 15], -7], [[-5, 2, 7, 10, 14], -5]],
  soft: [[[3, 7, 10, 14, 17], 3], [[0, 3, 7, 10, 14], 0], [[-4, 0, 3, 7, 11], -4], [[-2, 2, 5, 7, 14], -2]],
  cinematic: [[[0, 7, 12, 15, 19], 0], [[-4, 3, 8, 12, 15], -4], [[-9, -2, 3, 7, 12], -9], [[-5, 2, 7, 11, 14], -5]],
};

// The orders a film's four chords can come in.
const ORDERS = [[0, 1, 2, 3], [0, 2, 1, 3], [0, 3, 1, 2]];

const SECTION = {
  hook: 'hook', statement: 'mode', title: 'reveal', logo: 'reveal', stat: 'mode', list: 'mode', steps: 'mode',
  chart: 'mode', quote: 'calm', compare: 'mode', words: 'mode', end: 'end',
};

// The scene kinds and drops the score follows, from the document.
export function scorePlan(doc) {
  const beat = 60 / doc.bpm;
  const sections = doc.scenes.map((S, i) => {
    let kind = SECTION[S.name] || (i === 0 ? 'hook' : i === doc.scenes.length - 1 && doc.scenes.length > 2 ? 'end' : 'mode');
    if (i === 0 && kind === 'mode') kind = 'hook';
    return { t: S.start, kind };
  });
  const drops = [];
  for (const h of doc.sound.hits) if (h.kind === 'boom') drops.push(h.t);
  for (const s of sections) if ((s.kind === 'reveal' || s.kind === 'end') && !drops.some((d) => Math.abs(d - s.t) < beat)) drops.push(s.t);
  drops.sort((a, b) => a - b);
  return { beat, sections, drops };
}

// Builds the soundtrack: the score, with any narration laid over it and the
// music lowered under the voice. Yields to the caller between stages when
// `onStage` is given, so a long film does not freeze the window while it is
// made. voices: [{ t, samples }] with mono 48 kHz samples placed at film time t.
// beds: [{ t, left, right, gain }], stereo 48 kHz sound from imported footage
// and music, already trimmed and faded, laid under the narration with the score.
export async function makeScore(doc, { onStage = null, seed = 1, voices = [], beds = [] } = {}) {
  const flavor = doc.sound.score;
  if (flavor === 'none' && !voices.length && !beds.length) return null;
  const music = flavor !== 'none';
  const { beat, sections, drops } = scorePlan(doc);
  const BAR = beat * 4;
  const len = doc.duration + 1.5;
  const dry = new Bus(len), send = new Bus(len);
  const pump = new Float32Array(dry.n).fill(1);
  // The film's key and chord order, from its direction: the same flavour in
  // another key and another progression is another piece of music.
  const key = Number.isInteger(doc.sound.key) ? doc.sound.key : 0;
  const order = ORDERS[doc.sound.progression] || ORDERS[0];
  const groove = GROOVES[flavor] || null;
  const chords = order.map((k) => (groove?.chords || CHORDS[flavor] || CHORDS.pulse)[k]);
  const tone = (k) => semi(k + key);
  const kindAt = (t) => { let k = sections[0]?.kind || 'mode'; for (const s of sections) if (t >= s.t - 1e-4) k = s.kind; return t > doc.duration ? 'tail' : k; };
  const step = async (name) => { if (onStage) await onStage(name); };
  const duck = (t, depth) => {
    const i0 = Math.round(t * SR), n = Math.round(0.3 * SR);
    for (let i = 0; i < n && i0 + i < pump.length; i++) if (i0 + i >= 0) pump[i0 + i] = Math.min(pump[i0 + i], depth + (1 - depth) * (i / n));
  };

  // The pad: one chord every two bars (cinematic: four), overlapping a little.
  const chordBars = flavor === 'cinematic' ? 4 : 2;
  const nb = Math.ceil(doc.duration / BAR) + 1;
  const padGain = groove ? groove.pad?.gain ?? 0 : 1;
  for (let b = 0; music && padGain && b < nb; b += chordBars) {
    const t0 = b * BAR;
    if (t0 > doc.duration) break;
    const [notes] = chords[Math.floor(b / chordBars) % 4];
    const k = kindAt(t0 + 0.01);
    const g = { hook: 0.55, reveal: 0.75, mode: 0.6, calm: 0.85, end: 0.8 }[k] ?? 0.6;
    notes.forEach((st, j) => {
      const sig = pad(tone(st), chordBars * BAR + 1.0, seed * 31 + b * 7 + j, flavor === 'cinematic' ? { attack: 1.8, release: 2.2, harmonics: 6 } : groove?.pad?.opts || {});
      dry.add(sig, t0 - 0.2, 0.5 * g * padGain, ((j % 2) * 2 - 1) * 0.4);
      send.add(sig, t0 - 0.2, 0.35 * g * padGain, ((j % 2) * 2 - 1) * 0.4);
    });
  }
  await step('pad');

  // The beat grid.
  const nbeats = Math.floor(doc.duration / beat) + 1;
  const firstT = sections[0]?.t || 0;
  const nextChange = (t) => sections.find((s) => s.t > t + 1e-4)?.t ?? doc.duration;
  const K = kick(seed + 3), H = hat(seed + 5), T = tick(seed + 7), N = snap(seed + 9);
  // A groove's own sounds, and the film's own melody from its seed and key.
  const sounds = groove ? grooveSounds(seed) : null;
  const mel = groove ? writeMelody((doc.seed || 7) * 13 + key * 7 + (doc.sound.progression || 0)) : null;
  for (let i = 0; music && i < nbeats; i++) {
    const t = i * beat, k = kindAt(t + 1e-3);
    if (k === 'tail') break;
    // A beat of near silence before each drop, and the two after it left open.
    if (drops.some((d) => t >= d - beat - 1e-3 && t < d) || drops.some((d) => t >= d && t < d + beat * 2 - 1e-3)) continue;
    const barBeat = i % 4;
    const root = tone(chords[Math.floor(t / BAR / chordBars) % 4][1]) / 2;
    if (groove) {
      const build = (t - firstT) / Math.max(1e-6, nextChange(t) - firstT);
      playGroove(flavor, { i, t, beat, barBeat, k, build, notes: chords[Math.floor(t / BAR / chordBars) % 4][0], root, tone, dry, send, duck, mel, seed, sounds });
      continue;
    }
    if (flavor === 'cinematic') {
      if (k === 'calm' || k === 'end') { if (barBeat === 0) dry.add(sub(root, 0.6), t, 0.3); continue; }
      // A low heartbeat: two soft pulses each bar.
      if (barBeat === 0 || barBeat === 1) { dry.add(sub(root, 0.4), t + (barBeat ? -beat * 0.6 : 0), barBeat ? 0.28 : 0.4); }
      if (barBeat === 2) dry.add(T, t, 0.04, 0.3);
      continue;
    }
    if (k === 'hook') {
      const build = (t - firstT) / Math.max(1e-6, nextChange(t) - firstT);
      dry.add(K, t, 0.5 + 0.3 * build); duck(t, 0.45);
      if (build > 0.4) dry.add(sub(root), t + beat / 2, 0.45);
      for (let s4 = 0; s4 < 4; s4++) dry.add(T, t + (s4 * beat) / 4, (s4 ? 0.05 : 0.08) * (0.4 + build), s4 % 2 ? 0.3 : -0.3);
    } else if (k === 'mode' && flavor === 'soft') {
      if (barBeat === 0 || barBeat === 2) { dry.add(K, t, 0.5); duck(t, 0.55); }
      dry.add(sub(root), t + beat / 2, 0.38);
      dry.add(H, t + beat / 2, 0.035, 0.25);
      const [notes] = chords[Math.floor(t / BAR / chordBars) % 4];
      for (let h2 = 0; h2 < 2; h2++) {
        const f = tone(notes[(i * 2 + h2) % notes.length]) * 4;
        const sig = bell(f, 1.2);
        dry.add(sig, t + (h2 * beat) / 2, 0.02, h2 ? 0.4 : -0.4);
        send.add(sig, t + (h2 * beat) / 2, 0.03, h2 ? 0.4 : -0.4);
      }
    } else if (k === 'mode') {
      dry.add(K, t, 0.85); duck(t, 0.35);
      dry.add(sub(root), t + beat / 2, 0.6);
      if (barBeat === 1 || barBeat === 3) { dry.add(N, t, 0.12); send.add(N, t, 0.1); }
      dry.add(H, t + beat / 2, 0.06, 0.25);
      for (let s4 = 0; s4 < 4; s4++) dry.add(T, t + (s4 * beat) / 4, s4 ? 0.045 : 0.06, s4 % 2 ? 0.35 : -0.35);
    } else if (k === 'calm') {
      dry.add(K, t, 0.5);
      if (barBeat === 0) dry.add(sub(root, 0.6), t + beat / 2, 0.35);
    } else if (k === 'reveal') {
      if (barBeat === 0) dry.add(sub(root, 0.5), t, 0.4);
      dry.add(T, t + beat / 2, 0.04);
    } else if (k === 'end') {
      if (barBeat === 0) dry.add(K, t, 0.4);
    }
  }
  await step('beat');

  // Swells into each drop, a boom on it, and a three-note bell answer.
  for (const d of music ? drops : []) {
    dry.add(swell(2 * beat, seed + 13), d - 2 * beat - beat * 0.05, 0.22);
    send.add(swell(2 * beat, seed + 13), d - 2 * beat - beat * 0.05, 0.15);
    dry.add(boom(seed + 11), d, 0.95);
    send.add(boom(seed + 11), d, 0.3);
    [[0, 880], [beat * 0.75, 1318.5], [beat * 1.5, 1046.5]].forEach(([dt, f]) => {
      for (let echo = 0; echo < 4; echo++) {
        const sig = bell(f);
        const pan = echo ? (echo % 2 ? -0.5 : 0.5) : 0;
        dry.add(sig, d + beat + dt + echo * beat * 0.75, 0.07 * 0.45 ** echo, pan);
        send.add(sig, d + beat + dt + echo * beat * 0.75, 0.05 * 0.45 ** echo, pan);
      }
    });
  }
  // The plan's own hits, and a soft air movement on every moving transition.
  for (const h of music ? doc.sound.hits : []) {
    if (h.kind === 'boom') continue;
    const g = h.gain;
    if (h.kind === 'hit') dry.add(hit(seed + 19), h.t, 0.5 * g);
    else if (h.kind === 'swell') dry.add(swell(2 * beat, seed + 21), h.t - 2 * beat, 0.25 * g);
    else if (h.kind === 'tick') dry.add(T, h.t, 0.12 * g);
    else if (h.kind === 'chime') { dry.add(bell(1318.5, 1.6), h.t, 0.06 * g); dry.add(bell(1760, 1.6), h.t + 0.12, 0.05 * g); }
    else if (h.kind === 'whoosh') dry.add(whoosh(0.45, seed + 23), h.t - 0.2, 0.22 * g);
  }
  if (music && doc.sound.sync) {
    for (const S of doc.scenes.slice(1)) {
      const tr = S.transition;
      if (['push', 'slide', 'zoom', 'wipe'].includes(tr.kind)) dry.add(whoosh(Math.max(0.25, tr.duration + 0.15), seed + S.start * 10), S.start - 0.05, 0.16);
    }
  }
  await step('hits');

  // Pump the bed under the kick, add the room, fade the end, trim the rumble.
  for (let i = 0; i < dry.n; i++) { dry.L[i] *= pump[i]; dry.R[i] *= pump[i]; }
  const [wl, wr] = reverb(send.L, send.R, { size: flavor === 'cinematic' ? 0.88 : 0.84, wet: 1 });
  for (let i = 0; i < dry.n; i++) { dry.L[i] += wl[i] * 0.6; dry.R[i] += wr[i] * 0.6; }
  await step('room');
  const fadeFrom = Math.max(0, doc.duration - 2 * BAR);
  for (let i = 0; i < dry.n; i++) {
    const t = i / SR;
    const g = t < fadeFrom ? 1 : Math.max(0, 1 - (t - fadeFrom) / (len - fadeFrom));
    dry.L[i] *= g; dry.R[i] *= g;
  }
  // A one-pole high-pass near 30 Hz: nothing plays below it, and it would only
  // drive the limiter with sound nobody hears.
  const hpA = Math.exp((-2 * Math.PI * 30) / SR);
  for (const x of [dry.L, dry.R]) {
    let px = 0, py = 0;
    for (let i = 0; i < x.length; i++) { const y = hpA * (py + x[i] - px); px = x[i]; py = y; x[i] = y; }
  }
  // Footage sound and music, as they were cut.
  for (const b of beds) {
    const i0 = Math.round(b.t * SR);
    for (let i = 0; i < b.left.length && i0 + i < dry.n; i++) {
      if (i0 + i < 0) continue;
      dry.L[i0 + i] += b.left[i] * b.gain;
      dry.R[i0 + i] += b.right[i] * b.gain;
    }
  }
  if (beds.length) await step('beds');
  // Narration: the music is brought to a bed level, each line to a speaking
  // level, and the music is lowered under every line (eased in and out over a
  // third of a second) so the voice is clear without the music dropping out.
  if (voices.length) {
    if (music || beds.length) {
      const ml = integratedLufs(dry.L, dry.R);
      if (Number.isFinite(ml)) { const g = 10 ** ((-21 - ml) / 20); for (let i = 0; i < dry.n; i++) { dry.L[i] *= g; dry.R[i] *= g; } }
      const duckGain = 10 ** (-(doc.voice?.duck ?? 8) / 20);
      const target = new Float32Array(dry.n).fill(1);
      for (const v of voices) {
        const a = Math.max(0, Math.round((v.t - 0.15) * SR)), b = Math.min(dry.n, Math.round((v.t + v.samples.length / SR + 0.3) * SR));
        for (let i = a; i < b; i++) target[i] = duckGain;
      }
      const k = 1 - Math.exp(-1 / (0.11 * SR));
      let gf = 1;
      const gain = new Float32Array(dry.n);
      for (let i = 0; i < dry.n; i++) { gf += (target[i] - gf) * k; gain[i] = gf; }
      let gb = 1;
      for (let i = dry.n - 1; i >= 0; i--) { gb += (target[i] - gb) * k; gain[i] = Math.min(gain[i], gb); }
      for (let i = 0; i < dry.n; i++) { dry.L[i] *= gain[i]; dry.R[i] *= gain[i]; }
    }
    for (const v of voices) {
      const vl = integratedLufs(v.samples, v.samples);
      const g = Number.isFinite(vl) ? 10 ** ((-17 - vl) / 20) : 1;
      dry.add(v.samples, v.t, g, 0);
    }
  }
  // The master lands at -14 LUFS; the plan's volume lowers that target.
  const vol = doc.sound.volume;
  const target = -14 + 20 * Math.log10(Math.max(0.05, vol));
  const measured = master(dry.L, dry.R, { target: Math.min(-14, target), ceiling: -1 });
  await step('master');
  // Trim to the film's own length.
  const n = Math.ceil(doc.duration * SR);
  return { left: dry.L.slice(0, n), right: dry.R.slice(0, n), sampleRate: SR, ...measured };
}
