// The stage of a product film (doc.stage) in the scene format: every field
// a part may carry, its range, and its default. A stage that comes back from
// a file or a model is rebuilt from these rules, so a part that names a field
// these rules do not know loses it here; a new field is added here and to the
// stage field guard in scripts/checks/stage-film.mjs in the same commit.
//
// A film with a stage still has scenes: one per part of the film, so the
// timeline shows its parts and narration lines keep their scene and time.

import { EASE_NAMES } from '../engine/ease.js';
import { ICON_NAMES } from '../engine/stage-icons.js';
import { normalizeRelease } from '../audio/release.js';

export const STAGE_PART_KINDS = ['open', 'name', 'icon', 'display', 'steps', 'split', 'hub', 'drawings', 'figures', 'ring', 'lift', 'end'];
const LIMIT = { parts: 200, keys: 400, items: 9, films: 9 };

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const num = (v, d, lo, hi) => { const n = typeof v === 'number' && Number.isFinite(v) ? v : d; return r4(Math.min(hi, Math.max(lo, n))); };
const text = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const icon = (v) => (ICON_NAMES.includes(v) ? v : '');
const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
const slug = (v) => (typeof v === 'string' ? v.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 64) : '');

const POSE_FIELDS = { o: [1, 0, 1], x: [960, -6000, 8000], y: [540, -6000, 8000], z: [0, -12000, 3000], rx: [0, -180, 180], ry: [0, -180, 180], rz: [0, -180, 180], s: [1, 0.01, 20] };
function pose(p, fields = Object.keys(POSE_FIELDS)) {
  const o = isObj(p) ? p : {};
  const out = {};
  for (const k of fields) { const [d, lo, hi] = POSE_FIELDS[k]; out[k] = num(o[k], d, lo, hi); }
  return out;
}
// [[word, at], ...]: words bound to the time each is said.
const timed = (v, D, max) => list(v, max).filter(Array.isArray).map(([w, t]) => [text(String(w ?? ''), 40), num(t, 0, 0, D)]).filter(([w]) => w);
const times = (v, D, max) => list(v, max).map((t) => num(t, 0, 0, D));
const poseKeys = (v, D, fields) => list(v, 60).filter((k) => Array.isArray(k) && k.length >= 2).map(([t, p]) => [num(t, 0, 0, D), pose(p, fields)]).sort((a, b) => a[0] - b[0]);

