// The editor window: wires the panels to one store and one preview host.
//
//   left    the director: a conversation that asks, then makes and changes the film
//   centre  the preview and its transport
//   right   the inspector, for hand edits
//   bottom  the timeline
//
// The open film is saved a moment after every change, and when the window is
// hidden or closed.

import { h, clear, iconButton, toast, debounce } from './dom.js';
import { ICONS } from './icons.js';
import { createStore, normalizeProject } from './store.js';
import { createPlayer } from './player.js';
import { createTimeline } from './timeline.js';
import { createInspector } from './inspector.js';
import { createDirectorPanel } from './director.js';
import { openSettingsDialog } from './settings-dialog.js';
import { openExportDialog } from './export-dialog.js';
import { openProjectsDialog } from './projects-dialog.js';
import { createSettingsStore } from '../platform/settings.js';
import { storage, projects, newProjectId, isApp, invoke, keyVault, media } from '../platform/index.js';
import { initWindow } from '../platform/window.js';
import { makeVersion } from './versions.js';
import { createMediaPanel } from './media-panel.js';
import { openTemplatesDialog } from './templates-dialog.js';
import { createProgress } from './progress.js';
import { createHost } from '../render/host.js';

const LAST_KEY = 'lmg.last-project';
const UI_KEY = 'lmg.ui.v1';

function readPrefs() {
  let p = {};
  try { p = JSON.parse(storage.getItem(UI_KEY) || '{}') || {}; } catch { p = {}; }
  return { loop: Boolean(p.loop), sound: p.sound !== false, safe: Boolean(p.safe), snap: p.snap !== false };
}

async function openLast() {
  const id = storage.getItem(LAST_KEY);
  if (id) {
    try { return normalizeProject(JSON.parse(await projects.read(id)), newProjectId); } catch { /* start a new one */ }
  }
  return normalizeProject({}, newProjectId);
}

