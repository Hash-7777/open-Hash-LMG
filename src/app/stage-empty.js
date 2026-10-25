// What an empty film says, over the empty frame: how to begin.

import { h } from './dom.js';

export function emptyFilm(store, onTemplates) {
  const el = h('div', { class: 'stage-empty', hidden: true },
    h('div', { class: 'stage-empty-title', text: 'No film yet' }),
    h('div', { class: 'stage-empty-text', text: 'Tell the director on the left what the film should be, or start from a template.' }),
    onTemplates ? h('button', { type: 'button', class: 'text-btn', text: 'Start from a template', onclick: onTemplates }) : null);
  const paint = () => { el.hidden = store.get().project.scene.scenes.length > 0; };
  store.on('project', paint);
  paint();
  return el;
}
