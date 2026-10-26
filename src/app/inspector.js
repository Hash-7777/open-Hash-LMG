// The inspector: hand edits to whatever is selected, after the model has made
// the film. It is shown only while there is something to edit: a scene shows
// its length, transition, camera and narration line; a layer shows, in three
// tabs (layer-panel.js), how it looks, where it sits and how it moves; the
// film's own settings show when asked for (the Film button in the top bar, or
// the path's first part). With nothing to edit it closes, and the preview
// takes its room.
//
// A path across the top (Film, Scene, Layer) goes back up a level, and a
// close button beside it closes the panel. The panel
// is drawn from the scene each time, and left alone while one of its own
// fields has focus or a label is being dragged, so neither is interrupted by
// a redraw. A layer with keyframes is drawn again as the playhead moves, so
// its values are the ones at the playhead.

import { narrationSection } from './narration-fields.js';
import { h, clear, perFrame, iconButton } from './dom.js';
import { ICONS } from './icons.js';
import { findLayer, layerSlot } from './store.js';
import {
  ASPECT_SHORT, field, pair, section, textInput, numberInput, select, toggle, segmented, colourInput, buttonRow, textButton, scrubbing,
} from './fields.js';
import {
  ASPECTS, FPS_CHOICES, STYLE_PACKS, STYLE_NAMES, TRANSITIONS, DIRECTIONS, BACKGROUNDS, SCORES, LIMITS, PALETTE_TOKENS,
} from '../core/scene/format.js';
import { toHex } from '../core/util/color.js';
import { resizeScene } from '../core/scene/edit.js';
import { staggerSection } from './stagger-fields.js';
import { createLayerPanel, layerTitle, layerActions, followsPlayhead, layerTab } from './layer-panel.js';

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ');
const labelled = (list) => list.map((v) => [v, cap(v)]);
const SCORE_LABELS = { composed: 'Composed by the model for this film', pulse: 'Pulse: deep and minimal', soft: 'Soft: bright and light', cinematic: 'Cinematic: wide, no drums', bounce: 'Bounce: playful, mallets and claps', drive: 'Drive: fast, four on the floor', keys: 'Keys: warm electric piano', arp: 'Arp: running synth, precise', none: 'No music' };
const CAMERA_FEELS = [['inOutSine', 'Soft in and out'], ['linear', 'Even'], ['inOutCubic', 'Ease in and out'], ['outExpo', 'Fast, then slow']];

function allLayers(list, out = []) {
  for (const L of list) { out.push(L); if (L.layers) allLayers(L.layers, out); }
  return out;
}

