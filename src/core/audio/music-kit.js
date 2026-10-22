// The music kit: what a model's composing code is handed, as m.
//
// A model writes the film's score as code, export default function
// compose(m) { ... }, the way the code way of working writes a film's
// drawing. The code runs once, locked down like drawing code, and only places
// notes and drums on the film's time line through this kit. It never makes a
// sound itself: the app plays what it placed with its own instruments
// (notes.js), mixes and masters it. So a composition is data, checked here,
// and kept with the film.
//
// A note is [time, instrument, midi, length, gain, pan]; a drum is the same
// with midi 0. Times are seconds of film time.

import { rand } from '../engine/math.js';

export const INSTRUMENTS = ['pad', 'keys', 'mallet', 'pluck', 'synth', 'bass', 'sub', 'bell'];
export const DRUMS = ['kick', 'clap', 'snare', 'hat', 'shaker', 'tick', 'boom', 'swell', 'whoosh', 'hit', 'chime'];
export const MAX_NOTES = 6000;

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10], pentatonic: [0, 2, 4, 7, 9], 'minor-pentatonic': [0, 3, 5, 7, 10],
};
const NAMES = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

// A pitch as a MIDI number: a number as it is, or a name like "C4", "F#3", "Bb2".
export function midiOf(p) {
  if (typeof p === 'number' && Number.isFinite(p)) return Math.round(p);
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(String(p || '').trim());
  if (!m) return null;
  return NAMES[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
}

const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

// The kit and the list it fills. context: { bpm, key, duration, mood, minor,
// scenes: [{ name, start, end, text }], drops: [t], seed }.
export function createMusicKit(context) {
  const notes = [];
  const beat = 60 / context.bpm;
  const end = context.duration + 2;
  let refused = 0;
  const place = (t, inst, midi, len, opts = {}) => {
    if (notes.length >= MAX_NOTES) { refused++; return; }
    if (!(typeof t === 'number' && t >= -0.1 && t <= end)) { refused++; return; }
    notes.push([+t.toFixed(4), inst, midi, +num(len, 0.02, 16, beat).toFixed(4), +num(opts.gain, 0, 1, 0.5).toFixed(3), +num(opts.pan, -1, 1, 0).toFixed(3)]);
  };
  const m = {
    bpm: context.bpm, beat, bar: beat * 4, duration: context.duration, mood: context.mood,
    // The film's key root as a MIDI number, an octave under middle A's.
    root: 57 + (context.key || 0),
    minor: Boolean(context.minor),
    scenes: (context.scenes || []).map((s) => ({ ...s })),
    drops: [...(context.drops || [])],
    note(instrument, time, pitch, length = beat, opts = {}) {
      const midi = midiOf(pitch);
      if (!INSTRUMENTS.includes(instrument) || midi === null || midi < 24 || midi > 108) { refused++; return; }
      place(time, instrument, midi, length, opts);
    },
    chord(instrument, time, pitches, length = beat * 4, opts = {}) {
      for (const p of Array.isArray(pitches) ? pitches.slice(0, 8) : []) m.note(instrument, time, p, length, opts);
    },
    drum(kind, time, opts = {}) {
      if (!DRUMS.includes(kind)) { refused++; return; }
      place(time, kind, 0, 0.5, opts);
    },
    scale(name = 'major') { return [...(SCALES[name] || SCALES.major)]; },
    rand(seed = 1) { return rand(Math.abs(Math.round(seed)) + 1); },
  };
  return { m, notes, refused: () => refused };
}

// The composition kept with a film: each entry checked, at most MAX_NOTES,
// in time order.
export function cleanNotes(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const n of list) {
    if (out.length >= MAX_NOTES) break;
    if (!Array.isArray(n) || n.length < 6) continue;
    const [t, inst, midi, len, gain, pan] = n;
    const drum = DRUMS.includes(inst);
    if (!drum && !INSTRUMENTS.includes(inst)) continue;
    if (!(typeof t === 'number' && Number.isFinite(t) && t >= -0.1 && t <= 3600)) continue;
    if (!drum && !(Number.isInteger(midi) && midi >= 24 && midi <= 108)) continue;
    out.push([t, inst, drum ? 0 : midi, num(len, 0.02, 16, 0.5), num(gain, 0, 1, 0.5), num(pan, -1, 1, 0)]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

// Whether a composition is a score for this film, or why not: enough notes,
// some of them pitched, and music across the film rather than in one corner.
export function judgeNotes(notes, duration) {
  const pitched = notes.filter((n) => n[2] > 0);
  if (notes.length < 24) return `It placed only ${notes.length} notes and drums; a score for this film needs many more.`;
  if (pitched.length < 12) return 'It placed almost no pitched notes; write chords, a bass line and a melody.';
  const last = Math.max(...notes.map((n) => n[0] + n[3]));
  if (last < duration * 0.7) return `The music stops at ${last.toFixed(1)} s of a ${duration.toFixed(1)} s film; carry it to the end.`;
  const first = Math.min(...notes.map((n) => n[0]));
  if (first > Math.min(2, duration * 0.15)) return `The music starts only at ${first.toFixed(1)} s; begin with the film.`;
  return '';
}

// Runs a compose function with a fresh kit and returns what it placed,
// checked. The caller runs it where model-written code may run.
export function runComposition(compose, context) {
  if (typeof compose !== 'function') throw new Error('The code has no compose function.');
  const kit = createMusicKit(context);
  compose(kit.m);
  return cleanNotes(kit.notes);
}
