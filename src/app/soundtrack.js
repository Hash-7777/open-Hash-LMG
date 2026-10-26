// The film's sound, built once per version of the film and shared by the
// preview and the export: the score fitted to the cuts, with every spoken
// clip laid at its line's time and the music lowered under it, mastered.
//
// Building it takes a moment for a long film, so it is cached by everything it
// depends on and yields to the page between stages.

import { makeScore } from '../core/audio/score.js';
import { decodeWav, toMono48k, base64ToBytes } from '../core/audio/wav.js';
import { media } from '../platform/index.js';

function keyOf(scene) {
  return JSON.stringify({
    d: scene.duration, b: scene.bpm, sd: scene.seed, s: scene.sound,
    sc: scene.scenes.map((S) => [S.name, S.start, S.duration]),
    v: scene.voice.lines.map((l) => [l.scene, l.at, l.clip]), duck: scene.voice.duck,
    f: footageOf(scene).map((c) => [c.media, c.t, c.from, c.length, c.gain]),
  });
}

const SR = 48000;
const flat = (layers) => layers.flatMap((L) => [L, ...flat(L.layers || [])]);

// The sound each clip of footage brings, and the film's own sound clips:
// [{ media, t, from, length, gain, fadeIn, fadeOut }] in film and file seconds.
export function footageOf(scene) {
  const out = [];
  for (const S of scene.scenes) {
    for (const L of flat(S.layers)) {
      const a = scene.assets[L.asset];
      // Sound plays at its own speed only: footage slowed or sped is drawn silent.
      if (L.type !== 'video' || !a || a.kind !== 'video' || !a.audio || L.muted || L.volume <= 0 || L.rate !== 1) continue;
      out.push({ media: a.media, t: S.start + L.at, from: L.from, length: L.until - L.at, gain: L.volume, fadeIn: 0.02, fadeOut: 0.02 });
    }
  }
  for (const c of scene.sound.clips || []) {
    const a = scene.assets[c.asset];
    if (a) out.push({ media: a.media, t: c.at, from: c.from, length: c.length, gain: c.volume, fadeIn: Math.max(0.02, c.fadeIn), fadeOut: Math.max(0.02, c.fadeOut) });
  }
  return out;
}

// Files decoded to stereo at 48 kHz, kept while the film being built uses
// them: a song decoded whole is large, so one the film no longer uses is let go.
const decoded = new Map();
function decodeMedia(id) {
  if (!decoded.has(id)) {
    decoded.set(id, (async () => {
      const file = await media.read(id);
      const buf = await new OfflineAudioContext(2, SR, SR).decodeAudioData(await file.arrayBuffer());
      const left = buf.getChannelData(0);
      return { left, right: buf.numberOfChannels > 1 ? buf.getChannelData(1) : left };
    })().catch((err) => { decoded.delete(id); throw err; }));
  }
  return decoded.get(id);
}

// Each piece of sound cut from its file and faded at both ends.
async function bedsOf(scene) {
  const out = [];
  const used = footageOf(scene);
  for (const id of [...decoded.keys()]) if (!used.some((c) => c.media === id)) decoded.delete(id);
  for (const c of used) {
    let src;
    try { src = await decodeMedia(c.media); } catch { continue; }
    const a = Math.round(c.from * SR), n = Math.max(0, Math.min(Math.round(c.length * SR), src.left.length - a));
    if (n <= 0) continue;
    const left = src.left.slice(a, a + n), right = src.right.slice(a, a + n);
    const fi = Math.round(c.fadeIn * SR), fo = Math.round(c.fadeOut * SR);
    for (let i = 0; i < n; i++) {
      const g = Math.min(1, i / Math.max(1, fi), (n - 1 - i) / Math.max(1, fo));
      left[i] *= g; right[i] *= g;
    }
    out.push({ t: c.t, left, right, gain: c.gain });
  }
  return out;
}

// Spoken clips placed at film time: [{ t, samples }] in mono at 48 kHz.
export function voicesOf(scene) {
  const out = [];
  for (const line of scene.voice.lines) {
    const clip = line.clip ? scene.assets[line.clip] : null;
    const S = scene.scenes.find((x) => x.id === line.scene);
    if (!clip || !S) continue;
    try {
      const bytes = base64ToBytes(clip.data.split(',')[1]);
      out.push({ t: S.start + line.at, samples: toMono48k(decodeWav(bytes)) });
    } catch { /* a clip that will not decode is left out of the mix */ }
  }
  return out;
}

let cached = { key: '', promise: null };

// Resolves to { left, right, sampleRate } or null when the film is silent.
export function soundtrackFor(scene) {
  const key = keyOf(scene);
  if (cached.key === key && cached.promise) return cached.promise;
  const promise = bedsOf(scene).then((beds) => makeScore(scene, {
    seed: scene.seed,
    voices: voicesOf(scene),
    beds,
    onStage: () => new Promise((r) => setTimeout(r, 0)),
  })).catch((err) => { if (cached.key === key) cached = { key: '', promise: null }; throw err; });
  cached = { key, promise };
  return promise;
}

export function soundtrackReady(scene) {
  return cached.key === keyOf(scene) && cached.promise !== null;
}
