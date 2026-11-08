// A film on the 3D stage: its stage survives normalising with every field of
// every part (the stage field guard), it draws through the ordinary renderer
// at every moment, and its diagrams keep their rules: each card lights when
// its word is said, each curve lands on its tile, digits roll only once their
// tile stands, the ring names a look only at rest, and no two planes ever
// stand close enough to flicker.

import { section, ok, claim, done } from './lib/check.mjs';
import assert from 'node:assert/strict';
import { fakeContext } from './lib/fake-canvas.mjs';
import { STORYBOARD } from './lib/fixtures.mjs';
import { createKit } from '../../src/core/engine/kit.js';
import { renderPlan } from '../../src/core/engine/render-plan.js';
import { renderStage, stageFrame } from '../../src/core/engine/render-stage.js';
import { activeScenes } from '../../src/core/engine/render-plan.js';
import { createStage, viewFor, cameraRig, projectPoint, fullPose } from '../../src/core/engine/stage3d.js';
import { coplanarPairs } from '../../src/core/engine/stage-rules.js';
import { HUB, hubTileX, FIGURE } from '../../src/core/engine/diagrams.js';
import { initialsMarks, ICON_DEPTH } from '../../src/core/engine/stage-parts.js';
import { studioColors } from '../../src/core/engine/stage-paint.js';
import { normalizeScene } from '../../src/core/scene/normalize.js';
import { STAGE_PART_KINDS } from '../../src/core/scene/stage-format.js';
import { compileStoryboard } from '../../src/core/scene/compile.js';

const fakeCanvas = (w, h) => { const c = { width: w, height: h }; c.ctx = fakeContext(w, h); c.getContext = () => c.ctx; return c; };
const made = compileStoryboard(STORYBOARD, { style: 'studio' }).scene;
const look = (style) => ({ name: style[0].toUpperCase() + style.slice(1), doc: compileStoryboard(STORYBOARD, { style }).scene });

// An invented product, every part of a product film, with every field set.
const PARTS = [
  { kind: 'icon', t0: 0, t1: 40, asset: 'mark', keys: [[0, { o: 0, x: 960, y: 540, z: 0, ry: -75, rx: 0, rz: 0, s: 1 }], [3, { o: 1, x: 960, y: 540, z: 0, ry: 0, rx: 0, rz: 0, s: 1 }], [5, { o: 1, x: 960, y: 330, z: 0, ry: 0, rx: 0, rz: 0, s: 0.62 }], [6, { o: 0, x: 960, y: 300, z: -400, ry: 0, rx: -30, rz: 0, s: 0.62 }]] },
  { kind: 'open', t0: 0, t1: 4.2, fi: 0.3, fo: 0.4, mark: { size: 320, inset: 0.117, radius: 0.133 } },
  { kind: 'name', t0: 4.8, t1: 9, fi: 0.4, fo: 0.6, name: 'Orbi SQ', expansion: [['Orbi', 5.6], ['Sound', 5.9], ['Quiet', 6.2]], tagline: [['Calm', 6.8], ['by', 7.0], ['default.', 7.2]] },
  { kind: 'steps', t0: 9.6, t1: 15, fi: 0.4, fo: 0.7, items: [['Plan', 'one line', 'brief'], ['Sketch', 'boards', 'storyboard'], ['Shape', 'every frame', 'design'], ['Check', 'measured', 'check'], ['Ship', 'out', 'film']], at: [10.6, 11.2, 11.8, 12.4, 13.0] },
  { kind: 'split', t0: 15.6, t1: 20, fi: 0.4, fo: 0.7, left: { title: 'The hand', icon: 'chip', items: [['Words', 16.4], ['Pictures', 16.9]] }, right: { title: 'The tool', icon: 'window', items: [['Layout', 17.6], ['Timing', 18.0], ['Sound', 18.4]] }, arrow: 17.2 },
  { kind: 'hub', t0: 20.4, t1: 26, fi: 0.4, fo: 0.7, title: 'Inside', sub: 'made from source', tiles: [['A1', 'first'], ['B2', 'second'], ['C3', 'third'], ['D4', 'fourth']], at: [21.4, 22.0, 22.6, 23.2], note: 'Nothing else to add.', noteAt: 24 },
  { kind: 'lift', t0: 26.4, t1: 30, fi: 0.5, fo: 0.7, ft0: 1, apart: [27, 28, 29, 29.6], pose: [[26.4, { x: 960, y: 540, z: 1, ry: 0, rx: 0, s: 0.6 }], [28, { x: 960, y: 540, z: -40, ry: 0, rx: 0, s: 0.62 }]], film: made },
  { kind: 'ring', t0: 30.4, t1: 33.4, fi: 0.8, fo: 0.8, at: [960, 500, -260], films: ['studio', 'paper', 'mono', 'vivid', 'tech'].map(look) },
  { kind: 'drawings', t0: 34, t1: 36.6, fi: 0.4, fo: 0.7, items: [{ at: 34.3, cap: 'On your desk', icon: 'computer' }, { at: 34.9, cap: 'No cloud', icon: 'no-server' }, { at: 35.5, cap: 'Locked', icon: 'lock' }] },
  { kind: 'figures', t0: 37, t1: 41, fi: 0.3, fo: 0.7, items: [{ t: 37.5, value: '7', cap: 'Looks' }, { t: 38.4, value: '12', cap: 'Sounds' }, { t: 39.2, value: '4K', cap: 'Largest' }] },
  { kind: 'end', t0: 41.4, t1: 46, fi: 0.5, fo: 0.1, name: 'Orbi SQ', line: 'Free, and yours.', footnote: 'An invented product, drawn for a check.' },
];
const CAMERA = [[0, 960, 540, 1, 0, 0, 'inOutCubic'], [4.8, 960, 540, 1.03, -1.5, 0.5, 'inOutSine'], [9.6, 960, 540, 1, 0, 0, 'inOutCubic'], [26.4, 960, 540, 1.2, 4, -2, 'inOutCubic'], [46, 960, 540, 1.03, 0, 0, 'inOutSine']];
const ASSETS = { mark: { kind: 'image', name: 'Invented mark', data: 'data:image/png;base64,iVBORw0KGgo=', width: 320, height: 320 } };
const DOC = { title: 'Orbi SQ', aspect: '16:9', palette: { accent: '#3f7be9', accent2: '#d9b26a' }, assets: ASSETS, scenes: [{ id: 'whole', duration: 46, layers: [] }], stage: { camera: CAMERA, parts: PARTS } };

