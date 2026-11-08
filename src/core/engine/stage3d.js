// The 3D stage: flat planes standing in a room, filmed by one camera that
// moves in depth, drawn on a plain 2D canvas.
//
// The render worker draws on an OffscreenCanvas, so the stage does its own
// projection: every plane's corners (and a grid inside it) are taken through
// the plane's pose and the camera, divided by depth, and the plane's picture
// is laid onto the result as small affine triangles. The grid grows with the
// turn until no point is more than half a pixel off its true position (up to
// MAX_GRID cells a side), so a plane turned hard still reads as flat. It uses
// only plain 2D canvas calls, so the same code runs in the worker, in a web
// view and against the checks' stand-in canvas.
//
// World units are pixels of a 1920 by 1080 frame; (960, 540) is its centre.
// Every angle is in degrees and follows the screen convention: y points down,
// z points toward the viewer, rx > 0 tips a plane's top away, ry > 0 turns its
// right edge away.
//
// A pose:   { x, y, z, rx, ry, rz, s, o }  the plane's centre, turns, scale, opacity
// A camera: { x, y, zoom, ry, rx }         the world point it centres on, a dolly
//                                          (zoom 2 brings depth 0 to twice its size,
//                                          by moving the camera, never by scaling),
//                                          and its own turns
// A plane:  { id, w, h, res, pose, shadow, radius, paint(g) }
//           drawn by paint into its own canvas in its own pixels (0..w, 0..h),
//           at res times its size; shadow is the depth of its soft shadow (0, none)
//
// Nothing here keeps state that changes a picture: the canvases kept between
// frames are only reused, and every frame paints them again.

import { clamp, mix } from './math.js';
import { resolveEase } from './ease.js';

export const PERSPECTIVE = 2200;
export const WORLD = { w: 1920, h: 1080 };
// Two planes stacked face to face must stand this far apart, or the frame
// cannot say which is in front and they flicker.
export const MIN_GAP = 3;
// The largest error of a laid triangle against the true projection, in pixels.
const TOLERANCE = 0.5;
const MAX_GRID = 16;
// How far each triangle reaches past its edges, so a neighbour's soft edge
// lands on picture, not on what is behind.
const GROW = 1.25;
const MAX_CANVAS = 4096;
const D2R = Math.PI / 180;

const POSE = { x: 960, y: 540, z: 0, rx: 0, ry: 0, rz: 0, s: 1, o: 1 };
export const fullPose = (p = {}) => ({ ...POSE, ...p });

// ---- keys -------------------------------------------------------------------

// Camera keys [t, x, y, zoom, ry, rx, ease]: each key eases from the one before
// it on its own ease. Zoom moves on a log scale, so a dolly from 1 to 2 and from
// 2 to 4 take the same feel.
export function cameraAt(keys, t) {
  if (!keys || !keys.length) return { x: 960, y: 540, zoom: 1, ry: 0, rx: 0 };
  let c = keys[0].slice(1, 6);
  for (let i = 1; i < keys.length; i++) {
    const p = keys[i - 1], k = keys[i];
    if (t < p[0]) break;
    const f = resolveEase(k[6] || 'inOutCubic')(clamp((t - p[0]) / (k[0] - p[0] || 1e-6)));
    c = [mix(p[1], k[1], f), mix(p[2], k[2], f), Math.exp(mix(Math.log(p[3]), Math.log(k[3]), f)), mix(p[4], k[4], f), mix(p[5], k[5], f)];
    if (t < k[0]) break;
  }
  return { x: c[0], y: c[1], zoom: c[2], ry: c[3], rx: c[4] };
}

// Keys [t, value] where value is a number or an object of numbers, eased between.
export function keysAt(list, t, ease = 'inOutCubic') {
  if (!list || !list.length) return undefined;
  if (t <= list[0][0]) return list[0][1];
  const e = resolveEase(ease);
  for (let i = 1; i < list.length; i++) {
    if (t > list[i][0]) continue;
    const [a, x] = list[i - 1], [b, y] = list[i];
    const f = e(clamp((t - a) / (b - a || 1e-6)));
    if (typeof x === 'number') return mix(x, y, f);
    const out = {};
    for (const k of Object.keys(x)) out[k] = mix(x[k], y[k] ?? x[k], f);
    return out;
  }
  return list[list.length - 1][1];
}

