// The page's side of rendering: one object that draws frames, measures them
// and tries code, whichever way this system can.
//
// WorkerHost runs the engine in src/render/worker.js on an OffscreenCanvas, off
// the page's thread, which is also the only place model-written code may run.
// InlineHost draws scene plans on a canvas in the page, for systems without
// OffscreenCanvas in workers; it cannot run code.
//
// A frame that does not come back in time means the drawing is stuck (a loop
// with no end in model code). The worker is then stopped and started again,
// and the request fails with a sentence the director can pass back.

import { createKit } from '../core/engine/kit.js';
import { renderPlan } from '../core/engine/render-plan.js';
import { base64ToBytes } from '../core/audio/wav.js';
import { createFootage } from './footage.js';

const FRAME_TIMEOUT_MS = 6000;

// The scene as the worker needs it: no media bytes (pictures travel as
// bitmaps, footage as frames), but each spoken clip's word timings, which the
// captions are drawn from.
export function forWorker(scene) {
  const { assets, ...rest } = scene;
  const spoken = Object.entries(assets || {}).filter(([, a]) => a.kind === 'audio')
    .map(([id, a]) => [id, { kind: 'audio', duration: a.duration, words: a.words || [] }]);
  return { ...rest, assets: Object.fromEntries(spoken) };
}
const lean = forWorker;

async function decodeImages(scene) {
  const out = {};
  for (const [id, a] of Object.entries(scene.assets || {})) {
    if (a.kind !== 'image') continue;
    try {
      // Decoded here rather than fetched: the content policy lets the page
      // fetch only the services it names, and a data address is not one.
      const [head, body] = a.data.split(',');
      const type = head.slice(5).split(';')[0];
      out[id] = await createImageBitmap(new Blob([base64ToBytes(body)], { type }));
    } catch { /* a picture that will not decode is drawn as nothing */ }
  }
  return out;
}

export function supportsWorkerRendering() {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined'
    && typeof OffscreenCanvas.prototype.transferToImageBitmap === 'function';
}

export class WorkerHost {
  constructor() {
    this.kind = 'worker';
    this.next = 1;
    this.pending = new Map();
    this.scene = null;
    this.code = null;
    this.images = {};
    this.imageKey = '';
    this.footage = createFootage();
    // While the preview plays, footage plays along instead of seeking.
    this.live = false;
    this.start();
  }

  start() {
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.ready = new Promise((resolve) => { this.markReady = resolve; });
    this.worker.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'ready') { this.markReady(); return; }
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.ok) p.resolve(m); else p.reject(new Error(m.error || 'Drawing failed.'));
    };
    this.worker.onerror = (e) => {
      const err = new Error(e.message || 'The drawing could not start.');
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(err); }
      this.pending.clear();
      e.preventDefault?.();
    };
  }

  // Stops a stuck worker and starts a fresh one with the same scene, without code.
  async restart() {
    this.worker.terminate();
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('The drawing took too long and was stopped. A loop that never ends is the usual cause.')); }
    this.pending.clear();
    this.start();
    const code = this.code;
    this.code = null;
    if (this.scene) await this.send({ type: 'scene', scene: lean(this.scene), assets: this.images });
    return code;
  }

  async send(msg, transfer = [], timeout = FRAME_TIMEOUT_MS) {
    await this.ready;
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { if (this.pending.has(id)) this.restart(); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ ...msg, id }, transfer);
    });
  }

  async setScene(scene) {
    this.scene = scene;
    const key = Object.keys(scene.assets || {}).filter((k) => scene.assets[k].kind === 'image').map((k) => k + ':' + scene.assets[k].data.length).join('|');
    if (key !== this.imageKey) {
      this.images = await decodeImages(scene);
      this.imageKey = key;
      // Bitmaps are copied to the worker, not moved: the page keeps its own for
      // when the worker has to be started again.
    }
    await this.send({ type: 'scene', scene: lean(scene), assets: this.images });
  }

  async setCode(code) {
    this.code = code || null;
    await this.send({ type: 'code', code: this.code }, [], 15000);
  }

  async frame(t, blur = null) {
    const frames = await this.footage.framesAt(this.scene, t, this.live);
    const m = await this.send({ type: 'frame', t, blur, frames }, Object.values(frames));
    return m.bitmap;
  }

  // A frame as RGBA bytes, drawn in the worker and moved to the page.
  async pixels(t, blur = null) {
    const frames = await this.footage.framesAt(this.scene, t, false);
    const m = await this.send({ type: 'pixels', t, blur, frames }, Object.values(frames));
    return new Uint8Array(m.pixels);
  }

  async measure(times) {
    const m = await this.send({ type: 'measure', times }, [], FRAME_TIMEOUT_MS * 2);
    return m.samples;
  }

  // Draws a few frames of the given code to see that it runs; leaves the host
  // drawing what it drew before.
  async trial(code, times) {
    const before = this.code;
    try {
      await this.setCode(code);
      await this.send({ type: 'trial', times }, [], FRAME_TIMEOUT_MS * 2);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    } finally {
      try { await this.setCode(before); } catch { /* the next setCode will say */ }
    }
  }

  dispose() { this.worker.terminate(); this.pending.clear(); this.footage.dispose(); }
}

