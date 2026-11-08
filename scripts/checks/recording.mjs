// Recordings on the stage: a map takes film time to clip time and never plays
// slower than the recording, the stage asks for exactly the frames it shows,
// the pointer lands on each mark a moment early with a ring on each click, a
// lifted piece starts exactly over its place on the screen and a gap in front
// of it, and a frame unlike both its neighbours is found.

import { section, ok, claim, done } from './lib/check.mjs';
import assert from 'node:assert/strict';
import { clipTime, mapProblems, stageClipsAt, pointerAt, flashFrames, frameDiff, recordingKey } from '../../src/core/engine/recording.js';
import { display, SCREEN, cropInside } from '../../src/core/engine/stage-display.js';
import { planePoint, planeNormal, fullPose, MIN_GAP } from '../../src/core/engine/stage3d.js';
import { studioColors, ramp } from '../../src/core/engine/stage-paint.js';
import { normalizeScene } from '../../src/core/scene/normalize.js';

section('Film time to clip time');
const MAP = [[10, 2], [12, 6], [14, 8], [14.7, 8]];
ok('straight between keys', Math.abs(clipTime(MAP, 11) - 4) < 1e-9 && Math.abs(clipTime(MAP, 13) - 7) < 1e-9);
ok('at real speed before the first key', Math.abs(clipTime(MAP, 9) - 1) < 1e-9);
ok('the last frame held through the fade', clipTime(MAP, 14.5) === 8);
ok('a map that plays twice as fast, then real time, then holds, is sound', mapProblems(MAP).length === 0);
ok('a stretch slower than the recording is refused', mapProblems([[0, 0], [2, 1]]).some((p) => /slower/.test(p)));
ok('a stretch that runs backward is refused', mapProblems([[0, 4], [1, 3]]).some((p) => /backward/.test(p)));
ok('a hold before the end is refused', mapProblems([[0, 0], [1, 1], [2, 1], [3, 2]]).some((p) => /holds/.test(p)));

section('The frames a stage asks for');
const DOC = normalizeScene({
  scenes: [{ id: 'all', duration: 20 }],
  assets: { take: { kind: 'video', name: 'Invented take', media: '0123456789abcdef01234567', duration: 9, width: 1920, height: 1200 } },
  stage: { camera: [], parts: [{ kind: 'display', t0: 0, t1: 20, keys: [[0, { o: 0 }], [9.5, { o: 0 }], [10, { o: 1 }], [15, { o: 1 }], [15.5, { o: 0 }]], recordings: [{ asset: 'take', t0: 10, t1: 14, fi: 0.6, fo: 0.6, map: MAP, points: [{ t: 3, x: 0.2, y: 0.3, click: false }, { t: 5, x: 0.6, y: 0.5, click: true }, { t: 6, x: null, y: null }] }], pieces: [{ rec: 0, t0: 11, t1: 13.8, crop: [0.4, 0.05, 0.27, 0.44], grow: 0.08 }] }] },
}).scene;
ok('a display survives normalising with its recording and piece', DOC.stage.parts[0].recordings.length === 1 && DOC.stage.parts[0].pieces.length === 1 && cropInside(DOC.stage.parts[0].pieces[0].crop));
ok('normalising again changes nothing', JSON.stringify(normalizeScene(DOC).scene) === JSON.stringify(DOC));
ok('a recording of a picture, not a clip, is left out', normalizeScene({ scenes: [{ duration: 5 }], stage: { parts: [{ kind: 'display', recordings: [{ asset: 'nothing' }] }] } }).scene.stage.parts.length === 0);
await claim('one frame, keyed for its display and recording, at its clip time and speed', () => {
  const c = stageClipsAt(DOC, 11);
  assert.equal(c.length, 1);
  assert.equal(c[0].key, recordingKey(0, 0));
  assert.ok(Math.abs(c[0].time - 4) < 1e-9);
  assert.ok(Math.abs(c[0].rate - 2) < 1e-6);
});
ok('none while the screen is away', stageClipsAt(DOC, 5).length === 0);
ok('none once the recording has faded', stageClipsAt(DOC, 14.9).length === 0);
ok('a clip time is held inside the clip', stageClipsAt({ ...DOC, assets: { take: { ...DOC.assets.take, duration: 5 } } }, 13).every((c) => c.time <= 5));

