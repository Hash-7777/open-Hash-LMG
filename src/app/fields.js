// Form fields for the inspector. Each takes the current value and a function
// to call with a new one; none of them keeps state of its own, so the panel
// can be drawn again from the scene at any moment.
//
// As in a video editor, a number's label can be dragged sideways to change it
// (Shift for bigger steps, Alt for finer ones), sections fold away and are
// remembered folded, and a section can offer to put its values back.

import { h, drag } from './dom.js';
import { toHex } from '../core/util/color.js';

// While a label is dragged the panel must not be drawn again under the
// pointer; the inspector waits for the drag to end (the 'scrub-end' event).
export const scrubbing = { active: false };

// Short names for the frame shapes, to fit a half-width field.
export const ASPECT_SHORT = { '16:9': '16:9 wide', '9:16': '9:16 tall', '1:1': '1:1 square', '4:5': '4:5 portrait' };

let uid = 0;
const nextId = () => `f${++uid}`;

export function field(label, control, hint) {
  // A control made of several parts names the one its label belongs to.
  const id = control.labelFor || control.id || (control.id = nextId());
  const lab = h('label', { class: 'field-label', for: id, text: label });
  if (control.scrub) scrubbable(lab, control.scrub);
  return h('div', { class: 'field' },
    lab,
    control,
    hint ? h('div', { class: 'field-hint', text: hint }) : null);
}

// A label that changes its number when dragged sideways: one step for every
// few points, ten with Shift, a tenth with Alt.
function scrubbable(lab, sc) {
  lab.classList.add('scrub');
  lab.title = 'Drag sideways to change';
  lab.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const from = sc.get();
    let last = from, moved = false;
    scrubbing.active = true;
    document.body.classList.add('scrubbing');
    drag(e, {
      onMove: (dx, dy, ev) => {
        if (!moved && Math.abs(dx) < 3) return;
        moved = true;
        const k = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
        last = sc.preview(from + Math.round(dx / 4) * sc.step * k);
      },
      onEnd: () => {
        scrubbing.active = false;
        document.body.classList.remove('scrubbing');
        if (moved && last !== from) sc.commit(last);
        lab.dispatchEvent(new CustomEvent('scrub-end', { bubbles: true }));
      },
    });
  });
}

export function pair(...fields) {
  return h('div', { class: 'field-pair' }, ...fields);
}

// Sections folded away by the person, by title, remembered on this computer.
const FOLD_KEY = 'lmg.inspector.folded';
const folded = (() => { try { return new Set(JSON.parse(localStorage.getItem(FOLD_KEY) || '[]')); } catch { return new Set(); } })();
const saveFolds = () => { try { localStorage.setItem(FOLD_KEY, JSON.stringify([...folded])); } catch { /* folding still works for this visit */ } };

// A titled section folds away from its heading. Its first child may be
// { reset } to offer to put its values back to the usual ones, or
// { open: false } to start folded.
export function section(title, ...children) {
  const opts = children[0] && Object.getPrototypeOf(children[0]) === Object.prototype ? children.shift() : {};
  if (!title) return h('section', { class: 'insp-section' }, ...children);
  const key = opts.key || title;
  const isFolded = () => (folded.has(key) ? true : folded.has(`+${key}`) ? false : opts.open === false);
  const body = h('div', { class: 'insp-section-body' }, ...children);
  const head = h('button', { type: 'button', class: 'insp-head', 'aria-expanded': String(!isFolded()) },
    h('span', { class: 'insp-chevron', 'aria-hidden': 'true', html: CHEVRON }),
    h('h3', { class: 'insp-title', text: title }));
  const el = h('section', { class: `insp-section foldable${isFolded() ? ' folded' : ''}` },
    h('div', { class: 'insp-head-row' }, head, opts.reset ? h('button', { type: 'button', class: 'insp-reset', text: 'Reset', title: `Put ${title.toLowerCase()} back to the usual values`, onclick: opts.reset }) : null),
    body);
  head.addEventListener('click', () => {
    const now = !el.classList.contains('folded');
    el.classList.toggle('folded', now);
    head.setAttribute('aria-expanded', String(!now));
    folded.delete(key); folded.delete(`+${key}`);
    if (now !== (opts.open === false)) folded.add(now ? key : `+${key}`);
    saveFolds();
  });
  return el;
}
const CHEVRON = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 6.2 8 9.8l3.5-3.6"/></svg>';