// ---- projection ---------------------------------------------------------------

// A frame of `width` by `height` pixels shows the 1920 by 1080 world, scaled to
// fit its short side and centred.
export function viewFor(width, height, perspective = PERSPECTIVE) {
  const scale = Math.min(width / WORLD.w, height / WORLD.h);
  return { width, height, scale, cx: width / 2, cy: height / 2, perspective };
}

// The camera, ready to take world points: its turns as sines and cosines and
// the dolly as a depth.
export function cameraRig(cam, view) {
  const c = { x: 960, y: 540, zoom: 1, ry: 0, rx: 0, ...cam };
  return {
    x: c.x, y: c.y, dolly: view.perspective * (1 - 1 / Math.max(1e-3, c.zoom || 1)),
    cy: Math.cos((c.ry || 0) * D2R), sy: Math.sin((c.ry || 0) * D2R),
    cx: Math.cos((c.rx || 0) * D2R), sx: Math.sin((c.rx || 0) * D2R),
  };
}

// A world point in the camera's space: [x, y, z], z toward the viewer.
export function toCamera([x, y, z], rig) {
  let X = x - rig.x, Y = y - rig.y, Z = z;
  const x1 = X * rig.cy + Z * rig.sy, z1 = -X * rig.sy + Z * rig.cy;
  const y2 = Y * rig.cx - z1 * rig.sx, z2 = Y * rig.sx + z1 * rig.cx;
  return [x1, y2, z2 + rig.dolly];
}

// A camera-space point on the frame, in frame pixels: [sx, sy, depth], or null
// when it is at or behind the camera.
export function toScreen([x, y, z], view) {
  const d = view.perspective - z;
  if (d < 1) return null;
  const k = view.perspective / d;
  return [view.cx + x * k * view.scale, view.cy + y * k * view.scale, z];
}

// A plane's own point (px, py in 0..w, 0..h) in the world, through its pose.
export function planePoint(pose, w, h, px, py) {
  const s = pose.s ?? 1;
  let x = (px - w / 2) * s, y = (py - h / 2) * s, z = 0;
  if (pose.rz) { const a = pose.rz * D2R, c = Math.cos(a), n = Math.sin(a); [x, y] = [x * c - y * n, x * n + y * c]; }
  if (pose.rx) { const a = pose.rx * D2R, c = Math.cos(a), n = Math.sin(a); [y, z] = [y * c - z * n, y * n + z * c]; }
  if (pose.ry) { const a = pose.ry * D2R, c = Math.cos(a), n = Math.sin(a); [x, z] = [x * c + z * n, -x * n + z * c]; }
  return [x + (pose.x ?? 960), y + (pose.y ?? 540), z + (pose.z ?? 0)];
}

// Where a plane's own point lands on the frame.
export function projectPoint(pose, w, h, px, py, rig, view) {
  return toScreen(toCamera(planePoint(pose, w, h, px, py), rig), view);
}

// The four corners on the frame (top left, top right, bottom right, bottom
// left), the plane's depth at its centre, and whether its face is toward us.
export function projectPlane(pose, w, h, rig, view) {
  const corners = [[0, 0], [w, 0], [w, h], [0, h]].map(([px, py]) => projectPoint(pose, w, h, px, py, rig, view));
  const centre = toCamera(planePoint(pose, w, h, w / 2, h / 2), rig);
  if (corners.some((c) => !c)) return { corners: null, depth: centre[2], facing: false };
  let area = 0;
  for (let i = 0; i < 4; i++) { const a = corners[i], b = corners[(i + 1) % 4]; area += a[0] * b[1] - b[0] * a[1]; }
  return { corners, depth: centre[2], facing: area > 0, area: Math.abs(area) / 2 };
}

// ---- laying a picture on a projected plane -------------------------------------

