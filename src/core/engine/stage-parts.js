// The named parts of a product film that are not diagrams: the cold open,
// the name, the end card, the product's icon with depth, the ring of looks,
// and the made film lifted off its screen as three layers.
//
// Each is (part, t, a, env) => planes. env carries the colours (C), the
// film's pictures (assets), and the few drawing services the renderer lends:
// film(doc, t, w, h, key) draws a film frame into a kept canvas,
// filmLayers(doc, t, key) draws its three layers, and darkened(img) a dimmed
// copy of a picture.

import { ramp, words, spoken, kitFor, withAlphaHex } from './stage-paint.js';
import { keysAt, planeNormal, fullPose, MIN_GAP } from './stage3d.js';
import { clamp, mix } from './math.js';

const plane = (id, w, h, res, pose, paint, extra = {}) => ({ id, w, h, res, pose, paint, radius: 12, ...extra });

// The icon's border as a share of its size: the open's frame closes onto it.
export const MARK = { size: 320, inset: 0.117, radius: 0.133 };

// A rounded rectangle as a path a stroke can draw a share of, starting at the
// top left corner's end and running clockwise.
export function roundRectD(x, y, w, h, r) {
  const f = (v) => v.toFixed(2);
  return `M${f(x + r)} ${f(y)} H${f(x + w - r)} A${f(r)} ${f(r)} 0 0 1 ${f(x + w)} ${f(y + r)} V${f(y + h - r)} A${f(r)} ${f(r)} 0 0 1 ${f(x + w - r)} ${f(y + h)} H${f(x + r)} A${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(y + h - r)} V${f(y + r)} A${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(y)} Z`;
}

// Which words of a name's spelled-out form carry its initials: the name's
// capitals (LMG), matched from the end of the words.
export function initialsMarks(name, list) {
  const acr = String(name).split(/\s+/).find((w) => w.length >= 2 && /^[A-Z0-9]+$/.test(w)) || '';
  const marks = list.map(() => false);
  let j = acr.length - 1;
  for (let i = list.length - 1; i >= 0 && j >= 0; i--) {
    if (String(list[i])[0]?.toUpperCase() === acr[j]) { marks[i] = true; j--; }
  }
  return marks;
}

// ---- the cold open: a frame drawn in the accent on a plane rising from the
// floor, the playhead crossing it, then the frame closing onto the icon's own
// border as the icon turns in. part: { t0, mark }
export function open(part, t, a, env) {
  const { C } = env, t0 = part.t0, M = { ...MARK, ...(part.mark || {}) };
  const draw = ramp(t, t0 + 0.2, t0 + 2.0);
  const shrink = ramp(t, t0 + 3.0, t0 + 4.1);
  const side = M.size * (1 - 2 * M.inset);
  const w = mix(1040, side, shrink), h = mix(585, side, shrink), r = mix(6, M.size * M.radius, shrink);
  const x = 600 - w / 2, y = 340 - h / 2;
  const fade = 1 - ramp(t, t0 + 3.9, t0 + 4.3, 'inOutSine');
  const ph = ramp(t, t0 + 1.4, t0 + 3.0), phA = Math.min(ramp(t, t0 + 1.3, t0 + 1.6, 'inOutSine'), 1 - ramp(t, t0 + 3.2, t0 + 3.6, 'inOutSine'));
  const rise = ramp(t, t0, t0 + 2.4, 'outCubic');
  // The frame closes onto the icon's border, so it stands the stage's gap in
  // front of the icon rather than in its plane.
  return [plane('open', 1200, 680, 1.5, { x: 960, y: 540, z: MIN_GAP - 200 * (1 - rise), rx: 62 * (1 - rise), o: a * fade }, (g) => {
    const k = kitFor(g);
    if (draw > 0) k.path(roundRectD(x, y, w, h, r), { stroke: C.accent, width: mix(2.4, 3.2, shrink), progress: draw, cap: 'butt' });
    if (phA > 0) {
      const px = mix(x + 30, x + w - 30, ph);
      k.line(px, y + 26, px, y + h - 22, { color: withAlphaHex(C.accent2, phA), width: 3, cap: 'butt' });
      k.rect(px - 9, y + 12, 18, 16, { fill: withAlphaHex(C.accent2, phA), radius: 4 });
    }
  }, { kind: 'line', radius: 0 })];
}

