// The inspector's Stagger section for a scene: its layers' entrances spread
// one after another in the order chosen (staggerLayers in src/core/scene/edit.js),
// as one step that can be undone.

import { h } from './dom.js';
import { field, pair, section, numberInput, select, textButton } from './fields.js';
import { staggerLayers } from '../core/scene/edit.js';

const ORDERS = [['listed', 'As listed'], ['top', 'Top to bottom'], ['left', 'Left to right'], ['centre', 'From the centre']];

export function staggerSection(S, inScene) {
  let step = 0.12;
  let order = 'listed';
  return section('Stagger',
    pair(
      field('Each enters after', numberInput(step, (v) => { step = v; }, { min: 0, max: 2, step: 0.02, unit: 's' })),
      field('Order', select(order, ORDERS, (v) => { order = v; }))),
    h('div', { class: 'button-row' }, textButton('Stagger the layers', () => inScene(S.id, (T) => { if (!staggerLayers(T.layers, { step, order, end: T.duration })) return false; return undefined; }))),
    h('div', { class: 'field-hint', text: 'Every layer that enters starts a moment after the one before, from where the first starts now.' }));
}
