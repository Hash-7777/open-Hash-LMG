// The storyboard: the smallest thing a model has to write to get a film.
//
// A storyboard is a list of beats ("hook", "statement", "stat", "list" ...),
// each holding only words and numbers. Small local models write this well;
// what they cannot do reliably is layout, timing and motion, and they do not
// have to: compile.js turns a storyboard into a full scene in a style pack.
//
// normalizeStoryboard is as forgiving as normalizeScene: a beat written as a
// bare string is a statement, "bullets" are items, "headline" is text, and so
// on. Every repair is noted.

import { STYLE_NAMES, wordCount } from './format.js';

export const BEAT_KINDS = ['hook', 'statement', 'title', 'stat', 'list', 'steps', 'chart', 'quote', 'compare', 'words', 'logo', 'end'];

const KIND_ALIASES = {
  intro: 'hook', opener: 'hook', opening: 'hook', question: 'hook', problem: 'hook',
  headline: 'statement', line: 'statement', text: 'statement', message: 'statement', feature: 'statement', benefit: 'statement', claim: 'statement', solution: 'statement',
  heading: 'title', reveal: 'title', name: 'title', product: 'title', brand: 'logo', wordmark: 'logo',
  number: 'stat', metric: 'stat', stats: 'stat', figure: 'stat', kpi: 'stat', counter: 'stat',
  bullets: 'list', points: 'list', features: 'list', checklist: 'list',
  process: 'steps', timeline: 'steps', how: 'steps', flow: 'steps',
  graph: 'chart', bars: 'chart', bar: 'chart', 'line-chart': 'chart', data: 'chart',
  testimonial: 'quote', review: 'quote',
  versus: 'compare', vs: 'compare', 'before-after': 'compare', comparison: 'compare',
  kinetic: 'words', punch: 'words', sequence: 'words', 'word-by-word': 'words',
  outro: 'end', cta: 'end', 'call-to-action': 'end', closing: 'end', ending: 'end', endcard: 'end', 'end-card': 'end',
};

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const s = (v, max = 160) => (typeof v === 'number' ? String(v) : typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

// "*too*" marks an accent word. Returns the clean text and the accented words.
export function splitAccents(text) {
  const accents = [];
  const clean = String(text || '').replace(/\*{1,2}([^*]+)\*{1,2}/g, (_, w) => { accents.push(...w.trim().split(/\s+/)); return w; });
  return { text: clean.replace(/\s+/g, ' ').trim(), accents };
}

function num(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const m = v.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    if (m) return parseFloat(m[0]);
  }
  return null;
}

function kindOf(raw) {
  const k = s(raw, 40).toLowerCase().replace(/[\s_]+/g, '-');
  if (BEAT_KINDS.includes(k)) return k;
  return KIND_ALIASES[k] || KIND_ALIASES[k.replace(/-/g, '')] || null;
}