export class InlineHost {
  constructor() {
    this.kind = 'inline';
    this.scene = null;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.images = {};
    this.footage = createFootage();
    this.live = false;
  }

  async setScene(scene) {
    this.scene = scene;
    this.canvas.width = scene.width;
    this.canvas.height = scene.height;
    this.images = await decodeImages(scene);
    this.kit = createKit(this.ctx, {
      width: scene.width, height: scene.height, fps: scene.fps, bpm: scene.bpm, seed: scene.seed,
      palette: scene.palette, assets: this.images,
      makeCanvas: (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; },
    });
  }

  async setCode(code) {
    if (code) throw new Error('This system cannot run animation code. Choose the Plan or Guided way of making the film.');
  }

  async frame(t) {
    Object.assign(this.images, await this.footage.framesAt(this.scene, t, this.live));
    renderPlan(this.kit, this.scene, t);
    return createImageBitmap(this.canvas);
  }

  async pixels(t) {
    Object.assign(this.images, await this.footage.framesAt(this.scene, t, false));
    renderPlan(this.kit, this.scene, t);
    return new Uint8Array(this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height).data.buffer);
  }

  async measure(times) {
    return times.map((t) => { const boxes = []; renderPlan(this.kit, this.scene, t, { collect: boxes }); return { t, boxes }; });
  }

  async trial() { return { ok: false, error: 'This system cannot run animation code.' }; }

  dispose() { this.footage.dispose(); }
}

export function createHost() {
  return supportsWorkerRendering() ? new WorkerHost() : new InlineHost();
}

// A contact sheet: stills at the given times, in a grid, each labelled with its
// time, as one JPEG a model that can see is shown.
export async function contactSheet(host, scene, times, { columns = 4, width = 1600 } = {}) {
  const rows = Math.ceil(times.length / columns);
  const cellW = Math.floor(width / columns);
  const cellH = Math.round((cellW * scene.height) / scene.width);
  const label = 26;
  const c = document.createElement('canvas');
  c.width = cellW * columns;
  c.height = (cellH + label) * rows;
  const g = c.getContext('2d');
  g.fillStyle = '#111';
  g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < times.length; i++) {
    const bmp = await host.frame(times[i]);
    const x = (i % columns) * cellW, y = Math.floor(i / columns) * (cellH + label);
    g.drawImage(bmp, x, y, cellW, cellH);
    bmp.close?.();
    g.fillStyle = '#ddd';
    g.font = '600 16px system-ui, sans-serif';
    g.fillText(`${times[i].toFixed(1)} s`, x + 8, y + cellH + 19);
  }
  return c.toDataURL('image/jpeg', 0.85);
}
