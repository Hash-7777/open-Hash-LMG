// The run history's records: every step and question is kept with its time,
// pictures are noted rather than stored, and the Markdown keeps every answer
// whole, even one full of backticks.

import assert from 'node:assert/strict';
import { section, claim, done } from './lib/check.mjs';
import { createRunRecord, runToMarkdown, runsToMarkdown } from '../../src/core/director/run-record.js';

const make = () => {
  const r = createRunRecord({ kind: 'make', brief: 'A launch film for Lumen Desk, an invented lamp.', tier: 'plan', model: { provider: 'ollama', model: 'm', label: 'Ollama' }, settings: { film: { seconds: 30 } } });
  r.step('story', 'Writing the storyboard', 'run');
  const q = r.ask({ purpose: 'storyboard', system: 'You are a motion designer.', messages: [{ role: 'user', content: 'Brief: x', images: ['data:image/jpeg;base64,' + 'A'.repeat(4000)] }], options: { maxTokens: 1500 } });
  q.thinking('hmm'); q.done('```js\nexport default 1\n```');
  r.step('story', 'Writing the storyboard', 'done');
  r.note('Wrote 2 storyboards and kept the cleanest.');
  r.finish('done', { result: { scenes: 6 } });
  return r.run;
};

section('A record');
await claim('steps, questions, notes and the ending are kept', () => {
  const run = make();
  assert.equal(run.outcome, 'done'); assert.equal(run.steps[0].status, 'done'); assert.ok(run.steps[0].ended >= run.steps[0].started);
  assert.equal(run.requests.length, 1); assert.equal(run.requests[0].thinkingChars, 3); assert.equal(run.notes.length, 1);
});
await claim('a picture is noted by size, never stored', () => {
  const text = make().requests[0].messages[0].text;
  assert.match(text, /\[1 picture attached, 4 KB\]/); assert.ok(!text.includes('AAAA'));
});
await claim('a failed question keeps its error', () => {
  const r = createRunRecord({ kind: 'make', brief: 'b' });
  r.ask({ purpose: 'plan', system: '', messages: [] }).fail(new Error('Ollama did not answer.'));
  r.finish('failed', { error: new Error('Ollama did not answer.') });
  assert.equal(r.run.requests[0].error, 'Ollama did not answer.'); assert.equal(r.run.error.message, 'Ollama did not answer.');
});

section('Markdown');
await claim('a run reads as Markdown with every part', () => {
  const md = runToMarkdown(make());
  for (const part of ['# Hash LMG run', '## Brief', '## Settings', '## Steps', '## Model requests (1)', '### 1. storyboard', 'Answer:', '## Notes', '## Result']) assert.ok(md.includes(part), part);
});
await claim('an answer with backticks stays inside its fence', () => {
  const md = runToMarkdown(make());
  assert.ok(md.includes('````\n```js\nexport default 1\n```\n````'));
});
await claim('a history of runs nests each run one level down', () => {
  const md = runsToMarkdown([make(), make()]);
  assert.match(md, /^# Hash LMG run history \(2 runs\)/); assert.equal((md.match(/\n## Hash LMG run/g) || []).length, 2);
});
done();
