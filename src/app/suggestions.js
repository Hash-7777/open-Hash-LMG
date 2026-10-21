// Briefs to start from, shown under an empty brief: a few at a time, another
// few on request. Each is written the way a good brief reads (what the film is
// for, who watches it, what it must say) about an invented product or event,
// and carries the length and frame shape that suit it.

import { h, clear, dialog } from './dom.js';
import { ICONS } from './icons.js';

export const SUGGESTIONS = [
  { title: 'Lumen Desk', kind: 'Launch', text: 'A 30 second launch film for Lumen Desk, an invented lamp that dims distractions. Calm, premium, ends on lumen.example.', seconds: 30, aspect: '16:9' },
  { title: 'Northwind', kind: 'Product', text: 'Introduce Northwind, an invented AI tool that turns spreadsheets into live dashboards. Show three features and a 4x faster stat.', seconds: 30, aspect: '16:9' },
  { title: 'Saltline', kind: 'Event', text: 'A vertical teaser for Saltline, an invented surf festival on 12 to 14 June. Energetic, bold, big numbers, ends on saltline.example.', seconds: 15, aspect: '9:16' },
  { title: 'Harbour Bank', kind: 'Results', text: 'The year in numbers for Harbour Bank, an invented bank: 2.1 million customers, 38% more savers, 4.8 star app. Serious and clear.', seconds: 30, aspect: '16:9' },
  { title: 'Crumb and Co', kind: 'Local business', text: 'A warm film for Crumb and Co, an invented bakery opening on Mill Street. Fresh bread at 7, coffee all day, a quote from a regular.', seconds: 20, aspect: '4:5' },
  { title: 'Tidepool', kind: 'Explainer', text: 'Explain how Tidepool, an invented budgeting app, works in three steps: connect, set a goal, watch it grow. Friendly and simple.', seconds: 30, aspect: '9:16' },
  { title: 'Atelier Nine', kind: 'Luxury', text: 'A luxury reveal for Atelier Nine, an invented watchmaker. Slow, elegant, a serif title, one number: 212 hours of hand finishing.', seconds: 20, aspect: '16:9' },
  { title: 'Stillwater', kind: 'Calm app', text: 'A calm 20 second film for Stillwater, an invented sleep app: fall asleep 23 minutes sooner, a quote, then the download line.', seconds: 20, aspect: '9:16' },
  { title: 'Gridline 3', kind: 'Release', text: 'Announce version 3 of Gridline, an invented code editor: twice as fast, offline mode, a new theme. Technical, crisp, mono labels.', seconds: 30, aspect: '16:9' },
  { title: 'Pop Pals', kind: 'Playful', text: 'A playful film for Pop Pals, an invented snack for kids. Three flavours, a fun fact, bright colours, ends on poppals.example.', seconds: 15, aspect: '1:1' },
  { title: 'Riverbend Trust', kind: 'Fundraising', text: 'A fundraising film for the invented Riverbend Trust: 1,200 trees planted, 40 volunteers, a goal of 5,000 by spring. Hopeful.', seconds: 30, aspect: '16:9' },
  { title: 'Orbit Labs', kind: 'Hiring', text: 'A recruitment teaser for Orbit Labs, an invented robotics start-up: build what moves, three open roles, ends on orbitlabs.example.', seconds: 20, aspect: '9:16' },
  { title: 'Clearmail', kind: 'Before and after', text: 'Compare before and after for Clearmail, an invented inbox tool: 312 unread to zero, two hours saved a day. Confident and clean.', seconds: 20, aspect: '16:9' },
  { title: 'Future Health Summit', kind: 'Event opener', text: 'An event opener for the invented Future Health Summit 2027: three speakers, two days, one question. Serious, cinematic, slow build.', seconds: 30, aspect: '16:9' },
  { title: 'Fieldnote', kind: 'Title sequence', text: 'A product tour title sequence for Fieldnote, an invented notes app: capture, connect, recall. Minimal, Swiss, a red accent.', seconds: 15, aspect: '16:9' },
  { title: 'Kinfolk Outdoors', kind: 'Sale', text: 'A sale film for Kinfolk Outdoors, an invented outdoor shop: 30% off tents this weekend only, three products, energetic.', seconds: 15, aspect: '9:16' },
];

// A small panel of ideas: pick(s) is called with the suggestion chosen.
// Each row is the idea's name over its kind, length and frame shape; the
// whole brief shows on hover, and See all lists every idea in full.
const meta = (s) => `${s.kind} · ${s.seconds} s · ${s.aspect}`;

export function createSuggestions({ pick, count = 3, openAll }) {
  let start = Math.floor(Math.random() * SUGGESTIONS.length);
  const list = h('div', { class: 'ideas-list' });
  const more = h('button', { type: 'button', class: 'ideas-more', title: 'Show other ideas', 'aria-label': 'Show other ideas', html: ICONS.loop });
  const all = h('button', { type: 'button', class: 'text-btn ideas-all', text: 'See all', onclick: () => openAll && openAll() });
  const el = h('div', { class: 'ideas' }, h('div', { class: 'ideas-head' }, h('span', { text: 'Ideas to start from' }), h('span', { class: 'ideas-tools' }, all, more)), list);

  function paint() {
    clear(list).append(...Array.from({ length: count }, (_, i) => {
      const s = SUGGESTIONS[(start + i) % SUGGESTIONS.length];
      return h('button', { type: 'button', class: 'idea', title: s.text, onclick: () => pick(s) },
        h('span', { class: 'idea-title', text: s.title }),
        h('span', { class: 'idea-meta', text: meta(s) }));
    }));
  }
  more.addEventListener('click', () => { start = (start + count) % SUGGESTIONS.length; paint(); });
  paint();
  return { el, show(on) { el.hidden = !on; } };
}

// Every idea in full, in a window: choosing one fills the brief.
export function openIdeasDialog({ pick }) {
  const d = dialog({ title: 'Ideas to start from', wide: true });
  d.el.classList.add('ideas-dialog');
  d.body.append(h('div', { class: 'ideas-grid' }, ...SUGGESTIONS.map((s) => h('button', { type: 'button', class: 'idea-card', onclick: () => { d.close(); pick(s); } },
    h('span', { class: 'idea-card-head' }, h('span', { class: 'idea-title', text: s.title }), h('span', { class: 'idea-meta', text: meta(s) })),
    h('span', { class: 'idea-card-text', text: s.text })))));
  return d;
}
