// Where an export's frames are encoded.
//
// In the desktop app, always by the app's own encoders (src-tauri), which are
// the same on every system. In a browser, by the page's own video encoder,
// watched: one that takes frames and hands nothing back is stopped with a
// plain sentence rather than waited on for ever.
//
// A video sink takes RGBA frames in order and gives back what the MP4 writer
// needs: { avcC, packets: [{ data, key, pts }] }; the AV1 sink gives the WebM
// writer { av1C, packets }.

import { nativeEncoder } from '../platform/index.js';
import { toSample, avcConfig } from '../core/export/h264.js';

// The app's own H.264 encoder. add() returns a promise, so the next frame can
// be drawn while this one is encoded.
async function nativeH264({ width, height, fps, bitrate, keyint }) {
  const token = await nativeEncoder.open('h264', { width, height, fps, bitrate, keyint });
  const packets = [];
  let avcC = null;
  let n = 0;
  return {
    kind: 'built-in',
    async add(rgba, key) {
      const i = n++;
      const out = await nativeEncoder.frame(token, rgba, key);
      const { sample, sps, pps } = toSample(out.subarray(1));
      if (!avcC && sps && pps) avcC = avcConfig(sps, pps);
      packets[i] = { data: sample, key: out[0] === 1, pts: i / fps };
    },
    async finish() {
      await nativeEncoder.close(token);
      if (!avcC) throw new Error('The video encoder did not describe its stream; the file cannot be written.');
      return { avcC, packets };
    },
    async cancel() { await nativeEncoder.close(token).catch(() => {}); },
  };
}

// H.264 profiles and levels, highest first.
const CODECS = ['avc1.640033', 'avc1.64002A', 'avc1.640028', 'avc1.4D4033', 'avc1.4D4028', 'avc1.42E033', 'avc1.42E01F'];
const STALL_FRAMES = 45;

async function webH264({ width, height, fps, bitrate }) {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') throw new Error('This browser has no video encoder. Export from the desktop app, which carries its own.');
  let config = null;
  for (const codec of CODECS) {
    const c = { codec, width, height, bitrate, framerate: fps, avc: { format: 'avc' }, latencyMode: 'quality', bitrateMode: 'variable' };
    try { const r = await VideoEncoder.isConfigSupported(c); if (r.supported) { config = r.config || c; break; } } catch { /* next */ }
  }
  if (!config) throw new Error(`This browser's video encoder cannot make ${width} by ${height} at ${fps} frames a second.`);
  const packets = [];
  let avcC = null, failure = null, sent = 0;
  const enc = new VideoEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      const d = meta?.decoderConfig?.description;
      if (d && !avcC) avcC = new Uint8Array(d instanceof ArrayBuffer ? d : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
      packets.push({ data, key: chunk.type === 'key', pts: chunk.timestamp / 1e6 });
    },
    error: (e) => { failure = e; },
  });
  enc.configure(config);
  return {
    kind: 'browser',
    async add(rgba, key) {
      if (failure) throw new Error(`The video encoder stopped: ${failure.message || failure}`);
      const frame = new VideoFrame(rgba, { format: 'RGBA', codedWidth: width, codedHeight: height, timestamp: Math.round((sent * 1e6) / fps), duration: Math.round(1e6 / fps) });
      enc.encode(frame, { keyFrame: key });
      frame.close();
      sent++;
      // An encoder that has taken many frames and handed none back has stalled.
      if (sent >= STALL_FRAMES && packets.length === 0) {
        enc.close();
        throw new Error('This browser’s video encoder took frames and gave nothing back. Export from the desktop app, which carries its own encoder.');
      }
      for (let waited = 0; enc.encodeQueueSize > 8 && waited < 4000; waited += 4) await new Promise((r) => setTimeout(r, 4));
    },
    async finish() {
      await enc.flush();
      enc.close();
      if (failure) throw new Error(`The video encoder stopped: ${failure.message || failure}`);
      if (!avcC) throw new Error('The video encoder did not describe its stream; the file cannot be written.');
      return { avcC, packets };
    },
    async cancel() { try { enc.close(); } catch { /* already closed */ } },
  };
}

export async function videoSink(opts) {
  return nativeEncoder.available ? nativeH264(opts) : webH264(opts);
}

// AV1 for WebM, by the app's own encoder. It looks ahead, so a frame may come
// back later than it went in; every packet carries its frame's number, and
// the last ones and the stream's description arrive when the session ends.
export function readAv1Packets(bytes, fps, into) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  while (at + 13 <= bytes.length) {
    const len = dv.getUint32(at + 1, true);
    const n = dv.getUint32(at + 5, true) + dv.getUint32(at + 9, true) * 2 ** 32;
    into.push({ key: bytes[at] === 1, pts: n / fps, data: bytes.slice(at + 13, at + 13 + len) });
    at += 13 + len;
  }
  return into;
}

export async function av1Sink({ width, height, fps, bitrate, keyint }) {
  if (!nativeEncoder.available) throw new Error('WebM films are made by the desktop app’s own encoder.');
  const token = await nativeEncoder.open('av1', { width, height, fps, bitrate, keyint });
  const packets = [];
  return {
    kind: 'built-in',
    async add(rgba) { readAv1Packets(await nativeEncoder.frame(token, rgba, false), fps, packets); },
    async finish() {
      const end = await nativeEncoder.close(token);
      const hlen = new DataView(end.buffer, end.byteOffset, end.byteLength).getUint32(0, true);
      const av1C = end.slice(4, 4 + hlen);
      readAv1Packets(end.subarray(4 + hlen), fps, packets);
      packets.sort((a, b) => a.pts - b.pts);
      if (!packets.length) throw new Error('The AV1 encoder gave back no frames; the file cannot be written.');
      return { av1C, packets };
    },
    async cancel() { await nativeEncoder.close(token).catch(() => {}); },
  };
}

// A GIF, by the app's own encoder: frames in, the file out at the end.
export async function gifSink({ width, height, fps }) {
  if (!nativeEncoder.available) throw new Error('GIFs are made by the desktop app’s own encoder.');
  const token = await nativeEncoder.open('gif', { width, height, fps });
  return {
    async add(rgba) { await nativeEncoder.frame(token, rgba, false); },
    finish: () => nativeEncoder.close(token),
    async cancel() { await nativeEncoder.close(token).catch(() => {}); },
  };
}

export const canEncodeGif = () => nativeEncoder.available;
