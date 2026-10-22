// A film's direction: the choices that make one film unlike the next.
//
// The compiler lays out words by rule, and rules alone give every brief the
// same film. Direction is what a designer decides before laying anything out:
// the mood, the look, the accent colour, the tempo and key of the music, which
// transitions and entrances the film cuts with, how the camera moves and which
// composition each kind of scene takes. It is read from the brief and from
// what the model suggested (the storyboard's "look"), and a take number makes
// the same brief come out as a new film each time it is made.
//
// Pure and seeded: the same brief, look and take give the same direction, so a
// saved film can always be made again exactly.

import { STYLE_PACKS, STYLE_NAMES } from './format.js';
import { contrast, parseColor, toHex } from '../util/color.js';

export const MOODS = ['calm', 'bold', 'playful', 'technical', 'luxury', 'warm', 'serious', 'energetic'];
export const TEMPOS = ['slow', 'medium', 'fast'];

// Words in a brief that say which mood it wants, weakest signal first.
const MOOD_WORDS = {
  calm: /\b(calm|quiet|peace|gentle|soft|mindful|sleep|relax|wellness|slow|breathe|meditat\w*|serene)\b/gi,
  bold: /\b(bold|launch|bigger|power\w*|unstoppable|announce\w*|introduc\w*|revolution\w*|game.?chang\w*|loud)\b/gi,
  playful: /\b(fun|play\w*|kids?|game|toy|happy|joy\w*|snack|candy|party|friendly|cute|colou?rful)\b/gi,
  technical: /\b(ai|api|data|code|developer|software|cloud|platform|engine|model|chip|cyber|security|analytics|dashboard|sdk|tech\w*|automat\w*)\b/gi,
  luxury: /\b(luxury|premium|elegan\w*|exclusive|crafted|jewel\w*|fashion|perfume|watch|couture|refined|bespoke)\b/gi,
  warm: /\b(coffee|bakery|home|family|community|local|handmade|garden|recipe|food|cafe|cozy|cosy|warm)\b/gi,
  serious: /\b(report|finance|bank|invest\w*|legal|health|medical|clinic|research|policy|annual|insurance|results?)\b/gi,
  energetic: /\b(fast|speed|sport\w*|fitness|gym|run\w*|race|energy|music|festival|event|hype|sale|deal)\b/gi,
};

// The looks that suit each mood, best first.
const STYLES_FOR = {
  calm: ['editorial', 'stage', 'paper'],
  bold: ['vivid', 'stage', 'studio'],
  playful: ['vivid', 'paper', 'stage'],
  technical: ['tech', 'mono', 'studio'],
  luxury: ['studio', 'editorial', 'stage'],
  warm: ['paper', 'editorial', 'studio'],
  serious: ['paper', 'studio', 'editorial'],
  energetic: ['vivid', 'tech', 'studio'],
};

// Accent colours that sit well on each look's field. One is chosen per film.
const ACCENTS = {
  studio: ['#d9b46c', '#e8836b', '#7fd1b9', '#8fb8ff', '#c9a7ff', '#f2c14e', '#ff8fa3'],
  paper: ['#b8381c', '#2a5bd4', '#0f7b5f', '#c2410c', '#6d28d9', '#a1123f'],
  mono: ['#ffffff'],
  vivid: ['#ffd23f', '#ff6b6b', '#7cf2c8', '#ffffff', '#ffb3f0'],
  editorial: ['#c8a15a', '#d98e73', '#9fb98a', '#a8b8d8', '#d4b483'],
  stage: ['#6fa8ff', '#c7a2ff', '#ff9f6f', '#6ff0c0', '#ffd36f', '#ff7aa8'],
  tech: ['#4fd1ff', '#8b7bff', '#3dffa8', '#ffb547', '#ff6ad5'],
};

// Fields for the vivid look, which changes colour scene by scene.
const VIVID_FIELDS = ['#1f3bff', '#111114', '#0b6b4f', '#7a1fff', '#c2410c', '#0a5bd4'];

// Colour names a brief may use for its brand.
const COLOUR_WORDS = {
  red: '#e5484d', crimson: '#c9184a', orange: '#f76b15', amber: '#ffb224', gold: '#d9b46c', yellow: '#ffd23f',
  lime: '#99d52a', green: '#30a46c', emerald: '#10b981', mint: '#7fd1b9', teal: '#12a594', cyan: '#4fd1ff',
  blue: '#3e63dd', navy: '#3451b2', indigo: '#6e56cf', violet: '#8e4ec6', purple: '#8e4ec6', lilac: '#c9a7ff',
  pink: '#e93d82', magenta: '#d6409f', coral: '#e8836b', peach: '#ff9f6f', brown: '#a07553', copper: '#c27c4e',
};