function normBeat(b, notes) {
  if (typeof b === 'string') b = { kind: 'statement', text: b };
  if (!isObj(b)) return null;
  let kind = kindOf(b.kind ?? b.type ?? b.beat);
  const text0 = s(b.text ?? b.headline ?? b.title ?? b.line ?? b.words ?? b.message, 200);
  const items = (Array.isArray(b.items) ? b.items : Array.isArray(b.bullets) ? b.bullets : Array.isArray(b.points) ? b.points : Array.isArray(b.steps) ? b.steps : Array.isArray(b.features) ? b.features : [])
    .map((x) => (isObj(x) ? s(x.text ?? x.title ?? x.label) : s(x, 80))).filter(Boolean).slice(0, 6);
  const values = (Array.isArray(b.values) ? b.values : Array.isArray(b.data) ? b.data : []).map((v) => (isObj(v) ? num(v.value) : num(v))).filter((v) => v !== null).slice(0, 12);
  if (!kind) {
    kind = values.length ? 'chart' : items.length ? 'list' : num(b.value ?? b.number) !== null ? 'stat' : 'statement';
    notes.add(`A beat of an unknown kind was read as "${kind}".`);
  }
  const { text, accents } = splitAccents(text0);
  const accent = [...accents, ...(Array.isArray(b.accent) ? b.accent : typeof b.accent === 'string' && b.accent ? b.accent.split(/\s+/) : [])].map((w) => s(w, 40)).filter(Boolean).slice(0, 6);
  const out = { kind, text, sub: s(b.sub ?? b.subtitle ?? b.subline ?? b.caption ?? b.tagline ?? b.label ?? b.url, 120), accent, say: s(b.say ?? b.narration ?? b.voiceover ?? b.voice, 240) };
  switch (kind) {
    case 'stat': {
      const v = num(b.value ?? b.number ?? b.to ?? text0);
      if (v === null) { notes.add('A stat beat without a number became a statement.'); return { ...out, kind: 'statement' }; }
      const raw = String(b.value ?? b.number ?? '');
      out.value = v;
      out.prefix = s(b.prefix, 8) || (/^\s*[$£€¥]/.test(raw) ? raw.trim()[0] : '');
      out.suffix = s(b.suffix ?? b.unit, 20) || (/%\s*$/.test(raw) ? '%' : '');
      out.decimals = Number.isInteger(v) ? 0 : Math.min(2, String(v).split('.')[1]?.length || 1);
      out.sub = out.sub || (text && num(text) === null ? text : '');
      break;
    }
    case 'list': case 'steps':
      out.items = items.length ? items : text.split(/[;,]\s*/).filter(Boolean).slice(0, 6);
      if (!out.items.length) return null;
      if (!items.length) out.text = '';
      break;
    case 'chart':
      if (!values.length) { notes.add('A chart beat without numbers became a statement.'); return { ...out, kind: 'statement' }; }
      out.values = values;
      out.labels = (Array.isArray(b.labels) ? b.labels : Array.isArray(b.data) ? b.data.map((d) => (isObj(d) ? d.label : '')) : []).map((x) => s(x, 16)).slice(0, values.length);
      out.chart = /line/i.test(String(b.chart ?? b.style ?? b.kind ?? '')) ? 'line' : 'bars';
      out.suffix = s(b.suffix ?? b.unit, 8);
      break;
    case 'quote':
      out.by = s(b.by ?? b.author ?? b.who ?? out.sub, 60);
      break;
    case 'compare': {
      const side = (v, def) => (isObj(v) ? { label: s(v.label ?? v.title, 30) || def, text: s(v.text ?? v.value, 80) } : { label: def, text: s(v, 80) });
      out.left = side(b.left ?? b.before ?? b.a, 'Before');
      out.right = side(b.right ?? b.after ?? b.b, 'After');
      if (!out.left.text || !out.right.text) { notes.add('A comparison missing one side became a statement.'); return { ...out, kind: 'statement' }; }
      break;
    }
    case 'words': {
      const list = Array.isArray(b.words) ? b.words.map((w) => s(w, 40)).filter(Boolean) : text.split(/\s+/).filter(Boolean);
      out.words = list.slice(0, 12);
      if (!out.words.length) return null;
      break;
    }
    case 'logo':
      out.asset = s(b.asset ?? b.image, 60);
      break;
    default: break;
  }
  if (['hook', 'statement', 'title', 'quote', 'logo', 'end'].includes(kind) && !out.text) {
    if (out.sub) { out.text = out.sub; out.sub = ''; } else { notes.add(`An empty ${kind} beat was left out.`); return null; }
  }
  return out;
}

export function normalizeStoryboard(input) {
  const list = [];
  const seen = new Set();
  const notes = { add(m) { if (!seen.has(m)) { seen.add(m); list.push(m); } } };
  let doc = input;
  if (typeof doc === 'string') { try { doc = JSON.parse(doc); } catch { doc = {}; } }
  if (Array.isArray(doc)) doc = { beats: doc };
  if (!isObj(doc)) doc = {};
  const raw = Array.isArray(doc.beats) ? doc.beats : Array.isArray(doc.storyboard) ? doc.storyboard : Array.isArray(doc.scenes) ? doc.scenes : [];
  const beats = raw.slice(0, 40).map((b) => normBeat(b, notes)).filter(Boolean);
  if (!beats.length) notes.add('The storyboard has no beats.');
  const style = typeof doc.style === 'string' && STYLE_NAMES.includes(doc.style.toLowerCase()) ? doc.style.toLowerCase() : null;
  return { storyboard: { title: s(doc.title, 120) || (beats[0]?.text || 'Untitled film').slice(0, 60), style, beats }, notes: list };
}

// Words a viewer reads in a beat, for timing.
export function beatWords(b) {
  switch (b.kind) {
    case 'list': case 'steps': return wordCount(b.text) + b.items.reduce((n, it) => n + wordCount(it), 0);
    case 'stat': return 1 + wordCount(b.sub);
    case 'chart': return wordCount(b.text) + Math.ceil(b.values.length / 2);
    case 'compare': return wordCount(b.left.label) + wordCount(b.left.text) + wordCount(b.right.label) + wordCount(b.right.text);
    case 'words': return b.words.length;
    case 'quote': return wordCount(b.text) + wordCount(b.by);
    default: return wordCount(b.text) + wordCount(b.sub);
  }
}
