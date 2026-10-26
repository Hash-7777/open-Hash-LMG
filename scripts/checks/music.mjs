// Music a model composes as code: the kit places only checked notes and drums,
// a saved composition survives normalising unchanged, a thin score is caught
// with a sentence the model can act on, composing code is held to the same
// rules as drawing code, a composed score is played and mastered like the
// others, and the director composes once a film is final, sends a failed
// score back once, keeps the brief's own score when it still fails, never
// shows a model the notes, and keeps or recomposes the music after a change.

import assert from 'node:assert/strict';
import { section, claim, done } from './lib/check.mjs';
import { measure } from './lib/fixtures.mjs';
import { createMusicKit, midiOf, cleanNotes, judgeNotes, runComposition, MAX_NOTES, arrange } from '../../src/core/audio/music-kit.js';
import { checkCode } from '../../src/core/director/code-check.js';
import { musicContext, musicMessage, musicPrompt, rescore } from '../../src/core/director/music.js';
import { makeScore } from '../../src/core/audio/score.js';
import { integratedLufs, truePeakDb } from '../../src/core/audio/master.js';
import { normalizeScene } from '../../src/core/scene/normalize.js';
import { compileStoryboard } from '../../src/core/scene/compile.js';
import { createDirector, sceneForModel } from '../../src/core/director/pipeline.js';

// An invented composer: chords, a bass, drums and a motif, following the scenes.
const COMPOSER = `export default function compose(m) {
  const sc = m.scale(m.minor ? 'minor' : 'major');
  const deg = (d, o = 0) => m.root + 12 * o + sc[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
  const prog = [0, 5, 3, 4];
  const bars = Math.ceil(m.duration / m.bar);
  for (let b = 0; b < bars; b++) {
    const t = b * m.bar, r = prog[b % 4];
    m.chord('pad', t, [deg(r), deg(r + 2), deg(r + 4)], m.bar, { gain: 0.4 });
    for (let k = 0; k < 4; k++) {
      m.drum('kick', t + k * m.beat, { gain: 0.6 });
      if (k % 2) m.drum('clap', t + k * m.beat, { gain: 0.4 });
      m.note('bass', t + k * m.beat, deg(r, -2), m.beat * 0.9, { gain: 0.5 });
    }
    const motif = [0, 2, 4, 2];
    motif.forEach((d, k) => m.note('mallet', t + k * m.beat, deg(r + d, 1), m.beat, { gain: 0.45 }));
  }
  for (const d of m.drops) { m.drum('swell', d); m.drum('boom', d, { gain: 0.8 }); }
}`;
const runNode = async ({ code, context }) => {
  try {
    const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    return { ok: true, notes: runComposition(mod.default || mod.compose, context) };
  } catch (err) { return { ok: false, error: err.message }; }
};

const STORY = { title: 'Lumen', beats: [{ kind: 'hook', text: 'Your desk is loud.' }, { kind: 'statement', text: 'Lumen makes it calm' }, { kind: 'title', text: 'Lumen', sub: 'The quiet lamp' }, { kind: 'stat', value: 38, suffix: '%', sub: 'fewer interruptions' }, { kind: 'end', text: 'Lumen', sub: 'lumen.example' }] };
const film = () => compileStoryboard(STORY, { style: 'studio', targetDuration: 20 }).scene;

section('The kit places only what it can play');
await claim('pitches read as MIDI numbers or names', () => {
  assert.equal(midiOf('C4'), 60); assert.equal(midiOf('F#3'), 54); assert.equal(midiOf('Bb2'), 46); assert.equal(midiOf(69), 69); assert.equal(midiOf('H2'), null);
});
await claim('an unknown instrument, drum or a pitch out of range is refused, the rest kept', () => {
  const { m, notes, refused } = createMusicKit({ bpm: 120, duration: 10 });
  m.note('kazoo', 0, 60); m.note('keys', 0, 10); m.drum('cowbell', 0); m.note('keys', 99, 60);
  m.note('keys', 1, 'E4', 0.5, { gain: 7, pan: -3 }); m.drum('kick', 0);
  assert.equal(refused(), 4);
  assert.deepEqual(notes.find((n) => n[1] === 'keys').slice(2), [64, 0.5, 1, -1]);
});
await claim('no more than the cap, and the seeded random repeats', () => {
  const { m, notes } = createMusicKit({ bpm: 120, duration: 10 });
  for (let i = 0; i < MAX_NOTES + 50; i++) m.drum('hat', 0.01);
  assert.equal(notes.length, MAX_NOTES);
  assert.equal(m.rand(4)(), m.rand(4)());
});
await claim('a saved composition survives normalising unchanged, and damaged entries are dropped', () => {
  const notes = cleanNotes([[1, 'keys', 60, 0.5, 0.5, 0], [0.5, 'kick', 0, 0.5, 0.8, 0], [2, 'kazoo', 60, 1, 1, 0], [3, 'keys', 'C4', 1, 1, 0], 'x']);
  assert.deepEqual(notes.map((n) => n[1]), ['kick', 'keys']);
  const once = normalizeScene({ ...film(), sound: { ...film().sound, score: 'composed', notes } }).scene;
  assert.deepEqual(once.sound.notes, notes);
  assert.deepEqual(normalizeScene(once).scene.sound.notes, once.sound.notes);
});

