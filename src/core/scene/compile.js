// compileStoryboard: a storyboard of words and numbers becomes a finished scene,
// laid out and timed by rules instead of by a model.
//
// This is what lets a three-billion-parameter local model make a film that
// looks designed. The model decides what to say; this file decides where it
// sits, how big it is, how long it holds and how it moves, from the style
// pack and the rules in docs/MOTION-RULES.md:
//   - every beat holds for its words' reading time, rounded up to the music;
//   - scenes start on the beat, so cuts land with the score;
//   - one entrance family for titles, one for lines, one for lists, per style;
//   - two or three transition families, cycled, never five;
//   - a slow camera push on text scenes so nothing is ever fully still;
//   - vertical frames keep words inside the area phone apps leave clear.

import { STYLE_PACKS, readingTime, wordCount, estimateSpeech } from './format.js';
import { normalizeScene } from './normalize.js';
import { normalizeStoryboard } from './storyboard.js';
import { beatLength } from '../engine/math.js';
import { entranceSpan } from '../engine/motion.js';
import { contrast } from '../util/color.js';
import { preroll } from './samples.js';
import { layoutFor, cameraFor } from './direction.js';
import { layBeat } from './layouts.js';
import { layPictureBeat } from './picture-layouts.js';
import { layMediaBeat } from './media-layouts.js';
import { cleanPicture } from './pictures.js';

// Each style says how it marks an accent word while it holds.
const ACCENT_HOLD = { studio: 'underline', paper: 'marker', mono: 'none', vivid: 'none', editorial: 'none', tech: 'underline', stage: 'none' };

// Transitions in which both scenes share the frame for a moment.
const HANDOFF = new Set(['fade', 'zoom', 'carry']);

// How much each kind of beat is worth keeping when a storyboard runs long.
// Ties go to the earlier beat: a later one of the same kind is dropped first.
const KEEP = { hook: 9, end: 9, title: 8, logo: 8, stat: 6, statement: 5, list: 5, steps: 4, words: 4, chart: 4, compare: 3, quote: 2 };

// The vivid style changes the field colour scene by scene.
function vividBackground(i, palette) {
  const cycle = ['bg', 'accent2', 'surface'];
  return cycle[i % cycle.length];
}

