// The films kept on this computer: open one, start a new one, or delete one.

import { h, clear, dialog, toast } from './dom.js';
import { textButton } from './fields.js';
import { projects } from '../platform/index.js';

function when(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const same = d.toDateString() === new Date().toDateString();
  return same ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

export function openProjectsDialog({ currentId, onOpen, onNew, onTemplates }) {
  const d = dialog({ title: 'Films' });
  const list = h('ul', { class: 'project-list' });
  d.body.append(list, h('div', { class: 'dialog-actions' },
    onTemplates ? textButton('Start from a template', () => { d.close(); onTemplates(); }) : null,
    textButton('New film', () => { d.close(); onNew(); }, 'primary-text')));

  async function paint() {
    let rows = [];
    try { rows = await projects.list(); } catch (err) { toast(err.message || String(err), 'error'); }
    clear(list);
    if (!rows.length) { list.append(h('li', { class: 'project-empty', text: 'No saved films yet.' })); return; }
    for (const r of rows) {
      const open = h('button', { class: 'project-open', type: 'button' },
        h('span', { class: 'project-title', text: r.title || 'Untitled film' }),
        h('span', { class: 'project-when', text: r.id === currentId ? 'Open now' : when(r.updated) }));
      open.addEventListener('click', () => { d.close(); if (r.id !== currentId) onOpen(r.id); });
      const del = textButton('Delete', async () => {
        if (del.dataset.confirm !== '1') { del.dataset.confirm = '1'; del.textContent = 'Delete for good'; return; }
        try { await projects.remove(r.id); } catch (err) { toast(err.message || String(err), 'error'); }
        if (r.id === currentId) { d.close(); onNew({ discard: true }); return; }
        paint();
      }, 'danger');
      list.append(h('li', { class: `project-row${r.id === currentId ? ' current' : ''}` }, open, del));
    }
  }
  paint();
  return d;
}