// Tempo ranges in beats a minute, by mood.
const BPM = {
  calm: [84, 98], luxury: [88, 104], warm: [94, 108], serious: [98, 112],
  technical: [110, 124], playful: [112, 126], bold: [114, 128], energetic: [120, 132],
};

// The music each mood leans to.
const SCORES_FOR = {
  calm: ['keys', 'cinematic', 'soft'], luxury: ['keys', 'soft', 'cinematic'], warm: ['keys', 'bounce', 'soft'], serious: ['cinematic', 'keys', 'pulse'],
  technical: ['arp', 'pulse', 'drive'], playful: ['bounce', 'keys'], bold: ['drive', 'pulse', 'cinematic'], energetic: ['drive', 'bounce', 'arp'],
};

// What each look may cut with and how its words may arrive; a film takes two
// or three of each so it stays consistent within itself.
const TRANSITION_POOL = {
  studio: ['push', 'fade', 'zoom', 'wipe'], paper: ['wipe', 'cut', 'push', 'slide'], mono: ['cut', 'dip', 'wipe'],
  vivid: ['slide', 'push', 'wipe', 'zoom'], editorial: ['fade', 'dip', 'zoom'], stage: ['fade', 'zoom', 'push'],
  tech: ['zoom', 'wipe', 'push', 'slide'],
};
const ENTER_POOL = {
  title: ['letters', 'mask-up', 'focus', 'soft', 'words'],
  line: ['mask-up', 'rise', 'soft', 'words', 'wipe'],
  small: ['rise', 'fade', 'soft'],
  list: ['rise', 'slide-right', 'wipe', 'soft'],
};
// Entrances that suit each look; anything else is left out of its pool.
const ENTER_FITS = {
  mono: ['type', 'fade', 'wipe', 'mask-up'], editorial: ['focus', 'fade', 'soft', 'mask-up', 'words'],
  stage: ['soft', 'focus', 'mask-up', 'rise'],
};
const BACKGROUND_POOL = {
  studio: ['grain', 'vignette', 'field'], paper: ['grid', 'solid', 'dots'], mono: ['dots', 'solid', 'grid'],
  vivid: ['solid', 'grain'], editorial: ['vignette', 'grain'], stage: ['vignette', 'solid'], tech: ['field', 'grid', 'dots'],
};
// Small marks that run through a whole film: a running index, corner marks, a
// ring field behind titles. Each look takes those that suit it.
const MOTIF_POOL = {
  studio: ['arcs', 'index', 'rings', 'none'], paper: ['index', 'corners', 'arcs'], mono: ['index', 'corners', 'none'],
  vivid: ['arcs', 'rings', 'none'], editorial: ['arcs', 'index', 'none'], stage: ['arcs', 'rings', 'none'], tech: ['index', 'corners', 'rings', 'arcs'],
};
// Camera moves a scene can make over its length.
export const CAMERAS = ['push', 'pull', 'drift-left', 'drift-right', 'rise', 'still'];

// How many compositions each kind of scene has in the compiler.
export const LAYOUTS = { hook: 5, statement: 5, title: 3, stat: 3, list: 3, end: 2, quote: 2, logo: 2 };

// ---- seeded numbers ----------------------------------------------------------

