// The inspector's Repeat section: one layer drawn many times by a rule
// (src/core/engine/repeat.js).

import { h } from './dom.js';
import { field, pair, section, numberInput, select } from './fields.js';
import { REPEAT_LAYOUTS } from '../core/engine/repeat.js';

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function repeatSection(L, set) {
  const r = L.repeat || { count: 1, layout: 'row', cols: 4, gap: 60, radius: 200, stagger: 0.04 };
  const setR = (patch) => set((M) => { M.repeat = { ...r, ...patch }; });
  return section('Repeat',
    pair(
      field('Copies', numberInput(r.count, (v) => setR({ count: Math.round(v) }), { min: 1, max: 200, digits: 0 })),
      field('Layout', select(r.layout, REPEAT_LAYOUTS.map((k) => [k, cap(k)]), (v) => setR({ layout: v })))),
    r.count > 1 ? pair(
      r.layout === 'circle'
        ? field('Radius', numberInput(r.radius, (v) => setR({ radius: v }), { min: 0, max: 2000, step: 10, unit: 'pt', digits: 0 }))
        : field('Spacing', numberInput(r.gap, (v) => setR({ gap: v }), { min: 0, max: 2000, step: 5, unit: 'pt', digits: 0 })),
      field('Each arrives after', numberInput(r.stagger, (v) => setR({ stagger: v }), { min: 0, max: 1, step: 0.01, unit: 's' }))) : null,
    r.count > 1 && r.layout === 'grid' ? field('Columns', numberInput(r.cols, (v) => setR({ cols: Math.round(v) }), { min: 1, max: 50, digits: 0 })) : null,
    h('div', { class: 'field-hint', text: 'One copy is the layer alone. More are laid out by the rule and arrive one after another.' }));
}
