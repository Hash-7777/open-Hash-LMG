// Compositions for a beat that shows a picture (src/core/scene/pictures.js).
//
// The picture is the subject of the frame, not a decoration beside the type:
// it sits on a panel of its own beside the line, stands above it, fills the
// frame faintly behind it, marks the name like a logo, stands beside a figure
// or a list. Which one a scene takes turns with the film's direction, so a
// film with pictures in several scenes never repeats one frame.
//
// Side by side only on a wide frame. A square or tall frame stacks the picture
// over the words, the whole block centred and measured in pixels of the
// frame's own height, so it fits a square as well as a phone.
//
// Same inputs as layBeat in layouts.js, plus { pic, aspect, occurrence, inkOn };
// returns { layers, entrance, camera }, or null when the beat has no picture
// composition and the plain one is used.

import { ASPECTS, wordCount } from './format.js';
import { lineSize } from './layouts.js';
import { pictureLayers } from './pictures.js';

export function layPictureBeat(c) {
  const { b, pic, aspect, occurrence, X, cy, MW, left, vertical, pack, E, ease, D, sceneBg, ink, accent, accentSmall, muted, hold, accentWords, inkOn } = c;
  if (!pic) return null;
  const frame = ASPECTS[aspect] || ASPECTS['16:9'];
  const H = frame.height;
  const wide = aspect === '16:9';
  const layers = [];
  const draw = (x, y, size, more = {}) => layers.push(...pictureLayers(pic, x, y, { aspect, size, ink: more.ink || ink, accent, ...more }));
  const turn = ((D?.layoutOffset ?? 0) + occurrence) % 3;
  const heavy = Math.min(900, pack.fonts.weight + 100);
  // A picture over a block of words `wordsH` pixels tall, the two centred
  // together on the frame's middle line: where each sits, as fractions.
  const stack = (P, wordsH, gap = 60) => {
    const top = cy * H - (P + gap + wordsH) / 2;
    return { pic: (top + P / 2) / H, words: (top + P + gap) / H, bottom: (top + P + gap + wordsH) / H };
  };
  const linesH = (text, size, perLine = 4) => size * 1.15 * Math.min(3, Math.ceil(wordCount(text) / perLine));
  const tallPic = (most, share) => Math.round(Math.min(most, H * share));
  let entrance = 1.6;
  let camera = { zoom: [1, 1.03] };

  const line = (text, x, y, size, more = {}) => layers.push({ type: 'text', text, x, y, size, weight: pack.fonts.weight, color: ink, maxWidth: MW, highlight: accentWords, highlightColor: accent, hold, in: { preset: E.line, duration: 0.8, ease }, ...more });
  const small = (text, x, y, size, more = {}) => layers.push({ type: 'text', text, x, y, size, weight: 500, color: muted, maxWidth: MW, in: { preset: E.small, duration: 0.7, ease }, ...more });

  switch (b.kind) {
    case 'hook': case 'statement': {
      const size = lineSize(wordCount(b.text), b.kind === 'hook' ? 124 : 104, vertical);
      const subSize = vertical ? 44 : 38;
      if (turn === 0) {
        // The picture on a panel of its own, the line beside it, or under it
        // on a square or tall frame: the frame splits in two.
        const panel = sceneBg === 'surface' ? 'bg' : 'surface';
        const on = inkOn(panel);
        if (wide) {
          layers.push({ type: 'shape', shape: 'rect', x: 0.25, y: 0.5, w: 960, h: 1080, fill: panel, z: -1, in: { preset: 'grow', duration: 0.7, ease: 'inOutCubic' } });
          draw(0.25, 0.5, 560, { ink: on, at: 0.35 });
          line(b.text, 0.56, b.sub ? cy - 0.05 : cy, Math.round(size * 0.86), { anchor: 'left', align: 'left', maxWidth: 0.38, at: 0.5 });
          if (b.sub) small(b.sub, 0.56, cy + 0.12, subSize, { anchor: 'left', align: 'left', maxWidth: 0.36, at: 0.9 });
        } else {
          const P = tallPic(500, 0.28);
          const s = stack(P, linesH(b.text, size) + (b.sub ? 90 : 0), 110);
          const panelH = Math.round((s.pic * H + P / 2 + 55));
          layers.push({ type: 'shape', shape: 'rect', x: 0.5, y: panelH / 2 / H, w: frame.width, h: panelH, fill: panel, z: -1, in: { preset: 'grow', duration: 0.7, ease: 'inOutCubic' } });
          draw(X, s.pic, P, { ink: on, at: 0.35 });
          line(b.text, X, s.words + linesH(b.text, size) / 2 / H, size, { at: 0.5 });
          if (b.sub) small(b.sub, X, s.bottom - 30 / H, subSize, { at: 0.9 });
        }
        camera = { zoom: [1, 1.02] };
      } else if (turn === 1) {
        // The picture standing above the line.
        const P = wide ? 330 : tallPic(420, 0.24);
        const textH = linesH(b.text, Math.round(size * 0.86), wide ? 6 : 4);
        const s = stack(P, textH + (b.sub ? 80 : 0));
        draw(X, s.pic, P);
        line(b.text, X, s.words + textH / 2 / H, Math.round(size * 0.86), { at: 0.6 });
        if (b.sub) small(b.sub, X, s.bottom - 28 / H, subSize, { at: 0.95 });
      } else {
        // The picture fills the frame faintly behind the line and draws
        // itself on slowly while the line holds.
        draw(X, cy, Math.round(Math.min(frame.width, H) * 0.86), { opacity: 0.22, z: -1, duration: 2.4, ink: muted });
        line(b.text, X, b.sub ? cy - 0.04 : cy, size, { weight: heavy, at: 0.2, in: { preset: wordCount(b.text) <= 4 ? E.title : E.line, duration: 0.8, ease } });
        if (b.sub) small(b.sub, X, cy + (vertical ? 0.1 : 0.12), vertical ? 44 : 40, { at: 0.55 });
        entrance = 1.2;
        camera = { zoom: [1.04, 1] };
      }
      break;
    }
    case 'title': {
      // The picture as the name's mark, drawn first, the name under it.
      const nameSize = Math.round(lineSize(wordCount(b.text), 150, vertical) * 0.86);
      const P = wide ? 300 : tallPic(380, 0.22);
      const nameH = nameSize * 1.15;
      const s = stack(P, nameH + (b.sub ? 90 : 0));
      draw(X, s.pic, P, { duration: 1.2 });
      line(b.text, X, s.words + nameH / 2 / H, nameSize, { weight: heavy, at: 0.7, in: { preset: E.title, duration: 0.8, ease }, hold: pack.roll ? hold : 'shimmer' });
      if (b.sub) small(b.sub, X, s.bottom - 30 / H, vertical ? 46 : 42, { at: 1.1 });
      entrance = 1.8;
      break;
    }
    case 'stat': {
      // What the figure is about beside it, the figure counting up.
      const figure = `${b.prefix || ''}${b.value}${b.suffix || ''}`.length;
      const fit = Math.max(0.55, Math.min(1, 5 / Math.max(1, figure)));
      const counter = { type: 'counter', from: 0, to: b.value, prefix: b.prefix, suffix: b.suffix, decimals: b.decimals, weight: heavy, color: accent, count: 1.4, roll: Boolean(pack.roll), at: 0.4, in: { preset: pack.roll ? 'soft' : 'rise', duration: 0.6, ease } };
      if (wide) {
        draw(0.3, cy, 500);
        layers.push({ ...counter, x: 0.55, y: cy - 0.06, anchor: 'left', align: 'left', size: Math.round(220 * fit) });
        if (b.sub) small(b.sub, 0.55, cy + 0.12, lineSize(wordCount(b.sub), 52, false), { anchor: 'left', align: 'left', maxWidth: 0.38, color: ink, at: 0.8 });
      } else {
        const P = tallPic(440, 0.24);
        const figureSize = Math.round(190 * fit);
        const subSize = lineSize(wordCount(b.sub), 50, true);
        const s = stack(P, figureSize + (b.sub ? 50 + linesH(b.sub, subSize) : 0));
        draw(X, s.pic, P);
        layers.push({ ...counter, x: X, y: s.words + figureSize / 2 / H, size: figureSize });
        if (b.sub) small(b.sub, X, s.bottom - linesH(b.sub, subSize) / 2 / H, subSize, { at: 0.8 });
      }
      entrance = 1.8;
      camera = { zoom: [1.03, 1] };
      break;
    }
    case 'list': {
      // The list on one side, what it is about on the other; on a square or
      // tall frame, the picture over the list.
      const n = b.items.length;
      const dot = (x, y, at) => layers.push({ type: 'shape', shape: 'circle', x, y, w: 14, fill: accent, at, in: { preset: 'scale', duration: 0.5, ease } });
      const item = (text, x, y, size, maxWidth, at) => layers.push({ type: 'text', text, x, y, anchor: 'left', align: 'left', size, weight: 600, color: ink, maxWidth, at, in: { preset: E.list, duration: 0.7, ease } });
      if (wide) {
        draw(0.76, 0.5, 520, { at: 0.1 });
        const step = 0.12;
        const top = b.text ? 0.36 : 0.5 - ((n - 1) * step) / 2;
        if (b.text) line(b.text, 0.08, 0.2, 56, { anchor: 'left', align: 'left', maxWidth: 0.5, hold: 'none', highlight: [], in: { preset: E.line, duration: 0.7, ease } });
        b.items.forEach((it, k) => { const at = 0.35 + k * 0.28; dot(0.086, top + k * step, at); item(it, 0.11, top + k * step, lineSize(wordCount(it), 58, false), 0.44, at + 0.06); });
      } else {
        const P = tallPic(320, 0.2);
        const stepPx = Math.min(130, H * 0.075);
        const headPx = b.text ? 100 : 0;
        const s = stack(P, headPx + n * stepPx);
        draw(X, s.pic, P, { at: 0.1 });
        if (b.text) line(b.text, X, s.words + 40 / H, 56, { hold: 'none', highlight: [], in: { preset: E.line, duration: 0.7, ease } });
        b.items.forEach((it, k) => {
          const y = s.words + (headPx + (k + 0.5) * stepPx) / H, at = 0.35 + k * 0.28;
          dot(left + 0.006, y, at);
          item(it, left + 0.06, y, lineSize(wordCount(it), 54, true), 0.66, at + 0.06);
        });
      }
      entrance = 0.35 + n * 0.28 + 0.7;
      camera = { zoom: [1, 1.02] };
      break;
    }
    case 'end': {
      const P = wide ? 240 : tallPic(300, 0.18);
      const endSize = Math.round(lineSize(wordCount(b.text), 128, vertical) * 0.9);
      const s = stack(P, endSize * 1.15 + (b.sub ? 90 : 0));
      draw(X, s.pic, P, { duration: 1.1 });
      line(b.text, X, s.words + (endSize * 1.15) / 2 / H, endSize, { weight: heavy, at: 0.6, hold: 'none', in: { preset: E.title, duration: 0.8, ease } });
      if (b.sub) small(b.sub, X, s.bottom - 30 / H, 44, { weight: 600, color: accentSmall, at: 1 });
      camera = { zoom: [1.03, 1] };
      break;
    }
    default: return null;
  }
  return { layers, entrance, camera };
}