section('The stage keeps every field of every part (the stage field guard)');
const once = normalizeScene(DOC).scene;
const twice = normalizeScene(once).scene;
ok('a stage is kept on the film', !!once.stage && once.stage.parts.length === PARTS.length);
ok('normalising a stage film again changes nothing', JSON.stringify(once) === JSON.stringify(twice));
ok('every kind the format names is in this film', STAGE_PART_KINDS.every((k) => PARTS.some((p) => p.kind === k)));
for (const P of PARTS) {
  const got = once.stage.parts.find((p) => p.kind === P.kind);
  const lost = Object.keys(P).filter((k) => !(k in got));
  ok(`${P.kind}: every field survives`, lost.length === 0, `lost ${lost.join(', ')}`);
}
ok('the camera keys survive in order', JSON.stringify(once.stage.camera) === JSON.stringify(CAMERA));
ok('a part of a kind the format does not know is left out', normalizeScene({ ...DOC, stage: { camera: [], parts: [{ kind: 'sparkle', t0: 0, t1: 1 }] } }).scene.stage.parts.length === 0);
ok('a lifted film with no film is left out', normalizeScene({ ...DOC, stage: { camera: [], parts: [{ kind: 'lift', t0: 0, t1: 1 }] } }).scene.stage.parts.length === 0);
ok('an icon with no picture of the film is left out', normalizeScene({ ...DOC, stage: { camera: [], parts: [{ kind: 'icon', asset: 'nowhere', keys: [] }] } }).scene.stage.parts.length === 0);
ok('a film inside a film carries no stage of its own', !('stage' in normalizeScene({ ...DOC, stage: { parts: [{ kind: 'lift', t0: 0, t1: 1, film: DOC }] } }).scene.stage.parts[0].film));
ok('a film with no stage has none', !('stage' in normalizeScene({ scenes: [{ duration: 2 }] }).scene));

section('A stage film draws through the ordinary renderer');
const icon = fakeCanvas(320, 320);
const kit = createKit(fakeContext(1920, 1080), { width: 1920, height: 1080, palette: once.palette, assets: { mark: icon }, makeCanvas: fakeCanvas });
const R = { renderPlan, activeScenes };
const view = viewFor(1920, 1080);
const frames = [];
await claim('every tenth of a second, from the first frame to the last, draws without fault', () => {
  for (let t = 0; t <= once.duration; t += 0.1) {
    const drawn = renderStage(kit, once, t, R);
    frames.push({ t, drawn });
  }
  assert.ok(frames.length > 400);
});
await claim('renderPlan hands a stage film to the stage', () => {
  const ctx = fakeContext();
  renderPlan(createKit(ctx, { width: 1920, height: 1080, makeCanvas: fakeCanvas, assets: { mark: icon } }), once, 12);
  assert.ok(ctx.calls.some((c) => c[0] === 'drawImage'));
});
await claim('the film opens out of the studio\'s colour and closes back into it', () => {
  const veil = (t) => { const ctx = fakeContext(); renderStage(createKit(ctx, { width: 1920, height: 1080, makeCanvas: fakeCanvas, assets: { mark: icon } }), once, t, R); return ctx.calls.filter((c) => c[0] === 'fillRect').length; };
  assert.ok(veil(0) > veil(20));
  assert.ok(veil(once.duration) > veil(20));
});
ok('the checks see every plane that carries words', (() => { const boxes = []; renderStage(kit, once, 12.5, R, { collect: boxes }); return boxes.some((b) => /Plan/.test(b.text)) && boxes.every((b) => b.kind === 'plane'); })());

