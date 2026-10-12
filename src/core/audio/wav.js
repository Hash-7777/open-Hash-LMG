// A 16-bit stereo WAV file from two channels of float samples.

export function encodeWav(left, right, sampleRate = 48000) {
  const n = left.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 4, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, left[i])), r = Math.max(-1, Math.min(1, right[i]));
    v.setInt16(o, l < 0 ? l * 0x8000 : l * 0x7fff, true);
    v.setInt16(o + 2, r < 0 ? r * 0x8000 : r * 0x7fff, true);
    o += 4;
  }
  return new Uint8Array(buf);
}

// Reads a PCM WAV (8, 16, 24 or 32-bit integer, or 32-bit float) into float
// channels. Returns { sampleRate, channels: [Float32Array, ...] } or null.
export function decodeWav(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = (o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (b.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let p = 12, fmt = null, data = null;
  while (p + 8 <= b.length) {
    const id = tag(p), size = v.getUint32(p + 4, true);
    if (id === 'fmt ') fmt = { format: v.getUint16(p + 8, true), channels: v.getUint16(p + 10, true), rate: v.getUint32(p + 12, true), bits: v.getUint16(p + 22, true) };
    // A streamed WAV may give its data size as 0 or as the largest number.
    if (id === 'data') { data = { start: p + 8, size: size === 0 || size === 0xffffffff ? b.length - p - 8 : Math.min(size, b.length - p - 8) }; break; }
    p += 8 + size + (size & 1);
  }
  if (!fmt || !data) return null;
  const { channels: nc, bits } = fmt;
  const fmtCode = fmt.format === 0xfffe ? (bits === 32 ? 3 : 1) : fmt.format;
  const bps = bits / 8, frames = Math.floor(data.size / (bps * nc));
  const ch = Array.from({ length: nc }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nc; c++) {
      const o = data.start + (i * nc + c) * bps;
      let x;
      if (fmtCode === 3 && bits === 32) x = v.getFloat32(o, true);
      else if (bits === 16) x = v.getInt16(o, true) / 32768;
      else if (bits === 24) { const n = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16); x = (n & 0x800000 ? n - 0x1000000 : n) / 8388608; }
      else if (bits === 32) x = v.getInt32(o, true) / 2147483648;
      else if (bits === 8) x = (b[o] - 128) / 128;
      else return null;
      ch[c][i] = x;
    }
  }
  return { sampleRate: fmt.rate, channels: ch };
}

// Linear resampling to a new rate; enough for speech going into a mix.
export function resample(x, from, to) {
  if (from === to) return x;
  const n = Math.floor((x.length * to) / from), out = new Float32Array(n), k = from / to;
  for (let i = 0; i < n; i++) {
    const s = i * k, j = Math.floor(s), f = s - j;
    out[i] = (x[j] ?? 0) * (1 - f) + (x[j + 1] ?? x[j] ?? 0) * f;
  }
  return out;
}

// Mono at 48 kHz from any decoded WAV.
export function toMono48k(decoded) {
  const { channels, sampleRate } = decoded;
  const n = channels[0].length, mono = new Float32Array(n);
  for (const c of channels) for (let i = 0; i < n; i++) mono[i] += c[i] / channels.length;
  return resample(mono, sampleRate, 48000);
}

export function base64ToBytes(b64) {
  if (typeof atob === 'function') {
    const s = atob(b64), out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

export function bytesToBase64(bytes) {
  if (typeof btoa === 'function') {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  return Buffer.from(bytes).toString('base64');
}
