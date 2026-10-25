// Settings, Run history: every film made and change asked for, newest first.
// One opens to its steps, its questions to the model with their answers, and
// how it ended; any one, or all of them, can be saved as Markdown, a full
// record for debugging.

import { h, clear, toast } from './dom.js';
import { section, textButton } from './fields.js';
import { runs } from '../platform/runs.js';
import { runToMarkdown, runsToMarkdown } from '../core/director/run-record.js';
import { saveFile } from '../platform/index.js';

const secs = (a, b) => (a && b ? `${((b - a) / 1000).toFixed(1)} s` : '');
const when = (ms) => new Date(ms).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const OUTCOME = { done: 'Made', stopped: 'Stopped', failed: 'Failed', running: 'Unfinished' };
const bytes = (text) => new TextEncoder().encode(text);

export function createHistoryPane() {
  let open = null; // the id of the run shown in full

  async function save(name, text) {
    try { if (await saveFile(name, bytes(text), 'text/markdown')) toast('Saved'); } catch (err) { toast(err.message || String(err), 'error'); }
  }

  function detail(run, back) {
    const pre = (text) => h('pre', { class: 'run-pre', text: String(text || '') });
    return [section(`${run.kind === 'change' ? 'Change' : 'Film'}, ${OUTCOME[run.outcome] || run.outcome}`,
      h('div', { class: 'button-row' },
        textButton('All runs', back),
        textButton('Save as Markdown', () => save(`hash-lmg-run-${run.id}.md`, runToMarkdown(run)))),
      h('dl', { class: 'run-facts' },
        h('dt', { text: 'Started' }), h('dd', { text: when(run.started) }),
        h('dt', { text: 'Took' }), h('dd', { text: secs(run.started, run.ended) || 'unfinished' }),
        h('dt', { text: 'Model' }), h('dd', { text: `${run.model?.model || 'none'} on ${run.model?.label || run.model?.provider || ''}` }),
        h('dt', { text: 'Way of working' }), h('dd', { text: run.tier || '' })),
      h('div', { class: 'field-label', text: 'Brief' }), pre(run.brief),
      run.instruction ? [h('div', { class: 'field-label', text: 'Change asked for' }), pre(run.instruction)] : null,
      h('div', { class: 'field-label', text: 'Steps' }),
      h('ol', { class: 'run-history-steps' }, ...run.steps.map((s) => h('li', { class: s.status },
        h('span', { text: s.title || s.id }), h('span', { class: 'run-history-time', text: `${s.status}, ${secs(s.started, s.ended)}` })))),
      h('div', { class: 'field-label', text: `Questions to the model (${run.requests.length})` }),
      ...run.requests.map((r, i) => h('details', { class: 'run-request' },
        h('summary', {}, h('span', { text: `${i + 1}. ${r.purpose || 'request'}` }), h('span', { class: 'run-history-time', text: `${r.error ? 'failed, ' : ''}${secs(r.started, r.ended)}` })),
        h('div', { class: 'field-label', text: 'System' }), pre(r.system),
        ...r.messages.map((m) => [h('div', { class: 'field-label', text: m.role === 'assistant' ? 'Assistant' : 'User' }), pre(m.text)]),
        r.error ? [h('div', { class: 'field-label', text: 'Error' }), pre(r.error)] : null,
        h('div', { class: 'field-label', text: 'Answer' }), pre(r.answer || '(none)'))),
      run.notes.length ? [h('div', { class: 'field-label', text: 'Notes' }), h('ul', { class: 'run-notes-list' }, ...run.notes.map((n) => h('li', { text: n.text })))] : null,
      run.error ? [h('div', { class: 'field-label', text: 'Error' }), pre(`${run.error.message}\n\n${run.error.stack}`)] : null)];
  }

  // Fills the section's own element, again whenever a run is opened or closed.
  function fill(wrap) {
    runs.list().then((list) => {
      const run = open && list.find((r) => r.id === open);
      if (run) { clear(wrap).append(...detail(run, () => { open = null; fill(wrap); })); wrap.closest('.settings-pane')?.scrollTo(0, 0); return; }
      clear(wrap).append(section('Run history',
        h('p', { class: 'insp-note', text: `Every film made and change asked for, newest first, with each step and each question to the model and its answer. Kept on this computer, the last ${60} runs; keys are never recorded.` }),
        h('div', { class: 'button-row' },
          textButton('Save all as Markdown', () => save('hash-lmg-run-history.md', runsToMarkdown(list)), list.length ? '' : 'disabled'),
          textButton('Clear the history', async () => { await runs.clear(); fill(wrap); }, list.length ? 'danger' : 'disabled')),
        list.length ? h('ul', { class: 'run-history' }, ...list.map((r) => h('li', {},
          h('button', { type: 'button', class: 'run-history-row', onclick: () => { open = r.id; fill(wrap); } },
            h('span', { class: `run-history-dot ${r.outcome}` }),
            h('span', { class: 'run-history-main' },
              h('span', { class: 'run-history-brief', text: (r.instruction || r.brief || '(no brief)').slice(0, 120) }),
              h('span', { class: 'run-history-meta', text: `${when(r.started)} · ${OUTCOME[r.outcome] || r.outcome} · ${r.model?.model || 'no model'} · ${secs(r.started, r.ended) || 'unfinished'}` })))))) : h('p', { class: 'insp-note', text: 'No runs yet. Each film you make is listed here.' })));
    }).catch((err) => { clear(wrap).append(h('p', { class: 'insp-note', text: err.message || String(err) })); });
  }

  return function paint() {
    const wrap = h('div', {}, h('div', { class: 'insp-note', text: 'Reading the history.' }));
    fill(wrap);
    return [wrap];
  };
}