// onShow(open): the panel opened or closed, for the layout to make room.
export function createInspector({ store, onVersion, settings = null, onShow = () => {} }) {
  const body = h('div', { class: 'insp-body' });
  const crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Selection' });
  const foot = h('div', { class: 'insp-foot' });
  // The film's settings, asked for; a selection made afterwards takes over.
  let filmOpen = false;
  const close = () => { filmOpen = false; store.select(null); render(); };
  const openFilm = () => { filmOpen = true; store.select(null); render(); };
  const closeBtn = iconButton(ICONS.cross, 'Close the panel', close, 'insp-close');
  const el = h('aside', { class: 'inspector', 'aria-label': 'Inspector' }, h('div', { class: 'panel-head' }, crumbs, closeBtn), body, foot);
  // The path to what is selected; every part but the last goes back to it.
  const setPath = (...parts) => {
    clear(crumbs).append(...parts.flatMap(([label, go], i) => {
      const last = i === parts.length - 1;
      const part = last ? h('span', { class: 'crumb now', text: label, 'aria-current': 'true' }) : h('button', { type: 'button', class: 'crumb', text: label, title: `Back to the ${label.toLowerCase().startsWith('scene') ? 'scene' : 'film'}`, onclick: go });
      return i ? [h('span', { class: 'crumb-sep', 'aria-hidden': 'true', text: '/' }), part] : [part];
    }));
  };

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
    setPath(['Film']);
    const palette = h('div', { class: 'palette' });
    for (const k of PALETTE_TOKENS) {
      const input = h('input', { type: 'color', value: toHex(s.palette[k]) || '#000000', title: k, 'aria-label': `Palette colour ${k}` });
      input.addEventListener('change', () => film((doc) => { doc.palette[k] = input.value; }));
      palette.append(h('label', { class: 'palette-swatch' }, input, h('span', { text: { bg: 'Back', surface: 'Surface', ink: 'Ink', muted: 'Muted', accent: 'Accent', accent2: 'Accent 2' }[k] })));
    }
    return [
      section(null,
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
        field('Music', select(s.sound.score, SCORES.filter((k) => k !== 'composed' || s.sound.notes?.length).map((k) => [k, SCORE_LABELS[k]]), (v) => film((doc) => { doc.sound.score = v; }))),
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
    setPath(['Film', openFilm], [`Scene ${index + 1} of ${s.scenes.length}`]);
    const tr = S.transition;
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
      section('Camera', { reset: () => inScene(S.id, (T) => { T.camera = { zoom: [1, 1.04] }; }) },
        pair(
          field('Zoom from', camNum(S, 'zoom', 0, { min: 0.25, max: 4, step: 1, scale: 100, unit: '%', digits: 0 })),
          field('Zoom to', camNum(S, 'zoom', 1, { min: 0.25, max: 4, step: 1, scale: 100, unit: '%', digits: 0 }))),
        pair(
          field('Pan across from', camNum(S, 'x', 0, { min: -0.5, max: 0.5, step: 0.5, scale: 100, unit: '%', digits: 1 })),
          field('Pan across to', camNum(S, 'x', 1, { min: -0.5, max: 0.5, step: 0.5, scale: 100, unit: '%', digits: 1 }))),
        pair(
          field('Pan down from', camNum(S, 'y', 0, { min: -0.5, max: 0.5, step: 0.5, scale: 100, unit: '%', digits: 1 })),
          field('Pan down to', camNum(S, 'y', 1, { min: -0.5, max: 0.5, step: 0.5, scale: 100, unit: '%', digits: 1 }))),
        field('Feel', select(S.camera.ease, CAMERA_FEELS.some(([k]) => k === S.camera.ease) ? CAMERA_FEELS : [...CAMERA_FEELS, [S.camera.ease, cap(S.camera.ease)]], (v) => inScene(S.id, (T) => { T.camera.ease = v; }))),
        h('div', { class: 'field-hint', text: 'A slow push or pan of a few percent keeps a scene alive without drawing the eye.' })),
      staggerSection(S, inScene),
      narrationSection(S, s, { store, settings }),
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

  // One end of a camera move, following a drag of its label.
  function camNum(S, prop, end, opts) {
    const put = (v) => (T) => { T.camera[prop][end] = v; };
    return numberInput(S.camera[prop][end], (v) => { inScene(S.id, put(v), { live: true }); store.commit(); }, { ...opts, onLive: (v) => inScene(S.id, put(v), { live: true }) });
  }

  // ---- layer ------------------------------------------------------------------------
  const layerPanel = createLayerPanel({ store, inScene, inLayer, rerender: () => render() });

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
    const open = Boolean(selection.scene) || filmOpen;
    if (el.hidden === open) { el.hidden = !open; onShow(open); }
    if (!open) return;
    const S = selection.scene ? project.scene.scenes.find((x) => x.id === selection.scene) : null;
    const L = S && selection.layer ? findLayer(S.layers, selection.layer) : null;
    let parts;
    clear(foot);
    if (L) {
      setPath(['Film', openFilm], [`Scene ${project.scene.scenes.indexOf(S) + 1}`, () => store.select({ scene: S.id, layer: null })], [L.name || layerTitle(L)]);
      parts = layerPanel(S, L);
      foot.append(layerActions(() => duplicateLayer(S.id, L.id), () => deleteLayer(S.id, L.id)));
    } else if (S) parts = scenePanel(S);
    else parts = filmPanel();
    foot.hidden = !L;
    if (project.code) parts.unshift(codeNotice());
    // The same view drawn again keeps its scroll; a new one opens at the top.
    const target = `${S?.id || ''}/${L?.id || ''}/${L ? layerTab() : ''}`;
    const scrollTop = body.dataset.target === target ? body.scrollTop : 0;
    clear(body).append(...parts.filter(Boolean));
    body.dataset.target = target;
    body.scrollTop = scrollTop;
  }

  let deferred = false;
  const busy = () => scrubbing.active || (el.contains(document.activeElement) && document.activeElement !== document.body && document.activeElement.matches('input, textarea, select'));
  const maybeRender = () => {
    if (busy()) { deferred = true; return; }
    render();
  };
  const settle = () => setTimeout(() => { if (deferred && !busy()) { deferred = false; render(); } }, 0);
  el.addEventListener('focusout', settle);
  el.addEventListener('scrub-end', settle);
  store.on('project', maybeRender);
  store.on('selection', () => { if (st().selection.scene) filmOpen = false; deferred = false; render(); });
  // A layer's Position tab shows its values and keyframes at the playhead, so
  // it follows the playhead while it is moved by hand; while the film plays,
  // the panel waits.
  const following = () => Boolean(st().selection.layer) && followsPlayhead();
  store.on('time', perFrame(() => { if (!st().playing && following()) maybeRender(); }));
  store.on('playing', () => { if (!st().playing && following()) maybeRender(); });
  render();

  return { el, openFilm, close, toggleFilm: () => (filmOpen && !st().selection.scene ? close() : openFilm()), deleteSelected() {
    const { selection } = st();
    if (selection.layer) deleteLayer(selection.scene, selection.layer);
  } };
}
