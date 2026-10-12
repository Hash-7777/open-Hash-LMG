// A small MP4 and MOV writer: H.264 video and AAC audio, "fast start" (the index
// before the media, so a file starts playing before it has fully arrived).
//
// The encoders (WebCodecs in the web view) hand over finished packets; this
// file only arranges them into the ISO base media format. Every packet of a
// track sits in one contiguous run, so each track has a single chunk, which
// keeps the tables short and the layout easy to check.
//
// What it writes, top level: ftyp, moov, mdat. Inside moov: mvhd, then one trak
// per stream with tkhd, an edit list where a stream must skip leading samples
// (B-frame reordering, the AAC encoder's priming), mdhd, hdlr and the sample
// tables (stsd, stts, ctts, stss, stsc, stsz, stco or co64).

const enc = new TextEncoder();

class Writer {
  constructor() { this.parts = []; this.size = 0; }
  u8(v) { this.parts.push(Uint8Array.of(v & 255)); this.size += 1; return this; }
  u16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v); return this.bytes(b); }
  u24(v) { return this.u8(v >>> 16).u8(v >>> 8).u8(v); }
  u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0); return this.bytes(b); }
  i32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v); return this.bytes(b); }
  u64(v) {
    const b = new Uint8Array(8);
    const dv = new DataView(b.buffer);
    dv.setUint32(0, Math.floor(v / 2 ** 32));
    dv.setUint32(4, v >>> 0);
    return this.bytes(b);
  }
  str(s) { return this.bytes(enc.encode(s)); }
  bytes(b) { this.parts.push(b instanceof Uint8Array ? b : new Uint8Array(b)); this.size += b.byteLength ?? b.length; return this; }
  zeros(n) { return this.bytes(new Uint8Array(n)); }
  out() {
    const o = new Uint8Array(this.size);
    let p = 0;
    for (const b of this.parts) { o.set(b, p); p += b.length; }
    return o;
  }
}

function box(type, ...children) {
  const body = new Writer();
  for (const c of children) if (c) body.bytes(c);
  const b = body.out();
  const w = new Writer();
  w.u32(8 + b.length).str(type).bytes(b);
  return w.out();
}

function full(type, version, flags, fill) {
  const w = new Writer();
  w.u8(version).u24(flags);
  fill(w);
  return box(type, w.out());
}

const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];

function ftyp(mov) {
  const w = new Writer();
  if (mov) w.str('qt  ').u32(0x20050300).str('qt  ');
  else w.str('isom').u32(0x200).str('isom').str('iso2').str('avc1').str('mp41');
  return box('ftyp', w.out());
}

function mvhd(durationMs, nextId) {
  return full('mvhd', 0, 0, (w) => {
    w.u32(0).u32(0).u32(1000).u32(durationMs).u32(0x00010000).u16(0x0100).zeros(10);
    MATRIX.forEach((m) => w.u32(m));
    w.zeros(24).u32(nextId);
  });
}

function tkhd(id, durationMs, width, height, audio) {
  return full('tkhd', 0, 3, (w) => {
    w.u32(0).u32(0).u32(id).u32(0).u32(durationMs).zeros(8).u16(0).u16(audio ? 1 : 0).u16(audio ? 0x0100 : 0).u16(0);
    MATRIX.forEach((m) => w.u32(m));
    w.u32(width * 65536).u32(height * 65536);
  });
}

// An edit list that starts presentation `skip` media units in, for the whole
// presented duration.
function edts(durationMs, skip) {
  return box('edts', full('elst', 0, 0, (w) => { w.u32(1).u32(durationMs).i32(skip).u32(0x00010000); }));
}

function mdhd(timescale, duration) {
  return full('mdhd', 0, 0, (w) => { w.u32(0).u32(0).u32(timescale).u32(duration).u16(0x55c4).u16(0); });
}

function hdlr(audio) {
  return full('hdlr', 0, 0, (w) => {
    w.u32(0).str(audio ? 'soun' : 'vide').zeros(12).str(audio ? 'SoundHandler' : 'VideoHandler').u8(0);
  });
}

function dinf() {
  return box('dinf', full('dref', 0, 0, (w) => { w.u32(1).bytes(full('url ', 0, 1, () => {})); }));
}

function avc1(width, height, avcC) {
  const w = new Writer();
  w.zeros(6).u16(1).zeros(16).u16(width).u16(height).u32(0x00480000).u32(0x00480000).u32(0).u16(1);
  const name = 'Hash LMG';
  w.u8(name.length).str(name).zeros(31 - name.length);
  w.u16(0x0018).u16(0xffff);
  w.bytes(box('avcC', avcC));
  // BT.709 colour, limited range: what every player assumes for HD, said explicitly.
  const colr = new Writer();
  colr.str('nclx').u16(1).u16(1).u16(1).u8(0);
  w.bytes(box('colr', colr.out()));
  const pasp = new Writer();
  pasp.u32(1).u32(1);
  w.bytes(box('pasp', pasp.out()));
  return box('avc1', w.out());
}