async function boot() {
  // Placed and shown while the editor builds itself.
  if (isApp) initWindow(invoke, storage);
  const settings = createSettingsStore(storage, keyVault);
  const applyTheme = () => {
    const t = settings.get().appearance.theme;
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.dataset.theme = t;
  };
  settings.subscribe(applyTheme);
  applyTheme();
  document.documentElement.classList.toggle('in-app', isApp);

  const store = createStore(await openLast());
  const host = createHost();
  const rawPrefs = readPrefs();
  const prefs = new Proxy(rawPrefs, {
    set(target, k, v) { target[k] = v; try { storage.setItem(UI_KEY, JSON.stringify(target)); } catch { /* a convenience only */ } return true; },
  });

  // ---- saving ------------------------------------------------------------------
  let savedAt = 0;
  const save = debounce(async () => {
    const { project } = store.get();
    if (project.updated <= savedAt) return;
    try {
      await projects.write(project.id, project.scene.title, JSON.stringify(project));
      savedAt = project.updated;
      storage.setItem(LAST_KEY, project.id);
    } catch (err) {
      toast(`The film could not be saved: ${err.message || err}`, 'error');
    }
  }, 1200);
  store.on('project', () => save());
  document.addEventListener('visibilitychange', () => { if (document.hidden) save.flush(); });
  window.addEventListener('pagehide', () => save.flush());

  // ---- panels --------------------------------------------------------------------
  const openSettings = (section) => openSettingsDialog({ settings, section: typeof section === 'string' ? section : 'model' });
  const player = createPlayer({ store, host, prefs, onTemplates: () => openTemplates() });
  const timeline = createTimeline({ store, player, prefs });
  // A version for another frame shape opens as a film of its own.
  const onVersion = async (aspect) => {
    try {
      const version = await makeVersion(store.get().project, aspect, newProjectId);
      save.flush();
      store.load(version);
      storage.setItem(LAST_KEY, version.id);
      save();
      toast(`${version.scene.title} is open. The film it came from is in Films.`);
    } catch (err) { toast(err.message || String(err), 'error'); }
  };
  const inspector = createInspector({ store, onVersion, settings });
  const progress = createProgress();
  // The chat's attach button imports through the Media panel, made below.
  let mediaPanel = null;
  const director = createDirectorPanel({ store, settings, openSettings, progress, onAttach: (opts) => mediaPanel.importFiles(opts), onDetach: (key) => mediaPanel.remove(key) });

  const titleInput = h('input', { class: 'film-title', type: 'text', maxlength: '120', 'aria-label': 'Film title', spellcheck: 'false' });
  titleInput.value = store.get().project.scene.title;
  titleInput.addEventListener('change', () => store.edit((doc) => { doc.title = titleInput.value.trim() || 'Untitled film'; }));
  titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') titleInput.blur(); });

  const undoBtn = iconButton(ICONS.undo, 'Undo', () => store.undo());
  const redoBtn = iconButton(ICONS.redo, 'Redo', () => store.redo());
  const paintHistory = () => { undoBtn.disabled = !store.canUndo(); redoBtn.disabled = !store.canRedo(); };

  // A film just deleted is not saved again on the way out.
  const startFresh = ({ discard = false } = {}) => {
    if (!discard) save.flush();
    store.load(normalizeProject({}, newProjectId));
    storage.setItem(LAST_KEY, store.get().project.id);
  };
  // A film made from a template opens as a new film; the one open now is kept.
  const fromTemplate = (film) => {
    save.flush();
    store.load(normalizeProject({ brief: film.brief, storyboard: film.storyboard, scene: film.scene, tier: 'guided', take: film.take }, newProjectId));
    storage.setItem(LAST_KEY, store.get().project.id);
  };
  const openTemplates = () => openTemplatesDialog({ onUse: fromTemplate });
  const openFilm = async (id) => {
    save.flush();
    try {
      store.load(normalizeProject(JSON.parse(await projects.read(id)), newProjectId));
      storage.setItem(LAST_KEY, id);
    } catch (err) { toast(err.message || String(err), 'error'); }
  };

  // The bar drags the window in the desktop app, wherever it has no control.
  const topbar = h('header', { class: 'topbar', 'data-tauri-drag-region': true },
    h('div', { class: 'brand', 'data-tauri-drag-region': true }, h('span', { class: 'brand-name', text: 'Hash LMG', 'data-tauri-drag-region': true })),
    iconButton(ICONS.plus, 'New film', () => startFresh()),
    iconButton(ICONS.open, 'Films', () => openProjectsDialog({ currentId: store.get().project.id, onOpen: openFilm, onNew: startFresh, onTemplates: openTemplates })),
    iconButton(ICONS.templates, 'Start from a template', openTemplates),
    titleInput,
    progress.label,
    h('span', { class: 'spacer', 'data-tauri-drag-region': true }),
    undoBtn, redoBtn,
    h('span', { class: 'divider' }),
    iconButton(ICONS.settings, 'Settings', openSettings),
    h('button', { class: 'secondary-btn export-btn', type: 'button', 'aria-label': 'Export', onclick: () => openExportDialog({ store, settings, playhead: () => store.get().time }) }, h('span', { html: ICONS.export }), h('span', { class: 'export-word', text: 'Export' })),
    director.makeBtn,
    progress.bar);

  // The left column: the director, or the film's media, by tab.
  mediaPanel = createMediaPanel({ store });
  // Files dropped anywhere on the window join the film's media.
  const veil = h('div', { class: 'drop-veil', hidden: true }, h('div', { class: 'drop-veil-text', text: 'Drop to add to the film and the conversation' }));
  document.body.append(veil);
  media.onDrop({
    onDrag: (over) => { veil.hidden = !over; },
    onDrop: async (items) => {
      if (!items.length) { toast('Only footage, pictures, sound and text files can be added to a film.'); return; }
      // What was dropped waits as attachments to the next message to the director.
      const added = await mediaPanel.addItems(items);
      if (added.length) { showSide('director'); director.attach(added); }
    },
  });
  const tabs = h('div', { class: 'panel-head side-tabs', role: 'tablist' });
  const showSide = (which) => {
    director.el.hidden = which !== 'director';
    mediaPanel.show(which === 'media');
    clear(tabs).append(...[['director', 'Director'], ['media', 'Media']].map(([k, label]) => h('button', { type: 'button', role: 'tab', class: `side-tab${k === which ? ' on' : ''}`, 'aria-selected': String(k === which), text: label, onclick: () => showSide(k) })));
  };
  director.el.classList.remove('director');
  director.el.classList.add('side-panel');
  const side = h('div', { class: 'director' }, tabs, director.el, mediaPanel.el);
  showSide('director');
  const workspace = h('main', { class: 'workspace' }, side, player.el, inspector.el, timeline.el);
  document.body.append(topbar, workspace);

  store.on('history', paintHistory);
  store.on('project', () => {
    if (document.activeElement !== titleInput) titleInput.value = store.get().project.scene.title;
  });
  paintHistory();

  // ---- keys ------------------------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable]');
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); store.redo(); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save.flush(); toast('Saved'); return; }
    if (typing || mod || e.altKey) return;
    if (e.target.closest && e.target.closest('.scrim')) return;
    if (e.key === ' ') { e.preventDefault(); player.toggle(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); player.step(e.shiftKey ? -10 : -1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); player.step(e.shiftKey ? 10 : 1); }
    else if (e.key === 'Home') { e.preventDefault(); player.seek(0); }
    else if (e.key === 'End') { e.preventDefault(); player.seek(store.get().project.scene.duration); }
    else if (e.key === 's' || e.key === 'S') { e.preventDefault(); timeline.split(); }
    else if (e.key === 'Escape') store.select(null);
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); inspector.deleteSelected(); }
  });

  if (!settings.get().model.model) setTimeout(() => toast('Choose a model at the top of the director panel to make a film.'), 600);
}

boot().catch((err) => {
  document.body.textContent = '';
  document.body.append(h('div', { class: 'boot-error' }, h('h1', { text: 'Hash LMG could not start' }), h('p', { text: err.message || String(err) })));
});
