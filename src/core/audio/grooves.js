// Grooves: scores that are played, not only designed. Each has its own chords,
// its own instruments and its own drum pattern, and every film gets a melody
// of its own, written from a seed: a two-bar rhythm walking through the tones
// of each chord, answered a step higher, resolving home. Two films in the same
// groove share a sound, never a tune.
//
//   bounce  playful, major: mallet melody, clap on two and four, shaker, a
//           bass that hops between root and octave
//   drive   energetic, minor: four on the floor, open hats, a rolling bass,
//           a synth-pluck melody
//   keys    calm and warm: electric-piano chords pushed off the beat, a
//           brushed shaker, a round bass, a soft melody on the piano
//   arp     technical, minor: a sixteenth-note arpeggio opening bar by bar,
//           tight kick and hats, a low held bass, bells for the melody
//
// score.js lays the pad (or none), the drops and the hits; a groove plays the
// beat grid through play(ctx), called once a beat.

import { rand } from '../engine/math.js';
import { kick, sub, hat, tick, bell, mallet, pluck, epiano, synthPluck, bass, clap, shaker } from './synth.js';

// Chords as [notes, bass root] in semitones from the film's key.
export const GROOVES = {
  bounce: {
    chords: [[[0, 4, 7, 12, 16], 0], [[-5, 2, 7, 11, 14], -5], [[-3, 4, 9, 12, 16], -3], [[-7, 0, 5, 9, 12], -7]],
    pad: { gain: 0.3, opts: { harmonics: 3, attack: 0.25, release: 0.8 } },
  },
  drive: {
    chords: [[[0, 3, 7, 12, 15], 0], [[-4, 0, 3, 8, 12], -4], [[3, 7, 10, 15, 19], 3], [[-2, 2, 5, 10, 14], -2]],
    pad: { gain: 0.45, opts: { harmonics: 6, attack: 0.6 } },
  },
  keys: {
    chords: [[[0, 4, 7, 11, 14], 0], [[-3, 4, 7, 9, 12], -3], [[-7, 4, 5, 9, 12], -7], [[-5, 2, 5, 7, 11], -5]],
    pad: null,
  },
  arp: {
    chords: [[[0, 3, 7, 10, 14], 0], [[-4, 0, 3, 7, 10], -4], [[-7, -2, 3, 5, 12], -7], [[-5, 2, 5, 7, 14], -5]],
    pad: { gain: 0.35, opts: { harmonics: 4, attack: 1.2 } },
  },
};

// Two-bar rhythms, in sixteenth steps of 32.
const RHYTHMS = [
  [0, 3, 6, 8, 12, 16, 19, 22, 24, 28],
  [0, 2, 4, 8, 10, 12, 16, 20, 22, 24, 26],
  [0, 4, 6, 10, 12, 16, 20, 22, 26, 28],
  [0, 3, 4, 8, 11, 12, 16, 19, 20, 24],
  [2, 4, 6, 10, 14, 18, 20, 22, 26, 30],
  [0, 6, 8, 12, 14, 16, 22, 24, 28],
];

// A film's melody: { at: Map(step -> { idx, len }) } over 64 steps (four
// bars), idx being a place among the current chord's tones.
export function writeMelody(seed) {
  const r = rand(seed);
  const rhythm = RHYTHMS[Math.floor(r() * RHYTHMS.length)];
  let idx = 1 + Math.floor(r() * 3);
  const phrase = rhythm.map((step, k) => {
    if (k) {
      const move = r();
      idx += move < 0.4 ? 1 : move < 0.8 ? -1 : move < 0.9 ? 2 : -2;
      idx = Math.max(0, Math.min(5, idx));
    }
    const next = rhythm[k + 1] ?? 32;
    return { step, idx, len: Math.min(4, next - step) };
  });
  // Ends on the chord's root, so the phrase lands.
  phrase[phrase.length - 1].idx = 0;
  const at = new Map();
  for (const n of phrase) at.set(n.step, n);
  // The answer: the same rhythm a step higher, ending a third above home.
  phrase.forEach((n, k) => at.set(32 + n.step, { ...n, idx: k === phrase.length - 1 ? 1 : Math.min(6, n.idx + 1) }));
  return { at };
}

