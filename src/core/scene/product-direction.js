// The direction of a product film: what makes one product's film its own.
// The same planner and the same diagrams would otherwise give every product
// the same film with new words; a direction chooses, for each film anew:
//
//   tone      the room: a white studio, a night studio, or warm paper
//   order     the order its diagrams come in
//   variants  the frame the film opens on (wide, tall or square), and how
//             each diagram stands: steps on an arc, up a ladder or in a
//             row; the two sides facing or opening like a book; what is built
//             in fanned out under its chip or in orbit around it; drawings
//             turning in or rising; figures tipping up from the floor or
//             dropping from above
//   camera    calm, sweeping, or low and looking up
//   motif     the score's own tune
//
// Every choice keeps the rules every film is held to (no flicker, no word
// covered, every moment on its word), so variety never costs polish. The
// canonical direction is the one the reference film was made with.

import { rand } from '../engine/math.js';

export const TONES = ['studio', 'night', 'paper'];
export const CAMERAS = ['calm', 'sweep', 'low'];
export const VARIANTS = {
  open: ['wide', 'tall', 'square'],
  steps: ['arc', 'ladder', 'row'],
  split: ['facing', 'book'],
  hub: ['fan', 'orbit'],
  drawings: ['arc', 'rise'],
  figures: ['floor', 'drop'],
};
export const DIAGRAM_ORDER = ['steps', 'split', 'hub', 'yours', 'figures'];
// Where the planner's parts stand; the diagram slots take the direction's order.
const SEQUENCE = ['steps', 'lift', 'split', 'hands', 'exporting', 'hub', 'looks', 'yours', 'figures'];
const MOTIFS = [[4, 7, 11, 9], [7, 4, 9, 11], [0, 4, 7, 12], [2, 7, 9, 14], [4, 9, 7, 11], [7, 11, 14, 12], [0, 7, 4, 9], [9, 7, 4, 7]];

export const CANON = {
  tone: 'studio', camera: 'calm', order: [...DIAGRAM_ORDER],
  variants: { open: 'wide', steps: 'arc', split: 'facing', hub: 'fan', drawings: 'arc', figures: 'floor' },
  motif: MOTIFS[0],
};

const hash = (s) => [...String(s)].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) >>> 0, 2166136261);

// A direction for this product and this take: the same name and take give
// the same film, a new take a new one.
export function productDirection(name, take = 0) {
  const r = rand(hash(`${name}|${take}`) || 1);
  // The first draws of a seeded stream lean on the seed; let them go.
  for (let i = 0; i < 4; i++) r();
  const one = (list) => list[Math.floor(r() * list.length) % list.length];
  const order = [...DIAGRAM_ORDER];
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  // Figures land best late, just before the end card.
  if (order.indexOf('figures') < order.length - 2) { order.splice(order.indexOf('figures'), 1); order.splice(order.length - (r() < 0.5 ? 0 : 1), 0, 'figures'); }
  return {
    tone: one(TONES), camera: one(CAMERAS), order,
    variants: Object.fromEntries(Object.entries(VARIANTS).map(([k, v]) => [k, one(v)])),
    motif: one(MOTIFS),
  };
}

// A direction as the planner may trust it: anything unknown is the canonical one.
export function normalizeDirection(d) {
  const o = d && typeof d === 'object' ? d : {};
  const order = Array.isArray(o.order) && o.order.length === DIAGRAM_ORDER.length && DIAGRAM_ORDER.every((k) => o.order.includes(k)) ? [...o.order] : [...CANON.order];
  return {
    tone: TONES.includes(o.tone) ? o.tone : CANON.tone,
    camera: CAMERAS.includes(o.camera) ? o.camera : CANON.camera,
    order,
    variants: Object.fromEntries(Object.entries(VARIANTS).map(([k, v]) => [k, v.includes(o.variants?.[k]) ? o.variants[k] : CANON.variants[k]])),
    motif: Array.isArray(o.motif) && o.motif.length >= 2 && o.motif.every(Number.isInteger) ? [...o.motif] : [...CANON.motif],
  };
}

// The planner's parts in the order this direction runs them.
export function sequence(D) {
  let k = 0;
  return SEQUENCE.map((x) => (DIAGRAM_ORDER.includes(x) ? D.order[k++] : x));
}

// A camera key [t, x, y, zoom, ry, rx, ease] in this direction's manner:
// sweeping turns further and pushes in deeper; low drops and looks up.
export function cameraKey(D, k) {
  const [t, x, y, zoom, ry, rx, ease] = k;
  if (D.camera === 'sweep') return [t, x, y, Math.round((1 + (zoom - 1) * 1.35) * 1000) / 1000, ry * 1.8 + (ry === 0 ? 0 : Math.sign(ry) * 2), rx, ease];
  if (D.camera === 'low') return [t, x, y + 30, zoom, ry, rx - 4, ease];
  return k;
}