export function compileStoryboard(input, opts = {}) {
  const { storyboard, notes } = input && input.beats && input.beats.every((b) => b && b.kind) ? { storyboard: input, notes: [] } : normalizeStoryboard(input);
  // The film's direction (src/core/scene/direction.js), when there is one,
  // chooses the look, palette, tempo and motion; without one the look's own
  // defaults are used.
  const D = opts.direction || null;
  const style = D?.style || (STYLE_PACKS[opts.style] ? opts.style : null) || storyboard.style || 'studio';
  const pack = STYLE_PACKS[style] || STYLE_PACKS.studio;
  const E = { ...pack.enter, ...(D?.enter || {}) };
  const aspect = opts.aspect || '16:9';
  const vertical = aspect === '9:16' || aspect === '4:5';
  const bpm = opts.bpm || D?.bpm || (style === 'editorial' ? 96 : style === 'paper' ? 108 : 120);
  const beat = beatLength(bpm);
  const palette = { ...pack.palette, ...(D?.palette || {}), ...(opts.palette || {}) };
  const accentHold = ACCENT_HOLD[style] || 'none';
  const ease = pack.ease;
  const T = D?.transitions?.length ? D.transitions : pack.transitions;
  const seen = {};

  // Vertical: the middle of the area phone video apps leave clear.
  // The clear area's centre is left of the frame's, because the right edge
  // carries the like and share buttons.
  const cy = vertical ? 0.44 : 0.5;
  const X = vertical ? 0.463 : 0.5;
  const MW = vertical ? 0.76 : 0.8;
  const left = vertical ? 0.1 : 0.12;

  const scenes = [];
  let trIndex = 0;
  // Pictured scenes so far, and scenes showing the person's own media: their
  // compositions turn across the whole film.
  let pictured = 0;
  let shown = 0;
  const beats = storyboard.beats;

  beats.forEach((b, i) => {
    let layers, entrance, camera;
    let sceneBg = style === 'vivid' ? vividBackground(i, palette) : null;
    const accentWords = b.accent || [];
    const textColor = (bgToken) => {
      if (!bgToken) return 'ink';
      const bg = palette[bgToken] || bgToken;
      return contrast(palette.ink, bg) >= 4.5 ? 'ink' : 'bg';
    };
    const ink = textColor(sceneBg);
    // The accent only where it reads: 3 to 1 for large type, 4.5 to 1 for small.
    const accentFor = (bgToken, need) => {
      const bg = palette[bgToken || 'bg'];
      return contrast(palette.accent, bg) >= need ? 'accent' : ink;
    };
    const accent = accentFor(sceneBg, 3);
    const accentSmall = accentFor(sceneBg, 4.5);
    const muted = contrast(palette.muted, palette[sceneBg || 'bg']) < 4.5 ? ink : 'muted';
    const hold = accentWords.length ? accentHold : 'none';
    // Which of this kind's compositions the scene takes.
    const occurrence = (seen[b.kind] = (seen[b.kind] ?? -1) + 1);
    const lay = layoutFor(D, b.kind, occurrence);
    const wide = !vertical;
    const c = { b, lay, X, cy, MW, left, vertical, wide, style, pack, E, ease, D, beat, opts, sceneBg, ink, accent, accentSmall, muted, hold, accentWords, aspect, inkOn: textColor };
    // A beat that shows the person's own picture or clip, or a picture the
    // model drew, takes a composition built around it; any other beat, the
    // plain one.
    const own = b.media ? opts.assets?.[b.media] : null;
    const pic = !own && b.picture ? cleanPicture(storyboard.pictures?.[b.picture]) : null;
    ({ layers, entrance, camera } = (own && layMediaBeat({ ...c, asset: own, key: b.media, occurrence: shown++ })) || (pic && layPictureBeat({ ...c, pic, occurrence: pictured++ })) || layBeat(c));

    // The film's camera moves, scene by scene; a chart and a run of single
    // words keep their own.
    if (D && b.kind !== 'chart' && b.kind !== 'words') camera = cameraFor(D, i, camera);
    // A camera drifts at one steady speed: an eased move all but stops at
    // both ends of the scene, which reads as a frozen frame.
    camera = { ease: 'linear', ...camera };
    // Marks that run through the whole film: a running index or corner marks.
    if (D?.motif === 'index' && b.kind !== 'words') {
      layers.push({ type: 'text', text: `${String(i + 1).padStart(2, '0')} / ${String(beats.length).padStart(2, '0')}`, x: vertical ? 0.1 : 0.05, y: vertical ? 0.1 : 0.07, anchor: 'left', align: 'left', size: 22, weight: 600, font: 'mono', tracking: 0.08, color: muted, opacity: 0.8, z: 5, in: { preset: 'fade', duration: 0.4 } });
    } else if (D?.motif === 'arcs' && b.kind !== 'words' && b.kind !== 'chart') {
      // One large circle, mostly off the frame, drawing itself round behind the
      // scene, with a short accent arc riding it; it moves corner to corner.
      const [ax, ay] = [[0.92, 0.88], [0.08, 0.12], [0.94, 0.1], [0.06, 0.9]][i % 4];
      const w = vertical ? 1500 : 1300;
      layers.push({ type: 'shape', shape: 'ring', x: ax, y: ay, w, fill: 'none', stroke: muted, strokeWidth: 2, opacity: 0.32, z: -2, in: { preset: 'draw', duration: 1.6, ease: 'inOutCubic' } });
      layers.push({ type: 'shape', shape: 'ring', x: ax, y: ay, w, fill: 'none', stroke: accent, strokeWidth: 3, arc: [0, 0.12], opacity: 0.8, z: -2, at: 0.2, rotate: (i * 47) % 360, in: { preset: 'draw', duration: 1.2, ease: 'inOutCubic' } });
    } else if (D?.motif === 'corners') {
      for (const [cx2, cy2, w2, h2] of [[0.04, 0.06, 40, 0], [0.04, 0.06, 0, 40], [0.96, 0.94, 40, 0], [0.96, 0.94, 0, 40]]) {
        layers.push({ type: 'shape', shape: 'line', x: cx2 + (w2 ? (cx2 < 0.5 ? 0.0104 : -0.0104) : 0), y: cy2 + (h2 ? (cy2 < 0.5 ? 0.0185 : -0.0185) : 0), w: w2, h: h2, strokeWidth: 2, color: muted, opacity: 0.7, z: 5, in: { preset: 'fade', duration: 0.4 } });
      }
    }

    // How long the beat holds. Every line must stay readable for its reading
    // time after its own entrance ends; the scene then rounds up to whole beats
    // of the music. End cards hold longer: viewers need the address.
    const probe = normalizeScene({ style, aspect, scenes: [{ duration: 60, layers }] }).scene.scenes[0]?.layers || [];
    let need = 0;
    for (const L of probe) {
      const end = entranceSpan(L).end;
      const words = L.type === 'text' ? wordCount(L.text) : 1;
      const until = L.until < 60 ? L.until : Infinity;
      if (until === Infinity) need = Math.max(need, end + (L.type === 'text' ? readingTime(words) : 0.8));
    }
    const minHold = b.kind === 'end' ? 2.6 : b.kind === 'hook' ? 1.2 : 1.4;
    const settled = Math.max(0, ...probe.map((L) => entranceSpan(L).end));
    need = Math.max(need, settled + minHold, entrance + (b.kind === 'words' ? 0.9 : 0));
    // Narration, when there is a line: the scene lasts until it has been said.
    if (b.say && opts.narration !== false) need = Math.max(need, 0.15 + estimateSpeech(wordCount(b.say)) + 0.35);
    const length = Math.ceil(need / beat - 1e-6) * beat;

    // The transition INTO this scene: titles and end cards zoom when the style
    // has a zoom; otherwise the pack's families take turns.
    let kind = 'cut';
    if (i > 0) {
      if ((b.kind === 'title' || b.kind === 'logo' || b.kind === 'end') && T.includes('zoom')) kind = 'zoom';
      else kind = T[trIndex++ % T.length];
    }
    const dirs = ['left', 'up', 'left', 'down'];
    scenes.push({
      id: `${b.kind}-${i + 1}`,
      name: b.kind,
      note: [b.text, b.sub].filter(Boolean).join(' / ').slice(0, 200),
      length,
      read: need,
      words: probe.filter((L) => L.type === 'text').reduce((n, L) => n + wordCount(L.text), 0),
      settled,
      transition: { kind, duration: kind === 'cut' ? 0 : kind === 'dip' ? Math.min(0.6, beat * 1.5) : Math.min(0.5, beat), direction: dirs[i % dirs.length], ease: 'inOutCubic' },
      background: sceneBg,
      camera,
      layers,
    });
  });

  // The same words in two scenes in a row are one element carried across:
  // the line moves and resizes into its new place instead of leaving and
  // arriving again.
  const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  scenes.forEach((S, i) => {
    if (i === 0 || S.transition.kind === 'cut') return;
    const prev = scenes[i - 1];
    for (const a of prev.layers) {
      if (a.type !== 'text' || !norm(a.text)) continue;
      const b = S.layers.find((L) => L.type === 'text' && norm(L.text) === norm(a.text));
      if (!b) continue;
      a.id = a.id || `carry-${i}-from`;
      b.id = b.id || `carry-${i}-to`;
      S.transition = { ...S.transition, kind: 'carry', duration: Math.max(S.transition.duration, Math.min(0.8, beat * 1.5)), carry: { from: a.id, to: b.id } };
      break;
    }
  });

  // A handoff, not a pile-up: after a fade or a zoom, where both scenes share
  // the frame, the new scene's words arrive as the old ones leave instead of
  // crossing them.
  scenes.forEach((S, i) => {
    if (i === 0 || !HANDOFF.has(S.transition.kind)) return;
    const by = +(S.transition.duration * 0.85).toFixed(3);
    for (const L of S.layers) {
      L.at = +((L.at || 0) + by).toFixed(3);
      if (L.in && typeof L.in === 'object' && Number.isFinite(L.in.at)) L.in.at = +(L.in.at + by).toFixed(3);
    }
    S.length += by;
    S.settled += by;
  });

  // A storyboard far longer than the length asked for loses its least
  // important beats rather than running long: one idea a shot, and only the
  // ideas that fit. The opening, the first name and the end are always kept.
  if (opts.targetDuration) {
    const total = () => scenes.reduce((n, S) => n + S.length, 0);
    const dropped = [];
    const named = scenes.find((S) => S.name === 'title' || S.name === 'logo');
    while (total() > opts.targetDuration * 1.2 && scenes.length > 3) {
      let worst = -1;
      scenes.forEach((S, i) => {
        if (i === 0 || i === scenes.length - 1 || S === named) return;
        if (worst < 0 || (KEEP[S.name] ?? 5) <= (KEEP[scenes[worst].name] ?? 5)) worst = i;
      });
      if (worst < 0) break;
      dropped.push(scenes[worst].name);
      scenes.splice(worst, 1);
    }
    if (dropped.length) notes.push(`To fit the length asked for, ${dropped.length === 1 ? 'one beat was' : `${dropped.length} beats were`} left out: ${dropped.join(', ')}.`);
  }

  // Frame one is a picture already forming, never an empty frame: what opens
  // the film begins its entrance a moment before the film does.
  if (scenes[0]?.layers?.length) preroll(scenes[0].layers);

  // A requested length stretches the holds, never shortens them below reading
  // time, and never holds a scene still for longer than its words deserve.
  const natural = scenes.reduce((n, S) => n + S.length, 0);
  if (opts.targetDuration && natural < opts.targetDuration - beat) {
    let spare = Math.floor((opts.targetDuration - natural) / beat);
    let grew = true;
    while (spare > 0 && grew) {
      grew = false;
      for (const S of scenes) {
        if (spare <= 0) break;
        const stillFor = S.length + beat - S.settled;
        const allowed = Math.max(vertical ? 3 : 4, readingTime(S.words) + 0.5) - 0.1;
        if (S.name === 'words' || stillFor > allowed) continue;
        S.length += beat; spare--; grew = true;
      }
    }
    if (spare > 1) notes.push('The storyboard is too short for the length asked for without long still holds. More beats would fill it.');
  } else if (opts.targetDuration && natural > opts.targetDuration * 1.25) {
    notes.push('The words need more time than the length asked for, so the film runs longer. Fewer words per beat would shorten it.');
  }

  // Scene duration = its own length plus the next scene's transition, so each
  // scene STARTS on the beat grid.
  const sceneDocs = scenes.map((S, i) => {
    const next = scenes[i + 1];
    const extra = next ? next.transition.duration : 0;
    const { length, read, words, settled, ...rest } = S;
    return { ...rest, duration: +(length + extra).toFixed(4) };
  });

  // The score lands a boom on the reveal: the first title or logo.
  const hits = [];
  let t = 0;
  scenes.forEach((S) => {
    if (S.name === 'title' || S.name === 'logo') { if (!hits.some((h) => h.kind === 'boom')) hits.push({ t: +t.toFixed(3), kind: 'boom' }); }
    t += S.length;
  });

  const doc = {
    title: storyboard.title,
    aspect,
    fps: opts.fps || 60,
    bpm,
    style,
    palette,
    fonts: pack.fonts,
    background: { ...pack.background, ...(D?.background || {}) },
    seed: D ? D.seed % 1e9 : undefined,
    scenes: sceneDocs,
    sound: { score: opts.score || D?.score || pack.score, hits, ...(D ? { key: D.key, progression: D.progression } : {}) },
    voice: {
      ...(opts.voice || {}),
      lines: opts.narration === false ? [] : beats.map((b, i) => (b.say ? { scene: `${b.kind}-${i + 1}`, text: b.say, at: 0.15 } : null)).filter(Boolean),
    },
    assets: opts.assets || {},
  };
  const { scene, notes: n2 } = normalizeScene(doc);
  return { scene, notes: [...notes, ...n2] };
}

