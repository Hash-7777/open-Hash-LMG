// Two checks of how a scene is put together, with what fixes them.
//
// Rings across words: a large decorative ring (or circle drawn as a line)
// whose outline runs through a line of text cuts the words in two, however
// faint it is. The fix grows or shrinks the ring, and any other ring on the
// same centre with it, until its outline passes clear of every line on
// screen with it; a ring that cannot clear them all is left out.
//
// An empty container: a box, bubble or plate whose contents leave while it
// stays on screen reads as something missing. The fix keeps its last content
// until the container itself leaves.
//
// Positions are estimated from the scene's own numbers (no renderer): a line
// of text is taken as wide as its characters at its size, wrapped at its
// width, which is close enough to keep a ring well clear.

import { holdLine } from './edit.js';

const MARGIN = 26; // pixels a ring keeps between its outline and any words
const each = (layers, out = []) => { for (const L of layers || []) { out.push(L); if (L.layers) each(L.layers, out); } return out; };
const together = (A, B) => A.at < B.until && B.at < A.until;

// A line of text's box on the frame, in pixels.
export function textBox(doc, L) {
  const W = doc.width, H = doc.height, u = Math.min(W, H) / 1080;
  const size = (L.size || 48) * u;
  const chars = String(L.text || '').length * (L.upper ? 1.12 : 1);
  const wide = chars * size * 0.55;
  const room = (L.maxWidth || 0.8) * W;
  const lines = Math.max(1, Math.ceil(wide / room));
  const w = Math.min(wide, room), h = lines * size * (L.leading || 1.15);
  const px = L.x * W, py = L.y * H;
  // The renderer places a line by its alignment across and its anchor down.
  const x0 = L.align === 'left' ? px : L.align === 'right' ? px - w : px - w / 2;
  const a = L.anchor || 'center';
  const y0 = a.includes('top') ? py : a.includes('bottom') ? py - h : py - h / 2;
  return { x0, y0, x1: x0 + w, y1: y0 + h };
}

// Nearest and farthest distance from a point to a box.
function reach(cx, cy, b) {
  const dx = Math.max(b.x0 - cx, 0, cx - b.x1), dy = Math.max(b.y0 - cy, 0, cy - b.y1);
  const fx = Math.max(Math.abs(cx - b.x0), Math.abs(cx - b.x1)), fy = Math.max(Math.abs(cy - b.y0), Math.abs(cy - b.y1));
  return [Math.hypot(dx, dy), Math.hypot(fx, fy)];
}

const isRing = (L) => L.type === 'shape' && (L.shape === 'ring' || ((L.shape === 'circle' || L.shape === 'ellipse') && (!L.fill || L.fill === 'none') && L.stroke));

// The radius, from r, at which a ring centred at (cx, cy) clears every box:
// growing (dir 1) or shrinking (dir -1); null if it cannot within reason.
function clearRadius(cx, cy, r, boxes, dir) {
  let rr = r;
  for (let n = 0; n < 12; n++) {
    const hit = boxes.map((b) => reach(cx, cy, b)).filter(([lo, hi]) => rr >= lo - MARGIN && rr <= hi + MARGIN);
    if (!hit.length) return rr;
    rr = dir > 0 ? Math.max(...hit.map(([, hi]) => hi)) + MARGIN + 1 : Math.min(...hit.map(([lo]) => lo)) - MARGIN - 1;
    if (dir > 0 ? rr > r * 2.4 : rr < Math.max(60, r * 0.35)) return null;
  }
  return null;
}

