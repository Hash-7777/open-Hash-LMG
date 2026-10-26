// Settings, About: the app, who makes it, and the maker's other apps.
//
// The app's mark as it ships, its maker, how long it has been in the making,
// its version and licence, the places to read the source and report a
// problem, and the other apps by the same maker, each with a line on what it
// does and a link where its source is public. Links open in the browser.
//
// This is the one file in the app that names other apps: the maker's own, by
// his choice, as each of his apps' About does. scripts/checks/no-names.mjs
// keeps the exception to this file alone.

import { h } from './dom.js';
import { ICONS } from './icons.js';
import { appVersion, openExternal } from '../platform/index.js';

const SOURCE = 'https://github.com/Hash-7777/open-Hash-LMG';
const SINCE = '13 October 2026';

const APPS = [
  { name: 'Hash LMG', here: true, url: SOURCE, text: 'One sentence in, a finished motion-graphics film out: storyboard, motion, music and voice, made with a model on this computer or any cloud model on your own key.' },
  { name: 'HashCortX', url: 'https://github.com/Hash-7777/HashCortX', text: 'Every AI model in one window: chat, a coding agent that proves its own work, agent teams, 3D and business tools, on your keys and your machine.' },
  { name: 'HashCerebrum', soon: true, text: 'Medical research you can check. It reads real papers, grades every claim against the source it cites, and writes up what it actually found.' },
  { name: 'HashNotch', url: 'https://github.com/Hash-7777/HashNotch', text: 'Turns the notch on a Mac into a live status bar, so a long run can finish while you look away.' },
  { name: 'HashMeterAi', url: 'https://github.com/Hash-7777/HashMeterAi', text: 'What your AI habit really costs: it counts the tokens the AI tools on your computer spend, from their own logs, with nothing sent anywhere.' },
];

const LINKS = [
  ['Source', SOURCE],
  ['Report a problem', `${SOURCE}/issues`],
  ['Security', `${SOURCE}/blob/main/docs/SECURITY.md`],
  ['Licence', `${SOURCE}/blob/main/LICENSE`],
];

const link = (label, url) => h('button', { type: 'button', class: 'about-link', onclick: () => openExternal(url) }, h('span', { text: label }), h('span', { class: 'about-link-icon', html: ICONS.external }));

export function aboutPane() {
  const version = h('span', { class: 'about-version', text: 'Hash LMG' });
  appVersion().then((v) => { if (v) version.textContent = `Hash LMG ${v}`; });
  return [h('div', { class: 'about' },
    h('img', { class: 'about-mark', src: 'assets/app-mark.png', width: '96', height: '96', alt: 'Hash LMG', draggable: 'false' }),
    h('div', { class: 'about-name', text: 'Seif Hashish' }),
    h('div', { class: 'about-role', text: 'Application Creator and Developer' }),
    h('div', { class: 'about-rule' }),
    h('div', { class: 'about-line', text: 'Local Motion Graphics · One sentence in · A finished film out' }),
    h('div', { class: 'about-badge' }, h('span', { class: 'about-badge-icon', html: ICONS.history }), h('span', { text: `Building since ${SINCE}` })),
    h('p', { class: 'about-origin', text: 'It began as a pipeline for launch films. Same idea, grown into an app that makes them from a sentence.' }),
    h('div', { class: 'about-meta' }, version, h('span', { text: 'Free software, GNU GPL version 3 or later' })),
    h('div', { class: 'about-links' }, ...LINKS.map(([label, url]) => link(label, url))),
    h('section', { class: 'about-apps', 'aria-label': 'The Hash apps' },
      h('h3', { class: 'about-apps-title', text: 'The Hash apps' }),
      h('p', { class: 'about-apps-lede', text: 'Tools that run on your own machine and keep your work there.' }),
      ...APPS.map((a) => h(a.url && !a.here ? 'button' : 'div', { type: a.url && !a.here ? 'button' : null, class: `about-app${a.url && !a.here ? ' linked' : ''}`, onclick: a.url && !a.here ? () => openExternal(a.url) : null },
        h('span', { class: 'about-app-name' }, h('span', { text: a.name }), a.here ? h('span', { class: 'about-tag', text: 'you are here' }) : a.soon ? h('span', { class: 'about-tag', text: 'coming soon' }) : null),
        h('span', { class: 'about-app-text', text: a.text })))))];
}
