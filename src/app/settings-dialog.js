// Settings: which model makes the film and how, looking things up, the voice,
// the model servers on this computer, the keys for cloud services, how the
// editor looks, the run history and About. A rail of sections in three
// groups on the left; each page opens with what it is for, its settings in
// cards. Every change is saved as it is made.
//
// "This computer" walks through running a model locally and checks each step
// for real: a step reads done only because Ollama answered at the configured
// address. Nothing here installs or downloads; commands are shown for the
// person to run, with a button to copy them.

import { h, clear, dialog, toast } from './dom.js';
import { ICONS } from './icons.js';
import { field, section, select, segmented, toggle, textButton } from './fields.js';
import { PROVIDERS, LOCAL_IDS, CLOUD_IDS } from '../core/providers/catalog.js';
import { modelProfile, parseModelList, defaultModel } from '../core/providers/models.js';
import { listModels } from '../core/providers/client.js';
import { KEEP_CHOICES, probeLocal, sizeText } from '../core/providers/local.js';
import { openExternal, fetchFor, RELAYED, isApp } from '../platform/index.js';
import { createHistoryPane } from './history-pane.js';
import { createVoicePane } from './voice-pane.js';
import { aboutPane } from './about-pane.js';

const SIZE_WORDS = { small: 'small', medium: 'mid-size', large: 'large', frontier: 'frontier' };
const TIER_WORDS = { guided: 'Guided', plan: 'Plan', code: 'Code' };
const GROUPS = [
  ['Making films', [['model', 'Model', 'chip'], ['web', 'Looking things up', 'search'], ['voice', 'Voice', 'voice']]],
  ['Where models run', [['local', 'This computer', 'monitor'], ['keys', 'Cloud keys', 'key']]],
  ['The app', [['look', 'Appearance', 'contrast'], ['history', 'Run history', 'history'], ['about', 'About', 'info']]],
];
const SECTIONS = GROUPS.flatMap(([, list]) => list);
// What each page is for, under its title.
const PURPOSE = {
  model: 'The model that writes your films, and how much of the work it is given.',
  web: 'Facts the model does not know, looked up on the web with your yes.',
  voice: 'The voice that speaks the narration.',
  local: 'Running a model on this computer, step by step.',
  keys: 'Your keys for cloud models and web search, kept on this computer.',
  look: 'How the editor looks.',
  history: 'Every film made and change asked for, with each question to the model.',
  about: null,
};
// Models worth starting with on Ollama, smallest first.
const STARTERS = [
  ['qwen2.5:3b', 'Small and quick, about 2 GB'],
  ['gemma3:4b', 'Small, and can see pictures, about 3 GB'],
  ['qwen2.5:7b', 'Better writing, about 5 GB'],
];


