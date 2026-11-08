// What goes out with a product film when it is published: chapters, a
// description, tags, and a thumbnail drawn by the same stage.
//
// Chapters follow the film's parts, the way video sites read them: the first
// at 0:00 and none shorter than ten seconds, so a short part joins the one
// before it. The description is built from the storyboard and the facts
// only, with an honest line on what in the film was real. The thumbnail is a
// one-frame film of its own: the icon, the name, the tagline, and the made
// film parted into its layers beside them, no plane over any word.

export const MIN_CHAPTER = 10;

const TITLES = {
  open: null, name: (b) => b.tagline || b.name, brief: () => 'Tell it what you want', make: () => 'Watch it build',
  steps: (b) => `${b.steps.length ? `${countWord(b.steps.length)} steps` : 'How it works'}`, lift: () => 'The film it made',
  split: (b) => (b.split ? `${b.split.left.title} and ${b.split.right.title.toLowerCase()}` : 'Who does what'), hands: () => 'Edit anything by hand',
  export: () => 'Export', hub: (b) => b.hub?.title || 'Built in', ring: () => 'Looks', drawings: () => 'Yours', figures: () => 'By the numbers',
  end: (b) => b.releaseLine || b.endLine || b.name,
};
const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const countWord = (n) => WORDS[n] || String(n);
export const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// parts: [{ key, t0 }] from the planner; duration: the film's length.
export function chapters(parts, board, duration) {
  const list = [];
  for (const p of [...parts].sort((a, b) => a.t0 - b.t0)) {
    const title = TITLES[p.key] ? String(TITLES[p.key](board) || '').replace(/\s+/g, ' ').replace(/[.\s]+$/, '') : '';
    if (!title) continue;
    list.push({ t: list.length ? Math.floor(p.t0) : 0, title });
  }
  // A chapter that would last less than MIN_CHAPTER joins the one before it.
  const out = [];
  for (const c of list) {
    const last = out[out.length - 1];
    if (last && c.t - last.t < MIN_CHAPTER) last.title += `, ${lower(c.title)}`;
    else out.push({ ...c });
  }
  while (out.length > 1 && duration - out[out.length - 1].t < MIN_CHAPTER) { const c = out.pop(); out[out.length - 1].title += `, ${lower(c.title)}`; }
  return out.map((c) => `${clock(c.t)} ${c.title}`);
}
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

// The description: a title, what it is, how it works, what is inside, where
// to get it, and what in the film was real.
export function description(board, facts = {}, { footnote = '', version = '' } = {}) {
  const name = board.name || facts.name || 'This product';
  const what = `${name}${board.expansion ? ` (${board.expansion})` : ''}${board.tagline ? `: ${board.tagline}` : ''}`;
  const how = [board.lines.brief, board.lines.make, board.lines.split].filter(Boolean).join(' ');
  const inside = [];
  if (board.steps.length) inside.push(`${countWord(board.steps.length)} steps: ${board.steps.map((s) => s.name).join(', ')}.`);
  if (board.split) inside.push(`${board.split.left.title}: ${board.split.left.items.map((i) => i.label).join(', ')}. ${board.split.right.title}: ${board.split.right.items.map((i) => i.label).join(', ')}.`);
  if (board.hub) inside.push(`${board.hub.title}: ${board.hub.tiles.map((x) => (x.sub ? `${x.name} (${x.sub})` : x.name)).join(', ')}.${board.hub.note ? ` ${board.hub.note}` : ''}`);
  for (const f of board.figures) inside.push(`${f.value} ${f.cap}.`);
  for (const y of board.yours) inside.push(`${y.cap}.`);
  const links = (Array.isArray(facts.links) ? facts.links : []).filter((l) => l && l.label && /^https:\/\//.test(l.url)).map((l) => `${l.label}: ${l.url}`);
  return [
    `${name}${version ? ` ${version}` : ''}: ${board.tagline || board.lines.open || ''}`.trim(),
    '', what, '', how,
    ...(inside.length ? ['', 'What is inside:', ...inside.map((s) => `- ${s}`)] : []),
    ...(board.lines.release ? ['', board.lines.release] : []),
    ...(links.length ? ['', ...links] : []),
    ...(footnote ? ['', footnote] : []),
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Tags: the name, what its capitals stand for, and the kind of product.
export function tags(board, facts = {}) {
  const out = [board.name, board.expansion, ...(Array.isArray(facts.tags) ? facts.tags : []), facts.kind, 'launch film', 'product video'];
  return [...new Set(out.filter(Boolean).map((s) => String(s).trim()).filter(Boolean))].slice(0, 20);
}

// The thumbnail as a short film of its own (draw it at THUMB_AT and save the
// frame): the icon top left, the words below it, the made film's frame at
// filmAt parted into its layers on the right.
export const THUMB_AT = 1;
export function thumbnailDoc({ board, film, icon = null, palette = {}, filmAt = null }) {
  // The made film's title scene, once it has settled, unless a moment is given.
  const title = film?.scenes?.find((S) => S.name === 'title') || film?.scenes?.[0];
  const at = filmAt ?? (title ? title.start + Math.min(1.5, title.duration / 2) : 1);
  const tag = String(board.tagline || '').split(/(?<=[.,])\s+/);
  const [l1, l2] = tag.length > 1 ? [tag[0], tag.slice(1).join(' ')] : [board.tagline || '', ''];
  const parts = [{ kind: 'thumb', t0: 0, t1: 4, fi: 0, fo: 0, x: 610, y: 600, name: board.name, expansion: board.expansion, tagline: [l1, l2] }];
  if (icon) parts.unshift({ kind: 'icon', t0: 0, t1: 4, asset: icon, keys: [[0, { o: 1, x: 300, y: 250, z: 0, ry: -14, rx: 4, rz: 0, s: 0.5 }]] });
  if (film) parts.push({ kind: 'lift', t0: 0, t1: 4, fi: 0, fo: 0, ft0: Math.max(0, at - THUMB_AT), film, apart: [0, 0, 4, 4], pose: [[0, { x: 1440, y: 560, z: 0, ry: 6, rx: 0, s: 0.43 }]] });
  return {
    title: `${board.name} thumbnail`, aspect: '16:9', fps: 30, palette,
    scenes: [{ id: 'thumbnail', duration: 4, transition: { kind: 'cut' }, layers: [] }],
    stage: { camera: [[0, 960, 540, 1, 0, 0]], parts },
  };
}