// The note at a place among a chord's tones, an octave up past the top.
const toneAt = (notes, idx) => notes[idx % notes.length] + 12 * Math.floor(idx / notes.length);

// Plays the melody's notes that fall in this beat. voice(freq, seconds) -> samples.
function melody(ctx, voice, gain, octave = 4, only = null) {
  const { i, t, beat, notes, tone, dry, send, mel } = ctx;
  for (let s = 0; s < 4; s++) {
    const n = mel.at.get((i * 4 + s) % 64);
    if (!n || (only && !only(n))) continue;
    const f = tone(toneAt(notes, n.idx)) * octave;
    const sig = voice(f, Math.max(0.25, (n.len * beat) / 4 + 0.3));
    const pan = ((n.idx % 3) - 1) * 0.25;
    dry.add(sig, t + (s * beat) / 4, gain, pan);
    send.add(sig, t + (s * beat) / 4, gain * 0.6, pan);
  }
}

// ctx: { i, t, beat, barBeat, k, build, notes, root, tone, dry, send, duck, mel, seed, K, H, T }
export function playGroove(name, ctx) {
  const { i, t, beat, barBeat, k, build, notes, root, tone, dry, send, duck, seed } = ctx;
  const S = ctx.sounds;
  const odd = barBeat === 1 || barBeat === 3;
  if (name === 'bounce') {
    if (k === 'calm' || k === 'end') {
      if (barBeat === 0) notes.slice(1, 4).forEach((st, j) => dry.add(mallet(tone(st) * 2, 1.2), t + j * 0.03, 0.12));
      if (k === 'calm') melody(ctx, (f, d) => mallet(f, d), 0.1, 4, (n) => n.step % 8 === 0);
      return;
    }
    if (k === 'reveal') { if (barBeat === 0) dry.add(bass(root, 0.5), t, 0.5); melody(ctx, (f, d) => mallet(f, d), 0.12); return; }
    const full = k !== 'hook' || build > 0.5;
    if (barBeat === 0 || barBeat === 2 || (barBeat === 3 && full)) { dry.add(S.K, t + (barBeat === 3 ? beat / 2 : 0), 0.6); duck(t, 0.55); }
    if (odd && full) { dry.add(S.clap, t, 0.32, 0.1); send.add(S.clap, t, 0.2); }
    for (let h = 0; h < 2; h++) dry.add(S.shaker, t + (h * beat) / 2, h ? 0.1 : 0.06, h ? 0.35 : -0.35);
    if (full) {
      const hop = [root, root * 2, root * 1.5, root * 2][barBeat];
      dry.add(bass(hop, beat * 0.45), t + (barBeat % 2 ? beat / 2 : 0), 0.5);
    }
    melody(ctx, (f, d) => mallet(f, d), k === 'hook' ? 0.16 + 0.12 * build : 0.32);
    return;
  }
  if (name === 'drive') {
    if (k === 'calm' || k === 'end') { if (barBeat === 0) dry.add(sub(root, 0.8), t, 0.35); if (k === 'calm') dry.add(S.H, t + beat / 2, 0.03); return; }
    if (k === 'reveal') { if (barBeat === 0) dry.add(sub(root, 0.6), t, 0.5); melody(ctx, (f, d) => synthPluck(f, d, 1.4), 0.1); return; }
    const full = k !== 'hook' || build > 0.35;
    dry.add(S.K, t, 0.75); duck(t, 0.35);
    if (full) {
      dry.add(S.H, t + beat / 2, 0.09, 0.2);
      if (odd) { dry.add(S.clap, t, 0.3); send.add(S.clap, t, 0.18); }
      for (let s4 = 0; s4 < 4; s4++) {
        const f = s4 === 2 ? root * 2 : root;
        dry.add(bass(f, beat * 0.22), t + (s4 * beat) / 4, s4 ? 0.22 : 0.3);
      }
    } else {
      for (let s4 = 0; s4 < 4; s4++) dry.add(S.T, t + (s4 * beat) / 4, 0.04 + 0.05 * build, s4 % 2 ? 0.3 : -0.3);
    }
    melody(ctx, (f, d) => synthPluck(f, d, 1.2), k === 'hook' ? 0.14 + 0.2 * build : 0.36, 4, full ? null : (n) => n.step % 4 === 0);
    return;
  }
  if (name === 'keys') {
    // Chords pushed: struck on one and on the and of two.
    const comp = barBeat === 0 ? 0 : barBeat === 1 ? beat / 2 : -1;
    if (comp >= 0 && k !== 'end') notes.slice(0, 4).forEach((st, j) => { const sig = epiano(tone(st) * 2, 2.2); dry.add(sig, t + comp + j * 0.012, k === 'calm' ? 0.07 : 0.09, (j - 1.5) * 0.2); send.add(sig, t + comp, 0.05); });
    if (k === 'end') { if (barBeat === 0) notes.slice(0, 4).forEach((st, j) => dry.add(epiano(tone(st) * 2, 3), t + j * 0.05, 0.08)); return; }
    if (barBeat === 0) dry.add(bass(root, beat * 1.6), t, 0.45);
    if (barBeat === 2 && k !== 'calm') dry.add(bass(root * 1.5, beat * 0.9), t + beat / 2, 0.3);
    if (k === 'mode' || (k === 'hook' && build > 0.5)) {
      if (barBeat === 0) { dry.add(S.K, t, 0.45); duck(t, 0.7); }
      if (barBeat === 2) dry.add(S.snapSoft, t, 0.05);
      for (let h = 0; h < 2; h++) dry.add(S.shaker, t + (h * beat) / 2, 0.035, h ? 0.3 : -0.3);
    }
    melody(ctx, (f, d) => epiano(f, d + 0.6), k === 'calm' ? 0.07 : 0.1, 4, k === 'calm' || k === 'hook' ? (n) => n.step % 4 === 0 : null);
    return;
  }
  if (name === 'arp') {
    // Sixteenths up and down the chord, opening over each bar.
    const open = 0.5 + ((i % 4) / 4) * 1.4;
    if (k !== 'end' && k !== 'reveal') {
      for (let s4 = 0; s4 < 4; s4++) {
        const step = i * 4 + s4;
        const up = [0, 1, 2, 3, 4, 3, 2, 1][step % 8];
        dry.add(synthPluck(tone(notes[up]) * 2, beat * 0.3, open), t + (s4 * beat) / 4, k === 'calm' ? 0.1 : 0.16, (s4 % 2 ? 0.3 : -0.3));
      }
    }
    if (barBeat === 0) dry.add(sub(root, beat * 3.5), t, 0.4);
    if (k === 'mode' || (k === 'hook' && build > 0.5)) {
      if (barBeat === 0 || barBeat === 2 || (barBeat === 1 && rand(seed + i)() < 0.3)) { dry.add(S.K, t + (barBeat === 1 ? beat * 0.75 : 0), 0.7); duck(t, 0.45); }
      for (let s4 = 0; s4 < 4; s4 += 2) dry.add(S.H, t + (s4 * beat) / 4 + beat / 4, 0.03, s4 ? 0.3 : -0.3);
      if (odd) dry.add(S.clap, t, 0.14);
    }
    if (k === 'end' && barBeat === 0) dry.add(bell(tone(notes[0]) * 4, 3), t, 0.06);
    melody(ctx, (f) => bell(f, 1.6), 0.08, 4, (n) => n.step % 8 === 0);
  }
}

// The fixed sounds a groove reuses, made once per film.
export function grooveSounds(seed) {
  return { K: kick(seed + 3), H: hat(seed + 5), T: tick(seed + 7), clap: clap(seed + 23), shaker: shaker(seed + 29), snapSoft: pluck(1200, 0.12, seed + 31, 0.9) };
}