// What each kind keeps beyond the times every part has.
const KINDS = {
  open: (p) => ({ mark: isObj(p.mark) ? { size: num(p.mark.size, 320, 40, 2000), inset: num(p.mark.inset, 0.117, 0, 0.45), radius: num(p.mark.radius, 0.133, 0, 0.5) } : null }),
  name: (p, D) => ({ name: text(p.name, 60), expansion: timed(p.expansion, D, 12), tagline: timed(p.tagline, D, 24) }),
  end: (p) => ({ name: text(p.name, 60), line: text(p.line, 120), footnote: text(p.footnote, 160) }),
  icon: (p, D, X) => ({ asset: X.assets[slug(p.asset)]?.kind === 'image' ? slug(p.asset) : '', keys: poseKeys(p.keys, D) }),
  steps: (p, D) => ({
    items: list(p.items, LIMIT.items).filter(Array.isArray).map(([n, s, i]) => [text(n, 40), text(s, 60), icon(i)]).filter(([n]) => n),
    at: times(p.at, D, LIMIT.items),
  }),
  split: (p, D) => {
    const side = (s) => (isObj(s) ? { title: text(s.title, 40), icon: icon(s.icon), items: timed(s.items, D, 8) } : { title: '', icon: '', items: [] });
    return { left: side(p.left), right: side(p.right), arrow: num(p.arrow, 0, 0, D) };
  },
  hub: (p, D) => ({
    title: text(p.title, 40), sub: text(p.sub, 60),
    tiles: list(p.tiles, LIMIT.items).filter(Array.isArray).map(([n, s]) => [text(n, 20), text(s, 40)]).filter(([n]) => n),
    at: times(p.at, D, LIMIT.items), note: text(p.note, 80), noteAt: num(p.noteAt, 0, 0, D),
  }),
  drawings: (p, D) => ({ items: list(p.items, 4).filter(isObj).map((it) => ({ at: num(it.at, 0, 0, D), cap: text(it.cap, 60), icon: icon(it.icon) || 'frame' })) }),
  figures: (p, D) => ({ items: list(p.items, 6).filter(isObj).map((it) => ({ t: num(it.t, 0, 0, D), value: text(String(it.value ?? ''), 8), cap: text(it.cap, 40) })).filter((it) => it.value) }),
  ring: (p, D, X) => ({
    at: Array.isArray(p.at) ? [0, 1, 2].map((i) => num(p.at[i], [960, 500, -260][i], -6000, 6000)) : [960, 500, -260],
    films: list(p.films, LIMIT.films).filter((f) => isObj(f) && isObj(f.doc)).map((f) => ({ name: text(f.name, 30), doc: X.film(f.doc) })),
  }),
  display: (p, D, X) => {
    const mark = (m) => ({ t: num(m.t, 0, 0, 36000), x: typeof m.x === 'number' ? num(m.x, 0, 0, 1) : null, y: typeof m.y === 'number' ? num(m.y, 0, 0, 1) : null, click: Boolean(m.click) });
    const recordings = list(p.recordings, 12).filter((r) => isObj(r) && X.assets[slug(r.asset)]?.kind === 'video').map((r) => {
      const t0 = num(r.t0, 0, 0, D);
      return {
        asset: slug(r.asset), t0, t1: num(r.t1, t0, t0, D), fi: num(r.fi, 0.6, 0, 5), fo: num(r.fo, 0.6, 0, 5),
        map: list(r.map, 40).filter((k) => Array.isArray(k) && k.length >= 2).map(([a, b]) => [num(a, 0, -60, D + 60), num(b, 0, -60, 36000)]).sort((x, y) => x[0] - y[0]),
        points: list(r.points, 400).filter(isObj).map(mark).sort((x, y) => x.t - y.t),
      };
    });
    const pieces = list(p.pieces, 20).filter(isObj).map((q) => {
      const t0 = num(q.t0, 0, 0, D);
      const c = Array.isArray(q.crop) ? q.crop : [];
      const fx = num(c[0], 0, 0, 1), fy = num(c[1], 0, 0, 1);
      return { rec: Math.round(num(q.rec, 0, 0, 11)), t0, t1: num(q.t1, t0, t0, D), crop: [fx, fy, num(c[2], 1 - fx, 0.01, 1 - fx), num(c[3], 1 - fy, 0.01, 1 - fy)], grow: num(q.grow, 0.08, 0, 0.5) };
    }).filter((q) => q.rec < recordings.length);
    return { keys: poseKeys(p.keys, D, ['o', 'x', 'y', 'z', 'ry', 'rx']), recordings, pieces };
  },
  lift: (p, D, X) => ({
    ft0: num(p.ft0, 0, 0, 3600),
    apart: Array.isArray(p.apart) ? [0, 1, 2, 3].map((i) => num(p.apart[i], 0, 0, D)) : [0, 0, 0, 0],
    pose: poseKeys(p.pose, D, ['x', 'y', 'z', 'ry', 'rx', 's']),
    film: isObj(p.film) ? X.film(p.film) : null,
  }),
};

// X = { duration, assets, film(doc) -> a normalised film for a part to show }.
export function normalizeStage(input, X) {
  if (!isObj(input)) return null;
  const D = X.duration;
  const camera = list(input.camera, LIMIT.keys)
    .filter((k) => Array.isArray(k) && k.length >= 4)
    .map((k) => [num(k[0], 0, 0, D), num(k[1], 960, -6000, 8000), num(k[2], 540, -6000, 8000), num(k[3], 1, 0.2, 8), num(k[4], 0, -180, 180), num(k[5], 0, -180, 180), EASE_NAMES.includes(k[6]) ? k[6] : 'inOutCubic'])
    .sort((a, b) => a[0] - b[0]);
  const parts = list(input.parts, LIMIT.parts)
    .filter((p) => isObj(p) && STAGE_PART_KINDS.includes(p.kind))
    .map((p) => {
      const t0 = num(p.t0, 0, 0, D);
      const base = { kind: p.kind, t0, t1: num(p.t1, t0, t0, D), fi: num(p.fi, 0.6, 0, 5), fo: num(p.fo, 0.6, 0, 5) };
      return { ...base, ...KINDS[p.kind](p, D, X) };
    })
    .filter((p) => !(p.kind === 'lift' && !p.film) && !(p.kind === 'icon' && !p.asset) && !(p.kind === 'display' && !p.recordings.length));
  return { camera, parts };
}

// What a product film adds to a normalised film: its stage, and its score's
// settings (sound.release, kept by the score's own rules). normalize is the
// scene normaliser, for the films a part shows inside the film.
export function withProductFilm(scene, doc, normalize) {
  const release = normalizeRelease(isObj(doc.sound) ? doc.sound.release : null, scene.duration);
  const stage = normalizeStage(doc.stage, { duration: scene.duration, assets: scene.assets, film: (f) => normalize({ ...f, stage: undefined }).scene });
  let out = scene;
  if (release) out = { ...out, sound: { ...out.sound, release } };
  if (stage) out = { ...out, stage };
  return out;
}
