// The left panel: a conversation with the director.
//
// The person says what they want; the director asks for what is missing,
// with short answers to tap, then makes the film, and afterwards takes
// changes in the same words. The conversation is kept with the film. Under
// it, the film's settings sit folded into one line, for anyone who would
// rather set them by hand, and the model picker sits at the top.
//
// The panel only shows and sends: the director's replies come from
// converse(), and making or changing a film is handed to the director
// (src/app/director.js).

import { h, clear, iconButton, toast } from './dom.js';
import { ICONS } from './icons.js';
import { select, toggle, ASPECT_SHORT } from './fields.js';
import { ASPECTS, STYLE_PACKS, STYLE_NAMES } from '../core/scene/format.js';
import { createSuggestions, openIdeasDialog } from './suggestions.js';

const LENGTHS = [15, 30, 45, 60, 90, 120];
const TIER_SHORT = { guided: 'Guided', plan: 'Plan', code: 'Code' };

// deps: { store, settings, picker, converse(history) -> reply, onMake(brief), onChange(text),
//         busy(), onAttach(), tierOf() -> { way, suggested, help } }
export function createChatPanel({ store, settings, picker, converse, onMake, onChange, busy, onAttach, tierOf }) {
  const thread = h('div', { class: 'chat-thread', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversation with the director' });
  const input = h('textarea', { class: 'input textarea chat-input', rows: '2', maxlength: '4000', placeholder: 'Message the director', 'aria-label': 'Message to the director' });
  const sendBtn = iconButton(ICONS.send, 'Send', () => send(), 'send-btn');
  const attachBtn = iconButton(ICONS.plus, 'Add your pictures or clips', async () => {
    const names = await onAttach();
    if (names?.length) say(`Added ${names.map((n) => `"${n}"`).join(', ')}. I will show ${names.length === 1 ? 'it' : 'them'} in the film.`);
  }, 'attach-btn');
  const summary = h('summary', { class: 'film-settings-line' });
  const options = h('div', { class: 'dir-options' });
  const settingsBox = h('details', { class: 'film-settings' }, summary, options);
  const el = h('aside', { class: 'director chat', 'aria-label': 'Director' },
    h('div', { class: 'chat-top' }, picker.el),
    thread,
    h('div', { class: 'chat-bottom' }, settingsBox,
      h('div', { class: 'chat-compose' }, attachBtn, input, sendBtn)));

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(140, input.scrollHeight)}px`; });

  const useIdea = (idea) => {
    settings.update({ film: { seconds: idea.seconds, aspect: idea.aspect } });
    send(idea.text);
  };
  const ideas = createSuggestions({ pick: useIdea, openAll: () => openIdeasDialog({ pick: useIdea }) });

  let thinking = false;
  const chosen = new Map(); // message time -> [answer per question]

  const history = () => store.get().project.chat;
  function push(message) {
    store.patch({ chat: [...history(), { at: Date.now(), ...message }] }, { record: false });
  }

  // ---- the thread --------------------------------------------------------------
  function questionBlock(m) {
    const picks = chosen.get(m.at) || [];
    const last = history()[history().length - 1] === m;
    const rows = m.questions.map((q, qi) => h('div', { class: 'chat-q' },
      h('div', { class: 'chat-q-ask', text: q.ask }),
      h('div', { class: 'chat-chips' }, ...q.options.map((o) => h('button', {
        type: 'button', class: `chip${picks[qi] === o ? ' on' : ''}`, text: o, disabled: !last || thinking,
        onclick: () => { const next = [...picks]; next[qi] = picks[qi] === o ? undefined : o; chosen.set(m.at, next); paint(); },
      })))));
    const answered = m.questions.map((q, qi) => (picks[qi] ? `${q.ask} ${picks[qi]}` : null)).filter(Boolean);
    return h('div', { class: 'chat-qs' }, ...rows,
      last ? h('button', { type: 'button', class: 'primary-btn chat-answer', text: answered.length < m.questions.length ? 'Send these answers' : 'Send answers', disabled: !answered.length || thinking, onclick: () => send(answered.join('\n')) }) : null);
  }

  function bubble(m) {
    if (m.role === 'person') return h('div', { class: 'msg person' }, h('div', { class: 'msg-text', text: m.text }));
    return h('div', { class: `msg director${m.kind ? ` ${m.kind}` : ''}` },
      h('div', { class: 'msg-text', text: m.text }),
      m.brief ? h('details', { class: 'msg-brief' }, h('summary', { text: 'The brief' }), h('p', { text: m.brief })) : null,
      m.questions?.length ? questionBlock(m) : null);
  }

  let shown = null;
  function paint() {
    const list = history();
    shown = list;
    const empty = !list.length;
    const nodes = empty
      ? [h('div', { class: 'chat-empty' },
        h('h2', { text: 'What should the film be?' }),
        h('p', { text: 'Say what it is for and who will watch it, in your own words. I will ask for anything missing, then make it.' }),
        ideas.el)]
      : list.map(bubble);
    if (thinking) nodes.push(h('div', { class: 'msg director thinking', 'aria-label': 'The director is thinking' }, h('span', { class: 'dots' }, h('i'), h('i'), h('i'))));
    const atEnd = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 40;
    clear(thread).append(...nodes);
    if (atEnd || thinking) thread.scrollTop = thread.scrollHeight;
    const off = busy() || thinking;
    input.disabled = off;
    sendBtn.disabled = off;
  }

  // ---- the film's settings, folded -------------------------------------------
  function paintOptions() {
    const f = settings.get().film;
    const m = settings.get().model;
    const t = tierOf();
    const setFilm = (patch) => settings.update({ film: patch });
    const labelled = (label, control) => h('label', { class: 'field' }, h('span', { class: 'field-label', text: label }), control);
    summary.textContent = [`${f.seconds} s`, ASPECT_SHORT[f.aspect] || f.aspect, f.style === 'auto' ? 'Auto look' : STYLE_PACKS[f.style]?.label, f.narration ? 'Narration on' : 'No narration', TIER_SHORT[t.way]].filter(Boolean).join(' · ');
    clear(options).append(
      h('div', { class: 'field-pair' },
        labelled('Length', select(String(f.seconds), LENGTHS.map((s) => [String(s), s < 60 ? `${s} seconds` : `${s / 60} minute${s > 60 ? 's' : ''}`]), (v) => setFilm({ seconds: Number(v) }))),
        labelled('Format', select(f.aspect, Object.keys(ASPECTS).map((k) => [k, ASPECT_SHORT[k] || k]), (v) => setFilm({ aspect: v })))),
      h('div', { class: 'field-pair' },
        labelled('Look', select(f.style, [['auto', 'Auto'], ...STYLE_NAMES.map((k) => [k, STYLE_PACKS[k].label])], (v) => setFilm({ style: v }))),
        labelled('Way of working', select(m.tier, [['auto', t.suggested ? `Suggested: ${TIER_SHORT[t.suggested]}` : 'Suggested'], ['guided', 'Guided'], ['plan', 'Plan'], ['code', 'Code']], (v) => settings.update({ model: { tier: v } })))),
      toggle(f.narration, (v) => setFilm({ narration: v }), 'Narration for each scene'),
      h('div', { class: 'field-hint', text: t.help }));
  }

  // ---- talking -----------------------------------------------------------------
  async function send(given) {
    const text = String(given ?? input.value).trim();
    if (!text || thinking || busy()) return;
    if (given === undefined) { input.value = ''; input.style.height = ''; }
    push({ role: 'person', text });
    thinking = true;
    paint();
    let reply;
    try {
      reply = await converse(history());
    } catch (err) {
      thinking = false;
      if (!err?.stopped) push({ role: 'director', text: err.message || String(err), kind: 'note' });
      paint();
      return;
    }
    thinking = false;
    if (reply.film && Object.keys(reply.film).length) {
      const { useMedia, ...film } = reply.film;
      if (Object.keys(film).length) settings.update({ film });
    }
    push({ role: 'director', text: reply.reply, ...(reply.questions.length ? { questions: reply.questions } : {}), ...(reply.action === 'make' ? { brief: reply.brief } : {}) });
    paint();
    if (reply.action === 'make') onMake(reply.brief, { useMedia: reply.film?.useMedia !== false });
    else if (reply.action === 'change') onChange(reply.change);
  }

  // A line from the director that is not a reply: a film made, a change
  // made, a step that needs the person.
  function say(text, kind = 'note') {
    push({ role: 'director', text, kind });
    paint();
  }

  // Edits to the film repaint the thread only when the conversation changed.
  store.on('project', () => { if (history() !== shown) paint(); });
  settings.subscribe(paintOptions);
  paintOptions();
  paint();
  return { el, say, paint, focus: () => input.focus(), send, hasDraft: () => Boolean(input.value.trim()) };
}
