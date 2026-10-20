// The editor's store: every edit is normalised, a drag is one undo step,
// undo and redo walk the history both ways, the selection never points at
// something that is gone, and a saved project reads back as itself.

import assert from 'node:assert/strict';
import { section, claim, done } from './lib/check.mjs';
import { createStore, normalizeProject, findLayer } from '../../src/app/store.js';

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
done();
