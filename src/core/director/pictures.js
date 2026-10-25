// Asking the model for the film's pictures: it chooses the beats a picture
// would make clearer and draws one everyday object from the brief's own
// subject for each, built from a few simple shapes on a 100 by 100 grid, the
// way icons are built. Small local models place boxes, circles and lines far
// better than they write curves, and they follow worked examples closely, so
// the prompt carries three. A model that copies an example under another
// object's name has drawn the wrong thing, and that drawing is set aside.
// What comes back is checked and fitted in src/core/scene/pictures.js; a
// drawing that fails is set aside and its beat keeps a composition without one.

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
          shapes: { type: 'array', items: { type: 'array' } },
          accent: { type: 'array', items: { type: 'array' } },
        },
        required: ['beat', 'name', 'shapes'],
      },
    },
  },
  required: ['pictures'],
};

// How many beats get a picture: about half, never more than five.
export const pictureCount = (storyboard) => Math.min(5, Math.max(1, Math.ceil(storyboard.beats.filter((b) => PICTURE_KINDS.includes(b.kind)).length / 2)));

// The worked examples the prompt shows, one object each.
export const PICTURE_EXAMPLES = [
  { beat: 2, name: 'desk lamp', shapes: [['rect', 28, 86, 44, 6, 3], ['line', 50, 86, 50, 50], ['poly', 32, 50, 68, 50, 60, 22, 40, 22]], accent: [['arc', 50, 50, 26, 30, 150]] },
  { beat: 3, name: 'bicycle', shapes: [['circle', 24, 66, 18], ['circle', 76, 66, 18], ['poly', 24, 66, 44, 40, 70, 40, 50, 66], ['line', 70, 40, 76, 66], ['line', 44, 40, 40, 30], ['line', 66, 32, 76, 32]], accent: [['circle', 50, 66, 4]] },
  { beat: 5, name: 'coffee cup', shapes: [['rect', 22, 40, 44, 46, 10], ['arc', 70, 58, 12, -90, 90], ['line', 16, 92, 72, 92]], accent: [['line', 36, 32, 36, 16], ['line', 50, 32, 50, 12]] },
];

export function picturesPrompt(count) {
  return `You are an illustrator drawing simple line icons for a short motion-graphics film.

Choose up to ${count} of the numbered beats that a picture would make clearer. For each, pick ONE everyday physical object from the brief's own subject that anyone would recognise from its outline (a lamp, a bicycle, a cup, a laptop, a thermometer), a different object for each beat. Name it in one or two plain words. Never draw an idea, a scene, a person, words, letters, numbers or logos.

Draw the object alone, centred, filling most of a 100 by 100 grid (0,0 top left), from 3 to 10 simple shapes, with no frame or border around it:
- ["rect", x, y, width, height, cornerRadius]
- ["circle", centreX, centreY, radius]
- ["line", x1, y1, x2, y2]
- ["poly", x1, y1, x2, y2, x3, y3, ...] a closed outline through the points
- ["arc", centreX, centreY, radius, startDegrees, endDegrees] part of a circle, 0 degrees pointing right, going clockwise
Build it from its simplest outline, the way icons do: a bicycle is two circles for wheels joined by lines for the frame; a cup is a rounded rect and an arc for the handle; a thermometer is a tall rounded rect over a circle; a laptop is a rect screen above a thin poly base; the sun is a circle with short lines around it.
Put the one or two shapes that carry the meaning (the light of a lamp, the steam over a cup) in "accent".

Examples, each one object; copy one only when you draw that same object:
${PICTURE_EXAMPLES.map((e) => JSON.stringify(e)).join('\n')}

Reply with JSON only: {"pictures": [{"beat": number, "name": "...", "shapes": [...], "accent": [...]}]}`;
}

// A drawing that is one of the examples, given another object's name.
export function copiedExample(item) {
  const shapes = JSON.stringify(item?.shapes ?? null);
  const name = String(item?.name || '').toLowerCase();
  return PICTURE_EXAMPLES.some((e) => JSON.stringify(e.shapes) === shapes && !e.name.split(' ').some((w) => name.includes(w)));
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
    const { picture } = copiedExample(item) ? { picture: null } : normalizeDrawing(item);
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
