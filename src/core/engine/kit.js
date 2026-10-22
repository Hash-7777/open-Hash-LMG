// The drawing kit: everything a frame is made of, drawn on a 2D canvas.
//
// Two callers use it. The plan renderer (render-plan.js) draws a scene document
// with it, and model-written code in code mode receives it as `lmg`. Keeping
// one kit for both means a film made either way gets the same type, the same
// motion vocabulary and the same measured boxes for the checks.
//
// Coordinates here are canvas pixels. `kit.u` is the size of one unit, a pixel
// on a 1080 short side, so `kit.u * 96` is a 96 headline at any resolution.
//
// Every function is a pure function of its arguments and of `t` where it takes
// one: no timers, no randomness that is not seeded, nothing read from the clock.

import { ease, resolveEase } from './ease.js';
import { clamp, mix, tween, keys, spring, rand, noise, noise2, progress, smoothstep, lerpValue, beatLength } from './math.js';
import { parsePath, trimPath, pathLength, pointAt, pathBounds } from './path.js';
import { FONT_STACKS, PALETTE_TOKENS } from '../scene/format.js';
import { parseColor, toCss, withAlpha, mixColor } from '../util/color.js';

const MEASURE_CACHE_LIMIT = 4000;

export function createKit(ctx, options = {}) {
  const W = options.width || ctx.canvas?.width || 1920;
  const H = options.height || ctx.canvas?.height || 1080;
  const u = Math.min(W, H) / 1080;
  const palette = { ...(options.palette || {}) };
  const assets = options.assets || {};
  const makeCanvas = options.makeCanvas || null;
  const measureCache = new Map();
  const pathCache = new Map();
  let collect = null;
  let tag = null;

  // Palette tokens resolve to colours; anything else passes through.
  const color = (c, fallback = '#ffffff') => {
    if (c === null || c === undefined) return fallback;
    if (PALETTE_TOKENS.includes(c)) return palette[c] || fallback;
    return c;
  };

  const fontString = (o = {}) => {
    const stack = FONT_STACKS[o.font] || o.font || FONT_STACKS.sans;
    const style = o.italic ? 'italic ' : '';
    return `${style}${o.weight || 600} ${Math.max(1, o.size || 48)}px ${stack}`;
  };

  function measure(text, font) {
    const key = font + '\u0000' + text;
    let w = measureCache.get(key);
    if (w === undefined) {
      ctx.font = font;
      w = ctx.measureText(text).width;
      if (measureCache.size > MEASURE_CACHE_LIMIT) measureCache.clear();
      measureCache.set(key, w);
    }
    return w;
  }

  // Records where something was drawn, in frame pixels, for the checks.
  function record(kind, x, y, w, h, extra) {
    if (!collect) return;
    const m = ctx.getTransform ? ctx.getTransform() : null;
    const pts = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([px, py]) => (m
      ? [m.a * px + m.c * py + m.e, m.b * px + m.d * py + m.f]
      : [px, py]));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const box = { kind, tag, x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), alpha: ctx.globalAlpha, ...extra };
    if (box.alpha > 0.02) collect.push(box);
  }

  // ---- text layout ---------------------------------------------------------

  // Lays a string out into lines that fit maxWidth, with the x of every word and
  // character, so letters and words can each be animated on their own.
  function layoutText(text, o = {}) {
    const size = o.size || 48;
    const font = fontString(o);
    const track = (o.tracking || 0) * size;
    const lineH = size * (o.leading || 1.1);
    const maxW = o.maxWidth || Infinity;
    const src = o.upper ? String(text).toUpperCase() : String(text);
    const widthOf = (s) => measure(s, font) + Math.max(0, s.length - 1) * track;
    const space = widthOf(' ') + track;
    const lines = [];
    for (const para of src.split('\n')) {
      let line = [];
      let lw = 0;
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const ww = widthOf(word);
        if (line.length && lw + space + ww > maxW) { lines.push(line); line = []; lw = 0; }
        line.push({ text: word, w: ww });
        lw += (line.length > 1 ? space : 0) + ww;
      }
      if (line.length) lines.push(line);
    }
    let index = 0, charIndex = 0;
    const out = lines.map((words) => {
      let x = 0;
      const placed = words.map((wd, i) => {
        if (i) x += space;
        const chars = [];
        for (let k = 0; k < wd.text.length; k++) {
          const before = wd.text.slice(0, k);
          chars.push({ ch: wd.text[k], x: x + measure(before, font) + k * track, index: charIndex++ });
        }
        charIndex++; // the space after a word counts as a character for typing
        const p = { text: wd.text, x, w: wd.w, chars, index: index++ };
        x += wd.w;
        return p;
      });
      return { words: placed, width: x, text: words.map((w) => w.text).join(' ') };
    });
    const width = Math.max(0, ...out.map((l) => l.width));
    return { lines: out, width, height: out.length * lineH, lineH, size, font, track, words: index, chars: charIndex };
  }

  // Draws text with an optional reveal. Returns its box in local pixels.
  //
  //   o.reveal = { mode, time, duration, stagger, ease, distance, exit }
  //     mode: 'letters' | 'words' | 'type' | 'mask-up' | 'mask-down' | 'wipe'
  //     time: seconds since the motion began (negative = not begun)
  //     exit: true runs the same motion backwards, for an exit
  //   o.highlight: words drawn in o.highlightColor
  //   o.hold: { mode: 'marker' | 'underline' | 'shimmer', p } for emphasis
  function text(str, x, y, o = {}) {
    const L = layoutText(str, o);
    const align = o.align || 'center';
    const blockX = align === 'center' ? x - L.width / 2 : align === 'right' ? x - L.width : x;
    // y is the middle of the block unless baseline says otherwise.
    const blockY = o.baseline === 'top' ? y : o.baseline === 'bottom' ? y - L.height : y - L.height / 2;
    const fill = color(o.color ?? 'ink');
    const hiFill = color(o.highlightColor ?? 'accent');
    const hiSet = new Set((o.highlight || []).map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')));
    const isHi = (w) => hiSet.size > 0 && hiSet.has(w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''));
    const R = o.reveal || null;
    const e = resolveEase(R?.ease || 'outExpo');

    // Plate behind the block.
    if (o.plate) {
      const p = o.plate;
      rect(blockX - p.padX, blockY - p.padY, L.width + p.padX * 2, L.height + p.padY * 2, { fill: p.color, radius: p.radius });
    }

    ctx.save();
    ctx.font = L.font;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    const ascent = L.size * 0.8;
    const offsetFor = (lineW) => (align === 'center' ? (L.width - lineW) / 2 : align === 'right' ? L.width - lineW : 0);

    // Emphasis drawn behind the words (marker) needs the word boxes first.
    const hold = o.hold || null;
    if (hold && hold.mode === 'marker' && hiSet.size) {
      L.lines.forEach((line, li) => {
        const ox = blockX + offsetFor(line.width);
        const top = blockY + li * L.lineH + L.lineH * 0.08;
        for (const w of line.words) if (isHi(w.text)) {
          const pw = (w.w + L.size * 0.24) * clamp(hold.p);
          rect(ox + w.x - L.size * 0.12, top + L.lineH * 0.12, pw, L.lineH * 0.78, { fill: withAlpha(hiFill, 0.28), radius: L.size * 0.08 });
        }
      });
    }

    const total = R ? (R.mode === 'letters' || R.mode === 'type' ? L.chars : R.mode === 'words' ? L.words : L.lines.length) : 1;
    const unitP = (i) => {
      if (!R) return 1;
      const st = R.stagger ?? 0.03;
      const local = R.exit ? (R.duration + (total - 1) * st) - R.time - (total - 1 - i) * st : R.time - i * st;
      if (R.mode === 'type') return local >= 0 ? 1 : 0;
      return e(clamp(local / Math.max(0.001, R.duration)));
    };

    const dist = R?.distance ?? L.size * 0.5;
    const baseAlpha = ctx.globalAlpha;
    L.lines.forEach((line, li) => {
      const ox = blockX + offsetFor(line.width);
      const base = blockY + li * L.lineH + (L.lineH - L.size) / 2 + ascent;
      if (R && (R.mode === 'mask-up' || R.mode === 'mask-down')) {
        const p = unitP(li);
        ctx.save();
        ctx.beginPath();
        ctx.rect(ox - L.size, blockY + li * L.lineH - L.size * 0.1, line.width + L.size * 2, L.lineH + L.size * 0.2);
        ctx.clip();
        const dy = (1 - p) * L.lineH * (R.mode === 'mask-down' ? -1 : 1);
        drawLine(line, ox, base + dy, 1);
        ctx.restore();
        return;
      }
      if (R && R.mode === 'wipe') {
        const p = unitP(0);
        ctx.save();
        ctx.beginPath();
        ctx.rect(blockX - L.size, blockY - L.size, (L.width + L.size * 2) * p, L.height + L.size * 2);
        ctx.clip();
        drawLine(line, ox, base, 1);
        ctx.restore();
        return;
      }
      drawLine(line, ox, base, null);
    });

    function drawLine(line, ox, baseY, whole) {
      for (const w of line.words) {
        const wc = isHi(w.text) ? hiFill : fill;
        if (whole || !R) {
          drawWord(w, ox, baseY, wc, 1, 0);
        } else if (R.mode === 'words') {
          const p = unitP(w.index);
          drawWord(w, ox, baseY + (1 - p) * dist, wc, p, 0);
        } else if (R.mode === 'letters' || R.mode === 'type') {
          for (const c of w.chars) {
            const p = unitP(c.index);
            if (p <= 0) continue;
            ctx.globalAlpha = (o.opacity ?? 1) * p * baseAlpha;
            ctx.fillStyle = wc;
            const dy = R.mode === 'type' ? 0 : (1 - p) * dist * 0.6;
            ctx.fillText(c.ch, ox + c.x, baseY + dy);
          }
        } else {
          drawWord(w, ox, baseY, wc, 1, 0);
        }
      }
    }
    function drawWord(w, ox, baseY, wc, p, dx) {
      if (p <= 0) return;
      ctx.globalAlpha = (o.opacity ?? 1) * p * baseAlpha;
      ctx.fillStyle = wc;
      if (L.track === 0) ctx.fillText(w.text, ox + w.x + dx, baseY);
      else for (const c of w.chars) ctx.fillText(c.ch, ox + c.x + dx, baseY);
    }
    ctx.globalAlpha = baseAlpha;

    // A caret while typing, and for a moment after.
    if (R && R.mode === 'type' && !R.exit) {
      const typed = Math.floor(R.time / Math.max(0.001, R.stagger ?? 0.03));
      const done = typed >= L.chars;
      const after = R.time - L.chars * (R.stagger ?? 0.03);
      const blinkOn = !done || (after < 1.2 && Math.floor(after / 0.45) % 2 === 0);
      if (R.time >= 0 && blinkOn) {
        let cx = blockX, cy = blockY, found = false;
        for (let li = 0; li < L.lines.length && !found; li++) {
          const line = L.lines[li], ox = blockX + offsetFor(line.width);
          for (const w of line.words) for (const c of w.chars) {
            if (c.index >= typed) { cx = ox + c.x; cy = blockY + li * L.lineH; found = true; break; }
          }
          if (!found) { cx = ox + line.width + L.size * 0.08; cy = blockY + li * L.lineH; }
          if (found) break;
        }
        ctx.globalAlpha = baseAlpha;
        ctx.fillStyle = hiSet.size ? hiFill : fill;
        ctx.fillRect(cx, cy + (L.lineH - L.size) / 2 + L.size * 0.08, Math.max(2, L.size * 0.07), L.size * 0.9);
      }
    }

    // Underline under highlighted words, drawn on.
    if (hold && hold.mode === 'underline' && hiSet.size) {
      L.lines.forEach((line, li) => {
        const ox = blockX + offsetFor(line.width);
        const yy = blockY + li * L.lineH + (L.lineH - L.size) / 2 + ascent + L.size * 0.14;
        for (const w of line.words) if (isHi(w.text)) {
          ctx.globalAlpha = baseAlpha;
          ctx.fillStyle = hiFill;
          ctx.fillRect(ox + w.x, yy, w.w * clamp(hold.p), Math.max(2, L.size * 0.06));
        }
      });
    }

    // A soft band of light across the type, moving once per cycle.
    if (hold && hold.mode === 'shimmer') {
      const band = L.size * 1.6;
      const sweep = -band + (L.width + band * 2) * ((hold.p % 1 + 1) % 1);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(blockX + sweep, blockY - L.size);
      ctx.lineTo(blockX + sweep + band, blockY - L.size);
      ctx.lineTo(blockX + sweep + band - L.size, blockY + L.height + L.size);
      ctx.lineTo(blockX + sweep - L.size, blockY + L.height + L.size);
      ctx.closePath();
      ctx.clip();
      const light = toCss(mixColor(parseColor(fill) || [255, 255, 255, 1], [255, 255, 255, 1], 0.65));
      L.lines.forEach((line, li) => {
        const ox = blockX + offsetFor(line.width);
        const baseY = blockY + li * L.lineH + (L.lineH - L.size) / 2 + ascent;
        for (const w of line.words) { ctx.globalAlpha = baseAlpha * 0.9; ctx.fillStyle = light; if (L.track === 0) ctx.fillText(w.text, ox + w.x, baseY); else for (const c of w.chars) ctx.fillText(c.ch, ox + c.x, baseY); }
      });
      ctx.restore();
    }

    ctx.restore();
    record('text', blockX, blockY, L.width, L.height, { size: L.size, text: String(str).slice(0, 80), color: fill });
    return { x: blockX, y: blockY, w: L.width, h: L.height, lines: L.lines.length };
  }

  // ---- shapes --------------------------------------------------------------

  function paint(o, path) {
    const fillC = o.fill === null ? null : o.fill ?? null;
    if (fillC) { ctx.fillStyle = typeof fillC === 'string' ? color(fillC) : fillC; path ? ctx.fill(path) : ctx.fill(); }
    if (o.stroke) {
      ctx.strokeStyle = typeof o.stroke === 'string' ? color(o.stroke) : o.stroke;
      ctx.lineWidth = o.width ?? o.lineWidth ?? 2;
      ctx.lineCap = o.cap || 'round';
      ctx.lineJoin = 'round';
      path ? ctx.stroke(path) : ctx.stroke();
    }
  }

  function roundRectPath(x, y, w, h, r) {
    r = Math.max(0, Math.min(r || 0, Math.abs(w) / 2, Math.abs(h) / 2));
    ctx.beginPath();
    if (!r) { ctx.rect(x, y, w, h); return; }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function rect(x, y, w, h, o = {}) {
    ctx.save();
    if (o.opacity !== undefined) ctx.globalAlpha *= o.opacity;
    roundRectPath(x, y, w, h, o.radius);
    paint({ fill: o.fill ?? (o.stroke ? null : 'accent'), stroke: o.stroke, width: o.width ?? o.lineWidth });
    ctx.restore();
    record('shape', x, y, w, h);
  }

  function ellipse(x, y, rx, ry, o = {}) {
    ctx.save();
    if (o.opacity !== undefined) ctx.globalAlpha *= o.opacity;
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), 0, 0, Math.PI * 2);
    paint({ fill: o.fill ?? (o.stroke ? null : 'accent'), stroke: o.stroke, width: o.width ?? o.lineWidth });
    ctx.restore();
    record('shape', x - rx, y - ry, rx * 2, ry * 2);
  }
  const circle = (x, y, r, o = {}) => ellipse(x, y, r, r, o);

  // A line, drawn on from its start when o.progress < 1.
  function line(x1, y1, x2, y2, o = {}) {
    const p = clamp(o.progress ?? 1);
    if (p <= 0) return;
    ctx.save();
    if (o.opacity !== undefined) ctx.globalAlpha *= o.opacity;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 + (x2 - x1) * p, y1 + (y2 - y1) * p);
    paint({ stroke: o.color ?? o.stroke ?? 'ink', width: o.width ?? 2, cap: o.cap });
    ctx.restore();
    record('shape', Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  }

  // An arc of a circle from fraction `from` to `to` of a turn, starting at 12
  // o'clock. Drawn on with o.progress.
  function ring(x, y, r, o = {}) {
    const from = o.from ?? 0, to = o.to ?? 1, p = clamp(o.progress ?? 1);
    const a0 = -Math.PI / 2 + from * Math.PI * 2;
    const a1 = a0 + (to - from) * Math.PI * 2 * p;
    if (p <= 0) return;
    ctx.save();
    if (o.opacity !== undefined) ctx.globalAlpha *= o.opacity;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0, r), a0, a1);
    paint({ stroke: o.color ?? o.stroke ?? 'accent', width: o.width ?? 8, cap: o.cap });
    ctx.restore();
    record('shape', x - r, y - r, r * 2, r * 2);
  }

  function polygon(points, o = {}) {
    if (!points || points.length < 2) return;
    const p = clamp(o.progress ?? 1);
    ctx.save();
    if (o.opacity !== undefined) ctx.globalAlpha *= o.opacity;
    if (p < 1) {
      const subs = [{ points: o.closed === false ? points : [...points, points[0]], closed: false }];
      for (const seg of trimPath(subs, 0, p)) {
        ctx.beginPath();
        seg.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        paint({ stroke: o.stroke ?? o.color ?? 'ink', width: o.width ?? 2, cap: o.cap });
      }
    } else {
      ctx.beginPath();
      points.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      if (o.closed !== false) ctx.closePath();
      paint({ fill: o.fill, stroke: o.stroke, width: o.width, cap: o.cap });
    }
    ctx.restore();
    const xs = points.map((q) => q[0]), ys = points.map((q) => q[1]);
    record('shape', Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  }

  // An SVG path, placed at (x, y) and scaled; drawn on with o.progress.
  function path(d, o = {}) {
    let subs = pathCache.get(d);
    if (!subs) { subs = parsePath(d); if (pathCache.size > 200) pathCache.clear(); pathCache.set(d, subs); }
    if (!subs.length) return;
    const b = pathBounds(subs);
    const s = o.scale ?? 1;
    const ox = (o.x ?? 0) - (o.center ? (b.x + b.w / 2) * s : 0);
    const oy = (o.y ?? 0) - (o.center ? (b.y + b.h / 2) * s : 0);
    const p = clamp(o.progress ?? 1);
    ctx.save();
    if (o.opacity !== undefined) ctx.globalAlpha *= o.opacity;
    ctx.translate(ox, oy);
    ctx.scale(s, s);
    const lw = (o.width ?? 2) / (s || 1);
    if (o.fill && p >= 1) {
      ctx.beginPath();
      for (const sp of subs) sp.points.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.fillStyle = color(o.fill);
      ctx.fill('evenodd');
    }
    if (o.stroke || (o.fill && p < 1)) {
      for (const seg of p < 1 ? trimPath(subs, 0, p) : subs.map((sp) => sp.points)) {
        ctx.beginPath();
        seg.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        paint({ stroke: o.stroke ?? o.fill, width: lw, cap: o.cap });
      }
    }
    ctx.restore();
    record('shape', ox + b.x * s, oy + b.y * s, b.w * s, b.h * s);
  }

  function arrow(x1, y1, x2, y2, o = {}) {
    const p = clamp(o.progress ?? 1);
    if (p <= 0) return;
    const ex = x1 + (x2 - x1) * p, ey = y1 + (y2 - y1) * p;
    line(x1, y1, x2, y2, { ...o, progress: p });
    const a = Math.atan2(y2 - y1, x2 - x1), head = (o.head ?? 18) * Math.min(1, p * 3);
    ctx.save();
    if (o.opacity !== undefined) ctx.globalAlpha *= o.opacity;
    ctx.beginPath();
    ctx.moveTo(ex - Math.cos(a - 0.5) * head, ey - Math.sin(a - 0.5) * head);
    ctx.lineTo(ex, ey);
    ctx.lineTo(ex - Math.cos(a + 0.5) * head, ey - Math.sin(a + 0.5) * head);
    paint({ stroke: o.color ?? o.stroke ?? 'ink', width: o.width ?? 2, cap: 'round' });
    ctx.restore();
  }

  // A picture from the project's assets, fitted into a box centred on (x, y).
  function image(id, x, y, w, h, o = {}) {
    const img = assets[id];
    if (!img) return;
    const iw = img.width || img.displayWidth || w, ih = img.height || img.displayHeight || h;
    const k = o.fit === 'cover' ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
    const dw = iw * k, dh = ih * k;
    ctx.save();
    if (o.opacity !== undefined) ctx.globalAlpha *= o.opacity;
    roundRectPath(x - w / 2, y - h / 2, w, h, o.radius || 0);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, x - dw / 2, y - dh / 2, dw, dh);
    ctx.restore();
    record('image', x - w / 2, y - h / 2, w, h);
  }

  // ---- charts --------------------------------------------------------------

  // Bars growing from their base. p is 0..1 for the whole set; each bar starts
  // a little after the one before it.
  function bars(values, x, y, w, h, o = {}) {
    const n = values.length;
    if (!n) return;
    const max = o.max ?? Math.max(...values.map(Math.abs), 1e-9);
    const p = o.progress ?? 1;
    const horiz = o.orientation === 'horizontal';
    const gap = o.gap ?? 0.28;
    const slot = (horiz ? h : w) / n, thick = slot * (1 - gap);
    const fmt = (v) => formatNumber(v, o.decimals ?? 0, true) + (o.suffix || '');
    const labelSize = o.labelSize ?? 26 * u;
    values.forEach((v, i) => {
      const local = clamp((p * (1 + (n - 1) * 0.12) - i * 0.12));
      const f = ease.outExpo(local);
      const len = (Math.abs(v) / max) * (horiz ? w : h) * f;
      if (o.track) {
        if (horiz) rect(x, y + i * slot + (slot - thick) / 2, w, thick, { fill: o.track, radius: o.radius ?? thick * 0.12 });
        else rect(x + i * slot + (slot - thick) / 2, y, thick, h, { fill: o.track, radius: o.radius ?? thick * 0.12 });
      }
      if (horiz) {
        const by = y + i * slot + (slot - thick) / 2;
        rect(x, by, len, thick, { fill: o.color ?? 'accent', radius: o.radius ?? thick * 0.12 });
        if (o.labels?.[i]) text(o.labels[i], x - labelSize * 0.6, by + thick / 2, { size: labelSize, weight: 500, color: o.labelColor ?? 'muted', align: 'right', font: o.font });
        if (o.showValues !== false && f > 0.02) text(fmt(v * f), x + len + labelSize * 0.6, by + thick / 2, { size: labelSize, weight: 600, color: o.valueColor ?? 'ink', align: 'left', font: o.font, opacity: clamp(local * 2) });
      } else {
        const bx = x + i * slot + (slot - thick) / 2;
        rect(bx, y + h - len, thick, len, { fill: o.color ?? 'accent', radius: o.radius ?? thick * 0.12 });
        if (o.labels?.[i]) text(o.labels[i], bx + thick / 2, y + h + labelSize * 1.1, { size: labelSize, weight: 500, color: o.labelColor ?? 'muted', align: 'center', font: o.font });
        if (o.showValues !== false && f > 0.02) text(fmt(v * f), bx + thick / 2, y + h - len - labelSize * 0.9, { size: labelSize, weight: 600, color: o.valueColor ?? 'ink', align: 'center', font: o.font, opacity: clamp(local * 2) });
      }
    });
  }

  // A line through the values, drawn on with p, with a dot riding its tip.
  function lineChart(values, x, y, w, h, o = {}) {
    const n = values.length;
    if (n < 2) return;
    const lo = o.min ?? Math.min(...values), hi = o.max ?? Math.max(...values);
    const span = hi - lo || 1;
    const pts = values.map((v, i) => [x + (i / (n - 1)) * w, y + h - ((v - lo) / span) * h]);
    const p = clamp(o.progress ?? 1);
    const subs = [{ points: pts, closed: false }];
    if (o.area && p > 0) {
      const cut = trimPath(subs, 0, p)[0] || [];
      if (cut.length > 1) {
        ctx.save();
        ctx.beginPath();
        cut.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        ctx.lineTo(cut.at(-1)[0], y + h);
        ctx.lineTo(cut[0][0], y + h);
        ctx.closePath();
        ctx.fillStyle = withAlpha(color(o.color ?? 'accent'), 0.16);
        ctx.fill();
        ctx.restore();
      }
    }
    for (const seg of trimPath(subs, 0, p)) {
      ctx.save();
      ctx.beginPath();
      seg.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      paint({ stroke: o.color ?? 'accent', width: o.width ?? 6 * u });
      ctx.restore();
    }
    if (o.dots !== false) {
      const total = pathLength(subs);
      let walked = 0;
      pts.forEach((q, i) => {
        if (i) walked += Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]);
        if (walked / total <= p + 1e-6) circle(q[0], q[1], (o.width ?? 6 * u) * 1.2, { fill: o.color ?? 'accent' });
      });
      if (p > 0 && p < 1) {
        const tip = pointAt(subs, p);
        circle(tip.x, tip.y, (o.width ?? 6 * u) * 1.8, { fill: 'ink' });
      }
    }
    record('shape', x, y, w, h);
  }

  // ---- numbers ---------------------------------------------------------------

  function formatNumber(v, decimals = 0, separator = true) {
    const fixed = Math.abs(v).toFixed(decimals);
    const [i, f] = fixed.split('.');
    const grouped = separator ? i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : i;
    return (v < 0 ? '-' : '') + grouped + (f ? '.' + f : '');
  }

  // ---- transforms ------------------------------------------------------------

  function push(o = {}) {
    ctx.save();
    if (o.opacity !== undefined) ctx.globalAlpha *= clamp(o.opacity);
    ctx.translate(o.x ?? 0, o.y ?? 0);
    if (o.rotate) ctx.rotate((o.rotate * Math.PI) / 180);
    const sx = (o.scale ?? 1) * (o.sx ?? 1), sy = (o.scale ?? 1) * (o.sy ?? 1);
    if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
  }
  const pop = () => ctx.restore();

  function clip(x, y, w, h, draw) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    draw();
    ctx.restore();
  }

  function alpha(a, draw) {
    ctx.save();
    ctx.globalAlpha *= clamp(a);
    draw();
    ctx.restore();
  }

  function clear(c = 'bg') {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = color(c);
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function linear(x0, y0, x1, y1, stops) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    for (const [at, c] of stops) g.addColorStop(clamp(at), color(c));
    return g;
  }
  function radial(x, y, r, stops) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(1, r));
    for (const [at, c] of stops) g.addColorStop(clamp(at), color(c));
    return g;
  }

  // ---- texture -------------------------------------------------------------

  let grainTile = null;
  // Film grain: a seeded tile, shifted every frame. Fine-grained enough to take
  // the digital flatness off a dark frame without reading as noise.
  function grain(t, amount = 0.05) {
    if (amount <= 0 || !makeCanvas) return;
    if (!grainTile) {
      const size = 256;
      const c = makeCanvas(size, size);
      const g = c.getContext('2d');
      const img = g.createImageData(size, size);
      const r = rand(options.seed ?? 7);
      for (let i = 0; i < size * size; i++) {
        const v = r() < 0.5 ? 0 : 255;
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = Math.floor(r() * 60);
      }
      g.putImageData(img, 0, 0);
      grainTile = c;
    }
    const frame = Math.floor(t * 24);
    const r = rand(frame + 1);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = clamp(amount * 4);
    const pat = ctx.createPattern(grainTile, 'repeat');
    if (pat) {
      ctx.translate(-Math.floor(r() * 256), -Math.floor(r() * 256));
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, W + 256, H + 256);
    }
    ctx.restore();
  }

  function vignette(strength = 0.5) {
    if (strength <= 0) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${clamp(strength * 0.7)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  const kit = {
    ctx, W, H, u, fps: options.fps || 60, bpm: options.bpm || 120, palette,
    // time and numbers
    ease, resolveEase, clamp, mix, tween, keys, spring, progress, smoothstep, lerp: lerpValue, noise, noise2,
    rand, beat: (n) => n * beatLength(options.bpm || 120), beatLength: beatLength(options.bpm || 120),
    stagger: (i, step = 0.06) => i * step,
    // colour and type
    color, withAlpha: (c, a) => withAlpha(color(c), a), fontString, measureText: (s, o) => layoutText(s, o), formatNumber,
    // drawing
    clear, text, rect, ellipse, circle, line, ring, polygon, path, arrow, image, bars, lineChart, linear, radial, grain, vignette,
    // transforms
    push, pop, clip, alpha,
    // checks: collect boxes drawn while fn runs, tagged with a layer id
    collectInto(list) { collect = list; },
    mark: (kind, x, y, w, h, extra) => record(kind, x, y, w, h, extra),
    tag(id) { tag = id; },
  };
  return kit;
}
