// The director's side of the conversation in the left panel.
//
// The person says what they want in their own words. The director (the model
// chosen for the film) asks for what is missing, a few questions at a time,
// each with short answers to tap: what the film is for, who will watch it,
// how long, which frame shape, the look, narration, whether to use the media
// they gave. Once it knows enough it writes the brief and the film's
// settings, and the film is made. With a film made, what the person says is
// a change to make, a new take, or a question to answer.
//
// Pure: the page sends the request and shows the reply. Each turn sends a
// short system text, the film's state in a few lines, and the last few
// messages only, so a long conversation costs no more than a short one.

import { ASPECTS, STYLE_NAMES } from '../scene/format.js';

const LENGTHS = [15, 30, 45, 60, 90, 120];
const KEEP_TURNS = 12;
const MAX_TEXT = 4000;

export const CHAT_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    questions: { type: 'array', items: { type: 'object', properties: { ask: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } }, required: ['ask', 'options'] } },
    action: { type: 'string', enum: ['ask', 'make', 'change', 'answer'] },
    brief: { type: 'string' },
    film: { type: 'object', properties: { seconds: { type: 'number' }, aspect: { type: 'string' }, style: { type: 'string' }, narration: { type: 'boolean' }, useMedia: { type: 'boolean' } } },
    change: { type: 'string' },
  },
  required: ['reply', 'action'],
};

// The system text for one turn.
export function chatPrompt({ hasFilm = false, media = [], narrationReady = false }) {
  return `You are the director inside a motion graphics app, talking with the person who wants a short animated film. Speak plainly and briefly, like a friendly producer. Never use emoji.

Your job: learn what the film needs, then hand over a complete brief so it can be made.
Before making a film you need: what it is for and what it must say; who will watch it; its length (${LENGTHS.join(', ')} seconds); its frame (16:9 wide, 9:16 tall for phones, 1:1 square, 4:5 portrait); the look (auto, ${STYLE_NAMES.join(', ')}); whether a voice should narrate it${media.length ? `; and whether to show the media they gave (${media.map((m) => `${m.kind === 'video' ? 'a clip' : 'a picture'} "${m.name}"`).join(', ')})` : ''}.
Ask only for what you cannot reasonably decide yourself, at most three questions at a time, each with two to five short answers to tap. When the person leaves something to you, decide it well. When you have enough, make the film.${narrationReady ? '' : '\nNo voice is set up in the app yet: if they want narration, say it needs a voice chosen in Settings, under Voice.'}
${hasFilm ? '\nA film is already made. If they ask for a change to it, choose "change" and say exactly what to change. If they want a different film, choose "make" with a new brief. If they only ask something, choose "answer".' : ''}

Reply with JSON only:
{"reply": "what you say to them, one to three short sentences",
 "questions": [{"ask": "a short question", "options": ["short answer", ...]}],
 "action": "ask" | "make"${hasFilm ? ' | "change" | "answer"' : ''},
 "brief": "with make: the complete brief, written for the film maker: purpose, audience, the message, every name, fact and number they gave, the tone, and how to use their media",
 "film": {"seconds": number, "aspect": "16:9" | "9:16" | "1:1" | "4:5", "style": "auto" or a look, "narration": true | false, "useMedia": true | false}${hasFilm ? ',\n "change": "with change: the change, in one or two sentences"' : ''}}`;
}

// A few lines on the film as it stands, for the director to talk about it.
export function filmState(project, settings) {
  const f = settings?.film || {};
  const lines = [`Settings now: ${f.seconds || 30} seconds, ${f.aspect || '16:9'}, look ${f.style || 'auto'}, narration ${f.narration ? 'on' : 'off'}.`];
  const S = project?.scene;
  if (S?.scenes?.length) lines.push(`The film made so far: "${S.title}", ${S.scenes.length} scenes, ${Number(S.duration).toFixed(1)} seconds, made from this brief: ${String(project.brief || '').slice(0, 600)}`);
  return lines.join('\n');
}

