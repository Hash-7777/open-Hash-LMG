// The film's sound, built once per version of the film and shared by the
// preview and the export: the score fitted to the cuts, with every spoken
// clip laid at its line's time and the music lowered under it, mastered.
//
// Building it takes a moment for a long film, so it is cached by everything it
// depends on and yields to the page between stages.

import { makeScore } from '../core/audio/score.js';
import { decodeWav, toMono48k, base64ToBytes } from '../core/audio/wav.js';

function keyOf(scene) {
  return JSON.stringify({
    d: scene.duration, b: scene.bpm, sd: scene.seed, s: scene.sound,
    sc: scene.scenes.map((S) => [S.name, S.start, S.duration]),
    v: scene.voice.lines.map((l) => [l.scene, l.at, l.clip]), duck: scene.voice.duck,
  });
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
  const promise = makeScore(scene, {
    seed: scene.seed,
    voices: voicesOf(scene),
    onStage: () => new Promise((r) => setTimeout(r, 0)),
  }).catch((err) => { if (cached.key === key) cached = { key: '', promise: null }; throw err; });
  cached = { key, promise };
  return promise;
}

export function soundtrackReady(scene) {
  return cached.key === keyOf(scene) && cached.promise !== null;
}
