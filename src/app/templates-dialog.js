// The template gallery: films to start from, each shown by a still drawn by
// the engine itself. Choosing one makes the whole film at once, with no model,
// as a new film; the one open now is kept.

import { h, dialog } from './dom.js';
import { TEMPLATES, filmFromTemplate } from '../core/scene/templates.js';
import { ASPECTS } from '../core/scene/format.js';
import { createKit } from '../core/engine/kit.js';
import { renderPlan } from '../core/engine/render-plan.js';

const THUMB_W = 240;

// A still of the film at the moment its name has settled.
function thumbnail(scene) {
  const full = document.createElement('canvas');
  full.width = scene.width;
  full.height = scene.height;
  const kit = createKit(full.getContext('2d', { alpha: false }), {
    width: scene.width, height: scene.height, fps: scene.fps, bpm: scene.bpm, seed: scene.seed, palette: scene.palette, assets: {},
    makeCanvas: (w, h2) => Object.assign(document.createElement('canvas'), { width: w, height: h2 }),
  });
  kit.duration = scene.duration;
  kit.scene = scene;
  const S = scene.scenes.find((x) => x.name === 'title' || x.name === 'logo') || scene.scenes[0];
  renderPlan(kit, scene, S ? S.start + Math.min(S.duration * 0.75, 2.4) : 0);
  const out = document.createElement('canvas');
  out.width = THUMB_W * 2;
  out.height = Math.round((THUMB_W * 2 * scene.height) / scene.width);
  const g = out.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(full, 0, 0, out.width, out.height);
  out.className = 'tpl-thumb';
  return out;
}

export function openTemplatesDialog({ onUse }) {
  const d = dialog({ title: 'Start from a template', wide: true });
  d.el.classList.add('templates');
  const grid = h('div', { class: 'tpl-grid' });
  d.body.append(h('p', { class: 'insp-note', text: 'Each one is a whole film, made at once with no model, in a look matched to it. Change the words in the inspector, or ask for a change on the left.' }), grid);
  for (const tpl of TEMPLATES) {
    const take = Math.floor(Math.random() * 1e6);
    const film = filmFromTemplate(tpl, { take });
    const frame = h('div', { class: 'tpl-frame' }, thumbnail(film.scene));
    const card = h('button', { type: 'button', class: 'tpl-card', onclick: () => { d.close(); onUse(film, tpl); } },
      frame,
      h('span', { class: 'tpl-name', text: tpl.name }),
      h('span', { class: 'tpl-blurb', text: tpl.blurb }),
      h('span', { class: 'tpl-meta', text: `${tpl.seconds} seconds · ${ASPECTS[tpl.aspect].label}` }));
    grid.append(card);
  }
  return d;
}
