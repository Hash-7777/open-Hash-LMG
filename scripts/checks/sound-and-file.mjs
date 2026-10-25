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
import { nalUnits, toSample, avcConfig, mp3Frames } from '../../src/core/export/h264.js';
import { exportSize } from '../../src/core/export/sizes.js';

const scene = normalizeScene(EXAMPLES.launch).scene;

section('The score');
for (const flavor of ['pulse', 'soft', 'cinematic', 'bounce', 'drive', 'keys', 'arp']) {
  await claim(`${flavor}: about -14 LUFS, true peak at most -1 dBTP`, async () => {
    const st = await makeScore({ ...scene, sound: { ...scene.sound, score: flavor } });
    const lufs = integratedLufs(st.left, st.right);
    assert.ok(Math.abs(lufs + 14) <= 0.6, `${lufs.toFixed(2)} LUFS`);
    assert.ok(truePeakDb(st.left, st.right) <= -0.95);
  });
}
// How alike two tracks are, from -1 to 1, over their loudness from moment to
// moment: one groove against another sounds different, not only louder.
const likeness = (a, b) => {
  const env = (x) => { const w = 2400, out = []; for (let i = 0; i + w <= x.length; i += w) { let e = 0; for (let j = i; j < i + w; j++) e += x[j] * x[j]; out.push(Math.sqrt(e / w)); } return out; };
  const ea = env(a.left), eb = env(b.left), n = Math.min(ea.length, eb.length);
  const mean = (v) => v.slice(0, n).reduce((s, x) => s + x, 0) / n;
  const ma = mean(ea), mb = mean(eb);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (ea[i] - ma) * (eb[i] - mb); da += (ea[i] - ma) ** 2; db += (eb[i] - mb) ** 2; }
  return num / Math.sqrt(da * db);
};
await claim('every groove plays its own pattern, unlike the others', async () => {
  const tracks = {};
  for (const g of ['bounce', 'drive', 'keys', 'arp']) tracks[g] = await makeScore({ ...scene, sound: { ...scene.sound, score: g } });
  const names = Object.keys(tracks);
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) assert.ok(likeness(tracks[names[i]], tracks[names[j]]) < 0.9, `${names[i]} and ${names[j]}`);
});
await claim('two films in one groove get different tunes', async () => {
  const a = await makeScore({ ...scene, seed: 11, sound: { ...scene.sound, score: 'bounce' } });
  const b = await makeScore({ ...scene, seed: 12, sound: { ...scene.sound, score: 'bounce' } });
  let diff = 0;
  for (let i = 0; i < a.left.length; i += 101) diff += Math.abs(a.left[i] - b.left[i]);
  assert.ok(diff / (a.left.length / 101) > 0.01);
});
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
// The sound's sample entry: the ISO form in an MP4, the QuickTime form in a
// MOV (version 1, its configuration inside a 'wave' box), which is the one
// players decode in a MOV.
const tagAt = (bytes, tag, from = 0) => { for (let i = from; i < bytes.length - 4; i++) if (String.fromCharCode(...bytes.subarray(i, i + 4)) === tag) return i; return -1; };
await claim('an MP4 carries the sound configuration directly in its sample entry', () => {
  const file = muxMp4({ video: fakeVideo, audio, mov: false });
  const entry = tagAt(file, 'mp4a');
  assert.ok(entry > 0);
  assert.equal(file[entry + 4 + 8] << 8 | file[entry + 4 + 9], 0, 'version 0');
  assert.equal(tagAt(file, 'wave'), -1);
  assert.ok(tagAt(file, 'esds', entry) > entry);
});
await claim('a MOV carries it the QuickTime way, in a wave box of a version 1 entry', () => {
  const file = muxMp4({ video: fakeVideo, audio, mov: true });
  const entry = tagAt(file, 'mp4a');
  assert.equal(file[entry + 4 + 8] << 8 | file[entry + 4 + 9], 1, 'version 1');
  const wave = tagAt(file, 'wave', entry);
  assert.ok(wave > entry);
  assert.ok(tagAt(file, 'frma', wave) > wave && tagAt(file, 'esds', wave) > wave);
  const waveSize = new DataView(file.buffer, file.byteOffset).getUint32(wave - 4);
  assert.ok(tagAt(file, 'esds', wave) < wave - 4 + waveSize, 'the configuration sits inside the wave box');
});
await claim('ADTS frames are split one by one', () => assert.equal(adtsFrames(adts).length, 100));
await claim('a film without sound has one track', () => {
  const file = muxMp4({ video: fakeVideo });
  assert.equal(readBoxes(file).find((b) => b.type === 'moov').children.filter((b) => b.type === 'trak').length, 1);
});
section('The app’s own H.264, made ready for the file');
const sps = Uint8Array.of(0x67, 66, 0xc0, 30, 0xda, 0x01);
const pps = Uint8Array.of(0x68, 0xce, 0x3c, 0x80);
const idr = Uint8Array.of(0x65, 0x88, 0x84, 0x00, 0x21);
const annexB = Uint8Array.from([0, 0, 0, 1, ...sps, 0, 0, 0, 1, ...pps, 0, 0, 1, ...idr, 0]);
await claim('units are found between start codes of either length, padding dropped', () => {
  assert.deepEqual(nalUnits(annexB).map((u) => [...u]), [[...sps], [...pps], [...idr]]);
});
await claim('a frame becomes one sample of length-prefixed units, parameter sets taken out', () => {
  const { sample, sps: s1, pps: p1 } = toSample(annexB);
  assert.deepEqual([...s1], [...sps]); assert.deepEqual([...p1], [...pps]);
  assert.deepEqual([...sample], [0, 0, 0, idr.length, ...idr]);
});
await claim('the avcC names the profile and carries one of each parameter set', () => {
  const c = avcConfig(sps, pps);
  assert.equal(c[0], 1); assert.equal(c[1], 66); assert.equal(c[5], 0xe1);
  assert.equal(c.length, 11 + sps.length + pps.length);
  assert.equal(avcConfig(Uint8Array.of(0x67, 100, 0, 40), pps).length, 11 + 4 + pps.length + 4);
});