// ---- the name: rising on its plane, a rule under it, then what its capitals
// stand for, word by word as said, the initials in the accent, then its line.
// part: { t0, name, expansion: [[word, at]], tagline: [[word, at]] }
export function name(part, t, a, env) {
  const { C } = env, t0 = part.t0;
  const f = ramp(t, t0, t0 + 1.0, 'outCubic');
  const hl = ramp(t, t0 + 0.5, t0 + 1.4);
  const exp = part.expansion || [], tag = part.tagline || [];
  const marks = initialsMarks(part.name, exp.map(([w]) => w));
  // It rests two gaps in front of the icon's stacked copies, which pass over
  // its top edge while the icon moves up.
  return [plane('name', 1400, 360, 2, { x: 960, y: 660, z: 2 * MIN_GAP - 120 * (1 - f), rx: 55 * (1 - f), o: a * f }, (g) => {
    words(g, part.name, 700, 90, { size: 112, weight: 600, color: C.ink, tracking: -2 / 112 });
    if (hl > 0) kitFor(g).rect(700 - 60 * hl, 170, 120 * hl, 2, { fill: C.accent, radius: 0 });
    spoken(g, exp, t, { x: 700, y: 232, size: 40, weight: 500, color: C.ink, gap: 0.35, mark: marks, accent: C.accent });
    spoken(g, tag, t, { x: 700, y: 312, size: 32, weight: 400, color: C.muted });
  }, { kind: 'words', radius: 0, text: [part.name, ...exp.map(([w]) => w), ...tag.map(([w]) => w)] })];
}

// ---- the end card. part: { t0, name, line, footnote }
export function end(part, t, a, env) {
  const { C } = env, t0 = part.t0;
  const f = ramp(t, t0 + 0.4, t0 + 1.4, 'outCubic');
  const l = ramp(t, t0 + 1.2, t0 + 2.0, 'outCubic');
  const out = [plane('end', 1400, 220, 2, { x: 960, y: 680, z: -100 * (1 - f), rx: 50 * (1 - f), o: a * f }, (g) => {
    words(g, part.name, 700, 70, { size: 92, weight: 600, color: C.ink, tracking: -1.5 / 92 });
    words(g, part.line, 700, 165, { size: 32, weight: 400, color: C.muted, alpha: l });
  }, { kind: 'words', radius: 0, text: [part.name, part.line] })];
  if (part.footnote) {
    out.push(plane('end-foot', 1400, 40, 2, { x: 960, y: 1000, o: a * ramp(t, t0 + 1.8, t0 + 2.6, 'outCubic') }, (g) => {
      words(g, part.footnote, 700, 20, { size: 19, weight: 400, color: C.muted, alpha: 0.9 });
    }, { kind: 'words', radius: 0, text: [part.footnote] }));
  }
  return out;
}

// ---- the icon as a chip with depth: drawn seven times, the six behind it
// darkened, each a short step back along the way it faces, each faded on its
// own (a faded group would flatten). part: { asset, keys: [[t, pose]] }
export const ICON_DEPTH = { copies: 7, step: 2, shade: 0.45 };
export function icon(part, t, a, env) {
  const img = env.assets?.[part.asset];
  const v = keysAt(part.keys, t);
  if (!img || !v || (v.o ?? 1) * a <= 0.001) return [];
  const pose = fullPose(v), n = planeNormal(pose), s = pose.s ?? 1;
  const dark = env.darkened(img, ICON_DEPTH.shade);
  const out = [];
  for (let i = 0; i < ICON_DEPTH.copies; i++) {
    const dz = (i - (ICON_DEPTH.copies - 1)) * ICON_DEPTH.step;
    const front = i === ICON_DEPTH.copies - 1;
    out.push(plane(`icon-${i}`, MARK.size, MARK.size, 2, {
      ...pose, x: pose.x + n[0] * dz * s, y: pose.y + n[1] * dz * s, z: pose.z + n[2] * dz * s, o: pose.o * a,
    }, (g) => g.drawImage(front ? img : dark, 0, 0, MARK.size, MARK.size), { kind: 'icon', group: 'icon', radius: 0 }));
  }
  return out;
}

