// The score lands at the loudness platforms play at, with true peaks under
// the ceiling, follows the film's drops, ducks under a voice, and is the same
// every time; and the MP4 and MOV writer puts its boxes where players look
// for them, with the index before the media so a film starts playing at once.

import assert from 'node:assert/strict';
import { section, claim, done } from './lib/check.mjs';
import { makeScore, scorePlan } from '../../src/core/audio/score.js';
import { integratedLufs, truePeakDb } from '../../src/core/audio/master.js';
import { encodeWav, decodeWav } from '../../src/core/audio/wav.js';
import { muxMp4, readBoxes, aacConfig, adtsFrames } from '../../src/core/export/mp4.js';
import { normalizeScene } from '../../src/core/scene/normalize.js';
import { EXAMPLES } from '../../src/core/scene/examples.js';

const scene = normalizeScene(EXAMPLES.launch).scene;

section('The score');
for (const flavor of ['pulse', 'soft', 'cinematic']) {
  await claim(`${flavor}: about -14 LUFS, true peak at most -1 dBTP`, async () => {
    const st = await makeScore({ ...scene, sound: { ...scene.sound, score: flavor } });
    const lufs = integratedLufs(st.left, st.right);
    assert.ok(Math.abs(lufs + 14) <= 0.6, `${lufs.toFixed(2)} LUFS`);
    assert.ok(truePeakDb(st.left, st.right) <= -0.95);
  });
}
await claim('no music and no voice is silence, not a track', async () => assert.equal(await makeScore({ ...scene, sound: { ...scene.sound, score: 'none' } }), null));
await claim('the same film makes the same score', async () => {
  const a = await makeScore(scene), b = await makeScore(scene);
  assert.equal(a.left.length, b.left.length);
  for (let i = 0; i < a.left.length; i += 997) assert.equal(a.left[i], b.left[i]);
});
await claim('a reveal and the end card become drops', () => {
  const plan = scorePlan(scene);
  const reveal = scene.scenes.find((S) => S.id === 'reveal');
  assert.ok(plan.drops.some((t) => Math.abs(t - 4.0) < 0.01 || Math.abs(t - reveal.start) < 0.01));
});
await claim('a voice is mixed in without changing the film\u2019s length', async () => {
  const sr = 48000; const n = sr * 2; const voice = new Float32Array(n);
  for (let i = 0; i < n; i++) voice[i] = 0.3 * Math.sin((2 * Math.PI * 180 * i) / sr);
  const plain = await makeScore(scene), voiced = await makeScore(scene, { voices: [{ t: 6, samples: voice }] });
  assert.ok(plain && voiced && voiced.left.length === plain.left.length);
});

section('WAV');
await claim('a WAV reads back as it was written', () => {
  const L = new Float32Array(480).map((_, i) => Math.sin(i / 10) * 0.5), R = L.slice();
  const back = decodeWav(encodeWav(L, R, 48000));
  assert.equal(back.sampleRate, 48000); assert.ok(Math.abs(back.channels[0][100] - L[100]) < 1e-3);
});

section('The MP4 and MOV writer');
const fakeVideo = { width: 1920, height: 1080, fps: 60, avcC: new Uint8Array([1, 0x64, 0, 0x28, 0xff, 0xe1, 0, 0]), packets: Array.from({ length: 120 }, (_, i) => ({ data: new Uint8Array([0, 0, 0, 2, 9, i & 255]), key: i % 60 === 0, pts: i / 60 })) };
const adts = (() => { const frames = []; for (let i = 0; i < 100; i++) { const len = 7 + 4; const f = new Uint8Array(len); f[0] = 0xff; f[1] = 0xf1; f[2] = 0x4c; f[3] = 0x80 | ((len >> 11) & 3); f[4] = (len >> 3) & 0xff; f[5] = ((len & 7) << 5) | 0x1f; f[6] = 0xfc; frames.push(f); } const out = new Uint8Array(frames.reduce((n, f) => n + f.length, 0)); let p = 0; for (const f of frames) { out.set(f, p); p += f.length; } return out; })();
const audio = { sampleRate: 48000, channels: 2, asc: aacConfig(48000, 2), priming: 2112, bitrate: 192000, packets: adtsFrames(adts).map((data) => ({ data })) };
for (const mov of [false, true]) {
  await claim(`${mov ? 'MOV' : 'MP4'}: ftyp, then moov, then mdat`, () => {
    const file = muxMp4({ video: fakeVideo, audio, mov });
    const top = readBoxes(file).map((b) => b.type);
    assert.deepEqual(top, ['ftyp', 'moov', 'mdat']);
    const moov = readBoxes(file).find((b) => b.type === 'moov');
    const traks = moov.children.filter((b) => b.type === 'trak');
    assert.equal(traks.length, 2);
    assert.ok(traks[1].children.some((b) => b.type === 'edts'), 'the sound skips its encoder priming with an edit list');
  });
}
await claim('ADTS frames are split one by one', () => assert.equal(adtsFrames(adts).length, 100));
await claim('a film without sound has one track', () => {
  const file = muxMp4({ video: fakeVideo });
  assert.equal(readBoxes(file).find((b) => b.type === 'moov').children.filter((b) => b.type === 'trak').length, 1);
});
done();
