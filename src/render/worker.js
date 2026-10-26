// The render worker: draws frames off the page's thread, on an OffscreenCanvas,
// for the preview, the checks and the export alike.
//
// It draws either a scene plan (with the engine) or model-written code (a
// module loaded after the lockdown, so that code meets a worker with no
// network, storage, timers or threads). A model's composing code runs here
// too, behind the same walls, and only hands back the notes it placed. Every request carries an id and gets
// exactly one answer: { id, ok, ... } or { id, ok: false, error }.

import { createKit } from '../core/engine/kit.js';
import { renderPlan } from '../core/engine/render-plan.js';
import { lockdown } from './lockdown.js';
import { runComposition } from '../core/audio/music-kit.js';

let canvas = null, ctx = null, scratch = null, sctx = null;
let scene = null, kit = null, render = null, assets = {};

const { keep } = lockdown(self, { seed: 7 });

function reply(msg, transfer) { keep.post(msg, transfer || []); }

function ensureCanvas(w, h) {
  if (!canvas || canvas.width !== w || canvas.height !== h) {
    canvas = new OffscreenCanvas(w, h);
    ctx = canvas.getContext('2d', { alpha: false });
    scratch = new OffscreenCanvas(w, h);
    sctx = scratch.getContext('2d', { alpha: false });
    kit = null;
  }
}

function makeKit(target) {
  const k = createKit(target, {
    width: scene.width, height: scene.height, fps: scene.fps, bpm: scene.bpm, seed: scene.seed,
    palette: scene.palette, assets, makeCanvas: (w, h) => new OffscreenCanvas(w, h),
  });
  k.duration = scene.duration;
  k.scene = scene;
  return k;
}

function drawAt(target, t, collect) {
  const k = target === ctx ? (kit ||= makeKit(ctx)) : makeKit(target);
  if (render) {
    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalAlpha = 1;
    if (collect) k.collectInto(collect);
    try { render(t, k); } finally { if (collect) k.collectInto(null); target.restore(); }
  } else {
    renderPlan(k, scene, t, collect ? { collect } : {});
  }
}

// One frame, with optional motion blur: `samples` sub-frames across the shutter
// (a fraction of the frame interval), averaged in turn. A 180-degree shutter
// (0.5) is the film look.
function frame(t, blur) {
  const samples = Math.max(1, Math.min(16, blur?.samples || 1));
  if (samples === 1) { drawAt(ctx, t); return; }
  const shutter = (blur.shutter ?? 0.5) / scene.fps;
  for (let i = 0; i < samples; i++) {
    const ti = Math.max(0, t + (i / (samples - 1) - 0.5) * shutter);
    drawAt(sctx, ti);
    ctx.globalAlpha = 1 / (i + 1);
    ctx.drawImage(scratch, 0, 0);
  }
  ctx.globalAlpha = 1;
}

async function loadModule(source) {
  if (!keep.makeUrl || !keep.Blob) throw new Error('This system cannot load model-written code.');
  const url = keep.makeUrl(new keep.Blob([source], { type: 'text/javascript' }));
  try { return await import(url); } finally { if (keep.dropUrl) keep.dropUrl(url); }
}

async function loadCode(source) {
  render = null;
  if (!source) return;
  const mod = await loadModule(source);
  const fn = mod.default || mod.render;
  if (typeof fn !== 'function') throw new Error('The code has no render function.');
  render = fn;
}

// Footage frames arrive with each request, named for the layer that shows
// them; the picture each replaces is let go.
function takeFrames(frames) {
  for (const [k, bmp] of Object.entries(frames || {})) {
    if (assets[k] && assets[k] !== bmp) assets[k].close?.();
    assets[k] = bmp;
  }
}

self.onmessage = async (e) => {
  const m = e.data || {};
  takeFrames(m.frames);
  try {
    if (m.type === 'scene') {
      scene = m.scene;
      // New pictures replace the ones held, which are let go at once; a scene
      // sent without them keeps what it has.
      if (m.assets) { for (const b of Object.values(assets)) b?.close?.(); assets = m.assets; }
      ensureCanvas(scene.width, scene.height);
      kit = null;
      reply({ id: m.id, ok: true });
    } else if (m.type === 'assets') {
      assets = m.assets || {};
      kit = null;
      reply({ id: m.id, ok: true });
    } else if (m.type === 'code') {
      await loadCode(m.code);
      kit = null;
      reply({ id: m.id, ok: true });
    } else if (m.type === 'frame') {
      ensureCanvas(scene.width, scene.height);
      frame(m.t, m.blur);
      const bitmap = canvas.transferToImageBitmap();
      reply({ id: m.id, ok: true, bitmap }, [bitmap]);
    } else if (m.type === 'pixels') {
      // The frame's RGBA pixels, for the app's own encoder; the buffer moves
      // to the page rather than being copied.
      ensureCanvas(scene.width, scene.height);
      frame(m.t, m.blur);
      const data = ctx.getImageData(0, 0, scene.width, scene.height).data;
      reply({ id: m.id, ok: true, pixels: data.buffer, width: scene.width, height: scene.height }, [data.buffer]);
    } else if (m.type === 'measure') {
      ensureCanvas(scene.width, scene.height);
      const samples = m.times.map((t) => { const boxes = []; drawAt(ctx, t, boxes); return { t, boxes }; });
      reply({ id: m.id, ok: true, samples });
    } else if (m.type === 'compose') {
      const mod = await loadModule(m.code);
      reply({ id: m.id, ok: true, notes: runComposition(mod.default || mod.compose, m.context) });
    } else if (m.type === 'trial') {
      ensureCanvas(scene.width, scene.height);
      for (const t of m.times) drawAt(ctx, t);
      reply({ id: m.id, ok: true });
    } else {
      reply({ id: m.id, ok: false, error: `Unknown request ${m.type}` });
    }
  } catch (err) {
    reply({ id: m.id, ok: false, error: String(err && err.message ? err.message : err) });
  }
};

reply({ type: 'ready' });
