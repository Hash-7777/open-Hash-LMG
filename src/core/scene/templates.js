// Films to start from: each a storyboard of a common kind of film, written
// about an invented product or event, with the length and frame shape that
// suit it and the mood its look is directed by. Choosing one makes a whole
// film at once, by rule, with no model: the words are then edited in the
// inspector, or rewritten by asking for a change.

import { normalizeStoryboard } from './storyboard.js';
import { chooseDirection } from './direction.js';
import { compileStoryboard } from './compile.js';

export const TEMPLATES = [
  {
    id: 'launch', name: 'Product launch', blurb: 'A hook, the name, one figure, what it does, where to get it.', seconds: 30, aspect: '16:9',
    brief: 'A launch film for Lumen Desk, an invented lamp that dims distractions.',
    storyboard: { title: 'Lumen Desk', look: { mood: 'bold' }, beats: [
      { kind: 'hook', text: 'Your desk is *loud*.' },
      { kind: 'statement', text: 'Lumen makes it calm', sub: 'one light, one place' },
      { kind: 'title', text: 'Lumen Desk', sub: 'The quiet workspace' },
      { kind: 'stat', value: 38, suffix: '%', sub: 'fewer interruptions' },
      { kind: 'list', text: 'What it does', items: ['Dims the noise', 'Keeps your focus', 'Learns your day'] },
      { kind: 'end', text: 'Lumen Desk', sub: 'lumen.example' },
    ] },
  },
  {
    id: 'explainer', name: 'How it works', blurb: 'Three steps, one result, a word from a user.', seconds: 30, aspect: '9:16',
    brief: 'Explain how Tidepool, an invented budgeting app, works in three steps.',
    storyboard: { title: 'Tidepool', look: { mood: 'playful' }, beats: [
      { kind: 'hook', text: 'Saving should feel *easy*.' },
      { kind: 'steps', text: 'How it works', items: ['Connect', 'Set a goal', 'Watch it grow'] },
      { kind: 'stat', value: 412, prefix: '$', sub: 'saved in a first month, on average' },
      { kind: 'quote', text: 'The first app that made me want to save.', by: 'An early user' },
      { kind: 'end', text: 'Tidepool', sub: 'tidepool.example' },
    ] },
  },
  {
    id: 'results', name: 'Year in numbers', blurb: 'The figures that matter, a chart and a before and after.', seconds: 30, aspect: '16:9',
    brief: 'The year in numbers for Harbour Bank, an invented bank.',
    storyboard: { title: 'Harbour Bank', look: { mood: 'serious' }, beats: [
      { kind: 'title', text: 'Our year', sub: 'Harbour Bank, 2026' },
      { kind: 'stat', value: 2.1, decimals: 1, suffix: ' million', sub: 'customers' },
      { kind: 'chart', text: 'Savers by quarter', values: [62, 71, 80, 86], labels: ['Q1', 'Q2', 'Q3', 'Q4'] },
      { kind: 'compare', left: { label: 'Then', text: 'Three days to open' }, right: { label: 'Now', text: 'Four minutes' } },
      { kind: 'end', text: 'Harbour Bank', sub: 'harbour.example' },
    ] },
  },
  {
    id: 'event', name: 'Event teaser', blurb: 'Punchy words on the beat, the name, the date.', seconds: 15, aspect: '9:16',
    brief: 'A teaser for Saltline, an invented surf festival on 12 to 14 June.',
    storyboard: { title: 'Saltline', look: { mood: 'energetic', tempo: 'fast' }, beats: [
      { kind: 'words', words: ['Surf', 'Sound', 'Sun'] },
      { kind: 'title', text: 'Saltline', sub: 'Surf festival' },
      { kind: 'statement', text: '12 to 14 June', sub: 'Three days on the coast' },
      { kind: 'end', text: 'Saltline', sub: 'saltline.example' },
    ] },
  },
  {
    id: 'testimonial', name: 'In their words', blurb: 'A quote that carries the film, one figure, the name.', seconds: 20, aspect: '1:1',
    brief: 'A testimonial film for Crumb and Co, an invented bakery.',
    storyboard: { title: 'Crumb and Co', look: { mood: 'warm' }, beats: [
      { kind: 'hook', text: 'Fresh at seven, every day.' },
      { kind: 'quote', text: 'The best morning of my week starts here.', by: 'A regular' },
      { kind: 'stat', value: 14, sub: 'breads baked each morning' },
      { kind: 'end', text: 'Crumb and Co', sub: 'Mill Street' },
    ] },
  },
  {
    id: 'release', name: 'New release', blurb: 'The version, what is new, how much faster.', seconds: 30, aspect: '16:9',
    brief: 'Announce version 3 of Gridline, an invented code editor.',
    storyboard: { title: 'Gridline 3', look: { mood: 'technical' }, beats: [
      { kind: 'hook', text: 'Built for *speed*.' },
      { kind: 'title', text: 'Gridline 3', sub: 'The editor, rebuilt' },
      { kind: 'list', text: 'What is new', items: ['Twice as fast', 'Works offline', 'A new theme'] },
      { kind: 'compare', left: { label: 'Version 2', text: '1.8 s to open' }, right: { label: 'Version 3', text: '0.9 s' } },
      { kind: 'end', text: 'Gridline 3', sub: 'gridline.example' },
    ] },
  },
  {
    id: 'luxury', name: 'Quiet reveal', blurb: 'Slow, elegant, one figure that speaks for the craft.', seconds: 20, aspect: '16:9',
    brief: 'A reveal for Atelier Nine, an invented watchmaker.',
    storyboard: { title: 'Atelier Nine', look: { mood: 'luxury', tempo: 'slow' }, beats: [
      { kind: 'hook', text: 'Time, finished by hand.' },
      { kind: 'stat', value: 212, sub: 'hours of hand finishing' },
      { kind: 'title', text: 'Atelier Nine', sub: 'Calibre One' },
      { kind: 'end', text: 'Atelier Nine', sub: 'by appointment' },
    ] },
  },
  {
    id: 'calm', name: 'Calm app', blurb: 'Soft and slow: a promise, a figure, the download line.', seconds: 20, aspect: '9:16',
    brief: 'A calm film for Stillwater, an invented sleep app.',
    storyboard: { title: 'Stillwater', look: { mood: 'calm', tempo: 'slow' }, beats: [
      { kind: 'hook', text: 'Rest, without trying.' },
      { kind: 'statement', text: 'Breathe with the tide', sub: 'a guided wind-down each night' },
      { kind: 'stat', value: 23, suffix: ' min', sub: 'sooner to sleep' },
      { kind: 'end', text: 'Stillwater', sub: 'stillwater.example' },
    ] },
  },
];

// A whole film from a template, directed like any other: the same template
// and take always give the same film, a new take another.
// opts: { take, style ('auto' or a look), aspect, fps }
export function filmFromTemplate(tpl, opts = {}) {
  const { storyboard } = normalizeStoryboard(tpl.storyboard);
  const take = opts.take || 0;
  const direction = chooseDirection({ brief: tpl.brief, look: storyboard.look, style: opts.style || 'auto', take });
  const { scene } = compileStoryboard(storyboard, { direction, aspect: opts.aspect || tpl.aspect, fps: opts.fps, targetDuration: tpl.seconds });
  return { brief: tpl.brief, storyboard, scene, take };
}
