// What a frame shows: the person's pictures uncovered and large enough to
// see, and no moment between the opening and the end card left empty.

import assert from 'node:assert/strict';
import { section, claim, done } from './lib/check.mjs';
import { STORYBOARD, measure } from './lib/fixtures.mjs';
import { normalizeScene } from '../../src/core/scene/normalize.js';
import { normalizeStoryboard } from '../../src/core/scene/storyboard.js';
import { compileStoryboard } from '../../src/core/scene/compile.js';
import { lintScene, autofix, sampleTimes, motionTimes, beatTimes } from '../../src/core/scene/lint.js';
import { layerBox, coverage } from '../../src/core/scene/frame-checks.js';
import { ASPECTS } from '../../src/core/scene/format.js';

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const ASSETS = { 'image-shot': { kind: 'image', name: 'Screen.png', data: PIXEL, width: 2400, height: 1500 } };

// A wide film of invented scenes, each layer as a model might write it.
const film = (scenes) => normalizeScene({ format: 'lmg.scene/1', title: 'Test', aspect: '16:9', fps: 30, bpm: 120, style: 'studio', assets: ASSETS, scenes }).scene;
const words = (id, text, extra = {}) => ({ id, type: 'text', text, x: 0.25, y: 0.5, size: 72, ...extra });
const shot = (id, extra = {}) => ({ id, type: 'image', asset: 'image-shot', x: 0.7, y: 0.5, w: 900, h: 560, ...extra });
const looked = (scene) => {
  const r = sampleTimes(scene), m = motionTimes(scene), b = beatTimes(scene);
  const all = measure(scene, [...r, ...m, ...b]);
  return { samples: all.slice(0, r.length), moving: all.slice(r.length, r.length + m.length), beats: all.slice(r.length + m.length) };
};
const codes = (scene) => lintScene(scene, looked(scene)).map((i) => i.code);

section('A layer’s box on the frame');
await claim('the box follows the anchor and the scale, and coverage is the share of one box another covers', () => {
  const doc = { width: 1920, height: 1080 };
  assert.deepEqual(layerBox(doc, { x: 0.5, y: 0.5, w: 200, h: 100 }), { x: 860, y: 490, w: 200, h: 100 });
  assert.deepEqual(layerBox(doc, { x: 0.1, y: 0.5, w: 200, h: 100, anchor: 'left', scale: 2 }), { x: 192, y: 440, w: 400, h: 200 });
  assert.equal(coverage({ x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: 0, w: 100, h: 100 }), 0.5);
});

section('The person’s pictures, shown as they are');
await claim('a filled shape laid over a picture is found, and moved behind it as its card', () => {
  const scene = film([{ id: 'one', duration: 4, layers: [words('w', 'Every change'), shot('pic'), { id: 'pane', type: 'shape', shape: 'rect', x: 0.7, y: 0.5, w: 900, h: 560, fill: 'accent', opacity: 0.6 }] }]);
  const issues = lintScene(scene, looked(scene));
  const hit = issues.find((i) => i.code === 'media-covered');
  assert.ok(hit && hit.layer === 'pane' && hit.level === 'error');
  const { scene: fixed, applied } = autofix(scene, issues.filter((i) => i.fix));
  const L = Object.fromEntries(fixed.scenes[0].layers.map((x) => [x.id, x]));
  assert.ok(L.pane.z < L.pic.z, 'the pane is drawn under the picture');
  assert.ok(applied.some((a) => /covered the picture in scene 1 behind it/.test(a)));
  assert.ok(!codes(fixed).includes('media-covered'));
});
await claim('a shape given a stroke and no fill is an outline, kept as one when read again; one given neither is filled', () => {
  const scene = film([{ id: 'one', duration: 3, layers: [{ id: 'frame', type: 'shape', shape: 'rect', w: 400, h: 300, stroke: 'muted', strokeWidth: 2 }, { id: 'block', type: 'shape', shape: 'rect', w: 400, h: 300 }] }]);
  const [frame, block] = scene.scenes[0].layers;
  assert.equal(frame.fill, null); assert.equal(frame.stroke, 'muted');
  assert.equal(block.fill, block.color);
  assert.equal(normalizeScene(scene).scene.scenes[0].layers[0].fill, null);
});
await claim('an outline, a small badge, a shape behind and a dark scrim over a full-frame picture are not covers', () => {
  const scene = film([
    { id: 'one', duration: 4, layers: [words('w', 'Look'), { id: 'card', type: 'shape', shape: 'rect', x: 0.7, y: 0.5, w: 940, h: 600, fill: 'surface', z: -1 }, shot('pic'), { id: 'frame', type: 'shape', shape: 'rect', x: 0.7, y: 0.5, w: 900, h: 560, stroke: 'accent', strokeWidth: 3 }, { id: 'badge', type: 'shape', shape: 'circle', x: 0.85, y: 0.3, w: 60, h: 60, fill: 'accent' }] },
    { id: 'two', duration: 4, layers: [shot('full', { x: 0.5, w: 1920 * (1080 / 1080), h: 1080 }), { id: 'scrim', type: 'shape', shape: 'rect', x: 0.5, y: 0.5, w: 1920, h: 1080, fill: 'bg', opacity: 0.5 }, words('w2', 'Over it', { x: 0.5 })] },
  ]);
  assert.ok(!codes(scene).includes('media-covered'));
});
await claim('a picture shrunk to a corner is named too small for the model to enlarge, never grown by rule', () => {
  const scene = film([{ id: 'one', duration: 4, layers: [words('w', 'Search by meaning', { x: 0.5, y: 0.15 }), shot('thumb', { x: 0.86, y: 0.18, w: 190, h: 120 })] }]);
  const hit = lintScene(scene, looked(scene)).find((i) => i.code === 'small-media');
  assert.ok(hit && /too small to see/.test(hit.message) && !hit.fix);
  assert.ok(!codes(film([{ id: 'one', duration: 4, layers: [words('w', 'Big'), shot('pic')] }])).includes('small-media'));
});

