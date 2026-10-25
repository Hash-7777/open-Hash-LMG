// A record of one run of the director, for finding out afterwards what
// happened: the settings it ran with (never a key), every step with its time,
// every question put to the model with its answer and how long it took, what
// the checks found and fixed, and how it ended. It can be written out as
// Markdown, complete enough to debug a run from.
//
// Pure: the page keeps records (src/platform/runs.js) and fills them in as the
// director reports; nothing here touches the page or the network.

const now = () => Date.now();

// A picture sent to a model is recorded as a note of its size, not its bytes.
function messageText(m) {
  const pics = m.images?.length ? `\n[${m.images.length} picture${m.images.length === 1 ? '' : 's'} attached, ${Math.round(m.images.reduce((n, u) => n + u.length, 0) / 1024)} KB]` : '';
  return `${m.content || ''}${pics}`;
}

// meta: { kind: 'make' | 'change', brief, instruction, model: { provider, model, label },
//         tier, settings (film and model options, no keys), app, system }
export function createRunRecord(meta) {
  const run = {
    id: `run-${now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    started: now(),
    ended: 0,
    outcome: 'running',
    ...meta,
    steps: [],
    requests: [],
    notes: [],
    result: null,
    error: null,
  };
  return {
    run,
    step(id, title, status, detail) {
      if (status === 'run') run.steps.push({ id, title, started: now(), ended: 0, status: 'run' });
      else {
        const s = run.steps.findLast((x) => x.id === id && x.status === 'run');
        if (s) { s.status = status; s.ended = now(); if (detail) s.detail = detail; }
      }
    },
    note(text) { run.notes.push({ at: now(), text }); },
    // One question to the model: begin returns the request to finish later.
    ask({ purpose, system, messages, options }) {
      const r = { purpose, started: now(), ended: 0, options: options || {}, system: system || '', messages: (messages || []).map((m) => ({ role: m.role, text: messageText(m) })), answer: '', thinkingChars: 0, error: null };
      run.requests.push(r);
      return {
        thinking(chunk) { r.thinkingChars += String(chunk || '').length; },
        // What the service said the request used, in tokens.
        usage(u) { if (u) r.usage = { input: u.input || 0, output: u.output || 0, cacheRead: u.cacheRead || 0, cacheWrite: u.cacheWrite || 0 }; },
        done(answer) { r.answer = String(answer || ''); r.ended = now(); },
        fail(err) { r.error = String(err?.message || err); r.ended = now(); },
      };
    },
    finish(outcome, { result = null, error = null } = {}) {
      run.ended = now();
      run.outcome = outcome;
      run.result = result;
      if (error) run.error = { message: String(error.message || error), stack: String(error.stack || '') };
      for (const s of run.steps) if (s.status === 'run') { s.status = outcome === 'done' ? 'done' : 'stopped'; s.ended = run.ended; }
    },
  };
}

// ---- Markdown ---------------------------------------------------------------------

const secs = (a, b) => (b && a ? `${((b - a) / 1000).toFixed(1)} s` : 'unfinished');
const when = (ms) => new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
// A fence longer than any run of backticks in the text, so the text cannot close it.
function fenced(text, lang = '') {
  const s = String(text ?? '');
  const longest = Math.max(2, ...[...s.matchAll(/`+/g)].map((m) => m[0].length));
  const f = '`'.repeat(longest + 1);
  return `${f}${lang}\n${s}\n${f}`;
}

// The tokens a run used, summed over its requests that reported them.
export function runUsage(run) {
  const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0 };
  for (const r of run.requests || []) {
    if (!r.usage) continue;
    total.requests++;
    for (const k of ['input', 'output', 'cacheRead', 'cacheWrite']) total[k] += r.usage[k] || 0;
  }
  return total;
}

const usageText = (u) => `${u.input.toLocaleString('en-US')} read${u.cacheRead ? `, ${u.cacheRead.toLocaleString('en-US')} read from the service's cache` : ''}, ${u.output.toLocaleString('en-US')} written`;

