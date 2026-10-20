// The director panel: the brief, the few choices that shape the film, the
// model's progress step by step, and a box to ask for a change afterwards.
//
// It runs src/core/director/pipeline.js with the real model and a render host
// of its own, so checking stills never disturbs the preview. Stop aborts the
// model's answer in flight; whatever was finished before stays in the project.

import { h, clear, iconButton, toast } from './dom.js';
import { ICONS } from './icons.js';
import { createDirector } from '../core/director/pipeline.js';
import { ask } from '../core/providers/client.js';
import { PROVIDERS } from '../core/providers/catalog.js';
import { modelProfile } from '../core/providers/models.js';
import { createHost, contactSheet } from '../render/host.js';
import { sampleTimes } from '../core/scene/lint.js';
import { ASPECTS, STYLE_PACKS, STYLE_NAMES } from '../core/scene/format.js';
import { select, toggle, ASPECT_SHORT } from './fields.js';

const LENGTHS = [15, 30, 45, 60, 90, 120];
const TIER_SHORT = { guided: 'Guided', plan: 'Plan', code: 'Code' };
const TIER_HELP = {
  guided: 'The model writes the story; the app designs, times and scores it.',
  plan: 'The model designs every scene; the app checks it and sends back what is wrong.',
  code: 'The model writes its own animation code, run with no network or storage.',
};

