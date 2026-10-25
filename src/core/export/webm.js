// A small WebM writer: AV1 video and Vorbis sound, from the packets the app's
// own encoders hand back (src-tauri/src/commands/av1.rs and vorbis.rs).
//
// WebM is Matroska with a short list of codecs, written as nested EBML
// elements: an ID, a length, the contents. What it writes:
//   EBML header (doc type webm)
//   Segment: SeekHead (where Info, Tracks and Cues are), Info (millisecond
//   clock, duration), Tracks (the AV1 track with its av1C description and
//   colour, the Vorbis track with its three headers), Clusters of
//   SimpleBlocks, a new cluster at every key frame or every five seconds,
//   and Cues (a seek point at each cluster that starts on a key frame).
// Everything is laid out in memory, so every length is known and written
// exactly; positions in the seek head have a fixed width so the seek head's
// own length does not depend on them.

const text = new TextEncoder();

// An element's ID is written with its length marker included.
const ID = {
  EBML: 0x1a45dfa3, EBMLVersion: 0x4286, EBMLReadVersion: 0x42f7, EBMLMaxIDLength: 0x42f2, EBMLMaxSizeLength: 0x42f3,
  DocType: 0x4282, DocTypeVersion: 0x4287, DocTypeReadVersion: 0x4285,
  Segment: 0x18538067, SeekHead: 0x114d9b74, Seek: 0x4dbb, SeekID: 0x53ab, SeekPosition: 0x53ac,
  Info: 0x1549a966, TimestampScale: 0x2ad7b1, Duration: 0x4489, MuxingApp: 0x4d80, WritingApp: 0x5741,
  Tracks: 0x1654ae6b, TrackEntry: 0xae, TrackNumber: 0xd7, TrackUID: 0x73c5, TrackType: 0x83, FlagLacing: 0x9c,
  CodecID: 0x86, CodecPrivate: 0x63a2, DefaultDuration: 0x23e383,
  Video: 0xe0, PixelWidth: 0xb0, PixelHeight: 0xba, Colour: 0x55b0, MatrixCoefficients: 0x55b1, Range: 0x55b9,
  TransferCharacteristics: 0x55ba, Primaries: 0x55bb,
  Audio: 0xe1, SamplingFrequency: 0xb5, Channels: 0x9f,
  Cluster: 0x1f43b675, Timestamp: 0xe7, SimpleBlock: 0xa3,
  Cues: 0x1c53bb6b, CuePoint: 0xbb, CueTime: 0xb3, CueTrackPositions: 0xb7, CueTrack: 0xf7, CueClusterPosition: 0xf1,
};

function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

function idBytes(id) {
  const out = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v & 255);
  return Uint8Array.from(out);
}

// A length as an EBML variable-size integer, in as few bytes as it fits.
export function vint(n) {
  for (let len = 1; len <= 8; len++) {
    if (n < 2 ** (7 * len) - 1) {
      const out = new Uint8Array(len);
      let v = n;
      for (let i = len - 1; i >= 0; i--) { out[i] = v % 256; v = Math.floor(v / 256); }
      out[0] |= 0x80 >> (len - 1);
      return out;
    }
  }
  throw new Error('An element is too large for the file.');
}

function uint(n, width = 0) {
  const out = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) out.unshift(v % 256);
  while (out.length < Math.max(1, width)) out.unshift(0);
  return Uint8Array.from(out);
}

function float64(x) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, x);
  return b;
}

const el = (id, body) => concat([idBytes(id), vint(body.length), body]);
const elUint = (id, n, width) => el(id, uint(n, width));
const elStr = (id, s) => el(id, text.encode(s));
const elFloat = (id, x) => el(id, float64(x));
const group = (id, ...children) => el(id, concat(children));

// A temporal delimiter opens every AV1 frame the encoder hands back; WebM
// leaves it out of each block.
export function stripTemporalDelimiter(data) {
  if (!data.length || ((data[0] >> 3) & 15) !== 2) return data;
  let at = 1 + ((data[0] & 4) ? 1 : 0);
  if (data[0] & 2) { while (at < data.length && data[at] & 0x80) at++; at++; }
  return data.subarray(at);
}

function block(track, relMs, key, data) {
  const head = new Uint8Array(4);
  head[0] = 0x80 | track;
  new DataView(head.buffer).setInt16(1, relMs);
  head[3] = key ? 0x80 : 0;
  return el(ID.SimpleBlock, concat([head, data]));
}

