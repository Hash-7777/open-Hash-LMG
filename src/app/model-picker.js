// Choosing the model: one button that names the model in use, and a list of
// every model that can be used now, grouped by service. Each list is asked of
// its service when the picker opens (src/app/model-lists.js), so it is always
// the service's current list. Choosing a model remembers it for its service,
// so going back to a service picks up where it was left.

import { h, clear } from './dom.js';
import { ICONS } from './icons.js';
import { PROVIDERS } from '../core/providers/catalog.js';
import { modelProfile } from '../core/providers/models.js';
import { sizeText } from '../core/providers/local.js';

const SHOWN = 8;
const SIZE_WORDS = { small: 'Small', medium: 'Mid-size', large: 'Large', frontier: 'Frontier' };

// What a model is, in a few words: its size, whether it sees pictures, how
// big it is on disk.
function describe(id, m) {
  const prof = modelProfile(id, m.id, m.meta || {});
  return [SIZE_WORDS[prof.size], prof.vision ? 'sees pictures' : null, m.meta?.parameterSize, sizeText(m.meta?.bytes)].filter(Boolean).join(' · ');
}

export function createModelPicker({ settings, lists, openSettings }) {
  const name = h('span', { class: 'model-name' });
  const where = h('span', { class: 'model-where' });
  const button = h('button', { class: 'model-line', type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', title: 'Choose the model' },
    h('span', { class: 'model-dot', html: ICONS.dot }), name, where, h('span', { class: 'model-chevron', html: ICONS.chevronDown }));

  function paintButton() {
    const m = settings.get().model;
    name.textContent = m.model || 'Choose a model';
    where.textContent = m.model ? PROVIDERS[m.provider]?.label || '' : '';
    button.classList.toggle('missing', !m.model);
  }

  let menu = null;
  let query = '';
  const open = new Set(); // services shown in full

  function choose(id, model) {
    const m = settings.get().model;
    settings.update({ model: { provider: id, model, recent: { ...m.recent, [id]: model } } });
    close();
  }

  function paintMenu() {
    if (!menu) return;
    const s = settings.get().model;
    const q = query.trim().toLowerCase();
    const groups = lists.usable().map((id) => {
      const e = lists.get(id);
      const all = e.list.filter((m) => !q || m.id.toLowerCase().includes(q) || PROVIDERS[id].label.toLowerCase().includes(q));
      if (q && !all.length) return null;
      const shown = q || open.has(id) ? all : all.slice(0, SHOWN);
      const state = e.loading && !e.list.length ? 'Looking for models' : e.error && !e.list.length ? e.error : '';
      return h('div', { class: 'picker-group', role: 'group', 'aria-label': PROVIDERS[id].label },
        h('div', { class: 'picker-head' },
          h('span', { class: 'picker-service', text: PROVIDERS[id].label }),
          h('span', { class: 'picker-kind', text: PROVIDERS[id].kind === 'local' ? 'On this computer' : 'Cloud' })),
        state ? h('div', { class: `picker-state${e.error ? ' warn' : ''}`, text: state }) : null,
        ...shown.map((m) => {
          const on = s.provider === id && s.model === m.id;
          return h('button', { type: 'button', role: 'option', 'aria-selected': String(on), class: `picker-model${on ? ' on' : ''}`, onclick: () => choose(id, m.id) },
            h('span', { class: 'picker-id', text: m.id }),
            h('span', { class: 'picker-meta', text: describe(id, m) }),
            on ? h('span', { class: 'picker-check', html: ICONS.check }) : null);
        }),
        !q && all.length > shown.length ? h('button', { type: 'button', class: 'picker-more', text: `All ${all.length} models`, onclick: () => { open.add(id); paintMenu(); } }) : null);
    }).filter(Boolean);
    const body = menu.querySelector('.picker-body');
    const keep = body.scrollTop;
    clear(body).append(...(groups.length ? groups : [h('div', { class: 'picker-state', text: q ? 'No model matches.' : 'No model can be used yet. Add a key for a cloud service, or start a model app on this computer.' })]));
    body.scrollTop = keep;
  }

  function place() {
    if (!menu) return;
    const r = button.getBoundingClientRect();
    const width = Math.max(r.width, 300);
    const left = Math.min(r.left, window.innerWidth - width - 8);
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 280 && above > below;
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.width = `${width}px`;
    menu.style.maxHeight = `${Math.max(200, Math.min(520, up ? above : below))}px`;
    menu.style.top = up ? '' : `${r.bottom + 6}px`;
    menu.style.bottom = up ? `${window.innerHeight - r.top + 6}px` : '';
  }

  const onDown = (e) => { if (menu && !menu.contains(e.target) && !button.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape' && menu) { e.stopPropagation(); close(); button.focus(); } };

  function openMenu() {
    if (menu) { close(); return; }
    query = '';
    const search = h('input', { class: 'input picker-search', type: 'search', placeholder: 'Find a model', spellcheck: 'false', 'aria-label': 'Find a model' });
    search.addEventListener('input', () => { query = search.value; paintMenu(); });
    menu = h('div', { class: 'picker', role: 'listbox', 'aria-label': 'Models' },
      search,
      h('div', { class: 'picker-body' }),
      h('div', { class: 'picker-foot' },
        h('button', { type: 'button', class: 'picker-link', text: 'Add a cloud key', onclick: () => { close(); openSettings('keys'); } }),
        h('button', { type: 'button', class: 'picker-link', text: 'Models on this computer', onclick: () => { close(); openSettings('local'); } })));
    document.body.appendChild(menu);
    button.setAttribute('aria-expanded', 'true');
    place();
    paintMenu();
    search.focus();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', place);
    lists.refreshAll();
  }

  function close() {
    if (!menu) return;
    menu.remove();
    menu = null;
    button.setAttribute('aria-expanded', 'false');
    window.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', place);
  }

  button.addEventListener('click', openMenu);
  settings.subscribe(paintButton);
  lists.subscribe(paintMenu);
  paintButton();
  return { el: button, close, open: () => { if (!menu) openMenu(); } };
}
