// What the brief asks to see, as statements the finished film can be checked
// against: that a line appears, comes before or after another, counts up,
// arrives from a side, holds for a while, or is there at the end.
//
// The model writes the statements once, from the brief. The film is then
// measured several times a second, as it is drawn, and each statement is
// checked against where and when each line of text actually is. Because it
// reads the drawn film and not the plan, it holds a film made from the
// model's own code to the brief as firmly as one made from a plan.
//
// Pure: the measured samples come in, results go out.

export const CHECKS = ['appears', 'before', 'after', 'ends', 'counts', 'enters-from', 'holds'];
export const SIDES = ['below', 'above', 'left', 'right'];
const MAX_CHECKS = 6;

export const INTENT_SCHEMA = {
  type: 'object',
  properties: {
    checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          check: { type: 'string', enum: CHECKS },
          other: { type: 'string' },
          from: { type: 'string', enum: SIDES },
          seconds: { type: 'number' },
        },
        required: ['subject', 'check'],
      },
    },
  },
  required: ['checks'],
};

export function intentPrompt() {
  return `You turn the brief for a short animated film into checks that can be verified on the finished film.
Each check names words that will be on screen ("subject") and one of:
- appears: the subject is shown at some point
- before / after: the subject first appears before or after "other"
- ends: the subject is on screen at the end
- counts: the subject is a number that counts or rolls up to its value
- enters-from: the subject arrives moving in "from" below, above, left or right
- holds: the subject stays on screen for at least "seconds"
Only what the brief actually asks for, at most ${MAX_CHECKS} checks, short subjects (one to four words, as they will appear).
Reply with JSON only: {"checks": [{"subject": "...", "check": "appears"}, ...]}`;
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const words = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}%$.,+\s-]/gu, ' ').replace(/\s+/g, ' ').trim();

export function normalizeIntent(raw) {
  const list = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.checks) ? raw.checks : [];
  const out = [];
  for (const c of list) {
    if (!isObj(c)) continue;
    const subject = words(c.subject).slice(0, 60);
    const check = String(c.check || '').toLowerCase().replace(/\s+/g, '-');
    if (!subject || !CHECKS.includes(check)) continue;
    const item = { subject, check };
    if (check === 'before' || check === 'after') { item.other = words(c.other).slice(0, 60); if (!item.other) continue; }
    if (check === 'enters-from') { item.from = SIDES.includes(c.from) ? c.from : 'below'; }
    if (check === 'holds') { const n = Number(c.seconds); item.seconds = Number.isFinite(n) ? Math.min(30, Math.max(0.5, n)) : 1.5; }
    out.push(item);
    if (out.length >= MAX_CHECKS) break;
  }
  return out;
}

// Times to measure: a steady grid through the film.
export function intentTimes(duration, perSecond = 10) {
  const n = Math.max(2, Math.ceil(duration * perSecond));
  return Array.from({ length: n + 1 }, (_, i) => +Math.min(duration, (i * duration) / n).toFixed(3));
}

