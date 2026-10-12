// Easing curves. Every curve maps 0..1 to 0..1 and is exactly 0 at 0 and 1 at 1.
//
// The names are the vocabulary the scene format and the drawing code share, so a
// model that writes "outExpo" in a plan and one that calls ease.outExpo in code
// get the same motion.
//
// Premium motion here means restraint: the default family is the exponential and
// quintic outs, which arrive fast and settle without overshoot. The overshooting
// curves (outBack) exist because a designer sometimes wants one, but the
// linter flags them and the compiler never picks them.

const c = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t);

export const ease = {
  linear: (t) => c(t),
  inQuad: (t) => c(t) ** 2,
  outQuad: (t) => 1 - (1 - c(t)) ** 2,
  inOutQuad: (t) => (t = c(t), t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  inCubic: (t) => c(t) ** 3,
  outCubic: (t) => 1 - (1 - c(t)) ** 3,
  inOutCubic: (t) => (t = c(t), t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  inQuart: (t) => c(t) ** 4,
  outQuart: (t) => 1 - (1 - c(t)) ** 4,
  inOutQuart: (t) => (t = c(t), t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2),
  inQuint: (t) => c(t) ** 5,
  outQuint: (t) => 1 - (1 - c(t)) ** 5,
  inOutQuint: (t) => (t = c(t), t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2),
  inSine: (t) => 1 - Math.cos((c(t) * Math.PI) / 2),
  outSine: (t) => Math.sin((c(t) * Math.PI) / 2),
  inOutSine: (t) => -(Math.cos(Math.PI * c(t)) - 1) / 2,
  inExpo: (t) => (t = c(t), t === 0 ? 0 : 2 ** (10 * t - 10)),
  outExpo: (t) => (t = c(t), t === 1 ? 1 : 1 - 2 ** (-10 * t)),
  inOutExpo: (t) => {
    t = c(t);
    if (t === 0 || t === 1) return t;
    return t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2;
  },
  inCirc: (t) => 1 - Math.sqrt(1 - c(t) ** 2),
  outCirc: (t) => Math.sqrt(1 - (c(t) - 1) ** 2),
  inOutCirc: (t) => (t = c(t), t < 0.5
    ? (1 - Math.sqrt(1 - (2 * t) ** 2)) / 2
    : (Math.sqrt(1 - (-2 * t + 2) ** 2) + 1) / 2),
  // A gentle overshoot. Flagged by the linter; never chosen by the compiler.
  outBack: (t) => {
    t = c(t);
    const k = 1.2, k3 = k + 1;
    return 1 + k3 * (t - 1) ** 3 + k * (t - 1) ** 2;
  },
};

// The names a plan may use, in the order a picker should offer them.
export const EASE_NAMES = Object.keys(ease);

// Curves that leave 0..1 on the way. The linter warns on these.
export const OVERSHOOT = new Set(['outBack']);

// A CSS-style cubic bezier, solved by Newton steps with a bisection fallback.
// cubicBezier(0.16, 1, 0.3, 1) is the "expressive out" many design systems use.
export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (u) => ((ax * u + bx) * u + cx) * u;
  const sy = (u) => ((ay * u + by) * u + cy) * u;
  const dx = (u) => (3 * ax * u + 2 * bx) * u + cx;
  return (t) => {
    t = c(t);
    if (t === 0 || t === 1) return t;
    let u = t;
    for (let i = 0; i < 8; i++) {
      const err = sx(u) - t;
      if (Math.abs(err) < 1e-6) return sy(u);
      const d = dx(u);
      if (Math.abs(d) < 1e-6) break;
      u -= err / d;
    }
    let lo = 0, hi = 1;
    u = t;
    for (let i = 0; i < 30; i++) {
      const x = sx(u);
      if (Math.abs(x - t) < 1e-6) break;
      if (x < t) lo = u; else hi = u;
      u = (lo + hi) / 2;
    }
    return sy(u);
  };
}

// Resolves a name, a [x1, y1, x2, y2] bezier, or a function to a curve.
// Anything unrecognised falls back to outCubic rather than throwing: a plan
// with a misspelt curve still moves, and the linter names the misspelling.
export function resolveEase(e, fallback = 'outCubic') {
  if (typeof e === 'function') return e;
  if (Array.isArray(e) && e.length === 4 && e.every(Number.isFinite)) return cubicBezier(...e);
  if (typeof e === 'string' && ease[e]) return ease[e];
  return ease[fallback] || ease.outCubic;
}
