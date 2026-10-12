// Rendering a film to a video file, inside the app.
//
// Frames come from the render host one at a time (with motion blur when asked),
// go to the system's H.264 encoder through WebCodecs, and are arranged into an
// MP4 or MOV by src/core/export/mp4.js. The soundtrack (score and narration,
// already mastered) is encoded to AAC: by the web view when it can, otherwise
// by the operating system's own encoder through the app, otherwise the film is
// written silent and the soundtrack is saved beside it as a WAV, and the
// person is told so.

import { muxMp4, aacConfig, adtsFrames } from '../core/export/mp4.js';
import { encodeWav } from '../core/audio/wav.js';

// H.264 profiles and levels, highest first. Level 5.1 covers 4K at 30 and 1080
// at 120; 4.2 covers 1080 at 60.
const CODECS = ['avc1.640033', 'avc1.64002A', 'avc1.640028', 'avc1.4D4033', 'avc1.4D4028', 'avc1.42E033', 'avc1.42E01F'];

export function canEncodeVideo() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

// Bits a second for a quality setting, scaled from 1080p60.
export function bitrateFor(width, height, fps, quality = 'high') {
  const base = { draft: 6e6, good: 12e6, high: 20e6, master: 40e6 }[quality] || 20e6;
  return Math.round(base * ((width * height) / (1920 * 1080)) * Math.max(0.5, fps / 60));
}

async function pickCodec(width, height, fps, bitrate) {
  for (const codec of CODECS) {
    const config = { codec, width, height, bitrate, framerate: fps, avc: { format: 'avc' }, latencyMode: 'quality', bitrateMode: 'variable' };
    try {
      const r = await VideoEncoder.isConfigSupported(config);
      if (r.supported) return r.config || config;
    } catch { /* next */ }
  }
  return null;
}

async function encodeAudioWebCodecs(left, right, sampleRate) {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return null;
  const config = { codec: 'mp4a.40.2', sampleRate, numberOfChannels: 2, bitrate: 192000 };
  try {
    const r = await AudioEncoder.isConfigSupported(config);
    if (!r.supported) return null;
  } catch { return null; }
  const packets = [];
  let firstTs = null;
  let failure = null;
  const enc = new AudioEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      if (firstTs === null) firstTs = chunk.timestamp;
      packets.push({ data });
    },
    error: (e) => { failure = e; },
  });
  enc.configure(config);
  const block = 1024 * 8;
  for (let i = 0; i < left.length; i += block) {
    const n = Math.min(block, left.length - i);
    const planar = new Float32Array(n * 2);
    planar.set(left.subarray(i, i + n), 0);
    planar.set(right.subarray(i, i + n), n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / sampleRate) * 1e6), data: planar });
    enc.encode(ad);
    ad.close();
  }
  await enc.flush();
  enc.close();
  if (failure || !packets.length) return null;
  // An encoder that reports its priming does so as a negative first timestamp.
  const priming = firstTs < 0 ? Math.round((-firstTs / 1e6) * sampleRate) : 0;
  return { packets, priming, source: 'webcodecs' };
}

// opts: { host, scene, fps, quality, blur: { samples, shutter }, container: 'mp4'|'mov',
//         soundtrack: { left, right, sampleRate } | null, encodeAacNative(wavBytes) -> adts bytes | null,
//         onProgress({ phase, done, total }), signal }
// Returns { file: Uint8Array, notes: [], wav: Uint8Array | null }.
export async function renderVideo(opts) {
  const { host, scene, onProgress = () => {}, signal } = opts;
  if (!canEncodeVideo()) throw new Error('This system has no video encoder the app can use. Export still frames instead, or update the operating system.');
  const fps = opts.fps || scene.fps;
  const { width, height } = scene;
  const bitrate = bitrateFor(width, height, fps, opts.quality);
  const config = await pickCodec(width, height, fps, bitrate);
  if (!config) throw new Error(`The video encoder on this system cannot make ${width} by ${height} at ${fps} frames a second.`);

  const packets = [];
  let avcC = null;
  let failure = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      if (meta?.decoderConfig?.description && !avcC) avcC = new Uint8Array(meta.decoderConfig.description instanceof ArrayBuffer ? meta.decoderConfig.description : meta.decoderConfig.description.buffer.slice(meta.decoderConfig.description.byteOffset, meta.decoderConfig.description.byteOffset + meta.decoderConfig.description.byteLength));
      packets.push({ data, key: chunk.type === 'key', pts: chunk.timestamp / 1e6 });
    },
    error: (e) => { failure = e; },
  });
  encoder.configure(config);

  const total = Math.max(1, Math.round(scene.duration * fps));
  const gop = Math.round(fps * 2);
  const notes = [];
  for (let i = 0; i < total; i++) {
    if (signal?.aborted) { encoder.close(); throw new Error('Export stopped.'); }
    if (failure) throw new Error(`The encoder stopped: ${failure.message || failure}`);
    const t = i / fps;
    const bitmap = await opts.host.frame(t, opts.blur && opts.blur.samples > 1 ? opts.blur : null);
    const frame = new VideoFrame(bitmap, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
    encoder.encode(frame, { keyFrame: i % gop === 0 });
    frame.close();
    bitmap.close?.();
    // Back-pressure: never let the encoder's queue grow without bound.
    while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 2));
    if (i % 5 === 0) onProgress({ phase: 'frames', done: i + 1, total });
  }
  onProgress({ phase: 'frames', done: total, total });
  await encoder.flush();
  encoder.close();
  if (failure) throw new Error(`The encoder stopped: ${failure.message || failure}`);
  if (!avcC) throw new Error('The encoder did not describe its stream; the file cannot be written.');

  let audio = null;
  let wav = null;
  const st = opts.soundtrack;
  if (st && st.left?.length) {
    onProgress({ phase: 'sound', done: 0, total: 1 });
    let enc = await encodeAudioWebCodecs(st.left, st.right, st.sampleRate);
    if (!enc && opts.encodeAacNative) {
      try {
        const adts = await opts.encodeAacNative(encodeWav(st.left, st.right, st.sampleRate));
        // The system's AAC encoder primes with 2112 samples, which the edit list skips.
        if (adts && adts.length) enc = { packets: adtsFrames(adts).map((data) => ({ data })), priming: 2112, source: 'system' };
      } catch (err) {
        notes.push(`The system's sound encoder failed: ${err.message || err}`);
      }
    }
    if (enc && enc.packets.length) {
      audio = { sampleRate: st.sampleRate, channels: 2, asc: aacConfig(st.sampleRate, 2), priming: enc.priming, bitrate: 192000, packets: enc.packets };
    } else {
      wav = encodeWav(st.left, st.right, st.sampleRate);
      notes.push('This system could not encode the sound into the video, so the film is silent and its soundtrack is saved beside it as a WAV file.');
    }
  }

  onProgress({ phase: 'file', done: 0, total: 1 });
  const file = muxMp4({ video: { width, height, fps, avcC, packets }, audio, mov: opts.container === 'mov' });
  onProgress({ phase: 'done', done: 1, total: 1 });
  return { file, notes, wav, codec: config.codec };
}

// One still frame as PNG bytes.
export async function renderStill(host, t) {
  const bmp = await host.frame(t);
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
  c.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close?.();
  const blob = c.convertToBlob ? await c.convertToBlob({ type: 'image/png' }) : await new Promise((r) => c.toBlob(r, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