function copyButton(text) {
  return textButton('Copy', async (e) => {
    try { await navigator.clipboard.writeText(text); toast('Copied'); } catch {
      const code = e.target.closest('.command')?.querySelector('code');
      if (code) { const r = document.createRange(); r.selectNodeContents(code); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
      toast('Selected. Copy it with your keyboard.');
    }
  });
}
const command = (text) => h('div', { class: 'command' }, h('code', { text }), copyButton(text));
// A link to a service's own page, opened in the system browser.
const hostOf = (url) => { try { return new URL(url).host.replace(/^www\./, ''); } catch { return url; } };
function webLink(url, text = hostOf(url)) {
  return h('a', { class: 'web-link', href: url, onclick: (e) => { e.preventDefault(); openExternal(url); } }, h('span', { text }), h('span', { class: 'web-link-icon', html: ICONS.external }));
}
const statusDot = (state) => h('span', { class: `status ${state}`, html: state === 'ok' ? ICONS.check : state === 'bad' ? ICONS.cross : ICONS.ring });

export function openSettingsDialog({ settings, section: start = 'model' }) {
  const d = dialog({ title: 'Settings', wide: true });
  d.el.classList.add('settings');
  const rail = h('nav', { class: 'settings-rail', 'aria-label': 'Settings sections' });
  const pane = h('div', { class: 'settings-pane' });
  d.body.append(h('div', { class: 'settings-layout' }, rail, pane));
  let current = SECTIONS.some(([k]) => k === start) ? start : 'model';
  const historyPane = createHistoryPane();
  const voicePane = createVoicePane({ settings, repaint: () => { if (current === 'voice') paint(); }, command });
  let models = [];
  let loading = null;
  const probes = {};

  function paintRail() {
    clear(rail).append(...GROUPS.flatMap(([group, list]) => [
      h('div', { class: 'rail-group', text: group }),
      ...list.map(([k, label, icon]) => {
        const b = h('button', { type: 'button', class: k === current ? 'on' : '', 'aria-current': k === current ? 'page' : null }, h('span', { class: 'rail-icon', html: ICONS[icon] }), h('span', { text: label }));
        b.addEventListener('click', () => { current = k; paint(); if (k === 'local') probeAll(); });
        return b;
      }),
    ]));
  }

  function paint() {
    paintRail();
    const s = settings.get();
    const [, title] = SECTIONS.find(([k]) => k === current);
    const head = PURPOSE[current] === null ? [] : [h('header', { class: 'pane-head' }, h('h2', { class: 'pane-title', text: title }), h('p', { class: 'pane-purpose', text: PURPOSE[current] }))];
    clear(pane).append(...head, ...({ model: modelPane, web: webPane, local: localPane, keys: keysPane, look: lookPane, history: () => historyPane(), voice: () => voicePane(), about: aboutPane }[current])(s));
    pane.scrollTop = 0;
  }

  // ---- model ------------------------------------------------------------------
  function modelPane(s) {
    const id = s.model.provider;
    const p = PROVIDERS[id];
    const service = h('select', { class: 'input select' });
    const group = (label, ids) => h('optgroup', { label }, ...ids.map((x) => { const o = h('option', { value: x, text: PROVIDERS[x].label }); if (x === id) o.selected = true; return o; }));
    service.append(group('On this computer', LOCAL_IDS), group('In the cloud, with your own key', CLOUD_IDS));
    service.addEventListener('change', () => { models = []; settings.update({ model: { provider: service.value, model: settings.get().model.recent[service.value] || '' } }); paint(); refresh(); });

    const listId = `models-${id}`;
    const modelInput = h('input', { class: 'input', type: 'text', list: listId, value: s.model.model, placeholder: 'Model name', spellcheck: 'false' });
    const remember = (model) => settings.update({ model: { model, recent: { ...settings.get().model.recent, [settings.get().model.provider]: model } } });
    modelInput.addEventListener('change', () => { remember(modelInput.value.trim()); paint(); });
    const options = h('datalist', { id: listId }, ...models.map((m) => h('option', { value: m.id, text: describeModel(m) })));
    const meta = (models.find((m) => m.id === s.model.model) || {}).meta || {};
    const prof = s.model.model ? modelProfile(id, s.model.model, meta) : null;
    const about = prof
      ? `${prof.params ? `About ${prof.params < 1 ? prof.params.toFixed(1) : Math.round(prof.params)}B parameters, ` : ''}${SIZE_WORDS[prof.size]}. Suggested way of working: ${TIER_WORDS[prof.tier]}.${prof.vision ? ' It can see pictures, so it can review stills.' : ''}`
      : 'Choose a model, or type its name.';
    const keyLine = p.kind === 'cloud'
      ? h('div', { class: 'field-hint' }, settings.hasKey(id) ? `Your ${p.label} key is saved. ` : `Add your ${p.label} key under Cloud keys first. Get one at `, settings.hasKey(id) ? null : webLink(p.keyUrl), settings.hasKey(id) ? null : ' ', textButton('Cloud keys', () => { current = 'keys'; paint(); }))
      : h('div', { class: 'field-hint' }, 'Runs on this computer. Set it up under This computer. ', textButton('This computer', () => { current = 'local'; paint(); probeAll(); }));

    return [section('Who makes the film',
      field('Service', service),
      keyLine,
      field('Model', h('div', { class: 'row' }, modelInput, textButton(loading ? 'Looking' : 'Refresh', () => refresh())), about),
      options,
      models.length ? h('ul', { class: 'model-list' }, ...models.slice(0, 40).map((m) => {
        const b = h('button', { type: 'button', class: m.id === s.model.model ? 'on' : '' }, h('span', { class: 'model-id', text: m.id }), h('span', { class: 'model-meta', text: describeModel(m) }));
        b.addEventListener('click', () => { remember(m.id); paint(); });
        return h('li', {}, b);
      })) : null),
    section('How each film is made',
      field('Storyboards to choose from', segmented(String(s.model.drafts), [['1', 'One'], ['2', 'Two'], ['3', 'Three']], (v) => { settings.update({ model: { drafts: Number(v) } }); paint(); }),
        'Guided way of working. The model writes this many storyboards and the app keeps the cleanest; each takes about as long as one.'),
      field('Brief', toggle(s.model.verify, (v) => settings.update({ model: { verify: v } }), 'Check the finished film against what the brief asks to see, and fix what is missing once')),
      field('Music', toggle(s.model.compose, (v) => settings.update({ model: { compose: v } }), 'Let the model compose the music for each film, written as code and played by the app\u2019s instruments')),
      field('Review', toggle(s.model.review, (v) => settings.update({ model: { review: v } }), 'Let a model that can see review stills and ask for changes once')))];
  }

  // ---- looking things up ------------------------------------------------------------
  function webPane(s) {
    return [section('Asking first',
      field('When the model wants to', segmented(s.model.research, [['ask', 'Ask me first'], ['never', 'Never look things up']], (v) => { settings.update({ model: { research: v } }); paint(); }),
        isApp ? 'Before the storyboard, or when you ask in the conversation, the model may want to look up facts it does not know or read a page you named. You see each search and each page and say yes or no first, and choose whether the top pages a search finds are read too.' : 'Looking things up on the web needs the desktop app.')),
    section('Where searches go',
      h('p', { class: 'insp-note', text: 'With a Tavily key under Cloud keys, searches go to Tavily. Without one, they go to DuckDuckGo\u2019s results from the whole web, and to Wikipedia when that finds nothing. Pages are read straight from their own sites, only from public addresses.' }),
      h('div', { class: 'button-row' }, textButton('Cloud keys', () => { current = 'keys'; paint(); })))];
  }

  function describeModel(m) {
    const bits = [m.meta?.parameterSize, m.meta?.quantization, sizeText(m.meta?.bytes)].filter(Boolean);
    return bits.join(', ');
  }

  async function refresh() {
    const s = settings.get();
    const id = s.model.provider;
    if (PROVIDERS[id].kind === 'cloud' && !settings.hasKey(id)) { models = []; if (current === 'model') paint(); return; }
    const mine = loading = {};
    if (current === 'model') paint();
    try {
      const list = await listModels(id, { key: settings.key(id), keyHeld: settings.keyHeld(), base: settings.base(id), fetch: fetchFor(id) });
      if (loading !== mine || settings.get().model.provider !== id) return;
      models = list;
      if (!settings.get().model.model && list.length) settings.update({ model: { model: defaultModel(id, list) } });
    } catch (err) {
      if (loading === mine) toast(err.message || String(err), 'error');
      models = [];
    } finally {
      if (loading === mine) { loading = null; if (current === 'model') paint(); }
    }
  }

  // ---- this computer -----------------------------------------------------------
  async function probeAll() {
    await Promise.all(LOCAL_IDS.map(async (id) => {
      const p = PROVIDERS[id];
      const r = await probeLocal(settings.base(id) + p.modelsPath, fetchFor(id));
      probes[id] = { ...r, models: r.ok ? parseModelList(id, r.json) : [] };
    }));
    if (current === 'local') paint();
  }

  function localPane(s) {
    const ol = probes.ollama;
    const running = ol?.running && ol.ok;
    const hasModels = running && ol.models.length > 0;
    const chosen = s.model.provider === 'ollama' && hasModels && ol.models.some((m) => m.id === s.model.model);
    const step = (state, title, body) => h('li', { class: 'step' }, statusDot(state), h('div', {}, h('div', { class: 'step-title', text: title }), body));
    const port = (id) => {
      const input = h('input', { class: 'input num', type: 'number', min: '1', max: '65535', value: String(s.local.ports[id]) });
      input.addEventListener('change', () => { settings.update({ local: { ports: { ...settings.get().local.ports, [id]: Number(input.value) } } }); probeAll(); });
      return input;
    };
    const ollamaSteps = h('ol', { class: 'steps' },
      step(running ? 'ok' : ol ? 'bad' : 'wait', 'Install Ollama', h('div', { class: 'field-hint' }, 'Free, from ollama.com, for macOS, Windows and Linux. ', textButton('Open ollama.com', () => openExternal('https://ollama.com/download')))),
      step(running ? 'ok' : ol ? 'bad' : 'wait', 'Start it', h('div', { class: 'field-hint', text: running ? `Ollama is answering on port ${s.local.ports.ollama}.` : ol ? `Nothing answered on port ${s.local.ports.ollama}. Open the Ollama app, or run "ollama serve".` : 'Checking.' })),
      step(hasModels ? 'ok' : running ? 'bad' : 'wait', 'Download a model', h('div', {},
        h('div', { class: 'field-hint', text: hasModels ? `${ol.models.length} model${ol.models.length === 1 ? '' : 's'} ready.` : 'Run one of these in Terminal:' }),
        ...(hasModels ? [] : STARTERS.map(([m, note]) => h('div', { class: 'starter' }, command(`ollama pull ${m}`), h('span', { class: 'field-hint', text: note })))))),
      step(chosen ? 'ok' : hasModels ? 'bad' : 'wait', 'Choose it', h('div', { class: 'field-hint' },
        chosen ? `Using ${s.model.model}.` : 'Pick one of your models. ',
        chosen ? null : textButton('Use Ollama', () => { settings.update({ model: { provider: 'ollama', model: ol?.models[0]?.id || '' } }); current = 'model'; models = ol?.models || []; paint(); }))));

    const others = LOCAL_IDS.filter((id) => id !== 'ollama').map((id) => {
      const pr = probes[id];
      const state = pr ? (pr.ok ? 'ok' : 'bad') : 'wait';
      const text = pr ? (pr.ok ? `Answering, ${pr.models.length} model${pr.models.length === 1 ? '' : 's'}.` : pr.running ? 'Answering, but would not list its models.' : 'Not running.') : 'Checking.';
      return h('div', { class: 'local-row' }, statusDot(state), h('div', { class: 'local-name', text: PROVIDERS[id].label }), h('div', { class: 'field-hint', text }), port(id));
    });

    return [
      section('Ollama', ollamaSteps, h('div', { class: 'button-row' }, textButton('Check again', () => probeAll()))),
      section('How Ollama runs the model',
        field('Port', port('ollama')),
        field('Runs on', segmented(s.local.device, [['auto', 'Automatic'], ['cpu', 'Processor'], ['gpu', 'Graphics chip']], (v) => { settings.update({ local: { device: v } }); paint(); }),
          'Automatic puts as much as fits on the graphics chip. Processor leaves the graphics chip free for other work. Graphics chip is fastest when the model fits. A change reloads the model on its next answer.'),
        field('When the film is made', toggle(s.local.unload, (v) => { settings.update({ local: { unload: v } }); paint(); }, 'Unload the model to free the graphics chip and memory')),
        field('While a film is being made', select(s.local.keep, KEEP_CHOICES, (v) => settings.update({ local: { keep: v } })),
          'How long the model stays loaded between its answers. Longer answers the next question sooner.')),
      section('Other model apps on this computer', ...others,
        h('div', { class: 'field-hint', text: isApp && RELAYED.has('lmstudio') ? 'LM Studio: start its local server; the app asks it directly, with no switch to turn on. They choose the processor or graphics chip themselves when a model is loaded.' : 'LM Studio: start its local server, and turn on Enable CORS in its server settings so this page may ask it. They choose the processor or graphics chip themselves when a model is loaded.' })),
    ];
  }

  // ---- keys ---------------------------------------------------------------------------
  // One row a service: its name with a link straight to the page where its
  // keys are made, the key field, and a check that asks the service for its
  // models with the key, which proves the key works without making a film.
  let filter = '';
  const checks = {};
  async function checkKey(id) {
    checks[id] = { state: 'wait', text: 'Checking' };
    paint();
    try {
      const list = await listModels(id, { key: settings.key(id), keyHeld: settings.keyHeld(), fetch: fetchFor(id) });
      checks[id] = { state: 'ok', text: `Works. ${list.length} model${list.length === 1 ? '' : 's'} offered.` };
    } catch (err) {
      checks[id] = { state: 'bad', text: err.message || String(err) };
    }
    if (current === 'keys') paint();
  }

  function keysPane() {
    const search = h('input', { class: 'input key-search', type: 'search', placeholder: 'Find a service', value: filter, spellcheck: 'false', 'aria-label': 'Find a service' });
    search.addEventListener('input', () => { filter = search.value; for (const row of pane.querySelectorAll('.key-row')) row.hidden = !row.dataset.name.includes(filter.trim().toLowerCase()); });
    const services = [...CLOUD_IDS.map((id) => ({ id, ...PROVIDERS[id], models: true })), { id: 'tavily', label: 'Tavily, for web search (optional)', keyUrl: 'https://app.tavily.com/home', models: false }];
    const rows = services.map((p) => {
      const id = p.id;
      const saved = settings.hasKey(id);
      const check = checks[id];
      const hint = settings.keyHint(id);
      const input = h('input', { class: 'input', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: saved ? `Saved${hint && hint !== 'saved' ? `, ${hint}` : ''}. Paste a new key to replace it.` : 'Paste your key', 'aria-label': `${p.label} key` });
      input.addEventListener('change', async () => {
        const value = input.value.trim();
        input.value = '';
        if (!value) return;
        try { await settings.setKey(id, value); } catch (err) { toast(err.message || String(err), 'error'); return; }
        toast(`${p.label} key saved`);
        if (p.models) checkKey(id);
      });
      const row = h('div', { class: 'key-row', dataset: { name: p.label.toLowerCase() } },
        h('div', { class: 'key-head' },
          statusDot(check ? check.state : saved ? 'ok' : 'wait'),
          h('span', { class: 'key-name', text: p.label }),
          h('span', { class: 'key-link' }, saved ? null : 'Get a key at ', webLink(p.keyUrl))),
        h('div', { class: 'key-field' }, input,
          saved && p.models ? textButton(check?.state === 'wait' ? 'Checking' : 'Check', () => checkKey(id)) : null,
          saved ? textButton('Forget', async () => { try { await settings.setKey(id, ''); } catch (err) { toast(err.message || String(err), 'error'); } delete checks[id]; paint(); }, 'danger') : null),
        check && check.state !== 'wait' ? h('div', { class: `field-hint key-check ${check.state}`, text: check.text }) : null);
      row.hidden = Boolean(filter.trim()) && !row.dataset.name.includes(filter.trim().toLowerCase());
      return row;
    });
    return [section('Cloud keys',
      h('p', { class: 'insp-note', text: settings.keyHeld()
        ? 'Each key is kept on this computer by the app, in a file only your account can read, apart from your other settings. Once saved, a key is never shown again, even to the app\u2019s own window: only its last four characters. It is sent only to the service it belongs to. Each link opens that service\u2019s key page in your browser.'
        : 'In a browser, each key is kept in this page\u2019s own storage, apart from your other settings, and is not encrypted. The desktop app keeps keys in a file only your account can read. Each key is sent only to the service it belongs to.' }),
      search,
      h('div', { class: 'key-list' }, ...rows))];
  }

  // ---- appearance ------------------------------------------------------------
  function lookPane(s) {
    return [section('Appearance',
      field('Theme', segmented(s.appearance.theme, [['system', 'Match the system'], ['dark', 'Dark'], ['light', 'Light']], (v) => { settings.update({ appearance: { theme: v } }); paint(); })))];
  }

  paint();
  refresh();
  if (current === 'local') probeAll();
  return d;
}
