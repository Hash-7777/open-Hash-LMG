// The diagram kit: how a product works, said as it is spoken. Each diagram
// builds the planes of one part of a product film at time t, and every moment
// in it (a card lighting, a tile tipping up, a job ticking in) is bound to the
// time its word is said, never to a guessed second.
//
//   steps    cards on a shallow arc; a line draws under them, a playhead
//            riding it, and each card lights as its step is named
//   split    two cards turned toward each other: what one side does, what the
//            other does, an arrow drawn between, each job ticking in
//   hub      a dark chip above a row of tiles, a curve run from it to each
//            tile in the tiles' own depth, each tile tipping up as it is named
//   drawings cards that turn in as their line drawings draw themselves
//   figures  tiles hinged at the floor; each stands, then its digits roll
//
// A builder is (part, t, a, C) => planes, where a is the part's opacity at t
// and C its colours (stage-paint.js studioColors). Positions are world pixels
// of the 1920 by 1080 stage.

import { ramp, card, words, rule, odometer, kitFor, withAlphaHex } from './stage-paint.js';
import { drawIcon } from './stage-icons.js';
import { clamp, mix } from './math.js';

const plane = (id, w, h, res, pose, paint, extra = {}) => ({ id, w, h, res, pose, paint, radius: 16, ...extra });
const centred = (i, n) => i - (n - 1) / 2;

// ---- steps --------------------------------------------------------------------
// part: { t0, items: [[name, sub, icon]], at: [time each step is named] }
export function steps(part, t, a, C) {
  const items = part.items || [], n = items.length, at = part.at || [];
  if (!n) return [];
  const span = Math.max(1, (n - 1) / 2);
  const arc = (i) => { const u = centred(i, n) / span; return { x: 960 + u * 700, z: -260 * u * u, ry: -18 * u }; };
  const xs = items.map((_, i) => 960 + (centred(i, n) / span) * 800);
  const draw = ramp(t, part.t0 + 0.4, (at[n - 1] ?? part.t0 + 4) + 0.6, 'linear');
  const out = [plane('steps-line', 1920, 120, 1.5, { x: 960, y: 765, z: -200, o: a }, (g) => {
    const k = kitFor(g);
    if (draw > 0) k.line(xs[0], 60, mix(xs[0], xs[n - 1], draw), 60, { color: C.accent, width: 3, cap: 'round' });
    if (draw > 0 && draw < 1) k.rect(mix(xs[0], xs[n - 1], draw) - 8, 46, 16, 28, { fill: C.accent2, radius: 4 });
  }, { kind: 'line' })];
  items.forEach(([name, sub, icon], i) => {
    const when = at[i] ?? part.t0 + 1 + i;
    const lit = ramp(t, when - 0.15, when + 0.5, 'outCubic');
    const rise = ramp(t, part.t0 + i * 0.12, part.t0 + 0.9 + i * 0.12, 'outCubic');
    const pos = arc(i);
    out.push(plane(`steps-${i}`, 320, 380, 2, {
      x: pos.x, y: 480 + 60 * (1 - rise) - 26 * lit, z: pos.z + 40 * lit - 120 * (1 - rise), ry: pos.ry, rx: 30 * (1 - rise), o: a * rise,
    }, (g) => {
      card(g, 320, 380, { radius: 18, lit, accent: C.accent });
      words(g, String(i + 1).padStart(2, '0'), 34, 40, { size: 20, weight: 500, color: lit > 0.5 ? C.accent : C.muted, align: 'left' });
      g.save(); g.translate(160, 150);
      drawIcon(g, icon || ['brief', 'storyboard', 'design', 'check', 'film'][i] || 'frame', ramp(t, when - 0.6, when + 0.4), ramp(t, when + 0.1, when + 0.9), C);
      g.restore();
      words(g, name, 160, 270, { size: 34, weight: 600, color: C.ink, alpha: 0.35 + 0.65 * lit });
      words(g, sub, 160, 314, { size: 21, weight: 400, color: C.muted, alpha: lit });
    }, { radius: 18, shadow: 0.6 + 0.5 * lit, kind: 'card', text: [name, sub], lit }));
  });
  return out;
}

