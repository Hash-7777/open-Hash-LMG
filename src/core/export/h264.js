// H.264 from the app's own encoder, made ready for the MP4 and MOV writer.
//
// The encoder answers each frame with an Annex B stream: units divided by
// start codes, with the parameter sets in front of every key frame. A file
// wants each frame as one sample of length-prefixed units, and the parameter
// sets once, in the track's avcC box. Pure, so the checks run it on recorded
// streams.

// The units of an Annex B stream, without their start codes.
export function nalUnits(bytes) {
  const units = [];
  let start = -1;
  for (let i = 0; i + 2 < bytes.length; i++) {
    if (bytes[i] === 0 && bytes[i + 1] === 0 && (bytes[i + 2] === 1 || (bytes[i + 2] === 0 && bytes[i + 3] === 1))) {
      if (start >= 0) units.push(bytes.subarray(start, i));
      i += bytes[i + 2] === 1 ? 2 : 3;
      start = i + 1;
    }
  }
  if (start >= 0 && start < bytes.length) units.push(bytes.subarray(start));
  // A unit ends before any zero bytes that pad the way to the next start code.
  return units.map((u) => { let n = u.length; while (n > 0 && u[n - 1] === 0) n--; return u.subarray(0, n); }).filter((u) => u.length);
}

const SPS = 7, PPS = 8, AUD = 9;

// One frame's stream as a sample: every unit but the parameter sets and
// delimiters, each behind its four-byte length. Returns { sample, sps, pps }.
export function toSample(annexB) {
  let sps = null, pps = null;
  const keep = [];
  for (const u of nalUnits(annexB)) {
    const type = u[0] & 31;
    if (type === SPS) sps = u;
    else if (type === PPS) pps = u;
    else if (type !== AUD) keep.push(u);
  }
  const size = keep.reduce((n, u) => n + 4 + u.length, 0);
  const sample = new Uint8Array(size);
  let o = 0;
  for (const u of keep) {
    sample[o] = u.length >>> 24; sample[o + 1] = (u.length >>> 16) & 255; sample[o + 2] = (u.length >>> 8) & 255; sample[o + 3] = u.length & 255;
    sample.set(u, o + 4);
    o += 4 + u.length;
  }
  return { sample, sps, pps };
}

// The avcC box's body from one set of parameter sets.
export function avcConfig(sps, pps) {
  const high = [100, 110, 122, 144].includes(sps[1]);
  const out = new Uint8Array(11 + sps.length + pps.length + (high ? 4 : 0));
  out.set([1, sps[1], sps[2], sps[3], 0xff, 0xe1, sps.length >> 8, sps.length & 255]);
  out.set(sps, 8);
  let o = 8 + sps.length;
  out.set([1, pps.length >> 8, pps.length & 255], o);
  out.set(pps, o + 3);
  // High profiles also name their chroma format and bit depths: 4:2:0, 8 bits.
  if (high) out.set([0xfd, 0xf8, 0xf8, 0], o + 3 + pps.length);
  return out;
}

// MP3 frames from an MP3 stream, one sample each. MPEG-1 and MPEG-2 layer III.
const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
const KBPS1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const KBPS2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
export function mp3Frames(bytes) {
  const frames = [];
  let i = 0;
  // An ID3 tag in front is skipped.
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) i = 10 + ((bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9]);
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) { i++; continue; }
    const version = (bytes[i + 1] >> 3) & 3, layer = (bytes[i + 1] >> 1) & 3;
    const br = (bytes[i + 2] >> 4) & 15, sr = (bytes[i + 2] >> 2) & 3, pad = (bytes[i + 2] >> 1) & 1;
    if (version === 1 || layer !== 1 || br === 0 || br === 15 || sr === 3) { i++; continue; }
    const rate = RATES[version][sr];
    const kbps = (version === 3 ? KBPS1 : KBPS2)[br];
    const len = Math.floor(((version === 3 ? 144 : 72) * kbps * 1000) / rate) + pad;
    if (len < 4 || i + len > bytes.length) break;
    frames.push({ data: bytes.subarray(i, i + len), rate, samples: version === 3 ? 1152 : 576 });
    i += len;
  }
  return frames;
}
