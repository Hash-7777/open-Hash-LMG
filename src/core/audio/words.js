// When each word of a spoken clip is said, so words on screen appear exactly
// as the voice reaches them.
//
// Speech engines rarely report word times, so they are worked out from the
// sound: the clip is split at the pauses actually heard (one per comma,
// semicolon or dash in the text, where the audio has them), and within each
// stretch words share the time by their syllables, each boundary then moved to
// the nearest quiet dip in the voice. Close enough to read as in sync.

const SR_ENV = 100; // envelope frames a second

function envelope(x, sr) {
  const hop = Math.max(1, Math.round(sr / SR_ENV)), n = Math.floor(x.length / hop), e = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * hop; j < (i + 1) * hop; j++) s += x[j] * x[j];
    e[i] = Math.sqrt(s / hop);
  }
  return e;
}

export function syllables(word) {
  const w = String(word).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!w) return 1;
  const digits = w.replace(/[^0-9]/g, '').length;
  const letters = w.replace(/[0-9]/g, '');
  let n = (letters.match(/[aeiouy]+/g) || []).length;
  if (letters.length > 2 && letters.endsWith('e') && !letters.endsWith('le')) n -= 1;
  return Math.max(1, n) + digits;
}

// Pauses quieter than 4 percent of the peak for at least minLen seconds,
// inside the clip (not its edges), as [start, end] in seconds.
function pauses(e, minLen = 0.09) {
  let peak = 0;
  for (const v of e) if (v > peak) peak = v;
  const q = (v) => v < peak * 0.04;
  const out = [];
  for (let i = 0; i < e.length;) {
    if (!q(e[i])) { i++; continue; }
    let j = i;
    while (j < e.length && q(e[j])) j++;
    if ((j - i) / SR_ENV >= minLen && i > 0 && j < e.length) out.push([i / SR_ENV, j / SR_ENV]);
    i = j;
  }
  return out;
}

function dips(e) {
  let peak = 0;
  for (const v of e) if (v > peak) peak = v;
  const s = e.map((_, i) => (e[i - 2] ?? e[i]) / 5 + (e[i - 1] ?? e[i]) / 5 + e[i] / 5 + (e[i + 1] ?? e[i]) / 5 + (e[i + 2] ?? e[i]) / 5);
  const out = [];
  for (let k = 2; k < s.length - 2; k++) if (s[k] <= s[k - 1] && s[k] <= s[k + 1] && s[k] < peak * 0.25) out.push(k / SR_ENV);
  return out;
}

// The span the voice actually occupies, without leading and trailing quiet.
export function voicedSpan(x, sr) {
  const e = envelope(x, sr);
  let peak = 0;
  for (const v of e) if (v > peak) peak = v;
  let a = 0, b = e.length - 1;
  while (a < e.length && e[a] < peak * 0.03) a++;
  while (b > a && e[b] < peak * 0.03) b--;
  return [a / SR_ENV, (b + 1) / SR_ENV];
}

// [[word, start, end], ...] in seconds from the clip's start, words as the
// text shows them.
export function timeWords(x, sr, text) {
  const e = envelope(x, sr);
  const [v0, v1] = voicedSpan(x, sr);
  const parts = String(text).split(/(?<=[,;:—-])\s+/).map((p) => p.trim()).filter(Boolean);
  let spans;
  const ps = pauses(e).filter(([a, b]) => a > v0 && b < v1);
  if (parts.length > 1 && ps.length >= parts.length - 1) {
    const longest = [...ps].sort((p, q) => (q[1] - q[0]) - (p[1] - p[0])).slice(0, parts.length - 1).sort((p, q) => p[0] - q[0]);
    spans = [];
    let a = v0;
    for (const g of longest) { spans.push([a, g[0]]); a = g[1]; }
    spans.push([a, v1]);
  } else {
    spans = [[v0, v1]];
    if (parts.length > 1) parts.splice(0, parts.length, parts.join(' '));
  }
  const D = dips(e);
  const out = [];
  parts.forEach((part, k) => {
    const [a, b] = spans[k];
    const ws = part.split(/\s+/).filter(Boolean);
    const wt = ws.map((w) => 0.5 + syllables(w));
    const tot = wt.reduce((m, n) => m + n, 0) || 1;
    const bounds = [a];
    let t = a;
    for (const w of wt.slice(0, -1)) {
      t += ((b - a) * w) / tot;
      const near = D.filter((d) => Math.abs(d - t) < 0.12 && d > bounds[bounds.length - 1] + 0.08 && d < b - 0.08);
      bounds.push(near.length ? near.reduce((m, d) => (Math.abs(d - t) < Math.abs(m - t) ? d : m)) : t);
    }
    bounds.push(b);
    ws.forEach((w, i) => out.push([w, +bounds[i].toFixed(3), +bounds[i + 1].toFixed(3)]));
  });
  return out;
}
