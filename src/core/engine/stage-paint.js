// What the stage's planes are painted with: timing ramps, the studio's
// colours, a drawing kit for each plane's own canvas, cards, line drawings
// that draw themselves, and odometer digits.
//
// Every plane is painted in its own pixels (0..w, 0..h) through the same
// drawing kit the films use, so type, paths and the trimmed stroke of a line
// drawing are the ones every other frame gets.

import { createKit } from './kit.js';
import { resolveEase } from './ease.js';
import { clamp } from './math.js';

// The studio: a white room, ink for words, and only two colours of the
// product's own, the accent (its line) and the second accent (its mark).
export const STUDIO = {
  top: '#faf9f6', mid: '#f5f4f0', floor: '#eceae5', veil: '#f5f4f0',
  ink: '#1a1a1c', muted: '#77767a', card: '#ffffff', chip: '#1a1a1c', chipInk: '#f5f4f0', chipMuted: '#b9b8b4',
  display: '#17171a', piece: '#1c1c1f',
};

// The other rooms a product film can stand in: a night studio, and warm paper.
export const ROOMS = {
  studio: STUDIO,
  night: {
    top: '#17181c', mid: '#111215', floor: '#0b0c0e', veil: '#111215',
    ink: '#f2f1ee', muted: '#9a9893', card: '#1d1e23', chip: '#2a2b31', chipInk: '#f2f1ee', chipMuted: '#a6a49f',
    display: '#0e0f12', piece: '#16171a',
  },
  paper: {
    top: '#f6f1e8', mid: '#f0e9dd', floor: '#e6dccb', veil: '#f0e9dd',
    ink: '#221d17', muted: '#7a7064', card: '#fcf9f3', chip: '#221d17', chipInk: '#f6f1e8', chipMuted: '#c9bfae',
    display: '#17171a', piece: '#1c1c1f',
  },
};

// The room's colours with the film's own two accents.
export function studioColors(palette = {}, tone = 'studio') {
  return { ...(ROOMS[tone] || STUDIO), accent: palette.accent || '#e9423f', accent2: palette.accent2 || '#d9b26a' };
}

// 0 before a, 1 after b, eased between.
export function ramp(t, a, b, e = 'inOutCubic') {
  return resolveEase(e)(clamp((t - a) / ((b - a) || 1e-6)));
}

// Up over fi from a, down over fo to b: a part's opacity across its life.
export function win(t, a, b, fi = 0.5, fo = 0.5) {
  return Math.min(ramp(t, a, a + fi, 'inOutSine'), 1 - ramp(t, b - fo, b, 'inOutSine'));
}

// A drawing kit for a plane's canvas, made once per canvas.
const kits = new WeakMap();
export function kitFor(g) {
  let k = kits.get(g);
  if (!k) { k = createKit(g, { width: g.canvas?.width || 100, height: g.canvas?.height || 100 }); kits.set(g, k); }
  return k;
}

