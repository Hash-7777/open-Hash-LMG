// Colour parsing, mixing and contrast. Pure and DOM-free, so the linter can
// judge contrast in Node exactly as the app does.

const NAMED = {
  black: [0, 0, 0], white: [255, 255, 255], transparent: [0, 0, 0, 0],
  red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255], gray: [128, 128, 128], grey: [128, 128, 128],
};

// Returns [r, g, b, a] with r, g, b in 0..255 and a in 0..1, or null.
export function parseColor(input) {
  if (Array.isArray(input)) return input.length >= 3 ? [input[0], input[1], input[2], input[3] ?? 1] : null;
  if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  if (NAMED[s]) { const n = NAMED[s]; return [n[0], n[1], n[2], n[3] ?? 1]; }
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) {
      const v = [...h].map((ch) => parseInt(ch + ch, 16));
      return [v[0], v[1], v[2], h.length === 4 ? v[3] / 255 : 1];
    }
    if (h.length === 6 || h.length === 8) {
      const v = [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16));
      return [v[0], v[1], v[2], h.length === 8 ? v[3] / 255 : 1];
    }
    return null;
  }
  m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map((x) => (x.endsWith('%') ? parseFloat(x) * 2.55 : parseFloat(x)));
    if (p.length < 3 || p.slice(0, 3).some((v) => !Number.isFinite(v))) return null;
    let a = p[3] ?? 1;
    if (m[1].split(/[\s,/]+/).filter(Boolean)[3]?.endsWith('%')) a = p[3] / 255;
    return [p[0], p[1], p[2], Number.isFinite(a) ? a : 1];
  }
  m = s.match(/^hsla?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean);
    const h = parseFloat(p[0]), sat = parseFloat(p[1]) / 100, l = parseFloat(p[2]) / 100;
    if (![h, sat, l].every(Number.isFinite)) return null;
    const a = p[3] ? (p[3].endsWith('%') ? parseFloat(p[3]) / 100 : parseFloat(p[3])) : 1;
    const k = (n) => (n + h / 30) % 12;
    const f = (n) => l - sat * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return [f(0) * 255, f(8) * 255, f(4) * 255, a];
  }
  return null;
}

export function toCss(c) {
  if (!c) return 'rgba(0,0,0,0)';
  const [r, g, b, a = 1] = c;
  const q = (v) => Math.round(Math.max(0, Math.min(255, v)));
  return a >= 1 ? `rgb(${q(r)},${q(g)},${q(b)})` : `rgba(${q(r)},${q(g)},${q(b)},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

export function toHex(c) {
  const p = parseColor(c);
  if (!p) return null;
  return '#' + p.slice(0, 3).map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

export function mixColor(a, b, f) {
  return [0, 1, 2, 3].map((i) => (a[i] ?? 1) + ((b[i] ?? 1) - (a[i] ?? 1)) * f);
}

export function withAlpha(color, alpha) {
  const p = parseColor(color);
  if (!p) return color;
  return toCss([p[0], p[1], p[2], (p[3] ?? 1) * alpha]);
}

// WCAG relative luminance of an opaque colour.
export function luminance(color) {
  const p = parseColor(color);
  if (!p) return 0;
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
}

// WCAG contrast ratio, 1..21. A translucent foreground is composited over the
// background first, since that is what the viewer actually sees.
export function contrast(fg, bg) {
  const b = parseColor(bg), f = parseColor(fg);
  if (!b || !f) return 21;
  const a = f[3] ?? 1;
  const seen = [0, 1, 2].map((i) => f[i] * a + b[i] * (1 - a));
  const l1 = luminance(seen), l2 = luminance(b);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

export const isColor = (s) => parseColor(s) !== null;
