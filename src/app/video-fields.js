// The inspector's Clip section for a video layer: where in the footage it
// starts, how fast it plays, how loud, and how it fills its box.

import { h } from './dom.js';
import { field, pair, section, numberInput, segmented, toggle } from './fields.js';

export function videoSection(L, set, asset) {
  const length = asset?.duration || 0;
  return section('Clip',
    pair(
      field('Starts at', numberInput(L.from, (v) => set((M) => { M.from = v; }), { min: 0, max: Math.max(0, length - 0.05) || 100000, step: 0.1, unit: 's' }), length ? `Of ${length.toFixed(1)} s of footage.` : null),
      field('Speed', numberInput(L.rate, (v) => set((M) => { M.rate = v; }), { min: 0.25, max: 4, step: 5, scale: 100, unit: '%', digits: 0 }))),
    pair(
      field('Volume', numberInput(L.volume, (v) => set((M) => { M.volume = v; }), { min: 0, max: 2, step: 5, scale: 100, unit: '%', digits: 0 })),
      field('Sound', toggle(!L.muted, (v) => set((M) => { M.muted = !v; }), 'Play the clip’s sound'))),
    field('Fit', segmented(L.fit, [['cover', 'Fill the frame'], ['contain', 'Whole picture']], (v) => set((M) => { M.fit = v; }))),
    L.rate !== 1 ? h('div', { class: 'field-hint', text: 'A clip at another speed plays without its sound.' }) : null);
}
