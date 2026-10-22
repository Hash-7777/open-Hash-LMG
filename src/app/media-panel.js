// The Media panel: footage, pictures and sound brought into the film.
//
// Importing remembers each file (the desktop app keeps it where it is and
// reads it by id) and adds it to the film's assets, with what is known about
// it: a clip's length and size, a sound's length. Pictures are carried inside
// the film, as before. From here a clip or a picture is added to the end of
// the film as a scene of its own, and a sound becomes the film's music.

import { h, clear, toast } from './dom.js';
import { ICONS } from './icons.js';
import { media } from '../platform/index.js';

const fmtTime = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${s.toFixed(1)} s`);
const stem = (name) => String(name || 'Clip').replace(/\.[^.]+$/, '').slice(0, 60);

// What a file holds, read by the system's own player: length and size.
function probe(item) {
  return new Promise((resolve) => {
    const el = document.createElement(item.kind === 'sound' ? 'audio' : 'video');
    el.preload = 'metadata';
    el.muted = true;
    const done = (info) => { el.removeAttribute('src'); resolve(info); };
    el.addEventListener('loadedmetadata', () => done({ duration: Number.isFinite(el.duration) ? el.duration : 0, width: el.videoWidth || 0, height: el.videoHeight || 0 }), { once: true });
    el.addEventListener('error', () => done(null), { once: true });
    setTimeout(() => done(null), 15000);
    el.src = media.url(item.id);
  });
}

// A picture, carried inside the film as data.
async function pictureData(item) {
  const blob = await media.read(item.id);
  const data = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(blob); });
  const bmp = await createImageBitmap(blob);
  const out = { data, width: bmp.width, height: bmp.height };
  bmp.close();
  return out;
}

export function createMediaPanel({ store }) {
  const list = h('div', { class: 'media-list' });
  const importBtn = h('button', { type: 'button', class: 'secondary-btn wide', onclick: () => importFiles() }, h('span', { html: ICONS.plus }), h('span', { text: 'Import footage, pictures or sound' }));
  const el = h('div', { class: 'media-panel', hidden: true },
    h('div', { class: 'media-body' }, importBtn,
      h('p', { class: 'field-hint', text: 'Video (MP4, MOV, WebM), pictures (PNG, JPEG, WebP, GIF) and sound (MP3, WAV, M4A, FLAC, Ogg). Files stay where they are; the film links to them.' }),
      list));

  async function importFiles() {
    let items;
    try { items = await media.import(); } catch (err) { toast(err.message || String(err), 'error'); return; }
    if (!items.length) return;
    importBtn.disabled = true;
    let added = 0;
    for (const item of items) {
      const key = `${item.kind}-${item.id.slice(0, 10)}`;
      try {
        if (item.kind === 'image') {
          const pic = await pictureData(item);
          store.edit((doc) => { doc.assets[key] = { kind: 'image', name: item.name, ...pic }; });
        } else {
          const info = await probe(item);
          if (!info || !info.duration) { toast(`"${item.name}" could not be read here.`, 'error'); continue; }
          store.edit((doc) => {
            doc.assets[key] = item.kind === 'video'
              ? { kind: 'video', name: item.name, media: item.id, duration: info.duration, width: info.width, height: info.height, audio: true }
              : { kind: 'sound', name: item.name, media: item.id, duration: info.duration };
          });
        }
        added++;
      } catch (err) { toast(`"${item.name}": ${err.message || err}`, 'error'); }
    }
    importBtn.disabled = false;
    if (added) toast(`${added} file${added === 1 ? '' : 's'} added to the film's media`);
  }

  // A clip or a picture as a new scene at the end of the film.
  function addToFilm(key, a) {
    store.edit((doc) => {
      const u = Math.min(doc.width, doc.height) / 1080;
      const full = { x: 0.5, y: 0.5, w: Math.round(doc.width / u), h: Math.round(doc.height / u), fit: 'cover' };
      doc.scenes.push(a.kind === 'video'
        ? { id: `clip-${doc.scenes.length + 1}`, name: stem(a.name), duration: Math.min(a.duration, 600), transition: { kind: 'cut' }, camera: { zoom: [1, 1] }, layers: [{ type: 'video', asset: key, ...full, from: 0 }] }
        : { id: `still-${doc.scenes.length + 1}`, name: stem(a.name), duration: 4, transition: { kind: doc.scenes.length ? 'fade' : 'cut', duration: 0.5 }, camera: { zoom: [1, 1.05], ease: 'linear' }, layers: [{ type: 'image', asset: key, ...full }] });
    });
    toast(`Added to the end of the film`);
  }

  // A sound as the film's music, in place of the score.
  function useAsMusic(key) {
    store.edit((doc) => {
      doc.sound.clips = (doc.sound.clips || []).filter((c) => doc.assets[c.asset]?.kind !== 'sound');
      doc.sound.clips.push({ asset: key, at: 0, from: 0, length: doc.duration, volume: 0.8, fadeIn: 0, fadeOut: 2 });
      doc.sound.score = 'none';
    });
    toast('Playing as the film’s music, in place of the score');
  }

  function remove(key) {
    store.edit((doc) => {
      const used = JSON.stringify(doc.scenes).includes(`"asset":"${key}"`) || (doc.sound.clips || []).some((c) => c.asset === key);
      if (used) { toast('That file is used in the film. Take it out of the film first.'); return false; }
      delete doc.assets[key];
      return undefined;
    });
  }

  function paint() {
    const { assets, sound } = store.get().project.scene;
    const items = Object.entries(assets).filter(([, a]) => ['video', 'sound', 'image'].includes(a.kind));
    clear(list).append(...(items.length ? items.map(([key, a]) => {
      const music = (sound.clips || []).some((c) => c.asset === key);
      const thumb = a.kind === 'image' ? h('img', { class: 'media-thumb', src: a.data, alt: '' }) : h('span', { class: 'media-thumb icon', html: a.kind === 'video' ? ICONS.film : ICONS.music });
      return h('div', { class: 'media-item' }, thumb,
        h('div', { class: 'media-info' },
          h('span', { class: 'media-name', text: a.name || key, title: a.name || key }),
          h('span', { class: 'media-meta', text: a.kind === 'image' ? `Picture, ${a.width} × ${a.height}` : `${a.kind === 'video' ? 'Video' : 'Sound'}, ${fmtTime(a.duration)}${a.width ? `, ${a.width} × ${a.height}` : ''}${music ? ', the music' : ''}` }),
          h('span', { class: 'media-actions' },
            a.kind === 'sound'
              ? h('button', { type: 'button', class: 'text-btn', text: music ? 'Playing as music' : 'Use as music', disabled: music, onclick: () => useAsMusic(key) })
              : h('button', { type: 'button', class: 'text-btn', text: 'Add to the film', onclick: () => addToFilm(key, a) }),
            h('button', { type: 'button', class: 'text-btn danger', text: 'Remove', onclick: () => remove(key) }))));
    }) : [h('p', { class: 'insp-note', text: 'Nothing imported yet.' })]));
  }

  store.on('project', paint);
  paint();
  return { el, show(on) { el.hidden = !on; } };
}
