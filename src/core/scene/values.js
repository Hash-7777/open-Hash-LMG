// The small value cleaners the scene format is rebuilt with, shared by the
// normaliser and the asset reader so both clean a value the same way.

export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function num(v, def, lo = -Infinity, hi = Infinity) {
  if (typeof v === 'string') {
    const s = v.trim();
    if (s.endsWith('%')) v = parseFloat(s) / 100;
    else if (/^-?[\d.]+(px|s|ms)?$/.test(s)) v = s.endsWith('ms') ? parseFloat(s) / 1000 : parseFloat(s);
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) return def;
  return Math.min(hi, Math.max(lo, v));
}

// A number's prefix or suffix keeps its own space (" million", "$ "), so it is
// not trimmed; runs of space still become one.
export function affix(v, max) {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  return String(v).replace(/\s+/g, ' ').slice(0, max);
}

export function str(v, def = '', max = 400) {
  if (v === null || v === undefined) return def;
  if (typeof v === 'number') v = String(v);
  if (typeof v !== 'string') return def;
  return v.replace(/\s+/g, ' ').trim().slice(0, max);
}

export const slug = (s) => String(s || '').toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '');