// Where each line of text is, frame by frame: label -> [{ t, cx, cy, alpha, text }].
function tracks(samples) {
  const map = new Map();
  for (const s of samples) {
    for (const b of s.boxes) {
      if (b.kind !== 'text' || !b.text) continue;
      // Drawing code tags nothing, so its text is followed by its words with
      // the figures taken out: a number keeps one track while it counts.
      const key = b.tag || `~${words(b.text).replace(/[\d,.]/g, '')}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ t: s.t, cx: b.x + b.w / 2, cy: b.y + b.h / 2, alpha: b.alpha, text: words(b.text) });
    }
  }
  return map;
}

// The track that best fits the subject: the same words, then a line that
// contains them, then a line of at least four letters that is a whole part of
// them; a number matches on its digits. Short lines (a step's "3") never
// stand in for a longer subject.
function find(map, subject) {
  const digits = (s) => s.replace(/[^\d]/g, '');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let best = null, rank = 0;
  for (const list of map.values()) {
    const last = list[list.length - 1].text;
    let r = 0;
    if (last === subject) r = 4;
    else if (digits(subject).length >= 2 && digits(last) === digits(subject)) r = 3;
    else if (last.includes(subject)) r = 2;
    else if (last.length >= 4 && new RegExp(`(^|\\s)${esc(last)}(\\s|$)`).test(subject)) r = 1;
    if (r > rank) { rank = r; best = list; }
  }
  return best;
}

const firstSeen = (list) => (list ? list.find((p) => p.alpha >= 0.5)?.t ?? null : null);

// Checks every statement against the measured film. `counters` are the
// plan's counter layers, when there is a plan, since an odometer shows only
// its final figure to the measurement.
export function verifyIntent(checks, samples, { duration, width, counters = [] } = {}) {
  const map = tracks(samples);
  const minMove = (width || 1920) * 0.004;
  return checks.map((c) => {
    const list = find(map, c.subject);
    const seen = list ? list.filter((p) => p.alpha >= 0.5) : [];
    const say = (ok, why) => ({ ...c, ok, why });
    if (c.check === 'appears') return say(seen.length > 0, seen.length ? '' : 'it never appears');
    if (!seen.length) return say(false, 'it never appears');
    if (c.check === 'before' || c.check === 'after') {
      const other = firstSeen(find(map, c.other));
      if (other === null) return say(false, `"${c.other}" never appears`);
      const a = seen[0].t;
      return c.check === 'before' ? say(a < other - 0.05, a < other - 0.05 ? '' : `it first appears at ${a.toFixed(1)} s, not before "${c.other}" at ${other.toFixed(1)} s`)
        : say(a > other + 0.05, a > other + 0.05 ? '' : `it first appears at ${a.toFixed(1)} s, not after "${c.other}" at ${other.toFixed(1)} s`);
    }
    if (c.check === 'ends') {
      const end = seen.some((p) => p.t >= (duration || 0) - 1);
      return say(end, end ? '' : `it is gone ${(duration - seen[seen.length - 1].t).toFixed(1)} s before the end`);
    }
    if (c.check === 'holds') {
      const step = samples.length > 1 ? samples[1].t - samples[0].t : 0.25;
      const held = seen.length * step;
      return say(held + step / 2 >= c.seconds, held + step / 2 >= c.seconds ? '' : `it is on screen for about ${held.toFixed(1)} s, not ${c.seconds} s`);
    }
    if (c.check === 'counts') {
      const values = new Set(list.map((p) => p.text.replace(/[^\d]/g, '')));
      const planned = counters.some((L) => (L.from !== L.to || L.roll) && find(new Map([['c', [{ text: words(L.prefix + L.to + L.suffix) }]]]), c.subject));
      return say(values.size > 1 || planned, values.size > 1 || planned ? '' : 'it is shown at its value without counting');
    }
    if (c.check === 'enters-from') {
      // Where it first shows against where it is just after arriving; the
      // scene's slow camera moves it too, so the end of the scene is no guide.
      const start = list[0];
      const rest = seen.find((p) => p.t >= start.t + 0.7) || seen[seen.length - 1];
      const dx = start.cx - rest.cx, dy = start.cy - rest.cy;
      const moved = { below: dy > minMove, above: dy < -minMove, left: dx < -minMove, right: dx > minMove }[c.from];
      return say(moved, moved ? '' : `it does not arrive from ${c.from}`);
    }
    return say(true, '');
  });
}

// One sentence per failed statement, for the model or the person.
export function intentFailures(results) {
  return results.filter((r) => !r.ok).map((r) => {
    const want = {
      appears: `show "${r.subject}"`,
      before: `show "${r.subject}" before "${r.other}"`,
      after: `show "${r.subject}" after "${r.other}"`,
      ends: `end with "${r.subject}" on screen`,
      counts: `have "${r.subject}" count or roll up to its value`,
      'enters-from': `bring "${r.subject}" in from ${r.from}`,
      holds: `hold "${r.subject}" for at least ${r.seconds} s`,
    }[r.check];
    return `The brief asks the film to ${want}, but ${r.why}.`;
  });
}
