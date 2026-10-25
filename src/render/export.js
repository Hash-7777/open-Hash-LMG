// Rendering a film to a video file, inside the app.
//
// Frames come from the render host one at a time as RGBA pixels (with motion
// blur when asked), at the export's own size and frame rate, and go to an
// encoder sink (src/render/encoders.js): in the desktop app always the app's
// own encoders, the same on every system. H.264 is arranged into an MP4 or MOV
// by src/core/export/mp4.js; a GIF comes back whole. The soundtrack (score and
// narration, already mastered) is encoded to AAC where the web view or the
// operating system can, otherwise to MP3 by the app's own encoder, otherwise
// the film is written silent with its soundtrack saved beside it as a WAV,
// and the person is told so.

import { muxMp4, aacConfig, adtsFrames } from '../core/export/mp4.js';
import { mp3Frames } from '../core/export/h264.js';
import { videoSink, gifSink } from './encoders.js';
import { nativeEncoder } from '../platform/index.js';
import { encodeWav } from '../core/audio/wav.js';
import { createZipWriter } from '../core/export/zip.js';

export function canEncodeVideo() {
  return nativeEncoder.available || (typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined');
}

// Bits a second for a quality setting, scaled from 1080p60.
export function bitrateFor(width, height, fps, quality = 'high') {
  const base = { draft: 6e6, good: 12e6, high: 20e6, master: 40e6 }[quality] || 20e6;
  return Math.round(base * ((width * height) / (1920 * 1080)) * Math.max(0.5, fps / 60));
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

// The film's sound for an MP4 or MOV: AAC by the web view when it can, else
// by the operating system's own encoder, else MP3 by the app's own encoder.
// Returns { audio, wav, notes }: audio for the writer, or a WAV to save beside
// a silent film when none of them can.
async function encodeSound(st, encodeAacNative, notes) {
  let enc = await encodeAudioWebCodecs(st.left, st.right, st.sampleRate);
  if (!enc && encodeAacNative) {
    try {
      const adts = await encodeAacNative(encodeWav(st.left, st.right, st.sampleRate));
      // The system's AAC encoder primes with 2112 samples, which the edit list skips.
      if (adts && adts.length) enc = { packets: adtsFrames(adts).map((data) => ({ data })), priming: 2112 };
    } catch (err) { notes.push(`The system's sound encoder failed: ${err.message || err}`); }
  }
  if (enc && enc.packets.length) return { audio: { codec: 'aac', sampleRate: st.sampleRate, channels: 2, asc: aacConfig(st.sampleRate, 2), priming: enc.priming, bitrate: 192000, packets: enc.packets } };
  if (nativeEncoder.available) {
    try {
      const frames = mp3Frames(await nativeEncoder.mp3(st.left, st.right, st.sampleRate));
      // The MP3 encoder's own delay, skipped by the edit list.
      if (frames.length) return { audio: { codec: 'mp3', sampleRate: st.sampleRate, channels: 2, asc: null, priming: 1105, bitrate: 192000, packets: frames.map((f) => ({ data: f.data })) } };
    } catch (err) { notes.push(`The app's sound encoder failed: ${err.message || err}`); }
  }
  notes.push('The sound could not be encoded into the video here, so the film is silent and its soundtrack is saved beside it as a WAV file.');
  return { wav: encodeWav(st.left, st.right, st.sampleRate) };
}

// opts: { host (already given the scene at the export's size), scene, format: 'mp4'|'mov'|'gif',
//         width, height, fps, quality, blur: { samples, shutter } | null,
//         soundtrack: { left, right, sampleRate } | null, encodeAacNative(wavBytes) -> adts | null,
//         onProgress({ phase, done, total }), signal }
// Returns { file: Uint8Array, notes: [], wav: Uint8Array | null, encoder }.
export async function renderVideo(opts) {
  const { host, scene, onProgress = () => {}, signal } = opts;
  const format = opts.format || opts.container || 'mp4';
  const fps = opts.fps || scene.fps;
  const width = opts.width || scene.width, height = opts.height || scene.height;
  const total = Math.max(1, Math.round(scene.duration * fps));
  const gop = Math.round(fps * 2);
  const blur = opts.blur && opts.blur.samples > 1 ? opts.blur : null;
  const notes = [];
  if (format !== 'gif' && !canEncodeVideo()) throw new Error('There is no video encoder here. Export from the desktop app, which carries its own.');
  const sink = format === 'gif' ? await gifSink({ width, height, fps }) : await videoSink({ width, height, fps, bitrate: bitrateFor(width, height, fps, opts.quality), keyint: gop });

  // The next frame is drawn while the one before is encoded.
  let encoding = null;
  try {
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw Object.assign(new Error('Export stopped.'), { stopped: true });
      const rgba = await host.pixels(i / fps, blur);
      if (encoding) await encoding;
      encoding = sink.add(rgba, i % gop === 0);
      if (i % 3 === 0 || i === total - 1) onProgress({ phase: 'frames', done: i + 1, total });
    }
    if (encoding) await encoding;
  } catch (err) {
    await sink.cancel();
    throw err;
  }
  onProgress({ phase: 'frames', done: total, total });

  if (format === 'gif') {
    onProgress({ phase: 'file', done: 0, total: 1 });
    const file = await sink.finish();
    onProgress({ phase: 'done', done: 1, total: 1 });
    return { file, notes, wav: null, encoder: 'built-in' };
  }
  const video = await sink.finish();

  let audio = null, wav = null;
  const st = opts.soundtrack;
  if (st && st.left?.length) {
    onProgress({ phase: 'sound', done: 0, total: 1 });
    ({ audio = null, wav = null } = await encodeSound(st, opts.encodeAacNative, notes));
  }
  onProgress({ phase: 'file', done: 0, total: 1 });
  const file = muxMp4({ video: { width, height, fps, avcC: video.avcC, packets: video.packets }, audio, mov: format === 'mov' });
  onProgress({ phase: 'done', done: 1, total: 1 });
  return { file, notes, wav, encoder: sink.kind };
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

// Every frame as a PNG picture, packed into a ZIP as each is drawn, with the
// soundtrack beside them as a WAV. write(bytes) receives the ZIP in order.
// opts: { host (given the scene at the export's size), scene, fps, soundtrack, write, onProgress, signal }
export async function renderFrames({ host, scene, fps, soundtrack = null, write, onProgress = () => {}, signal }) {
  const zip = createZipWriter(write);
  const total = Math.max(1, Math.round(scene.duration * fps));
  const digits = String(total).length;
  for (let i = 0; i < total; i++) {
    if (signal?.aborted) throw Object.assign(new Error('Export stopped.'), { stopped: true });
    await zip.add(`frames/frame-${String(i + 1).padStart(Math.max(5, digits), '0')}.png`, await renderStill(host, i / fps));
    if (i % 3 === 0 || i === total - 1) onProgress({ done: i + 1, total });
  }
  if (soundtrack?.left?.length) await zip.add('sound.wav', encodeWav(soundtrack.left, soundtrack.right, soundtrack.sampleRate));
  return zip.finish();
}
