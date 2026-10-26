// Brings a finished film back to the length asked for.
//
// The checks hold scenes longer so their words can be read and their lines
// spoken, and fixes add words, so a film can end well past the length the
// person chose. A model's design also tends to leave air inside each scene:
// lines that arrive late, a second line that waits for the first. Once the
// film is otherwise final, each scene's timing is drawn closer together:
// arrivals come sooner and the scene ends sooner, while every entrance and
// exit keeps its own speed. The reading and narration checks are then run
// again, and a scene they would hold longer gets that time back. A film
// whose words and voice truly need more than was asked keeps what they
// need, and says so.
//
// Pure: works on a normalised scene and returns a new one.

import { readingTime, wordCount, estimateSpeech } from './format.js';
import { entranceSpan } from '../engine/motion.js';
import { normalizeScene } from './normalize.js';
import { resizeScene } from './edit.js';
import { lintScene } from './lint.js';
import { placeNarration } from './narration-timing.js';

// Within this share of the length asked for, a film is left as it is.
export const FIT_TOLERANCE = 0.03;

const allLayers = (list, out = []) => { for (const L of list) { out.push(L); if (L.layers) allLayers(L.layers, out); } return out; };

const lengthFor = (doc) => (l) => { const clip = l.clip ? doc.assets?.[l.clip] : null; return clip ? clip.duration : estimateSpeech(wordCount(l.say || l.text)); };

// Draws a scene's timing closer together: arrivals, departures, keys and
// the line spoken over it move to `arrive` of their time, and the scene ends
// at `end` of its length; how long each move takes stays as it was.
export function tighten(doc, S, end, arrive = end) {
  const D = S.duration, next = +(D * end).toFixed(3);
  const t = (v) => Math.min(next - 0.1, +(v * arrive).toFixed(3));
  for (const L of allLayers(S.layers)) {
    const toEnd = L.until >= D - 0.011;
    L.at = Math.max(0, t(L.at));
    L.until = toEnd ? next : Math.max(L.at + 0.1, t(L.until));
    if (Number.isFinite(L.in?.at)) L.in.at = t(L.in.at);
    // An exit timed against the end keeps its distance from the end.
    if (Number.isFinite(L.out?.at)) L.out.at = toEnd ? Math.max(L.at, +(next - (D - L.out.at)).toFixed(3)) : Math.min(L.until, t(L.out.at));
    for (const list of Object.values(L.keys || {})) for (const row of list) row[0] = Math.max(0, t(row[0]));
  }
  for (const l of doc.voice?.lines || []) if (l.scene === S.id) l.at = Math.max(0, t(l.at));
  S.duration = next;
}

// How far arrivals may be drawn in: never past this share of their time.
export const MIN_ARRIVE = 0.5;
const READ_MARGIN = 0.92;

// The shortest a scene can be with its arrivals drawn in to MIN_ARRIVE: every
// line that stays to the end readable before the next scene takes over, and
// a moment for the last arrival to settle.
export function shortest(doc, si) {
  const S = doc.scenes[si];
  const next = doc.scenes[si + 1];
  const handover = next && next.transition.kind !== 'cut' ? next.transition.duration : 0;
  let need = 1.2;
  for (const L of allLayers(S.layers)) {
    const span = entranceSpan(L);
    const arrived = Math.max(0, span.start * MIN_ARRIVE) + (span.end - span.start);
    if (L.until < S.duration - 0.011) { need = Math.max(need, Math.min(S.duration, L.until * MIN_ARRIVE + 0.3)); continue; }
    const exit = L.out.preset === 'none' ? 0 : Number.isFinite(L.out.at) ? S.duration - L.out.at : L.out.duration;
    // The reading check's own margin (lint.js read-time).
    const read = L.type === 'text' ? readingTime(wordCount(L.text)) * READ_MARGIN : L.type === 'counter' ? (L.count || 0) + 0.6 : 0.4;
    need = Math.max(need, arrived + read + Math.max(handover, exit) + 0.1);
  }
  if (!next) need += 1.5;
  return Math.min(S.duration, need);
}

