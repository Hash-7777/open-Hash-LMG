// How a scene is put together: a decorative ring that runs through words is
// found and moved clear of them (grown, shrunk, or taken out), together with
// any ring on its centre; a box whose contents leave before it does keeps its
// last content until it leaves; and both fixes leave the rest of the scene
// as it was.

import { section, ok, claim, done } from './lib/check.mjs';
import assert from 'node:assert/strict';
import { normalizeScene } from '../../src/core/scene/normalize.js';
import { lintScene, autofix } from '../../src/core/scene/lint.js';
import { textBox } from '../../src/core/scene/composition-checks.js';
import { compileStoryboard } from '../../src/core/scene/compile.js';
import { STORYBOARD } from './lib/fixtures.mjs';
import { STYLE_NAMES } from '../../src/core/scene/format.js';

const scene = (layers, duration = 4) => normalizeScene({ aspect: '16:9', scenes: [{ id: 's', duration, layers }] }).scene;
const issues = (doc, code) => lintScene(doc, {}).filter((i) => i.code === code);
const ringDist = (doc, R, T) => {
  const W = doc.width, H = doc.height, u = Math.min(W, H) / 1080, b = textBox(doc, T);
  const cx = R.x * W, cy = R.y * H, r = (R.w * u) / 2;
  const lo = Math.hypot(Math.max(b.x0 - cx, 0, cx - b.x1), Math.max(b.y0 - cy, 0, cy - b.y1));
  const hi = Math.hypot(Math.max(Math.abs(cx - b.x0), Math.abs(cx - b.x1)), Math.max(Math.abs(cy - b.y0), Math.abs(cy - b.y1)));
  return r < lo || r > hi;
};

section('Rings across words');
{
  // A corner ring whose outline runs through a list, with an accent arc on it.
  const RINGS = [
    { id: 'ring', type: 'shape', shape: 'ring', x: 0.06, y: 0.9, w: 1300, stroke: 'muted', opacity: 0.32, z: -2 },
    { id: 'arc', type: 'shape', shape: 'ring', x: 0.06, y: 0.9, w: 1300, stroke: 'accent', arc: [0, 0.12], z: -2 },
  ];
  const TEXT = [{ id: 'a', type: 'text', text: "What's on", x: 0.15, y: 0.34, align: 'left', anchor: 'left', size: 48 }, { id: 'b', type: 'text', text: 'What fits', x: 0.15, y: 0.46, align: 'left', anchor: 'left', size: 48 }];
  const doc = scene([...RINGS, ...TEXT]);
  const found = issues(doc, 'ring-over-words');
  ok('a ring whose outline runs through words is found, once for its centre', found.length === 1);
  const fixed = autofix(doc, found).scene;
  const [r1, r2] = fixed.scenes[0].layers.filter((L) => L.shape === 'ring');
  ok('fixed, both rings on that centre take one new size', r1 && r2 && r1.w === r2.w && r1.w !== 1300);
  ok('and its outline now passes clear of every line', fixed.scenes[0].layers.filter((L) => L.type === 'text').every((T) => ringDist(fixed, r1, T)));
  ok('nothing else in the scene moved', JSON.stringify(fixed.scenes[0].layers.filter((L) => L.type === 'text')) === JSON.stringify(doc.scenes[0].layers.filter((L) => L.type === 'text')));
  ok('the fixed scene has no ring across words', issues(fixed, 'ring-over-words').length === 0);
  const clear = scene([{ id: 'ring', type: 'shape', shape: 'ring', x: 0.94, y: 0.1, w: 300, stroke: 'muted', z: -1 }, ...TEXT]);
  ok('a ring well away from the words is left alone', issues(clear, 'ring-over-words').length === 0);
  ok('a filled circle is not a ring', issues(scene([{ id: 'dot', type: 'shape', shape: 'circle', x: 0.15, y: 0.34, w: 600, fill: 'accent' }, ...TEXT]), 'ring-over-words').length === 0);
  // Words spread so no ring on this centre can clear them all: it goes.
  const boxed = scene([{ id: 'ring', type: 'shape', shape: 'ring', x: 0.5, y: 0.5, w: 900, stroke: 'muted', z: -2 }, ...[0.1, 0.3, 0.5, 0.7, 0.9].flatMap((y) => [0.1, 0.5, 0.9].map((x, k) => ({ id: `t${y}${k}`, type: 'text', text: 'Words across the frame here', x, y, size: 40 })))], 4);
  const out = autofix(boxed, issues(boxed, 'ring-over-words'));
  ok('a ring that cannot clear the words is taken out, and says so', !out.scene.scenes[0].layers.some((L) => L.id === 'ring') && out.applied.some((a) => /could not clear/.test(a)));
}

section('A box left empty');
{
  const doc = scene([
    { id: 'bubble', type: 'shape', shape: 'rect', x: 0.76, y: 0.5, w: 430, h: 220, fill: 'surface', stroke: 'ink', at: 0.2, z: 1 },
    { id: 'dots', type: 'shape', shape: 'circle', x: 0.76, y: 0.5, w: 16, h: 16, fill: 'accent', at: 0.7, until: 2.1, z: 2, out: { preset: 'fade', duration: 0.3 } },
    { id: 'title', type: 'text', text: 'Seat', x: 0.1, y: 0.4, align: 'left', anchor: 'left' },
  ], 5.4);
  const found = issues(doc, 'empty-container');
  ok('a bubble that stays after its dots leave is found', found.length === 1 && found[0].layer === 'bubble');
  const fixed = autofix(doc, found).scene;
  ok('fixed, the dots stay until the bubble leaves', fixed.scenes[0].layers.find((L) => L.id === 'dots').until === fixed.scenes[0].layers.find((L) => L.id === 'bubble').until);
  ok('a box with nothing in it is left alone', issues(scene([{ id: 'card', type: 'shape', shape: 'rect', x: 0.5, y: 0.5, w: 400, h: 300, fill: 'surface' }]), 'empty-container').length === 0);
  ok('a band across the frame is a background, not a box', issues(scene([{ id: 'band', type: 'shape', shape: 'rect', x: 0.5, y: 0.5, w: 1920, h: 254, fill: 'surface' }, { id: 't', type: 'text', text: 'Hi', x: 0.5, y: 0.5, until: 1 }]), 'empty-container').length === 0);
}

section('The app\'s own films keep clear of both');
await claim('every look\'s compiled film has no ring across words once fixed, and no empty box', () => {
  for (const style of STYLE_NAMES) {
    const { scene: s } = compileStoryboard(STORYBOARD, { style, targetDuration: 40 });
    const fixed = autofix(s, lintScene(s, {}).filter((i) => i.code === 'ring-over-words' || i.code === 'empty-container')).scene;
    const left = lintScene(fixed, {}).filter((i) => i.code === 'ring-over-words' || i.code === 'empty-container');
    assert.equal(left.length, 0, `${style}: ${left.map((i) => i.message).join(' / ')}`);
  }
});

done();
