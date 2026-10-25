// A film's direction: read from its brief, the same for the same brief and
// take, different across briefs and takes, and every composition it can
// choose lays out clean in every look and frame shape.

import assert from 'node:assert/strict';
import { ok, section, claim, attempt, done } from './lib/check.mjs';
import { STORYBOARD, measure } from './lib/fixtures.mjs';
import { chooseDirection, readMood, briefColour, layoutFor, LAYOUTS, describeDirection } from '../../src/core/scene/direction.js';
import { compileStoryboard } from '../../src/core/scene/compile.js';
import { normalizeScene } from '../../src/core/scene/normalize.js';
import { normalizeStoryboard } from '../../src/core/scene/storyboard.js';
import { lintScene, sampleTimes, motionTimes } from '../../src/core/scene/lint.js';
import { ASPECTS, STYLE_NAMES } from '../../src/core/scene/format.js';
import { contrast } from '../../src/core/util/color.js';

// Invented briefs, one per kind of film.
const BRIEFS = [
  'A launch film for Lumen Desk, an invented lamp that keeps a desk calm.',
  'An AI developer platform that turns data into dashboards in seconds.',
  'A playful snack brand for kids, bright and fun.',
  'The annual results of an invented insurance company.',
  'A luxury watch, crafted by hand, for an invented maker.',
  'A local bakery and coffee house opening on a quiet street.',
  'A fitness festival weekend with music and races.',
  'A meditation app that helps you breathe and sleep.',
];

section('The same brief and take give the same film; a new take gives another');
await claim('repeatable', () => assert.deepEqual(chooseDirection({ brief: BRIEFS[0], take: 3 }), chooseDirection({ brief: BRIEFS[0], take: 3 })));
await claim('a new take changes the direction', () => {
  const a = JSON.stringify(chooseDirection({ brief: BRIEFS[0], take: 1 }));
  const others = [2, 3, 4, 5].map((take) => JSON.stringify(chooseDirection({ brief: BRIEFS[0], take })));
  assert.ok(others.every((o) => o !== a));
});
await claim('different briefs come out in different looks and colours', () => {
  const ds = BRIEFS.map((brief) => chooseDirection({ brief, take: 0 }));
  assert.ok(new Set(ds.map((d) => d.style)).size >= 4, ds.map((d) => d.style).join(','));
  assert.ok(new Set(ds.map((d) => d.palette.accent)).size >= 5);
  assert.ok(new Set(ds.map((d) => d.bpm)).size >= 5);
});

