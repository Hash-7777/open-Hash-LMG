// The storyboard of a product film, and the facts it may claim.
//
// A model fills the board with words only: the lines the voice says over each
// part, and the few words each diagram shows. The planner (product-film.js)
// does everything else. Every figure, format and codec the board puts on
// screen or in the voice must come from the facts; claimProblems names each
// one that does not, and dropUnsupported takes it out.
//
// board = {
//   name, expansion, tagline,
//   steps:   [{ name, sub, cue }]             the process, each lit as its cue is said
//   split:   { left: { title, items: [{ label, cue }] }, right: {...} }
//   hub:     { title, sub, tiles: [{ name, sub, cue }], note }
//   yours:   [{ cap, icon }]
//   figures: [{ value, cap, say }]            each said as its own line
//   releaseLine, endLine
//   lines:   { open, name, brief, make, steps, film, split, hands, export, hub, looks, yours, release, end }
// }

import { ICON_NAMES } from '../engine/stage-icons.js';

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const text = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);

export const LINE_KEYS = ['open', 'name', 'brief', 'make', 'steps', 'film', 'split', 'hands', 'export', 'hub', 'looks', 'yours', 'release', 'end'];
const LIMIT = { line: 220, steps: 6, items: 6, tiles: 8, yours: 3, figures: 4 };

export function normalizeBoard(input) {
  const b = isObj(input) ? input : {};
  const side = (s) => (isObj(s) ? { title: text(s.title, 30), icon: ICON_NAMES.includes(s.icon) ? s.icon : '', items: list(s.items, LIMIT.items).filter(isObj).map((i) => ({ label: text(i.label, 24), cue: text(i.cue, 24) })).filter((i) => i.label) } : null);
  const linesIn = isObj(b.lines) ? b.lines : {};
  const board = {
    name: text(b.name, 40), expansion: text(b.expansion, 80), tagline: text(b.tagline, 90),
    steps: list(b.steps, LIMIT.steps).filter(isObj).map((s) => ({ name: text(s.name, 20), sub: text(s.sub, 40), cue: text(s.cue, 24) })).filter((s) => s.name),
    split: side(b.split?.left) && side(b.split?.right) ? { left: side(b.split.left), right: side(b.split.right) } : null,
    hub: isObj(b.hub) ? { title: text(b.hub.title, 24), sub: text(b.hub.sub, 40), tiles: list(b.hub.tiles, LIMIT.tiles).filter(isObj).map((x) => ({ name: text(x.name, 12), sub: text(x.sub, 30), cue: text(x.cue, 24) })).filter((x) => x.name), note: text(b.hub.note, 60) } : null,
    yours: list(b.yours, LIMIT.yours).filter(isObj).map((y) => ({ cap: text(y.cap, 40), icon: ICON_NAMES.includes(y.icon) ? y.icon : 'frame' })).filter((y) => y.cap),
    figures: list(b.figures, LIMIT.figures).filter(isObj).map((f) => ({ value: text(String(f.value ?? ''), 6), cap: text(f.cap, 30), say: text(f.say, 60) })).filter((f) => f.value && f.cap),
    releaseLine: text(b.releaseLine, 90), endLine: text(b.endLine, 90),
    lines: Object.fromEntries(LINE_KEYS.map((k) => [k, text(linesIn[k], LIMIT.line)]).filter(([, v]) => v)),
  };
  if (board.hub && !board.hub.tiles.length) board.hub = null;
  return board;
}

// The facts a product film may claim: any JSON object of what the product is
// and does. Lists and numbers are read as they are; every string is a claim
// it supports. allowNames lists the only names of other services the film
// may say (where the product is released, say).
export function normalizeFacts(input) {
  const f = isObj(input) ? input : {};
  return { ...f, name: text(f.name, 40), allowNames: list(f.allowNames, 10).map((n) => text(n, 30)).filter(Boolean) };
}

const WORD_NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const FORMAT_WORDS = /\b(MP4|MOV|WebM|GIF|MP3|WAV|AAC|PNG|ZIP|H\.?26[45]|HEVC|AV1|VP9|Vorbis|Opus|ProRes|[0-9]+K|[0-9]{3,4}p)\b/gi;

