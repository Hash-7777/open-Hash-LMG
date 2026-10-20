// normalizeScene: turns whatever a model (or an old project file) wrote into a
// scene the renderer can draw without a single further check.
//
// It is the gate between a model's answer and the picture, so it is forgiving
// in what it reads and strict in what it writes:
//   - numbers are coerced, clamped and given defaults;
//   - names are matched through PRESET_ALIASES ("typewriter" becomes "type");
//   - positions written in pixels or percentages become frame fractions;
//   - scene start times are computed from durations and transition overlaps,
//     never trusted from the input, so a model never has to do the arithmetic;
//   - every repair is noted, so the director can show what it changed.
//
// It rebuilds every object from a known list of fields, which is what keeps
// junk out, and also what drops a field nobody listed. A new field goes into
// the lists below and into the field guard in scripts/checks/scene-normalize.mjs
// in the same commit. Running it twice gives the same scene twice.

import {
  FORMAT, ASPECTS, FPS_CHOICES, PALETTE_TOKENS, FONT_NAMES, LAYER_TYPES, SHAPES, ANCHORS, ALIGNS,
  IN_PRESETS, OUT_PRESETS, HOLD_PRESETS, TRANSITIONS, DIRECTIONS, BACKGROUNDS, SCORES, HIT_KINDS,
  PRESET_ALIASES, STYLE_PACKS, LIMITS, VOICE_ENGINES,
} from './format.js';
import { EASE_NAMES } from '../engine/ease.js';
import { isColor } from '../util/color.js';

const KEYABLE = ['x', 'y', 'scale', 'rotate', 'opacity', 'color', 'size', 'w', 'h', 'progress', 'fill', 'stroke'];

function makeNotes() {
  const list = [];
  const seen = new Set();
  return {
    list,
    add(msg) { if (!seen.has(msg) && list.length < 200) { seen.add(msg); list.push(msg); } },
  };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function num(v, def, lo = -Infinity, hi = Infinity) {
  if (typeof v === 'string') {
    const s = v.trim();
    if (s.endsWith('%')) v = parseFloat(s) / 100;
    else if (/^-?[\d.]+(px|s|ms)?$/.test(s)) v = s.endsWith('ms') ? parseFloat(s) / 1000 : parseFloat(s);
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) return def;
  return Math.min(hi, Math.max(lo, v));
}

function str(v, def = '', max = 400) {
  if (v === null || v === undefined) return def;
  if (typeof v === 'number') v = String(v);
  if (typeof v !== 'string') return def;
  return v.replace(/\s+/g, ' ').trim().slice(0, max);
}

const slug = (s) => String(s || '').toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '');

// Plain pixel amounts (stroke widths, radii, padding): never rescaled.
function px(v, def, lo, hi) {
  return num(v, def, lo, hi);
}

// Text keeps the line breaks it was given (up to four lines), and nothing else
// of its spacing.
function textOf(v, max) {
  if (typeof v === 'number') v = String(v);
  if (typeof v !== 'string') return '';
  return v.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 4).join('\n').slice(0, max);
}

function oneOf(v, list, def, notes, what) {
  if (v === undefined || v === null || v === '') return def;
  const s = slug(v);
  if (list.includes(s)) return s;
  const alias = PRESET_ALIASES[s] || PRESET_ALIASES[s.replace(/-/g, '')];
  if (alias && list.includes(alias)) return alias;
  if (notes && what) notes.add(`Unknown ${what} "${String(v).slice(0, 40)}" was replaced with "${def}".`);
  return def;
}

