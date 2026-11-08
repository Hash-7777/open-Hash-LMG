// Draws a film whose scenes stand on the 3D stage (doc.stage): the studio,
// one camera, and the parts alive at t, each building its planes.
//
// doc.stage = {
//   camera: [[t, x, y, zoom, ry, rx, ease], ...],
//   parts:  [{ kind, t0, t1, fi, fo, ...what the kind needs }, ...],
// }
// A part is on screen from t0 to t1 plus its fade out (fo), faded in over fi.
// An icon or a display is keyed over the whole film instead (its own pose keys).
//
// Like the flat renderer, every frame is a pure function of t: the canvases
// kept here are reused between frames and painted again on each one.

import { createStage, viewFor, cameraAt } from './stage3d.js';
import { DIAGRAMS } from './diagrams.js';
import { PARTS as NAMED } from './stage-parts.js';
import { display } from './stage-display.js';
import { studioColors, ramp, win } from './stage-paint.js';
import { createKit } from './kit.js';
import { layersOf, drawFilmLayer } from './layers.js';

const PARTS = { ...NAMED, display };
export const STAGE_KINDS = [...Object.keys(DIAGRAMS), ...Object.keys(PARTS)];

// The services a part uses to draw a film inside the film, kept per kit.
const envs = new WeakMap();
function envFor(kit, doc, R) {
  let E = envs.get(kit);
  if (E && E.doc === doc) return E;
  const make = kit.makeCanvas;
  const films = new Map(), lifted = new Map(), dims = new WeakMap(), splits = new WeakMap();
  const kitOn = (c, film) => createKit(c.getContext('2d'), {
    width: c.width, height: c.height, fps: film.fps, bpm: film.bpm, seed: film.seed, palette: film.palette, assets: kit.assets || {}, makeCanvas: make,
  });
  E = {
    doc,
    C: studioColors(doc.palette),
    assets: kit.assets || {},
    stage: createStage({ makeCanvas: make }),
    film(film, t, w, h, key) {
      let F = films.get(key);
      if (!F || F.film !== film || F.c.width !== w || F.c.height !== h) { const c = make(w, h); F = { film, c, kit: kitOn(c, film) }; films.set(key, F); }
      R.renderPlan(F.kit, film, t);
      return F.c;
    },
    filmLayers(film, t, key) {
      let L = lifted.get(key);
      const w = film.width || 1920, h = film.height || 1080;
      if (!L || L.film !== film) {
        if (!splits.has(film)) splits.set(film, layersOf(film));
        const one = () => { const c = make(w, h); return { c, kit: kitOn(c, film) }; };
        L = { film, split: splits.get(film), back: one(), shapes: one(), words: one(), mask: one() };
        lifted.set(key, L);
      }
      R.renderPlan(L.back.kit, L.split.back, t);
      for (const k of ['shapes', 'words']) {
        const g = L[k].kit.ctx;
        g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h); g.restore();
        drawFilmLayer(L[k].kit, L.split[k], t, L.mask, R);
      }
      return { back: L.back.c, shapes: L.shapes.c, words: L.words.c };
    },
    darkened(img, shade) {
      let d = dims.get(img);
      if (!d) {
        const w = img.width || 320, h = img.height || 320;
        d = make(w, h);
        const g = d.getContext('2d');
        g.drawImage(img, 0, 0, w, h);
        g.globalCompositeOperation = 'source-atop';
        g.fillStyle = `rgba(0,0,0,${(1 - shade).toFixed(3)})`;
        g.fillRect(0, 0, w, h);
        dims.set(img, d);
      }
      return d;
    },
  };
  envs.set(kit, E);
  return E;
}

// The camera and every plane on the stage at t.
export function stageFrame(doc, t, env) {
  const S = doc.stage;
  const planes = [];
  (S.parts || []).forEach((part, index) => {
    const build = DIAGRAMS[part.kind] || PARTS[part.kind];
    if (!build) return;
    // The icon and the display are keyed over the whole film by their own poses.
    if (part.kind === 'icon' || part.kind === 'display') { planes.push(...build(part, t, 1, env, index)); return; }
    const fi = part.fi ?? 0.6, fo = part.fo ?? 0.6;
    if (t < part.t0 - 0.01 || t > part.t1 + fo + 0.01) return;
    const a = win(t, part.t0, part.t1 + fo, fi, fo);
    if (a <= 0.001) return;
    planes.push(...build(part, t, a, DIAGRAMS[part.kind] ? env.C : env, index));
  });
  return { camera: cameraAt(S.camera, t), planes };
}

// The film opens out of the studio's own colour and closes back into it.
export function veilAt(doc, t) {
  return Math.max(1 - ramp(t, 0, 0.6), ramp(t, doc.duration - 1.4, doc.duration));
}

export function renderStage(kit, doc, t, R, opts = {}) {
  const { W, H } = kit;
  const ctx = kit.ctx;
  const env = envFor(kit, doc, R);
  const C = env.C;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, C.top); g.addColorStop(0.58, C.mid); g.addColorStop(1, C.floor);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  let drawn = [];
  if (kit.makeCanvas) drawn = env.stage.draw(ctx, stageFrame(doc, t, env), viewFor(W, H));
  const v = veilAt(doc, t);
  if (v > 0.001) { ctx.globalAlpha = v; ctx.fillStyle = C.veil; ctx.fillRect(0, 0, W, H); }
  ctx.restore();
  // For the checks: every plane that carries words, as its box on the frame.
  if (opts.collect) {
    for (const d of drawn) {
      if (!d.plane.text) continue;
      const xs = d.corners.map((c) => c[0]), ys = d.corners.map((c) => c[1]);
      opts.collect.push({ kind: 'plane', tag: d.id, x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), alpha: d.pose.o, text: d.plane.text.filter(Boolean).join(' ').slice(0, 80) });
    }
  }
  return drawn;
}