// The affine transform taking three source points onto three frame points.
export function affineFrom([u0, v0], [u1, v1], [u2, v2], [x0, y0], [x1, y1], [x2, y2]) {
  const du1 = u1 - u0, dv1 = v1 - v0, du2 = u2 - u0, dv2 = v2 - v0;
  const det = du1 * dv2 - du2 * dv1;
  if (Math.abs(det) < 1e-9) return null;
  const dx1 = x1 - x0, dy1 = y1 - y0, dx2 = x2 - x0, dy2 = y2 - y0;
  const a = (dx1 * dv2 - dx2 * dv1) / det, c = (dx2 * du1 - dx1 * du2) / det;
  const b = (dy1 * dv2 - dy2 * dv1) / det, d = (dy2 * du1 - dy1 * du2) / det;
  return [a, b, c, d, x0 - a * u0 - c * v0, y0 - b * u0 - d * v0];
}

// How many cells a side the grid needs: a cell's error shrinks with the square
// of its size, and the error of the whole quad is how far its fourth corner
// sits from where the other three put it.
export function gridFor(corners) {
  const [a, b, c, d] = corners;
  const err = Math.hypot(a[0] + c[0] - b[0] - d[0], a[1] + c[1] - b[1] - d[1]);
  return clamp(Math.ceil(Math.sqrt(err / TOLERANCE)), 1, MAX_GRID);
}

// One triangle of the picture: clipped to its frame triangle grown a little
// (so neighbours meet with no hairline between them), then drawn through
// the affine transform from only the part of the source it covers.
function layTriangle(ctx, src, sw, sh, s0, s1, s2, d0, d1, d2) {
  const m = affineFrom(s0, s1, s2, d0, d1, d2);
  if (!m) return;
  const gx = (d0[0] + d1[0] + d2[0]) / 3, gy = (d0[1] + d1[1] + d2[1]) / 3;
  const grow = (p) => { const dx = p[0] - gx, dy = p[1] - gy, l = Math.hypot(dx, dy) || 1; return [p[0] + (dx / l) * GROW, p[1] + (dy / l) * GROW]; };
  const [e0, e1, e2] = [grow(d0), grow(d1), grow(d2)];
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(e0[0], e0[1]); ctx.lineTo(e1[0], e1[1]); ctx.lineTo(e2[0], e2[1]); ctx.closePath();
  ctx.clip();
  ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  // The source cut reaches as far past the triangle as the grown clip does,
  // in source pixels, so the grown edge has picture under it.
  const pad = Math.ceil(2 + (GROW * 2) / Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]) || 1));
  const x0 = clamp(Math.floor(Math.min(s0[0], s1[0], s2[0])) - pad, 0, sw), y0 = clamp(Math.floor(Math.min(s0[1], s1[1], s2[1])) - pad, 0, sh);
  const x1 = clamp(Math.ceil(Math.max(s0[0], s1[0], s2[0])) + pad, 0, sw), y1 = clamp(Math.ceil(Math.max(s0[1], s1[1], s2[1])) + pad, 0, sh);
  if (x1 > x0 && y1 > y0) ctx.drawImage(src, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
}

// Lays a picture of sw by sh pixels onto the frame, where at(fx, fy) gives the
// frame point of the picture's point (fx, fy in 0..1). Returns the grid used.
export function layPicture(ctx, src, sw, sh, at, corners) {
  const n = gridFor(corners);
  if (n === 1) {
    // Flat enough to be one affine picture: no seams, one draw.
    const m = affineFrom([0, 0], [sw, 0], [0, sh], corners[0], corners[1], corners[3]);
    if (!m) return 0;
    ctx.save();
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.drawImage(src, 0, 0, sw, sh, 0, 0, sw, sh);
    ctx.restore();
    return 1;
  }
  const pts = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) pts.push(at(i / n, j / n));
  if (pts.some((p) => !p)) return 0;
  const P = (i, j) => pts[j * (n + 1) + i];
  const S = (i, j) => [(i / n) * sw, (j / n) * sh];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    layTriangle(ctx, src, sw, sh, S(i, j), S(i + 1, j), S(i + 1, j + 1), P(i, j), P(i + 1, j), P(i + 1, j + 1));
    layTriangle(ctx, src, sw, sh, S(i, j), S(i + 1, j + 1), S(i, j + 1), P(i, j), P(i + 1, j + 1), P(i, j + 1));
  }
  return n;
}

