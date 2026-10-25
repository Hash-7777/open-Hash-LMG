// Pictures the model draws for a film: one concrete thing from the brief's own
// subject, drawn as a few pen strokes, so a film about a lamp shows a lamp and
// a film about a bike shows a bike, instead of the same type and shapes.
//
// A drawing arrives on a 100 by 100 grid as simple shapes (rounded boxes,
// circles, lines, outlines and arcs, which small models place far better than
// they write curves) or as SVG path data. It is read here as data only: shape
// names and numbers, path commands and numbers, nothing else. A box drawn
// round the whole picture is a frame, not part of the thing, and is left out. A drawing too small, too
// busy or out of its grid is set aside. What is kept is fitted to the grid,
// centred, flattened to straight segments and stored once in the storyboard
// (storyboard.pictures, by name); a beat names the picture it shows.
//
// In a film a picture is one or two path layers that draw themselves on, the
// stroke that carries the meaning last, in the accent colour.

import { parsePath, pathBounds } from '../engine/path.js';
import { ASPECTS } from './format.js';

export const PICTURE_GRID = 100;
const MAX_STROKES = 30;
const MAX_POINTS = 1600;
const MAX_CHARS = 9000;
// Path data and nothing else: commands, numbers, separators.
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]+$/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const r1 = (v) => Math.round(v * 10) / 10;

function strokesOf(v) {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
  return list.map((s) => (isObj(s) ? s.d : s)).filter((s) => typeof s === 'string' && s.length <= 1200 && PATH_DATA.test(s));
}

// Polylines, with points closer than a fraction of the grid merged.
function polylines(strokes) {
  const out = [];
  for (const d of strokes) {
    for (const sp of parsePath(d, 10)) {
      const pts = [];
      for (const p of sp.points) {
        if (!p.every(Number.isFinite)) continue;
        const last = pts[pts.length - 1];
        if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= 0.35) pts.push(p);
      }
      if (pts.length >= 2) out.push(pts);
    }
  }
  return out;
}