export function createDirectorPanel({ store, settings, openSettings }) {
  const brief = h('textarea', { class: 'input textarea brief', rows: '3', maxlength: '4000', placeholder: 'Describe the film: what it is for, who will watch it, and what it must say.', 'aria-label': 'Brief' });
  brief.value = store.get().project.brief;
  const keepBrief = () => { if (brief.value !== store.get().project.brief) store.patch({ brief: brief.value }, { record: false }); };
  let briefTimer = 0;
  brief.addEventListener('input', () => { clearTimeout(briefTimer); briefTimer = setTimeout(keepBrief, 600); });
  brief.addEventListener('change', keepBrief);

  const options = h('div', { class: 'dir-options' });
  const modelLine = h('button', { class: 'model-line', type: 'button', title: 'Choose the model in Settings', onclick: () => openSettings('model') });
  const tierHelp = h('div', { class: 'field-hint' });
  const makeBtn = h('button', { class: 'primary-btn wide', type: 'button' });
  const log = h('ol', { class: 'dir-log', 'aria-live': 'polite' });
  const live = h('div', { class: 'dir-live' });
  const askBox = h('textarea', { class: 'input textarea ask', rows: '2', maxlength: '1000', placeholder: 'Ask for a change', 'aria-label': 'Ask for a change' });
  const askBtn = iconButton(ICONS.send, 'Send the change', () => change(), 'send-btn');
  askBox.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); change(); } });

  const el = h('aside', { class: 'director', 'aria-label': 'Director' },
    h('div', { class: 'panel-head' }, h('span', { class: 'panel-title', text: 'Director' })),
    h('div', { class: 'dir-body' },
      h('div', { class: 'dir-block' }, brief, options, modelLine, tierHelp, makeBtn),
      h('div', { class: 'dir-block grow' }, h('div', { class: 'dir-log-head', text: 'Progress' }), log, live)),
    h('div', { class: 'dir-ask' }, askBox, askBtn));

  let running = null; // AbortController while the model works

  // ---- the choices ----------------------------------------------------------
  function profile() {
    const m = settings.get().model;
    return m.model ? modelProfile(m.provider, m.model) : null;
  }
  function tier() {
    const m = settings.get().model;
    if (m.tier !== 'auto') return m.tier;
    return profile()?.tier || 'guided';
  }

  function paintOptions() {
    const f = settings.get().film;
    const m = settings.get().model;
    const p = profile();
    const setFilm = (patch) => settings.update({ film: patch });
    clear(options).append(
      h('div', { class: 'field-pair' },
        labelled('Length', select(String(f.seconds), LENGTHS.map((s) => [String(s), s < 60 ? `${s} seconds` : `${s / 60} minute${s > 60 ? 's' : ''}`]), (v) => setFilm({ seconds: Number(v) }))),
        labelled('Format', select(f.aspect, Object.keys(ASPECTS).map((k) => [k, ASPECT_SHORT[k] || k]), (v) => setFilm({ aspect: v })))),
      h('div', { class: 'field-pair' },
        labelled('Look', select(f.style, STYLE_NAMES.map((k) => [k, STYLE_PACKS[k].label]), (v) => setFilm({ style: v }))),
        labelled('Way of working', select(m.tier, [['auto', p ? `Suggested: ${TIER_SHORT[p.tier]}` : 'Suggested'], ['guided', 'Guided'], ['plan', 'Plan'], ['code', 'Code']], (v) => settings.update({ model: { tier: v } })))),
      toggle(f.narration, (v) => setFilm({ narration: v }), 'Narration for each scene'));
    const prov = PROVIDERS[m.provider];
    clear(modelLine).append(
      h('span', { class: 'model-dot', html: ICONS.dot }),
      h('span', { class: 'model-name', text: m.model ? m.model : 'Choose a model' }),
      h('span', { class: 'model-where', text: prov ? prov.label : '' }));
    modelLine.classList.toggle('missing', !m.model);
    tierHelp.textContent = TIER_HELP[tier()];
  }

  function labelled(label, control) {
    return h('label', { class: 'field' }, h('span', { class: 'field-label', text: label }), control);
  }

  function paintButtons() {
    const busy = Boolean(running);
    clear(makeBtn).append(h('span', { html: busy ? ICONS.stop : ICONS.spark }), h('span', { text: busy ? 'Stop' : 'Make the film' }));
    makeBtn.classList.toggle('stop', busy);
    askBox.disabled = busy;
    askBtn.disabled = busy;
    brief.disabled = busy;
  }

  // ---- the log ----------------------------------------------------------------
  const rows = new Map();
  function logEntry({ id, title, status, detail }) {
    if (status === 'note') {
      const host = rows.get(id)?.notes || log;
      host.append(h('li', { class: 'dir-note', text: detail }));
      log.scrollTop = log.scrollHeight;
      return;
    }
    let r = rows.get(id);
    if (!r || (status === 'run' && r.status !== 'run')) {
      const notes = h('ul', { class: 'dir-notes' });
      const icon = h('span', { class: 'dir-icon' });
      const text = h('span', { class: 'dir-title', text: title });
      const li = h('li', { class: 'dir-step' }, icon, text, notes);
      log.append(li);
      r = { li, icon, text, notes, status };
      rows.set(id, r);
    }
    r.status = status;
    r.li.dataset.status = status;
    r.icon.innerHTML = status === 'done' ? ICONS.check : status === 'fail' ? ICONS.cross : ICONS.ring;
    if (status === 'fail' && detail) r.notes.append(h('li', { class: 'dir-note fail', text: detail }));
    log.scrollTop = log.scrollHeight;
  }

  function resetLog(first) {
    rows.clear();
    clear(log);
    live.textContent = '';
    if (first) log.append(h('li', { class: 'dir-note', text: first }));
  }

  // ---- running the model ------------------------------------------------------
  function makeDirector(signal) {
    const s = settings.get();
    const m = s.model;
    const host = createHost();
    const prep = async ({ scene, code }) => { await host.setScene(scene); await host.setCode(code || null); };
    const director = createDirector({
      ask: async ({ system, messages, json, schema, purpose }) => {
        live.textContent = 'Waiting for the model';
        const text = await ask({
          provider: m.provider, model: m.model, key: settings.key(m.provider), base: settings.base(m.provider),
          device: s.local.device, system, messages, json, schema,
        }, {
          fetch: (u, i) => fetch(u, i), signal,
          onText: (_, all) => { live.textContent = `Receiving the ${purpose || 'answer'}: ${all.length.toLocaleString()} characters`; },
        });
        live.textContent = '';
        return text;
      },
      measure: async (target, times) => { await prep(target); return host.measure(times); },
      trial: async ({ scene, code }) => { await host.setScene(scene); return host.trial(code, sampleTimes(scene).slice(0, 4)); },
      sheet: async (target, times) => { await prep(target); return contactSheet(host, target.scene, times); },
      log: logEntry,
    });
    return { director, done: () => host.dispose() };
  }

  function ready() {
    const m = settings.get().model;
    if (!m.model) { toast('Choose a model in Settings first.'); openSettings('model'); return false; }
    if (PROVIDERS[m.provider]?.kind === 'cloud' && !settings.hasKey(m.provider)) { toast(`Add your ${PROVIDERS[m.provider].label} key in Settings first.`); openSettings('model'); return false; }
    return true;
  }

  async function make() {
    if (running) { running.abort(); return; }
    const text = brief.value.trim();
    if (!text) { toast('Describe the film first.'); brief.focus(); return; }
    if (!ready()) return;
    const s = settings.get();
    const p = profile();
    running = new AbortController();
    paintButtons();
    resetLog();
    const { director, done } = makeDirector(running.signal);
    try {
      const out = await director.make({
        brief: text, tier: tier(), style: s.film.style, aspect: s.film.aspect, seconds: s.film.seconds, fps: s.film.fps,
        narration: s.film.narration, vision: Boolean(p?.vision && s.model.review),
      });
      store.patch({ brief: text, storyboard: out.storyboard, scene: out.scene, code: out.code, tier: out.tier, edited: false });
      store.select(null);
      store.setTime(0);
      const left = out.issues.filter((i) => i.level !== 'info');
      logEntry({ id: 'end', title: left.length ? 'Made, with a few things to look at' : 'Made', status: 'done' });
      for (const i of left.slice(0, 6)) logEntry({ id: 'end', status: 'note', detail: i.message });
    } catch (err) {
      if (!err.stopped) toast(err.message || String(err), 'error');
      logEntry({ id: 'end', title: err.stopped ? 'Stopped' : 'Could not finish', status: 'fail', detail: err.stopped ? '' : err.message });
    } finally {
      done();
      running = null;
      live.textContent = '';
      paintButtons();
    }
  }

  async function change() {
    if (running) return;
    const text = askBox.value.trim();
    if (!text) return;
    if (!ready()) return;
    const project = store.get().project;
    const s = settings.get();
    running = new AbortController();
    paintButtons();
    resetLog(`Change: ${text}`);
    const { director, done } = makeDirector(running.signal);
    try {
      const out = await director.edit(project, text, { seconds: s.film.seconds, narration: s.film.narration });
      store.patch({ storyboard: out.storyboard, scene: out.scene, code: out.code });
      askBox.value = '';
      logEntry({ id: 'end', title: 'Changed', status: 'done' });
    } catch (err) {
      if (!err.stopped) toast(err.message || String(err), 'error');
      logEntry({ id: 'end', title: err.stopped ? 'Stopped' : 'Nothing was changed', status: 'fail', detail: err.stopped ? '' : err.message });
    } finally {
      done();
      running = null;
      paintButtons();
    }
  }

  makeBtn.addEventListener('click', make);
  settings.subscribe(paintOptions);
  store.on('project', () => { if (document.activeElement !== brief && brief.value !== store.get().project.brief) brief.value = store.get().project.brief; });

  paintOptions();
  paintButtons();
  resetLog('Write a brief, choose a model, and make the film. Every step shows here.');
  return { el, busy: () => Boolean(running) };
}