// video: { width, height, fps, av1C, packets: [{ data, key, pts }] }
// audio: { sampleRate, channels, codecPrivate, packets: [{ data, start }] } or null
// Returns the file's bytes.
export function muxWebm({ video, audio = null }) {
  const ms = (s) => Math.round(s * 1000);
  const frames = video.packets.map((p) => ({ track: 1, t: ms(p.pts), key: p.key, data: stripTemporalDelimiter(p.data) }));
  const sounds = audio ? audio.packets.map((p) => ({ track: 2, t: ms(p.start / audio.sampleRate), key: true, data: p.data })) : [];
  const last = video.packets.length ? video.packets[video.packets.length - 1].pts + 1 / video.fps : 0;
  const duration = Math.max(ms(last), sounds.length ? sounds[sounds.length - 1].t : 0);
  // Interleaved by time, the picture first where the two meet.
  const all = [...frames, ...sounds].sort((a, b) => a.t - b.t || a.track - b.track);

  const header = group(ID.EBML,
    elUint(ID.EBMLVersion, 1), elUint(ID.EBMLReadVersion, 1), elUint(ID.EBMLMaxIDLength, 4), elUint(ID.EBMLMaxSizeLength, 8),
    elStr(ID.DocType, 'webm'), elUint(ID.DocTypeVersion, 4), elUint(ID.DocTypeReadVersion, 2));
  const info = group(ID.Info, elUint(ID.TimestampScale, 1000000), elFloat(ID.Duration, duration), elStr(ID.MuxingApp, 'Hash LMG'), elStr(ID.WritingApp, 'Hash LMG'));
  const videoTrack = group(ID.TrackEntry,
    elUint(ID.TrackNumber, 1), elUint(ID.TrackUID, 1), elUint(ID.TrackType, 1), elUint(ID.FlagLacing, 0),
    elStr(ID.CodecID, 'V_AV1'), el(ID.CodecPrivate, video.av1C), elUint(ID.DefaultDuration, Math.round(1e9 / video.fps)),
    group(ID.Video, elUint(ID.PixelWidth, video.width), elUint(ID.PixelHeight, video.height),
      // BT.709 in limited range, as the encoder writes it.
      group(ID.Colour, elUint(ID.MatrixCoefficients, 1), elUint(ID.Range, 1), elUint(ID.TransferCharacteristics, 1), elUint(ID.Primaries, 1))));
  const audioTrack = audio ? group(ID.TrackEntry,
    elUint(ID.TrackNumber, 2), elUint(ID.TrackUID, 2), elUint(ID.TrackType, 2), elUint(ID.FlagLacing, 0),
    elStr(ID.CodecID, 'A_VORBIS'), el(ID.CodecPrivate, audio.codecPrivate),
    group(ID.Audio, elFloat(ID.SamplingFrequency, audio.sampleRate), elUint(ID.Channels, audio.channels || 2))) : new Uint8Array(0);
  const tracks = group(ID.Tracks, videoTrack, audioTrack);

  // Clusters, and where each starts relative to the first of them.
  const clusters = [];
  const cues = [];
  let current = null;
  let offset = 0;
  const close = () => {
    if (!current) return;
    const bytes = group(ID.Cluster, elUint(ID.Timestamp, current.t), ...current.blocks);
    clusters.push(bytes);
    if (current.key) cues.push({ t: current.t, at: offset });
    offset += bytes.length;
    current = null;
  };
  for (const p of all) {
    const keyStart = p.track === 1 && p.key;
    if (!current || keyStart || p.t - current.t >= 5000) {
      close();
      current = { t: p.t, key: keyStart, blocks: [] };
    }
    current.blocks.push(block(p.track, p.t - current.t, p.key, p.data));
  }
  close();

  // The seek head's size is fixed by its fixed-width positions, so the rest
  // can be placed after it.
  const seek = (id, pos) => group(ID.Seek, el(ID.SeekID, idBytes(id)), elUint(ID.SeekPosition, pos, 8));
  const seekHeadSize = group(ID.SeekHead, seek(ID.Info, 0), seek(ID.Tracks, 0), seek(ID.Cues, 0)).length;
  const infoAt = seekHeadSize;
  const tracksAt = infoAt + info.length;
  const clustersAt = tracksAt + tracks.length;
  const cuesAt = clustersAt + offset;
  const cueBytes = group(ID.Cues, ...cues.map((c) => group(ID.CuePoint, elUint(ID.CueTime, c.t),
    group(ID.CueTrackPositions, elUint(ID.CueTrack, 1), elUint(ID.CueClusterPosition, clustersAt + c.at)))));
  const seekHead = group(ID.SeekHead, seek(ID.Info, infoAt), seek(ID.Tracks, tracksAt), seek(ID.Cues, cuesAt));
  const segment = group(ID.Segment, seekHead, info, tracks, ...clusters, cueBytes);
  return concat([header, segment]);
}