section('No empty moment between scenes');
await claim('a scene whose words arrive after the one before has gone is found, and its words brought in as it arrives', () => {
  const scene = film([
    { id: 'a', duration: 3, layers: [words('w1', 'First line', { x: 0.5 })] },
    { id: 'b', duration: 4, transition: { kind: 'fade', duration: 0.5 }, layers: [{ id: 'rule', type: 'shape', shape: 'line', x: 0.5, y: 0.7, w: 300, stroke: 'accent', strokeWidth: 3, in: { preset: 'draw', duration: 1 } }, words('w2', 'Late words', { x: 0.5, at: 1.2 })] },
    { id: 'c', duration: 3, transition: { kind: 'fade', duration: 0.5 }, layers: [words('w3', 'The end', { x: 0.5 })] },
  ]);
  const issues = lintScene(scene, looked(scene));
  const hit = issues.find((i) => i.code === 'empty-moment');
  assert.ok(hit && hit.scene === 'b' && hit.fix?.kind === 'arrive-sooner');
  const { scene: fixed, applied } = autofix(scene, issues.filter((i) => i.fix));
  assert.ok(applied.some((a) => /scene 2's words in as it arrives/.test(a)));
  const w2 = fixed.scenes[1].layers.find((L) => L.id === 'w2');
  assert.ok((w2.in.at ?? w2.at) < 0, 'its entrance begins before the scene does');
  assert.equal(fixed.scenes[1].layers.find((L) => L.id === 'rule').at, 0, 'what follows keeps its own timing');
  assert.ok(!codes(fixed).includes('empty-moment'));
});
await claim('the middle of a dip through the background is empty on purpose', () => {
  const scene = film([
    { id: 'a', duration: 3, layers: [words('w1', 'First line', { x: 0.5 })] },
    { id: 'b', duration: 3, transition: { kind: 'dip', duration: 0.8 }, layers: [words('w2', 'Second line', { x: 0.5 })] },
    { id: 'c', duration: 3, transition: { kind: 'fade', duration: 0.5 }, layers: [words('w3', 'The end', { x: 0.5 })] },
  ]);
  assert.ok(!codes(scene).includes('empty-moment'));
});
await claim('films the compiler makes, once checked and repaired as the director does, have no empty moment and no covered picture', () => {
  const beats = STORYBOARD.beats.map((b, i) => (i === 2 || i === 5 ? { ...b, media: 'image-shot' } : b));
  for (const aspect of Object.keys(ASPECTS)) {
    const made = compileStoryboard(normalizeStoryboard({ ...STORYBOARD, beats }).storyboard, { aspect, style: 'studio', assets: ASSETS }).scene;
    const scene = autofix(made, lintScene(made, looked(made)).filter((i) => i.fix)).scene;
    const found = codes(scene);
    assert.ok(!found.includes('empty-moment') && !found.includes('media-covered'), `${aspect}: ${found.join(', ')}`);
  }
});

done();