export function checkComposition(doc, S, si, add) {
  const W = doc.width, H = doc.height, u = Math.min(W, H) / 1080;
  const layers = each(S.layers);
  const texts = layers.filter((L) => (L.type === 'text' || L.type === 'counter') && L.text !== '');
  // Rings, grouped by their centre.
  const groups = new Map();
  for (const R of layers.filter((L) => isRing(L) && (L.w || 0) * u >= 300)) {
    const key = `${R.x.toFixed(3)},${R.y.toFixed(3)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(R);
  }
  for (const rings of groups.values()) {
    const R = rings[0];
    const cx = R.x * W, cy = R.y * H, r = ((R.w || 0) * u) / 2;
    const boxes = texts.filter((T) => rings.some((Q) => together(Q, T))).map((T) => textBox(doc, T));
    const crossed = boxes.filter((b) => { const [lo, hi] = reach(cx, cy, b); return r >= lo - MARGIN && r <= hi + MARGIN; });
    if (!crossed.length) continue;
    const grow = clearRadius(cx, cy, r, boxes, 1), shrink = clearRadius(cx, cy, r, boxes, -1);
    const pick = [grow, shrink].filter((v) => v !== null).sort((a, b) => Math.abs(a - r) - Math.abs(b - r))[0];
    add('warn', 'ring-over-words', `In scene ${si + 1}, a decorative ring runs through the words.`, { scene: S.id, layer: R.id },
      { kind: 'clear-ring', scene: S.id, layers: rings.map((Q) => Q.id), w: pick ? Math.round((pick * 2) / u) : 0 });
  }
  // Containers whose contents leave before they do.
  for (const C of layers.filter((L) => L.type === 'shape' && ['rect', 'circle', 'ellipse'].includes(L.shape) && L.fill && L.fill !== 'none' && (L.w || 0) >= 120 && (L.h || 0) >= 80)) {
    const cw = (C.w * u) / 2, ch = (C.h * u) / 2, cx = C.x * W, cy = C.y * H;
    if (cw * 2 >= W * 0.9) continue; // a band across the frame is a background, not a container
    const inside = layers.filter((L) => L !== C && (L.z ?? 0) >= (C.z ?? 0) && L.at >= C.at - 0.3 && Math.abs(L.x * W - cx) < cw && Math.abs(L.y * H - cy) < ch);
    if (!inside.length) continue;
    const last = inside.reduce((a, b) => (b.until > a.until ? b : a));
    if (last.until < C.until - 0.8) {
      add('warn', 'empty-container', `In scene ${si + 1}, a box stays on screen ${(C.until - last.until).toFixed(1)} s after what was in it has gone.`, { scene: S.id, layer: C.id },
        { kind: 'keep-contents', scene: S.id, layer: last.id, box: C.id });
    }
  }
}

// Applies one of these fixes, or a line held longer, to a document being
// fixed (lint.js autofix). Returns the sentence for the person, or ''.
export function applyCompositionFix(d, f) {
  const S = d.scenes.find((x) => x.id === f.scene);
  if (!S) return '';
  const all = each(S.layers);
  if (f.kind === 'clear-ring') {
    const ids = new Set(f.layers);
    if (!f.w) { const drop = (list) => list.filter((L) => !ids.has(L.id)).map((L) => (L.layers ? { ...L, layers: drop(L.layers) } : L)); S.layers = drop(S.layers); return `Took a decorative ring out of scene ${d.scenes.indexOf(S) + 1}: it could not clear the words.`; }
    for (const L of all) if (ids.has(L.id)) { L.w = f.w; if (L.h) L.h = f.w; }
    return `Moved a decorative ring in scene ${d.scenes.indexOf(S) + 1} off the words.`;
  }
  if (f.kind === 'keep-contents') {
    // The box's end as it is now: another fix may have moved it.
    const L = all.find((x) => x.id === f.layer), C = all.find((x) => x.id === f.box);
    if (!L || !C) return '';
    L.until = C.until;
    if (L.out && Number.isFinite(L.out.at)) L.out.at = Math.max(L.at, C.until - (L.out.duration || 0.4));
    return `Kept what is in a box in scene ${d.scenes.indexOf(S) + 1} until the box leaves.`;
  }
  if (f.kind === 'hold-line') {
    const L = all.find((x) => x.id === f.layer);
    if (!L) return '';
    holdLine(d, S, L, f.by);
    return `Held "${(L.text || '').slice(0, 30)}" longer so it can be read before the next line takes its place.`;
  }
  return '';
}
export const COMPOSITION_FIXES = ['clear-ring', 'keep-contents', 'hold-line'];