section('Nothing flickers');
const flicker = frames.flatMap((f) => coplanarPairs(f.drawn).map((p) => `${f.t.toFixed(1)}: ${p[0]} and ${p[1]}`));
ok('no two planes stand closer than the gap in any frame', flicker.length === 0, flicker.slice(0, 3).join('; '));
ok('the icon is drawn as its stacked copies, behind each other', frames.some((f) => f.drawn.filter((d) => d.plane.group === 'icon').length === ICON_DEPTH.copies));

section('Diagrams keep time with the words');
const planesAt = (t) => stageFrame(once, t, { C: studioColors(once.palette), assets: { mark: icon }, darkened: () => icon, film: () => fakeCanvas(960, 540), filmLayers: () => ({ back: icon, shapes: icon, words: icon }) }).planes;
const steps = once.stage.parts.find((p) => p.kind === 'steps');
ok('each step\'s card is dark before its word and lit after it', steps.at.every((at, i) => {
  const before = planesAt(at - 0.4).find((p) => p.id === `steps-${i}`), after = planesAt(at + 0.6).find((p) => p.id === `steps-${i}`);
  return before.lit === 0 && after.lit > 0.99;
}));
const fig = once.stage.parts.find((p) => p.kind === 'figures');
ok('digits roll only once their tile stands', frames.every((f) => planesAt(f.t).filter((p) => p.id.startsWith('figure-') && p.rolling).every((p) => Math.abs(p.tilt) < 6)));
ok('and every figure does roll', fig.items.every((it, i) => planesAt(it.t + FIGURE.rollFrom + 0.5).find((p) => p.id === `figure-${i}`).rolling));

const hubPart = once.stage.parts.find((p) => p.kind === 'hub');
await claim('every curve from the chip lands on its tile\'s head on the frame', () => {
  const t = hubPart.at.at(-1) + 1;
  const planes = planesAt(t);
  const lines = planes.find((p) => p.id === 'hub-lines');
  const rig = cameraRig({ x: 960, y: 540, zoom: 1.4, ry: 6, rx: -3 }, view);
  lines.ends.forEach(([ex, ey], i) => {
    const tile = planes.find((p) => p.id === `hub-tile-${i}`);
    const a = projectPoint(fullPose(lines.pose), lines.w, lines.h, ex, ey, rig, view);
    const b = projectPoint(fullPose(tile.pose), tile.w, tile.h, tile.w / 2, 0, rig, view);
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) <= 4, `tile ${i} missed by ${Math.hypot(a[0] - b[0], a[1] - b[1]).toFixed(1)}`);
    assert.ok(Math.abs(hubTileX(i, hubPart.tiles.length) - ex) < 1e-6 && HUB.z === tile.pose.z);
  });
});
const ringPart = once.stage.parts.find((p) => p.kind === 'ring');
ok('the ring names its front look only while it rests', (() => {
  const per = (ringPart.t1 - ringPart.t0) / (ringPart.films.length - 0.5);
  // A card after the ring's first turn in: resting, then mid-turn.
  const k = Math.ceil(1.6 / per) + 1;
  const name = (t) => planesAt(t).find((p) => p.id === 'look-name').pose.o;
  return name(ringPart.t0 + per * (k + 0.3)) > 0.5 && name(ringPart.t0 + per * (k + 0.72)) < 0.2;
})());
ok('a lifted film parts into three planes, the words nearest', (() => {
  const ps = planesAt(28.5).filter((p) => p.id.startsWith('lift-'));
  return ps.length === 3 && ps[0].pose.z < ps[1].pose.z && ps[1].pose.z < ps[2].pose.z && ps[2].pose.z - ps[1].pose.z > 200;
})());

section('Names spelled out');
ok('the capitals of a name mark the words they stand for', JSON.stringify(initialsMarks('Hash LMG', ['Hash', 'Local', 'Motion', 'Graphics'])) === JSON.stringify([false, true, true, true]));
ok('a name with no capitals marks nothing', initialsMarks('Orbi', ['Orbi', 'Sound']).every((m) => !m));
ok('a stage at a 4K frame draws the same planes', (() => {
  const k4 = createKit(fakeContext(3840, 2160), { width: 3840, height: 2160, makeCanvas: fakeCanvas, assets: { mark: icon } });
  const a = renderStage(k4, once, 12, R).map((d) => d.id).join(), b = renderStage(kit, once, 12, R).map((d) => d.id).join();
  return a === b && a.length > 0;
})());
ok('a stage can be drawn by a stage of its own too', createStage({ makeCanvas: fakeCanvas }).draw(fakeContext(), stageFrame(once, 12, { C: studioColors({}), assets: {}, darkened: () => icon }), view).length > 0);

done();
