// The compositions the compiler lays each kind of beat out in.
//
// One function per film scene: it takes a beat of the storyboard and the
// frame's measures, colours and motion choices, and returns the layers that
// draw it, how long its entrance takes and how its camera moves. Several kinds
// have more than one composition; the film's direction chooses which
// (layoutFor in src/core/scene/direction.js), so two films of the same words
// do not look the same.

import { wordCount } from './format.js';

// Text size for a line of n words, so long lines shrink before they wrap badly.
export function lineSize(words, big, vertical) {
  const base = words <= 3 ? big : words <= 6 ? big * 0.78 : words <= 10 ? big * 0.62 : big * 0.5;
  return Math.max(vertical ? 36 : 28, Math.round(vertical ? base * 0.92 : base));
}

// c: { b, lay, X, cy, MW, left, vertical, wide, style, pack, E, ease, D, beat, opts,
//      sceneBg, ink, accent, accentSmall, muted, hold, accentWords, accentHold }
export function layBeat(c) {
  const { b, lay, X, cy, MW, left, vertical, wide, style, pack, E, ease, D, beat, opts, sceneBg, ink, accent, accentSmall, muted, hold, accentWords } = c;
  const layers = [];
  let entrance = 0.9;
  let camera = { zoom: [1, 1.035] };
  switch (b.kind) {
    case 'hook': case 'statement': {
      const big = b.kind === 'hook' ? 132 : 112;
      const n = wordCount(b.text);
      const size = lineSize(n, big, vertical);
      if (lay === 1 && wide) {
        // Set left, under a short accent rule: an editorial page.
        layers.push({ type: 'shape', shape: 'line', x: left + 0.03, y: cy - 0.16, w: 110, h: 0, strokeWidth: 5, color: accent, in: { preset: 'draw', duration: 0.5, ease: 'inOutCubic' } });
        layers.push({ type: 'text', text: b.text, x: left, y: b.sub ? cy - 0.03 : cy, anchor: 'left', align: 'left', size: Math.round(size * 1.08), weight: pack.fonts.weight, color: ink,
          maxWidth: 0.7, highlight: accentWords, highlightColor: accent, hold, at: 0.15, in: { preset: E.line, duration: 0.8, ease } });
        if (b.sub) layers.push({ type: 'text', text: b.sub, x: left, y: cy + 0.12, anchor: 'left', align: 'left', size: 40, weight: 500, color: muted, at: 0.55, maxWidth: 0.6, in: { preset: E.small, duration: 0.7, ease } });
        break;
      }
      if (lay === 2 && n >= 2 && n <= 6) {
        // Word by word, large: the line builds itself in the centre.
        layers.push({ type: 'text', text: b.text, x: X, y: b.sub ? cy - 0.05 : cy, size: Math.round(size * 1.12), weight: Math.min(900, pack.fonts.weight + 100), color: ink, leading: 1.05,
          maxWidth: vertical ? MW : 0.7, highlight: accentWords, highlightColor: accent, hold, in: { preset: 'words', duration: 0.6, stagger: 0.12, ease } });
        if (b.sub) layers.push({ type: 'text', text: b.sub, x: X, y: cy + (vertical ? 0.13 : 0.16), size: vertical ? 44 : 40, weight: 500, color: muted, at: 0.35 + n * 0.12, maxWidth: MW, in: { preset: E.small, duration: 0.7, ease } });
        break;
      }
      layers.push({
        type: 'text', text: b.text, x: X, y: b.sub ? cy - 0.04 : cy, size, weight: pack.fonts.weight, color: ink,
        maxWidth: MW, highlight: accentWords, highlightColor: accent, hold,
        in: { preset: n <= 4 ? E.title : E.line, duration: 0.8, ease },
      });
      if (b.sub) layers.push({ type: 'text', text: b.sub, x: X, y: cy + (vertical ? 0.1 : 0.12), size: vertical ? 44 : 40, weight: 500, color: muted, at: 0.45, maxWidth: MW, in: { preset: E.small, duration: 0.7, ease } });
      break;
    }
    case 'title': {
      // A field of dots filling in behind the name: one rule, many shapes.
      if (style === 'tech' || style === 'stage' || D?.motif === 'rings') {
        if (D?.motif === 'rings') {
          // Rings opening out behind the name, each a moment after the last.
          [1, 1.45, 1.95].forEach((k, j) => layers.push({ type: 'shape', shape: 'ring', x: X, y: cy - 0.03, w: Math.round((vertical ? 640 : 560) * k), fill: 'none', stroke: j ? muted : accent, strokeWidth: 2, opacity: 0.5 - j * 0.14, z: -1, at: j * 0.14, in: { preset: 'draw', duration: 1.2, ease: 'inOutCubic' } }));
        } else {
          layers.push({ type: 'shape', shape: 'circle', x: X, y: cy, w: 6, fill: muted, opacity: 0.35, z: -1, in: { preset: 'scale', duration: 0.4, ease },
            repeat: { count: vertical ? 54 : 105, layout: 'grid', cols: vertical ? 6 : 15, gap: 90, stagger: 0.012 } });
        }
      }
      const nameSize = lineSize(wordCount(b.text), 150, vertical);
      const nameHold = style === 'studio' || style === 'tech' ? 'shimmer' : hold;
      if (lay === 1 && wide && b.sub) {
        // The name on the left, a hairline, the tagline on the right.
        layers.push({ type: 'text', text: b.text, x: 0.56, y: cy, anchor: 'right', align: 'right', size: Math.round(nameSize * 0.9), weight: Math.min(900, pack.fonts.weight + 100), color: ink, maxWidth: 0.44, highlight: accentWords, highlightColor: accent, in: { preset: E.title, duration: 0.8, ease }, hold: nameHold });
        layers.push({ type: 'shape', shape: 'line', x: 0.6, y: cy, w: 0, h: 180, strokeWidth: 4, color: accent, at: 0.35, in: { preset: 'draw', duration: 0.6, ease: 'inOutCubic' } });
        layers.push({ type: 'text', text: b.sub, x: 0.64, y: cy, anchor: 'left', align: 'left', size: 46, weight: 500, color: muted, at: 0.6, maxWidth: 0.3, in: { preset: E.small, duration: 0.7, ease } });
        entrance = 1.2;
        break;
      }
      if (lay === 2) {
        // The name inside a ring that draws itself round.
        layers.push({ type: 'shape', shape: 'ring', x: X, y: cy - 0.03, w: vertical ? 760 : 620, fill: 'none', stroke: accent, strokeWidth: 4, z: -1, at: 0.1, in: { preset: 'draw', duration: 1.1, ease: 'inOutCubic' } });
        layers.push({ type: 'text', text: b.text, x: X, y: cy - 0.03, size: Math.round(nameSize * 0.82), weight: Math.min(900, pack.fonts.weight + 100), color: ink, maxWidth: vertical ? 0.62 : 0.3, highlight: accentWords, highlightColor: accent, at: 0.35, in: { preset: E.title, duration: 0.8, ease }, hold: nameHold });
        if (b.sub) layers.push({ type: 'text', text: b.sub, x: X, y: cy + (vertical ? 0.24 : 0.36), size: vertical ? 46 : 40, weight: 500, color: muted, at: 0.9, maxWidth: MW, in: { preset: E.small, duration: 0.7, ease } });
        entrance = 1.5;
        break;
      }
      layers.push({ type: 'text', text: b.text, x: X, y: cy - 0.05, size: nameSize, weight: Math.min(900, pack.fonts.weight + 100), color: ink, highlight: accentWords, highlightColor: accent, in: { preset: E.title, duration: 0.8, ease }, hold: nameHold });
      layers.push({ type: 'shape', shape: 'line', x: X, y: cy + 0.055, w: vertical ? 140 : 120, h: 0, strokeWidth: 6, color: accent, at: 0.35, in: { preset: 'draw', duration: 0.6, ease: 'inOutCubic' } });
      if (b.sub) layers.push({ type: 'text', text: b.sub, x: X, y: cy + 0.13, size: vertical ? 46 : 44, weight: 500, color: muted, at: 0.6, maxWidth: MW, in: { preset: E.small, duration: 0.7, ease } });
      entrance = 1.2;
      break;
    }
    case 'stat': {
      const counter = { type: 'counter', from: 0, to: b.value, prefix: b.prefix, suffix: b.suffix, decimals: b.decimals, weight: Math.min(900, pack.fonts.weight + 100), color: accent, count: 1.4, roll: Boolean(pack.roll), in: { preset: pack.roll ? 'soft' : 'rise', duration: 0.6, ease } };
      if (lay === 1 && wide && b.sub) {
        // The figure large on the left, what it means beside it.
        layers.push({ ...counter, x: 0.5, y: cy, anchor: 'right', align: 'right', size: 250 });
        layers.push({ type: 'text', text: b.sub, x: 0.55, y: cy, anchor: 'left', align: 'left', size: lineSize(wordCount(b.sub), 60, false), weight: 500, color: ink, at: 0.6, maxWidth: 0.34, in: { preset: E.line, duration: 0.7, ease } });
      } else if (lay === 2 && b.suffix && /%/.test(b.suffix) && b.value > 0 && b.value <= 100) {
        // A share: the ring fills to the figure while it counts.
        layers.push({ type: 'shape', shape: 'ring', x: X, y: cy - 0.06, w: vertical ? 560 : 440, fill: 'none', stroke: 'surface', strokeWidth: 14, z: -1, in: { preset: 'fade', duration: 0.4 } });
        layers.push({ type: 'shape', shape: 'ring', x: X, y: cy - 0.06, w: vertical ? 560 : 440, fill: 'none', stroke: accent, strokeWidth: 14, arc: [0, b.value / 100], z: 0, in: { preset: 'draw', duration: 1.4, ease: 'inOutCubic' } });
        layers.push({ ...counter, x: X, y: cy - 0.06, size: vertical ? 150 : 130, color: ink });
        if (b.sub) layers.push({ type: 'text', text: b.sub, x: X, y: cy + (vertical ? 0.14 : 0.2), size: lineSize(wordCount(b.sub), 50, vertical), weight: 500, color: muted, at: 0.6, maxWidth: MW, in: { preset: E.small, duration: 0.7, ease } });
      } else {
        layers.push({ ...counter, x: X, y: cy - 0.06, size: vertical ? 190 : 210 });
        if (b.sub) layers.push({ type: 'text', text: b.sub, x: X, y: cy + 0.12, size: lineSize(wordCount(b.sub), 56, vertical), weight: 500, color: muted, at: 0.5, maxWidth: MW, in: { preset: E.small, duration: 0.7, ease } });
      }
      entrance = 1.6;
      camera = { zoom: [1.03, 1] };
      break;
    }
    case 'list': {
      const n = b.items.length;
      const step = vertical ? 0.075 : 0.12;
      if (lay === 2) {
        // Centred, one line after another, no marks.
        const top = (b.text ? cy - 0.02 : cy) - ((n - 1) * step) / 2;
        if (b.text) layers.push({ type: 'text', text: b.text, x: X, y: top - (vertical ? 0.1 : 0.15), size: vertical ? 40 : 34, weight: 600, upper: true, tracking: 0.14, color: accentSmall, in: { preset: 'fade', duration: 0.6 } });
        b.items.forEach((it, k) => {
          layers.push({ type: 'text', text: it, x: X, y: top + k * step, size: lineSize(wordCount(it), vertical ? 62 : 70, vertical), weight: pack.fonts.weight, color: ink, maxWidth: MW, at: 0.25 + k * 0.32, in: { preset: E.line, duration: 0.7, ease } });
        });
        entrance = 0.25 + n * 0.32 + 0.7;
        break;
      }
      const top = b.text ? (vertical ? 0.3 : 0.34) : cy - ((n - 1) * step) / 2;
      if (b.text) layers.push({ type: 'text', text: b.text, x: left, y: vertical ? 0.2 : 0.2, anchor: 'left', align: 'left', size: vertical ? 64 : 60, weight: pack.fonts.weight, color: ink, in: { preset: E.line, duration: 0.7, ease } });
      b.items.forEach((it, k) => {
        const at = (b.text ? 0.35 : 0) + k * 0.28;
        const y = top + k * step;
        if (lay === 1) {
          // Numbered, with a hairline under each line.
          layers.push({ type: 'text', text: String(k + 1).padStart(2, '0'), x: left, y, anchor: 'left', align: 'left', size: vertical ? 34 : 30, weight: 600, font: 'mono', color: accentSmall, at, in: { preset: 'fade', duration: 0.4 } });
          layers.push({ type: 'shape', shape: 'line', x: left + (vertical ? 0.4 : 0.38), y: y + step * 0.42, w: vertical ? 860 : 1300, h: 0, strokeWidth: 1, color: muted, opacity: 0.5, at: at + 0.05, in: { preset: 'draw', duration: 0.6, ease: 'inOutCubic' } });
        } else {
          layers.push({ type: 'shape', shape: 'circle', x: left + 0.006, y, w: 16, fill: accent, at, in: { preset: 'scale', duration: 0.5, ease } });
        }
        layers.push({ type: 'text', text: it, x: left + (vertical ? 0.07 : lay === 1 ? 0.05 : 0.03), y, anchor: 'left', align: 'left', size: lineSize(wordCount(it), vertical ? 60 : 64, vertical), weight: 600, color: ink, maxWidth: vertical ? 0.7 : 0.7, at: at + 0.06, in: { preset: E.list, duration: 0.7, ease } });
      });
      entrance = (b.text ? 0.35 : 0) + n * 0.28 + 0.7;
      break;
    }
    case 'steps': {
      const n = b.items.length;
      if (b.text) layers.push({ type: 'text', text: b.text, x: X, y: vertical ? 0.2 : 0.22, size: vertical ? 64 : 60, weight: pack.fonts.weight, color: ink, in: { preset: E.line, duration: 0.7, ease } });
      if (!vertical) {
        const spread = Math.min(0.66, 0.22 * (n - 1));
        const x0 = 0.5 - spread / 2, x1 = 0.5 + spread / 2;
        const span = spread * 1920;
        layers.push({ type: 'shape', shape: 'line', x: X, y: 0.5, w: span, h: 0, strokeWidth: 3, color: muted, at: 0.3, in: { preset: 'draw', duration: 0.4 + n * 0.3, ease: 'inOutCubic' } });
        b.items.forEach((it, k) => {
          const x = n === 1 ? 0.5 : x0 + ((x1 - x0) * k) / (n - 1);
          const at = 0.4 + k * 0.32;
          layers.push({ type: 'shape', shape: 'circle', x, y: 0.5, w: 76, fill: sceneBg || 'bg', stroke: accent, strokeWidth: 5, at, z: 1, in: { preset: 'scale', duration: 0.5, ease } });
          layers.push({ type: 'text', text: String(k + 1), x, y: 0.5, size: 34, weight: 700, color: accentSmall, at: at + 0.1, z: 2, in: { preset: 'fade', duration: 0.4 } });
          layers.push({ type: 'text', text: it, x, y: 0.63, size: lineSize(wordCount(it), 44, false), weight: 600, color: ink, maxWidth: 0.9 / n, at: at + 0.15, in: { preset: 'rise', duration: 0.6, ease } });
        });
      } else {
        const top = 0.3, step = Math.min(0.11, 0.42 / Math.max(1, n - 1));
        layers.push({ type: 'shape', shape: 'line', x: 0.16, y: top + ((n - 1) * step) / 2, w: 0, h: (n - 1) * step * 1920, strokeWidth: 3, color: muted, at: 0.3, in: { preset: 'draw', duration: 0.4 + n * 0.3 } });
        b.items.forEach((it, k) => {
          const y = top + k * step, at = 0.4 + k * 0.32;
          layers.push({ type: 'shape', shape: 'circle', x: 0.16, y, w: 70, fill: sceneBg || 'bg', stroke: accent, strokeWidth: 5, at, z: 1, in: { preset: 'scale', duration: 0.5, ease } });
          layers.push({ type: 'text', text: String(k + 1), x: 0.16, y, size: 36, weight: 700, color: accentSmall, at: at + 0.1, z: 2, in: 'fade' });
          layers.push({ type: 'text', text: it, x: 0.25, y, anchor: 'left', align: 'left', size: lineSize(wordCount(it), 52, true), weight: 600, color: ink, maxWidth: 0.62, at: at + 0.15, in: { preset: 'rise', ease } });
        });
      }
      entrance = 0.55 + n * 0.32;
      camera = { zoom: [1, 1.02] };
      break;
    }
    case 'chart': {
      if (b.text) layers.push({ type: 'text', text: b.text, x: left, y: vertical ? 0.2 : 0.16, anchor: 'left', align: 'left', size: vertical ? 60 : 56, weight: pack.fonts.weight, color: ink, maxWidth: MW, in: { preset: E.line, duration: 0.7, ease } });
      const w = vertical ? 900 : 1400, h = vertical ? 760 : 560;
      if (b.chart === 'line') {
        layers.push({ type: 'line-chart', values: b.values, x: X, y: vertical ? 0.47 : 0.56, w, h, color: accent, area: true, at: 0.3, in: { preset: 'draw', duration: 1.8, ease: 'inOutCubic' } });
      } else {
        layers.push({ type: 'bars', values: b.values, labels: b.labels, suffix: b.suffix, x: X, y: vertical ? 0.47 : 0.56, w, h, color: accent, labelSize: vertical ? 34 : 28, at: 0.3, in: { preset: 'grow', duration: 1.6, ease } });
      }
      entrance = 2.2;
      camera = { zoom: [1, 1.02] };
      break;
    }
    case 'quote': {
      if (lay === 1 && wide) {
        // Set left beside an accent bar.
        layers.push({ type: 'shape', shape: 'line', x: left, y: cy, w: 0, h: 300, strokeWidth: 6, color: accent, in: { preset: 'draw', duration: 0.6, ease: 'inOutCubic' } });
        layers.push({ type: 'text', text: b.text, x: left + 0.04, y: cy - 0.03, anchor: 'left', align: 'left', size: lineSize(wordCount(b.text), 80, false), weight: 500, font: 'serif', color: ink, maxWidth: 0.66, leading: 1.2, at: 0.2, highlight: accentWords, highlightColor: accent, in: { preset: 'words', duration: 0.6, stagger: 0.06, ease } });
        if (b.by) layers.push({ type: 'text', text: b.by, x: left + 0.04, y: cy + 0.17, anchor: 'left', align: 'left', size: 34, weight: 600, upper: true, tracking: 0.1, color: muted, at: 0.8, in: { preset: 'rise', ease } });
        entrance = 0.8 + wordCount(b.text) * 0.06;
        break;
      }
      layers.push({ type: 'text', text: '“', x: X, y: vertical ? 0.26 : 0.24, size: 200, weight: 700, font: 'serif', color: accent, in: { preset: 'fade', duration: 0.6 } });
      layers.push({ type: 'text', text: b.text, x: X, y: cy, size: lineSize(wordCount(b.text), 84, vertical), weight: 500, font: 'serif', color: ink, maxWidth: vertical ? 0.76 : 0.72, leading: 1.2, at: 0.2, highlight: accentWords, highlightColor: accent, in: { preset: 'words', duration: 0.6, stagger: 0.06, ease } });
      if (b.by) layers.push({ type: 'text', text: `— ${b.by}`, x: X, y: vertical ? 0.66 : 0.74, size: 36, weight: 500, color: muted, at: 0.8, in: { preset: 'rise', ease } });
      entrance = 0.8 + wordCount(b.text) * 0.06;
      break;
    }
    case 'compare': {
      const pos = vertical ? [[X, 0.3], [X, 0.58]] : [[0.28, cy], [0.72, cy]];
      [b.left, b.right].forEach((side, k) => {
        const [x, y] = pos[k];
        const at = k * 0.6;
        layers.push({ type: 'text', text: side.label.toUpperCase(), x, y: y - (vertical ? 0.06 : 0.1), size: vertical ? 36 : 30, weight: 600, tracking: 0.12, color: k ? accentSmall : muted, at, in: { preset: 'fade', duration: 0.5 } });
        layers.push({ type: 'text', text: side.text, x, y: y + 0.02, size: lineSize(wordCount(side.text), 72, vertical), weight: pack.fonts.weight, color: k ? ink : muted, maxWidth: vertical ? 0.76 : 0.38, at: at + 0.15, in: { preset: E.line, duration: 0.7, ease } });
      });
      layers.push(vertical
        ? { type: 'shape', shape: 'line', x: X, y: 0.44, w: 280, h: 0, strokeWidth: 3, color: muted, at: 0.4, in: { preset: 'draw', duration: 0.6 } }
        : { type: 'shape', shape: 'line', x: X, y: cy, w: 0, h: 320, strokeWidth: 3, color: muted, at: 0.4, in: { preset: 'draw', duration: 0.6 } });
      entrance = 1.5;
      break;
    }
    case 'words': {
      // One word or phrase on the beat, each replacing the last: the punch-in
      // rhythm. Each holds whole beats, long enough to be taken in at a glance.
      const stride = Math.max(2, Math.ceil(1.15 / beat - 1e-6)) * beat;
      b.words.forEach((w, k) => {
        const last = k === b.words.length - 1;
        layers.push({
          type: 'text', text: w, x: X, y: cy, size: lineSize(wordCount(w), 160, vertical), weight: Math.min(900, pack.fonts.weight + 100),
          color: accentWords.includes(w) || (last && accentWords.length === 0 && b.words.length > 2) ? accent : ink,
          at: +(k * stride).toFixed(3), until: last ? undefined : +((k + 1) * stride).toFixed(3),
          in: { preset: 'scale', duration: 0.25, ease: 'outExpo' }, out: 'none',
        });
      });
      entrance = (b.words.length - 1) * stride + 0.25;
      camera = { zoom: [1, 1.06] };
      break;
    }
    case 'logo': {
      if (b.asset && opts.assets && opts.assets[b.asset]) {
        layers.push({ type: 'image', asset: b.asset, x: X, y: cy - 0.1, w: vertical ? 420 : 360, h: vertical ? 420 : 360, in: { preset: 'focus', duration: 0.9, ease } });
        layers.push({ type: 'text', text: b.text, x: X, y: cy + 0.16, size: 96, weight: pack.fonts.weight, color: ink, at: 0.5, in: { preset: E.title, duration: 0.8, ease } });
      } else {
        layers.push({ type: 'text', text: b.text, x: X, y: b.sub ? cy - 0.03 : cy, size: lineSize(wordCount(b.text), 160, vertical), weight: Math.min(900, pack.fonts.weight + 100), color: ink, in: { preset: E.title, duration: 0.9, ease }, hold: 'shimmer' });
      }
      if (b.sub) layers.push({ type: 'text', text: b.sub, x: X, y: cy + (b.asset ? 0.26 : 0.1), size: 44, weight: 500, color: muted, at: 0.7, maxWidth: MW, in: { preset: E.small, duration: 0.7, ease } });
      entrance = 1.4;
      camera = { zoom: [1.04, 1] };
      break;
    }
    case 'end': {
      if (lay === 1 && wide) {
        layers.push({ type: 'text', text: b.text, x: left, y: cy - 0.04, anchor: 'left', align: 'left', size: lineSize(wordCount(b.text), 128, false), weight: Math.min(900, pack.fonts.weight + 100), color: ink, maxWidth: 0.72, highlight: accentWords, highlightColor: accent, in: { preset: E.title, duration: 0.8, ease } });
        layers.push({ type: 'shape', shape: 'line', x: left + 0.06, y: cy + 0.06, w: 220, h: 0, strokeWidth: 3, color: accent, at: 0.4, in: { preset: 'draw', duration: 0.6, ease: 'inOutCubic' } });
        if (b.sub) layers.push({ type: 'text', text: b.sub, x: left, y: cy + 0.13, anchor: 'left', align: 'left', size: 44, weight: 600, color: accentSmall, at: 0.6, maxWidth: 0.6, in: { preset: E.small, duration: 0.7, ease } });
        entrance = 1.3;
        camera = { zoom: [1.03, 1] };
        break;
      }
      layers.push({ type: 'text', text: b.text, x: X, y: cy - 0.05, size: lineSize(wordCount(b.text), 128, vertical), weight: Math.min(900, pack.fonts.weight + 100), color: ink, highlight: accentWords, highlightColor: accent, in: { preset: E.title, duration: 0.8, ease } });
      if (b.sub) layers.push({ type: 'text', text: b.sub, x: X, y: cy + 0.07, size: 44, weight: 600, color: accentSmall, at: 0.5, maxWidth: MW, in: { preset: E.small, duration: 0.7, ease } });
      entrance = 1.2;
      camera = { zoom: [1.03, 1] };
      break;
    }
    default: break;
  }

  return { layers, entrance, camera };
}