// The messages for one turn: the last few turns, the film's state before the
// person's newest message.
export function chatMessages(history, state) {
  const KIND = { image: 'picture', video: 'clip', sound: 'sound', doc: 'text file' };
  const said = (m) => `${m.text}${m.attachments?.length ? `\n[Added to the film: ${m.attachments.map((a) => `${KIND[a.kind] || 'file'} "${a.name}"`).join(', ')}]` : ''}`;
  const turns = history.slice(-KEEP_TURNS).map((m) => ({ role: m.role === 'person' ? 'user' : 'assistant', content: m.role === 'person' ? said(m) : JSON.stringify({ reply: m.text, ...(m.questions?.length ? { questions: m.questions } : {}) }) }));
  if (turns.length && turns[0].role === 'assistant') turns.shift();
  if (!turns.length) return [];
  // The state goes with the person's newest message, the one being answered.
  const last = turns.map((t) => t.role).lastIndexOf('user');
  turns[last] = { ...turns[last], content: `${state}\n\n${turns[last].content}` };
  return turns;
}

const str = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');

// The model's reply, held to the shape the panel can show. A reply that is
// not JSON is taken as words to show, asking nothing.
export function normalizeChatReply(raw, { hasFilm = false } = {}) {
  if (typeof raw === 'string') return { reply: str(raw, 1200) || 'Tell me a little more about the film.', questions: [], action: 'ask', brief: '', film: {}, change: '' };
  const r = raw && typeof raw === 'object' ? raw : {};
  const questions = (Array.isArray(r.questions) ? r.questions : []).slice(0, 3).map((q) => ({
    ask: str(q?.ask, 200),
    options: (Array.isArray(q?.options) ? q.options : []).map((o) => str(String(o ?? ''), 60)).filter(Boolean).slice(0, 5),
  })).filter((q) => q.ask);
  const actions = hasFilm ? ['ask', 'make', 'change', 'answer'] : ['ask', 'make'];
  let action = actions.includes(r.action) ? r.action : 'ask';
  const brief = str(r.brief, MAX_TEXT);
  const change = str(r.change, 1000);
  if (action === 'make' && !brief) action = 'ask';
  if (action === 'change' && !change) action = 'answer';
  const f = r.film && typeof r.film === 'object' ? r.film : {};
  const film = {};
  const seconds = Number(f.seconds);
  if (Number.isFinite(seconds) && seconds > 0) film.seconds = LENGTHS.reduce((a, b) => (Math.abs(b - seconds) < Math.abs(a - seconds) ? b : a));
  if (Object.keys(ASPECTS).includes(f.aspect)) film.aspect = f.aspect;
  if (f.style === 'auto' || STYLE_NAMES.includes(f.style)) film.style = f.style;
  if (typeof f.narration === 'boolean') film.narration = f.narration;
  if (typeof f.useMedia === 'boolean') film.useMedia = f.useMedia;
  return { reply: str(r.reply, 1200) || (action === 'make' ? 'Making the film now.' : 'Tell me a little more about the film.'), questions: action === 'ask' ? questions : [], action, brief, film, change };
}

// A brief that asks for a voice, read when no director chose for it.
export const ASKS_FOR_NARRATION = /\b(narrat\w*|voice[- ]?over|voiceover|narrator|spoken|voiced)\b/i;

// A conversation as kept with its film: who said what, the questions asked
// and the brief a reply carried; the newest sixty messages.
export function normalizeChat(list) {
  return (Array.isArray(list) ? list : []).slice(-60).map((m) => {
    if (!m || typeof m !== 'object') return null;
    const role = m.role === 'person' ? 'person' : m.role === 'director' ? 'director' : null;
    const text = typeof m.text === 'string' ? m.text.slice(0, MAX_TEXT) : '';
    if (!role || !text) return null;
    const out = { role, text, at: Number.isFinite(m.at) ? m.at : 0 };
    if (role === 'person' && Array.isArray(m.attachments)) {
      const files = m.attachments.filter((a) => a && typeof a.key === 'string' && typeof a.name === 'string').slice(0, 20)
        .map((a) => ({ key: a.key.slice(0, 40), name: a.name.slice(0, 200), kind: ['image', 'video', 'sound', 'doc'].includes(a.kind) ? a.kind : 'doc' }));
      if (files.length) out.attachments = files;
    }
    if (role === 'director') {
      const q = normalizeChatReply({ reply: text, questions: m.questions, action: 'ask' }).questions;
      if (q.length) out.questions = q;
      if (typeof m.brief === 'string' && m.brief) out.brief = m.brief.slice(0, MAX_TEXT);
      if (typeof m.kind === 'string' && ['made', 'changed', 'note'].includes(m.kind)) out.kind = m.kind;
    }
    return out;
  }).filter(Boolean);
}
