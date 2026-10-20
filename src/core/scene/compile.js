// compileStoryboard: a storyboard of words and numbers becomes a finished scene,
// laid out and timed by rules instead of by a model.
//
// This is what lets a three-billion-parameter local model make a film that
// looks designed. The model decides what to say; this file decides where it
// sits, how big it is, how long it holds and how it moves, from the style
// pack and the rules in docs/MOTION-RULES.md:
//   - every beat holds for its words' reading time, rounded up to the music;
//   - scenes start on the beat, so cuts land with the score;
//   - one entrance family for titles, one for lines, one for lists, per style;
//   - two or three transition families, cycled, never five;
//   - a slow camera push on text scenes so nothing is ever fully still;
//   - vertical frames keep words inside the area phone apps leave clear.

import { STYLE_PACKS, readingTime, wordCount, estimateSpeech } from './format.js';
import { normalizeScene } from './normalize.js';
import { normalizeStoryboard } from './storyboard.js';
import { beatLength } from '../engine/math.js';
import { entranceSpan } from '../engine/motion.js';
import { contrast } from '../util/color.js';
import { PREROLL } from './lint.js';

// Each style says how it marks an accent word while it holds.
const ACCENT_HOLD = { studio: 'underline', paper: 'marker', mono: 'none', vivid: 'none', editorial: 'none', tech: 'underline', stage: 'none' };

// Text size for a line of n words, so long lines shrink before they wrap badly.
function lineSize(words, big, vertical) {
  const base = words <= 3 ? big : words <= 6 ? big * 0.78 : words <= 10 ? big * 0.62 : big * 0.5;
  return Math.max(vertical ? 36 : 28, Math.round(vertical ? base * 0.92 : base));
}

// Transitions in which both scenes share the frame for a moment.
const HANDOFF = new Set(['fade', 'zoom', 'carry']);

// How much each kind of beat is worth keeping when a storyboard runs long.
// Ties go to the earlier beat: a later one of the same kind is dropped first.
const KEEP = { hook: 9, end: 9, title: 8, logo: 8, stat: 6, statement: 5, list: 5, steps: 4, words: 4, chart: 4, compare: 3, quote: 2 };

// The vivid style changes the field colour scene by scene.
function vividBackground(i, palette) {
  const cycle = ['bg', 'accent2', 'surface'];
  return cycle[i % cycle.length];
}

