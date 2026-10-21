// The director panel: the brief, the few choices that shape the film, and a
// box to ask for a change afterwards. Each step of the making shows on the
// loading bar under the top bar, and what is worth knowing about the result
// (what the checks fixed, what is left to look at, where the model ran) is
// kept with the bar's last message, shown when the pointer rests on it.
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
import { createModelSession } from './model-session.js';

const LENGTHS = [15, 30, 45, 60, 90, 120];

// The share of the bar each step takes, by way of working: the model writing
// is most of the wait.
const PLANS = {
  guided: [['story', 6], ['intent', 1], ['layout', 1], ['check', 2], ['verify', 1]],
  plan: [['story', 3], ['intent', 1], ['layout', 1], ['design', 5], ['check', 2], ['revise', 2], ['verify', 1], ['review', 1]],
  code: [['story', 3], ['intent', 1], ['layout', 1], ['design', 6], ['check', 1], ['revise', 2], ['verify', 1], ['review', 1]],
  edit: [['edit', 7], ['check', 3]],
};
// About how long a typical answer of each kind is, in characters, so the bar
// can fill while the model writes.
// What each kind of answer is called on the loading bar.
const ANSWER_WORDS = { intent: 'list of what the brief asks for', storyboard: 'storyboard', plan: 'plan', revise: 'revised plan', edit: 'change', code: 'animation code', 'revise code': 'revised code', review: 'review', 'apply review': 'changes from the review' };
const TYPICAL = { intent: 400, storyboard: 1400, plan: 9000, revise: 9000, edit: 5000, code: 7000, 'revise code': 7000, review: 500, 'apply review': 8000 };
const TIER_SHORT = { guided: 'Guided', plan: 'Plan', code: 'Code' };
const TIER_HELP = {
  guided: 'The model writes the story; the app designs, times and scores it.',
  plan: 'The model designs every scene; the app checks it and sends back what is wrong.',
  code: 'The model writes its own animation code, run with no network or storage.',
};

