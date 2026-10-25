// The person's own pictures and footage in a film made by a model.
//
// Pictures and clips imported in the Media panel are listed for the model by
// number, with what is known about each (its name, its shape, how long a clip
// runs, and, from a model that can see, what it shows). The storyboard says
// which beat shows which, as "media": its number. A model that names none of
// them when the person gave some still gets them shown: each one left out goes
// on a beat that suits it, so a brief that says "use the picture I gave you"
// is never ignored. Sounds are not listed: a sound chosen as the music stays
// the music.

import { looksLikeLogo } from '../director/brand.js';

const SHOWS = ['hook', 'statement', 'title', 'logo', 'quote', 'end', 'list', 'steps', 'stat'];
// Beats a second look at a picture can take: the one right after its first.
const AGAIN = ['statement', 'list', 'steps', 'stat', 'hook', 'quote'];
// Where a picture named like the brand's mark goes first.
const MARK_BEATS = ['logo', 'end', 'title'];

// The person's media in a film's assets, numbered from 1:
// [{ n, key, kind: 'image' | 'video', name, width, height, duration }]
export function mediaList(assets) {
  return Object.entries(assets || {})
    .filter(([, a]) => a && (a.kind === 'image' || a.kind === 'video') && (a.data || a.media))
    .slice(0, 12)
    .map(([key, a], i) => ({ n: i + 1, key, kind: a.kind, name: String(a.name || key).slice(0, 80), width: a.width || 0, height: a.height || 0, duration: a.duration || 0, about: String(a.about || '').slice(0, 300) }));
}

const shapeOf = (m) => (!m.width || !m.height ? '' : m.width / m.height > 1.25 ? 'wide' : m.height / m.width > 1.25 ? 'tall' : 'square');

// The lines added to the storyboard prompt when the person gave media.
export function mediaPromptText(list) {
  if (!list.length) return '';
  const lines = list.map((m) => `${m.n}. ${m.kind === 'video' ? `a video clip, ${m.duration.toFixed(1)} s` : 'a picture'}${shapeOf(m) ? `, ${shapeOf(m)}` : ''}, "${m.name}"${m.kind === 'image' && looksLikeLogo(m.name) ? ', named like the brand\u2019s logo: show it on the logo or end beat' : ''}${m.about ? `: ${m.about}` : ''}`);
  return `\n\nThe person gave their own media for this film:\n${lines.join('\n')}\nShow each of them where it helps the viewer most by adding "media": its number to that beat (any kind but chart, compare and words); the beat's words, items or figure then sit beside it, so keep them short. A screenshot or product picture can carry several beats, the moments the brief is about: the same number on two beats in a row moves the picture into a closer second look. Write about what each shows when you know it; never describe one you cannot see beyond its name.`;
}

// Turns each beat's media number into the asset key, drops numbers that name
// nothing, and gives every item the model left out a beat of its own choice:
// the first beat that suits it and shows nothing yet, skipping the opening
// hook when another will do. Returns { storyboard, notes }.
export function placeMedia(storyboard, list) {
  if (!list.length) return { storyboard, notes: [] };
  const byN = new Map(list.map((m) => [String(m.n), m]));
  const byKey = new Map(list.map((m) => [m.key, m]));
  const notes = [];
  const beats = storyboard.beats.map((b) => {
    const { media, ...rest } = b;
    const m = media !== undefined && media !== null ? byN.get(String(media).replace(/^#/, '')) || byKey.get(String(media)) : null;
    return m && SHOWS.includes(b.kind) ? { ...rest, media: m.key } : rest;
  });
  const used = new Set(beats.map((b) => b.media).filter(Boolean));
  const free = (b) => SHOWS.includes(b.kind) && !b.media && !b.picture;
  let placed = 0;
  // Marks first, so they take the beats that show the brand.
  const marksFirst = [...list].sort((a, b) => (looksLikeLogo(b.name) && b.kind === 'image') - (looksLikeLogo(a.name) && a.kind === 'image'));
  for (const m of marksFirst) {
    if (used.has(m.key)) continue;
    const mark = m.kind === 'image' && looksLikeLogo(m.name);
    const order = [...beats.keys()].sort((a, b) => (mark ? (MARK_BEATS.includes(beats[b].kind) - MARK_BEATS.includes(beats[a].kind)) : 0) || (a === 0) - (b === 0) || a - b);
    const at = order.find((i) => free(beats[i])) ?? order.find((i) => SHOWS.includes(beats[i].kind) && !beats[i].media);
    if (at === undefined) continue;
    const { picture, ...rest } = beats[at];
    beats[at] = { ...rest, media: m.key };
    used.add(m.key);
    placed++;
  }
  if (placed) notes.push(`${placed === 1 ? 'Your picture or clip was' : `${placed} of your pictures and clips were`} put on the film's beats, since the storyboard left ${placed === 1 ? 'it' : 'them'} out.`);
  // Every picture that is not the brand's mark gets a second, closer look on
  // the beat right after its first, when that beat shows nothing of its own:
  // the person's media carries more of the film, and moves between the two.
  let again = 0;
  for (const m of list) {
    if (m.kind !== 'image' || looksLikeLogo(m.name)) continue;
    const at = beats.map((b, i) => (b.media === m.key ? i : -1)).filter((i) => i >= 0);
    if (at.length !== 1) continue;
    const next = beats[at[0] + 1];
    if (!next || !AGAIN.includes(next.kind) || next.media || next.picture || at[0] + 1 === beats.length - 1) continue;
    beats[at[0] + 1] = { ...next, media: m.key };
    again++;
  }
  if (again) notes.push(`${again === 1 ? 'Your picture gets' : `${again} of your pictures get`} a second, closer look on the beat after ${again === 1 ? 'its' : 'their'} first.`);
  const shown = beats.filter((b) => b.media).length;
  if (shown) notes.push(`${shown === 1 ? 'One scene shows' : `${shown} scenes show`} your own media.`);
  return { storyboard: { ...storyboard, beats }, notes };
}

// The assets a new film keeps from the one it replaces: the person's media,
// and nothing a model or an earlier film made.
export function keptAssets(assets) {
  return Object.fromEntries(Object.entries(assets || {}).filter(([, a]) => a && ['image', 'video', 'sound'].includes(a.kind) && (a.data || a.media)));
}
