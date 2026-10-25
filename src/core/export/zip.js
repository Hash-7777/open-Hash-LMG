// A ZIP written as it goes: each file is added whole and passed on at once, so
// a film's frames can be packed one at a time without holding them all. Files
// are stored, not compressed: PNG and WAV gain nothing from it.
//
// A ZIP's offsets are 32 bits, so a file past 4 GB, or more than 65,535
// files, takes the ZIP64 form for what no longer fits: the central directory
// records the offset in an extra field, and a ZIP64 end record comes before
// the ordinary one. Each file on its own stays under 4 GB.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();
const MAX32 = 0xffffffff;

class Bytes {
  constructor(n) { this.b = new Uint8Array(n); this.v = new DataView(this.b.buffer); this.p = 0; }
  u16(x) { this.v.setUint16(this.p, x, true); this.p += 2; return this; }
  u32(x) { this.v.setUint32(this.p, x >>> 0, true); this.p += 4; return this; }
  u64(x) { this.v.setUint32(this.p, x % 2 ** 32, true); this.v.setUint32(this.p + 4, Math.floor(x / 2 ** 32), true); this.p += 8; return this; }
  raw(a) { this.b.set(a, this.p); this.p += a.length; return this; }
}

// DOS time and date for a JavaScript date.
function dos(d) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2), date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

// write(bytes) -> promise; { limit32 } lowers the 32-bit limit, for the checks.
export function createZipWriter(write, { limit32 = MAX32, now = new Date() } = {}) {
  const { time, date } = dos(now);
  const entries = [];
  let offset = 0;
  const put = async (bytes) => { await write(bytes); offset += bytes.length; };

  async function add(name, data) {
    if (data.length >= MAX32) throw new Error(`${name} is too large for one file in a ZIP.`);
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const head = new Bytes(30 + nameBytes.length)
      .u32(0x04034b50).u16(20).u16(0x0800).u16(0).u16(time).u16(date)
      .u32(crc).u32(data.length).u32(data.length).u16(nameBytes.length).u16(0).raw(nameBytes);
    entries.push({ nameBytes, crc, size: data.length, at: offset });
    await put(head.b);
    await put(data);
  }

  async function finish() {
    const cdStart = offset;
    for (const e of entries) {
      const far = e.at > limit32;
      const cd = new Bytes(46 + e.nameBytes.length + (far ? 12 : 0))
        .u32(0x02014b50).u16(far ? 45 : 20).u16(far ? 45 : 20).u16(0x0800).u16(0).u16(time).u16(date)
        .u32(e.crc).u32(e.size).u32(e.size).u16(e.nameBytes.length).u16(far ? 12 : 0).u16(0).u16(0).u16(0).u32(0)
        .u32(far ? MAX32 : e.at).raw(e.nameBytes);
      if (far) cd.u16(0x0001).u16(8).u64(e.at);
      await put(cd.b);
    }
    const cdSize = offset - cdStart;
    const big = entries.length > 0xffff || cdStart > limit32 || cdSize > limit32;
    if (big) {
      const z64At = offset;
      await put(new Bytes(56).u32(0x06064b50).u64(44).u16(45).u16(45).u32(0).u32(0).u64(entries.length).u64(entries.length).u64(cdSize).u64(cdStart).b);
      await put(new Bytes(20).u32(0x07064b50).u32(0).u64(z64At).u32(1).b);
    }
    const n = big ? 0xffff : entries.length;
    await put(new Bytes(22).u32(0x06054b50).u16(0).u16(0).u16(n).u16(n).u32(big ? MAX32 : cdSize).u32(big ? MAX32 : cdStart).u16(0).b);
    return { files: entries.length, bytes: offset };
  }

  return { add, finish };
}

// Reads a ZIP's central directory back, for the checks: [{ name, size, crc, at }].
export function readZip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && v.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('No end record.');
  let count = v.getUint16(end + 10, true), cd = v.getUint32(end + 16, true);
  if (cd === MAX32 || count === 0xffff) {
    const loc = end - 20;
    if (v.getUint32(loc, true) !== 0x07064b50) throw new Error('No ZIP64 locator.');
    const z = Number(v.getBigUint64(loc + 8, true));
    count = Number(v.getBigUint64(z + 32, true));
    cd = Number(v.getBigUint64(z + 48, true));
  }
  const out = [];
  let p = cd;
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('A damaged central directory.');
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    let at = v.getUint32(p + 42, true);
    if (at === MAX32) at = Number(v.getBigUint64(p + 46 + nameLen + 4, true));
    out.push({ name: new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen)), size: v.getUint32(p + 24, true), crc: v.getUint32(p + 16, true), at });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
