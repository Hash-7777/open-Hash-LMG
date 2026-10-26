// Checks on what a frame shows: the person's own pictures and clips seen
// clearly, and no stretch of the film left showing nothing at all.
//
// A model redesigning a scene may lay a filled shape over a picture (a tinted
// pane, a "slot"), shrink it to a corner thumbnail, or bring a scene's words
// in so late that its arrival is a moment of empty background. lint.js calls
// these with its own `add`, and autofix() hands the repairs back here. A
// picture too small is left to the model: growing it by rule could lay it
// over the words.

const FILLED = new Set(['rect', 'circle', 'ellipse', 'polygon']);
// What counts as something on screen, and how far before its scene the first
// of it begins to arrive.
const SEEN = new Set(['text', 'counter', 'image', 'video']);
const EARLY = 0.2;

// A layer's box on the frame, in pixels, from its place, size and anchor.
export function layerBox(doc, L) {
  const u = Math.min(doc.width, doc.height) / 1080;
  const s = L.scale ?? 1;
  const w = (L.w || 0) * u * s, h = (L.h || 0) * u * s;
  const a = String(L.anchor || 'center');
  let x = L.x * doc.width - w / 2, y = L.y * doc.height - h / 2;
  if (a.includes('left')) x += w / 2;
  if (a.includes('right')) x -= w / 2;
  if (a.includes('top')) y += h / 2;
  if (a.includes('bottom')) y -= h / 2;
  return { x, y, w, h };
}

// How much of box m the box o covers, 0 to 1.
export function coverage(m, o) {
  const ix = Math.max(0, Math.min(m.x + m.w, o.x + o.w) - Math.max(m.x, o.x));
  const iy = Math.max(0, Math.min(m.y + m.h, o.y + o.h) - Math.max(m.y, o.y));
  return (ix * iy) / Math.max(1, m.w * m.h);
}

// A scene's layers in the order they are drawn: by z, then as written.
const drawOrder = (layers) => layers.map((L, i) => ({ L, i })).sort((a, b) => (a.L.z || 0) - (b.L.z || 0) || a.i - b.i).map((o) => o.L);

// The person's media in one scene: covered by a filled shape, or too small to see.
export function checkMedia(doc, S, si, add) {
  const media = S.layers.filter((L) => L.type === 'image' || L.type === 'video');
  if (!media.length) return;
  const vertical = doc.height > doc.width;
  const order = drawOrder(S.layers);
  for (const M of media) {
    const mb = layerBox(doc, M);
    // A dark scrim over a picture that fills the frame keeps words over it
    // legible; anything else drawn filled over a picture hides it.
    const fullFrame = mb.w >= doc.width * 0.9 && mb.h >= doc.height * 0.9;
    for (const X of order.slice(order.indexOf(M) + 1)) {
      if (X.type !== 'shape' || !FILLED.has(X.shape) || !X.fill || X.fill === 'none' || (X.opacity ?? 1) < 0.15) continue;
      if (fullFrame && X.fill === 'bg' && (X.opacity ?? 1) <= 0.6) continue;
      if (coverage(mb, layerBox(doc, X)) < 0.5) continue;
      add('error', 'media-covered', `A filled shape lies over the picture in scene ${si + 1}, so it shows through a tinted pane. The person's pictures and clips are shown as they are.`, { scene: S.id, layer: X.id }, { kind: 'uncover', scene: S.id, layer: X.id, media: M.id });
    }
    const share = mb.w / doc.width;
    const least = vertical ? 0.6 : 0.36;
    if (share < least) add('warn', 'small-media', `The picture in scene ${si + 1} takes ${Math.round(share * 100)} percent of the frame's width, too small to see what it shows. Give it at least ${Math.round(least * 100)} percent, with the words beside or under it.`, { scene: S.id, layer: M.id });
  }
}

// Moments between the opening and the end card where nothing is on screen
// but the background and stray lines: no words, no picture. In a scene's
// arrival one such frame is enough, and the cure is to bring its first words
// in sooner. Later in a scene a gap counts when it spans two samples in a
// row: a single beat of air between punch words is part of the cut, a longer
// one needs the model. The middle of a dip through the background is empty
// on purpose.
export function checkEmpty(doc, samples, add) {
  const flagged = new Set();
  const last = doc.scenes[doc.scenes.length - 1];
  let before = null;
  for (const sample of samples) {
    const t = sample.t;
    const empty = t >= 0.5 && last && t < last.start && !sample.boxes.some((b) => (b.kind === 'text' || b.kind === 'image') && b.alpha > 0.25);
    const si = doc.scenes.findLastIndex((S) => S.start <= t + 1e-6);
    const S = doc.scenes[si];
    const prev = before;
    before = empty ? { t, si } : null;
    if (!empty || !S || flagged.has(S.id)) continue;
    const local = t - S.start;
    const tr = S.transition;
    if (tr.kind === 'dip' && local > tr.duration * 0.3 && local < tr.duration * 0.7) continue;
    const arriving = local <= Math.max(tr.duration, 0) + 0.6;
    if (!arriving && !(prev && prev.si === si && t - prev.t < 0.8)) continue;
    flagged.add(S.id);
    add('warn', 'empty-moment', arriving
      ? `At ${t.toFixed(1)} s, as scene ${si + 1} arrives, the frame is empty: its words come in after the scene before has gone.`
      : `At ${t.toFixed(1)} s, in scene ${si + 1}, the frame is empty. Keep something on screen until the next thing arrives.`,
    { scene: S.id, t }, arriving ? { kind: 'arrive-sooner', scene: S.id } : null);
  }
}

// The repairs. Returns a sentence for what was done, or ''.
export function fixFrame(d, f) {
  const S = d.scenes.find((x) => x.id === f.scene);
  if (!S) return '';
  const n = d.scenes.indexOf(S) + 1;
  if (f.kind === 'uncover') {
    const X = S.layers.find((L) => L.id === f.layer), M = S.layers.find((L) => L.id === f.media);
    if (!X || !M) return '';
    // Drawn under the picture, the shape becomes the card it sits on.
    X.z = (M.z || 0) - 1;
    return `Moved the shape that covered the picture in scene ${n} behind it.`;
  }
  if (f.kind === 'arrive-sooner') {
    // The first words or picture, and whatever arrives with them, begin their
    // entrance just before the scene does, so they are already forming as it
    // comes in; what follows keeps its own timing.
    const start = (L) => L.in?.at ?? L.at;
    const shown = S.layers.filter((L) => SEEN.has(L.type) && L.in?.preset !== 'none');
    if (!shown.length) return '';
    const first = Math.min(...shown.map(start));
    const shift = first + EARLY;
    if (shift <= 0.05) return '';
    for (const L of shown) {
      if (start(L) > first + 0.3) continue;
      const s = +(start(L) - shift).toFixed(3);
      L.at = Math.max(0, s);
      L.in = { ...L.in, at: s };
    }
    return `Brought scene ${n}'s words in as it arrives, so the frame is never empty between scenes.`;
  }
  return '';
}
