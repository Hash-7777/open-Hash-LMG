// The 3D stage: planes are projected where a browser's own 3D transforms
// would put them, the camera's zoom is a dolly, planes turned away or behind
// the camera are not drawn, the nearest plane is drawn last, a laid picture
// is never off its true projection by more than half a pixel, a fading plane
// fades as one picture, and stacked planes standing too close are named.

import { section, ok, claim, done } from './lib/check.mjs';
import assert from 'node:assert/strict';
import { fakeContext } from './lib/fake-canvas.mjs';
import {
  createStage, viewFor, cameraRig, projectPlane, projectPoint, cameraAt, keysAt, gridFor,
  affineFrom, planeNormal, fullPose, PERSPECTIVE,
} from '../../src/core/engine/stage3d.js';
import { coplanarPairs } from '../../src/core/engine/stage-rules.js';

// ---- an independent projection: the 4 by 4 matrices a page would compose for
// the same planes (a plane's transform about its centre inside a world element
// that holds the camera, under a perspective centred on the frame).
const I = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const mul = (A, B) => { const C = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) C[r * 4 + c] += A[r * 4 + k] * B[k * 4 + c]; return C; };
const T = (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
const S = (s) => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];
const rad = (d) => (d * Math.PI) / 180;
const RX = (d) => { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1]; };
const RY = (d) => { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1]; };
const RZ = (d) => { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; };
const PERSP = (d) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -1 / d, 1];
const chain = (...ms) => ms.reduce((a, b) => mul(a, b), I());
function reference(pose, w, h, cam, px, py) {
  const p = fullPose(pose);
  const plane = chain(T(w / 2, h / 2, 0), T(p.x - w / 2, p.y - h / 2, p.z), RY(p.ry), RX(p.rx), RZ(p.rz), S(p.s), T(-w / 2, -h / 2, 0));
  const dolly = PERSPECTIVE * (1 - 1 / cam.zoom);
  const world = chain(T(960, 540, 0), T(0, 0, dolly), RX(cam.rx), RY(cam.ry), T(-cam.x, -cam.y, 0));
  const M = chain(T(960, 540, 0), PERSP(PERSPECTIVE), T(-960, -540, 0), world, plane);
  const v = [px, py, 0, 1];
  const o = [0, 1, 2, 3].map((r) => M[r * 4] * v[0] + M[r * 4 + 1] * v[1] + M[r * 4 + 2] * v[2] + M[r * 4 + 3] * v[3]);
  return [o[0] / o[3], o[1] / o[3]];
}

const view = viewFor(1920, 1080);
let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const between = (a, b) => a + (b - a) * rnd();

section('Planes land where a page\'s own 3D transforms put them');
await claim('two hundred planes in random poses under random cameras agree within a hundredth of a pixel', () => {
  for (let n = 0; n < 200; n++) {
    const pose = { x: between(300, 1600), y: between(200, 900), z: between(-1200, 300), rx: between(-60, 60), ry: between(-70, 70), rz: between(-20, 20), s: between(0.6, 1.4) };
    const cam = { x: between(700, 1200), y: between(400, 700), zoom: between(0.6, 1.8), ry: between(-25, 25), rx: between(-12, 12) };
    const w = between(100, 900), h = between(100, 700);
    const rig = cameraRig(cam, view);
    for (const [px, py] of [[0, 0], [w, 0], [w, h], [0, h], [w * 0.3, h * 0.7]]) {
      const got = projectPoint(fullPose(pose), w, h, px, py, rig, view);
      if (!got) continue;
      const want = reference(pose, w, h, cam, px, py);
      assert.ok(Math.hypot(got[0] - want[0], got[1] - want[1]) < 0.01, `off by ${Math.hypot(got[0] - want[0], got[1] - want[1])}`);
    }
  }
});
await claim('an unturned plane the size of the frame, at depth 0, fills the frame exactly', () => {
  const pr = projectPlane(fullPose({}), 1920, 1080, cameraRig({ x: 960, y: 540, zoom: 1 }, view), view);
  assert.deepEqual(pr.corners.map((c) => c.slice(0, 2).map((v) => Math.round(v * 1000) / 1000)), [[0, 0], [1920, 0], [1920, 1080], [0, 1080]]);
});
await claim('zoom 2 is a dolly: depth 0 doubles, a plane farther back grows by less', () => {
  const rig = cameraRig({ x: 960, y: 540, zoom: 2 }, view);
  const near = projectPlane(fullPose({}), 200, 200, rig, view).corners;
  const far = projectPlane(fullPose({ z: -1000 }), 200, 200, rig, view).corners;
  const farAt1 = projectPlane(fullPose({ z: -1000 }), 200, 200, cameraRig({ x: 960, y: 540, zoom: 1 }, view), view).corners;
  assert.ok(Math.abs(near[1][0] - near[0][0] - 400) < 1e-6);
  const g = (far[1][0] - far[0][0]) / (farAt1[1][0] - farAt1[0][0]);
  assert.ok(g > 1 && g < 2, `grew ${g}`);
});
await claim('a 4K frame shows the same picture at twice the size', () => {
  const v4 = viewFor(3840, 2160);
  const pose = fullPose({ x: 700, y: 300, z: -200, ry: 30 });
  const a = projectPlane(pose, 400, 300, cameraRig({ x: 960, y: 540, zoom: 1.2, ry: 5 }, view), view).corners;
  const b = projectPlane(pose, 400, 300, cameraRig({ x: 960, y: 540, zoom: 1.2, ry: 5 }, v4), v4).corners;
  a.forEach((p, i) => assert.ok(Math.abs(b[i][0] - p[0] * 2) < 1e-6 && Math.abs(b[i][1] - p[1] * 2) < 1e-6));
});