// ---- the stage ------------------------------------------------------------------

// A soft shadow under a plane, as a box shadow would cast it in the plane's own
// surface: one deep, wide, faint shade that falls down by 28 times its depth,
// and one tight shade at the foot. k between about 0.6 and 1.4.
export const shadowShape = (k) => [{ dy: 28 * k, blur: 70 * k, alpha: 0.15 * Math.min(1, k) }, { dy: 2, blur: 6, alpha: 0.06 }];
const SHADE = '30,28,24';

// The plane's outline, a rounded rectangle in its own pixels moved down by dy,
// as points on the frame. Corners are walked as short arcs so they stay round
// under any turn.
function outline(pose, w, h, r, dy, rig, view) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  const pts = [];
  const arc = (cx, cy, a0) => { for (let i = 0; i <= 4; i++) { const a = a0 + (i / 4) * (Math.PI / 2); pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); } };
  arc(w - rr, rr, -Math.PI / 2); arc(w - rr, h - rr, 0); arc(rr, h - rr, Math.PI / 2); arc(rr, rr, Math.PI);
  const out = pts.map(([x, y]) => projectPoint(pose, w, h, x, y + dy, rig, view));
  return out.every(Boolean) ? out : null;
}

// Casts the shadow straight onto the frame: the projected outline is filled
// far off the frame, so only its blurred shade lands, as one soft shape with no
// seams. The blur follows the plane's size on the frame.
function castShadow(ctx, it, rig, view) {
  const { P, pose } = it;
  const k = clamp(P.shadow, 0.2, 2);
  const onFrame = Math.sqrt((it.area || 1) / (P.w * P.h));
  const far = 4 * (view.width + view.height);
  for (const L of shadowShape(k)) {
    const pts = outline(pose, P.w, P.h, P.radius ?? 12, L.dy, rig, view);
    if (!pts) continue;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.shadowColor = `rgba(${SHADE},${(L.alpha * clamp(pose.o)).toFixed(4)})`;
    ctx.shadowBlur = L.blur * onFrame;
    ctx.shadowOffsetX = far;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x - far, y) : ctx.moveTo(x - far, y)));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

