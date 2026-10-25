// Compositions for a beat that shows the person's own picture or clip
// (src/core/scene/media.js): a screenshot, a product photo, a piece of
// footage.
//
// The media is shown whole at its own shape, never cropped, in a thin frame
// with rounded corners, and the beat's words sit beside it or above it. A clip
// may also fill the frame behind its words, under a veil of the background
// colour so they read. Which composition a scene takes turns across the film.
//
// A list, steps or a figure sits in a column beside the media. The beat right
// after one that showed the same media takes a second, closer look at it, and
// the compiler carries the picture across between the two.
//
// Same inputs as layBeat in layouts.js, plus { asset, key, aspect, occurrence,
// again: the scene before showed this media too };
// returns { layers, entrance, camera }.

import { ASPECTS, wordCount } from './format.js';
import { lineSize } from './layouts.js';

// The largest size of the media's own shape inside a box, in pixels of a
// 1080 frame.
function fit(asset, maxW, maxH) {
  const ar = asset.width && asset.height ? asset.width / asset.height : 16 / 9;
  let w = maxW, h = maxW / ar;
  if (h > maxH) { h = maxH; w = maxH * ar; }
  return { w: Math.round(w), h: Math.round(h) };
}

export function layMediaBeat(c) {
  const { b, asset, key, aspect, occurrence, X, cy, MW, vertical, pack, E, ease, ink, muted, accent, accentSmall, accentWords, hold, again } = c;
  if (!asset || !key) return null;
  const frame = ASPECTS[aspect] || ASPECTS['16:9'];
  const u = Math.min(frame.width, frame.height) / 1080;
  // The frame in units of a 1080 short side.
  const FW = frame.width / u, FH = frame.height / u;
  const wide = aspect === '16:9';
  const video = asset.kind === 'video';
  const tall = asset.width && asset.height ? asset.height / asset.width > 1.15 : false;
  const layers = [];
  const type = video ? 'video' : 'image';
  const radius = 18;
  // Pictures arrive two ways in turn: rising into place, or unfolding from
  // their top edge like a panel opening.
  const arrive = occurrence % 2 ? 'unfold' : 'rise';
  const show = (x, y, size, at = 0.15, more = {}) => {
    layers.push({ type, asset: key, x, y, w: size.w, h: size.h, fit: 'contain', radius, ...(video ? { from: 0 } : {}), at, in: { preset: arrive, duration: 0.9, ease }, ...more });
    layers.push({ type: 'shape', shape: 'rect', x, y, w: size.w, h: size.h, radius, fill: 'none', stroke: muted, strokeWidth: 1.5, opacity: 0.6, at, in: { preset: 'fade', duration: 0.9, ease } });
  };
  const line = (text, x, y, size, more = {}) => layers.push({ type: 'text', text, x, y, size, weight: pack.fonts.weight, color: ink, maxWidth: MW, highlight: accentWords, highlightColor: accent, hold, in: { preset: E.line, duration: 0.8, ease }, ...more });
  const small = (text, x, y, size, more = {}) => layers.push({ type: 'text', text, x, y, size, weight: 500, color: muted, maxWidth: MW, in: { preset: E.small, duration: 0.7, ease }, ...more });
  const words = b.text || '';
  const size = Math.round(lineSize(wordCount(words), b.kind === 'title' || b.kind === 'logo' ? 120 : 92, vertical) * 0.8);
  const turn = ((c.D?.layoutOffset ?? 0) + occurrence) % (video ? 3 : 2);
  let camera = { zoom: [1, 1.03] };
  const items = b.kind === 'list' || b.kind === 'steps' ? b.items || [] : [];

  // Items, a figure or a line set in a column on one side, the media on the
  // other; `side` is where the media sits.
  const beside = (side) => {
    const mx = side === 'right' ? 0.68 : 0.32;
    const tx = side === 'right' ? 0.07 : 0.56;
    const s = fit(asset, tall ? 760 : 1000, 860);
    show(mx, 0.5, s);
    if (items.length) {
      const step = 0.1;
      const top = 0.5 - ((items.length - 1) * step) / 2 + (words ? 0.05 : 0);
      if (words) small(words, tx, top - 0.13, 40, { anchor: 'left', align: 'left', maxWidth: 0.36, color: accentSmall, at: 0.2, upper: true, tracking: 0.1 });
      items.forEach((it, k) => {
        const at = 0.4 + k * 0.28;
        if (b.kind === 'steps') layers.push({ type: 'text', text: String(k + 1).padStart(2, '0'), x: tx, y: top + k * step, anchor: 'left', align: 'left', size: 30, weight: 600, font: 'mono', color: accentSmall, at, in: { preset: 'fade', duration: 0.4 } });
        else layers.push({ type: 'shape', shape: 'circle', x: tx + 0.006, y: top + k * step, w: 14, fill: accent, at, in: { preset: 'scale', duration: 0.5, ease } });
        layers.push({ type: 'text', text: it, x: tx + (b.kind === 'steps' ? 0.04 : 0.025), y: top + k * step, anchor: 'left', align: 'left', size: lineSize(wordCount(it), 58, false), weight: 600, color: ink, maxWidth: 0.34, at: at + 0.06, in: { preset: E.list || E.line, duration: 0.7, ease } });
      });
      return 0.4 + items.length * 0.28 + 0.7;
    }
    if (b.kind === 'stat') {
      layers.push({ type: 'counter', from: 0, to: b.value, prefix: b.prefix, suffix: b.suffix, decimals: b.decimals, weight: Math.min(900, pack.fonts.weight + 100), color: accent, count: 1.4, x: tx, y: cy - 0.05, anchor: 'left', align: 'left', size: 170, at: 0.3, in: { preset: 'rise', duration: 0.6, ease } });
      if (b.sub) line(b.sub, tx, cy + 0.1, lineSize(wordCount(b.sub), 52, false), { anchor: 'left', align: 'left', maxWidth: 0.34, at: 0.8, hold: 'none' });
      return 1.6;
    }
    if (words) line(words, tx, b.sub ? cy - 0.06 : cy, size, { anchor: 'left', align: 'left', maxWidth: 0.34, at: 0.4 });
    if (b.sub) small(b.sub, tx, cy + 0.1, 34, { anchor: 'left', align: 'left', maxWidth: 0.32, at: 0.8 });
    return 1.4;
  };

  let entrance = 1.4;
  if (!wide || b.kind === 'end') {
    // The media above the words, the two centred together on the frame.
    const s = fit(asset, FW * 0.84, FH * (wide ? 0.5 : 0.42));
    const shown = items.length ? items.slice(0, 3).join(' \u00b7 ') : words;
    const wordsH = (shown ? size * 1.2 * Math.min(3, Math.ceil(wordCount(shown) / 4)) : 0) + (b.sub ? 70 : 0);
    const top = cy * FH - (s.h + 60 + wordsH) / 2;
    show(X, (top + s.h / 2) / FH, s);
    if (shown) line(shown, X, (top + s.h + 60 + size * 0.6) / FH, size, { at: 0.45 });
    if (b.sub) small(b.sub, X, (top + s.h + 60 + wordsH - 24) / FH, vertical ? 42 : 36, { at: 0.8 });
  } else if (again) {
    // A second look at the media the scene before showed: larger, closer,
    // the words reduced to a label beside it, the camera easing in.
    const s = fit(asset, tall ? 1100 : 1500, tall ? 960 : 900);
    const mx = tall ? 0.6 : 0.5;
    show(mx, tall ? 0.5 : 0.53, s, 0);
    const label = items.length ? items.join(' \u00b7 ') : words;
    if (tall) {
      if (label) line(label, 0.11, b.sub ? cy - 0.05 : cy, Math.round(size * 0.9), { anchor: 'left', align: 'left', maxWidth: 0.27, at: 0.35 });
      if (b.sub) small(b.sub, 0.11, cy + 0.1, 34, { anchor: 'left', align: 'left', maxWidth: 0.26, at: 0.7 });
    } else if (label) {
      small(label, 0.5, 0.06, 38, { color: ink, at: 0.35, maxWidth: 0.8 });
    }
    // The push ends with the picture still whole inside the frame.
    const room = Math.min(FH / (s.h + 24), FW / (s.w + 24));
    camera = { zoom: [1, Math.max(1.02, Math.min(1.08, room))], ease: 'linear' };
    entrance = 1.2;
  } else if (items.length || b.kind === 'stat') {
    entrance = beside(turn === 0 ? 'right' : 'left');
  } else if (turn === 0 && !tall) {
    // The media large in the middle, the line above it.
    const s = fit(asset, 1460, 700);
    const y = 0.56;
    show(0.5, y, s);
    const above = (y * FH - s.h / 2 - 40 - size * 0.55) / FH;
    if (words) line(words, 0.5, Math.max(0.09, above), size, { at: 0.35 });
    if (b.sub) small(b.sub, 0.5, Math.min(0.95, (y * FH + s.h / 2 + 44) / FH), 34, { at: 0.75 });
    camera = { zoom: [1, 1.025] };
  } else if (turn < 2) {
    // The media to one side, the line beside it; a tall picture stands as
    // large as the frame allows.
    entrance = beside(turn === 0 ? 'left' : 'right');
  } else {
    // A clip fills the frame behind the words, under a veil.
    layers.push({ type: 'video', asset: key, x: 0.5, y: 0.5, w: Math.round(FW), h: Math.round(FH), fit: 'cover', from: 0, z: -2, in: { preset: 'fade', duration: 0.6 } });
    layers.push({ type: 'shape', shape: 'rect', x: 0.5, y: 0.5, w: Math.round(FW), h: Math.round(FH), fill: 'bg', opacity: 0.55, z: -1, in: { preset: 'fade', duration: 0.6 } });
    if (words) line(words, X, b.sub ? cy - 0.04 : cy, Math.round(size * 1.15), { at: 0.3 });
    if (b.sub) small(b.sub, X, cy + 0.1, 38, { at: 0.7 });
    camera = { zoom: [1, 1.04] };
  }
  return { layers, entrance, camera };
}
