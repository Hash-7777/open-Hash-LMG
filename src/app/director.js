// The director panel: a conversation (src/app/chat-panel.js) that asks for
// what a film needs, then makes it, and takes changes afterwards in the same
// words; the model picker above it. Each step of the making shows on the
// loading bar under the top bar, and what is worth knowing about the result
// (what the checks fixed, what is left to look at, where the model ran) is
// kept with the bar's last message, shown when the pointer rests on it.
//
// It runs src/core/director/pipeline.js with the real model and a render host
// of its own, so checking stills never disturbs the preview. Stop aborts the
// model's answer in flight; whatever was finished before stays in the project.

import { h, clear, toast } from './dom.js';
import { ICONS } from './icons.js';
import { createDirector } from '../core/director/pipeline.js';
import { ask } from '../core/providers/client.js';
import { PROVIDERS } from '../core/providers/catalog.js';
import { modelProfile } from '../core/providers/models.js';
import { createHost, contactSheet } from '../render/host.js';
import { sampleTimes } from '../core/scene/lint.js';
import { createModelSession } from './model-session.js';
import { createModelLists } from './model-lists.js';
import { createModelPicker } from './model-picker.js';
import { createRunRecord, runUsage } from '../core/director/run-record.js';
import { runs } from '../platform/runs.js';
import { appVersion, fetchFor, logUsage, web } from '../platform/index.js';
import { askToLookUp } from './web-permission.js';
import { speakLines } from './narration.js';
import { mediaFor, withMusic, previewPicture } from './film-media.js';
import { brandColours } from '../core/director/brand.js';
import { createChatPanel } from './chat-panel.js';
import { CHAT_SCHEMA, chatSystem, chatMessages, filmState, normalizeChatReply, STILL_TO_COME, ASKS_FOR_NARRATION } from '../core/director/chat.js';
import { mediaList } from '../core/scene/media.js';
import { extractJson } from '../core/util/json.js';


// The share of the bar each step takes, by way of working: the model writing
// is most of the wait.
const PLANS = {
  guided: [['story', 6], ['pictures', 3], ['intent', 1], ['layout', 1], ['check', 2], ['verify', 1], ['music', 4]],
  plan: [['story', 3], ['pictures', 3], ['intent', 1], ['layout', 1], ['design', 5], ['check', 2], ['revise', 2], ['verify', 1], ['review', 1], ['music', 4]],
  code: [['story', 3], ['intent', 1], ['layout', 1], ['design', 6], ['check', 1], ['revise', 2], ['verify', 1], ['review', 1], ['music', 4]],
  edit: [['edit', 7], ['check', 3]],
};
// About how long a typical answer of each kind is, in characters, so the bar
// can fill while the model writes.
// What each kind of answer is called on the loading bar.
const ANSWER_WORDS = { research: 'list of what to look up', intent: 'list of what the brief asks for', storyboard: 'storyboard', 'plan part': 'scene designs', 'revise part': 'fixes', pictures: 'drawings', music: 'music', 'revise music': 'music', plan: 'plan', revise: 'revised plan', edit: 'change', code: 'animation code', 'revise code': 'revised code', review: 'review', 'apply review': 'changes from the review' };
const TYPICAL = { intent: 400, storyboard: 1400, 'plan part': 3500, 'revise part': 3000, pictures: 1800, music: 5000, 'revise music': 5000, plan: 9000, revise: 9000, edit: 5000, code: 7000, 'revise code': 7000, review: 500, 'apply review': 8000 };
const TIER_SHORT = { guided: 'Guided', plan: 'Plan', code: 'Code' };
const TIER_HELP = {
  guided: 'The model writes the story and draws its pictures; the app designs, times and scores it.',
  plan: 'The model designs every scene; the app checks it and sends back what is wrong.',
  code: 'The model writes its own animation code, run with no network or storage.',
};

