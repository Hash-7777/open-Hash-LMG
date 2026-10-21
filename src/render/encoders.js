// Where an export's frames are encoded.
//
// In the desktop app, always by the app's own encoders (src-tauri), which are
// the same on every system. In a browser, by the page's own video encoder,
// watched: one that takes frames and hands nothing back is stopped with a
// plain sentence rather than waited on for ever.
//
// A video sink takes RGBA frames in order and gives back what the MP4 writer
// needs: { avcC, packets: [{ data, key, pts }] }.

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
