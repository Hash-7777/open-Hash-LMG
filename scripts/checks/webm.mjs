// The WebM writer, read back: an EBML header naming webm, one segment whose
// seek head points at its info, tracks and cues, an AV1 track with its
// description and colour and a Vorbis track with its headers, clusters that
// start on key frames, blocks in time order with the temporal delimiter left
// out, and cues that point at clusters. Packets of the app's encoders are
// read in the framing the desktop side writes.

import assert from 'node:assert/strict';
import { section, claim, done } from './lib/check.mjs';
import { muxWebm, vint, stripTemporalDelimiter } from '../../src/core/export/webm.js';
import { readAv1Packets } from '../../src/render/encoders.js';

// A small EBML reader: [{ id, start, size, body, end }] at one level.
function readVint(b, at, keepMarker = false) {
  const first = b[at];
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  let v = keepMarker ? first : first & (0xff >> len);
  for (let i = 1; i < len; i++) v = v * 256 + b[at + i];
  return { v, len };
}
function children(b, from = 0, to = b.length) {
  const out = [];
  let at = from;
  while (at < to) {
    const id = readVint(b, at, true);
    const size = readVint(b, at + id.len);
    const body = at + id.len + size.len;
    out.push({ id: id.v, start: at, body, end: body + size.v });
    at = body + size.v;
  }
  return out;
}
const one = (list, id) => list.find((e) => e.id === id);
const uintOf = (b, e) => { let v = 0; for (let i = e.body; i < e.end; i++) v = v * 256 + b[i]; return v; };
const strOf = (b, e) => new TextDecoder().decode(b.subarray(e.body, e.end));

// Invented packets: a temporal delimiter, then a frame's bytes.
const TD = [0x12, 0x00];
const fps = 30;
const video = {
  width: 640, height: 360, fps, av1C: Uint8Array.of(0x81, 0x08, 0x0c, 0x00),
  packets: Array.from({ length: 200 }, (_, i) => ({ key: i % 90 === 0, pts: i / fps, data: Uint8Array.from([...TD, 0x32, i & 255, 7, 7]) })),
};
const audio = { sampleRate: 48000, channels: 2, codecPrivate: Uint8Array.of(2, 3, 3, 1, 1, 1, 3, 3, 3, 5, 5), packets: Array.from({ length: 300 }, (_, i) => ({ start: i * 1024, data: Uint8Array.of(0, i & 255) })) };
const file = muxWebm({ video, audio });
const top = children(file);
const seg = one(top, 0x18538067);
const parts = children(file, seg.body, seg.end);

section('A WebM file, read back');
await claim('lengths are written as EBML sizes in as few bytes as fit', () => {
  assert.deepEqual([...vint(0)], [0x80]); assert.deepEqual([...vint(126)], [0xfe]); assert.deepEqual([...vint(127)], [0x40, 0x7f]);
  assert.equal(readVint(vint(1e7), 0).v, 1e7);
});
await claim('an EBML header naming webm, then one segment that fills the file', () => {
  assert.equal(top.length, 2);
  assert.equal(strOf(file, one(children(file, top[0].body, top[0].end), 0x4282)), 'webm');
  assert.equal(seg.end, file.length);
});
await claim('the seek head points at the info, the tracks and the cues', () => {
  const seeks = children(file, parts[0].body, parts[0].end).map((s) => children(file, s.body, s.end));
  for (const s of seeks) {
    const id = readVint(file, one(s, 0x53ab).body, true).v;
    const at = seg.body + uintOf(file, one(s, 0x53ac));
    assert.equal(readVint(file, at, true).v, id);
  }
  assert.equal(seeks.length, 3);
});
await claim('an AV1 track with its description and colour, and a Vorbis track with its headers', () => {
  const tracks = children(file, one(parts, 0x1654ae6b).body, one(parts, 0x1654ae6b).end).map((t) => children(file, t.body, t.end));
  assert.equal(strOf(file, one(tracks[0], 0x86)), 'V_AV1');
  assert.deepEqual([...file.subarray(one(tracks[0], 0x63a2).body, one(tracks[0], 0x63a2).end)], [...video.av1C]);
  const v = children(file, one(tracks[0], 0xe0).body, one(tracks[0], 0xe0).end);
  assert.equal(uintOf(file, one(v, 0xb0)), 640); assert.equal(uintOf(file, one(v, 0xba)), 360);
  assert.ok(one(v, 0x55b0), 'colour');
  assert.equal(strOf(file, one(tracks[1], 0x86)), 'A_VORBIS');
  assert.equal(one(tracks[1], 0x63a2).end - one(tracks[1], 0x63a2).body, audio.codecPrivate.length);
});
await claim('every packet is in a block once, in time order, the delimiter left out, key frames marked', () => {
  const clusters = parts.filter((p) => p.id === 0x1f43b675);
  const blocks = [];
  for (const c of clusters) {
    const kids = children(file, c.body, c.end);
    const base = uintOf(file, one(kids, 0xe7));
    for (const b of kids.filter((k) => k.id === 0xa3)) {
      const track = file[b.body] & 0x7f;
      const rel = new DataView(file.buffer, b.body + 1, 2).getInt16(0);
      blocks.push({ track, t: base + rel, key: Boolean(file[b.body + 3] & 0x80), first: file[b.body + 4] });
    }
  }
  const v = blocks.filter((b) => b.track === 1), a = blocks.filter((b) => b.track === 2);
  assert.equal(v.length, 200); assert.equal(a.length, 300);
  assert.ok(blocks.every((b, i) => !i || b.t >= blocks[i - 1].t));
  assert.ok(v.every((b) => b.first === 0x32), 'no temporal delimiter');
  assert.deepEqual(v.filter((b) => b.key).map((b) => b.t), [0, 3000, 6000]);
  assert.equal(a[10].t, Math.round((10 * 1024 * 1000) / 48000));
});
await claim('cues point at clusters that start on key frames', () => {
  const cues = children(file, one(parts, 0x1c53bb6b).body, one(parts, 0x1c53bb6b).end);
  assert.equal(cues.length, 3);
  for (const c of cues) {
    const tp = one(children(file, c.body, c.end), 0xb7);
    const pos = uintOf(file, one(children(file, tp.body, tp.end), 0xf1));
    assert.equal(readVint(file, seg.body + pos, true).v, 0x1f43b675);
  }
});
await claim('a silent film has the picture alone', () => {
  const silent = muxWebm({ video });
  const s = one(children(silent), 0x18538067);
  const t = one(children(silent, s.body, s.end), 0x1654ae6b);
  assert.equal(children(silent, t.body, t.end).length, 1);
});

section('Packets from the app’s encoders');
await claim('a frame without a temporal delimiter is left as it is', () => assert.deepEqual([...stripTemporalDelimiter(Uint8Array.of(0x32, 1))], [0x32, 1]));
await claim('framed AV1 packets are read with their key flag and frame number', () => {
  const frame = (key, n, data) => { const b = new Uint8Array(13 + data.length); const dv = new DataView(b.buffer); b[0] = key; dv.setUint32(1, data.length, true); dv.setUint32(5, n, true); b.set(data, 13); return b; };
  const got = readAv1Packets(Uint8Array.from([...frame(1, 0, [9, 9]), ...frame(0, 2, [8])]), 30, []);
  assert.deepEqual(got.map((p) => [p.key, +p.pts.toFixed(4), p.data.length]), [[true, 0, 2], [false, 0.0667, 1]]);
});
done();
