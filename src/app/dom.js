// Small helpers for building the editor's DOM.
//
// Elements are made with h() and styled through classes; anything that has to
// change per frame (a block's place on the timeline, a bar's width) is set on
// el.style from script. Markup never carries a style attribute: the desktop
// app's content policy refuses inline style attributes.

import { ICONS } from './icons.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function $(sel, root = document) { return root.querySelector(sel); }

// A button with a drawn icon and a label that screen readers and tooltips read.
export function iconButton(icon, label, onClick, cls = '') {
  return h('button', { class: `icon-btn ${cls}`.trim(), type: 'button', title: label, 'aria-label': label, html: icon, onclick: onClick });
}

// "1:05.20" for 65.2 seconds.
export function timecode(t, fps = 60) {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const hund = Math.floor((s % 1) * 100);
  return `${m}:${String(sec).padStart(2, '0')}.${String(hund).padStart(2, '0')}`;
}

// Calls fn at most once per animation frame, with the latest arguments.
export function perFrame(fn) {
  let queued = false, args = [];
  return (...a) => {
    args = a;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fn(...args); });
  };
}

export function debounce(fn, ms) {
  let timer = null;
  const d = (...a) => { clearTimeout(timer); timer = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(timer); fn(...a); };
  return d;
}

// Drags with the pointer: onMove(dx, dy, event) while held, onEnd() on release.
export function drag(e, { onMove, onEnd }) {
  const x0 = e.clientX, y0 = e.clientY;
  const target = e.currentTarget;
  try { target.setPointerCapture(e.pointerId); } catch { /* capture is an optimisation */ }
  const move = (ev) => onMove(ev.clientX - x0, ev.clientY - y0, ev);
  const up = (ev) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    try { target.releasePointerCapture(e.pointerId); } catch { /* same */ }
    if (onEnd) onEnd(ev);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

// A modal dialog over the editor. Returns { el, body, close }.
export function dialog({ title, wide = false, onClose }) {
  const body = h('div', { class: 'dialog-body' });
  const closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', title: 'Close', html: ICONS.cross });
  const box = h('div', { class: `dialog${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'dialog-head' }, h('h2', { text: title }), closeBtn),
    body);
  const scrim = h('div', { class: 'scrim' }, box);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    window.removeEventListener('keydown', onKey, true);
    scrim.remove();
    if (onClose) onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  closeBtn.addEventListener('click', close);
  scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim) close(); });
  window.addEventListener('keydown', onKey, true);
  document.body.appendChild(scrim);
  return { el: box, body, close, closeBtn };
}

// A short message at the bottom of the window that leaves by itself.
export function toast(message, kind = 'info') {
  let host = document.querySelector('.toasts');
  if (!host) { host = h('div', { class: 'toasts', 'aria-live': 'polite' }); document.body.appendChild(host); }
  const t = h('div', { class: `toast ${kind}`, text: message });
  host.appendChild(t);
  setTimeout(() => t.classList.add('leaving'), kind === 'error' ? 6000 : 3200);
  setTimeout(() => t.remove(), kind === 'error' ? 6400 : 3600);
}