export function compileStoryboard(input, opts = {}) {
  const { storyboard, notes } = input && input.beats && input.beats.every((b) => b && b.kind) ? { storyboard: input, notes: [] } : normalizeStoryboard(input);
  const style = opts.style || storyboard.style || 'studio';
  const pack = STYLE_PACKS[style] || STYLE_PACKS.studio;
  const aspect = opts.aspect || '16:9';
  const vertical = aspect === '9:16' || aspect === '4:5';
  const bpm = opts.bpm || (style === 'editorial' ? 96 : style === 'paper' ? 108 : 120);
  const beat = beatLength(bpm);
  const palette = { ...pack.palette, ...(opts.palette || {}) };
  const accentHold = ACCENT_HOLD[style] || 'none';
  const ease = pack.ease;
  const T = pack.transitions;

  // Vertical: the middle of the area phone video apps leave clear.
  // The clear area's centre is left of the frame's, because the right edge
  // carries the like and share buttons.
  const cy = vertical ? 0.44 : 0.5;
  const X = vertical ? 0.463 : 0.5;
  const MW = vertical ? 0.76 : 0.8;
  const left = vertical ? 0.1 : 0.12;

  const scenes = [];
  let trIndex = 0;
  const beats = storyboard.beats;

  beats.forEach((b, i) => {
    const layers = [];
    let entrance = 0.9;
    let camera = { zoom: [1, 1.035] };
    let sceneBg = style === 'vivid' ? vividBackground(i, palette) : null;
    const accentWords = b.accent || [];
    const textColor = (bgToken) => {
      if (!bgToken) return 'ink';
      const bg = palette[bgToken] || bgToken;
      return contrast(palette.ink, bg) >= 4.5 ? 'ink' : 'bg';
    };
    const ink = textColor(sceneBg);
    // The accent only where it reads: 3 to 1 for large type, 4.5 to 1 for small.
    const accentFor = (bgToken, need) => {
      const bg = palette[bgToken || 'bg'];
      return contrast(palette.accent, bg) >= need ? 'accent' : ink;
    };
    const accent = accentFor(sceneBg, 3);
    const accentSmall = accentFor(sceneBg, 4.5);
    const muted = contrast(palette.muted, palette[sceneBg || 'bg']) < 4.5 ? ink : 'muted';
    const hold = accentWords.length ? accentHold : 'none';

    switch (b.kind) {
      case 'hook': case 'statement': {
        const big = b.kind === 'hook' ? 132 : 112;
        const size = lineSize(wordCount(b.text), big, vertical);
        layers.push({
          type: 'text', text: b.text, x: X, y: b.sub ? cy - 0.04 : cy, size, weight: pack.fonts.weight, color: ink,
          maxWidth: MW, highlight: accentWords, highlightColor: accent, hold,
          in: { preset: wordCount(b.text) <= 4 ? pack.enter.title : pack.enter.line, duration: 0.8, ease },
        });
        if (b.sub) layers.push({ type: 'text', text: b.sub, x: X, y: cy + (vertical ? 0.1 : 0.12), size: vertical ? 44 : 40, weight: 500, color: muted, at: 0.45, maxWidth: MW, in: { preset: pack.enter.small, duration: 0.7, ease } });
        break;
      }
      case 'title': {
        // A field of dots filling in behind the name: one rule, many shapes.
        if (style === 'tech' || style === 'stage') {
          layers.push({ type: 'shape', shape: 'circle', x: X, y: cy, w: 6, fill: muted, opacity: 0.35, z: -1, in: { preset: 'scale', duration: 0.4, ease },
            repeat: { count: vertical ? 54 : 105, layout: 'grid', cols: vertical ? 6 : 15, gap: 90, stagger: 0.012 } });
        }
        layers.push({ type: 'text', text: b.text, x: X, y: cy - 0.05, size: lineSize(wordCount(b.text), 150, vertical), weight: Math.min(900, pack.fonts.weight + 100), color: ink, highlight: accentWords, highlightColor: accent, in: { preset: pack.enter.title, duration: 0.8, ease }, hold: style === 'studio' || style === 'tech' ? 'shimmer' : hold });
        layers.push({ type: 'shape', shape: 'line', x: X, y: cy + 0.055, w: vertical ? 140 : 120, h: 0, strokeWidth: 6, color: accent, at: 0.35, in: { preset: 'draw', duration: 0.6, ease: 'inOutCubic' } });
        if (b.sub) layers.push({ type: 'text', text: b.sub, x: X, y: cy + 0.13, size: vertical ? 46 : 44, weight: 500, color: muted, at: 0.6, maxWidth: MW, in: { preset: pack.enter.small, duration: 0.7, ease } });
        entrance = 1.2;
        break;
      }
      case 'stat': {
        layers.push({ type: 'counter', from: 0, to: b.value, prefix: b.prefix, suffix: b.suffix, decimals: b.decimals, x: X, y: cy - 0.06, size: vertical ? 190 : 210, weight: Math.min(900, pack.fonts.weight + 100), color: accent, count: 1.4, roll: Boolean(pack.roll), in: { preset: pack.roll ? 'soft' : 'rise', duration: 0.6, ease } });
        if (b.sub) layers.push({ type: 'text', text: b.sub, x: X, y: cy + 0.12, size: lineSize(wordCount(b.sub), 56, vertical), weight: 500, color: muted, at: 0.5, maxWidth: MW, in: { preset: pack.enter.small, duration: 0.7, ease } });
        entrance = 1.6;
        camera = { zoom: [1.03, 1] };
        break;
      }
      case 'list': {
        const n = b.items.length;
        const top = b.text ? (vertical ? 0.3 : 0.34) : cy - ((n - 1) * (vertical ? 0.075 : 0.12)) / 2;
        if (b.text) layers.push({ type: 'text', text: b.text, x: left, y: vertical ? 0.2 : 0.2, anchor: 'left', align: 'left', size: vertical ? 64 : 60, weight: pack.fonts.weight, color: ink, in: { preset: pack.enter.line, duration: 0.7, ease } });
        const step = vertical ? 0.075 : 0.12;
        b.items.forEach((it, k) => {
          const at = (b.text ? 0.35 : 0) + k * 0.28;
          const y = top + k * step;
          layers.push({ type: 'shape', shape: 'circle', x: left + 0.006, y, w: 16, fill: accent, at, in: { preset: 'scale', duration: 0.5, ease } });
          layers.push({ type: 'text', text: it, x: left + (vertical ? 0.05 : 0.03), y, anchor: 'left', align: 'left', size: lineSize(wordCount(it), vertical ? 60 : 64, vertical), weight: 600, color: ink, maxWidth: vertical ? 0.7 : 0.7, at: at + 0.06, in: { preset: pack.enter.list, duration: 0.7, ease } });
        });
        entrance = (b.text ? 0.35 : 0) + n * 0.28 + 0.7;
        break;
      }
      case 'steps': {
        const n = b.items.length;
        if (b.text) layers.push({ type: 'text', text: b.text, x: X, y: vertical ? 0.2 : 0.22, size: vertical ? 64 : 60, weight: pack.fonts.weight, color: ink, in: { preset: pack.enter.line, duration: 0.7, ease } });
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
        if (b.text) layers.push({ type: 'text', text: b.text, x: left, y: vertical ? 0.2 : 0.16, anchor: 'left', align: 'left', size: vertical ? 60 : 56, weight: pack.fonts.weight, color: ink, maxWidth: MW, in: { preset: pack.enter.line, duration: 0.7, ease } });
        const w = vertical ? 900 : 1400, h = vertical ? 760 : 560;
        if (b.chart === 'line') {
          layers.push({ type: 'line-chart', values: b.values, x: X, y: vertical ? 0.47 : 0.56, w, h, color: accent, area: true, at: 0.3, in: { preset: 'draw', duration: 1.8, ease: 'inOutCubic' } });
        } else {
          layers.push({ type: 'bars', values: b.values, labels: b.labels, suffix: b.suffix, x: X, y: vertical ? 0.47 : 0.56, w, h, color: accent, labelSize: vertical ? 34 : 28, at: 0.3, in: { preset: 'grow', duration: 1.6, ease } });
        }
        entrance = 2.2;
        camera = { zoom: [1, 1] };
        break;
      }
      case 'quote': {
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
          layers.push({ type: 'text', text: side.text, x, y: y + 0.02, size: lineSize(wordCount(side.text), 72, vertical), weight: pack.fonts.weight, color: k ? ink : muted, maxWidth: vertical ? 0.76 : 0.38, at: at + 0.15, in: { preset: pack.enter.line, duration: 0.7, ease } });
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
          layers.push({ type: 'text', text: b.text, x: X, y: cy + 0.16, size: 96, weight: pack.fonts.weight, color: ink, at: 0.5, in: { preset: pack.enter.title, duration: 0.8, ease } });
        } else {
          layers.push({ type: 'text', text: b.text, x: X, y: b.sub ? cy - 0.03 : cy, size: lineSize(wordCount(b.text), 160, vertical), weight: Math.min(900, pack.fonts.weight + 100), color: ink, in: { preset: pack.enter.title, duration: 0.9, ease }, hold: 'shimmer' });
        }
        if (b.sub) layers.push({ type: 'text', text: b.sub, x: X, y: cy + (b.asset ? 0.26 : 0.1), size: 44, weight: 500, color: muted, at: 0.7, maxWidth: MW, in: { preset: pack.enter.small, duration: 0.7, ease } });
        entrance = 1.4;
        camera = { zoom: [1.04, 1] };
        break;
      }
      case 'end': {
        layers.push({ type: 'text', text: b.text, x: X, y: cy - 0.05, size: lineSize(wordCount(b.text), 128, vertical), weight: Math.min(900, pack.fonts.weight + 100), color: ink, highlight: accentWords, highlightColor: accent, in: { preset: pack.enter.title, duration: 0.8, ease } });
        if (b.sub) layers.push({ type: 'text', text: b.sub, x: X, y: cy + 0.07, size: 44, weight: 600, color: accentSmall, at: 0.5, maxWidth: MW, in: { preset: pack.enter.small, duration: 0.7, ease } });
        entrance = 1.2;
        camera = { zoom: [1.03, 1] };
        break;
      }
      default: break;
    }

    // How long the beat holds. Every line must stay readable for its reading
    // time after its own entrance ends; the scene then rounds up to whole beats
    // of the music. End cards hold longer: viewers need the address.
    const probe = normalizeScene({ style, aspect, scenes: [{ duration: 60, layers }] }).scene.scenes[0]?.layers || [];
    let need = 0;
    for (const L of probe) {
      const end = entranceSpan(L).end;
      const words = L.type === 'text' ? wordCount(L.text) : 1;
      const until = L.until < 60 ? L.until : Infinity;
      if (until === Infinity) need = Math.max(need, end + (L.type === 'text' ? readingTime(words) : 0.8));
    }
    const minHold = b.kind === 'end' ? 2.6 : b.kind === 'hook' ? 1.2 : 1.4;
    const settled = Math.max(0, ...probe.map((L) => entranceSpan(L).end));
    need = Math.max(need, settled + minHold, entrance + (b.kind === 'words' ? 0.9 : 0));
    // Narration, when there is a line: the scene lasts until it has been said.
    if (b.say && opts.narration !== false) need = Math.max(need, 0.15 + estimateSpeech(wordCount(b.say)) + 0.35);
    const length = Math.ceil(need / beat - 1e-6) * beat;

    // The transition INTO this scene: titles and end cards zoom when the style
    // has a zoom; otherwise the pack's families take turns.
    let kind = 'cut';
    if (i > 0) {
      if ((b.kind === 'title' || b.kind === 'logo' || b.kind === 'end') && T.includes('zoom')) kind = 'zoom';
      else kind = T[trIndex++ % T.length];
    }
    const dirs = ['left', 'up', 'left', 'down'];
    scenes.push({
      id: `${b.kind}-${i + 1}`,
      name: b.kind,
      note: [b.text, b.sub].filter(Boolean).join(' / ').slice(0, 200),
      length,
      read: need,
      words: probe.filter((L) => L.type === 'text').reduce((n, L) => n + wordCount(L.text), 0),
      settled,
      transition: { kind, duration: kind === 'cut' ? 0 : kind === 'dip' ? Math.min(0.6, beat * 1.5) : Math.min(0.5, beat), direction: dirs[i % dirs.length], ease: 'inOutCubic' },
      background: sceneBg,
      camera,
      layers,
    });
  });

  // The same words in two scenes in a row are one element carried across:
  // the line moves and resizes into its new place instead of leaving and
  // arriving again.
  const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  scenes.forEach((S, i) => {
    if (i === 0 || S.transition.kind === 'cut') return;
    const prev = scenes[i - 1];
    for (const a of prev.layers) {
      if (a.type !== 'text' || !norm(a.text)) continue;
      const b = S.layers.find((L) => L.type === 'text' && norm(L.text) === norm(a.text));
      if (!b) continue;
      a.id = a.id || `carry-${i}-from`;
      b.id = b.id || `carry-${i}-to`;
      S.transition = { ...S.transition, kind: 'carry', duration: Math.max(S.transition.duration, Math.min(0.8, beat * 1.5)), carry: { from: a.id, to: b.id } };
      break;
    }
  });

  // A handoff, not a pile-up: after a fade or a zoom, where both scenes share
  // the frame, the new scene's words arrive as the old ones leave instead of
  // crossing them.
  scenes.forEach((S, i) => {
    if (i === 0 || !HANDOFF.has(S.transition.kind)) return;
    const by = +(S.transition.duration * 0.85).toFixed(3);
    for (const L of S.layers) {
      L.at = +((L.at || 0) + by).toFixed(3);
      if (L.in && typeof L.in === 'object' && Number.isFinite(L.in.at)) L.in.at = +(L.in.at + by).toFixed(3);
    }
    S.length += by;
    S.settled += by;
  });

  // A storyboard far longer than the length asked for loses its least
  // important beats rather than running long: one idea a shot, and only the
  // ideas that fit. The opening, the first name and the end are always kept.
  if (opts.targetDuration) {
    const total = () => scenes.reduce((n, S) => n + S.length, 0);
    const dropped = [];
    const named = scenes.find((S) => S.name === 'title' || S.name === 'logo');
    while (total() > opts.targetDuration * 1.2 && scenes.length > 3) {
      let worst = -1;
      scenes.forEach((S, i) => {
        if (i === 0 || i === scenes.length - 1 || S === named) return;
        if (worst < 0 || (KEEP[S.name] ?? 5) <= (KEEP[scenes[worst].name] ?? 5)) worst = i;
      });
      if (worst < 0) break;
      dropped.push(scenes[worst].name);
      scenes.splice(worst, 1);
    }
    if (dropped.length) notes.push(`To fit the length asked for, ${dropped.length === 1 ? 'one beat was' : `${dropped.length} beats were`} left out: ${dropped.join(', ')}.`);
  }

  // Frame one is a picture already forming, never an empty frame: what opens
  // the film begins its entrance a moment before the film does.
  for (const L of scenes[0]?.layers || []) {
    if ((L.at || 0) > 0) continue;
    const m = typeof L.in === 'string' ? { preset: L.in } : { ...(L.in || {}) };
    if (m.preset === 'none') continue;
    m.at = -PREROLL;
    L.in = m;
  }

  // A requested length stretches the holds, never shortens them below reading
  // time, and never holds a scene still for longer than its words deserve.
  const natural = scenes.reduce((n, S) => n + S.length, 0);
  if (opts.targetDuration && natural < opts.targetDuration - beat) {
    let spare = Math.floor((opts.targetDuration - natural) / beat);
    let grew = true;
    while (spare > 0 && grew) {
      grew = false;
      for (const S of scenes) {
        if (spare <= 0) break;
        const stillFor = S.length + beat - S.settled;
        const allowed = Math.max(vertical ? 3 : 4, readingTime(S.words) + 0.5) - 0.1;
        if (S.name === 'words' || stillFor > allowed) continue;
        S.length += beat; spare--; grew = true;
      }
    }
    if (spare > 1) notes.push('The storyboard is too short for the length asked for without long still holds. More beats would fill it.');
  } else if (opts.targetDuration && natural > opts.targetDuration * 1.25) {
    notes.push('The words need more time than the length asked for, so the film runs longer. Fewer words per beat would shorten it.');
  }

  // Scene duration = its own length plus the next scene's transition, so each
  // scene STARTS on the beat grid.
  const sceneDocs = scenes.map((S, i) => {
    const next = scenes[i + 1];
    const extra = next ? next.transition.duration : 0;
    const { length, read, words, settled, ...rest } = S;
    return { ...rest, duration: +(length + extra).toFixed(4) };
  });

  // The score lands a boom on the reveal: the first title or logo.
  const hits = [];
  let t = 0;
  scenes.forEach((S) => {
    if (S.name === 'title' || S.name === 'logo') { if (!hits.some((h) => h.kind === 'boom')) hits.push({ t: +t.toFixed(3), kind: 'boom' }); }
    t += S.length;
  });

  const doc = {
    title: storyboard.title,
    aspect,
    fps: opts.fps || 60,
    bpm,
    style,
    palette,
    fonts: pack.fonts,
    background: { ...pack.background },
    scenes: sceneDocs,
    sound: { score: opts.score || pack.score, hits },
    voice: {
      ...(opts.voice || {}),
      lines: opts.narration === false ? [] : beats.map((b, i) => (b.say ? { scene: `${b.kind}-${i + 1}`, text: b.say, at: 0.15 } : null)).filter(Boolean),
    },
    assets: opts.assets || {},
  };
  const { scene, notes: n2 } = normalizeScene(doc);
  return { scene, notes: [...notes, ...n2] };
}