const alpha = (hex, a) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${clamp(a).toFixed(3)})`;
};
export { alpha as withAlphaHex };

// Words on a plane: size in the plane's pixels, the kit's own type.
// maxWidth: the room it has; the type grows smaller until it fits, on up to
// o.lines lines (1 by default), and never below 55% of its size.
export function words(g, s, x, y, o = {}) {
  if ((o.alpha ?? 1) <= 0 || !s) return null;
  const size = fitSize(g, String(s), o);
  return kitFor(g).text(String(s), x, y, {
    size, weight: o.weight ?? 500, color: o.color ?? STUDIO.ink, align: o.align ?? 'center',
    tracking: o.tracking ?? 0, opacity: o.alpha ?? 1, font: o.font ?? 'sans',
    ...(o.maxWidth && (o.lines ?? 1) > 1 ? { maxWidth: o.maxWidth, leading: 1.15 } : {}),
  });
}

// The largest size, from o.size down, at which s fits o.maxWidth on o.lines lines.
export function fitSize(g, s, o = {}) {
  const size = o.size ?? 40;
  if (!o.maxWidth) return size;
  const k = kitFor(g), lines = o.lines ?? 1;
  const at = (sz) => k.measureText(s, { size: sz, weight: o.weight ?? 500, font: o.font ?? 'sans', tracking: o.tracking ?? 0, ...(lines > 1 ? { maxWidth: o.maxWidth } : {}) });
  let sz = size;
  for (let n = 0; n < 12; n++) {
    const L = at(sz);
    if (L.width <= o.maxWidth + 0.5 && L.lines.length <= lines) break;
    sz *= 0.94;
    if (sz < size * 0.55) { sz = size * 0.55; break; }
  }
  return sz;
}

// A card: a rounded face, and a border in the accent as it lights.
export function card(g, w, h, { radius = 16, fill = STUDIO.card, lit = 0, accent = '#e9423f', inset = 0 } = {}) {
  const k = kitFor(g);
  k.rect(0, 0, w, h, { fill, radius });
  if (lit > 0.001) k.rect(1 + inset, 1 + inset, w - 2 - inset * 2, h - 2 - inset * 2, { fill: null, stroke: alpha(accent, 0.85 * lit), width: 2, radius: Math.max(0, radius - inset) });
}

// A line drawing that draws itself: an outline path, p of it shown.
export function stroke(g, d, p, width = 3, color = STUDIO.ink) {
  if (p <= 0) return;
  kitFor(g).path(d, { stroke: color, width, progress: clamp(p), cap: 'round' });
}

// A short rule that grows from its middle.
export function rule(g, x, y, w, p, color, h = 2) {
  if (p <= 0) return;
  const k = kitFor(g);
  k.rect(x - (w / 2) * p, y, w * p, h, { fill: color, radius: 0 });
}

// Digits rolling like a meter, then landing on the number written; anything
// that is not a digit fades in. f runs 0..1 over the roll.
export function odometer(g, s, x, y, size0, f, color = STUDIO.ink, maxWidth = 0) {
  const k = kitFor(g);
  const chars = [...String(s)];
  const size = maxWidth ? fitSize(g, String(s), { size: size0, weight: 200, maxWidth }) : size0;
  const font = { size, weight: 200, font: 'sans' };
  const ws = chars.map((c) => k.measureText(c, font).width);
  const total = ws.reduce((a, b) => a + b, 0);
  g.save();
  g.beginPath();
  g.rect(x - total, y - size * 0.56, total * 2, size * 1.12);
  g.clip();
  let cx = x - total / 2;
  const out5 = resolveEase('outQuint');
  chars.forEach((c, i) => {
    const d = Number(c);
    if (c.trim() && Number.isFinite(d)) {
      const pos = (10 + d) * out5(clamp(f * 1.05 - i * 0.06)), base = Math.floor(pos), frac = pos - base;
      for (const n of [0, 1]) words(g, String((base + n) % 10), cx + ws[i] / 2, y + (n - frac) * size * 1.3, { ...font, color });
    } else {
      words(g, c, cx + ws[i] / 2, y, { ...font, color, alpha: clamp(f * 2 - 0.6) });
    }
    cx += ws[i];
  });
  g.restore();
}

// Each word of a line rising as it is said: items [[word, at], ...], centred on x.
export function spoken(g, items, t, { x, y, size: size0, weight = 400, color = STUDIO.ink, gap = 0.3, mark = null, accent = '#e9423f', maxWidth = 0 }) {
  const k = kitFor(g);
  const size = maxWidth ? fitSize(g, items.map(([w]) => w).join(' '), { size: size0, weight, maxWidth }) : size0;
  const font = { size, weight, font: 'sans' };
  const sp = k.measureText(' ', font).width || size * 0.28;
  const ws = items.map(([w]) => k.measureText(w, font).width);
  let cx = x - (ws.reduce((a, b) => a + b, 0) + sp * (ws.length - 1)) / 2;
  items.forEach(([w, at], i) => {
    const f = ramp(t, at - 0.05, at + gap, 'outCubic');
    if (f > 0) {
      const yy = y + 12 * (1 - f);
      if (mark && mark[i]) {
        const iw = k.measureText(w[0], font).width;
        words(g, w[0], cx, yy, { ...font, color: accent, align: 'left', alpha: f });
        words(g, w.slice(1), cx + iw, yy, { ...font, color, align: 'left', alpha: f });
      } else {
        words(g, w, cx, yy, { ...font, color, align: 'left', alpha: f });
      }
    }
    cx += ws[i] + sp;
  });
}