export function createStage({ makeCanvas }) {
  const canvases = new Map();
  let scratch = null;

  function canvasFor(id, pw, ph) {
    let c = canvases.get(id);
    if (!c || c.width !== pw || c.height !== ph) { c = makeCanvas(pw, ph); canvases.set(id, c); }
    return c;
  }

  // Paints a plane's picture into its canvas, at its resolution on this frame.
  function paintPlane(P, view) {
    const k = Math.min((P.res ?? 2) * view.scale, MAX_CANVAS / Math.max(P.w, P.h));
    const pw = Math.max(1, Math.round(P.w * k)), ph = Math.max(1, Math.round(P.h * k));
    const c = canvasFor(P.id, pw, ph), g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.clearRect(0, 0, pw, ph);
    g.setTransform(pw / P.w, 0, 0, ph / P.h, 0, 0);
    P.paint(g);
    return { c, pw, ph };
  }

  // Draws one frame of the stage. frame = { camera, planes }. Returns what was
  // drawn, far to near, each with its corners on the frame, for the checks.
  function draw(ctx, frame, view) {
    const rig = cameraRig(frame.camera || {}, view);
    const list = [];
    (frame.planes || []).forEach((P, order) => {
      const pose = fullPose(P.pose);
      if (pose.o <= 0.001 || !(P.w > 0 && P.h > 0)) return;
      const pr = projectPlane(pose, P.w, P.h, rig, view);
      // A plane turned away, or reaching behind the camera, is not drawn.
      if (!pr.corners || !pr.facing) return;
      list.push({ P, pose, order, ...pr });
    });
    // Far to near; planes at one depth keep the order they were given in.
    list.sort((a, b) => a.depth - b.depth || a.order - b.order);
    for (const it of list) {
      const { P, pose } = it;
      const at = (w, h) => (fx, fy) => projectPoint(pose, w, h, fx * w, fy * h, rig, view);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (P.shadow > 0) castShadow(ctx, it, rig, view);
      const pic = paintPlane(P, view);
      if (pose.o >= 0.999) {
        ctx.globalAlpha = 1;
        it.grid = layPicture(ctx, pic.c, pic.pw, pic.ph, at(P.w, P.h), it.corners);
      } else {
        // A fading plane is laid at full strength on a scratch canvas first, so
        // the triangles' shared edges are not counted twice, then faded as one.
        it.grid = fadeLay(ctx, pic, at(P.w, P.h), it.corners, pose.o, view);
      }
      ctx.restore();
    }
    return list.map(({ P, pose, corners, depth, grid }) => ({ id: P.id, pose, w: P.w, h: P.h, corners, depth, grid, kind: P.kind, text: P.text }));
  }

  function fadeLay(ctx, pic, at, corners, o, view) {
    const W = Math.ceil(view.width), H = Math.ceil(view.height);
    if (!scratch || scratch.width !== W || scratch.height !== H) scratch = makeCanvas(W, H);
    const g = scratch.getContext('2d');
    const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
    const x0 = clamp(Math.floor(Math.min(...xs)) - 2, 0, W), y0 = clamp(Math.floor(Math.min(...ys)) - 2, 0, H);
    const x1 = clamp(Math.ceil(Math.max(...xs)) + 2, 0, W), y1 = clamp(Math.ceil(Math.max(...ys)) + 2, 0, H);
    if (x1 <= x0 || y1 <= y0) return 0;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.clearRect(x0, y0, x1 - x0, y1 - y0);
    const n = layPicture(g, pic.c, pic.pw, pic.ph, at, corners);
    ctx.globalAlpha = clamp(o);
    ctx.drawImage(scratch, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
    return n;
  }

  return { draw, canvasFor };
}

export function roundRectPath(g, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r || 0, w / 2, h / 2));
  g.moveTo(x + rr, y);
  g.lineTo(x + w - rr, y);
  g.arcTo(x + w, y, x + w, y + rr, rr);
  g.lineTo(x + w, y + h - rr);
  g.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  g.lineTo(x + rr, y + h);
  g.arcTo(x, y + h, x, y + h - rr, rr);
  g.lineTo(x, y + rr);
  g.arcTo(x, y, x + rr, y, rr);
  g.closePath();
}

// ---- rules the checks hold a stage to ----------------------------------------------

// Pairs of drawn planes that face the same way, overlap on the frame and stand
// closer than MIN_GAP along their facing: those flicker.
export function coplanarPairs(drawn) {
  const out = [];
  const box = (c) => { const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
  const same = (a, b) => ['rx', 'ry', 'rz'].every((k) => Math.abs((a[k] || 0) - (b[k] || 0)) < 0.5);
  for (let i = 0; i < drawn.length; i++) for (let j = i + 1; j < drawn.length; j++) {
    const A = drawn[i], B = drawn[j];
    if (!same(A.pose, B.pose)) continue;
    const a = box(A.corners), b = box(B.corners);
    if (a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]) continue;
    // Distance between the two centres along the shared facing.
    const n = planeNormal(A.pose);
    const d = (B.pose.x - A.pose.x) * n[0] + (B.pose.y - A.pose.y) * n[1] + (B.pose.z - A.pose.z) * n[2];
    if (Math.abs(d) < MIN_GAP) out.push([A.id, B.id, Math.abs(d)]);
  }
  return out;
}

// The way a plane faces, in the world, as a unit vector (0, 0, 1 for a plane
// that has not turned: toward the viewer).
export function planeNormal(pose) {
  const at = (px, py) => planePoint({ ...pose, x: 0, y: 0, z: 0, s: 1 }, 2, 2, px, py);
  const o = at(1, 1), p = at(2, 1), q = at(1, 2);
  const u = [p[0] - o[0], p[1] - o[1], p[2] - o[2]], v = [q[0] - o[0], q[1] - o[1], q[2] - o[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(...n) || 1;
  return n.map((x) => x / l);
}
