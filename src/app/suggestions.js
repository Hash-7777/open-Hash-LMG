// Briefs to start from, shown under an empty brief: a few at a time, another
// few on request. Each is written the way a good brief reads (what the film is
// for, who watches it, what it must say) about an invented product or event,
// and carries the length and frame shape that suit it.

import { h, clear } from './dom.js';
import { ICONS } from './icons.js';

export const SUGGESTIONS = [
  { text: 'A 30 second launch film for Lumen Desk, an invented lamp that dims distractions. Calm, premium, ends on lumen.example.', seconds: 30, aspect: '16:9' },
  { text: 'Introduce Northwind, an invented AI tool that turns spreadsheets into live dashboards. Show three features and a 4x faster stat.', seconds: 30, aspect: '16:9' },
  { text: 'A vertical teaser for Saltline, an invented surf festival on 12 to 14 June. Energetic, bold, big numbers, ends on saltline.example.', seconds: 15, aspect: '9:16' },
  { text: 'The year in numbers for Harbour Bank, an invented bank: 2.1 million customers, 38% more savers, 4.8 star app. Serious and clear.', seconds: 30, aspect: '16:9' },
  { text: 'A warm film for Crumb and Co, an invented bakery opening on Mill Street. Fresh bread at 7, coffee all day, a quote from a regular.', seconds: 20, aspect: '4:5' },
  { text: 'Explain how Tidepool, an invented budgeting app, works in three steps: connect, set a goal, watch it grow. Friendly and simple.', seconds: 30, aspect: '9:16' },
  { text: 'A luxury reveal for Atelier Nine, an invented watchmaker. Slow, elegant, a serif title, one number: 212 hours of hand finishing.', seconds: 20, aspect: '16:9' },
  { text: 'A calm 20 second film for Stillwater, an invented sleep app: fall asleep 23 minutes sooner, a quote, then the download line.', seconds: 20, aspect: '9:16' },
  { text: 'Announce version 3 of Gridline, an invented code editor: twice as fast, offline mode, a new theme. Technical, crisp, mono labels.', seconds: 30, aspect: '16:9' },
  { text: 'A playful film for Pop Pals, an invented snack for kids. Three flavours, a fun fact, bright colours, ends on poppals.example.', seconds: 15, aspect: '1:1' },
  { text: 'A fundraising film for the invented Riverbend Trust: 1,200 trees planted, 40 volunteers, a goal of 5,000 by spring. Hopeful.', seconds: 30, aspect: '16:9' },
  { text: 'A recruitment teaser for Orbit Labs, an invented robotics start-up: build what moves, three open roles, ends on orbitlabs.example.', seconds: 20, aspect: '9:16' },
  { text: 'Compare before and after for Clearmail, an invented inbox tool: 312 unread to zero, two hours saved a day. Confident and clean.', seconds: 20, aspect: '16:9' },
  { text: 'An event opener for the invented Future Health Summit 2027: three speakers, two days, one question. Serious, cinematic, slow build.', seconds: 30, aspect: '16:9' },
  { text: 'A product tour title sequence for Fieldnote, an invented notes app: capture, connect, recall. Minimal, Swiss, a red accent.', seconds: 15, aspect: '16:9' },
  { text: 'A sale film for Kinfolk Outdoors, an invented outdoor shop: 30% off tents this weekend only, three products, energetic.', seconds: 15, aspect: '9:16' },
];

// A small panel of ideas: pick(s) is called with the suggestion chosen.
export function createSuggestions({ pick, count = 3 }) {
  let start = Math.floor(Math.random() * SUGGESTIONS.length);
  const list = h('div', { class: 'ideas-list' });
  const more = h('button', { type: 'button', class: 'ideas-more', title: 'Show other ideas', 'aria-label': 'Show other ideas', html: ICONS.loop });
  const el = h('div', { class: 'ideas' }, h('div', { class: 'ideas-head' }, h('span', { text: 'Ideas to start from' }), more), list);

  function paint() {
    clear(list).append(...Array.from({ length: count }, (_, i) => {
      const s = SUGGESTIONS[(start + i) % SUGGESTIONS.length];
      return h('button', { type: 'button', class: 'idea', title: s.text, onclick: () => pick(s) }, h('span', { class: 'idea-text', text: s.text }));
    }));
  }
  more.addEventListener('click', () => { start = (start + count) % SUGGESTIONS.length; paint(); });
  paint();
  return { el, show(on) { el.hidden = !on; } };
}
