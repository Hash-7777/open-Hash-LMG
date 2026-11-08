// The product film form: what a launch film for a product is made from. The
// name, one line on what it does, its icon, and the facts it may claim, typed
// one per line and, for a longer list, from a file. The film claims nothing
// that is not here. Opened from the New film menu, filled with what the open
// product film was made from, if it is one.

import { h, dialog, toast } from './dom.js';
import { field, textInput, textArea, buttonRow, textButton } from './fields.js';
import { pickFile } from '../platform/index.js';
import { readFactsFile } from '../core/scene/product-board.js';

const MAX_ICON = 1024;

// A picture file as a film asset, made no larger than an icon needs.
async function iconAsset(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_ICON / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return { kind: 'image', name: file.name.slice(0, 120), data: c.toDataURL('image/png'), width: c.width, height: c.height };
}

// given: the form to start from (or null); icon: its picture asset (or null).
// onMake(form, icon) is called with what was filled in.
export function openProductDialog({ given = null, icon = null, voiceReady = false, onMake }) {
  const d = dialog({ title: 'Product film' });
  d.el.classList.add('product-dialog');
  const form = { name: given?.name || '', line: given?.line || '', facts: given?.facts || '', file: given?.file || null, icon: given?.icon || null, board: given?.board || null };
  let picture = icon;

  const thumb = h('div', { class: 'product-icon' });
  const paintIcon = () => {
    thumb.replaceChildren(picture ? h('img', { src: picture.data, alt: '' }) : h('span', { class: 'product-icon-empty', text: 'No icon' }));
    iconBtn.textContent = picture ? 'Change icon' : 'Choose icon';
  };
  const iconBtn = textButton('Choose icon', async () => {
    const f = await pickFile('image/png,image/jpeg,image/webp');
    if (!f) return;
    try { picture = await iconAsset(f); paintIcon(); } catch { toast('That picture could not be read.', 'error'); }
  });
  const fileName = h('span', { class: 'product-file-name' });
  const paintFile = () => { fileName.textContent = form.file ? form.file.name : 'No file'; removeFile.hidden = !form.file; };
  const removeFile = textButton('Remove', () => { form.file = null; paintFile(); });
  const fileBtn = textButton('Add a facts file', async () => {
    const f = await pickFile('.txt,.md,.json,text/plain,application/json');
    if (!f) return;
    if (f.size > 200000) { toast('That file is too long for a facts file.', 'error'); return; }
    form.file = readFactsFile(f.name, await f.text());
    paintFile();
  });

  d.body.append(h('div', { class: 'insp-section product-form' },
    h('p', { class: 'insp-note', text: 'A short launch film for your product: its name, what it does, how it works and what it offers, told in diagrams that light as they are spoken. The film says only what you give it here.' }),
    field('Name', textInput(form.name, (v) => { form.name = v.trim(); }, { placeholder: 'Orbi Desk', max: 40 })),
    field('What it does, in one line', textInput(form.line, (v) => { form.line = v.trim(); }, { placeholder: 'A desk lamp that sets its own light for the hour.', max: 160 })),
    field('Icon', h('div', { class: 'product-icon-row' }, thumb, iconBtn), 'Its two strongest colours become the film’s accents.'),
    field('Facts, one per line', textArea(form.facts, { onLive: (v) => { form.facts = v; }, onCommit: (v) => { form.facts = v; }, rows: 6, max: 4000, placeholder: 'Three light modes\nDims by itself at night\nWorks with no account' }),
      'Every number, format and name the film uses must be here or in the file.'),
    field('More facts from a file', h('div', { class: 'product-file-row' }, fileBtn, fileName, removeFile), 'A text file read line by line, or a JSON file.'),
    h('p', { class: 'insp-note', text: voiceReady ? 'It is narrated in the voice chosen in Settings.' : 'No voice is chosen, so it is timed as if spoken. Choose one in Settings, under Voice, to hear it.' }),
    buttonRow(textButton('Cancel', () => d.close()), h('button', { type: 'button', class: 'primary-btn', text: 'Make the film', onclick: () => {
      // The inputs commit on change; read them again in case one still has focus.
      for (const el of d.body.querySelectorAll('input.input')) el.dispatchEvent(new Event('change'));
      if (!form.name) { toast('Give the product its name first.'); return; }
      if (!form.line) { toast('Say what it does in one line first.'); return; }
      d.close();
      onMake({ ...form, icon: picture ? 'product-icon' : null }, picture);
    } }))));
  paintIcon();
  paintFile();
  return d;
}