export function createDirectorPanel({ store, settings, openSettings, progress }) {
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
  const askBox = h('textarea', { class: 'input textarea ask', rows: '2', maxlength: '1000', placeholder: 'Ask for a change', 'aria-label': 'Ask for a change' });
  const askBtn = iconButton(ICONS.send, 'Send the change', () => change(), 'send-btn');
  askBox.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); change(); } });

  const el = h('aside', { class: 'director', 'aria-label': 'Director' },
    h('div', { class: 'panel-head' }, h('span', { class: 'panel-title', text: 'Director' })),
    h('div', { class: 'dir-body' },
      h('div', { class: 'dir-block' }, brief, options, modelLine, tierHelp, makeBtn)),
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
        labelled('Look', select(f.style, [['auto', 'Auto'], ...STYLE_NAMES.map((k) => [k, STYLE_PACKS[k].label])], (v) => setFilm({ style: v }))),
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

  // ---- progress and what is worth knowing ---------------------------------------
  let notes = [];
  function note(text) { notes.push(text); progress.details(notes); }
  function resetNotes() { notes = []; progress.details(notes); }
  // What the director says as it works: steps move the bar, notes land here.
  function onLog({ id, title, status, detail }) {
    if (status === 'run') progress.step(id, title);
    else if (status === 'done') progress.stepDone(id);
    else if (status === 'note' && detail) note(detail);
    else if (status === 'fail' && detail) note(detail, 'fail');
  }

  // ---- running the model ------------------------------------------------------
  function makeDirector(signal) {
    const s = settings.get();
    const m = s.model;
    const host = createHost();
    const session = createModelSession(settings, (u, i) => fetch(u, i));
    let first = true;
    const prep = async ({ scene, code }) => { await host.setScene(scene); await host.setCode(code || null); };
    const director = createDirector({
      ask: async ({ system, messages, json, schema, purpose, part, temperature }) => {
        // The first question to a model on this computer waits while it loads.
        progress.say(first && session.local ? 'Loading the model' : 'Waiting for the model');
        first = false;
        const typical = TYPICAL[purpose] || 4000;
        const extra = await session.options(purpose, { system, messages });
        const text = await ask({
          provider: m.provider, model: m.model, key: settings.key(m.provider), base: settings.base(m.provider),
          device: s.local.device, system, messages, json, schema, ...extra, ...(temperature !== undefined ? { temperature } : {}),
        }, {
          fetch: (u, i) => fetch(u, i), signal,
          onThinking: () => progress.say('The model is thinking'),
          onText: (_, all) => { progress.writing(all); progress.within(part ? (part.index + Math.min(1, all.length / typical)) / part.of : all.length / typical,
            part ? `The model is writing storyboard ${part.index + 1} of ${part.of}` : `The model is writing the ${ANSWER_WORDS[purpose] || 'answer'}`); },
          onStats: (st) => session.onStats(st),
        });
        return text;
      },
      measure: async (target, times) => { await prep(target); return host.measure(times); },
      trial: async ({ scene, code }) => { await host.setScene(scene); return host.trial(code, sampleTimes(scene).slice(0, 4)); },
      sheet: async (target, times) => { await prep(target); return contactSheet(host, target.scene, times); },
      log: onLog,
    });
    // Ends a run: the render host goes, and a local model is unloaded so the
    // graphics chip is free again.
    const done = async () => {
      host.dispose();
      if (await session.release()) note('The model was unloaded to free the graphics chip.');
    };
    return { director, session, done };
  }

  // The model and the way of working, as the steps panel names them.
  function whoText(way) {
    const m = settings.get().model;
    return [m.model, PROVIDERS[m.provider]?.label, way ? TIER_SHORT[way] : null].filter(Boolean).join(' · ');
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
    resetNotes();
    const way = tier();
    progress.start(PLANS[way].map(([id, weight]) => ({ id, weight })), 'Starting', whoText(way));
    const { director, session, done } = makeDirector(running.signal);
    try {
      // Ollama says itself whether a model can see pictures; its name is the fallback.
      const caps = await session.describe();
      const vision = typeof caps.vision === 'boolean' && session.local ? caps.vision : Boolean(p?.vision);
      const out = await director.make({
        // A new take each time: the same brief made again is a new film.
        take: Math.floor(Math.random() * 1e6),
        brief: text, tier: way, style: s.film.style, aspect: s.film.aspect, seconds: s.film.seconds, fps: s.film.fps,
        narration: s.film.narration, vision: vision && s.model.review, drafts: s.model.drafts, verify: s.model.verify,
      });
      store.patch({ brief: text, storyboard: out.storyboard, scene: out.scene, code: out.code, tier: out.tier, take: out.take, edited: false });
      store.select(null);
      store.setTime(0);
      const left = out.issues.filter((i) => i.level !== 'info');
      const missing = (out.brief || []).filter((r) => !r.ok).length;
      for (const i of left.slice(0, 6)) note(i.message);
      const fit = await session.fitNote();
      if (fit) note(fit);
      progress.finish(left.length || missing ? 'Made, with a few things to look at' : 'Made');
    } catch (err) {
      if (!err.stopped) toast(err.message || String(err), 'error');
      progress.finish(err.stopped ? 'Stopped' : 'Could not finish', false);
      if (!err.stopped) note(err.message || String(err));
    } finally {
      running = null;
      paintButtons();
      await done();
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
    resetNotes();
    progress.start(PLANS.edit.map(([id, weight]) => ({ id, weight })), 'Starting the change', whoText());
    const { director, done } = makeDirector(running.signal);
    try {
      const out = await director.edit(project, text, { seconds: s.film.seconds, narration: s.film.narration });
      store.patch({ storyboard: out.storyboard, scene: out.scene, code: out.code });
      askBox.value = '';
      progress.finish('Changed');
    } catch (err) {
      if (!err.stopped) toast(err.message || String(err), 'error');
      progress.finish(err.stopped ? 'Stopped' : 'Nothing was changed', false);
      if (!err.stopped) note(err.message || String(err));
    } finally {
      running = null;
      paintButtons();
      await done();
    }
  }

  makeBtn.addEventListener('click', make);
  settings.subscribe(paintOptions);
  store.on('project', () => { if (document.activeElement !== brief && brief.value !== store.get().project.brief) brief.value = store.get().project.brief; });

  paintOptions();
  paintButtons();
  return { el, busy: () => Boolean(running) };
}