section('A thin score is caught, and says what to change');
const context = musicContext(film(), 'calm');
await claim('a full composition passes', async () => assert.equal(judgeNotes((await runNode({ code: COMPOSER, context })).notes, context.duration), ''));
for (const [label, list, re] of [
  ['a handful of notes', [[0, 'keys', 60, 1, 0.5, 0]], /only 1 notes/],
  ['drums alone', Array.from({ length: 40 }, (_, i) => [i * 0.5, 'kick', 0, 0.5, 0.5, 0]), /no pitched notes/],
  ['music that stops early', Array.from({ length: 40 }, (_, i) => [i * 0.1, 'keys', 60, 0.2, 0.5, 0]), /stops at/],
]) await claim(label, () => assert.match(judgeNotes(list, context.duration), re));
await claim('composing code is held to the drawing code’s rules, and named for its kit', () => {
  assert.deepEqual(checkCode(COMPOSER, { entry: 'compose' }), []);
  assert.ok(checkCode('export default function compose(m) { fetch("x"); m.note("keys", 0, Math.random()); }', { entry: 'compose' }).some((p) => /m\.rand/.test(p)));
  assert.match(checkCode('const x = 1;', { entry: 'compose' })[0], /compose function/);
});
await claim('the model is told the film: its scenes, tempo, key, mood and drops', () => {
  const msg = musicMessage('An invented lamp', context);
  assert.match(msg, /beats a minute, key \w+/); assert.match(msg, /hook: Your desk is loud\./); assert.match(msg, /Drops at: \d/);
});

section('A composition is arranged before it is played');
await claim('in each bar one chord, one melody and one time-keeping drum play, the busiest; bass, sub and other drums as written', () => {
  const beat = 0.5;
  const notes = [
    [0, 'pad', 60, 2, 0.4, 0], [0, 'keys', 64, 0.5, 0.4, 0], [0.5, 'keys', 64, 0.5, 0.4, 0],
    [0, 'mallet', 72, 0.25, 0.4, 0], [0.5, 'pluck', 76, 0.25, 0.4, 0], [1, 'pluck', 77, 0.25, 0.4, 0], [1.5, 'bell', 79, 0.5, 0.4, 0],
    [0, 'bass', 40, 1, 0.5, 0], [0, 'sub', 28, 1, 0.5, 0], [0, 'kick', 0, 0.5, 0.5, 0], [0.5, 'hat', 0, 0.5, 0.3, 0], [1, 'hat', 0, 0.5, 0.3, 0], [1, 'shaker', 0, 0.5, 0.3, 0],
    [2, 'pad', 60, 2, 0.4, 0], [2, 'mallet', 72, 0.25, 0.4, 0],
  ];
  const played = arrange(notes, beat).map((n) => `${n[0]}|${n[1]}`);
  assert.deepEqual(played, ['0|keys', '0.5|keys', '0.5|pluck', '1|pluck', '0|bass', '0|sub', '0|kick', '0.5|hat', '1|hat', '2|pad', '2|mallet']);
});
await claim('a chord sounds at most four notes deep, booms a beat apart at least, and the saved notes are untouched', () => {
  const notes = [...[48, 52, 55, 59, 62, 64].map((p) => [0, 'pad', p, 2, 0.4, 0]), [1, 'boom', 0, 0.5, 0.6, 0], [1.2, 'boom', 0, 0.5, 0.6, 0], [3, 'boom', 0, 0.5, 0.6, 0]];
  const copy = JSON.stringify(notes);
  const played = arrange(notes, 0.5);
  assert.equal(played.filter((n) => n[1] === 'pad').length, 4);
  assert.deepEqual(played.filter((n) => n[1] === 'boom').map((n) => n[0]), [1, 3]);
  assert.equal(JSON.stringify(notes), copy);
});
await claim('the composer is told to write four parts at most and to leave rests', () => {
  const p = musicPrompt();
  assert.match(p, /Four parts, never more at once/); assert.match(p, /ONE melody instrument/); assert.match(p, /with rests/);
});

