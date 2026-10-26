// A film's timing has no dead air: narration is one script laid over the
// film, so no scene stands still waiting for its line; words leave as the
// next scene's arrive, so no frame between scenes is empty; captions show
// only when asked for; and the storyboard prompt gives the voice a budget
// that fits the length asked for.

import assert from 'node:assert/strict';
import { section, claim, done } from './lib/check.mjs';
import { captionPhrases } from '../../src/core/engine/captions.js';
import { STORYBOARD, measure } from './lib/fixtures.mjs';
import { compileStoryboard } from '../../src/core/scene/compile.js';
import { normalizeScene } from '../../src/core/scene/normalize.js';
import { placeNarration, sceneStarts, BREATH, SPILL, LEAD } from '../../src/core/scene/narration-timing.js';
import { estimateSpeech, wordCount } from '../../src/core/scene/format.js';
import { lintScene, autofix } from '../../src/core/scene/lint.js';
import { storyboardPrompt, narrationBudget } from '../../src/core/director/prompts.js';

const scene3 = (durations, lines) => normalizeScene({
  scenes: durations.map((d, i) => ({ id: `s${i + 1}`, duration: d, transition: i ? { kind: 'fade', duration: 0.5 } : undefined, layers: [{ type: 'text', text: `Line ${i + 1}` }] })),
  voice: { lines: lines.map(([scene, text]) => ({ scene, text })) },
}).scene;
const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
const len = (l) => estimateSpeech(wordCount(l.text));

section('Narration is one script over the film');
await claim('each line follows the one before it with a breath, and starts in its own scene', () => {
  const doc = scene3([3, 3, 3], [['s1', words(9)], ['s2', words(4)], ['s3', words(4)]]);
  placeNarration(doc, len);
  const starts = sceneStarts(doc.scenes);
  const at = doc.voice.lines.map((l) => starts[doc.scenes.findIndex((S) => S.id === l.scene)] + l.at);
  for (let i = 1; i < at.length; i++) {
    assert.ok(at[i] >= at[i - 1] + len(doc.voice.lines[i - 1]) + BREATH - 2e-3, `line ${i + 1} starts over the line before`);
    assert.ok(doc.voice.lines[i].at <= SPILL + BREATH + LEAD + 1e-6, `line ${i + 1} starts too late into its scene`);
  }
});
await claim('a line runs on into the next scene for a moment without holding its own scene', () => {
  const doc = scene3([3, 3, 3], [['s1', words(8)], ['s3', words(2)]]);
  const before = doc.scenes.map((S) => S.duration);
  const { grown } = placeNarration(doc, len);
  assert.deepEqual(grown, []);
  assert.deepEqual(doc.scenes.map((S) => S.duration), before);
});
await claim('a line that would run on too far holds its scene by just what it needs, and its layers hold too', () => {
  const doc = scene3([2, 2, 3], [['s1', words(14)], ['s2', words(3)]]);
  const { grown } = placeNarration(doc, len);
  const starts = sceneStarts(doc.scenes);
  assert.equal(grown[0].scene, 's1');
  assert.ok(Math.abs(LEAD + len(doc.voice.lines[0]) - (starts[1] + SPILL)) < 0.01);
  assert.equal(doc.scenes[0].layers[0].until, doc.scenes[0].duration);
});

section('A compiled film is timed by its pictures, not by its lines');
await claim('a line longer than its scene runs on into the next one instead of holding its own', () => {
  const sb = structuredClone(STORYBOARD);
  sb.beats.forEach((b) => { delete b.say; });
  sb.beats[1].say = words(11);
  const { scene } = compileStoryboard(sb, { style: 'studio', narration: true });
  const S = scene.scenes.find((x) => x.id === scene.voice.lines[0].scene);
  assert.ok(S.duration < LEAD + estimateSpeech(11), `held for ${S.duration.toFixed(2)} s`);
});
await claim('the lines never overlap once laid out', () => {
  const sb = structuredClone(STORYBOARD);
  sb.beats.forEach((b) => { b.say = words(8); });
  const { scene } = compileStoryboard(sb, { style: 'studio', targetDuration: 40, narration: true });
  const spans = scene.voice.lines.map((l) => { const S = scene.scenes.find((x) => x.id === l.scene); return [S.start + l.at, S.start + l.at + len(l)]; });
  for (let i = 1; i < spans.length; i++) assert.ok(spans[i][0] >= spans[i - 1][1] + BREATH - 1e-3);
});
await claim('a film whose voice needs far more time than asked loses beats instead of running long', () => {
  const sb = structuredClone(STORYBOARD);
  sb.beats.forEach((b) => { b.say = words(12); });
  const { scene, notes } = compileStoryboard(sb, { style: 'studio', targetDuration: 30, narration: true });
  assert.ok(scene.duration <= 30 * 1.25, `runs ${scene.duration.toFixed(1)} s`);
  assert.ok(notes.some((n) => /left out/.test(n)));
});
await claim('the film checks lay out lines that were placed over each other, and hold no scene for it', () => {
  const doc = scene3([3, 3, 3], [['s1', words(6)], ['s2', words(6)], ['s3', words(4)]]);
  doc.voice.lines.forEach((l) => { l.at = 0.15; });
  const issues = lintScene(doc, {});
  assert.ok(issues.some((i) => i.fix?.kind === 'place-narration'));
  const { scene, applied } = autofix(doc, issues);
  assert.ok(applied.some((a) => /Laid the narration/.test(a)));
  assert.ok(scene.voice.lines[1].at > 0.15);
});

