// Compositions for a beat that shows the person's own picture or clip
// (src/core/scene/media.js): a screenshot, a product photo, a piece of
// footage.
//
// The media is shown whole at its own shape, never cropped, in a thin frame
// with rounded corners, and the beat's words sit beside it or above it. A clip
// may also fill the frame behind its words, under a veil of the background
// colour so they read. Which composition a scene takes turns across the film.
//
// Same inputs as layBeat in layouts.js, plus { asset, key, aspect, occurrence };
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
  const { b, asset, key, aspect, occurrence, X, cy, MW, vertical, pack, E, ease, ink, muted, accent, accentWords, hold } = c;
  if (!asset || !key) return null;
  const frame = ASPECTS[aspect] || ASPECTS['16:9'];
  const u = Math.min(frame.width, frame.height) / 1080;
  // The frame in units of a 1080 short side.
  const FW = frame.width / u, FH = frame.height / u;
  const wide = aspect === '16:9';
  const video = asset.kind === 'video';
  const layers = [];
  const type = video ? 'video' : 'image';
  const radius = 18;
  const show = (x, y, size, at = 0.15) => {
    layers.push({ type, asset: key, x, y, w: size.w, h: size.h, fit: 'contain', radius, ...(video ? { from: 0 } : {}), at, in: { preset: 'rise', duration: 0.9, ease } });
    layers.push({ type: 'shape', shape: 'rect', x, y, w: size.w, h: size.h, radius, fill: 'none', stroke: muted, strokeWidth: 1.5, opacity: 0.6, at, in: { preset: 'fade', duration: 0.9, ease } });
  };
  const line = (text, x, y, size, more = {}) => layers.push({ type: 'text', text, x, y, size, weight: pack.fonts.weight, color: ink, maxWidth: MW, highlight: accentWords, highlightColor: accent, hold, in: { preset: E.line, duration: 0.8, ease }, ...more });
  const small = (text, x, y, size, more = {}) => layers.push({ type: 'text', text, x, y, size, weight: 500, color: muted, maxWidth: MW, in: { preset: E.small, duration: 0.7, ease }, ...more });
  const words = b.text || '';
  const size = Math.round(lineSize(wordCount(words), b.kind === 'title' || b.kind === 'logo' ? 120 : 92, vertical) * 0.8);
  const turn = ((c.D?.layoutOffset ?? 0) + occurrence) % (video ? 3 : 2);
  let camera = { zoom: [1, 1.03] };

  if (!wide || b.kind === 'end') {
    // The media above the words, the two centred together on the frame.
    const s = fit(asset, FW * 0.84, FH * (wide ? 0.5 : 0.42));
    const wordsH = (words ? size * 1.2 * Math.min(3, Math.ceil(wordCount(words) / 4)) : 0) + (b.sub ? 70 : 0);
    const top = cy * FH - (s.h + 60 + wordsH) / 2;
    show(X, (top + s.h / 2) / FH, s);
    if (words) line(words, X, (top + s.h + 60 + size * 0.6) / FH, size, { at: 0.45 });
    if (b.sub) small(b.sub, X, (top + s.h + 60 + wordsH - 24) / FH, vertical ? 42 : 36, { at: 0.8 });
  } else if (turn === 0) {
    // The media large in the middle, the line above it.
    const s = fit(asset, 1460, 700);
    const y = 0.56;
    show(0.5, y, s);
    const above = (y * FH - s.h / 2 - 40 - size * 0.55) / FH;
    if (words) line(words, 0.5, Math.max(0.09, above), size, { at: 0.35 });
    if (b.sub) small(b.sub, 0.5, Math.min(0.95, (y * FH + s.h / 2 + 44) / FH), 34, { at: 0.75 });
    camera = { zoom: [1, 1.025] };
  } else if (turn === 1) {
    // The media on the right, the line on the left.
    const s = fit(asset, 1060, 780);
    show(0.66, 0.5, s);
    if (words) line(words, 0.07, b.sub ? cy - 0.06 : cy, size, { anchor: 'left', align: 'left', maxWidth: 0.3, at: 0.4 });
    if (b.sub) small(b.sub, 0.07, cy + 0.1, 34, { anchor: 'left', align: 'left', maxWidth: 0.28, at: 0.8 });
  } else {
    // A clip fills the frame behind the words, under a veil.
    layers.push({ type: 'video', asset: key, x: 0.5, y: 0.5, w: Math.round(FW), h: Math.round(FH), fit: 'cover', from: 0, z: -2, in: { preset: 'fade', duration: 0.6 } });
    layers.push({ type: 'shape', shape: 'rect', x: 0.5, y: 0.5, w: Math.round(FW), h: Math.round(FH), fill: 'bg', opacity: 0.55, z: -1, in: { preset: 'fade', duration: 0.6 } });
    if (words) line(words, X, b.sub ? cy - 0.04 : cy, Math.round(size * 1.15), { at: 0.3 });
    if (b.sub) small(b.sub, X, cy + 0.1, 38, { at: 0.7 });
    camera = { zoom: [1, 1.04] };
  }
  return { layers, entrance: 1.4, camera };
}