section('MP3 frames, and MP3 in an MP4');
// An invented MPEG-1 layer III frame header: 128 kbps at 48 kHz, 384 bytes a frame.
const mp3Frame = () => { const f = new Uint8Array(384); f.set([0xff, 0xfb, 0x94, 0x00]); return f; };
const mp3 = new Uint8Array(384 * 3); [0, 1, 2].forEach((i) => mp3.set(mp3Frame(), i * 384));
await claim('frames are split by their headers', () => {
  const frames = mp3Frames(mp3);
  assert.equal(frames.length, 3); assert.equal(frames[0].data.length, 384); assert.equal(frames[0].rate, 48000);
});
await claim('an MP4 with MP3 sound names it as MP3 and times its frames of 1152', () => {
  const file = muxMp4({ video: fakeVideo, audio: { codec: 'mp3', sampleRate: 48000, channels: 2, asc: null, priming: 0, bitrate: 128000, packets: mp3Frames(mp3).map((f) => ({ data: f.data })) } });
  const at = (bytes, tag) => { for (let i = 0; i < bytes.length - 4; i++) if (String.fromCharCode(...bytes.subarray(i, i + 4)) === tag) return i; return -1; };
  const esds = at(file, 'esds');
  assert.ok(esds > 0);
  assert.ok([...file.subarray(esds, esds + 40)].includes(0x6b));
  assert.equal(readBoxes(file).find((b) => b.type === 'moov').children.filter((b) => b.type === 'trak').length, 2);
});

section('Export sizes');
await claim('a short side scales the film, keeping its shape, with even sides', () => {
  assert.deepEqual(exportSize({ width: 1920, height: 1080 }, 720), { width: 1280, height: 720 });
  assert.deepEqual(exportSize({ width: 1080, height: 1920 }, 2160), { width: 2160, height: 3840 });
  assert.deepEqual(exportSize({ width: 1080, height: 1350 }, 480), { width: 480, height: 600 });
  assert.deepEqual(exportSize({ width: 1920, height: 1080 }, 0), { width: 1920, height: 1080 });
});
await claim('nothing goes past 4K', () => {
  const s = exportSize({ width: 1080, height: 1080 }, 4320);
  assert.ok(s.width <= 4096 && s.height <= 4096 && s.width * s.height <= 4096 * 2304 && s.width % 2 === 0);
});
done();