// Everything the facts support, as lower-case tokens: every word and number
// in them, and the length of every list (seven looks is a fact when the
// looks list has seven names).
export function factTokens(facts) {
  const out = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) { out.add(String(v.length)); v.forEach(walk); }
    else if (isObj(v)) Object.values(v).forEach(walk);
    else if (typeof v === 'number') out.add(String(v));
    else if (typeof v === 'string') for (const w of v.toLowerCase().match(/[\p{L}\p{N}.+]+/gu) || []) { out.add(w.replace(/\.$/, '')); }
  };
  walk(facts);
  return out;
}

// The claims a piece of text makes: its numbers (as digits, said or written)
// and the formats and codecs it names.
export function claimsIn(s) {
  const out = [];
  const formats = String(s || '').match(FORMAT_WORDS) || [];
  for (const m of formats) out.push(m.toLowerCase());
  // Numbers outside the format names ("264" in H.264 is the codec, not a count).
  const rest = String(s || '').replace(FORMAT_WORDS, ' ');
  for (const m of rest.match(/\b\d+(?:[.,]\d+)?\b/g) || []) out.push(m.replace(',', ''));
  for (const w of rest.toLowerCase().match(/\b[a-z]+\b/g) || []) { const i = WORD_NUMBERS.indexOf(w); if (i >= 2) out.push(String(i)); }
  return [...new Set(out)];
}

// Each claim on the board that the facts do not support: { where, claim }.
export function claimProblems(board, facts) {
  const ok = factTokens(facts);
  const out = [];
  const look = (where, s) => { for (const c of claimsIn(s)) if (!ok.has(c)) out.push({ where, claim: c }); };
  board.figures.forEach((f, i) => { look(`figure ${i + 1}`, f.value); look(`figure ${i + 1}`, f.say); });
  board.hub?.tiles.forEach((x, i) => look(`tile ${i + 1}`, `${x.name} ${x.sub}`));
  for (const [k, v] of Object.entries(board.lines)) look(`line ${k}`, v);
  look('release line', board.releaseLine);
  return out;
}

// The board with every unsupported claim taken out: a figure or a tile that
// claims one goes, and a spoken line loses the sentence that makes it.
export function dropUnsupported(board, facts) {
  const bad = claimProblems(board, facts);
  if (!bad.length) return board;
  const where = new Set(bad.map((b) => b.where));
  const out = structuredClone(board);
  out.figures = board.figures.filter((_, i) => !where.has(`figure ${i + 1}`));
  if (out.hub) out.hub.tiles = board.hub.tiles.filter((_, i) => !where.has(`tile ${i + 1}`));
  const ok = factTokens(facts);
  for (const [k, v] of Object.entries(board.lines)) {
    if (!where.has(`line ${k}`)) continue;
    const kept = v.split(/(?<=[.!?])\s+/).filter((s) => claimsIn(s).every((c) => ok.has(c)));
    if (kept.length) out.lines[k] = kept.join(' '); else delete out.lines[k];
  }
  if (where.has('release line')) out.releaseLine = '';
  return out;
}

// How the voice should say what is written: names spelled out, codecs read as
// people say them. table: { written: said } from the facts, over these.
export const SAY_AS = {
  'H.264': 'H two six four', 'H.265': 'H two six five', AV1: 'A V one', MP4: 'M P four', MOV: 'M O V', WebM: 'web M', MP3: 'M P three', GIF: 'GIF', '4K': 'four K',
};
export function sayAs(s, table = {}) {
  const all = { ...SAY_AS, ...table };
  let out = String(s);
  for (const [w, said] of Object.entries(all).sort((a, b) => b[0].length - a[0].length)) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'gu'), said);
  }
  return out;
}

// The lines the voice says, part by part, with figures as lines of their own:
// { key: { text, say } }.
export function spokenLines(board, facts = {}) {
  const out = {};
  for (const [k, v] of Object.entries(board.lines)) out[k] = { text: v, say: sayAs(v, facts.sayAs) };
  board.figures.forEach((f, i) => { const v = f.say || `${f.value} ${f.cap}.`; out[`figure-${i}`] = { text: v, say: sayAs(v, facts.sayAs) }; });
  return out;
}
