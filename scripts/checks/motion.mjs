// Motion: every easing curve starts at 0 and ends at 1, the curves called
// calm never pass their target, every entrance and exit named in the format
// actually moves something, and figures on an odometer roll and then land
// on exactly the number written.

import { section, ok, claim, done } from './lib/check.mjs';
import assert from 'node:assert/strict';
import { ease, EASE_NAMES, OVERSHOOT } from '../../src/core/engine/ease.js';
import { layerState } from '../../src/core/engine/motion.js';
import { IN_PRESETS, OUT_PRESETS } from '../../src/core/scene/format.js';
import { normalizeScene } from '../../src/core/scene/normalize.js';
import { fakeContext } from './lib/fake-canvas.mjs';
import { createKit } from '../../src/core/engine/kit.js';
import { renderPlan } from '../../src/core/engine/render-plan.js';

section('Easing curves');
for (const name of EASE_NAMES) {
  const f = ease[name];
  ok(`${name} starts at 0 and ends at 1`, Math.abs(f(0)) < 1e-9 && Math.abs(f(1) - 1) < 1e-9);
  if (OVERSHOOT.has(name)) continue;
  let max = 0;
  for (let i = 0; i <= 200; i++) max = Math.max(max, f(i / 200));
  ok(`${name} never passes its target`, max <= 1 + 1e-9);
}
await claim('settle rises all the way and never turns back', () => {
  let prev = 0;
  for (let i = 1; i <= 200; i++) { const v = ease.settle(i / 200); assert.ok(v >= prev - 1e-12); prev = v; }
});

section('Every entrance and exit moves something');
const layer = (inP, outP) => normalizeScene({ scenes: [{ duration: 4, layers: [{ type: inP === 'draw' || inP === 'grow' ? 'shape' : 'text', shape: 'ring', text: 'Hello there', at: 0, until: 4, in: { preset: inP, duration: 1 }, out: { preset: outP, duration: 1 } }] }] }).scene.scenes[0].layers[0];
const look = (st) => JSON.stringify([st.visible, +st.opacity.toFixed(3), +st.dx.toFixed(2), +st.dy.toFixed(2), +st.scale.toFixed(3), +st.progress.toFixed(3), st.reveal && `${st.reveal.mode}:${Math.min(st.reveal.time, 5).toFixed(2)}`, st.clip && +st.clip.p.toFixed(2)]);
for (const p of IN_PRESETS.filter((x) => x !== 'none')) {
  const L = layer(p, 'none');
  const ins = L.in.preset;
  ok(`entrance ${p}${ins !== p ? ` (as ${ins})` : ''} changes the picture part way in`, look(layerState(L, 0.3)) !== look(layerState(L, 3.5)));
}
for (const p of OUT_PRESETS.filter((x) => x !== 'none')) {
  const L = layer('none', p);
  ok(`exit ${p} changes the picture part way out`, look(layerState(L, 3.6)) !== look(layerState(L, 2)));
}

section('Figures on an odometer');
const scene = normalizeScene({ scenes: [{ duration: 3, layers: [{ id: 'figure', type: 'counter', from: 0, to: 4820, suffix: '+', roll: true, count: 1.5, in: { preset: 'fade', duration: 0.1 } }] }] }).scene;
const drawn = (t) => {
  const ctx = fakeContext(scene.width, scene.height);
  const kit = createKit(ctx, { width: scene.width, height: scene.height, palette: scene.palette, assets: {} });
  const boxes = [];
  renderPlan(kit, scene, t, { collect: boxes });
  return { texts: ctx.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]), boxes };
};
await claim('it lands on exactly the number written, with its separator and sign', () => assert.deepEqual(drawn(2.5).texts, ['4', ',', '8', '2', '0', '+']));
await claim('part way, the columns are still turning', () => assert.notDeepEqual(drawn(0.6).texts, ['4', ',', '8', '2', '0', '+']));
await claim('the left column comes to rest first', () => {
  const mid = drawn(1.0).texts;
  assert.equal(mid[0], '4');
  assert.ok(mid.length > 6);
});
await claim('the checks still see the figure as a line of text', () => assert.ok(drawn(2.5).boxes.some((b) => b.kind === 'text' && b.text === '4,820+' && b.tag === 'figure')));
done();
