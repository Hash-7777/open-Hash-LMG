// The editor's state: the open project, what is selected, where the playhead
// is, and the history that undo walks back through.
//
// A project holds the brief, the storyboard the model wrote, the scene that is
// drawn, and the model's own drawing code when the film was made that way.
// Every edit goes through normalizeScene, so a value typed in the inspector
// or dragged on the timeline can never leave the film in a state the renderer
// has to check again, and scene start times are always worked out afresh.
//
// Edits made while dragging are "live": they show at once but join the
// history only when the drag ends, so one drag is one undo.

import { normalizeScene } from '../core/scene/normalize.js';

export const PROJECT_FORMAT = 'lmg.project/1';
const TIERS = ['guided', 'plan', 'code'];
const HISTORY_LIMIT = 100;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function normalizeProject(input, newId) {
  const p = isObj(input) ? input : {};
  // A new film starts empty: no scenes until one is made, chosen or added.
  const { scene } = normalizeScene(p.scene || { title: 'Untitled film', scenes: [], sound: { score: 'none' } });
  return {
    format: PROJECT_FORMAT,
    id: typeof p.id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(p.id) ? p.id : newId(),
    brief: typeof p.brief === 'string' ? p.brief.slice(0, 4000) : '',
    storyboard: isObj(p.storyboard) ? p.storyboard : null,
    scene,
    code: typeof p.code === 'string' && p.code.trim() ? p.code : null,
    tier: TIERS.includes(p.tier) ? p.tier : 'guided',
    edited: Boolean(p.edited),
    // Which take of its brief the film is: the same brief made again is a new take.
    take: Number.isInteger(p.take) && p.take >= 0 ? p.take : 0,
    created: Number.isFinite(p.created) ? p.created : Date.now(),
    updated: Number.isFinite(p.updated) ? p.updated : Date.now(),
  };
}

export function findLayer(layers, id) {
  for (const L of layers || []) {
    if (L.id === id) return L;
    const inner = L.layers ? findLayer(L.layers, id) : null;
    if (inner) return inner;
  }
  return null;
}

// The layer list that holds the layer with this id, and its index there.
export function layerSlot(layers, id) {
  for (let i = 0; i < (layers || []).length; i++) {
    if (layers[i].id === id) return { list: layers, index: i };
    const inner = layers[i].layers ? layerSlot(layers[i].layers, id) : null;
    if (inner) return inner;
  }
  return null;
}

export function createStore(project) {
  let state = {
    project,
    selection: { scene: null, layer: null },
    time: 0,
    playing: false,
  };
  const past = [];
  const future = [];
  let liveBase = null;
  const listeners = { project: new Set(), selection: new Set(), time: new Set(), playing: new Set(), history: new Set() };

  const emit = (topic) => { for (const fn of listeners[topic]) fn(state); };

  function keepSelectionValid() {
    const { scene: sid, layer: lid } = state.selection;
    const S = sid ? state.project.scene.scenes.find((x) => x.id === sid) : null;
    const next = { scene: S ? sid : null, layer: S && lid && findLayer(S.layers, lid) ? lid : null };
    if (next.scene !== sid || next.layer !== lid) { state = { ...state, selection: next }; emit('selection'); }
  }

  function setProject(project, { record = true } = {}) {
    if (record) {
      past.push(state.project);
      if (past.length > HISTORY_LIMIT) past.shift();
      future.length = 0;
    }
    state = { ...state, project: { ...project, updated: Date.now() } };
    if (record) emit('history');
    if (state.time > state.project.scene.duration) state = { ...state, time: state.project.scene.duration };
    keepSelectionValid();
    emit('project');
  }

  return {
    get: () => state,
    on(topic, fn) { listeners[topic].add(fn); return () => listeners[topic].delete(fn); },

    setTime(t) {
      const d = state.project.scene.duration;
      const next = Math.min(d, Math.max(0, Number.isFinite(t) ? t : 0));
      if (next === state.time) return;
      state = { ...state, time: next };
      emit('time');
    },
    setPlaying(on) {
      if (Boolean(on) === state.playing) return;
      state = { ...state, playing: Boolean(on) };
      emit('playing');
    },
    select(sel) {
      const next = { scene: sel?.scene ?? null, layer: sel?.layer ?? null };
      if (next.scene === state.selection.scene && next.layer === state.selection.layer) return;
      state = { ...state, selection: next };
      emit('selection');
    },

    // Changes the scene. fn receives a copy (without media bytes) to change in
    // place. { live: true } shows it at once and records it on commit().
    edit(fn, { live = false } = {}) {
      // Assets can be large (pictures carried as data), so an edit gets a
      // fresh list of them to add to or take from, without copying each one.
      const { assets, ...rest } = state.project.scene;
      const draft = structuredClone(rest);
      draft.assets = { ...assets };
      if (fn(draft) === false) return;
      const { scene } = normalizeScene(draft);
      if (live) {
        if (!liveBase) liveBase = state.project;
        setProject({ ...state.project, scene, edited: true }, { record: false });
      } else {
        setProject({ ...state.project, scene, edited: true });
      }
    },
    // Ends a live edit: the state before the drag becomes one undo step.
    commit() {
      if (!liveBase) return;
      past.push(liveBase);
      if (past.length > HISTORY_LIMIT) past.shift();
      future.length = 0;
      liveBase = null;
      emit('history');
    },
    // Changes anything else in the project (brief, code, a whole new film).
    patch(fields, { record = true } = {}) {
      setProject({ ...state.project, ...fields }, { record });
    },
    // Opens another project: history starts afresh.
    load(project) {
      past.length = 0;
      future.length = 0;
      liveBase = null;
      state = { ...state, project, selection: { scene: null, layer: null }, time: 0, playing: false };
      emit('selection');
      emit('playing');
      emit('time');
      emit('project');
      emit('history');
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    undo() {
      if (!past.length) return;
      future.push(state.project);
      state = { ...state, project: past.pop() };
      keepSelectionValid();
      emit('project');
      emit('history');
    },
    redo() {
      if (!future.length) return;
      past.push(state.project);
      state = { ...state, project: future.pop() };
      keepSelectionValid();
      emit('project');
      emit('history');
    },
  };
}
