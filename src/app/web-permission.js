// Asking the person before anything is looked up on the web: every search and
// every address is listed, each can be left out, and nothing leaves the
// computer until they say yes.

import { h, dialog } from './dom.js';

// Resolves { searches, pages } with what the person allowed, or null.
export function askToLookUp({ searches = [], pages = [] }) {
  return new Promise((resolve) => {
    let answered = false;
    const finish = (v) => { if (answered) return; answered = true; resolve(v); d.close(); };
    const d = dialog({ title: 'Look things up on the web?', onClose: () => finish(null) });
    const row = (kind, text) => {
      const box = h('input', { type: 'checkbox', checked: true });
      return { box, kind, text, el: h('label', { class: 'permit-row' }, box, h('span', { class: 'permit-kind', text: kind === 'search' ? 'Search' : 'Read' }), h('span', { class: 'permit-text', text })) };
    };
    const rows = [...searches.map((q) => row('search', q)), ...pages.map((u) => row('page', u))];
    d.body.append(
      h('p', { class: 'insp-note', text: 'To write this film, the model would like to look these up. Searches go to your search service, or to Wikipedia when none is set; pages are read from their own sites. Only what you leave ticked is looked up, and only for this film.' }),
      h('div', { class: 'permit-list' }, ...rows.map((r) => r.el)),
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'text-btn', type: 'button', text: 'Not this time', onclick: () => finish(null) }),
        h('button', { class: 'primary-btn', type: 'button', text: 'Look them up', onclick: () => finish({ searches: rows.filter((r) => r.kind === 'search' && r.box.checked).map((r) => r.text), pages: rows.filter((r) => r.kind === 'page' && r.box.checked).map((r) => r.text) }) })));
  });
}