// Tabs across the top of a panel: [[value, label], ...].
export function tabs(options, value, onPick) {
  const el = h('div', { class: 'insp-tabs', role: 'tablist' });
  for (const [v, label] of options) {
    el.append(h('button', { type: 'button', role: 'tab', class: `insp-tab${v === value ? ' on' : ''}`, 'aria-selected': String(v === value), text: label, onclick: () => onPick(v) }));
  }
  return el;
}

// A row of small buttons drawn as icons: [[iconSvg, label, onClick, on], ...].
export function iconRow(buttons, cls = '') {
  return h('div', { class: `icon-row ${cls}`.trim() }, ...buttons.map(([icon, label, onClick, on]) =>
    h('button', { type: 'button', class: `icon-row-btn${on ? ' on' : ''}`, title: label, 'aria-label': label, 'aria-pressed': on === undefined ? undefined : String(Boolean(on)), html: icon, onclick: onClick })));
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

// A number, shown multiplied by `scale` (a fraction as a percent). onLive,
// when given, follows a drag of its label as it happens; onChange gets the
// value it ends on.
export function numberInput(value, onChange, { min = -Infinity, max = Infinity, step = 1, unit = '', scale = 1, digits = 2, onLive = null } = {}) {
  const shown = Number.isFinite(value) ? +(value * scale).toFixed(digits) : '';
  const input = h('input', { class: 'input num', type: 'number', value: String(shown), step: String(step), inputmode: 'decimal' });
  if (Number.isFinite(min)) input.min = String(min * scale);
  if (Number.isFinite(max)) input.max = String(max * scale);
  const clampTo = (n) => Math.min(max, Math.max(min, n));
  input.addEventListener('change', () => {
    const n = parseFloat(input.value);
    if (!Number.isFinite(n)) return;
    onChange(clampTo(n / scale));
  });
  const out = unit ? h('div', { class: 'num-wrap' }, input, h('span', { class: 'unit', text: unit })) : input;
  if (unit) out.labelFor = input.id = nextId();
  out.scrub = {
    step: step / scale,
    get: () => { const n = parseFloat(input.value); return Number.isFinite(n) ? n / scale : 0; },
    preview: (n) => { const v = clampTo(+n.toFixed(6)); input.value = String(+(v * scale).toFixed(digits)); if (onLive) onLive(v); return v; },
    commit: (v) => onChange(v),
  };
  return out;
}

// A slider with its number beside it, for values with a natural range.
export function rangeInput(value, onChange, { min = 0, max = 1, step = 0.01, scale = 1, unit = '', digits = 0, onLive = null } = {}) {
  const range = h('input', { type: 'range', class: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
  const num = numberInput(value, onChange, { min, max, step: step * scale, unit, scale, digits, onLive });
  const numInput = num.querySelector ? num.querySelector('input') || num : num;
  range.addEventListener('input', () => { numInput.value = String(+(Number(range.value) * scale).toFixed(digits)); if (onLive) onLive(Number(range.value)); });
  range.addEventListener('change', () => onChange(Number(range.value)));
  const wrap = h('div', { class: 'range-wrap' }, range, num);
  wrap.labelFor = range.id = nextId();
  const preview = num.scrub.preview;
  wrap.scrub = { ...num.scrub, preview: (n) => { const v = preview(n); range.value = String(v); return v; } };
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
  wrap.labelFor = sel.id = nextId();
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