section('Facing, depth and order');
const rig0 = cameraRig({ x: 960, y: 540, zoom: 1 }, view);
ok('a plane turned 120 degrees shows its back and is not drawn', projectPlane(fullPose({ ry: 120 }), 300, 300, rig0, view).facing === false);
ok('a plane turned 60 degrees still faces the camera', projectPlane(fullPose({ ry: 60 }), 300, 300, rig0, view).facing === true);
ok('a plane behind the camera is not drawn', projectPlane(fullPose({ z: 2600 }), 300, 300, rig0, view).corners === null);
ok('a plane that has not turned faces the viewer', planeNormal(fullPose({})).every((v, i) => Math.abs(v - [0, 0, 1][i]) < 1e-9));

const fakeCanvas = (w, h) => { const c = { width: w, height: h }; c.ctx = fakeContext(w, h); c.getContext = () => c.ctx; return c; };
const painted = [];
const plane = (id, pose, extra = {}) => ({ id, w: 300, h: 200, res: 1, pose, paint: () => painted.push(id), ...extra });
await claim('planes are drawn far to near, and planes at one depth keep their order', () => {
  painted.length = 0;
  const st = createStage({ makeCanvas: fakeCanvas });
  const drawn = st.draw(fakeContext(), { camera: { x: 960, y: 540, zoom: 1 }, planes: [plane('near', { z: 200 }), plane('far', { z: -800 }), plane('mid1', { z: 0, x: 600 }), plane('mid2', { z: 0, x: 1300 })] }, view);
  assert.deepEqual(drawn.map((d) => d.id), ['far', 'mid1', 'mid2', 'near']);
  assert.deepEqual(painted, ['far', 'mid1', 'mid2', 'near']);
});
await claim('a plane at no opacity is not painted at all', () => {
  painted.length = 0;
  createStage({ makeCanvas: fakeCanvas }).draw(fakeContext(), { camera: {}, planes: [plane('gone', { o: 0 })] }, view);
  assert.deepEqual(painted, []);
});

section('A laid picture stays on its true projection');
await claim('a plane facing the camera is laid as one picture, with no seams', () => {
  const pr = projectPlane(fullPose({}), 400, 300, rig0, view);
  assert.equal(gridFor(pr.corners), 1);
});
await claim('turned harder, the grid grows, up to its limit', () => {
  const g = [0, 20, 40, 60, 75].map((ry) => gridFor(projectPlane(fullPose({ ry, z: 300 }), 900, 600, rig0, view).corners));
  for (let i = 1; i < g.length; i++) assert.ok(g[i] >= g[i - 1], g.join(' '));
  assert.ok(g[4] > 1 && g[4] <= 16, g.join(' '));
});
await claim('inside every cell, the laid point is within half a pixel of the true one', () => {
  for (const pose of [{ ry: 50, z: 200 }, { rx: 60, y: 800 }, { ry: -35, rx: 25, rz: 10, z: -300 }]) {
    const P = fullPose(pose), w = 900, h = 600;
    const at = (fx, fy) => projectPoint(P, w, h, fx * w, fy * h, rig0, view);
    const n = gridFor(projectPlane(P, w, h, rig0, view).corners);
    if (n >= 16) continue;
    for (let k = 0; k < 400; k++) {
      const fx = rnd(), fy = rnd();
      const i = Math.min(n - 1, Math.floor(fx * n)), j = Math.min(n - 1, Math.floor(fy * n));
      const lx = fx * n - i, ly = fy * n - j;
      const upper = lx >= ly;
      const s = [[i / n, j / n], [(i + 1) / n, (j + 1) / n], upper ? [(i + 1) / n, j / n] : [i / n, (j + 1) / n]];
      const m = affineFrom(s[0], s[1], s[2], at(...s[0]), at(...s[1]), at(...s[2]));
      const laid = [m[0] * fx + m[2] * fy + m[4], m[1] * fx + m[3] * fy + m[5]];
      const truth = at(fx, fy);
      assert.ok(Math.hypot(laid[0] - truth[0], laid[1] - truth[1]) <= 0.5, `${JSON.stringify(pose)} off by ${Math.hypot(laid[0] - truth[0], laid[1] - truth[1]).toFixed(3)}`);
    }
  }
});
await claim('a flat plane\'s picture is drawn once, its corners exactly on the projected ones', () => {
  const ctx = fakeContext();
  const st = createStage({ makeCanvas: fakeCanvas });
  const [d] = st.draw(ctx, { camera: { x: 960, y: 540, zoom: 1.3 }, planes: [plane('flat', { x: 700, y: 400, z: -100 })] }, view);
  const draws = ctx.calls.filter((c) => c[0] === 'drawImage');
  assert.equal(draws.length, 1);
  const [, , m, args] = draws[0];
  const [, , sw, sh] = args;
  const put = (u, v) => [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]];
  [[0, 0], [sw, 0], [sw, sh], [0, sh]].forEach(([u, v], i) => { const p = put(u, v); assert.ok(Math.hypot(p[0] - d.corners[i][0], p[1] - d.corners[i][1]) < 1e-6); });
});