export function createDirectorPanel({ store, settings, openSettings, progress, onAttach, onDetach }) {
  const lists = createModelLists(settings);
  const picker = createModelPicker({ settings, lists, openSettings });
  // The main button lives in the top bar; the panel hands it over.
  const makeBtn = h('button', { class: 'primary-btn make-btn', type: 'button' });

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

  const chat = createChatPanel({
    store, settings, picker, onAttach, onDetach,
    converse: (history) => converse(history),
    onMake: (text, opts) => make(text, opts),
    onChange: (text) => change(text),
    busy: () => Boolean(running),
    tierOf: () => ({ way: tier(), suggested: profile()?.tier || null, help: TIER_HELP[tier()] }),
  });
  const el = chat.el;

  function paintButtons() {
    const busy = Boolean(running);
    // Both labels are laid one over the other and only one is shown, so the
    // button keeps its width and the top bar does not move when it turns.
    clear(makeBtn).append(h('span', { class: 'make-label' },
      h('span', { class: 'make-go', 'aria-hidden': String(busy) }, h('span', { html: ICONS.play }), h('span', { class: 'make-long', text: 'Generate the Movie' }), h('span', { class: 'make-short', text: 'Generate' })),
      h('span', { class: 'make-stop', 'aria-hidden': String(!busy) }, h('span', { html: ICONS.stop }), h('span', { text: 'Stop' }))));
    makeBtn.classList.toggle('stop', busy);
    chat.paint();
  }

  // ---- the conversation ---------------------------------------------------------
  // One turn: a short system text, the film's state, the last few messages.
  async function converse(history) {
    if (!ready()) throw Object.assign(new Error('Choose a model first.'), { stopped: true });
    const s = settings.get();
    const m = s.model;
    const project = store.get().project;
    const hasFilm = project.scene.scenes.length > 0;
    const media = mediaList(project.scene.assets);
    const session = createModelSession(settings, fetchFor(m.provider));
    const { system, own } = chatSystem({ hasFilm, media, narrationReady: s.voice.engine !== 'none' }, project.docs);
    const messages = chatMessages(history, filmState(project, s));
    // A model that sees pictures is shown the ones just attached, made small.
    const lastAttached = (history[history.length - 1]?.attachments || []).filter((a) => a.kind === 'image' && project.scene.assets[a.key]?.data).slice(0, 4);
    if (lastAttached.length && profile()?.vision && messages.length) {
      const images = (await Promise.all(lastAttached.map((a) => previewPicture(project.scene.assets[a.key].data, 512)))).filter(Boolean);
      if (images.length) messages[messages.length - 1] = { ...messages[messages.length - 1], images };
    }
    const extra = await session.options('chat', { system, messages });
    const text = await ask({
      provider: m.provider, model: m.model, key: settings.key(m.provider), keyHeld: settings.keyHeld(), base: settings.base(m.provider),
      device: s.local.device, system, messages, json: true, schema: CHAT_SCHEMA, temperature: 0.5, ...extra,
    }, { fetch: fetchFor(m.provider), onUsage: (u) => logUsage({ provider: m.provider, model: m.model, usage: u }) });
    const parsed = extractJson(text).value;
    // A short message, or any one answer, saying something is still to come
    // holds the film back.
    const lastSaid = [...history].reverse().find((x) => x.role === 'person') || {};
    const parts = lastSaid.answers?.length ? lastSaid.answers.map((a) => a.answer) : [lastSaid.text || ''];
    const waiting = parts.some((p) => STILL_TO_COME.test(p) && p.split(/\s+/).length <= 14);
    return normalizeChatReply(parsed ?? text, { hasFilm, waiting, system: own });
  }

  // ---- progress and what is worth knowing ---------------------------------------
  let notes = [];
  function note(text) { notes.push(text); progress.details(notes); if (record && !record.run.notes.some((n) => n.text === text)) record.note(text); }
  function resetNotes() { notes = []; progress.details(notes); }
  // What the director says as it works: steps move the bar, notes land here.
  let record = null; // the run history's record of the run under way
  function onLog({ id, title, status, detail }) {
    if (record) { if (status === 'note') record.note(detail); else record.step(id, title, status, detail); }
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
    const session = createModelSession(settings, fetchFor(m.provider));
    let first = true;
    const prep = async ({ scene, code }) => { await host.setScene(scene); await host.setCode(code || null); };
    const director = createDirector({
      ask: async ({ system, messages, json, schema, purpose, part, temperature }) => {
        // The first question to a model on this computer waits while it loads.
        progress.say(first && session.local ? 'Loading the model' : 'Waiting for the model');
        first = false;
        const typical = TYPICAL[purpose] || 4000;
        const extra = await session.options(purpose, { system, messages });
        const req = record ? record.ask({ purpose, system, messages, options: { ...extra, ...(temperature !== undefined ? { temperature } : {}) } }) : null;
        try {
          const text = await ask({
            provider: m.provider, model: m.model, key: settings.key(m.provider), keyHeld: settings.keyHeld(), base: settings.base(m.provider),
            device: s.local.device, system, messages, json, schema, ...extra, ...(temperature !== undefined ? { temperature } : {}),
          }, {
            fetch: fetchFor(m.provider), signal,
            onThinking: (chunk) => { req?.thinking(chunk); progress.say('The model is thinking'); },
            onText: (_, all) => { progress.writing(all); progress.within(part ? (part.index + Math.min(1, all.length / typical)) / part.of : all.length / typical,
              part ? (part.from ? `The model is writing the ${ANSWER_WORDS[purpose] || 'answer'} for scenes ${part.from} to ${part.to}` : `The model is writing storyboard ${part.index + 1} of ${part.of}`) : `The model is writing the ${ANSWER_WORDS[purpose] || 'answer'}`); },
            onStats: (st) => session.onStats(st),
            onUsage: (u) => { req?.usage(u); logUsage({ provider: m.provider, model: m.model, usage: u }); },
          });
          req?.done(text);
          return text;
        } catch (err) { req?.fail(err); throw err; }
      },
      measure: async (target, times) => { await prep(target); return host.measure(times); },
      trial: async ({ scene, code }) => { await host.setScene(scene); return host.trial(code, sampleTimes(scene).slice(0, 4)); },
      sheet: async (target, times) => { await prep(target); return contactSheet(host, target.scene, times); },
      compose: async ({ code, context }) => host.compose(code, context),
      // Nothing is looked up without the person's yes, asked each time.
      web,
      permit: async (wanted) => { progress.say('Waiting for your answer'); return askToLookUp(wanted); },
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

  // The run history: what this run used (never a key), kept when it ends.
  async function beginRecord(kind, meta) {
    const s = settings.get();
    const v = await appVersion();
    return createRunRecord({
      kind, ...meta,
      model: { provider: s.model.provider, model: s.model.model, label: PROVIDERS[s.model.provider]?.label },
      settings: { film: s.film, model: { tier: s.model.tier, drafts: s.model.drafts, verify: s.model.verify, review: s.model.review }, local: { device: s.local.device, keep: s.local.keep, unload: s.local.unload } },
      app: v ? `Hash LMG ${v}` : 'Hash LMG in a browser',
      system: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    });
  }
  function endRecord(outcome, extra) {
    if (!record) return;
    const used = runUsage(record.run);
    if (used.requests) note(`Used ${(used.input + used.cacheRead + used.output).toLocaleString('en-US')} tokens: ${used.input.toLocaleString('en-US')} read${used.cacheRead ? `, ${used.cacheRead.toLocaleString('en-US')} read from the service\u2019s cache` : ''}, ${used.output.toLocaleString('en-US')} written.`);
    record.finish(outcome, extra);
    runs.put(record.run).catch(() => {});
    record = null;
  }

  function ready() {
    const m = settings.get().model;
    if (!m.model) { toast('Choose a model first.'); picker.open(); return false; }
    if (PROVIDERS[m.provider]?.kind === 'cloud' && !settings.hasKey(m.provider)) { toast(`Add your ${PROVIDERS[m.provider].label} key in Settings first.`); openSettings('keys'); return false; }
    return true;
  }

  // Makes a film from a brief: the one the conversation just wrote, or, from
  // the top bar's button, the film's own brief.
  async function make(given, { useMedia = true } = {}) {
    if (running) { running.abort(); return; }
    const text = String(given ?? store.get().project.brief ?? '').trim();
    if (!text) { toast('Tell the director about the film first.'); chat.focus(); return; }
    if (!ready()) return;
    // A brief that asks for a voice gets one, even with narration left off.
    if (!settings.get().film.narration && ASKS_FOR_NARRATION.test(text)) {
      settings.update({ film: { narration: true } });
      chat.say('The brief asks for narration, so narration is on for this film.');
    }
    const s = settings.get();
    if (s.film.narration && s.voice.engine === 'none') chat.say('Narration needs a voice. Choose one in Settings, under Voice; the film is made with its lines ready, and they can be spoken from there.');
    const p = profile();
    running = new AbortController();
    paintButtons();
    resetNotes();
    const way = tier();
    // With narration on and a voice chosen, the lines are spoken once the film is made.
    const narrate = s.film.narration && s.voice.engine !== 'none';
    const lookUp = Boolean(web) && s.model.research === 'ask';
    progress.start([...(lookUp ? [['research', 1]] : []), ...PLANS[way], ...(narrate ? [['voice', 2]] : [])].map(([id, weight]) => ({ id, weight })), 'Starting', whoText(way));
    record = await beginRecord('make', { brief: text, tier: way });
    const { director, session, done } = makeDirector(running.signal);
    try {
      // Ollama says itself whether a model can see pictures; its name is the fallback.
      const caps = await session.describe();
      const vision = typeof caps.vision === 'boolean' && session.local ? caps.vision : Boolean(p?.vision);
      // The person's own media goes into the film; a song chosen as the music stays it.
      const own = await mediaFor(store.get().project.scene, { vision });
      // The person's text files go to the storyboard step; colours written in
      // them steer the film's palette, as a colour named in the brief does.
      const docs = store.get().project.docs;
      const colours = brandColours(docs);
      const out = await director.make({
        docs, assets: own.assets, media: useMedia ? own.media : [], mediaImages: useMedia ? own.mediaImages : [],
        // A new take each time: the same brief made again is a new film.
        take: Math.floor(Math.random() * 1e6),
        brief: colours.length && !colours.some((c) => text.toLowerCase().includes(c)) ? `${text}\nBrand colours: ${colours.join(', ')}` : text, tier: way, style: s.film.style, aspect: s.film.aspect, seconds: s.film.seconds, fps: s.film.fps,
        narration: s.film.narration, vision: vision && s.model.review, drafts: s.model.drafts, verify: s.model.verify, compose: s.model.compose && !own.music.length,
        research: lookUp,
      });
      if (own.music.length) note('Your song stays the film\u2019s music.');
      store.patch({ brief: text, storyboard: out.storyboard, scene: withMusic(out.scene, own.music), code: out.code, tier: out.tier, take: out.take, edited: false });
      store.select(null);
      store.setTime(0);
      const left = out.issues.filter((i) => i.level !== 'info');
      const missing = (out.brief || []).filter((r) => !r.ok).length;
      for (const i of left.slice(0, 6)) note(i.message);
      const fit = await session.fitNote();
      if (fit) note(fit);
      if (narrate) {
        progress.step('voice', 'Speaking the narration');
        record?.step('voice', 'Speaking the narration', 'run');
        try {
          const n = await speakLines({ store, settings, onLine: (i, of) => progress.within(i / of, `Speaking line ${i + 1} of ${of}`) });
          record?.step('voice', 'Speaking the narration', 'done');
          if (n) note(`Spoke ${n} line${n === 1 ? '' : 's'} of narration.`);
        } catch (err) {
          record?.step('voice', 'Speaking the narration', 'fail', err.message);
          note(`The narration was not spoken: ${err.message || err}`);
        }
      }
      progress.finish(left.length || missing ? 'Made, with a few things to look at' : 'Made');
      chat.say(`The film is ready: ${out.scene.scenes.length} scenes, ${Math.round(out.scene.duration)} seconds. Play it, then tell me anything to change.`, 'made');
      endRecord('done', { result: { tier: out.tier, direction: out.direction ? { style: out.direction.style, mood: out.direction.mood, palette: out.direction.palette, bpm: out.direction.bpm, score: out.direction.score } : null, scenes: out.scene.scenes.length, duration: out.scene.duration, codeChars: out.code ? out.code.length : 0, issues: out.issues.map((i) => `${i.level} ${i.code}: ${i.message}`), brief: out.brief || [] } });
    } catch (err) {
      endRecord(err.stopped ? 'stopped' : 'failed', { error: err.stopped ? null : err });
      if (!err.stopped) toast(err.message || String(err), 'error');
      progress.finish(err.stopped ? 'Stopped' : 'Could not finish', false);
      if (!err.stopped) { note(err.message || String(err)); chat.say(`The film could not be finished: ${err.message || err}`); }
    } finally {
      running = null;
      paintButtons();
      await done();
    }
  }

  async function change(given) {
    if (running) return;
    const text = String(given || '').trim();
    if (!text) return;
    if (!ready()) return;
    if (!store.get().project.scene.scenes.length) { make(); return; }
    const project = store.get().project;
    const s = settings.get();
    running = new AbortController();
    paintButtons();
    resetNotes();
    progress.start(PLANS.edit.map(([id, weight]) => ({ id, weight })), 'Starting the change', whoText());
    record = await beginRecord('change', { brief: project.brief, instruction: text, tier: project.code ? 'code' : project.tier });
    const { director, done } = makeDirector(running.signal);
    try {
      const out = await director.edit(project, text, { seconds: s.film.seconds, narration: s.film.narration });
      store.patch({ storyboard: out.storyboard, scene: out.scene, code: out.code });
      progress.finish('Changed');
      chat.say('Changed. Play it again, and tell me if anything else should change.', 'changed');
      endRecord('done', { result: { scenes: out.scene.scenes.length, duration: out.scene.duration } });
    } catch (err) {
      endRecord(err.stopped ? 'stopped' : 'failed', { error: err.stopped ? null : err });
      if (!err.stopped) toast(err.message || String(err), 'error');
      progress.finish(err.stopped ? 'Stopped' : 'Nothing was changed', false);
      if (!err.stopped) { note(err.message || String(err)); chat.say(`Nothing was changed: ${err.message || err}`); }
    } finally {
      running = null;
      paintButtons();
      await done();
    }
  }

  // The top bar's button sends what is typed in the conversation, or makes
  // the film from its brief.
  makeBtn.addEventListener('click', () => { if (!running && chat.hasDraft()) chat.send(); else make(); });
  paintButtons();
  return { el, makeBtn, busy: () => Boolean(running), say: (text) => chat.say(text), attach: (list) => chat.attach(list) };
}