section('The brief is read');
await claim('mood words', () => {
  assert.equal(readMood(BRIEFS[7]), 'calm');
  assert.equal(readMood(BRIEFS[1]), 'technical');
  assert.equal(readMood(BRIEFS[3]), 'serious');
});
await claim('the model’s own mood wins', () => assert.equal(readMood(BRIEFS[1], { mood: 'luxury' }), 'luxury'));
await claim('a brand colour from a hex code or a colour word', () => {
  assert.equal(briefColour('Our brand is #12a594, simple.'), '#12a594');
  assert.equal(briefColour('a green tea shop'), '#30a46c');
  assert.equal(briefColour('no colour here'), null);
});
await claim('a readable suggested accent is used; an unreadable one is not', () => {
  assert.equal(chooseDirection({ brief: 'x', look: { accent: '#4fd1ff' }, style: 'tech' }).palette.accent, '#4fd1ff');
  assert.notEqual(chooseDirection({ brief: 'x', look: { accent: '#070b14' }, style: 'tech' }).palette.accent, '#070b14');
});
await claim('a chosen look is kept', () => assert.equal(chooseDirection({ brief: BRIEFS[2], style: 'paper' }).style, 'paper'));
await claim('every accent chosen reads on its field', () => {
  for (const brief of BRIEFS) for (let take = 0; take < 6; take++) {
    const d = chooseDirection({ brief, take });
    assert.ok(contrast(d.palette.accent, d.palette.bg) >= 3, `${d.style} ${d.palette.accent} on ${d.palette.bg}`);
  }
});
await claim('a direction reads as one sentence', () => assert.match(describeDirection(chooseDirection({ brief: BRIEFS[0] })), /look, \w+ mood, accent #[0-9a-f]{6}, \d+ beats a minute/));

section('The model’s suggested look survives the storyboard');
await claim('known values kept, others dropped', () => {
  const { storyboard } = normalizeStoryboard({ title: 'x', look: { mood: 'Warm', accent: '#C2410C', tempo: 'warp' }, beats: [{ kind: 'hook', text: 'Hi' }] });
  assert.deepEqual(storyboard.look, { mood: 'warm', accent: '#c2410c', tempo: null });
});

await claim('an end card with one stray lowercase word shows the film\u2019s name; a real name is kept', () => {
  const sb = (text) => normalizeStoryboard({ title: 'Lumen Desk', beats: [{ kind: 'hook', text: 'Hi' }, { kind: 'end', text, sub: 'lumen.example' }] }).storyboard.beats[1].text;
  assert.equal(sb('lamp'), 'Lumen Desk'); assert.equal(sb('lumen'), 'lumen'); assert.equal(sb('Lumen Desk'), 'Lumen Desk'); assert.equal(sb('Try it today'), 'Try it today');
});

section('A directed film keeps its key and chord order');
await claim('sound key and progression survive normalising twice', () => {
  const d = chooseDirection({ brief: BRIEFS[4], take: 2 });
  const { scene } = compileStoryboard(STORYBOARD, { direction: d });
  assert.equal(scene.sound.key, d.key); assert.equal(scene.sound.progression, d.progression);
  assert.deepEqual(normalizeScene(normalizeScene(scene).scene).scene.sound, scene.sound);
});

section('Two takes of one storyboard are laid out differently');
await claim('compositions differ', () => {
  const a = compileStoryboard(STORYBOARD, { direction: chooseDirection({ brief: BRIEFS[0], style: 'studio', take: 1 }) }).scene;
  const b = compileStoryboard(STORYBOARD, { direction: chooseDirection({ brief: BRIEFS[0], style: 'studio', take: 2 }) }).scene;
  const shape = (s) => JSON.stringify(s.scenes.map((S) => S.layers.map((L) => [L.type, L.anchor, Math.round(L.x * 100)])));
  assert.notEqual(shape(a), shape(b));
});
await claim('every kind turns through all its compositions', () => {
  for (const [kind, n] of Object.entries(LAYOUTS)) {
    const seen = new Set(Array.from({ length: n }, (_, k) => layoutFor({ layoutOffset: 0 }, kind, k)));
    assert.equal(seen.size, n, kind);
  }
});

await claim('a run of hooks and statements repeats no composition within three scenes, and lines arrive more than one way', () => {
  const lines = ['Plans change', 'Your calendar should too', 'Meetings move on their own', 'Focus finds its hour', 'Nothing double-booked', 'The week, handled', 'One less tab'];
  const sb = { title: 'Orbit', beats: [{ kind: 'hook', text: lines[0] }, ...lines.slice(1).map((text) => ({ kind: 'statement', text })), { kind: 'end', text: 'Orbit', sub: 'orbit.example' }] };
  for (let take = 0; take < 4; take++) {
    for (const style of ['studio', 'paper', 'editorial', 'tech']) {
      const { scene } = compileStoryboard(sb, { direction: chooseDirection({ brief: BRIEFS[0], style, take }), aspect: '16:9' });
      const plain = scene.scenes.slice(0, lines.length);
      const shape = (S) => JSON.stringify(S.layers.map((L) => [L.type, L.shape || '', L.anchor, Math.round(L.x * 20), Math.round(L.y * 20), L.type === 'text' ? [Math.round((L.size || 0) / 12), L.in.preset] : '']));
      const entrance = (S) => S.layers.find((L) => L.type === 'text' && L.text === sb.beats[scene.scenes.indexOf(S)].text)?.in.preset;
      for (let i = 1; i < plain.length; i++) {
        for (let j = Math.max(0, i - 2); j < i; j++) assert.notEqual(shape(plain[i]), shape(plain[j]), `${style} take ${take}: scenes ${j + 1} and ${i + 1} share a composition`);
      }
      const moves = plain.map(entrance);
      for (let i = 2; i < moves.length; i++) assert.ok(new Set(moves.slice(i - 2, i + 1)).size >= 2, `${style} take ${take}: lines ${i - 1} to ${i + 1} arrive the same way`);
    }
  }
});

section('Every composition, in every look and frame shape, lays out clean');
for (const style of STYLE_NAMES) {
  for (const aspect of Object.keys(ASPECTS)) {
    for (let take = 0; take < 3; take++) {
      await attempt(`${style} ${aspect} take ${take}`, async () => {
        const direction = chooseDirection({ brief: BRIEFS[take], style, take });
        const { scene } = compileStoryboard(STORYBOARD, { direction, aspect, targetDuration: 40, narration: true });
        const errors = lintScene(scene, { samples: measure(scene, sampleTimes(scene)), moving: measure(scene, motionTimes(scene)), targetDuration: 40 }).filter((i) => i.level === 'error');
        ok(`${style} ${aspect} take ${take}: no errors`, errors.length === 0, errors.slice(0, 3).map((e) => `${e.code}: ${e.message}`).join(' / '));
      });
    }
  }
}
done();
