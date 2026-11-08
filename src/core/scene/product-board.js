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
// Words for the screen: never cut mid-word; a long one ends at its last whole word.
const words = (v, max) => {
  const s = typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim() : '';
  if (s.length <= max) return s;
  const cut = s.slice(0, max + 1).replace(/\s+\S*$/, '');
  return (cut || s.slice(0, max)).replace(/[,;:\s]+$/, '');
};
// Models name the same field in several ways; the first one given is read.
const pick = (o, ...keys) => { for (const k of keys) if (typeof o[k] === 'string' || typeof o[k] === 'number') return o[k]; return ''; };
// An item's words under any name: the known ones first, else its first words that are not a cue.
const label = (o, ...keys) => pick(o, ...keys) || Object.entries(o).find(([k, v]) => typeof v === 'string' && !/^(cue|icon|drawing|picture|say|line)$/.test(k))?.[1] || '';
const iconOf = (o) => { const v = pick(o, 'icon', 'drawing', 'picture', 'symbol'); return ICON_NAMES.includes(v) ? v : ''; };
const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);

export const LINE_KEYS = ['open', 'name', 'brief', 'make', 'steps', 'film', 'split', 'hands', 'export', 'hub', 'looks', 'yours', 'release', 'end'];
const LIMIT = { line: 220, steps: 6, items: 6, tiles: 8, yours: 3, figures: 4 };

export function normalizeBoard(input) {
  const b = isObj(input) ? input : {};
  const item = (i) => ({ label: words(label(i, 'label', 'name', 'item', 'title', 'text', 'word'), 24), cue: text(String(pick(i, 'cue', 'word', 'say')), 24) });
  const side = (v) => (isObj(v) ? { title: words(pick(v, 'title', 'name', 'label'), 30), icon: iconOf(v), items: list(v.items, LIMIT.items).map((i) => (typeof i === 'string' ? { label: i } : i)).filter(isObj).map(item).filter((i) => i.label) } : null);
  const linesIn = isObj(b.lines) ? b.lines : {};
  const hubIn = isObj(b.hub) ? b.hub : null;
  const board = {
    name: text(b.name, 40), expansion: words(b.expansion, 80), tagline: words(b.tagline, 90),
    steps: list(b.steps, LIMIT.steps).filter(isObj).map((v) => ({ name: words(label(v, 'name', 'title', 'label', 'step'), 20), sub: words(pick(v, 'sub', 'caption', 'text', 'detail'), 60), cue: text(String(pick(v, 'cue', 'word')), 24) })).filter((v) => v.name),
    split: side(b.split?.left) && side(b.split?.right) ? { left: side(b.split.left), right: side(b.split.right) } : null,
    hub: hubIn ? { title: words(pick(hubIn, 'title', 'name'), 24), sub: words(pick(hubIn, 'sub', 'caption', 'text'), 40), tiles: list(hubIn.tiles, LIMIT.tiles).filter(isObj).map((x) => ({ name: words(label(x, 'name', 'label', 'title', 'tile'), 18), sub: words(pick(x, 'sub', 'caption', 'text'), 40), cue: text(String(pick(x, 'cue', 'word')), 24) })).filter((x) => x.name), note: words(pick(hubIn, 'note', 'footnote'), 60) } : null,
    yours: list(b.yours, LIMIT.yours).filter(isObj).map((v) => ({ cap: words(label(v, 'cap', 'caption', 'text', 'label', 'title'), 40), icon: iconOf(v) || 'frame' })).filter((v) => v.cap),
    figures: list(b.figures, LIMIT.figures).filter(isObj).map((f) => ({ value: text(String(pick(f, 'value', 'figure', 'number')), 6), cap: words(pick(f, 'cap', 'caption', 'label', 'text'), 30), say: text(String(pick(f, 'say', 'line', 'spoken')), 90) })).filter((f) => f.value && f.cap),
    releaseLine: words(b.releaseLine, 90), endLine: words(b.endLine, 90),
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

const WORD_NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
// Numbers written in digits: a version is one number ("3.3.0"), and a
// thousands mark is not a decimal ("1,800" is 1800).
const numbersIn = (s) => (String(s).match(/\b\d+(?:[.,]\d+)*\b/g) || []).map((m) => (/^\d{1,3}(,\d{3})+$/.test(m) ? m.replace(/,/g, '') : m));

// Numbers written as words, as digits: "twenty-one" is 21, "seven" is 7.
function wordNumbers(s) {
  const out = [];
  for (const m of String(s).toLowerCase().matchAll(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](one|two|three|four|five|six|seven|eight|nine))?\b|\b([a-z]+)\b/g)) {
    if (m[1]) out.push(String(TENS[m[1]] + (m[2] ? WORD_NUMBERS.indexOf(m[2]) : 0)));
    else { const i = WORD_NUMBERS.indexOf(m[3]); if (i >= 2) out.push(String(i)); }
  }
  return out;
}
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
    else if (typeof v === 'string') {
      for (const w of v.toLowerCase().match(/[\p{L}\p{N}.+]+/gu) || []) { const t = w.replace(/\.+$/, ''); out.add(t); if (/^v\d/.test(t)) out.add(t.slice(1)); }
      for (const n of wordNumbers(v)) out.add(n);
      for (const n of numbersIn(v)) out.add(n);
    }
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
  // A version is one claim ("3.3.0"), a thousands mark is not a decimal ("1,800").
  out.push(...numbersIn(rest));
  out.push(...wordNumbers(rest));
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

