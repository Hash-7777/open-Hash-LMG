// The editor's store: every edit is normalised, a drag is one undo step,
// undo and redo walk the history both ways, the selection never points at
// something that is gone, and a saved project reads back as itself.

import assert from 'node:assert/strict';
import { section, claim, done } from './lib/check.mjs';
import { createStore, normalizeProject, findLayer } from '../../src/app/store.js';
import { staggerLayers } from '../../src/core/scene/edit.js';

let n = 0;
const newId = () => `film-test-${++n}`;
const fresh = () => createStore(normalizeProject({}, newId));

section('Projects');
await claim('a new project opens on the example film', () => { const p = normalizeProject({}, newId); assert.ok(p.scene.scenes.length > 0); assert.match(p.id, /^film-test-/); });
await claim('a saved project reads back as itself', () => { const p = normalizeProject({}, newId); assert.deepEqual(normalizeProject(JSON.parse(JSON.stringify(p)), newId), p); });
await claim('a damaged id is replaced, never used as a file name', () => assert.match(normalizeProject({ id: '../x' }, newId).id, /^film-test-/));

section('Edits and history');
await claim('an edit goes through the normaliser', () => {
  const s = fresh();
  s.edit((doc) => { doc.scenes[0].duration = 999; });
  assert.ok(s.get().project.scene.scenes[0].duration <= 60);
  assert.ok(s.canUndo());
});
await claim('start times follow a change of length', () => {
  const s = fresh(); const before = s.get().project.scene.scenes[1].start;
  s.edit((doc) => { doc.scenes[0].duration += 1; });
  assert.ok(Math.abs(s.get().project.scene.scenes[1].start - before - 1) < 1e-6);
});
await claim('a drag is one undo step', () => {
  const s = fresh(); const d0 = s.get().project.scene.scenes[0].duration;
  for (let i = 1; i <= 5; i++) s.edit((doc) => { doc.scenes[0].duration = d0 + i * 0.1; }, { live: true });
  assert.ok(!s.canUndo());
  s.commit();
  s.undo();
  assert.equal(s.get().project.scene.scenes[0].duration, d0);
  assert.ok(!s.canUndo()); assert.ok(s.canRedo());
});
await claim('redo brings an undone edit back, and a new edit clears redo', () => {
  const s = fresh();
  s.edit((doc) => { doc.title = 'One'; });
  s.undo(); s.redo();
  assert.equal(s.get().project.scene.title, 'One');
  s.undo(); s.edit((doc) => { doc.title = 'Two'; });
  assert.ok(!s.canRedo());
});
await claim('an edit that declines changes nothing', () => { const s = fresh(); s.edit(() => false); assert.ok(!s.canUndo()); });
await claim('the history is heard', () => { const s = fresh(); let heard = 0; s.on('history', () => heard++); s.edit((doc) => { doc.title = 'x'; }); s.undo(); assert.equal(heard, 2); });

section('Selection and the playhead');
await claim('deleting the selected layer clears the selection', () => {
  const s = fresh(); const S = s.get().project.scene.scenes[0]; const L = S.layers[0];
  s.select({ scene: S.id, layer: L.id });
  s.edit((doc) => { doc.scenes[0].layers = []; });
  assert.equal(s.get().selection.layer, null); assert.equal(s.get().selection.scene, S.id);
});
await claim('the playhead stays inside the film', () => { const s = fresh(); s.setTime(1e9); assert.equal(s.get().time, s.get().project.scene.duration); s.setTime(-5); assert.equal(s.get().time, 0); });
await claim('layers are found inside groups', () => assert.equal(findLayer([{ id: 'g', layers: [{ id: 'inner' }] }], 'inner').id, 'inner'));
section('Stagger');
const lay = () => [
  { id: 'a', y: 0.7, x: 0.2, at: 0.3, until: 4, in: { preset: 'rise' } },
  { id: 'b', y: 0.3, x: 0.8, at: 0.3, until: 2, in: { preset: 'rise' } },
  { id: 'c', y: 0.5, x: 0.5, at: 0.3, until: 4, in: 'none' },
  { id: 'd', y: 0.5, x: 0.52, at: 0.5, until: 4, in: { preset: 'fade' } },
];
await claim('as listed, from the earliest start, layers with no entrance untouched', () => {
  const L = lay(); staggerLayers(L, { step: 0.2, end: 4 });
  assert.deepEqual(L.map((x) => x.at), [0.3, 0.5, 0.3, 0.7]);
});
await claim('top to bottom, and from the centre', () => {
  const L = lay(); staggerLayers(L, { step: 0.1, order: 'top', end: 4 });
  assert.deepEqual([L[1].at, L[3].at, L[0].at], [0.3, 0.4, 0.5]);
  const M = lay(); staggerLayers(M, { step: 0.1, order: 'centre', end: 4 });
  assert.equal(M[3].at, 0.3);
});
await claim('a layer that leaves early keeps its hold; one that stays to the end still does', () => {
  const L = lay(); staggerLayers(L, { step: 0.5, end: 4 });
  assert.equal(L[1].until, 2.5); assert.equal(L[0].until, 4);
});
await claim('one layer alone is left as it is', () => assert.equal(staggerLayers([{ at: 1, in: 'rise' }]), 0));
done();