function easeName(v, def) {
  if (Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number' && Number.isFinite(n))) return v.map((n) => +n.toFixed(4));
  if (typeof v !== 'string') return def;
  if (EASE_NAMES.includes(v)) return v;
  // "ease-out-cubic", "easeOutCubic", "cubic-out" all become outCubic.
  const s = v.toLowerCase().replace(/[^a-z]/g, '');
  const flat = s.replace(/^ease/, '');
  const families = ['quad', 'cubic', 'quart', 'quint', 'sine', 'expo', 'circ', 'back'];
  for (const fam of families) {
    if (!flat.includes(fam)) continue;
    const dir = flat.includes('inout') ? 'inOut' : flat.startsWith('in') || flat.endsWith('in') ? 'in' : 'out';
    const name = dir + fam[0].toUpperCase() + fam.slice(1);
    if (EASE_NAMES.includes(name)) return name;
  }
  if (flat === 'linear') return 'linear';
  if (flat === 'in') return 'inCubic';
  if (flat === 'out') return 'outCubic';
  if (flat === 'inout' || flat === '') return 'inOutCubic';
  return def;
}

// A colour: a palette token or any CSS colour. Anything else becomes `def`.
function colour(v, def) {
  if (typeof v !== 'string') return def;
  const s = v.trim();
  if (PALETTE_TOKENS.includes(s)) return s;
  const lower = s.toLowerCase();
  if (lower === 'text' || lower === 'foreground' || lower === 'primary') return 'ink';
  if (lower === 'background') return 'bg';
  if (lower === 'secondary') return 'muted';
  if (lower === 'highlight') return 'accent';
  return isColor(s) ? s : def;
}

// x and y as frame fractions. A model that writes 960 on a 1920 frame, or
// "50%", means the middle; both are read that way.
function frac(v, def, extent, notes, what) {
  const n = num(v, undefined);
  if (n === undefined) return def;
  if (n > 1.5 && extent) {
    notes.add(`${what} positions written in pixels were converted to frame fractions.`);
    return Math.min(1.5, Math.max(-0.5, n / extent));
  }
  return Math.min(1.5, Math.max(-0.5, n));
}

// Sizes in u (pixels on a 1080 short side). A size under 2 was meant as a
// fraction of the frame.
function size(v, def, lo, hi) {
  let n = num(v, undefined);
  if (n === undefined) return def;
  if (n > 0 && n < 2) n *= 1080;
  return Math.min(hi, Math.max(lo, n));
}

function normMotion(m, kind, defs, notes, layerType) {
  const list = kind === 'in' ? IN_PRESETS : OUT_PRESETS;
  if (m === undefined || m === null) m = defs.preset ? { preset: defs.preset } : { preset: 'none' };
  if (typeof m === 'string') m = { preset: m };
  if (!isObj(m)) m = { preset: 'none' };
  let preset = oneOf(m.preset ?? m.type ?? m.name, list, kind === 'in' ? 'fade' : 'fade', notes, `${kind === 'in' ? 'entrance' : 'exit'}`);
  // Letter, word and type presets need text; draw needs a stroke. Elsewhere they
  // fall back to the nearest motion that does apply.
  if (layerType !== 'text' && layerType !== 'counter' && ['letters', 'words', 'type'].includes(preset)) preset = 'rise';
  if (layerType === 'text' && preset === 'draw') preset = 'wipe';
  if (layerType === 'text' && preset === 'grow') preset = 'scale';
  const dur = num(m.duration ?? m.dur, defs.duration, 0, 10);
  return {
    preset,
    // An entrance may begin before its layer's scene does, by up to two
    // seconds, so a film can open on a picture already forming.
    at: m.at === undefined || m.at === null ? null : num(m.at, null, -2, LIMITS.maxSceneDuration),
    duration: preset === 'none' ? 0 : dur,
    ease: easeName(m.ease, defs.ease),
    stagger: num(m.stagger, defs.stagger, 0, 1),
    distance: px(m.distance, defs.distance, 0, 2000),
  };
}

function normKeys(k, notes) {
  if (!isObj(k)) return {};
  const out = {};
  for (const prop of KEYABLE) {
    const list = k[prop];
    if (!Array.isArray(list)) continue;
    const rows = [];
    for (const row of list) {
      let t, v, e;
      if (Array.isArray(row)) [t, v, e] = row;
      else if (isObj(row)) ({ t, v = row.value, ease: e } = row);
      t = num(t, undefined, 0, LIMITS.maxSceneDuration);
      if (t === undefined) continue;
      if (prop === 'color' || prop === 'fill' || prop === 'stroke') v = colour(v, undefined);
      else v = num(v, undefined);
      if (v === undefined) continue;
      rows.push(e === undefined ? [t, v] : [t, v, easeName(e, 'inOutCubic')]);
    }
    rows.sort((a, b) => a[0] - b[0]);
    if (rows.length) out[prop] = rows.slice(0, 64);
  }
  if (Object.keys(k).some((p) => !KEYABLE.includes(p))) notes.add('Keyframes on properties that cannot be animated were left out.');
  return out;
}

function normLayer(L, ctx, depth = 0) {
  const { notes, pack, W, H, sceneDur } = ctx;
  if (!isObj(L)) return null;
  let type = oneOf(L.type ?? L.kind, LAYER_TYPES, null);
  if (!type) {
    if (typeof L.text === 'string') type = 'text';
    else if (L.shape || L.d) type = 'shape';
    else if (Array.isArray(L.values)) type = 'bars';
    else if (Array.isArray(L.layers)) type = 'group';
    else { notes.add('A layer with no recognisable type was left out.'); return null; }
  }
  const id = slug(L.id) || `${type}-${++ctx.counter}`;
  const at = num(L.at ?? L.start, 0, 0, sceneDur);
  let until = num(L.until ?? L.end, sceneDur, 0, sceneDur);
  if (until <= at) until = sceneDur;
  const isTitle = type === 'text' && size(L.size, 64, 8, 600) >= 72;
  const enterDef = type === 'text'
    ? (isTitle ? pack.enter.title : pack.enter.line)
    : type === 'shape' ? (['line', 'path', 'ring', 'arrow'].includes(L.shape) ? 'draw' : 'scale')
    : type === 'bars' || type === 'line-chart' ? 'grow'
    : type === 'counter' ? 'rise' : 'fade';
  const motionDefs = {
    preset: enterDef, duration: type === 'text' && ['letters', 'words', 'type'].includes(enterDef) ? 0.9 : 0.7,
    ease: pack.ease, stagger: enterDef === 'type' ? 0.035 : enterDef === 'words' ? 0.08 : 0.025, distance: 40,
  };

  const base = {
    id,
    type,
    name: str(L.name, '', 60),
    x: frac(L.x, 0.5, W, notes, 'Layer'),
    y: frac(L.y, 0.5, H, notes, 'Layer'),
    anchor: oneOf(L.anchor, ANCHORS, 'center'),
    rotate: num(L.rotate ?? L.rotation, 0, -3600, 3600),
    scale: num(L.scale, 1, 0, 20),
    opacity: num(L.opacity, 1, 0, 1),
    color: colour(L.color, type === 'text' || type === 'counter' ? 'ink' : 'accent'),
    at,
    until,
    in: normMotion(L.in ?? L.enter ?? L.animation, 'in', motionDefs, notes, type),
    out: normMotion(L.out ?? L.exit, 'out', { preset: L.out === undefined && L.exit === undefined ? 'none' : pack.exit, duration: 0.45, ease: 'inCubic', stagger: 0.02, distance: 30 }, notes, type),
    hold: oneOf(L.hold ?? L.emphasis, HOLD_PRESETS, 'none'),
    keys: normKeys(L.keys ?? L.keyframes, notes),
    z: num(L.z, 0, -100, 100),
  };

  if (type === 'text') {
    let text = textOf(L.text ?? L.content ?? L.value, LIMITS.maxTextChars);
    if (String(L.text ?? '').length > LIMITS.maxTextChars) notes.add('A text longer than the limit was shortened.');
    if (!text) { notes.add('An empty text layer was left out.'); return null; }
    Object.assign(base, {
      text,
      size: size(L.size ?? L.fontSize, 64, 8, 600),
      weight: Math.round(num(L.weight ?? L.fontWeight, ctx.fonts.weight, 100, 900) / 100) * 100,
      font: oneOf(L.font ?? L.family, FONT_NAMES, size(L.size, 64, 8, 600) >= 72 ? ctx.fonts.display : ctx.fonts.text),
      align: oneOf(L.align ?? L.textAlign, ALIGNS, base.anchor.includes('left') ? 'left' : base.anchor.includes('right') ? 'right' : 'center'),
      tracking: num(L.tracking ?? L.letterSpacing, pack.tracking, -0.2, 1),
      leading: num(L.leading ?? L.lineHeight, 1.08, 0.7, 3),
      maxWidth: num(L.maxWidth, 0.84, 0.05, 1.5),
      upper: Boolean(L.upper ?? L.uppercase),
      highlight: Array.isArray(L.highlight) ? L.highlight.map((w) => str(w, '', 60)).filter(Boolean).slice(0, 12)
        : typeof L.highlight === 'string' && L.highlight ? [str(L.highlight, '', 60)] : [],
      highlightColor: colour(L.highlightColor, 'accent'),
      plate: isObj(L.plate) ? {
        color: colour(L.plate.color, 'surface'),
        padX: px(L.plate.padX, 28, 0, 400),
        padY: px(L.plate.padY, 16, 0, 400),
        radius: px(L.plate.radius, 14, 0, 400),
      } : null,
    });
  } else if (type === 'shape') {
    const shape = oneOf(L.shape, SHAPES, L.d ? 'path' : 'rect', notes, 'shape');
    Object.assign(base, {
      shape,
      w: size(L.w ?? L.width, shape === 'line' ? 400 : 200, 0, 8000),
      h: size(L.h ?? L.height, shape === 'line' ? 0 : 200, 0, 8000),
      radius: px(L.radius ?? L.r, 0, 0, 4000),
      fill: L.fill === null || L.fill === 'none' ? null : colour(L.fill, ['line', 'path', 'ring', 'arrow'].includes(shape) ? null : base.color),
      stroke: L.stroke === null || L.stroke === 'none' ? null : colour(L.stroke, ['line', 'path', 'ring', 'arrow'].includes(shape) ? base.color : null),
      strokeWidth: px(L.strokeWidth ?? L.lineWidth, 6, 0, 400),
      d: typeof L.d === 'string' ? L.d.slice(0, 20000) : '',
      points: Array.isArray(L.points) ? L.points.filter((p) => Array.isArray(p) && p.length >= 2).slice(0, 400).map((p) => [num(p[0], 0), num(p[1], 0)]) : [],
      sides: Math.round(num(L.sides, 6, 3, 24)),
      arc: Array.isArray(L.arc) ? [num(L.arc[0], 0, 0, 1), num(L.arc[1], 1, 0, 1)] : [0, 1],
      cap: oneOf(L.cap, ['round', 'butt', 'square'], 'round'),
    });
    if (shape === 'path' && !base.d) { notes.add('A path shape with no path data was left out.'); return null; }
  } else if (type === 'image') {
    const asset = str(L.asset ?? L.src, '', 80);
    if (!asset || !ctx.assets[asset] || ctx.assets[asset].kind !== 'image') { notes.add(`An image layer pointing at a missing picture${asset ? ` ("${asset}")` : ''} was left out.`); return null; }
    Object.assign(base, {
      asset,
      w: size(L.w ?? L.width, 400, 1, 8000),
      h: size(L.h ?? L.height, 400, 1, 8000),
      fit: oneOf(L.fit, ['contain', 'cover'], 'contain'),
      radius: px(L.radius, 0, 0, 2000),
    });
  } else if (type === 'counter') {
    Object.assign(base, {
      from: num(L.from, 0),
      to: num(L.to ?? L.value, 100),
      decimals: Math.round(num(L.decimals, 0, 0, 6)),
      prefix: str(L.prefix, '', 12),
      suffix: str(L.suffix, '', 24),
      separator: L.separator === undefined ? true : Boolean(L.separator),
      size: size(L.size, 160, 8, 800),
      weight: Math.round(num(L.weight, ctx.fonts.weight, 100, 900) / 100) * 100,
      font: oneOf(L.font, FONT_NAMES, ctx.fonts.display),
      align: oneOf(L.align, ALIGNS, 'center'),
      tracking: num(L.tracking, pack.tracking, -0.2, 1),
      count: num(L.count ?? L.countDuration, 1.4, 0, 30),
    });
  } else if (type === 'bars' || type === 'line-chart') {
    const values = (Array.isArray(L.values) ? L.values : []).map((v) => num(v, 0)).slice(0, 48);
    if (!values.length) { notes.add('A chart with no values was left out.'); return null; }
    Object.assign(base, {
      values,
      labels: (Array.isArray(L.labels) ? L.labels : []).map((s) => str(s, '', 24)).slice(0, values.length),
      w: size(L.w ?? L.width, 900, 40, 8000),
      h: size(L.h ?? L.height, 480, 40, 8000),
      max: L.max === undefined ? null : num(L.max, null),
      min: L.min === undefined ? null : num(L.min, null),
      gap: num(L.gap, 0.28, 0, 0.9),
      orientation: oneOf(L.orientation, ['vertical', 'horizontal'], 'vertical'),
      showValues: L.showValues === undefined ? true : Boolean(L.showValues),
      labelSize: px(L.labelSize, 26, 8, 200),
      track: L.track === null ? null : colour(L.track, null),
      strokeWidth: px(L.strokeWidth, 6, 1, 60),
      dots: L.dots === undefined ? true : Boolean(L.dots),
      area: Boolean(L.area),
      decimals: Math.round(num(L.decimals, 0, 0, 4)),
      suffix: str(L.suffix, '', 12),
    });
  } else if (type === 'group') {
    if (depth > 3) { notes.add('Groups nested deeper than four levels were flattened away.'); return null; }
    const kids = (Array.isArray(L.layers) ? L.layers : []).map((k) => normLayer(k, ctx, depth + 1)).filter(Boolean);
    if (!kids.length) return null;
    Object.assign(base, { layers: kids.slice(0, LIMITS.maxLayersPerScene) });
  }
  return base;
}

function uniqueIds(layers, used = new Set()) {
  for (const L of layers) {
    let id = L.id, n = 2;
    while (used.has(id)) id = `${L.id}-${n++}`;
    L.id = id;
    used.add(id);
    if (L.layers) uniqueIds(L.layers, used);
  }
}

function normScene(S, i, ctx) {
  const { notes } = ctx;
  if (!isObj(S)) return null;
  let duration = num(S.duration ?? S.dur, undefined, 0, 1e6);
  if (duration === undefined) {
    const st = num(S.start, undefined), en = num(S.end, undefined);
    duration = st !== undefined && en !== undefined && en > st ? en - st : 3;
  }
  if (duration < LIMITS.minSceneDuration) { notes.add('A scene shorter than the minimum was lengthened.'); duration = LIMITS.minSceneDuration; }
  if (duration > LIMITS.maxSceneDuration) { notes.add('A scene longer than the maximum was shortened.'); duration = LIMITS.maxSceneDuration; }
  const tr = typeof S.transition === 'string' ? { kind: S.transition } : isObj(S.transition) ? S.transition : {};
  let kind = i === 0 ? 'cut' : oneOf(tr.kind ?? tr.type, TRANSITIONS, ctx.pack.transitions[(i - 1) % ctx.pack.transitions.length], notes, 'transition');
  let tdur = kind === 'cut' ? 0 : num(tr.duration, kind === 'dip' ? 0.6 : 0.5, 0.05, 3);
  // A transition can never be longer than the scenes it joins.
  const prev = ctx.prevDuration ?? Infinity;
  if (tdur > Math.min(duration, prev) * 0.6) tdur = +(Math.min(duration, prev) * 0.6).toFixed(3);
  const cam = isObj(S.camera) ? S.camera : {};
  const pair = (v, def) => {
    if (Array.isArray(v)) return [num(v[0], def[0], -10, 10), num(v[1] ?? v[0], def[1], -10, 10)];
    const n = num(v, undefined, -10, 10);
    return n === undefined ? def : [n, n];
  };
  ctx.sceneDur = duration;
  ctx.prevDuration = duration;
  const layers = (Array.isArray(S.layers) ? S.layers : Array.isArray(S.elements) ? S.elements : [])
    .slice(0, LIMITS.maxLayersPerScene)
    .map((L) => normLayer(L, ctx))
    .filter(Boolean);
  const zoom = pair(cam.zoom, [1, 1]).map((z) => Math.min(4, Math.max(0.25, z)));
  return {
    id: slug(S.id) || `scene-${i + 1}`,
    name: str(S.name ?? S.title, '', 60),
    note: str(S.note ?? S.narration ?? S.says, '', 400),
    start: 0,
    duration: +duration.toFixed(4),
    transition: {
      kind,
      duration: tdur,
      direction: oneOf(tr.direction ?? tr.dir, DIRECTIONS, 'left'),
      ease: easeName(tr.ease, 'inOutCubic'),
    },
    background: S.background === undefined || S.background === null ? null : colour(S.background, null),
    camera: {
      zoom,
      x: pair(cam.x, [0, 0]).map((v) => Math.min(0.5, Math.max(-0.5, v))),
      y: pair(cam.y, [0, 0]).map((v) => Math.min(0.5, Math.max(-0.5, v))),
      ease: easeName(cam.ease, 'inOutSine'),
    },
    layers,
  };
}

export function normalizeScene(input, opts = {}) {
  const notes = makeNotes();
  let doc = input;
  if (typeof doc === 'string') {
    try { doc = JSON.parse(doc); } catch { doc = {}; notes.add('The scene was not readable JSON; an empty scene was made.'); }
  }
  if (!isObj(doc)) doc = {};
  // Some models wrap the document: {"scene": {...}} or {"film": {...}}.
  if (!Array.isArray(doc.scenes) && isObj(doc.scene) && Array.isArray(doc.scene.scenes)) doc = doc.scene;
  if (!Array.isArray(doc.scenes) && isObj(doc.film)) doc = doc.film;
  // A bare list of scenes is a document too.
  if (Array.isArray(input)) doc = { scenes: input };

  const style = oneOf(doc.style ?? opts.style, Object.keys(STYLE_PACKS), 'studio');
  const pack = STYLE_PACKS[style];
  let aspect = typeof doc.aspect === 'string' && ASPECTS[doc.aspect] ? doc.aspect : opts.aspect && ASPECTS[opts.aspect] ? opts.aspect : null;
  let width = Math.round(num(doc.width, aspect ? ASPECTS[aspect].width : 1920, 64, 7680));
  let height = Math.round(num(doc.height, aspect ? ASPECTS[aspect].height : 1080, 64, 4320));
  if (aspect) { width = ASPECTS[aspect].width; height = ASPECTS[aspect].height; }
  // Encoders need even dimensions.
  width -= width % 2; height -= height % 2;
  if (!aspect) aspect = Object.keys(ASPECTS).find((k) => ASPECTS[k].width === width && ASPECTS[k].height === height) || 'custom';
  let fps = Math.round(num(doc.fps, 60, 12, 120));
  if (!FPS_CHOICES.includes(fps)) fps = FPS_CHOICES.reduce((a, b) => (Math.abs(b - fps) < Math.abs(a - fps) ? b : a));

  const palIn = isObj(doc.palette) ? doc.palette : {};
  const palette = {};
  for (const k of PALETTE_TOKENS) {
    const v = palIn[k];
    palette[k] = typeof v === 'string' && isColor(v) ? v.trim() : pack.palette[k];
  }
  const fontsIn = isObj(doc.fonts) ? doc.fonts : {};
  const fonts = {
    display: oneOf(fontsIn.display, FONT_NAMES, pack.fonts.display),
    text: oneOf(fontsIn.text, FONT_NAMES, pack.fonts.text),
    weight: Math.round(num(fontsIn.weight, pack.fonts.weight, 100, 900) / 100) * 100,
  };
  const bgIn = typeof doc.background === 'string' ? { kind: doc.background } : isObj(doc.background) ? doc.background : {};
  const background = {
    kind: oneOf(bgIn.kind ?? bgIn.type, BACKGROUNDS, pack.background.kind),
    color: colour(bgIn.color, 'bg'),
    drift: num(bgIn.drift, pack.background.drift, 0, 1),
  };

  // Pictures (image layers) and spoken clips (narration), carried inside the
  // project as data so a project file is complete on its own.
  const assets = {};
  const assetsIn = isObj(doc.assets) ? doc.assets : {};
  for (const [id, a] of Object.entries(assetsIn).slice(0, 200)) {
    const key = slug(id);
    if (!key || !isObj(a) || typeof a.data !== 'string') continue;
    if (/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/.test(a.data)) {
      assets[key] = { kind: 'image', name: str(a.name, key, 120), data: a.data, width: num(a.width, 0, 0, 20000), height: num(a.height, 0, 0, 20000) };
    } else if (/^data:audio\/(wav|x-wav|wave);base64,/.test(a.data)) {
      assets[key] = {
        kind: 'audio', name: str(a.name, key, 120), data: a.data,
        duration: num(a.duration, 0, 0, 600),
        words: (Array.isArray(a.words) ? a.words : []).filter((w) => Array.isArray(w) && w.length >= 3)
          .slice(0, 2000).map((w) => [str(w[0], '', 60), num(w[1], 0, 0, 600), num(w[2], 0, 0, 600)]),
        text: str(a.text, '', 400),
        voice: str(a.voice, '', 200),
      };
    }
  }

  const ctx = { notes, pack, fonts, assets, W: width, H: height, counter: 0, sceneDur: 3, prevDuration: undefined };
  let scenesIn = Array.isArray(doc.scenes) ? doc.scenes : [];
  if (scenesIn.length > LIMITS.maxScenes) { notes.add('Scenes beyond the limit were left out.'); scenesIn = scenesIn.slice(0, LIMITS.maxScenes); }
  const scenes = scenesIn.map((S, i) => normScene(S, i, ctx)).filter(Boolean);
  if (!scenes.length) notes.add('The scene has no scenes yet.');

  // Start times from durations: each scene begins where the previous one ends,
  // minus the overlap of its own transition.
  let t = 0;
  const used = new Set();
  const layerIds = new Set();
  scenes.forEach((S, i) => {
    if (i === 0) { S.transition.kind = 'cut'; S.transition.duration = 0; }
    S.start = +Math.max(0, t - S.transition.duration).toFixed(4);
    t = S.start + S.duration;
    let id = S.id, n = 2;
    while (used.has(id)) id = `${S.id}-${n++}`;
    S.id = id; used.add(id);
    uniqueIds(S.layers, layerIds);
  });
  const duration = +Math.min(LIMITS.maxDuration, Math.max(LIMITS.minDuration, t || 3)).toFixed(4);

  const soundIn = isObj(doc.sound) ? doc.sound : {};
  const sound = {
    score: oneOf(soundIn.score, SCORES, pack.score),
    volume: num(soundIn.volume, 1, 0, 1),
    hits: (Array.isArray(soundIn.hits) ? soundIn.hits : [])
      .filter(isObj)
      .map((h) => ({ t: num(h.t ?? h.at, 0, 0, duration), kind: oneOf(h.kind ?? h.type, HIT_KINDS, 'hit'), gain: num(h.gain, 0.8, 0, 1) }))
      .sort((a, b) => a.t - b.t)
      .slice(0, 200),
    sync: soundIn.sync === undefined ? true : Boolean(soundIn.sync),
  };

  // Narration: one spoken line per scene at most, placed a moment after the
  // scene begins. A line keeps a reference to its clip once one is made.
  const voiceIn = isObj(doc.voice) ? doc.voice : {};
  const sceneIds = new Set(scenes.map((S) => S.id));
  const lineScenes = new Set();
  const voice = {
    engine: oneOf(voiceIn.engine, VOICE_ENGINES, 'none'),
    voice: str(voiceIn.voice, '', 200),
    speed: num(voiceIn.speed, 1, 0.5, 2),
    captions: voiceIn.captions === undefined ? true : Boolean(voiceIn.captions),
    duck: num(voiceIn.duck, 8, 0, 24),
    lines: (Array.isArray(voiceIn.lines) ? voiceIn.lines : [])
      .filter(isObj)
      .map((l) => ({
        scene: slug(l.scene),
        text: str(l.text ?? l.say, '', 300),
        say: str(l.say && l.text ? l.say : '', '', 300),
        at: num(l.at, 0.15, 0, LIMITS.maxSceneDuration),
        clip: typeof l.clip === 'string' && assets[slug(l.clip)]?.kind === 'audio' ? slug(l.clip) : null,
      }))
      .filter((l) => l.text && sceneIds.has(l.scene) && !lineScenes.has(l.scene) && lineScenes.add(l.scene)),
  };

  const scene = {
    format: FORMAT,
    title: str(doc.title ?? doc.name, 'Untitled film', 120),
    aspect,
    width,
    height,
    fps,
    bpm: Math.round(num(doc.bpm ?? doc.tempo, 120, LIMITS.minBpm, LIMITS.maxBpm)),
    seed: Math.round(num(doc.seed, 7, 0, 1e9)),
    style,
    palette,
    fonts,
    background,
    duration,
    scenes,
    sound,
    voice,
    assets,
  };
  return { scene, notes: notes.list };
}

// Where a scene sits in time, for the renderer and the timeline.
export function sceneSpans(scene) {
  return scene.scenes.map((S) => ({ id: S.id, start: S.start, end: S.start + S.duration, in: S.transition.duration }));
}

// A blank, valid document in a style, for a new project.
export function blankScene(style = 'studio', aspect = '16:9') {
  return normalizeScene({ style, aspect, scenes: [] }).scene;
}