// ---- the form a product film is made from --------------------------------------

// What the person gave: the name, one line on what it does, key facts one per
// line, an optional facts file (a JSON object, or text read line by line),
// the icon's asset id, and the storyboard the last making wrote. Kept with the
// project, so the film can be made again from it.
export function normalizeProductForm(input) {
  if (!isObj(input)) return null;
  const file = isObj(input.file) ? { name: text(input.file.name, 120), facts: isObj(input.file.facts) ? input.file.facts : null, lines: list(input.file.lines, 200).map((l) => text(l, 200)).filter(Boolean) } : null;
  return {
    name: text(input.name, 40),
    line: text(input.line, 160),
    facts: typeof input.facts === 'string' ? input.facts.slice(0, 4000) : '',
    file,
    icon: typeof input.icon === 'string' && /^[a-z0-9-]{1,64}$/.test(input.icon) ? input.icon : null,
    board: isObj(input.board) ? normalizeBoard(input.board) : null,
  };
}

// A facts file's text: a JSON object as it is, any other text line by line.
export function readFactsFile(name, body) {
  const s = String(body || '');
  try { const v = JSON.parse(s); if (isObj(v)) return { name, facts: v, lines: [] }; } catch { /* not JSON: read as lines */ }
  return { name, facts: null, lines: factLines(s).slice(0, 200) };
}

// A line of facts as plain words. A file written for a web page (a README,
// say) carries tags, badges, links, tables and marks: a picture keeps only
// what it says in words, a link only its words, and a line left with no words
// at all is no fact.
export function plainFact(line) {
  const ENT = { amp: '&', middot: '\u00b7', nbsp: ' ', quot: '"', apos: "'", lt: '<', gt: '>', mdash: '\u2014', ndash: '\u2013' };
  let s = String(line)
    .replace(/<img\b[^>]*\balt\s*=\s*"([^"]*)"[^>]*>/gi, ' $1 ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, ' $1 ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/&(\w+);/g, (m, k) => ENT[k.toLowerCase()] ?? ' ')
    .replace(/^\s*(#{1,6}|>|[-*\u2022+]|\d+[.)])\s+/, '')
    .replace(/\*\*|__|`+|~~/g, '')
    .replace(/(^|\s)[*_](\S)/g, '$1$2').replace(/(\S)[*_](?=\s|$|[.,;:])/g, '$1')
    .replace(/\s*\|\s*/g, ' \u00b7 ')
    .replace(/%[0-9a-f]{2}/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\u00b7:;,.-]+|[\s\u00b7:;,-]+$/g, '');
  return (s.match(/\p{L}/gu) || []).length >= 3 ? s : '';
}

// The plain lines of a text, once each.
export function factLines(body) {
  const seen = new Set();
  return String(body || '').split(/\r?\n/).map(plainFact).filter((l) => l && !seen.has(l.toLowerCase()) && seen.add(l.toLowerCase()));
}

// The facts the film may claim, from the form.
export function formFacts(form) {
  // A long file keeps its first lines: the model is shown a few thousand characters at most.
  const all = [...factLines(form.facts), ...(form.file?.lines || []).map(plainFact).filter(Boolean)];
  const kept = [];
  let room = 5000;
  for (const l of all) { if (l.length > room) break; kept.push(l); room -= l.length + 4; }
  return normalizeFacts({ ...(form.file?.facts || {}), name: form.name, does: form.line, facts: kept, allowNames: form.file?.facts?.allowNames || [] });
}

// The board made ready to speak: the product's own name, the name line said
// as the name, what its capitals stand for and its tagline (so the words on
// screen are the words said), and a plain line for any part the model gave
// none, so every part has something to time it.
export function fillLines(board, form) {
  const b = structuredClone(board);
  b.name = form.name || b.name;
  if (!b.tagline) b.tagline = form.line;
  const stop = (s) => (s && !/[.!?]$/.test(s) ? `${s}.` : s);
  b.lines.name = [b.name, b.expansion, b.tagline].filter(Boolean).map(stop).join(' ');
  const L = b.lines;
  if (!L.open) L.open = stop(form.line);
  if (b.steps.length && !L.steps) L.steps = b.steps.map((s) => stop(s.name)).join(' ');
  if (b.split && !L.split) L.split = `${stop(`${b.split.left.title}: ${b.split.left.items.map((i) => i.label.toLowerCase()).join(', ')}`)} ${stop(`${b.split.right.title}: ${b.split.right.items.map((i) => i.label.toLowerCase()).join(', ')}`)}`;
  if (b.hub && !L.hub) L.hub = stop(`${b.hub.title}: ${b.hub.tiles.map((x) => x.name).join(', ')}`);
  if (b.yours.length && !L.yours) L.yours = b.yours.map((y) => stop(y.cap)).join(' ');
  if (!L.end) L.end = stop(b.endLine ? `${b.name}. ${b.endLine}` : b.name);
  return b;
}
