// The model composes the film's music as code.
//
// Once a film's scenes and timing are final, the model is shown them (each
// scene's kind, words and time, the tempo, the key, the mood and where the
// reveals land) and writes export default function compose(m) { ... } with
// the music kit (src/core/audio/music-kit.js). The code is read by the same
// check as drawing code and run where drawing code runs, so it reaches
// nothing; it only places notes and drums, which the app plays with its own
// instruments. A composition that is too thin, or code that will not run, is
// sent back once with what was wrong; if it still fails, the film keeps the
// score its direction chose, and a note says why.

import { checkCode, asModule } from './code-check.js';
import { extractCode } from '../util/json.js';
import { scorePlan } from '../audio/score.js';
import { judgeNotes, INSTRUMENTS, DRUMS } from '../audio/music-kit.js';

const KEYS = ['A', 'B flat', 'B', 'C', 'C sharp', 'D', 'E flat', 'E', 'F', 'F sharp', 'G', 'A flat'];
const MINOR_MOODS = new Set(['bold', 'technical', 'serious', 'energetic']);

// What the composing code is told about the film, and handed as m.
export function musicContext(scene, mood = 'bold') {
  const { drops } = scorePlan(scene);
  return {
    bpm: scene.bpm, key: scene.sound.key || 0, duration: +scene.duration.toFixed(3), mood, minor: MINOR_MOODS.has(mood),
    scenes: scene.scenes.map((S) => ({ name: S.name || S.id, start: +S.start.toFixed(3), end: +(S.start + S.duration).toFixed(3), text: (S.note || '').slice(0, 80) })),
    drops: drops.map((t) => +t.toFixed(3)),
  };
}

export function musicPrompt() {
  return `You are a film composer. Write the score for one short motion-graphics film as JavaScript:

export default function compose(m) { ... }

It runs once and places notes and drums on the film's time line; the app plays them with its own instruments, mixes and masters them. Write original music for THIS brief: choose the instruments, groove, harmony and melody that fit its subject and mood.

The kit, m:
  m.bpm, m.beat (seconds a beat), m.bar (seconds a bar), m.duration (seconds)
  m.root   the MIDI number of the film's key root (about 57); m.minor  true when the mood suits a minor key
  m.scenes [{ name, start, end, text }]   name is hook, title, statement, stat, list, end ...
  m.drops  [seconds]   reveals: land a boom on each
  m.note(instrument, time, pitch, length, { gain, pan })   instruments: ${INSTRUMENTS.join(', ')}
           pitch is a MIDI number or a name like "C4", "F#3", "Bb2"; gain 0 to 1 (0.5 is normal); pan -1 to 1
  m.chord(instrument, time, [pitches], length, { gain, pan })
  m.drum(kind, time, { gain, pan })   kinds: ${DRUMS.join(', ')}; a swell rises INTO its time
  m.scale(name)   semitone steps: major, minor, dorian, mixolydian, pentatonic, minor-pentatonic
  m.rand(seed)    a seeded random function; never Math.random

How to write it:
- Four parts, never more at once: chords on ONE of pad or keys, a bass line (sub may double it an octave down), ONE melody instrument (mallet, pluck, synth or bell), and drums that fit the mood (or none for a calm film). Change instruments between sections if you like, never stack two chord or two melody instruments in the same bar: the app plays only the busiest of each in a bar.
- The melody is a short motif that repeats and develops, with rests: about one note a beat, never a run of notes on every slot.
- Under narration the music is a bed: gains about 0.3 to 0.5, booms 0.6 at most, one boom per drop.
- Follow the scenes: the hook builds, each drop has a beat of near silence before it and a boom on it, feature scenes groove, the end card resolves on the root and thins out.
- Put every note on the beat grid: times are multiples of m.beat / 4.
- Melody between C4 and C6, bass below C3, chords between C3 and C5. Leave space; not every slot filled.
- Loops with fixed bounds only; up to 6000 notes; no network, timers, clock, storage or Math.random.

Reply with the code only, in one \`\`\`js block.`;
}

export function musicMessage(brief, context) {
  const lines = context.scenes.map((s) => `${s.start.toFixed(2)} to ${s.end.toFixed(2)} s, ${s.name}${s.text ? `: ${s.text}` : ''}`);
  return `Brief:\n${brief}\n\nThe film: ${context.duration.toFixed(2)} s at ${context.bpm} beats a minute, key ${KEYS[((context.key % 12) + 12) % 12]} ${context.minor ? 'minor' : 'major'}, mood ${context.mood}.\nScenes:\n${lines.join('\n')}\nDrops at: ${context.drops.map((t) => `${t.toFixed(2)} s`).join(', ') || 'none'}`;
}

// The step. io: { ask(request) -> text, compose({ code, context }) -> { ok, notes, error }, note(text) }.
// Returns the scene with its composition, or the scene as it was.
export async function composeMusic(io, brief, scene, mood) {
  const context = musicContext(scene, mood);
  let content = musicMessage(brief, context);
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await io.ask({ system: musicPrompt(), messages: [{ role: 'user', content }], purpose: attempt ? 'revise music' : 'music' });
    const code = asModule(extractCode(text), 'compose');
    let problems = checkCode(code, { entry: 'compose' });
    let notes = [];
    if (!problems.length) {
      const run = await io.compose({ code, context });
      if (!run.ok) problems = [`It failed while composing: ${run.error}`];
      else {
        notes = run.notes;
        const thin = judgeNotes(notes, context.duration);
        if (thin) problems = [thin];
      }
    }
    if (!problems.length) {
      io.note(`The model composed the music: ${notes.length} notes and drums, played by the app's instruments.`);
      return { ...scene, sound: { ...scene.sound, score: 'composed', notes } };
    }
    content = `${musicMessage(brief, context)}\n\nYour last score could not be used:\n${problems.map((p, k) => `${k + 1}. ${p}`).join('\n')}\nWrite the whole compose function again.`;
    if (attempt) io.note(`The model's score could not be used (${problems[0]}) The film keeps the ${scene.sound.score} score chosen from its brief.`);
  }
  return scene;
}

// The step as the director runs it: composed once the film is final; a
// failure leaves the score the direction chose. io adds step(id, title, fn).
export async function composeStep(io, brief, scene, mood) {
  if (!io.compose) return scene;
  try {
    return await io.step('music', 'Composing the music', () => composeMusic(io, brief, scene, mood));
  } catch (err) {
    if (err?.stopped) throw err;
    io.note(`${String(err.message || err)} The film keeps the score chosen from its brief.`);
    return scene;
  }
}

// After a change to a film whose music was composed: the composition stays
// when every scene still starts where it did, and is composed again when not.
export async function rescore(io, prev, next, brief, mood) {
  if (prev.sound?.score !== 'composed' || !prev.sound.notes?.length) return next;
  const same = Math.abs(prev.duration - next.duration) < 0.05 && prev.scenes.length === next.scenes.length
    && prev.scenes.every((S, i) => Math.abs(S.start - next.scenes[i].start) < 0.05);
  if (same) return { ...next, sound: { ...next.sound, score: 'composed', notes: prev.sound.notes } };
  return composeStep(io, brief, next, mood);
}
