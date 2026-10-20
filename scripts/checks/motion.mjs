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
import { compileStoryboard } from '../../src/core/scene/compile.js';
import { lintScene, autofix } from '../../src/core/scene/lint.js';

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

section('One element carried into the next scene');
const carryDoc = normalizeScene({ scenes: [
  { duration: 3, layers: [{ id: 'name-a', type: 'text', text: 'Lumen Desk', x: 0.5, y: 0.6, size: 132 }] },
  { duration: 3, transition: { kind: 'carry', duration: 0.8, carry: { from: 'name-a', to: 'name-b' } }, layers: [{ id: 'name-b', type: 'text', text: 'Lumen Desk', x: 0.5, y: 0.3, size: 90, in: { preset: 'letters', duration: 1 } }] },
] }).scene;
const frame = (doc, t) => {
  const ctx = fakeContext(doc.width, doc.height);
  const kit = createKit(ctx, { width: doc.width, height: doc.height, palette: doc.palette, assets: {} });
  const boxes = [];
  renderPlan(kit, doc, t, { collect: boxes });
  return boxes.filter((b) => b.kind === 'text' && b.alpha > 0.05);
};
await claim('the carry survives normalising, twice', () => {
  assert.deepEqual(carryDoc.scenes[1].transition.carry, { from: 'name-a', to: 'name-b' });
  assert.equal(JSON.stringify(normalizeScene(carryDoc).scene), JSON.stringify(carryDoc));
});
await claim('half way, the line is drawn once, between its two places', () => {
  const S = carryDoc.scenes[1];
  const mid = frame(carryDoc, S.start + 0.4).filter((b) => /lumen desk/i.test(b.text));
  assert.equal(mid.length, 1);
  const cy = mid[0].y + mid[0].h / 2;
  assert.ok(cy < 0.6 * carryDoc.height && cy > 0.3 * carryDoc.height, `centre ${cy}`);
});
await claim('once arrived it stays in place instead of making its entrance again', () => {
  const S = carryDoc.scenes[1];
  const after = frame(carryDoc, S.start + 0.85).filter((b) => b.tag === 'name-b');
  assert.equal(after.length, 1); assert.ok(after[0].alpha > 0.95);
});
await claim('the compiler carries a name shown in two scenes in a row', () => {
  const { scene } = compileStoryboard({ title: 'Lumen', beats: [{ kind: 'hook', text: 'Your desk is loud.' }, { kind: 'title', text: 'Lumen Desk', sub: 'The quiet lamp' }, { kind: 'end', text: 'Lumen Desk', sub: 'lumen.example' }] }, { style: 'studio', targetDuration: 15 });
  const tr = scene.scenes[2].transition;
  assert.equal(tr.kind, 'carry'); assert.ok(tr.carry && tr.carry.from && tr.carry.to);
});
await claim('a carry is never counted as a mixed-in transition nor replaced', () => {
  const doc = normalizeScene({ scenes: ['fade', 'push', 'zoom', 'carry', 'wipe'].map((k, i) => ({ duration: 2, transition: { kind: k, carry: { from: `l${i - 1}`, to: `l${i}` } }, layers: [{ id: `l${i}`, type: 'text', text: 'Same words' }] })) }).scene;
  const mix = lintScene(doc, {}).find((i) => i.code === 'transition-mix');
  const fixed = mix ? autofix(doc, [mix]).scene : doc;
  assert.equal(fixed.scenes[3].transition.kind, 'carry');
});
done();