const toD = (lines, k, ox, oy) => lines.map((pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${r1((x - ox) * k + PICTURE_GRID / 2)} ${r1((y - oy) * k + PICTURE_GRID / 2)}`).join('')).join('');

function boxOf(d) {
  const b = pathBounds(parsePath(d));
  return { x: r1(b.x), y: r1(b.y), w: r1(b.w), h: r1(b.h) };
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= -100 && v <= 200 ? v : NaN);
const n1 = (v) => +v.toFixed(1);

// Shapes as path data: ["rect", x, y, w, h, radius], ["circle", cx, cy, r],
// ["line", x1, y1, x2, y2], ["poly", x1, y1, ...] closed, ["arc", cx, cy, r,
// fromDegrees, toDegrees] clockwise from pointing right. Anything else is
// left out. With `frames` false, a rect covering most of the grid is left
// out too when other shapes are drawn inside it.
export function shapesToStrokes(list, { frames = false } = {}) {
  const shapes = (Array.isArray(list) ? list : []).filter((sh) => Array.isArray(sh) && typeof sh[0] === 'string').slice(0, MAX_STROKES);
  const isFrame = (sh) => sh[0] === 'rect' && num(sh[3]) >= 80 && num(sh[4]) >= 80;
  const out = [];
  for (const sh of shapes) {
    if (!frames && shapes.length > 1 && isFrame(sh)) continue;
    const v = sh.slice(1).map(num);
    if (v.some(Number.isNaN)) continue;
    const kind = sh[0].toLowerCase();
    if (kind === 'rect' && v.length >= 4 && v[2] > 0 && v[3] > 0) {
      const [x, y, w, h] = v;
      const r = Math.max(0, Math.min(v[4] || 0, w / 2, h / 2));
      out.push(r > 0
        ? `M${n1(x + r)} ${n1(y)}H${n1(x + w - r)}A${n1(r)} ${n1(r)} 0 0 1 ${n1(x + w)} ${n1(y + r)}V${n1(y + h - r)}A${n1(r)} ${n1(r)} 0 0 1 ${n1(x + w - r)} ${n1(y + h)}H${n1(x + r)}A${n1(r)} ${n1(r)} 0 0 1 ${n1(x)} ${n1(y + h - r)}V${n1(y + r)}A${n1(r)} ${n1(r)} 0 0 1 ${n1(x + r)} ${n1(y)}Z`
        : `M${n1(x)} ${n1(y)}H${n1(x + w)}V${n1(y + h)}H${n1(x)}Z`);
    } else if (kind === 'circle' && v.length >= 3 && v[2] > 0) {
      const [cx, cy, r] = v;
      out.push(`M${n1(cx - r)} ${n1(cy)}A${n1(r)} ${n1(r)} 0 1 1 ${n1(cx + r)} ${n1(cy)}A${n1(r)} ${n1(r)} 0 1 1 ${n1(cx - r)} ${n1(cy)}Z`);
    } else if (kind === 'line' && v.length >= 4) {
      out.push(`M${n1(v[0])} ${n1(v[1])}L${n1(v[2])} ${n1(v[3])}`);
    } else if ((kind === 'poly' || kind === 'polygon') && v.length >= 6) {
      const pts = [];
      for (let i = 0; i + 1 < v.length && pts.length < 40; i += 2) pts.push(`${n1(v[i])} ${n1(v[i + 1])}`);
      out.push(`M${pts[0]}L${pts.slice(1).join('L')}Z`);
    } else if (kind === 'arc' && v.length >= 5 && v[2] > 0) {
      const [cx, cy, r, a0, a1] = v;
      const sweep = (((a1 - a0) % 360) + 360) % 360;
      if (sweep < 1) continue;
      const at = (deg) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];
      const [x0, y0] = at(a0), [x1, y1] = at(a0 + sweep);
      out.push(`M${n1(x0)} ${n1(y0)}A${n1(r)} ${n1(r)} 0 ${sweep > 180 ? 1 : 0} 1 ${n1(x1)} ${n1(y1)}`);
    }
  }
  return out;
}

// Path strokes and shapes alike, from one field of a drawing.
const strokesAndShapes = (v, opts) => [...strokesOf(Array.isArray(v) ? v.filter((x) => !Array.isArray(x)) : v), ...shapesToStrokes(Array.isArray(v) ? v.filter(Array.isArray) : [], opts)];

// A drawing as the model wrote it, { shapes or strokes, accent }, to what a film keeps:
// { d, accent, box, accentBox } on the grid, or null with why.
export function normalizeDrawing(raw) {
  if (!isObj(raw)) return { picture: null, why: 'not a drawing' };
  const main = polylines([...strokesAndShapes(raw.shapes), ...strokesAndShapes(raw.strokes ?? raw.paths ?? raw.d)]);
  const lit = polylines(strokesAndShapes(raw.accent, { frames: true }));
  const all = [...main, ...lit];
  if (all.length < 2 && !(all.length === 1 && all[0].length >= 8)) return { picture: null, why: 'too few strokes' };
  if (all.length > MAX_STROKES) return { picture: null, why: 'too many strokes' };
  if (all.reduce((n, p) => n + p.length, 0) > MAX_POINTS) return { picture: null, why: 'too many points' };
  const xs = all.flatMap((p) => p.map((q) => q[0]));
  const ys = all.flatMap((p) => p.map((q) => q[1]));
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  if (x0 < -25 || y0 < -25 || x1 > 125 || y1 > 125) return { picture: null, why: 'off its grid' };
  const span = Math.max(x1 - x0, y1 - y0);
  if (span < 18) return { picture: null, why: 'too small to read' };
  // Fitted so its longer side fills the grid, centred.
  const k = (PICTURE_GRID * 0.96) / span;
  const ox = (x0 + x1) / 2, oy = (y0 + y1) / 2;
  const d = toD(main.length ? main : lit, k, ox, oy);
  const accent = main.length ? toD(lit, k, ox, oy) : '';
  if (d.length + accent.length > MAX_CHARS) return { picture: null, why: 'too detailed' };
  return { picture: { d, accent, box: boxOf(d), accentBox: accent ? boxOf(accent) : null }, why: '' };
}

// A kept picture read back from a saved storyboard: the same shape, or null.
export function cleanPicture(p) {
  if (!isObj(p) || typeof p.d !== 'string' || !p.d || !PATH_DATA.test(p.d) || p.d.length > MAX_CHARS) return null;
  const accent = typeof p.accent === 'string' && p.accent && PATH_DATA.test(p.accent) && p.accent.length <= MAX_CHARS ? p.accent : '';
  return { d: p.d, accent, box: boxOf(p.d), accentBox: accent ? boxOf(accent) : null };
}

// Scales grid path data to pixels: every number is a coordinate here, since
// kept pictures hold only M and L.
const scaleD = (d, k) => d.replace(/-?\d+(?:\.\d+)?/g, (n) => String(r1(parseFloat(n) * k)));

// The layers that draw a picture at (x, y), as frame fractions, `size` pixels
// on its longer side. Each layer is placed at the centre of its own strokes,
// since a path is drawn centred on where it is put.
//   o: { aspect, size, ink, accent, at, opacity, z, duration }
export function pictureLayers(pic, x, y, o) {
  const frame = ASPECTS[o.aspect] || ASPECTS['16:9'];
  const k = o.size / PICTURE_GRID;
  const width = Math.max(3, Math.round(o.size / 70));
  const at = o.at ?? 0;
  const duration = o.duration ?? 1.4;
  const place = (box) => ({
    x: +(x + ((box.x + box.w / 2 - PICTURE_GRID / 2) * k) / frame.width).toFixed(4),
    y: +(y + ((box.y + box.h / 2 - PICTURE_GRID / 2) * k) / frame.height).toFixed(4),
  });
  const base = { type: 'shape', shape: 'path', fill: null, strokeWidth: width, cap: 'round', z: o.z ?? 0, ...(o.opacity !== undefined ? { opacity: o.opacity } : {}) };
  const layers = [{ ...base, id: 'picture', d: scaleD(pic.d, k), ...place(pic.box), stroke: o.ink, at, in: { preset: 'draw', duration, ease: 'inOutCubic' } }];
  if (pic.accent && pic.accentBox) {
    layers.push({ ...base, id: 'picture-accent', d: scaleD(pic.accent, k), ...place(pic.accentBox), stroke: o.accent, strokeWidth: width + 1, at: +(at + duration * 0.7).toFixed(3), in: { preset: 'draw', duration: 0.8, ease: 'inOutCubic' } });
  }
  return layers;
}

// The beats a picture may go with: those whose layout leaves it room.
export const PICTURE_KINDS = ['hook', 'statement', 'title', 'stat', 'list', 'end'];
