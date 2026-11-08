// Real recordings of a product on the stage: which moment of a clip shows at
// each moment of the film, the pointer that moves between the recording's
// marks, and the frames a stage needs from its clips.
//
// A recording on the stage: { asset, t0, t1, fi, fo, map, points }
//   map     [[filmT, clipT], ...]: film time to clip time, straight between
//           keys and at real speed past the last one. A stretch may play faster
//           than the recording, never slower (slow motion reads as padding); a
//           flat last stretch holds the last frame while the recording fades.
//   points  the recording's marks: { t (clip time), x, y (shares of the frame,
//           or null), click }. The pointer glides between marks that have a
//           place and a soft ring opens on each click.

import { clamp, mix } from './math.js';
import { ease } from './ease.js';
import { keysAt } from './stage3d.js';

// The clip time at film time t.
export function clipTime(map, t) {
  if (!map || !map.length) return t;
  if (t <= map[0][0]) return map[0][1] - (map[0][0] - t);
  for (let i = 1; i < map.length; i++) {
    if (t <= map[i][0]) {
      const [a, x] = map[i - 1], [b, y] = map[i];
      return x + (y - x) * clamp((t - a) / ((b - a) || 1e-6));
    }
  }
  const [a, x] = map[map.length - 1];
  return x + (t - a);
}

// What is wrong with a map: a stretch slower than the recording, a stretch
// that runs backward, or a hold anywhere but at the end.
export function mapProblems(map) {
  const out = [];
  for (let i = 1; i < (map || []).length; i++) {
    const [a, x] = map[i - 1], [b, y] = map[i];
    const speed = (y - x) / ((b - a) || 1e-9);
    if (b <= a) out.push(`keys ${i - 1} and ${i} are not in time order`);
    else if (speed < -1e-6) out.push(`the stretch from ${a.toFixed(2)} s runs backward`);
    else if (speed < 1e-6) { if (i !== map.length - 1) out.push(`the stretch from ${a.toFixed(2)} s holds before the end`); }
    else if (speed < 1 - 1e-3) out.push(`the stretch from ${a.toFixed(2)} s plays slower than the recording`);
  }
  return out;
}

// Is the recording on screen at t (from its start to the end of its fade)?
export const recordingLive = (r, t) => t >= r.t0 - 0.01 && t <= r.t1 + (r.fo ?? 0.6) + 0.01;

// The frames a stage needs at film time t: [{ key, asset, time, rate }], one
// for each recording on screen on a visible display. A lifted piece shows the
// same frame as its display, so it needs none of its own.
export function stageClipsAt(doc, t) {
  const out = [];
  (doc.stage?.parts || []).forEach((P, pi) => {
    if (P.kind !== 'display') return;
    const pose = keysAt(P.keys, t);
    if (!pose || (pose.o ?? 1) <= 0.001) return;
    (P.recordings || []).forEach((r, ri) => {
      if (!recordingLive(r, t)) return;
      const a = doc.assets?.[r.asset];
      if (!a || a.kind !== 'video') return;
      const end = Math.max(0, (a.duration || Infinity) - 0.04);
      const time = clamp(clipTime(r.map, t), 0, end);
      const rate = Math.max(0, clipTime(r.map, t + 0.05) - clipTime(r.map, t)) / 0.05;
      out.push({ key: recordingKey(pi, ri), asset: r.asset, time, rate: rate || 1 });
    });
  });
  return out;
}
export const recordingKey = (part, rec) => `rec:${part}:${rec}`;

// Where the pointer is at clip time rt, as shares of the frame, and the click
// rings open at that moment: { x, y, rings: [{ x, y, p }] } or null before the
// first mark. It arrives a little early, never takes more than 0.75 s between
// marks, and drifts in from the lower right before the first.
export function pointerAt(points, rt) {
  const P = (points || []).filter((p) => p.x !== null && p.x !== undefined && p.y !== null && p.y !== undefined);
  if (!P.length || rt < P[0].t - 1.2) return null;
  let i = P.findIndex((p) => p.t > rt);
  if (i < 0) i = P.length;
  const cur = P[Math.max(0, i - 1)], nxt = P[i];
  let x = cur.x, y = cur.y;
  if (i === 0) {
    const f = ease.inOutCubic(clamp((rt - (nxt.t - 1.0)) / 0.85));
    x = mix(nxt.x + 0.04, nxt.x, f); y = mix(nxt.y + 0.06, nxt.y, f);
  } else if (nxt) {
    const span = Math.min(0.75, nxt.t - cur.t);
    const f = ease.inOutCubic(clamp((rt - (nxt.t - span - 0.1)) / (span || 1e-6)));
    x = mix(cur.x, nxt.x, f); y = mix(cur.y, nxt.y, f);
  }
  const rings = P.filter((p) => p.click && rt >= p.t && rt <= p.t + 0.6).map((p) => ({ x: p.x, y: p.y, p: (rt - p.t) / 0.6 }));
  return { x, y, rings };
}

// Draws the pointer into a w by h picture of the recording: an arrow in ink
// with a white edge, and a soft ring in the second accent at each click.
export function drawPointer(g, at, w, h, accent2 = '#d9b26a') {
  if (!at) return;
  for (const r of at.rings) {
    g.save();
    g.globalAlpha *= (1 - r.p) * 0.6;
    g.strokeStyle = accent2; g.lineWidth = 2;
    g.beginPath(); g.arc(r.x * w, r.y * h, 8 + 22 * ease.outCubic(r.p), 0, Math.PI * 2); g.stroke();
    g.restore();
  }
  g.save();
  g.translate(at.x * w, at.y * h);
  g.shadowColor = 'rgba(0,0,0,0.25)'; g.shadowBlur = 4; g.shadowOffsetY = 1;
  g.beginPath();
  for (const [i, [px, py]] of [[0, 0], [0, 22], [5.5, 17], [9.5, 26], [13, 24.5], [9, 16], [16, 16]].entries()) i ? g.lineTo(px, py) : g.moveTo(px, py);
  g.closePath();
  g.fillStyle = '#111'; g.fill();
  g.shadowColor = 'transparent';
  g.strokeStyle = '#fff'; g.lineWidth = 1.6; g.stroke();
  g.restore();
}

// Frames that flash: a frame unlike both its neighbours while they match each
// other. diffs[i] is how much frame i differs from frame i - 1 (mean
// luminance, 0..255) and skips[i] how much frame i + 1 differs from frame i - 1.
export function flashFrames(diffs, skips, { flash = 6, still = 2 } = {}) {
  const out = [];
  for (let i = 1; i + 1 < diffs.length; i++) if (diffs[i] > flash && diffs[i + 1] > flash && skips[i] < still) out.push(i);
  return out;
}

// The mean luminance difference of two small grey pictures of one size.
export function frameDiff(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / Math.max(1, a.length);
}