section('The pointer');
const P = DOC.stage.parts[0].recordings[0].points;
ok('no pointer long before the first mark', pointerAt(P, 1) === null);
ok('on the first mark at its time', (() => { const a = pointerAt(P, 3); return Math.abs(a.x - 0.2) < 1e-9 && Math.abs(a.y - 0.3) < 1e-9; })());
ok('on the next mark a tenth of a second early', (() => { const a = pointerAt(P, 4.9); return Math.abs(a.x - 0.6) < 1e-6 && Math.abs(a.y - 0.5) < 1e-6; })());
ok('moving between them on the way', (() => { const a = pointerAt(P, 4.5); return a.x > 0.2 && a.x < 0.6; })());
ok('a ring opens on a click, and only on a click', pointerAt(P, 5.2).rings.length === 1 && pointerAt(P, 3.2).rings.length === 0 && pointerAt(P, 5.7).rings.length === 0);
ok('a mark with no place moves nothing', (() => { const a = pointerAt(P, 6.5); return Math.abs(a.x - 0.6) < 1e-9; })());

section('A piece lifts from its place');
const env = { C: studioColors({}), assets: {} };
const part = DOC.stage.parts[0];
await claim('as it starts to lift, it sits over its place on the screen, a gap in front and rising', () => {
  const t = 11.2, up = ramp(t, 11, 11 + SCREEN.settle);
  const planes = display(part, t, 1, env, 0);
  const screen = planes.find((p) => p.kind === 'display'), piece = planes.find((p) => p.kind === 'piece');
  const [fx, fy, fw, fh] = part.pieces[0].crop;
  const place = planePoint(fullPose(screen.pose), SCREEN.w, SCREEN.h, (fx + fw / 2) * SCREEN.w, (fy + fh / 2) * SCREEN.h);
  const n = planeNormal(fullPose(screen.pose));
  const d = [piece.pose.x - place[0], piece.pose.y - place[1], piece.pose.z - place[2]];
  const along = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
  const want = MIN_GAP + (SCREEN.lift - MIN_GAP) * up;
  assert.ok(up < 0.1 && Math.abs(along - want) < 1, `stands ${along.toFixed(2)} in front, ${want.toFixed(2)} wanted`);
  assert.ok(Math.abs(piece.pose.ry - screen.pose.ry) < 0.5);
  assert.ok(Math.abs(piece.w - fw * SCREEN.w) < 1e-9 && Math.abs(piece.h - fh * SCREEN.h) < 1e-9);
});
ok('fully lifted, it has lost the screen\'s turn and come toward the camera', (() => {
  const piece = display(part, 12.4, 1, env, 0).find((p) => p.kind === 'piece');
  return piece.pose.ry === 0 && piece.pose.rx === 0 && piece.pose.z > 100;
})());
ok('it settles back before its end and is gone after', display(part, 13.85, 1, env, 0).every((p) => p.kind !== 'piece'));
ok('with the screen away, neither is drawn', display(part, 16, 1, env, 0).length === 0);

section('Frames that flash');
const grey = (v) => new Uint8Array(96 * 54).fill(v);
const clip = [grey(100), grey(101), grey(10), grey(102), grey(103), grey(160), grey(161)];
const diffs = clip.map((f, i) => (i ? frameDiff(f, clip[i - 1]) : 0));
const skips = clip.map((f, i) => (i && i + 1 < clip.length ? frameDiff(clip[i + 1], clip[i - 1]) : 0));
ok('a black frame between two alike is found', JSON.stringify(flashFrames(diffs, skips)) === '[2]');
ok('a cut to a new picture is not a flash', !flashFrames(diffs, skips).includes(5));

done();
