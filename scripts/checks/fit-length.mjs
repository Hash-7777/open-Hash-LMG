// A finished film brought back to the length asked for: each scene's timing
// drawn closer together while every move keeps its speed, no line left too
// short to read and no spoken line crowded, a film already near its length
// left alone, one whose words need more keeping it and saying so, and the
// length a change asks for read from its words.

import assert from 'node:assert/strict';
import { section, claim, done } from './lib/check.mjs';
import { STORYBOARD } from './lib/fixtures.mjs';
import { compileStoryboard } from '../../src/core/scene/compile.js';
import { normalizeScene } from '../../src/core/scene/normalize.js';
import { lintScene } from '../../src/core/scene/lint.js';
import { placeNarration } from '../../src/core/scene/narration-timing.js';
import { fitLength, tighten, lengthAsked, FIT_TOLERANCE } from '../../src/core/scene/fit-length.js';

// A rule-made film with narration, then stretched as a model's design does:
// each scene a third longer, its later arrivals coming later still.
const made = compileStoryboard(STORYBOARD, { style: 'studio', targetDuration: 30, narration: true }).scene;
const stretched = (() => {
  const d = JSON.parse(JSON.stringify(made));
  for (const S of d.scenes) {
    const D = S.duration;
    for (const L of S.layers) {
      const toEnd = L.until >= D - 0.011;
      if (L.at > 0) L.at = +(L.at * 1.35).toFixed(3);
      if (Number.isFinite(L.in.at) && L.in.at > 0) L.in.at = +(L.in.at * 1.35).toFixed(3);
      L.until = toEnd ? D * 1.35 : L.until * 1.35;
      if (Number.isFinite(L.out.at)) L.out.at = toEnd ? D * 1.35 - (D - L.out.at) : L.out.at * 1.35;
    }
    S.duration = +(D * 1.35).toFixed(3);
  }
  return normalizeScene(d).scene;
})();
const reading = (doc) => lintScene(doc, {}).filter((i) => i.code === 'read-time' || i.code === 'voice-overrun');
const crowded = (doc) => placeNarration(JSON.parse(JSON.stringify(doc)), () => 1.8).grown;

section('Back to the length asked for');
await claim('a stretched film comes back close to its length, every line readable and every spoken line placed', () => {
  assert.ok(stretched.duration > 30 * 1.2, `stretched to ${stretched.duration}`);
  const { scene, cut, note } = fitLength(stretched, 30);
  assert.ok(scene.duration <= 30 * 1.08, `fitted to ${scene.duration.toFixed(2)}`);
  assert.ok(cut > 5);
  assert.deepEqual(reading(scene).map((i) => i.code), [], 'nothing too short to read');
  assert.deepEqual(crowded(scene), [], 'no spoken line crowded');
  assert.equal(scene.scenes.length, stretched.scenes.length, 'no scene taken out');
  assert.match(note, /Brought the film back to the 30 s asked for/);
});
await claim('a film already within its length is left as it is', () => {
  const r = fitLength(made, made.duration / (1 + FIT_TOLERANCE / 2));
  assert.equal(r.scene, made); assert.equal(r.cut, 0); assert.equal(r.note, '');
  assert.equal(fitLength(made, 0).scene, made);
});
await claim('a film whose words need more than was asked keeps what they need, and says so', () => {
  const { scene, note } = fitLength(made, 8);
  assert.ok(scene.duration > 8 * 1.5);
  assert.deepEqual(reading(scene).map((i) => i.code), []);
  assert.match(note, /words and voice need/);
});

section('Drawing a scene together');
await claim('arrivals come sooner and the scene ends sooner; each move keeps its speed, and an exit against the end keeps its distance', () => {
  const doc = normalizeScene({ format: 'lmg.scene/1', aspect: '16:9', scenes: [{ id: 's', duration: 6, layers: [
    { id: 'a', type: 'text', text: 'First', at: 0.5, in: { preset: 'rise', duration: 0.7 } },
    { id: 'b', type: 'text', text: 'Second', y: 0.7, at: 3, in: { preset: 'fade', duration: 0.6 }, out: { preset: 'fade', at: 5.4, duration: 0.4 } },
  ] }], voice: { lines: [{ scene: 's', text: 'A line.', at: 2 }] } }).scene;
  const d = JSON.parse(JSON.stringify(doc));
  tighten(d, d.scenes[0], 0.75, 0.6);
  const [a, b] = d.scenes[0].layers;
  assert.equal(d.scenes[0].duration, 4.5);
  assert.equal(a.at, 0.3); assert.equal(b.at, 1.8);
  assert.equal(a.in.duration, 0.7); assert.equal(b.in.duration, 0.6);
  assert.equal(b.until, 4.5); assert.equal(b.out.at, 3.9, 'six tenths of a second from the end, as before');
  assert.equal(d.voice.lines[0].at, 1.2);
});

section('Holding a scene longer only where it helps');
await claim('a line that leaves part way through its scene is sent back, not fixed by a longer scene', () => {
  const doc = normalizeScene({ format: 'lmg.scene/1', aspect: '16:9', scenes: [{ id: 's', duration: 5, layers: [
    { id: 'early', type: 'text', text: 'Six words that leave too soon', at: 0.2, until: 1.6 },
    { id: 'late', type: 'text', text: 'Then this one stays', y: 0.7, at: 1.8 },
  ] }] }).scene;
  const hit = lintScene(doc, {}).find((i) => i.code === 'read-time' && i.layer === 'early');
  assert.ok(hit && hit.fix === null && /leaves before its scene ends/.test(hit.message));
  const short = normalizeScene({ format: 'lmg.scene/1', aspect: '16:9', scenes: [{ id: 's', duration: 1.5, layers: [{ id: 'all', type: 'text', text: 'Six words that need more time' }] }] }).scene;
  assert.equal(lintScene(short, {}).find((i) => i.code === 'read-time')?.fix?.kind, 'extend-scene');
});

section('The length a change asks for');
await claim('a length named in a change is its target; longer without a number fits nothing; anything else keeps the film’s', () => {
  assert.equal(lengthAsked('Tighten the cut from 53 seconds to exactly 45.', 30), 45);
  assert.equal(lengthAsked('make it 20 s', 45), 20);
  assert.equal(lengthAsked('A 60-second version please', 45), 60);
  assert.equal(lengthAsked('cut to 15 seconds', 45), 15);
  assert.equal(lengthAsked('make it longer and calmer', 45), 0);
  assert.equal(lengthAsked('make the title bigger', 45), 45);
  assert.equal(lengthAsked('show 3 screenshots', 45), 45);
});

done();