section('No empty frame between scenes');
await claim('across every fade and zoom, words are on screen within a third of a second', () => {
  for (const style of ['studio', 'editorial', 'stage']) {
    const { scene } = compileStoryboard(STORYBOARD, { style, targetDuration: 40 });
    for (const [i, S] of scene.scenes.entries()) {
      if (!i || !['fade', 'zoom'].includes(S.transition.kind)) continue;
      const times = Array.from({ length: 41 }, (_, k) => S.start - 0.3 + k * 0.05);
      const shown = measure(scene, times).map((m) => m.boxes.some((b) => b.kind === 'text' && b.alpha > 0.2));
      let run = 0, worst = 0;
      for (const s of shown) { run = s ? 0 : run + 1; worst = Math.max(worst, run); }
      assert.ok(worst * 0.05 < 0.34, `${style}: no words for ${(worst * 0.05).toFixed(2)} s around ${S.start.toFixed(1)} s`);
    }
  }
});
await claim('the words leaving a fade have an exit timed to it', () => {
  const { scene } = compileStoryboard(STORYBOARD, { style: 'editorial', targetDuration: 40 });
  const i = scene.scenes.findIndex((S, k) => k && S.transition.kind === 'fade');
  assert.ok(i > 0, 'a fade');
  const prev = scene.scenes[i - 1];
  assert.ok(prev.layers.some((L) => L.type === 'text' && L.out.preset !== 'none' && Math.abs(L.out.at - (prev.duration - scene.scenes[i].transition.duration)) < 0.01));
});

section('Captions, only when asked');
await claim('a narrated film shows no captions unless the brief asked for them', () => {
  assert.equal(compileStoryboard(STORYBOARD, { style: 'studio', narration: true }).scene.voice.captions, false);
  assert.equal(compileStoryboard(STORYBOARD, { style: 'studio', narration: true, captions: true }).scene.voice.captions, true);
});

section('The voice is given a budget that fits the film');
await claim('the storyboard prompt names the words a line and in all, and the brief’s own order', () => {
  const b = narrationBudget(45, 14);
  // Room for the total over nearly every beat, without lines that hold a scene still.
  assert.ok(b.perLine <= 10 && b.perLine >= 8, `per line ${b.perLine}`);
  assert.ok(b.total <= 100 && b.perLine * 14 * 0.8 >= b.total);
  const p = storyboardPrompt({ seconds: 45, narration: true });
  assert.ok(p.includes(`at most ${b.perLine} words`) && p.includes(`about ${b.total} words in all`) && p.includes('nearly every beat needs a line'));
  assert.ok(/follow that order beat for beat/.test(p));
  assert.ok(/never more than two plain statements in a row/.test(p), 'the storyboard is told to show more than it says');
});
section('Captions break where a reader would');
await claim('a word or two before a stop joins the phrase before it, never left alone', () => {
  const w = (t) => t.split(' ').map((x, i) => [x, i * 0.3, i * 0.3 + 0.25]);
  const show = (t) => { const words = w(t); return captionPhrases(words).map((p) => p.map((i) => words[i][0]).join(' ')); };
  assert.deepEqual(show('Every detail sits quietly in its place.'), ['Every detail sits quietly in its place.']);
  assert.deepEqual(show('One app, three screens, nothing more.'), ['One app,', 'three screens,', 'nothing more.']);
  assert.deepEqual(show('A long line of words that runs well past six of them here.'), ['A long line of words that', 'runs well past six of them here.']);
});
done();