section('A composed score is played and mastered like the others');
await claim('about -14 LUFS, true peak at most -1 dBTP, and unlike the score it replaced', async () => {
  const scene = film();
  const notes = (await runNode({ code: COMPOSER, context: musicContext(scene, 'calm') })).notes;
  const st = await makeScore({ ...scene, sound: { ...scene.sound, score: 'composed', notes } });
  assert.ok(Math.abs(integratedLufs(st.left, st.right) + 14) <= 0.6);
  assert.ok(truePeakDb(st.left, st.right) <= -0.95);
  const plain = await makeScore(scene);
  let diff = 0;
  for (let i = 0; i < st.left.length; i += 211) diff += Math.abs(st.left[i] - plain.left[i]);
  assert.ok(diff / (st.left.length / 211) > 0.01);
});
await claim('a composed score with no notes plays the pulse score', async () => {
  const scene = film();
  const a = await makeScore({ ...scene, sound: { ...scene.sound, score: 'composed', notes: [] } });
  const b = await makeScore({ ...scene, sound: { ...scene.sound, score: 'pulse' } });
  assert.equal(a.left[48000 * 3], b.left[48000 * 3]);
});

section('The director composes once the film is final');
function director(music) {
  const asked = [], log = [];
  const d = createDirector({
    ask: async ({ purpose }) => {
      asked.push(purpose);
      if (purpose === 'storyboard') return JSON.stringify(STORY);
      if (purpose === 'pictures') return '{"pictures": []}';
      const reply = music.shift();
      if (reply === undefined) throw new Error(`no scripted answer for ${purpose}`);
      return reply;
    },
    measure: async ({ scene }, times) => measure(scene, times),
    trial: async () => ({ ok: true }), sheet: async () => null, compose: runNode, log: (e) => log.push(e),
  });
  return { d, asked, log };
}
const brief = { brief: 'A launch film for an invented lamp.', style: 'studio', aspect: '16:9', seconds: 20, tier: 'guided' };
const fence = (code) => '```js\n' + code + '\n```';
await claim('a score the model writes becomes the film’s music, composed last', async () => {
  const { d, asked } = director([fence(COMPOSER)]);
  const out = await d.make(brief);
  assert.equal(asked.at(-1), 'music');
  assert.equal(out.scene.sound.score, 'composed');
  assert.ok(out.scene.sound.notes.length > 100);
});
await claim('a thin score is sent back once with what was wrong, and the second kept', async () => {
  const { d, asked } = director([fence('export default function compose(m) { m.note("keys", 0, 60); }'), fence(COMPOSER)]);
  const out = await d.make(brief);
  assert.deepEqual(asked.slice(-2), ['music', 'revise music']);
  assert.equal(out.scene.sound.score, 'composed');
});
await claim('code that fails twice leaves the score the brief chose, with a note', async () => {
  const bad = fence('export default function compose(m) { throw new Error("broken"); }');
  const { d, log } = director([bad, bad]);
  const out = await d.make(brief);
  assert.notEqual(out.scene.sound.score, 'composed');
  assert.ok(log.some((e) => e.id === 'music' && e.status === 'note' && /keeps the \w+ score/.test(e.detail)));
});
await claim('turned off, no music is asked for', async () => {
  const { d, asked } = director([]);
  await d.make({ ...brief, compose: false });
  assert.ok(!asked.includes('music'));
});
await claim('a model rewriting the plan is never shown the notes', () => {
  const scene = film();
  const shown = sceneForModel({ ...scene, sound: { ...scene.sound, score: 'composed', notes: [[0, 'keys', 60, 1, 0.5, 0]] } });
  assert.equal(shown.sound.notes, undefined);
  assert.equal(shown.sound.score, 'composed');
});
await claim('after a change, the music stays when the timing did, and is composed again when not', async () => {
  const prev = film();
  const notes = (await runNode({ code: COMPOSER, context: musicContext(prev, 'calm') })).notes;
  const composedPrev = { ...prev, sound: { ...prev.sound, score: 'composed', notes } };
  let asked = 0;
  const io = { step: (id, t, fn) => fn(), ask: async () => { asked++; return fence(COMPOSER); }, compose: runNode, note: () => {} };
  const same = await rescore(io, composedPrev, { ...prev, sound: { ...prev.sound, score: 'composed', notes: [] } }, 'x', 'calm');
  assert.equal(same.sound.notes, notes); assert.equal(asked, 0);
  const longer = compileStoryboard(STORY, { style: 'studio', targetDuration: 40 }).scene;
  const again = await rescore(io, composedPrev, longer, 'x', 'calm');
  assert.equal(asked, 1); assert.equal(again.sound.score, 'composed');
});

done();
