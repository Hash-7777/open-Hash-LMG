// Form fields for the inspector. Each takes the current value and a function
// to call with a new one; none of them keeps state of its own, so the panel
// can be drawn again from the scene at any moment.

import { h } from './dom.js';
import { toHex } from '../core/util/color.js';

// Short names for the frame shapes, to fit a half-width field.
export const ASPECT_SHORT = { '16:9': '16:9 wide', '9:16': '9:16 tall', '1:1': '1:1 square', '4:5': '4:5 portrait' };

let uid = 0;
const nextId = () => `f${++uid}`;

export function field(label, control, hint) {
  const id = control.id || (control.id = nextId());
  return h('div', { class: 'field' },
    h('label', { class: 'field-label', for: id, text: label }),
    control,
    hint ? h('div', { class: 'field-hint', text: hint }) : null);
}

export function pair(...fields) {
  return h('div', { class: 'field-pair' }, ...fields);
}

export function section(title, ...children) {
  return h('section', { class: 'insp-section' }, title ? h('h3', { class: 'insp-title', text: title }) : null, ...children);
}

export function textInput(value, onChange, { placeholder = '', max = 400 } = {}) {
  const el = h('input', { class: 'input', type: 'text', value: value ?? '', placeholder, maxlength: String(max), spellcheck: 'false' });
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

// Text that updates the picture as it is typed, and joins the history once.
export function textArea(value, { onLive, onCommit, rows = 3, placeholder = '', max = 400 }) {
  const el = h('textarea', { class: 'input textarea', rows: String(rows), placeholder, maxlength: String(max) });
  el.value = value ?? '';
  el.addEventListener('input', () => onLive(el.value));
  el.addEventListener('change', () => onCommit(el.value));
  return el;
}

export function numberInput(value, onChange, { min = -Infinity, max = Infinity, step = 1, unit = '', scale = 1, digits = 2 } = {}) {
  const shown = Number.isFinite(value) ? +(value * scale).toFixed(digits) : '';
  const input = h('input', { class: 'input num', type: 'number', value: String(shown), step: String(step), inputmode: 'decimal' });
  if (Number.isFinite(min)) input.min = String(min * scale);
  if (Number.isFinite(max)) input.max = String(max * scale);
  input.addEventListener('change', () => {
    const n = parseFloat(input.value);
    if (!Number.isFinite(n)) return;
    onChange(Math.min(max, Math.max(min, n / scale)));
  });
  if (!unit) return input;
  const wrap = h('div', { class: 'num-wrap' }, input, h('span', { class: 'unit', text: unit }));
  wrap.id = input.id = nextId();
  return wrap;
}

export function select(value, options, onChange) {
  const el = h('select', { class: 'input select' });
  for (const o of options) {
    const [v, label] = Array.isArray(o) ? o : [o, o];
    const opt = h('option', { value: v, text: label });
    if (v === value) opt.selected = true;
    el.append(opt);
  }
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

export function toggle(value, onChange, label) {
  const input = h('input', { type: 'checkbox', class: 'switch-input' });
  input.checked = Boolean(value);
  input.addEventListener('change', () => onChange(input.checked));
  const el = h('label', { class: 'switch' }, input, h('span', { class: 'switch-track', 'aria-hidden': 'true' }), label ? h('span', { class: 'switch-label', text: label }) : null);
  return el;
}

export function segmented(value, options, onChange) {
  const el = h('div', { class: 'segmented', role: 'radiogroup' });
  for (const [v, label] of options) {
    const b = h('button', { type: 'button', class: v === value ? 'on' : '', role: 'radio', 'aria-checked': String(v === value), text: label });
    b.addEventListener('click', () => onChange(v));
    el.append(b);
  }
  return el;
}

const TOKEN_LABELS = { ink: 'Ink', muted: 'Muted', accent: 'Accent', accent2: 'Second accent', surface: 'Surface', bg: 'Background' };

// A colour from the film's palette, or one of its own.
export function colourInput(value, palette, onChange, { allowNone = false } = {}) {
  const isToken = value && TOKEN_LABELS[value];
  const resolved = value === null ? null : isToken ? palette[value] : value;
  const swatch = h('span', { class: `swatch${resolved ? '' : ' none'}` });
  if (resolved) swatch.style.background = resolved;
  const options = [
    ...(allowNone ? [['none', 'None']] : []),
    ...Object.entries(TOKEN_LABELS),
    ['custom', 'Custom colour'],
  ];
  const sel = select(value === null ? 'none' : isToken ? value : 'custom', options, (v) => {
    if (v === 'none') onChange(null);
    else if (v === 'custom') picker.click();
    else onChange(v);
  });
  const picker = h('input', { type: 'color', class: 'colour-picker', value: toHex(resolved || '#ffffff') || '#ffffff', 'aria-label': 'Choose a colour' });
  picker.addEventListener('change', () => onChange(picker.value));
  const wrap = h('div', { class: 'colour-input' }, swatch, sel, picker);
  wrap.id = sel.id = nextId();
  return wrap;
}

export function listInput(values, onChange, { numbers = false, placeholder = '' } = {}) {
  const el = h('input', { class: 'input', type: 'text', value: values.join(', '), placeholder, spellcheck: 'false' });
  el.addEventListener('change', () => {
    const parts = el.value.split(',').map((s) => s.trim()).filter(Boolean);
    onChange(numbers ? parts.map(Number).filter(Number.isFinite) : parts);
  });
  return el;
}

export function buttonRow(...buttons) {
  return h('div', { class: 'button-row' }, ...buttons);
}

export function textButton(label, onClick, cls = '') {
  return h('button', { class: `text-btn ${cls.replace('disabled', '')}`.trim(), type: 'button', text: label, onclick: onClick, disabled: cls.includes('disabled') });
}