export function hashSeed(...parts) {
  let h = 0x811c9dc5;
  for (const ch of parts.map((p) => String(p ?? '')).join('|')) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const pickOf = (r, list) => list[Math.floor(r() * list.length) % list.length];
function shuffle(r, list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---- reading the brief ---------------------------------------------------------

// The mood a brief asks for: the model's own word when it gave one, else the
// mood whose words the brief uses most, else the one a seed picks.
export function readMood(brief, look = {}, r = Math.random) {
  if (MOODS.includes(look.mood)) return look.mood;
  const text = String(brief || '');
  let best = null, most = 0;
  for (const [mood, re] of Object.entries(MOOD_WORDS)) {
    const n = (text.match(re) || []).length;
    if (n > most) { most = n; best = mood; }
  }
  return best || pickOf(r, ['bold', 'luxury', 'technical', 'calm', 'warm']);
}

// A brand colour the brief names: a hex code first, then a colour word.
export function briefColour(brief) {
  const text = String(brief || '');
  const hex = text.match(/#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/i);
  if (hex && parseColor(hex[0])) return toHex(parseColor(hex[0]));
  const word = text.toLowerCase().match(new RegExp(`\\b(${Object.keys(COLOUR_WORDS).join('|')})\\b`));
  return word ? COLOUR_WORDS[word[1]] : null;
}

// An accent that reads on the field: at least 3 to 1 for large type.
function readableAccent(candidate, palette) {
  const c = candidate && parseColor(candidate) ? toHex(parseColor(candidate)) : null;
  return c && contrast(c, palette.bg) >= 3 ? c : null;
}

// ---- the direction -----------------------------------------------------------------

// opts: { brief, look: { mood, accent, tempo }, style: 'auto' | a look, take }
export function chooseDirection({ brief = '', look = {}, style = 'auto', take = 0 } = {}) {
  const seed = hashSeed(brief, take);
  const r = rng(seed);
  const mood = readMood(brief, look || {}, r);
  const chosen = STYLE_NAMES.includes(style) ? style : pickOf(r, [...STYLES_FOR[mood], STYLES_FOR[mood][0]]);
  const pack = STYLE_PACKS[chosen];
  const palette = { ...pack.palette };

  const wanted = readableAccent(look?.accent, palette) || readableAccent(briefColour(brief), palette);
  palette.accent = wanted || pickOf(r, ACCENTS[chosen]);
  if (chosen === 'vivid') {
    palette.bg = pickOf(r, VIVID_FIELDS.filter((f) => contrast(palette.ink, f) >= 4.5));
    if (contrast(palette.accent, palette.bg) < 3) palette.accent = '#ffffff';
  }

  const [lo, hi] = BPM[mood];
  const shift = look?.tempo === 'slow' ? -10 : look?.tempo === 'fast' ? 10 : 0;
  const bpm = Math.round(Math.min(140, Math.max(78, lo + r() * (hi - lo) + shift)));
  const score = pickOf(r, SCORES_FOR[mood]);
  // The key, as semitones from the score's home key, and which of its chord
  // progressions it plays.
  const key = Math.floor(r() * 12) - 5;
  const progression = Math.floor(r() * 3);

  const fits = ENTER_FITS[chosen];
  const enter = {};
  for (const [role, pool] of Object.entries(ENTER_POOL)) {
    const usable = fits ? pool.filter((p) => fits.includes(p)) : pool;
    enter[role] = usable.length ? pickOf(r, usable) : pack.enter[role];
  }
  if (chosen === 'mono') enter.title = enter.line = 'type';

  const transitions = shuffle(r, TRANSITION_POOL[chosen]).slice(0, 2 + Math.floor(r() * 2));
  const background = { ...pack.background, kind: pickOf(r, BACKGROUND_POOL[chosen]) };
  const motif = pickOf(r, MOTIF_POOL[chosen]);
  const cameras = shuffle(r, CAMERAS.filter((c) => c !== 'still')).slice(0, 3);
  const layoutOffset = Math.floor(r() * 6);

  return {
    seed, take, mood, style: chosen, palette, bpm, score, key, progression,
    enter, transitions, background, motif, cameras, layoutOffset,
  };
}

// Which composition a scene of this kind takes: turning through the kind's
// layouts from the film's own starting point, so two films of the same
// storyboard differ, and the same kind twice in one film looks different.
export function layoutFor(direction, kind, occurrence) {
  const n = LAYOUTS[kind] || 1;
  if (!direction || n === 1) return 0;
  return (direction.layoutOffset + occurrence + (kind.length % 3)) % n;
}

// The camera move of the i-th scene, as zoom and pan pairs over its length.
export function cameraFor(direction, i, base) {
  if (!direction) return base;
  const move = direction.cameras[i % direction.cameras.length];
  const z = Math.abs((base.zoom?.[1] ?? 1) - (base.zoom?.[0] ?? 1)) || 0.035;
  switch (move) {
    case 'pull': return { zoom: [1 + z, 1] };
    case 'drift-left': return { zoom: [1.02, 1.02 + z / 2], x: [0.01, -0.01] };
    case 'drift-right': return { zoom: [1.02, 1.02 + z / 2], x: [-0.01, 0.01] };
    case 'rise': return { zoom: [1.02, 1.02 + z / 2], y: [0.008, -0.008] };
    default: return { zoom: [1, 1 + z] };
  }
}

// One line about the direction, for the person and for the model.
const KEY_NAMES = ['A', 'B flat', 'B', 'C', 'C sharp', 'D', 'E flat', 'E', 'F', 'F sharp', 'G', 'A flat'];
export function describeDirection(d) {
  const keyName = KEY_NAMES[((d.key % 12) + 12) % 12];
  return `${STYLE_PACKS[d.style].label} look, ${d.mood} mood, accent ${d.palette.accent}, ${d.bpm} beats a minute, ${d.score} score in ${keyName}`;
}