// The checks' verdict on a film's timing: for each scene, the time it should
// get back so its words can be read and its line said. Only lines that stay
// to the end of their scene are helped by a longer scene.
function giveBack(scene) {
  const back = new Map();
  for (const is of lintScene(scene, {})) {
    if (is.code !== 'read-time' || !is.fix?.by) continue;
    const S = scene.scenes.find((x) => x.id === is.scene);
    const L = S && allLayers(S.layers).find((x) => x.id === is.layer);
    if (!L || L.until < S.duration - 0.011) continue;
    back.set(is.scene, Math.max(back.get(is.scene) || 0, is.fix.by + 0.1));
  }
  const copy = JSON.parse(JSON.stringify(scene));
  for (const g of placeNarration(copy, lengthFor(copy)).grown) back.set(g.scene, Math.max(back.get(g.scene) || 0, g.by + 0.05));
  return back;
}

// Returns { scene, cut, note }: the fitted film, the seconds taken out, and a
// sentence for the person ('' when nothing changed).
export function fitLength(doc, target) {
  if (!target || !(doc.duration > target * (1 + FIT_TOLERANCE))) return { scene: doc, cut: 0, note: '' };
  const lengths = doc.scenes.map((S) => S.duration);
  const least = doc.scenes.map((S, i) => shortest(doc, i));
  // Scenes overlap by their transitions, so the film is shorter than the sum
  // of its scenes by the same amount before and after.
  const overlap = lengths.reduce((a, b) => a + b, 0) - doc.duration;
  const room = lengths.reduce((n, D, i) => n + (D - least[i]), 0);
  const want = target + overlap - least.reduce((a, b) => a + b, 0);
  // Share of each scene's room it keeps: 0 draws it in as far as it goes.
  const keep = room > 0 ? Math.max(0, Math.min(1, want / room)) : 1;
  const d = JSON.parse(JSON.stringify(doc));
  d.scenes.forEach((S, i) => {
    const D = least[i] + keep * (lengths[i] - least[i]);
    if (D < lengths[i] - 0.01) tighten(d, S, D / lengths[i], MIN_ARRIVE + keep * (1 - MIN_ARRIVE));
  });
  let scene = normalizeScene(d).scene;
  for (let round = 0; round < 3; round++) {
    const back = giveBack(scene);
    if (!back.size) break;
    const e = JSON.parse(JSON.stringify(scene));
    for (const [id, by] of back) {
      const i = e.scenes.findIndex((x) => x.id === id);
      if (i >= 0) resizeScene(e.scenes[i], Math.min(lengths[i], +(e.scenes[i].duration + by).toFixed(3)));
    }
    scene = normalizeScene(e).scene;
  }
  if (scene.voice?.lines?.length) placeNarration(scene, lengthFor(scene));
  scene = normalizeScene(scene).scene;
  const cut = +(doc.duration - scene.duration).toFixed(2);
  if (cut < 0.05) return { scene: doc, cut: 0, note: `The film runs ${doc.duration.toFixed(1)} s against the ${target} s asked for: its words and voice need that time.` };
  const left = scene.duration > target * (1 + FIT_TOLERANCE)
    ? ` It runs ${scene.duration.toFixed(1)} s: its words and voice need the rest.`
    : '';
  return { scene, cut, note: `Brought the film back to the ${target} s asked for, ${cut.toFixed(1)} s shorter: each scene's timing drawn closer together, every line still readable and every spoken line said.${left}` };
}

// The length a change asks for, in seconds: a length it names ("to exactly
// 45 seconds", "make it 30 s"), none when it asks for a longer or slower film
// without naming one, else the length set for the film.
export function lengthAsked(text, seconds) {
  const t = String(text || '');
  const named = [...t.matchAll(/(\d+(?:\.\d+)?)\s*(?:-\s*)?(?:s\b|secs?\b|seconds?\b)/gi)].map((m) => Number(m[1])).filter((n) => n >= 3 && n <= 600);
  if (/\b(?:to|exactly|at|be|make it|cut(?: it)? to)\s+(\d+(?:\.\d+)?)\b/i.test(t) && /\b(?:seconds?|secs?|long|length|cut)\b/i.test(t)) {
    const n = Number(/\b(?:to|exactly|at|be|make it|cut(?: it)? to)\s+(\d+(?:\.\d+)?)\b(?!.*\b(?:to|exactly)\s+\d)/i.exec(t)?.[1]);
    if (n >= 3 && n <= 600) return n;
  }
  if (named.length) return named[named.length - 1];
  if (/\b(?:longer|lengthen|extend|slower|more time)\b/i.test(t)) return 0;
  return seconds || 0;
}
