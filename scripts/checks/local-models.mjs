// A model on this computer through Ollama: each question is given room to
// read all of itself, a model's thinking never reaches the storyboard, its
// speed and where it ran are read from Ollama's own answers, how long it
// stays loaded reaches Ollama, and a model that does not fit on the graphics
// chip fails with a sentence that says how to go back.

import assert from 'node:assert/strict';
import { section, claim, done } from './lib/check.mjs';
import { windowFor, requestTokens, answerTokens, readShow, stripThinking, speedOf, fitOf, fitSentence, KEEP_VALUES, WINDOW_STEPS } from '../../src/core/providers/local.js';
import { ask } from '../../src/core/providers/client.js';
import { buildRequest } from '../../src/core/providers/request.js';
import { normalizeSettings } from '../../src/platform/settings.js';

section('Room to read');
await claim('a short question gets the smallest window', () => assert.deepEqual(windowFor(1200), { numCtx: 4096, fits: true }));
await claim('a long one gets the step that holds it', () => assert.equal(windowFor(12000).numCtx, 16384));
await claim('never past what the model supports', () => assert.deepEqual(windowFor(12000, { modelMax: 8192 }), { numCtx: 8192, fits: false }));
await claim('the window the model is loaded with is kept when the question fits it', () => assert.equal(windowFor(3000, { previous: 8192 }).numCtx, 8192));
await claim('the steps stay at a ceiling that keeps memory in check', () => assert.equal(windowFor(10 ** 6).fits, false));
await claim('a question is counted with its instructions, messages and pictures', () => {
  const n = requestTokens({ system: 'x'.repeat(3200), messages: [{ content: 'y'.repeat(320), images: ['a'] }] });
  assert.ok(n >= 1000 + 100 + 800);
});
await claim('a storyboard asks for far less room than drawing code', () => assert.ok(answerTokens('storyboard') < answerTokens('code')));
await claim('the window is sent to Ollama', () => {
  const { init } = buildRequest({ provider: 'ollama', model: 'm', messages: [], numCtx: 8192, keepAlive: '10m' });
  const body = JSON.parse(init.body);
  assert.equal(body.options.num_ctx, 8192); assert.equal(body.keep_alive, '10m');
});
await claim('Ollama’s own keep time is left alone when none is chosen', () => {
  const { init } = buildRequest({ provider: 'ollama', model: 'm', messages: [] });
  assert.ok(!('keep_alive' in JSON.parse(init.body)));
});
await claim('keep times never include "for good" or "at once"', () => assert.ok(!KEEP_VALUES.includes('-1') && !KEEP_VALUES.includes('0')));
await claim('a keep time survives settings, an odd one does not', () => {
  assert.equal(normalizeSettings({ local: { keep: '30m' } }).local.keep, '30m');
  assert.equal(normalizeSettings({ local: { keep: '-1' } }).local.keep, '');
});

section('What a model can do');
await claim('its window and what it can do are read from Ollama', () => {
  assert.deepEqual(readShow({ model_info: { 'qwen2.context_length': 32768 }, capabilities: ['completion', 'vision', 'thinking'] }), { context: 32768, vision: true, thinking: true });
  assert.deepEqual(readShow({}), { context: null, vision: false, thinking: false });
});

section('Thinking stays out of the answer');
await claim('between think tags', () => assert.equal(stripThinking('<think>hmm\nmaybe</think>\n{"a":1}'), '{"a":1}'));
await claim('an unfinished think tag', () => assert.equal(stripThinking('{"a":1}<think>and then'), '{"a":1}'));
await claim('through the client', async () => {
  const stream = new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"message":{"content":"<think>plan</think>{\\"title\\":\\"x\\"}"},"done":true,"eval_count":40,"eval_duration":2000000000}\n')); c.close(); } }));
  let stats = null;
  const text = await ask({ provider: 'ollama', model: 'm', messages: [] }, { fetch: async () => stream, onStats: (s) => { stats = s; } });
  assert.equal(text, '{"title":"x"}'); assert.equal(Math.round(stats.speed), 20);
});

section('Speed and where it ran');
await claim('tokens a second from Ollama’s counts', () => assert.equal(speedOf({ eval_count: 100, eval_duration: 4e9 }), 25));
await claim('too few tokens say nothing', () => assert.equal(speedOf({ eval_count: 5, eval_duration: 1e9 }), null));
await claim('the share on the graphics chip', () => assert.equal(fitOf({ models: [{ name: 'q:7b', size: 100, size_vram: 60 }] }, 'q:7b').share, 0.6));
await claim('a model that is not loaded has no fit', () => assert.equal(fitOf({ models: [] }, 'q:7b'), null));
await claim('all on the chip, all on the processor, and a spill read differently', () => {
  assert.match(fitSentence({ share: 1 }), /entirely on the graphics chip/);
  assert.match(fitSentence({ share: 0 }), /on the processor/);
  assert.match(fitSentence({ share: 0.6 }, 12), /About 40% .* processor.*12 tokens a second/);
});

section('A model that does not fit on the graphics chip');
await claim('says how to go back to Automatic', async () => {
  await assert.rejects(ask({ provider: 'ollama', model: 'm', device: 'gpu', messages: [] }, { fetch: async () => new Response('{"error":"model requires more system memory than is available"}', { status: 500 }) }), /choose Automatic/);
});
await claim('is not told that when it was not asked to', async () => {
  await assert.rejects(ask({ provider: 'ollama', model: 'm', device: 'auto', messages: [] }, { fetch: async () => new Response('{"error":"model requires more system memory"}', { status: 500 }) }), (e) => !/choose Automatic/.test(e.message));
});
await claim('the window steps are in order', () => assert.deepEqual([...WINDOW_STEPS].sort((a, b) => a - b), WINDOW_STEPS));
done();