// ---- split ----------------------------------------------------------------------
// part: { t0, left: { title, icon, items: [[word, at]] }, right: {...}, arrow: at }
export function split(part, t, a, C) {
  const sides = [{ ...part.left, x: 600, ry: 14 }, { ...part.right, x: 1320, ry: -14 }];
  const out = sides.map((c, k) => {
    const t0 = part.t0 + k * 0.5;
    const rise = ramp(t, t0, t0 + 0.9, 'outCubic');
    return plane(`split-${k}`, 560, 600, 2, {
      x: c.x, y: 540, z: -120 * (1 - rise), ry: c.ry * rise + (k ? -40 : 40) * (1 - rise), o: a * rise,
    }, (g) => {
      card(g, 560, 600, { radius: 20 });
      g.save(); g.translate(80, 80);
      const ip = ramp(t, t0 + 0.2, t0 + 1.1);
      drawIcon(g, c.icon || (k ? 'window' : 'chip'), ip, ip, C);
      g.restore();
      words(g, c.title, 140, 82, { size: 40, weight: 600, color: C.ink, align: 'left' });
      (c.items || []).forEach(([w, at], i) => {
        const f = ramp(t, at - 0.1, at + 0.4, 'outCubic');
        if (f <= 0) return;
        const y = 186 + i * 76;
        kitFor(g).rect(56, y - 6, 12, 12, { fill: withAlphaHex(C.accent, f), radius: 3 });
        words(g, w, 92, y + 10 * (1 - f), { size: 34, weight: 500, color: C.ink, align: 'left', alpha: f });
      });
    }, { radius: 20, shadow: 0.9, kind: 'card', text: [c.title, ...(c.items || []).map(([w]) => w)] });
  });
  const d = ramp(t, part.arrow ?? part.t0 + 2, (part.arrow ?? part.t0 + 2) + 0.8);
  out.push(plane('split-arrow', 170, 80, 2, { x: 960, y: 540, z: 40, o: a }, (g) => {
    const k = kitFor(g);
    if (d > 0) k.line(10, 40, 10 + 140 * d, 40, { color: C.accent, width: 3.2, cap: 'round' });
    if (d > 0.95) k.path('M134 28 L152 40 L134 52', { stroke: C.accent, width: 3.2, cap: 'round' });
  }, { kind: 'line', radius: 0 }));
  return out;
}

// ---- hub --------------------------------------------------------------------------
// part: { t0, title, sub, tiles: [[name, sub]], at: [times], note, noteAt }
// The curves' plane runs exactly from the chip's foot to the tiles' heads, so
// at one depth with both it meets them only at its edges.
export const HUB = { chipY: 290, chipH: 200, tileY: 760, tileH: 230, pitch: 300, z: -40 };
HUB.lineTop = HUB.chipY + HUB.chipH / 2;
HUB.lineH = HUB.tileY - HUB.tileH / 2 - HUB.lineTop;
HUB.lineY = HUB.lineTop + HUB.lineH / 2;
export const hubTileX = (i, n) => 960 + centred(i, n) * HUB.pitch;
export function hub(part, t, a, C) {
  const tiles = part.tiles || [], n = tiles.length, at = part.at || [];
  const rise = ramp(t, part.t0, part.t0 + 0.9, 'outCubic');
  const out = [plane('hub-chip', 380, HUB.chipH, 2, { x: 960, y: HUB.chipY, z: HUB.z - 60 * (1 - rise), rx: 40 * (1 - rise), o: a * rise }, (g) => {
    const k = kitFor(g);
    k.rect(0, 0, 380, 200, { fill: C.chip, radius: 22 });
    k.rect(12, 12, 356, 176, { fill: null, stroke: C.accent, width: 2, radius: 14 });
    words(g, part.title, 190, 80, { size: 40, weight: 600, color: C.chipInk });
    words(g, part.sub, 190, 128, { size: 21, weight: 400, color: C.chipMuted });
  }, { radius: 22, shadow: 1, kind: 'chip', text: [part.title, part.sub] })];
  // From the chip's foot (this plane's top edge) to each tile's head (its
  // bottom edge), in the tiles' own depth, so every curve lands on its tile.
  const reach = HUB.lineH;
  const ends = tiles.map((_, i) => {
    const d = ramp(t, (at[i] ?? part.t0 + 1 + i) - 0.5, (at[i] ?? part.t0 + 1 + i) + 0.1);
    return { d, x: mix(960, hubTileX(i, n), d), y: mix(0, reach, d) };
  });
  out.push(plane('hub-lines', 1920, HUB.lineH, 1.5, { x: 960, y: HUB.lineY, z: HUB.z, o: a }, (g) => {
    // Drawn as true curves: each grows by its end point, so none is trimmed.
    g.save();
    g.strokeStyle = C.accent; g.lineWidth = 2.4; g.lineCap = 'round';
    for (const e of ends) {
      if (e.d <= 0) continue;
      g.beginPath(); g.moveTo(960, 0); g.bezierCurveTo(960, e.y * 0.55, e.x, e.y * 0.45, e.x, e.y); g.stroke();
    }
    g.restore();
  }, { kind: 'line', radius: 0, ends: ends.map((e) => [e.x, e.y]) }));
  tiles.forEach(([name, sub], i) => {
    const when = at[i] ?? part.t0 + 1 + i;
    const up = ramp(t, when - 0.35, when + 0.45, 'outCubic'), lit = ramp(t, when - 0.1, when + 0.5, 'outCubic');
    out.push(plane(`hub-tile-${i}`, 270, HUB.tileH, 2, { x: hubTileX(i, n), y: HUB.tileY + 30 * (1 - up), z: HUB.z, rx: -80 * (1 - up), o: a * clamp(up * 3) }, (g) => {
      card(g, 270, HUB.tileH, { radius: 16, lit, accent: C.accent });
      words(g, name, 135, 92, { size: 52, weight: 600, color: C.ink });
      rule(g, 135, 136, 40, lit, C.accent);
      words(g, sub, 135, 176, { size: 22, weight: 500, color: C.muted, alpha: lit });
    }, { shadow: 0.8 * up, kind: 'tile', text: [name, sub], lit }));
  });
  if (part.note) {
    const na = ramp(t, part.noteAt ?? part.t0 + 3, (part.noteAt ?? part.t0 + 3) + 0.6, 'outCubic');
    out.push(plane('hub-note', 900, 60, 2, { x: 960, y: 975, o: a * na }, (g) => words(g, part.note, 450, 30, { size: 26, weight: 500, color: C.muted }), { kind: 'words', text: [part.note], radius: 0 }));
  }
  return out;
}

