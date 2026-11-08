// The release score and its mix: its settings survive normalising, the band
// carved out of the music lines up with the music (no phase shift), the music
// is lowered by the full dip under every line, the master lands at -14 LUFS
// with true peaks under -1 dBTP, the beat sections differ as written, and the
// same film always makes the same sound.

import { section, ok, claim, done } from './lib/check.mjs';
import assert from 'node:assert/strict';
import { normalizeScene } from '../../src/core/scene/normalize.js';
import { makeRelease, releaseScore, duckShape, normalizeRelease, RELEASE_DEFAULTS } from '../../src/core/audio/release.js';
import { makeScore } from '../../src/core/audio/score.js';
import { bandZeroPhase, bandGain } from '../../src/core/audio/filters.js';
import { SR } from '../../src/core/audio/synth.js';
import { integratedLufs } from '../../src/core/audio/master.js';

const RELEASE = { motif: [4, 7, 11, 9], bright: true, sections: [[0, 'still'], [4.8, 'move'], [9.6, 'lift'], [14.4, 'out']], hits: [4.8, 9.6, 14.4], cues: [[2, 'click'], [6, 'type', 1.2]], duck: 11, carve: 6, music: 0 };
const scenes = RELEASE.sections.map(([t], i) => ({ id: `part-${i}`, duration: (RELEASE.sections[i + 1]?.[0] ?? 19.2) - t, transition: { kind: 'cut' } }));
const DOC = normalizeScene({ bpm: 100, scenes, sound: { score: 'release', key: -5, release: RELEASE } }).scene;

section('The release settings survive normalising (the field guard)');
ok('a release film is the length its parts add up to', Math.abs(DOC.duration - 19.2) < 1e-6);
ok('every release field survives', Object.keys(RELEASE).every((k) => JSON.stringify(DOC.sound.release[k]) === JSON.stringify(RELEASE[k])));
ok('normalising again changes nothing', JSON.stringify(normalizeScene(DOC).scene) === JSON.stringify(DOC));
ok('a film with no release settings has none', !('release' in normalizeScene({ scenes: [{ duration: 2 }] }).scene.sound));
ok('unknown sections and cues are left out, the rest kept in time order', (() => {
  const r = normalizeRelease({ sections: [[5, 'move'], [1, 'still'], [2, 'roar']], cues: [[3, 'bang'], [1, 'click']] }, 10);
  return JSON.stringify(r.sections) === '[[1,"still"],[5,"move"]]' && JSON.stringify(r.cues) === '[[1,"click"]]' && JSON.stringify(r.motif) === JSON.stringify(RELEASE_DEFAULTS.motif);
})());

section('The carved band lines up with the music');
const sine = (f, s = 1) => Float32Array.from({ length: Math.round(s * SR) }, (_, i) => Math.sin((2 * Math.PI * f * i) / SR));
const rms = (x, a = 0.2, b = 0.8) => { let s = 0, n = 0; for (let i = Math.round(a * x.length); i < Math.round(b * x.length); i++) { s += x[i] * x[i]; n++; } return Math.sqrt(s / n); };
await claim('a tone in the voice band passes whole, and taking the band out leaves almost nothing', () => {
  const x = sine(2000), y = bandZeroPhase(x, 700, 4500);
  assert.ok(Math.abs(rms(y) / rms(x) - bandGain(2000, 700, 4500)) < 0.03, `passed ${rms(y) / rms(x)}`);
  const left = x.map((v, i) => v - y[i]);
  assert.ok(rms(left) / rms(x) < 0.06, `left ${rms(left) / rms(x)}`);
});
await claim('a low tone and a high tone are held back', () => {
  assert.ok(20 * Math.log10(rms(bandZeroPhase(sine(100), 700, 4500)) / rms(sine(100))) < -25);
  assert.ok(20 * Math.log10(rms(bandZeroPhase(sine(12000), 700, 4500)) / rms(sine(12000))) < -15);
});

section('The voice is clear');
// Invented lines: a tone with a little movement, standing in for speech.
const line = (s, f = 220) => Float32Array.from({ length: Math.round(s * SR) }, (_, i) => 0.3 * Math.sin((2 * Math.PI * f * i) / SR) * (0.6 + 0.4 * Math.sin((2 * Math.PI * 3 * i) / SR)));
const VOICES = [{ t: 1.0, samples: line(2.2) }, { t: 6.5, samples: line(1.6, 260) }, { t: 12.0, samples: line(3.0, 200) }];
const mix = await makeRelease(DOC, { voices: VOICES });
ok('the master lands at -14 LUFS', Math.abs(mix.lufs + 14) <= 0.5, mix.lufs.toFixed(2));
ok('true peaks stay under -1 dBTP', mix.truePeak <= -1, mix.truePeak.toFixed(2));
ok('the music is lowered by the full dip under every line', VOICES.every((v) => {
  const a = Math.round(v.t * SR), b = Math.round((v.t + v.samples.length / SR) * SR);
  for (let i = a; i < b; i++) if (mix.duck[i] < 0.999) return false;
  return mix.duckDb >= 11;
}));
ok('and comes back up between lines', (() => { const i = Math.round(10.6 * SR); return mix.duck[i] === 0; })());
ok('the dip eases in and out rather than stepping', (() => {
  const d = duckShape(SR * 4, [{ t: 1, samples: new Float32Array(SR) }]);
  let jump = 0; for (let i = 1; i < d.length; i++) jump = Math.max(jump, Math.abs(d[i] - d[i - 1]));
  return jump < 1e-4;
})());
ok('the soundtrack is exactly the film\'s length', mix.left.length === Math.ceil(DOC.duration * SR));

section('The score follows its sections');
const score = releaseScore(DOC);
const low = (a, b) => { const i = Math.round(a * SR), j = Math.round(b * SR); const y = bandZeroPhase(score.left.slice(i, j), 30, 150); let s = 0; for (const v of y) s += v * v; return 10 * Math.log10(s / y.length + 1e-20); };
ok('a moving stretch carries a beat and a bass the still opening does not', low(5.4, 9.4) - low(0.6, 4.4) > 6);
ok('the same film makes the same sound', (() => { const again = releaseScore(DOC); for (let i = 0; i < score.left.length; i += 997) if (again.left[i] !== score.left[i]) return false; return true; })());
ok('the score fades out after the film', (() => { const t = DOC.duration + 3.6; return Math.abs(score.left[Math.round(t * SR)] || 0) < 1e-6; })());
await claim('makeScore hands a release film to the release mix', async () => {
  const r = await makeScore(DOC, { voices: VOICES });
  assert.equal(r.duckDb, 11);
  assert.ok(Math.abs(integratedLufs(r.left, r.right) + 14) <= 0.5);
});

done();