// ---- the ring of looks: one film in each look on a card, the ring turning a
// card at a time and settling; the front look named only at rest.
// part: { t0, t1, at: [x, y, z], films: [{ name, doc }] }
export const RING = { radius: 1050, w: 880, h: 495 };
export function ring(part, t, a, env) {
  const films = part.films || [], n = films.length;
  if (!n) return [];
  const step = 360 / n, local = t - part.t0, per = (part.t1 - part.t0) / Math.max(0.5, n - 0.5);
  const k = Math.floor(local / per), f = clamp((local - k * per - per * 0.45) / (per * 0.55));
  const io = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const rot = (k + io(f)) * step + 40 * (1 - ramp(t, part.t0, part.t0 + 1.6, 'outCubic'));
  const [cx, cy, cz] = part.at || [960, 500, -260];
  const out = [];
  films.forEach((F, i) => {
    const ang = i * step - rot, r = (ang * Math.PI) / 180, face = Math.cos(r);
    if (face < -0.35) return;
    const S = F.doc.scenes.find((s) => s.name === 'title') || F.doc.scenes[0];
    const ft = S.start + 0.3 + ((local * 0.8 + i * 0.7) % Math.max(1, S.duration - 0.6));
    out.push(plane(`look-${i}`, RING.w, RING.h, 1.2, { x: cx + Math.sin(r) * RING.radius, y: cy, z: cz + (face - 1) * RING.radius, ry: ang, o: a * clamp(0.25 + face) }, (g) => {
      const pic = env.film(F.doc, ft, 960, 540, `look-${i}`);
      g.save(); g.beginPath(); g.roundRect ? g.roundRect(0, 0, RING.w, RING.h, 12) : g.rect(0, 0, RING.w, RING.h); g.clip();
      g.drawImage(pic, 0, 0, RING.w, RING.h);
      g.restore();
    }, { shadow: 0.7, kind: 'film', text: [F.name] }));
  });
  const front = ((Math.round(rot / step) % n) + n) % n;
  const fr = ((rot / step) % 1 + 1) % 1, rest = 1 - Math.min(fr, 1 - fr) * 2;
  out.push(plane('look-name', 600, 80, 2, { x: cx, y: cy + 330, z: cz + 60, o: a * clamp(rest * 1.8 - 0.6) }, (g) => {
    words(g, films[front].name, 300, 40, { size: 34, weight: 500, color: env.C.ink });
  }, { kind: 'words', radius: 0, text: [films[front].name] }));
  return out;
}

// ---- the made film lifted off its screen: three planes (backgrounds, shapes,
// words) that part in depth, turn, and meet again. The words and shapes
// planes carry a thin accent outline while apart.
// part: { t0, ft0, apart: [a0, a1, b0, b1], pose: [[t, {x, y, z, ry, rx, s}]], film }
export const LIFT = { w: 1600, h: 900, spread: 260, gap: 3 };
export function lift(part, t, a, env) {
  const ft = clamp(part.ft0 + (t - part.t0), 0, part.film.duration - 0.01);
  const ap = part.apart || [0, 0, 0, 0];
  const apart = ramp(t, ap[0], ap[1]) * (1 - ramp(t, ap[2], ap[3]));
  const pose = keysAt(part.pose, t) || { x: 960, y: 540, z: 0, ry: 0, rx: 0, s: 1 };
  const pics = env.filmLayers(part.film, ft, 'lift');
  return ['back', 'shapes', 'words'].map((key, i) => plane(`lift-${key}`, LIFT.w, LIFT.h, 1.2, {
    x: pose.x, y: pose.y, z: pose.z + (i - 1) * (LIFT.gap + LIFT.spread * apart),
    ry: pose.ry - 30 * apart, rx: pose.rx + 8 * apart, s: pose.s ?? 1, o: a,
  }, (g) => {
    g.save(); g.beginPath(); g.roundRect ? g.roundRect(0, 0, LIFT.w, LIFT.h, 10) : g.rect(0, 0, LIFT.w, LIFT.h); g.clip();
    g.drawImage(pics[key], 0, 0, LIFT.w, LIFT.h);
    g.restore();
    if (i > 0 && apart > 0.02) kitFor(g).rect(0.75, 0.75, LIFT.w - 1.5, LIFT.h - 1.5, { fill: null, stroke: withAlphaHex(env.C.accent, 0.6 * apart), width: 1.5, radius: 10 });
  }, { shadow: i === 0 ? 1 + 0.4 * apart : 0, radius: 10, kind: 'film' }));
}

export const PARTS = { open, name, end, icon, ring, lift };
