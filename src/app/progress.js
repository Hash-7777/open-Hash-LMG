// The progress of a film being made, as a thin bar under the top bar and the
// current step named beside the film's title.
//
// A film is made in steps of very different lengths (the model writing takes
// most of the time), so each step is given a share of the bar by weight, and
// while the model writes, its part fills by how much of a typical answer has
// arrived. A step that comes round again (a second check, a revision) moves
// the bar part of the way that is left, so it never goes backwards and never
// claims to be done before it is.

import { h } from './dom.js';

export function createProgress() {
  const fill = h('div', { class: 'hp-fill' });
  const bar = h('div', { class: 'header-progress', role: 'progressbar', 'aria-label': 'Making the film', 'aria-valuemin': '0', 'aria-valuemax': '100', hidden: true }, fill);
  const label = h('div', { class: 'header-status', 'aria-live': 'polite', hidden: true });

  let plan = [];
  let seen = new Set();
  let part = null; // { base, span } of the step under way
  let frac = 0;
  let hideTimer = 0;

  function set(f) {
    frac = Math.max(frac, Math.min(1, f));
    fill.style.transform = `scaleX(${frac.toFixed(4)})`;
    bar.setAttribute('aria-valuenow', String(Math.round(frac * 100)));
  }

  return {
    bar,
    label,
    // steps: [{ id, weight }]; weights need not add up to one.
    start(steps, text) {
      clearTimeout(hideTimer);
      label.title = '';
      label.classList.remove('has-details');
      const total = steps.reduce((n, s) => n + s.weight, 0) || 1;
      let at = 0;
      plan = steps.map((s) => { const p = { id: s.id, base: at / total, span: s.weight / total }; at += s.weight; return p; });
      seen = new Set();
      part = null;
      frac = 0;
      fill.style.transform = 'scaleX(0)';
      bar.classList.remove('done', 'fail');
      bar.hidden = false;
      label.hidden = false;
      label.textContent = text || '';
    },
    step(id, title) {
      const p = plan.find((x) => x.id === id);
      part = p && !seen.has(id) && p.base >= frac - 1e-6 ? { base: p.base, span: p.span } : { base: frac, span: (1 - frac) * 0.35 };
      seen.add(id);
      set(part.base);
      if (title) label.textContent = title;
    },
    // How far through the step under way, 0 to 1.
    within(f, text) {
      if (part) set(part.base + part.span * Math.max(0, Math.min(0.95, f)));
      if (text) label.textContent = text;
    },
    say(text) { label.textContent = text; },
    // What is worth knowing about the result, shown when the pointer rests on
    // the last message.
    details(list) {
      label.title = list.join('\n');
      label.classList.toggle('has-details', list.length > 0);
    },
    finish(text, ok = true) {
      set(1);
      bar.classList.add(ok ? 'done' : 'fail');
      label.textContent = text;
      clearTimeout(hideTimer);
      // The message stays while it has something to say; the bar leaves.
      hideTimer = setTimeout(() => { bar.hidden = true; if (!label.title) label.hidden = true; }, ok ? 2600 : 7000);
    },
  };
}
