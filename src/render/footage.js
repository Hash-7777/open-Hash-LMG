// Frames of imported footage, for the render worker.
//
// The page keeps one hidden video element a clip, playing through the
// system's own decoder, and works out which clips are on screen at a moment
// and where in each file that is. For a still or an export it seeks each one
// exactly and waits for the frame; while the preview plays, the videos play
// along and are only pulled back when they drift. Each frame goes to the
// worker as a picture, named for the layer that shows it.

import { media } from '../platform/index.js';

const SEEK_TIMEOUT_MS = 4000;
const DRIFT = 0.2; // seconds a playing clip may wander before it is pulled back

const flat = (layers) => layers.flatMap((L) => [L, ...flat(L.layers || [])]);

// The footage on screen at film time t: [{ key, asset, time, rate }], `time`
// being the moment in the file. Scenes overlapping in a transition both count.
export function clipsAt(scene, t) {
  const out = [];
  for (const S of scene.scenes) {
    if (t < S.start - 1e-6 || t >= S.start + S.duration) continue;
    const local = t - S.start;
    for (const L of flat(S.layers)) {
      if (L.type !== 'video' || local < L.at - 1e-6 || local >= L.until) continue;
      const a = scene.assets[L.asset];
      if (!a || a.kind !== 'video') continue;
      const end = Math.max(0, (a.duration || Infinity) - 0.04);
      out.push({ key: `video:${L.id}`, asset: L.asset, time: Math.min(end, Math.max(0, L.from + (local - L.at) * L.rate)), rate: L.rate });
    }
  }
  return out;
}

export function createFootage() {
  const players = new Map(); // asset id -> { el, ready }

  function player(assetId, asset) {
    let p = players.get(assetId);
    if (p && p.media === asset.media) return p;
    if (p) p.el.removeAttribute('src');
    const el = document.createElement('video');
    el.muted = true; // the film's sound is mixed into its soundtrack, not played here
    el.playsInline = true;
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    el.src = media.url(asset.media);
    const ready = new Promise((resolve, reject) => {
      el.addEventListener('loadeddata', () => resolve(), { once: true });
      el.addEventListener('error', () => reject(new Error(`The footage "${asset.name}" could not be read here.`)), { once: true });
    });
    ready.catch(() => {});
    p = { el, ready, media: asset.media };
    players.set(assetId, p);
    return p;
  }

  function seek(el, time) {
    if (Math.abs(el.currentTime - time) < 0.001 && el.readyState >= 2) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => { clearTimeout(timer); el.removeEventListener('seeked', done); resolve(); };
      const timer = setTimeout(done, SEEK_TIMEOUT_MS);
      el.addEventListener('seeked', done);
      el.currentTime = time;
    });
  }

  return {
    // Pictures of the footage on screen at t, keyed for the worker.
    // live: the preview is playing, so the clips play along.
    async framesAt(scene, t, live = false) {
      const clips = scene ? clipsAt(scene, t) : [];
      const out = {};
      const showing = new Set(clips.map((c) => c.asset));
      for (const [id, p] of players) if (!showing.has(id) && !p.el.paused) p.el.pause();
      for (const c of clips) {
        const p = player(c.asset, scene.assets[c.asset]);
        try { await p.ready; } catch { continue; }
        const el = p.el;
        if (live) {
          el.playbackRate = c.rate;
          if (Math.abs(el.currentTime - c.time) > DRIFT) el.currentTime = c.time;
          if (el.paused) el.play().catch(() => {});
        } else {
          if (!el.paused) el.pause();
          await seek(el, c.time);
        }
        try { out[c.key] = await createImageBitmap(el); } catch { /* a frame not decoded yet is drawn as nothing */ }
      }
      return out;
    },
    pause() { for (const p of players.values()) p.el.pause(); },
    dispose() {
      for (const p of players.values()) { p.el.pause(); p.el.removeAttribute('src'); p.el.load(); }
      players.clear();
    },
  };
}