export function runToMarkdown(run) {
  const L = [];
  const title = run.kind === 'change' ? 'Change' : 'Film';
  L.push(`# Hash LMG run: ${title}, ${run.outcome}`);
  L.push('');
  L.push(`- Started: ${when(run.started)}`);
  L.push(`- Took: ${secs(run.started, run.ended)}`);
  L.push(`- Outcome: ${run.outcome}`);
  if (run.model) L.push(`- Model: ${run.model.model || '(none)'} on ${run.model.label || run.model.provider}`);
  if (run.tier) L.push(`- Way of working: ${run.tier}`);
  if (run.app) L.push(`- App: ${run.app}`);
  if (run.system) L.push(`- System: ${run.system}`);
  const used = runUsage(run);
  if (used.requests) L.push(`- Tokens: ${usageText(used)}${used.requests < run.requests.length ? ` (${used.requests} of ${run.requests.length} requests reported)` : ''}`);
  L.push('');
  L.push('## Brief');
  L.push('');
  L.push(fenced(run.brief || '(empty)'));
  if (run.instruction) { L.push(''); L.push('## Change asked for'); L.push(''); L.push(fenced(run.instruction)); }
  if (run.settings) { L.push(''); L.push('## Settings'); L.push(''); L.push(fenced(JSON.stringify(run.settings, null, 2), 'json')); }
  L.push('');
  L.push('## Steps');
  L.push('');
  L.push('| # | Step | Status | Took |');
  L.push('|---|---|---|---|');
  run.steps.forEach((s, i) => L.push(`| ${i + 1} | ${s.title || s.id} | ${s.status} | ${secs(s.started, s.ended)} |`));
  for (const s of run.steps.filter((x) => x.detail)) { L.push(''); L.push(`Step "${s.title || s.id}" said: ${s.detail}`); }
  L.push('');
  L.push(`## Model requests (${run.requests.length})`);
  run.requests.forEach((r, i) => {
    L.push('');
    L.push(`### ${i + 1}. ${r.purpose || 'request'}, ${secs(r.started, r.ended)}${r.error ? ', failed' : ''}`);
    L.push('');
    if (Object.keys(r.options || {}).length) L.push(`Options: \`${JSON.stringify(r.options)}\``);
    if (r.thinkingChars) L.push(`Thinking: ${r.thinkingChars.toLocaleString()} characters (not recorded)`);
    if (r.usage) L.push(`Tokens: ${usageText(r.usage)}`);
    L.push('');
    L.push('System:');
    L.push('');
    L.push(fenced(r.system));
    for (const m of r.messages) { L.push(''); L.push(`${m.role === 'assistant' ? 'Assistant' : 'User'}:`); L.push(''); L.push(fenced(m.text)); }
    L.push('');
    if (r.error) { L.push(`Error: ${r.error}`); L.push(''); }
    L.push('Answer:');
    L.push('');
    L.push(fenced(r.answer || '(none)'));
  });
  if (run.notes.length) {
    L.push('');
    L.push('## Notes');
    L.push('');
    for (const n of run.notes) L.push(`- ${secs(run.started, n.at)}: ${n.text}`);
  }
  if (run.result) { L.push(''); L.push('## Result'); L.push(''); L.push(fenced(JSON.stringify(run.result, null, 2), 'json')); }
  if (run.error) { L.push(''); L.push('## Error'); L.push(''); L.push(fenced(`${run.error.message}\n\n${run.error.stack}`)); }
  L.push('');
  return L.join('\n');
}

export function runsToMarkdown(runs) {
  return [`# Hash LMG run history (${runs.length} run${runs.length === 1 ? '' : 's'})`, '', ...runs.map((r) => runToMarkdown(r).replace(/^# /, '## ').replace(/\n## /g, '\n### ').replace(/\n### (\d+\.)/g, '\n#### $1'))].join('\n');
}
