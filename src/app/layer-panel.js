// The inspector for one layer, in three tabs as a video editor has them:
// Design (what it shows and how it looks), Position (where it sits, its
// stacking order, and keyframes at the playhead) and Animate (when it comes
// and goes, and how it moves doing so).
//
// Numbers follow a drag of their label as it happens and join the history as
// one step. A keyed property shows its value at the playhead, and changing it
// there records a key, as a video editor does.

import { h } from './dom.js';
import { ICONS } from './icons.js';
import { layerSlot } from './store.js';
import {
  field, pair, section, textInput, textArea, numberInput, rangeInput, select, toggle, colourInput, listInput, buttonRow, textButton, tabs, iconRow,
} from './fields.js';
import { FONT_NAMES, ANCHORS, IN_PRESETS, OUT_PRESETS, HOLD_PRESETS, SHAPES, LIMITS } from '../core/scene/format.js';
import { keyAt, valueAt, keyHere, removeKey, clearKeys, setAt, keyTimes, nextKey } from '../core/scene/keys-edit.js';
import { safeArea } from '../core/scene/lint.js';
import { videoSection } from './video-fields.js';
import { repeatSection } from './repeat-fields.js';

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ');
const labelled = (list) => list.map((v) => [v, cap(v)]);
const FONT_LABELS = { sans: 'Sans', display: 'Display', condensed: 'Condensed', serif: 'Serif', mono: 'Mono', rounded: 'Rounded' };
const WEIGHTS = [[300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Heavy'], [900, 'Black']].map(([v, l]) => [String(v), l]);
const TITLES = { text: 'Text', shape: 'Shape', image: 'Picture', video: 'Clip', counter: 'Counter', bars: 'Bar chart', 'line-chart': 'Line chart', group: 'Group' };

// How a move feels, in words; the curves without overshoot (docs/MOTION-RULES.md).
const FEELS = [['outExpo', 'Smooth'], ['outQuint', 'Swift'], ['outCubic', 'Gentle'], ['settle', 'Settle'], ['inOutCubic', 'Ease in and out'], ['inOutSine', 'Soft in and out'], ['linear', 'Even'], ['inCubic', 'Speed up'], ['inExpo', 'Rush away']];
const feels = (cur) => (FEELS.some(([k]) => k === cur) || !cur ? FEELS : [...FEELS, [cur, cap(cur)]]);
// Entrances that travel, and those that arrive in parts.
const TRAVELS = new Set(['rise', 'drop', 'soft', 'slide-left', 'slide-right']);
const IN_PARTS = new Set(['letters', 'words', 'type']);

// The tab last chosen, kept while the editor is open.
let current = 'design';

export const layerTitle = (L) => TITLES[L.type] || 'Layer';
// Whether the tab shown depends on where the playhead is.
export const followsPlayhead = () => current === 'position';
export const layerTab = () => current;

export function createLayerPanel({ store, inScene, inLayer, rerender }) {
  const scene = () => store.get().project.scene;

  return function layerPanel(S, L) {
    const s = scene();
    const set = (fn) => inLayer(S.id, L.id, fn);
    const live = (fn) => inLayer(S.id, L.id, fn, { live: true });
    // A number that follows a drag of its label, then joins the history once.
    const num = (value, put, opts) => numberInput(value, (v) => { live((M) => put(M, v)); store.commit(); }, { ...opts, onLive: (v) => live((M) => put(M, v)) });
    const range = (value, put, opts) => rangeInput(value, (v) => { live((M) => put(M, v)); store.commit(); }, { ...opts, onLive: (v) => live((M) => put(M, v)) });
    const pick = (v) => { current = v; rerender(); };
    const body = current === 'position' ? positionTab(S, L, s, { set, num, range }) : current === 'animate' ? animateTab(S, L, { set, num }) : designTab(S, L, s, { set, num, range });
    return [h('div', { class: 'insp-tabs-row' }, tabs([['design', 'Design'], ['position', 'Position'], ['animate', 'Animate']], current, pick)), ...body];
  };

  // ---- Design ---------------------------------------------------------------------
  function designTab(S, L, s, { set, num, range }) {
    const parts = [section(null, field('Name', textInput(L.name, (v) => set((M) => { M.name = v; }), { placeholder: (L.text || layerTitle(L)).replace(/\s+/g, ' ').slice(0, 40), max: 60 }), 'How it is named on the timeline.'))];
    if (L.type === 'text') {
      parts.push(section('Words',
        field('Text', textArea(L.text, { onLive: (v) => { if (v.trim()) inLayer(S.id, L.id, (M) => { M.text = v; }, { live: true }); }, onCommit: () => store.commit(), rows: 3, max: LIMITS.maxTextChars })),
        field('Accent words', listInput(L.highlight, (v) => set((M) => { M.highlight = v; }), { placeholder: 'Words to set in the accent colour' }))));
      parts.push(section('Type',
        pair(
          field('Font', select(L.font, FONT_NAMES.map((f) => [f, FONT_LABELS[f] || f]), (v) => set((M) => { M.font = v; }))),
          field('Weight', select(String(L.weight), WEIGHTS, (v) => set((M) => { M.weight = Number(v); })))),
        field('Size', range(L.size, (M, v) => { M.size = v; }, { min: 8, max: 600, step: 1, unit: 'pt' })),
        pair(
          field('Colour', colourInput(L.color, s.palette, (v) => set((M) => { M.color = v || 'ink'; }))),
          field('Accent colour', colourInput(L.highlightColor, s.palette, (v) => set((M) => { M.highlightColor = v || 'accent'; })))),
        field('Align', iconRow([['left', 'alignLeft', 'Align left'], ['center', 'alignCentre', 'Centre'], ['right', 'alignRight', 'Align right']].map(([v, icon, label]) => [ICONS[icon], label, () => set((M) => { M.align = v; }), L.align === v]), 'wide')),
        field('Capitals', toggle(L.upper, (v) => set((M) => { M.upper = v; }), 'Set in capitals'))));
      parts.push(section('Spacing', { reset: () => set((M) => { delete M.tracking; delete M.leading; delete M.maxWidth; }) },
        field('Letter spacing', range(L.tracking, (M, v) => { M.tracking = v; }, { min: -0.1, max: 0.5, step: 0.005, scale: 100, unit: '%', digits: 1 })),
        field('Line height', range(L.leading, (M, v) => { M.leading = v; }, { min: 0.7, max: 2.5, step: 0.01, scale: 100, unit: '%' })),
        field('Wrap width', range(L.maxWidth, (M, v) => { M.maxWidth = v; }, { min: 0.1, max: 1.5, step: 0.01, scale: 100, unit: '%' }), 'How wide a line may run before it wraps, as a share of the frame.')));
      const plate = L.plate;
      parts.push(section('Background', { open: Boolean(plate) },
        field('Behind the words', toggle(Boolean(plate), (v) => set((M) => { M.plate = v ? { color: 'surface' } : null; }), 'A panel behind the words')),
        plate ? field('Colour', colourInput(plate.color, s.palette, (v) => set((M) => { M.plate = { ...M.plate, color: v || 'surface' }; }))) : null,
        plate ? pair(
          field('Padding', num(plate.padX, (M, v) => { M.plate = { ...M.plate, padX: v, padY: Math.round(v * 0.57) }; }, { min: 0, max: 400, step: 1, unit: 'pt', digits: 0 })),
          field('Corners', num(plate.radius, (M, v) => { M.plate = { ...M.plate, radius: v }; }, { min: 0, max: 400, step: 1, unit: 'pt', digits: 0 }))) : null));
    } else if (L.type === 'counter') {
      parts.push(section('Counter',
        pair(
          field('From', num(L.from, (M, v) => { M.from = v; }, { step: 1 })),
          field('To', num(L.to, (M, v) => { M.to = v; }, { step: 1 }))),
        pair(
          field('Before', textInput(L.prefix, (v) => set((M) => { M.prefix = v; }), { max: 12 })),
          field('After', textInput(L.suffix, (v) => set((M) => { M.suffix = v; }), { max: 24 }))),
        pair(
          field('Decimals', num(L.decimals, (M, v) => { M.decimals = Math.round(v); }, { min: 0, max: 6, digits: 0 })),
          field('Counts for', num(L.count, (M, v) => { M.count = v; }, { min: 0, max: 30, step: 0.1, unit: 's' }))),
        field('Odometer', toggle(L.roll, (v) => set((M) => { M.roll = v; }), 'Roll the digits into place'))));
      parts.push(section('Type',
        field('Size', range(L.size, (M, v) => { M.size = v; }, { min: 8, max: 600, step: 1, unit: 'pt' })),
        field('Colour', colourInput(L.color, s.palette, (v) => set((M) => { M.color = v || 'ink'; })))));
    } else if (L.type === 'shape') {
      parts.push(section('Shape',
        field('Shape', select(L.shape, labelled(SHAPES.filter((x) => x !== 'path' || L.shape === 'path')), (v) => set((M) => { M.shape = v; }))),
        sizePair(L, num),
        pair(
          field('Fill', colourInput(L.fill, s.palette, (v) => set((M) => { M.fill = v; }), { allowNone: true })),
          field('Line', colourInput(L.stroke, s.palette, (v) => set((M) => { M.stroke = v; }), { allowNone: true }))),
        pair(
          field('Line width', num(L.strokeWidth, (M, v) => { M.strokeWidth = v; }, { min: 0, max: 400, step: 1, unit: 'pt', digits: 0 })),
          L.shape === 'rect' ? field('Corners', num(L.radius, (M, v) => { M.radius = v; }, { min: 0, max: 2000, step: 1, unit: 'pt', digits: 0 })) : null)));
    } else if (L.type === 'bars' || L.type === 'line-chart') {
      parts.push(section('Chart',
        field('Values', listInput(L.values, (v) => { if (v.length) set((M) => { M.values = v; }); }, { numbers: true, placeholder: '12, 18, 27' })),
        field('Labels', listInput(L.labels, (v) => set((M) => { M.labels = v; }), { placeholder: 'Q1, Q2, Q3' })),
        sizePair(L, num),
        pair(
          field('Colour', colourInput(L.color, s.palette, (v) => set((M) => { M.color = v || 'accent'; }))),
          field('After values', textInput(L.suffix, (v) => set((M) => { M.suffix = v; }), { max: 12 })))));
    } else if (L.type === 'image') {
      parts.push(section('Picture',
        field('Fit', choice([['contain', 'Whole picture'], ['cover', 'Fill the box']], L.fit, (v) => set((M) => { M.fit = v; }))),
        sizePair(L, num),
        field('Corners', num(L.radius, (M, v) => { M.radius = v; }, { min: 0, max: 2000, step: 1, unit: 'pt', digits: 0 }))));
    }
    if (L.type === 'video') parts.push(videoSection(L, set, s.assets[L.asset]));
    if (L.type === 'shape' || L.type === 'text') parts.push(repeatSection(L, set));
    return parts;
  }

  // Width and height. A picture keeps its own proportion as either changes.
  function sizePair(L, num) {
    const keep = (L.type === 'image' || L.type === 'video') && L.h ? L.w / L.h : 0;
    return pair(
      field('Width', num(L.w, (M, v) => { M.w = v; if (keep) M.h = Math.round(v / keep); }, { min: 0, max: 8000, step: 2, unit: 'pt', digits: 0 })),
      field('Height', num(L.h, (M, v) => { M.h = v; if (keep) M.w = Math.round(v * keep); }, { min: 0, max: 8000, step: 2, unit: 'pt', digits: 0 })));
  }

  // ---- Position -------------------------------------------------------------------
  function positionTab(S, L, s, { set }) {
    const t = Math.min(S.duration, Math.max(0, store.get().time - S.start));
    const inside = store.get().time >= S.start - 1e-6 && store.get().time <= S.start + S.duration + 1e-6;
    const liveAt = (prop) => (v) => inLayer(S.id, L.id, (M) => { setAt(M, prop, t, v); }, { live: true });
    const commitAt = (prop) => (v) => { liveAt(prop)(v); store.commit(); };
    // A property's number with its keyframe diamond beside it.
    const keyed = (label, prop, opts) => {
      const has = L.keys?.[prop]?.length > 0;
      const here = keyAt(L.keys?.[prop], t) >= 0;
      const control = opts.range
        ? rangeInput(valueAt(L, prop, t), commitAt(prop), { ...opts, onLive: liveAt(prop) })
        : numberInput(valueAt(L, prop, t), commitAt(prop), { ...opts, onLive: liveAt(prop) });
      const diamond = h('button', {
        type: 'button', class: `key-btn${here ? ' on' : has ? ' some' : ''}`, html: here ? ICONS.keyOn : ICONS.key, disabled: !inside,
        title: !inside ? 'Move the playhead into this scene to set keyframes' : here ? `Remove the ${label.toLowerCase()} keyframe at the playhead` : `Add a ${label.toLowerCase()} keyframe at the playhead`,
        'aria-label': here ? `Remove ${label} keyframe` : `Add ${label} keyframe`,
        onclick: () => set((M) => { if (keyAt(M.keys?.[prop], t) >= 0) removeKey(M, prop, t); else keyHere(M, prop, t); }),
      });
      return h('div', { class: `keyed${has ? ' has-keys' : ''}` }, field(label, control), diamond);
    };
    const times = keyTimes(L);
    const jump = (dir) => { const k = nextKey(L, t, dir); if (k !== null) store.setTime(S.start + k); };
    const safe = safeArea(s);
    const parts = [
      section('Align in frame',
        iconRow([
          [ICONS.alignLeft, 'Left edge', () => align(S, L, t, { h: 'left', x: safe.left + 0.03 })],
          [ICONS.alignCentre, 'Centre across', () => align(S, L, t, { h: 'center', x: 0.5 })],
          [ICONS.alignRight, 'Right edge', () => align(S, L, t, { h: 'right', x: safe.right - 0.03 })],
          [ICONS.alignTop, 'Top edge', () => align(S, L, t, { v: 'top', y: safe.top + 0.04 })],
          [ICONS.alignMiddle, 'Centre down', () => align(S, L, t, { v: 'middle', y: 0.5 })],
          [ICONS.alignBottom, 'Bottom edge', () => align(S, L, t, { v: 'bottom', y: safe.bottom - 0.04 })],
        ], 'wide'),
        h('div', { class: 'field-hint', text: 'Inside the area every screen shows in full.' })),
      section('Transform', { reset: () => set((M) => { clearKeys(M); M.x = 0.5; M.y = 0.5; M.scale = 1; M.rotate = 0; M.opacity = 1; }) },
        pair(keyed('Across', 'x', { min: -0.5, max: 1.5, step: 0.5, scale: 100, unit: '%', digits: 1 }), keyed('Down', 'y', { min: -0.5, max: 1.5, step: 0.5, scale: 100, unit: '%', digits: 1 })),
        pair(keyed('Scale', 'scale', { min: 0, max: 20, step: 1, scale: 100, unit: '%', digits: 0 }), keyed('Turn', 'rotate', { min: -3600, max: 3600, step: 1, unit: '°', digits: 1 })),
        keyed('Opacity', 'opacity', { range: true, min: 0, max: 1, step: 0.01, scale: 100, unit: '%' }),
        field('Anchor', select(L.anchor, labelled(ANCHORS), (v) => set((M) => { M.anchor = v; })), 'The point of the layer that sits at its place.')),
      section('Keyframes',
        h('div', { class: 'key-bar' },
          iconRow([[ICONS.prevKey, 'Previous keyframe', () => jump(-1)], [ICONS.nextKey, 'Next keyframe', () => jump(1)]]),
          h('span', { class: 'key-count', text: times.length ? `${times.length} ${times.length === 1 ? 'keyframe' : 'keyframes'}` : 'No keyframes' }),
          times.length ? textButton('Clear all', () => set((M) => { clearKeys(M); })) : null),
        h('div', { class: 'field-hint', text: inside
          ? 'Press a diamond to hold a value at the playhead. Move the playhead, change the value, and the layer moves between the two.'
          : 'Move the playhead into this scene to set keyframes.' })),
      section('Order',
        iconRow([
          [ICONS.toFront, 'Bring to front', () => restack(S, L, Infinity)],
          [ICONS.forward, 'Bring forward', () => restack(S, L, 1)],
          [ICONS.backward, 'Send backward', () => restack(S, L, -1)],
          [ICONS.toBack, 'Send to back', () => restack(S, L, -Infinity)],
        ], 'wide')),
    ];
    return parts;
  }

  // Sets one side of the anchor and the place along it; words follow the side.
  function align(S, L, t, { h: side, v, x, y }) {
    inLayer(S.id, L.id, (M) => {
      const a = M.anchor || 'center';
      const hs = side || (a.includes('left') ? 'left' : a.includes('right') ? 'right' : 'center');
      const vs = v || (a.includes('top') ? 'top' : a.includes('bottom') ? 'bottom' : 'middle');
      M.anchor = hs === 'center' && vs === 'middle' ? 'center' : vs === 'middle' ? hs : hs === 'center' ? vs : `${vs}-${hs}`;
      if (side) { setAt(M, 'x', t, +x.toFixed(4)); if (M.type === 'text') M.align = side; }
      if (v) setAt(M, 'y', t, +y.toFixed(4));
    });
  }

  // Moves a layer in its stack by `by` places, or to an end; the stack keeps
  // its order and is numbered again from the back.
  function restack(S, L, by) {
    inScene(S.id, (T) => {
      const slot = layerSlot(T.layers, L.id);
      if (!slot) return false;
      const order = slot.list.map((M, i) => ({ M, i })).sort((a, b) => (a.M.z || 0) - (b.M.z || 0) || a.i - b.i).map((o) => o.M);
      const from = order.indexOf(slot.list[slot.index]);
      const to = Math.max(0, Math.min(order.length - 1, by === Infinity ? order.length - 1 : by === -Infinity ? 0 : from + by));
      if (to === from) return false;
      const [moved] = order.splice(from, 1);
      order.splice(to, 0, moved);
      order.forEach((M, i) => { M.z = i; });
    });
  }

  // ---- Animate ---------------------------------------------------------------------
  function animateTab(S, L, { set, num }) {
    // The playhead in scene seconds, read when a button is pressed.
    const here = () => +Math.min(S.duration, Math.max(0, store.get().time - S.start)).toFixed(2);
    const toPlayhead = (label, fn) => h('button', { type: 'button', class: 'mini-btn', title: `${label} at the playhead`, 'aria-label': `${label} at the playhead`, html: ICONS.playhead, onclick: fn });
    // A number with a button beside it; its label still drags the number.
    const timed = (control, btn) => Object.assign(h('div', { class: 'with-btn' }, control, btn), { scrub: control.scrub, labelFor: control.labelFor || control.id });
    const inStart = L.in.at ?? L.at;
    const outStart = L.out.at ?? Math.max(L.at, L.until - L.out.duration);
    return [
      section('Timing',
        pair(
          field('Appears at', timed(num(L.at, (M, v) => { M.at = Math.min(v, M.until - 0.1); }, { min: 0, max: S.duration, step: 0.05, unit: 's' }), toPlayhead('Appear', () => set((M) => { M.at = Math.min(here(), M.until - 0.1); if (M.in.at !== null && M.in.at !== undefined) M.in.at = M.at; })))),
          field('Leaves at', timed(num(L.until, (M, v) => { M.until = Math.max(v, M.at + 0.1); }, { min: 0, max: S.duration, step: 0.05, unit: 's' }), toPlayhead('Leave', () => set((M) => { M.until = Math.max(here(), M.at + 0.1); }))))),
        h('div', { class: 'field-hint', text: `Seconds from the start of the scene, which runs ${S.duration.toFixed(2)} s. On screen for ${(L.until - L.at).toFixed(2)} s.` })),
      section('Entrance', { reset: () => set((M) => { M.in = { preset: M.in.preset }; }) },
        pair(
          field('Style', select(L.in.preset, labelled(IN_PRESETS), (v) => set((M) => { M.in.preset = v; if (!M.in.duration) M.in.duration = 0.7; }))),
          field('Takes', num(L.in.duration, (M, v) => { M.in.duration = v; }, { min: 0, max: 10, step: 0.05, unit: 's' }))),
        L.in.preset !== 'none' ? pair(
          field('Feel', select(L.in.ease, feels(L.in.ease), (v) => set((M) => { M.in.ease = v; }))),
          field('Starts at', num(inStart, (M, v) => { M.in.at = v; }, { min: -1, max: S.duration, step: 0.05, unit: 's' }))) : null,
        TRAVELS.has(L.in.preset) ? field('Travels', num(L.in.distance, (M, v) => { M.in.distance = v; }, { min: 0, max: 600, step: 1, unit: 'pt', digits: 0 }), 'How far it moves to arrive.') : null,
        IN_PARTS.has(L.in.preset) ? field('Each part after', num(L.in.stagger, (M, v) => { M.in.stagger = v; }, { min: 0, max: 1, step: 0.005, unit: 's', digits: 3 }), 'The gap between one letter or word and the next.') : null),
      section('Exit', { reset: () => set((M) => { M.out = { preset: M.out.preset }; }) },
        pair(
          field('Style', select(L.out.preset, labelled(OUT_PRESETS), (v) => set((M) => { M.out.preset = v; if (!M.out.duration) M.out.duration = 0.45; }))),
          field('Takes', num(L.out.duration, (M, v) => { M.out.duration = v; }, { min: 0, max: 10, step: 0.05, unit: 's' }))),
        L.out.preset !== 'none' ? pair(
          field('Feel', select(L.out.ease, feels(L.out.ease), (v) => set((M) => { M.out.ease = v; }))),
          field('Starts at', num(outStart, (M, v) => { M.out.at = v; }, { min: 0, max: S.duration, step: 0.05, unit: 's' }))) : null),
      section('While it holds',
        field('Effect', select(L.hold, labelled(HOLD_PRESETS), (v) => set((M) => { M.hold = v; })))),
    ];
  }
}

// A choice of a few words, drawn as a row of buttons.
function choice(options, value, onPick) {
  return h('div', { class: 'segmented' }, ...options.map(([v, label]) =>
    h('button', { type: 'button', class: v === value ? 'on' : '', role: 'radio', 'aria-checked': String(v === value), text: label, onclick: () => onPick(v) })));
}

// The footer every layer shows: copy it, or take it out.
export function layerActions(onDuplicate, onDelete) {
  return buttonRow(textButton('Duplicate', onDuplicate), textButton('Delete', onDelete, 'danger'));
}