// ---- drawings -------------------------------------------------------------------------
// part: { t0, items: [{ at, cap, icon }] }
export function drawings(part, t, a, C) {
  const items = part.items || [], n = items.length;
  return items.map((it, i) => {
    const at = it.at ?? part.t0 + 0.3 + i * 1.3;
    const p = ramp(t, at, at + 1.3), q = ramp(t, at + 0.9, at + 1.8), turn = ramp(t, at - 0.3, at + 1.2);
    const c = centred(i, n);
    return plane(`drawing-${i}`, 480, 480, 2, {
      x: 960 + c * 540, y: 540, z: -Math.abs(c) * 120 - 160 * (1 - turn), ry: c * -16 + 50 * (1 - turn) * (i === 0 ? -1 : 1),
      o: a * ramp(t, at - 0.3, at + 0.4, 'inOutSine'),
    }, (g) => {
      card(g, 480, 480, { radius: 16 });
      g.save(); g.translate(240, 210); drawIcon(g, it.icon, p, q, C); g.restore();
      words(g, it.cap, 240, 400, { size: 30, weight: 500, color: C.ink, alpha: ramp(t, at + 0.8, at + 1.5, 'outCubic') });
    }, { shadow: 0.8, kind: 'card', text: [it.cap] });
  });
}

// ---- figures ----------------------------------------------------------------------------
// part: { items: [{ t, value, cap }] }. A tile stands up from the floor, hinged
// at its foot, and its digits roll only once it stands.
export const FIGURE = { standsBy: 0.55, rollFrom: 0.15 };
export function figures(part, t, a, C) {
  const items = part.items || [], n = items.length;
  return items.map((it, i) => {
    const up = ramp(t, it.t - 0.45, it.t + FIGURE.standsBy, 'outCubic');
    const f = ramp(t, it.t + FIGURE.rollFrom, it.t + 1.25, 'linear');
    const lf = ramp(t, it.t + 0.4, it.t + 1.1, 'outCubic');
    return plane(`figure-${i}`, 380, 440, 2, {
      x: 960 + centred(i, n) * 420, y: 560 + 110 * (1 - up), z: -60, rx: -88 * (1 - up), o: a * clamp(up * 3),
    }, (g) => {
      card(g, 380, 440, { radius: 16 });
      if (f > 0) odometer(g, it.value, 190, 190, 180, f, C.ink);
      rule(g, 190, 318, 48, lf, C.accent);
      words(g, it.cap, 190, 368, { size: 27, weight: 500, color: C.ink, alpha: lf });
    }, { shadow: 0.8 * up, kind: 'tile', text: [String(it.value), it.cap], rolling: f > 0, tilt: -88 * (1 - up) });
  });
}

export const DIAGRAMS = { steps, split, hub, drawings, figures };
