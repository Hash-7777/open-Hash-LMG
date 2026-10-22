// Asking the model for the film's pictures: it chooses the beats a picture
// would make clearer and draws one thing from the brief's own subject for
// each, as pen strokes on a 100 by 100 grid. What comes back is checked and
// fitted in src/core/scene/pictures.js; a drawing that fails is set aside and
// its beat keeps a composition without one.

import { normalizeDrawing, PICTURE_KINDS } from '../scene/pictures.js';

export const PICTURES_SCHEMA = {
  type: 'object',
  properties: {
    pictures: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          beat: { type: 'number' },
          name: { type: 'string' },
          strokes: { type: 'array', items: { type: 'string' } },
          accent: { type: 'array', items: { type: 'string' } },
        },
        required: ['beat', 'name', 'strokes'],
      },
    },
  },
  required: ['pictures'],
};

// How many beats get a picture: about half, never more than five.
export const pictureCount = (storyboard) => Math.min(5, Math.max(1, Math.ceil(storyboard.beats.filter((b) => PICTURE_KINDS.includes(b.kind)).length / 2)));

export function picturesPrompt(count) {
  return `You are an illustrator drawing simple line pictures for a short motion-graphics film.

Choose up to ${count} of the numbered beats that a picture would make clearer. For each, draw ONE concrete thing from the brief's own subject: the product, what it is used for, where, or what it changes. Draw a different thing for each beat. Never draw words, letters, numbers or anyone's logo.

Draw on a 100 by 100 grid, 0,0 at the top left, the way a designer draws an icon with a pen: 3 to 12 clean strokes that fill most of the grid and read at a glance. Each stroke is SVG path data using only M, L, H, V, Q, C, A and Z with absolute numbers. Put the one or two strokes that carry the meaning (the light of a lamp, the steam over a cup) in "accent".

Reply with JSON only, like:
{"pictures": [{"beat": 2, "name": "coffee cup", "strokes": ["M28 42 H72 V74 Q72 86 60 86 H40 Q28 86 28 74 Z", "M72 52 Q86 52 86 63 Q86 74 72 74", "M20 92 H80"], "accent": ["M42 34 Q36 26 43 18", "M57 34 Q51 26 58 18"]}]}`;
}

export function picturesMessage(brief, storyboard) {
  const beats = storyboard.beats.map((b, i) => (PICTURE_KINDS.includes(b.kind) ? `${i + 1}. ${b.kind}: ${[b.text, b.sub, b.kind === 'stat' ? `${b.prefix || ''}${b.value}${b.suffix || ''}` : '', ...(b.items || [])].filter(Boolean).join(' / ')}` : null)).filter(Boolean);
  return `Brief:\n${brief}\n\nBeats:\n${beats.join('\n')}`;
}

// The model's answer laid onto the storyboard: { storyboard, kept, notes }.
// Beats are numbered from 1 as the model was shown them.
export function applyPictures(storyboard, raw, count = pictureCount(storyboard)) {
  const list = Array.isArray(raw?.pictures) ? raw.pictures : Array.isArray(raw) ? raw : [];
  const pictures = { ...(storyboard.pictures || {}) };
  const beats = storyboard.beats.map((b) => ({ ...b }));
  const notes = [];
  let kept = 0, setAside = 0;
  for (const item of list.slice(0, count + 2)) {
    if (kept >= count) break;
    const i = Math.round(Number(item?.beat)) - 1;
    const beat = beats[i];
    if (!beat || !PICTURE_KINDS.includes(beat.kind) || beat.picture) continue;
    const name = String(item.name || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 40) || `picture ${i + 1}`;
    const { picture } = normalizeDrawing(item);
    if (!picture) { setAside++; continue; }
    pictures[name] = picture;
    beat.picture = name;
    kept++;
  }
  if (kept) notes.push(`${kept === 1 ? 'One picture was' : `${kept} pictures were`} drawn for the film: ${beats.filter((b) => b.picture).map((b) => b.picture).join(', ')}.`);
  if (setAside) notes.push(`${setAside === 1 ? 'One drawing was' : `${setAside} drawings were`} set aside as unclear; those beats are laid out without one.`);
  if (!kept && !setAside) notes.push('The model drew no pictures; the film is laid out without them.');
  return { storyboard: { ...storyboard, beats, pictures }, kept, notes };
}

// The step itself: the model chooses the beats and draws them, and what it
// drew is laid onto the storyboard. askJson and note are the director's own.
export async function drawPictures(askJson, note, brief, storyboard) {
  const count = pictureCount(storyboard);
  const raw = await askJson(picturesPrompt(count), picturesMessage(brief, storyboard), { schema: PICTURES_SCHEMA, purpose: 'pictures' });
  const out = applyPictures(storyboard, raw, count);
  for (const n of out.notes) note(n);
  return out.storyboard;
}
