// Figures on an odometer: every digit column spins and comes to rest, left
// to right, the last one landing as the count ends, while signs and
// separators stand still. Each column is a window one line tall, with the
// digit leaving and the digit arriving drawn inside it, so a column never
// shows more than the two numbers it is between.
//
// Digits take the width of the widest digit, so the figure does not shift
// sideways as its columns turn.

import { clamp } from './math.js';
import { resolveEase } from './ease.js';

export function drawOdometer(kit, L, s, t, u) {
  const ctx = kit.ctx;
  const local = t - (L.in.at ?? L.at);
  const final = L.prefix + kit.formatNumber(L.to, L.decimals, L.separator) + L.suffix;
  const size = (s.size ?? L.size) * u;
  const chars = [...final];
  ctx.save();
  ctx.font = kit.fontString({ size, weight: L.weight, font: L.font });
  const digitW = Math.max(...'0123456789'.split('').map((d) => ctx.measureText(d).width));
  const widths = chars.map((ch) => (/\d/.test(ch) ? digitW : ctx.measureText(ch).width));
  const gap = (L.tracking || 0) * size;
  const total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, chars.length - 1);
  const lineH = size * 1.08;
  let x = L.align === 'left' ? 0 : L.align === 'right' ? -total : -total / 2;
  const x0 = x;
  const digits = chars.map((c, i) => (/\d/.test(c) ? i : -1)).filter((i) => i >= 0);
  const settle = resolveEase('settle');
  ctx.fillStyle = kit.color(s.color);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  chars.forEach((ch, i) => {
    const w = widths[i];
    const cx = x + w / 2;
    const k = digits.indexOf(i);
    if (k < 0) {
      ctx.fillText(ch, cx, 0);
    } else {
      const n = digits.length;
      const stop = Math.max(0.001, L.count * (n > 1 ? 0.55 + (0.45 * k) / (n - 1) : 1));
      const p = settle(clamp(local / stop));
      // Later columns turn further, so the figure settles from left to right.
      const pos = Number(ch) + (1 - p) * 10 * (1 + k);
      const base = Math.floor(pos);
      const f = pos - base;
      const d0 = ((base % 10) + 10) % 10;
      const d1 = (d0 + 1) % 10;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, -lineH / 2, w, lineH);
      ctx.clip();
      // A digit fades as it passes the edge of its window, so a turning
      // column reads as motion rather than as two numbers at once.
      const base0 = ctx.globalAlpha;
      ctx.globalAlpha = base0 * clamp(1 - 1.2 * f);
      ctx.fillText(String(d0), cx, f * lineH);
      if (f > 0.001) {
        ctx.globalAlpha = base0 * clamp(1 - 1.2 * (1 - f));
        ctx.fillText(String(d1), cx, (f - 1) * lineH);
      }
      ctx.restore();
    }
    x += w + gap;
  });
  ctx.restore();
  kit.mark('text', x0, -lineH / 2, total, lineH, { text: final, size: L.size });
}
