// When a film is looked at: the moments the film checks render and measure.
// At rest after each scene settles, in the middle of moves and transitions,
// and on every beat, with the way two measured frames are compared.

import { entranceSpan } from '../engine/motion.js';

function allLayers(layers, out = []) {
  for (const L of layers) { out.push(L); if (L.layers) allLayers(L.layers, out); }
  return out;
}

// The moments worth looking at: in each scene, just after the last entrance
// settles, and in the middle of its hold.
// How far into its entrance the opening line already is on the first frame.
export const PREROLL = 0.4;

export function sampleTimes(doc) {
  const times = [];
  doc.scenes.forEach((S, si) => {
    const layers = allLayers(S.layers);
    const settled = Math.max(0.3, ...layers.map((L) => entranceSpan(L).end));
    const next = doc.scenes[si + 1];
    const lastClean = S.duration - (next && next.transition.kind !== 'cut' ? next.transition.duration : 0) - 0.05;
    // Never inside a transition: mid-push, both scenes are partly off the frame.
    const t1 = Math.min(Math.max(settled + 0.05, S.transition.duration + 0.05), lastClean);
    times.push(+(S.start + Math.max(0, t1)).toFixed(3));
    const t2 = (t1 + lastClean) / 2;
    if (lastClean - t1 > 1) times.push(+(S.start + t2).toFixed(3));
  });
  return [...new Set(times)].filter((t) => t <= doc.duration);
}

// Moments in the middle of moves: a quarter, half and three quarters of the
// way through each transition, and half way through the entrance of each
// line of text. Words that cross other words here read as a collision even
// when every resting frame is clean.
export function motionTimes(doc) {
  const out = [];
  doc.scenes.forEach((S, si) => {
    if (si > 0 && S.transition.kind !== 'cut' && S.transition.duration > 0) {
      for (const u of [0.25, 0.5, 0.75]) out.push(S.start + S.transition.duration * u);
    }
    for (const L of allLayers(S.layers)) {
      if (L.type !== 'text') continue;
      const e = entranceSpan(L);
      if (e.end > e.start) out.push(S.start + (Math.max(0, e.start) + e.end) / 2);
    }
  });
  return [...new Set(out.map((t) => +t.toFixed(3)))].filter((t) => t > 0 && t < doc.duration).sort((a, b) => a - b);
}

// A frame on every beat, for the check that something moves on each one.
export function beatTimes(doc) {
  const beat = 60 / doc.bpm;
  const n = Math.min(480, Math.floor(doc.duration / beat));
  return Array.from({ length: n + 1 }, (_, k) => +(k * beat + 0.001).toFixed(3)).filter((t) => t < doc.duration);
}

// How far anything moved between two frames, in pixels: the largest change in
// any drawn box's place, size or opacity (a full fade counts as 100). A change
// of scale counts by how far it moves the frame's edges, since a camera push
// that barely grows a short word still moves the whole picture. A frame that
// draws a different number of things has changed.
// Half the long side of a frame, in pixels.
const EDGE = 960;

export function frameShift(a, b) {
  if (a.length !== b.length) return Infinity;
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const p = a[i], q = b[i];
    const grow = (Math.abs(p.w - q.w) / Math.max(1, p.w)) * EDGE;
    m = Math.max(m, Math.abs(p.x - q.x), Math.abs(p.y - q.y), Math.abs(p.h - q.h), grow, Math.abs(p.alpha - q.alpha) * 100);
  }
  return m;
}

