// The making of a film, step by step: a chip in the top bar with the step
// under way and the time so far, a segmented bar under the top bar, and a
// panel, opened from the chip, that lists every step of the way of working
// chosen, how long each took, what the model is doing now, and the last lines
// it has written as they arrive.
//
// A film is made in steps of very different lengths (the model writing takes
// most of the time), so each step is given a share of the bar by weight, and
// while the model writes, its part fills by how much of a typical answer has
// arrived. A step that comes round again (a second check, a revision) is
// listed again and moves the bar part of the way that is left, so it never
// goes backwards and never claims to be done before it is.
//
// Nothing here runs on its own clock while it is idle: the elapsed time is
// counted by a one-second timer that exists only while a film is being made.

import { h, clear } from './dom.js';
import { ICONS } from './icons.js';

// What each step is called before it starts.
const NAMES = {
  story: 'Write the storyboard', pictures: 'Draw the pictures', intent: 'List what the brief asks to see', layout: 'Direct, lay out and time it',
  design: 'Design every scene', check: 'Check stills and timing', revise: 'Fix what the checks found',
  verify: 'Check the film against the brief', review: 'Review the stills', edit: 'Make the change', voice: 'Speak the narration',
};
const PREVIEW_LINES = 4;

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function createProgress() {
  const track = h('div', { class: 'run-track' });
  const bar = h('div', { class: 'header-progress', role: 'progressbar', 'aria-label': 'Making the film', 'aria-valuemin': '0', 'aria-valuemax': '100', hidden: true }, track);

  const mark = h('span', { class: 'run-mark' });
  const count = h('span', { class: 'run-count' });
  const title = h('span', { class: 'run-title' });
  const time = h('span', { class: 'run-time' });
  const chip = h('button', { type: 'button', class: 'run-chip', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', title: 'Show every step' }, mark, count, title, time);
  const head = h('div', { class: 'run-head' });
  const list = h('ol', { class: 'run-steps' });
  const peek = h('pre', { class: 'run-peek', hidden: true });
  const notesEl = h('ul', { class: 'run-notes', hidden: true });
  const panel = h('div', { class: 'run-panel', role: 'dialog', 'aria-label': 'Steps of the film', hidden: true }, head, list, peek, notesEl);
  const label = h('div', { class: 'header-status', 'aria-live': 'polite', hidden: true }, chip, panel);

  let plan = [];      // [{ id, base, span }] by weight
  let rows = [];      // [{ id, name, state, started, ended, detail }]
  let pending = [];   // planned ids not yet started
  let part = null;
  let frac = 0;
  let started = 0;
  let ended = 0;
  let tick = 0;
  let hideTimer = 0;
  let model = '';
  let state = 'idle'; // idle | run | done | fail

  function set(f) {
    frac = Math.max(frac, Math.min(1, f));
    bar.setAttribute('aria-valuenow', String(Math.round(frac * 100)));
    // One segment a planned step, each filled as far as the bar has come.
    plan.forEach((p, i) => {
      const fill = track.children[i]?.firstChild;
      if (fill) fill.style.transform = `scaleX(${Math.max(0, Math.min(1, (frac - p.base) / p.span)).toFixed(4)})`;
    });
  }

  const since = (from, to) => clock(((to || Date.now()) - from) / 1000);

  function paintChip() {
    const total = rows.length + pending.length;
    const at = rows.length;
    clear(mark).append(h('span', { html: state === 'done' ? ICONS.check : state === 'fail' ? ICONS.cross : '' }));
    mark.className = `run-mark ${state}`;
    count.textContent = state === 'run' && total ? `${Math.max(1, at)} of ${total}` : '';
    count.hidden = !count.textContent;
    time.textContent = started ? since(started, ended) : '';
  }

  function paintPanel() {
    if (panel.hidden) return;
    clear(head).append(
      h('div', { class: 'run-head-title', text: state === 'run' ? 'Making the film' : state === 'fail' ? 'The film was not finished' : 'How the film was made' }),
      h('div', { class: 'run-head-meta', text: [model, started ? since(started, ended) : ''].filter(Boolean).join('  ·  ') }));
    const all = [...rows, ...pending.map((id) => ({ id, name: NAMES[id] || id, state: 'wait' }))];
    clear(list).append(...all.map((r) => h('li', { class: `run-step ${r.state}` },
      h('span', { class: 'run-step-mark', html: r.state === 'done' ? ICONS.check : r.state === 'fail' ? ICONS.cross : '' }),
      h('span', { class: 'run-step-body' },
        h('span', { class: 'run-step-name', text: r.name }),
        r.detail && r.state === 'run' ? h('span', { class: 'run-step-detail', text: r.detail }) : null),
      h('span', { class: 'run-step-time', text: r.started ? since(r.started, r.ended) : '' }))));
  }

  const current = () => rows.findLast((r) => r.state === 'run');
  const closeRunning = (to) => { for (const r of rows) if (r.state === 'run') { r.state = to; r.ended = Date.now(); } };

  function close() {
    panel.hidden = true;
    chip.setAttribute('aria-expanded', 'false');
  }
  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
    chip.setAttribute('aria-expanded', String(!panel.hidden));
    paintPanel();
  });
  document.addEventListener('pointerdown', (e) => { if (!panel.hidden && !label.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) close(); });

  return {
    bar,
    label,
    // steps: [{ id, weight }]; weights need not add up to one. who: the model, as shown.
    start(steps, text, who = '') {
      clearTimeout(hideTimer);
      const total = steps.reduce((n, s) => n + s.weight, 0) || 1;
      let at = 0;
      plan = steps.map((s) => { const p = { id: s.id, base: at / total, span: s.weight / total }; at += s.weight; return p; });
      clear(track).append(...plan.map((p) => {
        const seg = h('span', { class: 'run-seg' }, h('span', { class: 'run-seg-fill' }));
        seg.style.flexGrow = p.span.toFixed(4);
        return seg;
      }));
      rows = [];
      pending = steps.map((s) => s.id);
      part = null;
      frac = 0;
      model = who;
      state = 'run';
      started = Date.now();
      ended = 0;
      peek.hidden = true;
      peek.textContent = '';
      this.details([]);
      bar.classList.remove('done', 'fail');
      bar.hidden = false;
      label.hidden = false;
      title.textContent = text || '';
      set(0);
      clearInterval(tick);
      tick = setInterval(() => { paintChip(); paintPanel(); }, 1000);
      paintChip();
      paintPanel();
    },
    step(id, name) {
      const p = plan.find((x) => x.id === id);
      const first = !rows.some((r) => r.id === id);
      part = p && first && p.base >= frac - 1e-6 ? { base: p.base, span: p.span } : { base: frac, span: (1 - frac) * 0.35 };
      closeRunning('done');
      const k = pending.indexOf(id);
      if (k >= 0) pending.splice(k, 1);
      rows.push({ id, name: name || NAMES[id] || id, state: 'run', started: Date.now(), ended: 0, detail: '' });
      peek.hidden = true;
      peek.textContent = '';
      set(part.base);
      if (name) title.textContent = name;
      paintChip();
      paintPanel();
    },
    // A step the director reports finished.
    stepDone(id, ok = true) {
      const r = rows.findLast((x) => x.id === id && x.state === 'run');
      if (r) { r.state = ok ? 'done' : 'fail'; r.ended = Date.now(); }
      paintPanel();
    },
    // How far through the step under way, 0 to 1, and what is happening in it.
    within(f, text) {
      if (part) set(part.base + part.span * Math.max(0, Math.min(0.95, f)));
      if (text) this.say(text);
    },
    // The model's answer so far: its last few lines are shown in the panel.
    writing(all) {
      const lines = String(all || '').replace(/\s+$/, '').split('\n').slice(-PREVIEW_LINES).map((l) => (l.length > 140 ? `${l.slice(0, 140)}...` : l));
      peek.textContent = lines.join('\n');
      peek.hidden = !peek.textContent;
    },
    say(text) {
      title.textContent = text;
      const r = current();
      if (r && r.detail !== text) { r.detail = text; paintPanel(); }
    },
    // What is worth knowing about the result, listed in the panel.
    details(items) {
      clear(notesEl).append(...items.map((t) => h('li', { text: t })));
      notesEl.hidden = items.length === 0;
      chip.classList.toggle('has-details', items.length > 0);
    },
    finish(text, ok = true) {
      closeRunning(ok ? 'done' : 'fail');
      pending = [];
      state = ok ? 'done' : 'fail';
      ended = Date.now();
      clearInterval(tick);
      tick = 0;
      set(1);
      bar.classList.add(ok ? 'done' : 'fail');
      title.textContent = text;
      peek.hidden = true;
      paintChip();
      paintPanel();
      clearTimeout(hideTimer);
      // The chip stays, so the steps and notes can be read again; the bar leaves.
      hideTimer = setTimeout(() => { bar.hidden = true; }, ok ? 2600 : 7000);
    },
  };
}