section('Opacity, shadows and the same frame twice');
await claim('a fading turned plane is laid at full strength aside, then drawn once at its opacity', () => {
  const ctx = fakeContext();
  createStage({ makeCanvas: fakeCanvas }).draw(ctx, { camera: {}, planes: [plane('fade', { ry: 45, o: 0.4 })] }, view);
  const draws = ctx.calls.filter((c) => c[0] === 'drawImage');
  assert.equal(draws.length, 1);
  assert.ok(Math.abs(draws[0][1] - 0.4) < 1e-9);
});
await claim('a plane with a shadow has its two shades cast first, under it; one without has none', () => {
  const ctx = fakeContext();
  createStage({ makeCanvas: fakeCanvas }).draw(ctx, { camera: {}, planes: [plane('lit', {}, { shadow: 1, radius: 16 })] }, view);
  assert.deepEqual(ctx.calls.map((c) => c[0]).filter((k) => k === 'fill' || k === 'drawImage'), ['fill', 'fill', 'drawImage']);
  const ctx2 = fakeContext();
  createStage({ makeCanvas: fakeCanvas }).draw(ctx2, { camera: {}, planes: [plane('plain', {})] }, view);
  assert.deepEqual(ctx2.calls.map((c) => c[0]).filter((k) => k === 'fill' || k === 'drawImage'), ['drawImage']);
});
await claim('the same frame drawn twice, by one stage or by two, makes the same calls', () => {
  const frame = { camera: { x: 900, y: 520, zoom: 1.4, ry: 6, rx: -3 }, planes: [plane('a', { ry: 30, z: -200 }, { shadow: 0.8 }), plane('b', { rx: 50, o: 0.6 }), plane('c', { x: 1400, z: 100 })] };
  const st = createStage({ makeCanvas: fakeCanvas });
  const one = fakeContext(), two = fakeContext(), three = fakeContext();
  st.draw(one, frame, view); st.draw(two, frame, view);
  createStage({ makeCanvas: fakeCanvas }).draw(three, frame, view);
  assert.equal(JSON.stringify(one.calls), JSON.stringify(two.calls));
  assert.equal(JSON.stringify(one.calls), JSON.stringify(three.calls));
});

section('Rules a stage is held to');
const drawnFor = (planes) => createStage({ makeCanvas: fakeCanvas }).draw(fakeContext(), { camera: {}, planes }, view);
ok('two planes stacked 2 pixels apart are named as flickering', coplanarPairs(drawnFor([plane('a', { z: 0 }), plane('b', { z: 2 })])).length === 1);
ok('stacked 3 pixels apart, they are not', coplanarPairs(drawnFor([plane('a', { z: 0 }), plane('b', { z: 3 })])).length === 0);
ok('side by side at one depth, they are not', coplanarPairs(drawnFor([plane('a', { x: 400 }), plane('b', { x: 1500 })])).length === 0);
ok('turned the same way and stacked along that turn, they are named', coplanarPairs(drawnFor([plane('a', { ry: 30 }), plane('b', { ry: 30, x: 960 + Math.sin(Math.PI / 6), z: Math.cos(Math.PI / 6) })])).length === 1);

section('Keys');
await claim('the camera eases between keys on each key\'s own ease, and its zoom on a log scale', () => {
  const K = [[0, 960, 540, 1, 0, 0], [2, 960, 540, 4, 10, 0, 'linear']];
  assert.ok(Math.abs(cameraAt(K, 1).zoom - 2) < 1e-9);
  assert.ok(Math.abs(cameraAt(K, 1).ry - 5) < 1e-9);
  assert.deepEqual(cameraAt(K, 5), { x: 960, y: 540, zoom: 4, ry: 10, rx: 0 });
  assert.deepEqual(cameraAt(K, -1), { x: 960, y: 540, zoom: 1, ry: 0, rx: 0 });
});
await claim('pose keys ease every field, hold before the first and after the last', () => {
  const K = [[1, { x: 0, o: 0 }], [3, { x: 100, o: 1 }]];
  assert.deepEqual(keysAt(K, 0), { x: 0, o: 0 });
  assert.equal(keysAt(K, 2).x, 50);
  assert.deepEqual(keysAt(K, 9), { x: 100, o: 1 });
});

done();
