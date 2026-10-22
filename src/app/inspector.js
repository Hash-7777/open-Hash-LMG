// The inspector: hand edits to whatever is selected, after the model has made
// the film. Nothing selected shows the film's own settings; a scene shows its
// length, transition, camera and narration line; a layer shows what it says,
// where it sits, when it appears and how it moves.
//
// The panel is drawn from the scene each time, and left alone while one of its
// own fields has focus, so typing is never interrupted by a redraw.

import { h, clear } from './dom.js';
import { findLayer, layerSlot } from './store.js';
import {
  ASPECT_SHORT, field, pair, section, textInput, textArea, numberInput, select, toggle, segmented, colourInput, listInput, buttonRow, textButton,
} from './fields.js';
import {
  ASPECTS, FPS_CHOICES, STYLE_PACKS, STYLE_NAMES, FONT_NAMES, ANCHORS, IN_PRESETS, OUT_PRESETS, HOLD_PRESETS,
  TRANSITIONS, DIRECTIONS, BACKGROUNDS, SCORES, SHAPES, LIMITS, PALETTE_TOKENS,
} from '../core/scene/format.js';
import { toHex } from '../core/util/color.js';
import { resizeScene } from '../core/scene/edit.js';
import { staggerSection } from './stagger-fields.js';
import { videoSection } from './video-fields.js';
import { repeatSection } from './repeat-fields.js';

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ');
const labelled = (list) => list.map((v) => [v, cap(v)]);
const SCORE_LABELS = { pulse: 'Pulse: deep and minimal', soft: 'Soft: bright and light', cinematic: 'Cinematic: wide, no drums', none: 'No music' };
const FONT_LABELS = { sans: 'Sans', display: 'Display', condensed: 'Condensed', serif: 'Serif', mono: 'Mono', rounded: 'Rounded' };
const WEIGHTS = [[300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Heavy'], [900, 'Black']].map(([v, l]) => [String(v), l]);

function allLayers(list, out = []) {
  for (const L of list) { out.push(L); if (L.layers) allLayers(L.layers, out); }
  return out;
}

export function createInspector({ store, onVersion }) {
  const body = h('div', { class: 'insp-body' });
  const title = h('span', { class: 'panel-title' });
  const el = h('aside', { class: 'inspector', 'aria-label': 'Inspector' }, h('div', { class: 'panel-head' }, title), body);

  const st = () => store.get();
  const scene = () => st().project.scene;

  // ---- edits ------------------------------------------------------------------
  const film = (fn) => store.edit((doc) => fn(doc));
  const inScene = (id, fn, opts) => store.edit((doc) => {
    const S = doc.scenes.find((x) => x.id === id);
    if (!S) return false;
    return fn(S, doc);
  }, opts);
  const inLayer = (sid, lid, fn, opts) => inScene(sid, (S, doc) => {
    const L = findLayer(S.layers, lid);
    if (!L) return false;
    return fn(L, S, doc);
  }, opts);

  // ---- film ---------------------------------------------------------------------
  function filmPanel() {
    const s = scene();
    title.textContent = 'Film';
    const palette = h('div', { class: 'palette' });
    for (const k of PALETTE_TOKENS) {
      const input = h('input', { type: 'color', value: toHex(s.palette[k]) || '#000000', title: k, 'aria-label': `Palette colour ${k}` });
      input.addEventListener('change', () => film((doc) => { doc.palette[k] = input.value; }));
      palette.append(h('label', { class: 'palette-swatch' }, input, h('span', { text: { bg: 'Back', surface: 'Surface', ink: 'Ink', muted: 'Muted', accent: 'Accent', accent2: 'Accent 2' }[k] })));
    }
    return [
      section(null,
        field('Title', textInput(s.title, (v) => film((doc) => { doc.title = v; }), { max: 120 })),
        pair(
          field('Format', select(s.aspect, Object.keys(ASPECTS).map((k) => [k, ASPECT_SHORT[k] || k]), (v) => film((doc) => { doc.aspect = v; delete doc.width; delete doc.height; }))),
          field('Frame rate', select(String(s.fps), FPS_CHOICES.map((f) => [String(f), `${f} fps`]), (v) => film((doc) => { doc.fps = Number(v); })))),
        pair(
          field('Tempo', numberInput(s.bpm, (v) => film((doc) => { doc.bpm = Math.round(v); }), { min: LIMITS.minBpm, max: LIMITS.maxBpm, unit: 'bpm', digits: 0 })),
          field('Length', h('div', { class: 'readout', text: `${s.duration.toFixed(2)} s` })))),
      section('Look',
        field('Style', select(s.style, STYLE_NAMES.map((k) => [k, STYLE_PACKS[k].label]), (v) => film((doc) => restyle(doc, v))), STYLE_PACKS[s.style].blurb),
        field('Palette', palette),
        pair(
          field('Background', select(s.background.kind, labelled(BACKGROUNDS), (v) => film((doc) => { doc.background.kind = v; }))),
          field('Drift', numberInput(s.background.drift, (v) => film((doc) => { doc.background.drift = v; }), { min: 0, max: 1, step: 5, scale: 100, unit: '%', digits: 0 })))),
      onVersion ? section('Other frame shapes',
        h('p', { class: 'insp-note', text: 'A version for another screen is laid out again for it, never cropped. It opens as a film of its own; this one stays in Films.' }),
        buttonRow(...Object.keys(ASPECTS).filter((k) => k !== s.aspect).map((k) => textButton(ASPECT_SHORT[k] || k, () => onVersion(k))))) : null,
      section('Sound',
        field('Music', select(s.sound.score, SCORES.map((k) => [k, SCORE_LABELS[k]]), (v) => film((doc) => { doc.sound.score = v; }))),
        field('Music volume', numberInput(s.sound.volume, (v) => film((doc) => { doc.sound.volume = v; }), { min: 0, max: 1, step: 5, scale: 100, unit: '%', digits: 0 })),
        field('Captions', toggle(s.voice.captions, (v) => film((doc) => { doc.voice.captions = v; }), 'Show the narration as words on screen'))),
    ];
  }

  // A new style brings its palette, type, background and music, and moves the
  // layers that used the old style's type onto the new one.
  function restyle(doc, name) {
    const from = STYLE_PACKS[doc.style] || STYLE_PACKS.studio;
    const to = STYLE_PACKS[name];
    if (!to) return false;
    doc.style = name;
    delete doc.palette;
    delete doc.fonts;
    delete doc.background;
    if (doc.sound.score === from.score) doc.sound.score = to.score;
    for (const S of doc.scenes) {
      for (const L of allLayers(S.layers)) {
        if (L.font === from.fonts.display) L.font = to.fonts.display;
        else if (L.font === from.fonts.text) L.font = to.fonts.text;
        if (L.tracking === from.tracking) L.tracking = to.tracking;
      }
    }
  }

  // ---- scene --------------------------------------------------------------------
  function scenePanel(S) {
    const s = scene();
    const index = s.scenes.indexOf(S);
    const line = s.voice.lines.find((l) => l.scene === S.id);
    title.textContent = `Scene ${index + 1} of ${s.scenes.length}`;
    const tr = S.transition;
    const setLine = (text, live) => store.edit((doc) => {
      const lines = doc.voice.lines;
      const i = lines.findIndex((l) => l.scene === S.id);
      const clean = text.trim();
      if (!clean) { if (i >= 0) lines.splice(i, 1); else return false; return undefined; }
      if (i >= 0) { if (lines[i].text === clean) return false; lines[i].text = clean; lines[i].clip = null; } else lines.push({ scene: S.id, text: clean, at: 0.15 });
      return undefined;
    }, { live });
    return [
      section('Scene',
        field('Name', textInput(S.name, (v) => inScene(S.id, (T) => { T.name = v; }), { placeholder: S.id, max: 60 })),
        field('Length', numberInput(S.duration, (v) => inScene(S.id, (T) => { resizeScene(T, v); }), { min: LIMITS.minSceneDuration, max: LIMITS.maxSceneDuration, step: 0.1, unit: 's' })),
        field('Background', colourInput(S.background, s.palette, (v) => inScene(S.id, (T) => { T.background = v; }), { allowNone: true }), 'None uses the film’s background.')),
      index > 0 ? section('Enters with',
        pair(
          field('Transition', select(tr.kind, labelled(TRANSITIONS), (v) => inScene(S.id, (T, doc) => {
            T.transition.kind = v;
            if (v !== 'cut' && !T.transition.duration) T.transition.duration = 0.5;
            if (v === 'carry' && !T.transition.carry) {
              const prev = doc.scenes[doc.scenes.indexOf(T) - 1];
              const first = (list) => (list.find((L) => L.type === 'text') || list[0] || {}).id;
              if (prev && first(prev.layers) && first(T.layers)) T.transition.carry = { from: first(prev.layers), to: first(T.layers) };
            }
          }))),
          field('Duration', numberInput(tr.duration, (v) => inScene(S.id, (T) => { T.transition.duration = v; }), { min: 0.05, max: 3, step: 0.05, unit: 's' }))),
        ['push', 'slide', 'wipe'].includes(tr.kind)
          ? field('Direction', segmented(tr.direction, labelled(DIRECTIONS), (v) => inScene(S.id, (T) => { T.transition.direction = v; })))
          : null,
        tr.kind === 'carry' ? carryFields(S, s.scenes[index - 1]) : null) : null,
      section('Camera',
        pair(
          field('Zoom from', numberInput(S.camera.zoom[0], (v) => inScene(S.id, (T) => { T.camera.zoom[0] = v; }), { min: 0.25, max: 4, step: 1, scale: 100, unit: '%', digits: 0 })),
          field('Zoom to', numberInput(S.camera.zoom[1], (v) => inScene(S.id, (T) => { T.camera.zoom[1] = v; }), { min: 0.25, max: 4, step: 1, scale: 100, unit: '%', digits: 0 }))),
        h('div', { class: 'field-hint', text: 'A slow push of a few percent keeps a scene alive without drawing the eye.' })),
      staggerSection(S, inScene),
      section('Narration',
        field('Spoken line', textArea(line ? line.text : '', { onLive: (v) => setLine(v, true), onCommit: (v) => { setLine(v, true); store.commit(); }, rows: 3, placeholder: 'What the voice says in this scene', max: 300 }),
          line && line.clip ? null : line ? 'Not spoken yet. Voices come with the voice settings.' : null)),
      section('Add to this scene',
        buttonRow(
          textButton('Text', () => addLayer(S, { type: 'text', text: 'New line', size: 72, weight: 700 })),
          textButton('Counter', () => addLayer(S, { type: 'counter', from: 0, to: 100, size: 160 })),
          textButton('Shape', () => addLayer(S, { type: 'shape', shape: 'ring', w: 180, strokeWidth: 8 })))),
      section('Arrange',
        buttonRow(
          textButton('Move earlier', () => moveScene(S.id, -1), index === 0 ? 'disabled' : ''),
          textButton('Move later', () => moveScene(S.id, 1), index === s.scenes.length - 1 ? 'disabled' : ''),
          textButton('Duplicate', () => duplicateScene(S.id)),
          textButton('Delete', () => deleteScene(S.id), 'danger'))),
    ];
  }

  // A carry names a layer of the scene before and the layer it becomes here;
  // a missing half defaults to the first line of words in its scene.
  function carryFields(S, prev) {
    const name = (L) => (L.name || L.text || L.type).replace(/\n/g, ' ').slice(0, 40);
    const firstText = (list) => (list.find((L) => L.type === 'text') || list[0] || {}).id || '';
    const cur = S.transition.carry || {};
    const setCarry = (part) => inScene(S.id, (T) => {
      const c = T.transition.carry || {};
      T.transition.carry = { from: c.from || firstText(prev.layers), to: c.to || firstText(T.layers), ...part };
    });
    return pair(
      field('Carries', select(cur.from || '', [['', 'Choose'], ...prev.layers.map((L) => [L.id, name(L)])], (v) => setCarry({ from: v }))),
      field('Into', select(cur.to || '', [['', 'Choose'], ...S.layers.map((L) => [L.id, name(L)])], (v) => setCarry({ to: v }))));
  }

  function addLayer(S, layer) {
    const local = Math.min(S.duration - 0.5, Math.max(0, st().time - S.start));
    let made = null;
    inScene(S.id, (T) => {
      const id = `${layer.type}-${Date.now().toString(36)}`;
      T.layers.push({ id, x: 0.5, y: 0.5, at: +Math.max(0, local).toFixed(2), ...layer });
      made = id;
    });
    if (made) store.select({ scene: S.id, layer: made });
  }

  function moveScene(id, by) {
    store.edit((doc) => {
      const i = doc.scenes.findIndex((x) => x.id === id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= doc.scenes.length) return false;
      const [S] = doc.scenes.splice(i, 1);
      doc.scenes.splice(j, 0, S);
    });
  }

  function duplicateScene(id) {
    let copyId = null;
    store.edit((doc) => {
      const i = doc.scenes.findIndex((x) => x.id === id);
      if (i < 0) return false;
      const copy = structuredClone(doc.scenes[i]);
      copy.id = `${id}-copy`;
      const stamp = Date.now().toString(36);
      for (const L of allLayers(copy.layers)) L.id = `${L.id}-${stamp}`;
      doc.scenes.splice(i + 1, 0, copy);
      copyId = copy.id;
    });
    if (copyId) {
      const made = scene().scenes.find((x) => x.id.startsWith(copyId));
      if (made) store.select({ scene: made.id, layer: null });
    }
  }

  function deleteScene(id) {
    if (scene().scenes.length <= 1) return;
    store.edit((doc) => {
      doc.scenes = doc.scenes.filter((x) => x.id !== id);
      doc.voice.lines = doc.voice.lines.filter((l) => l.scene !== id);
    });
    store.select(null);
  }

  // ---- layer ------------------------------------------------------------------------
  function layerPanel(S, L) {
    const s = scene();
    title.textContent = { text: 'Text', shape: 'Shape', image: 'Picture', counter: 'Counter', bars: 'Bar chart', 'line-chart': 'Line chart', group: 'Group' }[L.type] || 'Layer';
    const set = (fn) => inLayer(S.id, L.id, fn);
    const parts = [];

    if (L.type === 'text') {
      parts.push(section('Words',
        field('Text', textArea(L.text, { onLive: (v) => { if (v.trim()) inLayer(S.id, L.id, (M) => { M.text = v; }, { live: true }); }, onCommit: () => store.commit(), rows: 3, max: LIMITS.maxTextChars })),
        field('Accent words', listInput(L.highlight, (v) => set((M) => { M.highlight = v; }), { placeholder: 'Words to set in the accent colour' })),
        pair(
          field('Size', numberInput(L.size, (v) => set((M) => { M.size = v; }), { min: 8, max: 600, step: 2, unit: 'pt', digits: 0 })),
          field('Weight', select(String(L.weight), WEIGHTS, (v) => set((M) => { M.weight = Number(v); })))),
        pair(
          field('Font', select(L.font, FONT_NAMES.map((f) => [f, FONT_LABELS[f] || f]), (v) => set((M) => { M.font = v; }))),
          field('Colour', colourInput(L.color, s.palette, (v) => set((M) => { M.color = v || 'ink'; })))),
        field('Align', segmented(L.align, [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']], (v) => set((M) => { M.align = v; }))),
        field('Capitals', toggle(L.upper, (v) => set((M) => { M.upper = v; }), 'Set in capitals'))));
    } else if (L.type === 'counter') {
      parts.push(section('Counter',
        pair(
          field('From', numberInput(L.from, (v) => set((M) => { M.from = v; }), { step: 1 })),
          field('To', numberInput(L.to, (v) => set((M) => { M.to = v; }), { step: 1 }))),
        pair(
          field('Before', textInput(L.prefix, (v) => set((M) => { M.prefix = v; }), { max: 12 })),
          field('After', textInput(L.suffix, (v) => set((M) => { M.suffix = v; }), { max: 24 }))),
        pair(
          field('Decimals', numberInput(L.decimals, (v) => set((M) => { M.decimals = Math.round(v); }), { min: 0, max: 6, digits: 0 })),
          field('Counts for', numberInput(L.count, (v) => set((M) => { M.count = v; }), { min: 0, max: 30, step: 0.1, unit: 's' }))),
        field('Odometer', toggle(L.roll, (v) => set((M) => { M.roll = v; }), 'Roll the digits into place')),
        pair(
          field('Size', numberInput(L.size, (v) => set((M) => { M.size = v; }), { min: 8, max: 800, step: 2, unit: 'pt', digits: 0 })),
          field('Colour', colourInput(L.color, s.palette, (v) => set((M) => { M.color = v || 'ink'; }))))));
    } else if (L.type === 'shape') {
      parts.push(section('Shape',
        field('Shape', select(L.shape, labelled(SHAPES.filter((x) => x !== 'path' || L.shape === 'path')), (v) => set((M) => { M.shape = v; }))),
        pair(
          field('Width', numberInput(L.w, (v) => set((M) => { M.w = v; }), { min: 0, max: 8000, step: 2, unit: 'pt', digits: 0 })),
          field('Height', numberInput(L.h, (v) => set((M) => { M.h = v; }), { min: 0, max: 8000, step: 2, unit: 'pt', digits: 0 }))),
        pair(
          field('Fill', colourInput(L.fill, s.palette, (v) => set((M) => { M.fill = v; }), { allowNone: true })),
          field('Line', colourInput(L.stroke, s.palette, (v) => set((M) => { M.stroke = v; }), { allowNone: true }))),
        field('Line width', numberInput(L.strokeWidth, (v) => set((M) => { M.strokeWidth = v; }), { min: 0, max: 400, step: 1, unit: 'pt', digits: 0 }))));
    } else if (L.type === 'bars' || L.type === 'line-chart') {
      parts.push(section('Chart',
        field('Values', listInput(L.values, (v) => { if (v.length) set((M) => { M.values = v; }); }, { numbers: true, placeholder: '12, 18, 27' })),
        field('Labels', listInput(L.labels, (v) => set((M) => { M.labels = v; }), { placeholder: 'Q1, Q2, Q3' })),
        pair(
          field('Width', numberInput(L.w, (v) => set((M) => { M.w = v; }), { min: 40, max: 8000, step: 10, unit: 'pt', digits: 0 })),
          field('Height', numberInput(L.h, (v) => set((M) => { M.h = v; }), { min: 40, max: 8000, step: 10, unit: 'pt', digits: 0 }))),
        pair(
          field('Colour', colourInput(L.color, s.palette, (v) => set((M) => { M.color = v || 'accent'; }))),
          field('After values', textInput(L.suffix, (v) => set((M) => { M.suffix = v; }), { max: 12 })))));
    } else if (L.type === 'image') {
      parts.push(section('Picture',
        field('Fit', segmented(L.fit, [['contain', 'Whole picture'], ['cover', 'Fill the box']], (v) => set((M) => { M.fit = v; }))),
        pair(
          field('Width', numberInput(L.w, (v) => set((M) => { M.w = v; }), { min: 1, max: 8000, step: 10, unit: 'pt', digits: 0 })),
          field('Height', numberInput(L.h, (v) => set((M) => { M.h = v; }), { min: 1, max: 8000, step: 10, unit: 'pt', digits: 0 })))));
    }

    if (L.type === 'video') parts.push(videoSection(L, set, s.assets[L.asset]));
    if (L.type === 'shape' || L.type === 'text') parts.push(repeatSection(L, set));

    parts.push(section('Place',
      pair(
        field('Across', numberInput(L.x, (v) => set((M) => { M.x = v; }), { min: -0.5, max: 1.5, step: 0.5, scale: 100, unit: '%', digits: 1 })),
        field('Down', numberInput(L.y, (v) => set((M) => { M.y = v; }), { min: -0.5, max: 1.5, step: 0.5, scale: 100, unit: '%', digits: 1 }))),
      pair(
        field('Anchor', select(L.anchor, labelled(ANCHORS), (v) => set((M) => { M.anchor = v; }))),
        field('Opacity', numberInput(L.opacity, (v) => set((M) => { M.opacity = v; }), { min: 0, max: 1, step: 5, scale: 100, unit: '%', digits: 0 }))),
      pair(
        field('Scale', numberInput(L.scale, (v) => set((M) => { M.scale = v; }), { min: 0, max: 20, step: 5, scale: 100, unit: '%', digits: 0 })),
        field('Turn', numberInput(L.rotate, (v) => set((M) => { M.rotate = v; }), { min: -3600, max: 3600, step: 1, unit: '°', digits: 1 })))));

    parts.push(section('Timing',
      pair(
        field('Appears at', numberInput(L.at, (v) => set((M) => { M.at = Math.min(v, M.until - 0.1); }), { min: 0, max: S.duration, step: 0.05, unit: 's' })),
        field('Leaves at', numberInput(L.until, (v) => set((M) => { M.until = Math.max(v, M.at + 0.1); }), { min: 0, max: S.duration, step: 0.05, unit: 's' }))),
      h('div', { class: 'field-hint', text: 'Seconds from the start of the scene.' })));

    parts.push(section('Motion',
      pair(
        field('Entrance', select(L.in.preset, labelled(IN_PRESETS), (v) => set((M) => { M.in.preset = v; if (!M.in.duration) M.in.duration = 0.7; }))),
        field('Takes', numberInput(L.in.duration, (v) => set((M) => { M.in.duration = v; }), { min: 0, max: 10, step: 0.05, unit: 's' }))),
      pair(
        field('Exit', select(L.out.preset, labelled(OUT_PRESETS), (v) => set((M) => { M.out.preset = v; if (!M.out.duration) M.out.duration = 0.45; }))),
        field('Takes', numberInput(L.out.duration, (v) => set((M) => { M.out.duration = v; }), { min: 0, max: 10, step: 0.05, unit: 's' }))),
      field('While it holds', select(L.hold, labelled(HOLD_PRESETS), (v) => set((M) => { M.hold = v; })))));

    parts.push(section('Layer',
      buttonRow(
        textButton('Duplicate', () => duplicateLayer(S.id, L.id)),
        textButton('Delete', () => deleteLayer(S.id, L.id), 'danger'))));
    return parts;
  }

  function duplicateLayer(sid, lid) {
    let made = null;
    inScene(sid, (S) => {
      const slot = layerSlot(S.layers, lid);
      if (!slot) return false;
      const copy = structuredClone(slot.list[slot.index]);
      const stamp = Date.now().toString(36);
      for (const L of allLayers([copy])) L.id = `${L.id}-${stamp}`;
      copy.y = Math.min(1.5, copy.y + 0.04);
      slot.list.splice(slot.index + 1, 0, copy);
      made = copy.id;
    });
    if (made) store.select({ scene: sid, layer: made });
  }

  function deleteLayer(sid, lid) {
    inScene(sid, (S) => {
      const slot = layerSlot(S.layers, lid);
      if (!slot) return false;
      slot.list.splice(slot.index, 1);
    });
    store.select({ scene: sid, layer: null });
  }

  // ---- drawing ---------------------------------------------------------------------
  function codeNotice() {
    return section('Drawn by code',
      h('p', { class: 'insp-note', text: 'The model wrote its own animation code for this film. The scenes on the timeline are its timing guide; ask for changes on the left.' }),
      buttonRow(textButton('Use the scene plan instead', () => store.patch({ code: null, tier: 'plan' }))));
  }

  function render() {
    const { selection, project } = st();
    const S = selection.scene ? project.scene.scenes.find((x) => x.id === selection.scene) : null;
    const L = S && selection.layer ? findLayer(S.layers, selection.layer) : null;
    let parts;
    if (L) parts = layerPanel(S, L);
    else if (S) parts = scenePanel(S);
    else parts = filmPanel();
    if (project.code) parts.unshift(codeNotice());
    const scrollTop = body.scrollTop;
    const same = body.dataset.target === `${S?.id || ''}/${L?.id || ''}`;
    clear(body).append(...parts.filter(Boolean));
    body.dataset.target = `${S?.id || ''}/${L?.id || ''}`;
    if (same) body.scrollTop = scrollTop;
  }

  let deferred = false;
  const maybeRender = () => {
    if (el.contains(document.activeElement) && document.activeElement !== document.body && document.activeElement.matches('input, textarea, select')) { deferred = true; return; }
    render();
  };
  el.addEventListener('focusout', () => setTimeout(() => { if (deferred && !el.contains(document.activeElement)) { deferred = false; render(); } }, 0));
  store.on('project', maybeRender);
  store.on('selection', () => { deferred = false; render(); });
  render();

  return { el, deleteSelected() {
    const { selection } = st();
    if (selection.layer) deleteLayer(selection.scene, selection.layer);
  } };
}