function descriptor(tag, body) {
  const w = new Writer();
  w.u8(tag);
  // Sizes under 128 fit in one byte; the ones here always do except a very
  // long decoder config, which uses the four-byte form.
  if (body.length < 128) w.u8(body.length);
  else w.u8(0x80 | ((body.length >> 21) & 127)).u8(0x80 | ((body.length >> 14) & 127)).u8(0x80 | ((body.length >> 7) & 127)).u8(body.length & 127);
  w.bytes(body);
  return w.out();
}

function mp4a(channels, sampleRate, asc, bitrate) {
  const w = new Writer();
  w.zeros(6).u16(1).zeros(8).u16(channels).u16(16).u16(0).u16(0).u32(sampleRate * 65536);
  const dcd = new Writer();
  dcd.u8(0x40).u8(0x15).u24(0).u32(bitrate).u32(bitrate).bytes(descriptor(5, asc));
  const es = new Writer();
  es.u16(1).u8(0).bytes(descriptor(4, dcd.out())).bytes(descriptor(6, Uint8Array.of(2)));
  w.bytes(full('esds', 0, 0, (x) => x.bytes(descriptor(3, es.out()))));
  return box('mp4a', w.out());
}

function stbl(entry, samples, chunkOffset, { syncSamples = null, ctts = null } = {}) {
  const stsd = full('stsd', 0, 0, (w) => { w.u32(1).bytes(entry); });
  // Runs of equal durations.
  const runs = [];
  for (const s of samples) {
    const last = runs[runs.length - 1];
    if (last && last[1] === s.duration) last[0]++;
    else runs.push([1, s.duration]);
  }
  const stts = full('stts', 0, 0, (w) => { w.u32(runs.length); runs.forEach(([n, d]) => w.u32(n).u32(d)); });
  let cttsBox = null;
  if (ctts && ctts.some((v) => v !== 0)) {
    const cr = [];
    for (const v of ctts) { const last = cr[cr.length - 1]; if (last && last[1] === v) last[0]++; else cr.push([1, v]); }
    cttsBox = full('ctts', 1, 0, (w) => { w.u32(cr.length); cr.forEach(([n, v]) => w.u32(n).i32(v)); });
  }
  const stss = syncSamples ? full('stss', 0, 0, (w) => { w.u32(syncSamples.length); syncSamples.forEach((i) => w.u32(i)); }) : null;
  const stsc = full('stsc', 0, 0, (w) => { w.u32(1).u32(1).u32(samples.length).u32(1); });
  const stsz = full('stsz', 0, 0, (w) => { w.u32(0).u32(samples.length); samples.forEach((s) => w.u32(s.data.length)); });
  const big = chunkOffset > 0xffffffff;
  const stco = big
    ? full('co64', 0, 0, (w) => { w.u32(1).u64(chunkOffset); })
    : full('stco', 0, 0, (w) => { w.u32(1).u32(chunkOffset); });
  return box('stbl', stsd, stts, cttsBox, stss, stsc, stsz, stco);
}

