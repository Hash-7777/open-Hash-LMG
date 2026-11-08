// The display: the real product, recorded, standing in the room on a screen
// of its own, with parts of it lifting out toward the camera.
//
// part: {
//   keys:       [[t, { o, x, y, z, ry, rx }]]  the screen flying in and out of depth
//   recordings: [{ asset, t0, t1, fi, fo, map, points }]  (recording.js)
//   pieces:     [{ rec, t0, t1, crop: [fx, fy, fw, fh], grow }]
// }
// A piece is a crop of its recording's frame at the same moment, drawn at
// full resolution exactly over its place on the screen, which lifts toward the
// camera, grows a little, loses the screen's turn, and settles back in its
// last 0.9 s. A piece belongs to its screen: while the screen or its recording
// is not on screen, neither is the piece.

import { keysAt, fullPose, planePoint, planeNormal, MIN_GAP } from './stage3d.js';
import { clipTime, pointerAt, drawPointer, recordingLive, recordingKey } from './recording.js';
import { ramp, win, kitFor, withAlphaHex } from './stage-paint.js';

export const SCREEN = { w: 1500, h: 937.5, radius: 12, lift: 140, settle: 0.9 };

function frameOf(env, partIndex, ri) { return env.assets?.[recordingKey(partIndex, ri)] || null; }

// Draws a recording's frame, or the part of it in crop, into a w by h box.
function drawFrame(g, img, w, h, crop = [0, 0, 1, 1], alpha = 1) {
  if (!img || alpha <= 0) return;
  const iw = img.width || img.displayWidth || w, ih = img.height || img.displayHeight || h;
  g.save();
  g.globalAlpha *= alpha;
  g.drawImage(img, crop[0] * iw, crop[1] * ih, crop[2] * iw, crop[3] * ih, 0, 0, w, h);
  g.restore();
}

export function display(part, t, a, env, partIndex = 0) {
  const v = keysAt(part.keys, t);
  if (!v) return [];
  const pose = fullPose({ ...v, o: (v.o ?? 1) * a });
  const live = (part.recordings || []).map((r, ri) => ({ r, ri })).filter(({ r }) => recordingLive(r, t));
  if (!live.length || pose.o <= 0.001) return [];
  const { C } = env;
  const out = [{
    id: `display-${partIndex}`, w: SCREEN.w, h: SCREEN.h, res: 1.92, pose, radius: SCREEN.radius, shadow: 1, kind: 'display',
    paint(g) {
      g.save();
      g.beginPath();
      if (g.roundRect) g.roundRect(0, 0, SCREEN.w, SCREEN.h, SCREEN.radius); else g.rect(0, 0, SCREEN.w, SCREEN.h);
      g.clip();
      g.fillStyle = C.display;
      g.fillRect(0, 0, SCREEN.w, SCREEN.h);
      for (const { r, ri } of live) {
        const al = win(t, r.t0, r.t1 + (r.fo ?? 0.6), r.fi ?? 0.6, r.fo ?? 0.6);
        drawFrame(g, frameOf(env, partIndex, ri), SCREEN.w, SCREEN.h, undefined, al);
        g.save(); g.globalAlpha *= al; drawPointer(g, pointerAt(r.points, clipTime(r.map, t)), SCREEN.w, SCREEN.h, C.accent2); g.restore();
      }
      g.restore();
      kitFor(g).rect(0.5, 0.5, SCREEN.w - 1, SCREEN.h - 1, { fill: null, stroke: withAlphaHex(C.ink, 0.1), width: 1, radius: SCREEN.radius });
    },
  }];
  // The pieces: each over its place on the screen, a gap in front of it.
  const n = planeNormal(pose);
  for (const [k, p] of (part.pieces || []).entries()) {
    if (t < p.t0 || t > p.t1) continue;
    const rec = live.find(({ ri }) => ri === p.rec);
    if (!rec) continue;
    const up = ramp(t, p.t0, p.t0 + SCREEN.settle) * (1 - ramp(t, p.t1 - SCREEN.settle, p.t1));
    if (up <= 0.01) continue;
    const [fx, fy, fw, fh] = p.crop;
    const bw = fw * SCREEN.w, bh = fh * SCREEN.h;
    const at = planePoint(pose, SCREEN.w, SCREEN.h, (fx + fw / 2) * SCREEN.w, (fy + fh / 2) * SCREEN.h);
    const lift = MIN_GAP + (SCREEN.lift - MIN_GAP) * up;
    out.push({
      id: `piece-${partIndex}-${k}`, w: bw, h: bh, res: 2, radius: 10, kind: 'piece', parent: `display-${partIndex}`,
      shadow: 0.4 + up,
      pose: { x: at[0] + n[0] * lift * (1 - up), y: at[1] + n[1] * lift * (1 - up), z: at[2] + n[2] * lift * (1 - up) + lift * up, ry: pose.ry * (1 - up), rx: pose.rx * (1 - up), rz: 0, s: (1 + (p.grow ?? 0.08) * up) * (pose.s ?? 1), o: pose.o },
      paint(g) {
        g.save();
        g.beginPath();
        if (g.roundRect) g.roundRect(0, 0, bw, bh, 10); else g.rect(0, 0, bw, bh);
        g.clip();
        g.fillStyle = C.piece;
        g.fillRect(0, 0, bw, bh);
        drawFrame(g, frameOf(env, partIndex, rec.ri), bw, bh, p.crop);
        g.restore();
      },
    });
  }
  return out;
}

// How a piece's place on its screen is checked: the share of the screen it
// covers must lie inside the screen.
export const cropInside = (c) => c.length === 4 && c.every((v) => v >= 0) && c[0] + c[2] <= 1 + 1e-9 && c[1] + c[3] <= 1 + 1e-9 && c[2] > 0 && c[3] > 0;
