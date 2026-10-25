// How a file given to the director looks in the conversation: what it is,
// not only its name. A picture shows itself, a clip its opening frame and
// its length, a sound its length, a text file its first lines; each on a
// small pane of frosted glass with its name along the foot.
//
// Small and square over the message box, where each has a button to take it
// back out of the film; larger, at the picture's own shape, in a message. A
// picture opens larger when clicked.

import { h, dialog } from './dom.js';
import { ICONS } from './icons.js';
import { media } from '../platform/index.js';

const KIND_WORD = { image: 'Picture', video: 'Clip', sound: 'Sound', doc: 'Text' };
const length = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${Math.max(0.1, s).toFixed(1)} s`);

function openPicture(name, src) {
  const d = dialog({ title: name, wide: true });
  d.el.classList.add('picture-view');
  d.body.append(h('img', { class: 'picture-view-img', src, alt: name }));
}

// a: { key, name, kind }; project: the open film, to find the file's content.
// opts: { large, onRemove }
export function attachmentTile(a, project, { large = false, onRemove = null } = {}) {
  const asset = project.scene.assets[a.key];
  const doc = a.kind === 'doc' ? project.docs.find((d) => d.key === a.key) : null;
  const gone = a.kind === 'doc' ? !doc : !asset;
  const tile = h('figure', { class: `attach-tile ${a.kind}${large ? ' large' : ''}${gone ? ' gone' : ''}`, title: `${KIND_WORD[a.kind] || 'File'}: ${a.name}${gone ? ' (no longer in the film)' : ''}` });
  let face;
  if (gone) {
    face = h('div', { class: 'attach-face blank', html: ICONS.cross });
  } else if (a.kind === 'image') {
    face = h('img', { class: 'attach-face', src: asset.data, alt: a.name, draggable: 'false' });
    // A large tile keeps the picture's own shape.
    if (large && asset.width && asset.height) tile.style.aspectRatio = `${Math.min(2.4, Math.max(0.6, asset.width / asset.height))}`;
    tile.classList.add('opens');
    tile.addEventListener('click', (e) => { if (!e.target.closest('.attach-x')) openPicture(a.name, asset.data); });
  } else if (a.kind === 'video') {
    // A frame a moment in, where a clip has usually faded up, shown by the
    // system's own player without playing.
    const at = Math.min(1.5, Math.max(0.1, (asset.duration || 0) / 3)).toFixed(1);
    face = h('video', { class: 'attach-face', src: `${media.url(asset.media)}#t=${at}`, muted: true, preload: 'metadata', playsinline: true });
    if (large && asset.width && asset.height) tile.style.aspectRatio = `${Math.min(2.4, Math.max(0.6, asset.width / asset.height))}`;
    tile.append(h('span', { class: 'attach-badge', text: length(asset.duration || 0) }));
  } else if (a.kind === 'sound') {
    face = h('div', { class: 'attach-face glyph' }, h('span', { html: ICONS.music }), h('span', { class: 'attach-len', text: length(asset.duration || 0) }));
  } else {
    face = h('div', { class: 'attach-face text', text: doc.text.replace(/\s+/g, ' ').trim().slice(0, large ? 220 : 90) });
  }
  tile.prepend(face);
  tile.append(h('figcaption', { class: 'attach-cap' }, h('span', { class: 'attach-kind', text: KIND_WORD[a.kind] || 'File' }), h('span', { class: 'attach-name', text: a.name })));
  if (onRemove) tile.append(h('button', { type: 'button', class: 'attach-x', 'aria-label': `Take ${a.name} out of the film`, title: 'Take it out of the film', html: ICONS.cross, onclick: (e) => { e.stopPropagation(); onRemove(); } }));
  return tile;
}