// video: { width, height, fps, avcC (Uint8Array), packets: [{ data, key, pts (seconds) }] in decode order }
// audio: { sampleRate, channels, asc (Uint8Array), priming (samples), bitrate, packets: [{ data }] } or null
// Returns the file as one Uint8Array.
export function muxMp4({ video, audio = null, mov = false }) {
  const VTS = 90000; // divides evenly by 24, 25, 30, 50 and 60 frames a second
  const delta = Math.round(VTS / video.fps);
  const vSamples = video.packets.map((p) => ({ data: p.data, duration: delta }));
  const vCount = vSamples.length;
  // Presentation offsets: decode time i * delta against each packet's own time.
  const offsets = video.packets.map((p, i) => Math.round(p.pts * VTS) - i * delta);
  const shift = Math.max(0, -Math.min(0, ...offsets));
  const ctts = offsets.map((o) => o + shift);
  const durationMs = Math.round((vCount / video.fps) * 1000);
  const sync = [];
  video.packets.forEach((p, i) => { if (p.key) sync.push(i + 1); });

  let aSamples = null, aDurMs = 0;
  if (audio && audio.packets.length) {
    aSamples = audio.packets.map((p) => ({ data: p.data, duration: 1024 }));
    aDurMs = Math.round(((aSamples.length * 1024 - (audio.priming || 0)) / audio.sampleRate) * 1000);
  }

  const vBytes = vSamples.reduce((n, s) => n + s.data.length, 0);
  const aBytes = aSamples ? aSamples.reduce((n, s) => n + s.data.length, 0) : 0;
  const mdatSize = 8 + vBytes + aBytes;
  const mdatHeader = mdatSize > 0xffffffff ? 16 : 8;

  const build = (vOff, aOff) => {
    const vTrak = box('trak',
      tkhd(1, durationMs, video.width, video.height, false),
      shift ? edts(durationMs, shift) : null,
      box('mdia',
        mdhd(VTS, vCount * delta),
        hdlr(false),
        box('minf',
          full('vmhd', 0, 1, (w) => w.zeros(8)),
          dinf(),
          stbl(avc1(video.width, video.height, video.avcC), vSamples, vOff, { syncSamples: sync, ctts }))));
    let aTrak = null;
    if (aSamples) {
      aTrak = box('trak',
        tkhd(2, Math.min(aDurMs, durationMs), 0, 0, true),
        audio.priming ? edts(Math.min(aDurMs, durationMs), audio.priming) : null,
        box('mdia',
          mdhd(audio.sampleRate, aSamples.length * 1024),
          hdlr(true),
          box('minf',
            full('smhd', 0, 0, (w) => w.zeros(4)),
            dinf(),
            stbl(mp4a(audio.channels, audio.sampleRate, audio.asc, audio.bitrate || 192000), aSamples, aOff))));
    }
    return box('moov', mvhd(durationMs, aSamples ? 3 : 2), vTrak, aTrak);
  };

  const head = ftyp(mov);
  // Offsets depend on the moov's size, which depends on the offsets' width:
  // build once to measure, once for real.
  let moov = build(0, 0);
  const vOff = head.length + moov.length + mdatHeader;
  const aOff = vOff + vBytes;
  moov = build(vOff, aOff);
  if (head.length + moov.length + mdatHeader !== vOff) {
    // co64 instead of stco changes the size; one more pass settles it.
    const vOff2 = head.length + moov.length + mdatHeader;
    moov = build(vOff2, vOff2 + vBytes);
  }

  const total = head.length + moov.length + mdatSize + (mdatHeader - 8);
  const out = new Uint8Array(total);
  let p = 0;
  out.set(head, p); p += head.length;
  out.set(moov, p); p += moov.length;
  const dv = new DataView(out.buffer);
  if (mdatHeader === 16) {
    dv.setUint32(p, 1); out.set(enc.encode('mdat'), p + 4);
    dv.setUint32(p + 8, Math.floor((mdatSize + 8) / 2 ** 32)); dv.setUint32(p + 12, (mdatSize + 8) >>> 0);
    p += 16;
  } else {
    dv.setUint32(p, mdatSize); out.set(enc.encode('mdat'), p + 4);
    p += 8;
  }
  for (const s of vSamples) { out.set(s.data, p); p += s.data.length; }
  if (aSamples) for (const s of aSamples) { out.set(s.data, p); p += s.data.length; }
  return out;
}

// The AudioSpecificConfig for AAC-LC, built from the format rather than taken
// from an encoder, so it is right whatever an encoder reports.
export function aacConfig(sampleRate = 48000, channels = 2) {
  const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  const idx = Math.max(0, rates.indexOf(sampleRate));
  return Uint8Array.of((2 << 3) | (idx >> 1), ((idx & 1) << 7) | (channels << 3));
}

// Splits an ADTS stream (what a system AAC encoder writes) into raw frames.
export function adtsFrames(bytes) {
  const frames = [];
  let i = 0;
  while (i + 7 <= bytes.length) {
    if (bytes[i] !== 0xff || (bytes[i + 1] & 0xf0) !== 0xf0) { i++; continue; }
    const protectionAbsent = bytes[i + 1] & 1;
    const len = ((bytes[i + 3] & 3) << 11) | (bytes[i + 4] << 3) | (bytes[i + 5] >> 5);
    const header = protectionAbsent ? 7 : 9;
    if (len < header || i + len > bytes.length) break;
    frames.push(bytes.slice(i + header, i + len));
    i += len;
  }
  return frames;
}

// Reads the box tree back, for the checks: [{ type, start, size, children? }].
export function readBoxes(bytes, start = 0, end = bytes.length, depth = 0) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf']);
  let p = start;
  while (p + 8 <= end) {
    let size = dv.getUint32(p);
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    let header = 8;
    if (size === 1) { size = dv.getUint32(p + 8) * 2 ** 32 + dv.getUint32(p + 12); header = 16; }
    if (size < header || p + size > end) break;
    const b = { type, start: p, size, header };
    if (containers.has(type) && depth < 8) b.children = readBoxes(bytes, p + header, p + size, depth + 1);
    out.push(b);
    p += size;
  }
  return out;
}
