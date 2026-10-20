// Talking to model services, played through a stand-in fetch: every request
// shape the app knows streams back into the right text, every failure turns
// into one sentence that says what to do, the processor or graphics-chip
// choice reaches Ollama, and model lists read the way each service sends them.

import assert from 'node:assert/strict';
import { section, claim, done } from './lib/check.mjs';
import { ask, listModels, gpuLayers } from '../../src/core/providers/client.js';
import { modelProfile } from '../../src/core/providers/models.js';

const stream = (chunks) => new Response(new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(new TextEncoder().encode(x)); c.close(); } }));
const q = (provider, extra = {}) => ({ provider, model: 'm', key: 'k', messages: [{ role: 'user', content: 'x' }], ...extra });

section('Answers come back whole, from every request shape');
await claim('Ollama, one JSON object a line', async () => {
  assert.equal(await ask(q('ollama'), { fetch: async () => stream(['{"message":{"content":"Hel"}}\n{"message":{"con', 'tent":"lo"},"done":true}\n']) }), 'Hello');
});
await claim('OpenAI-style events split across chunks', async () => {
  const seen = [];
  const t = await ask(q('openai'), { fetch: async () => stream(['data: {"choices":[{"delta":{"content":"Hel"}}]}\n\nda', 'ta: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n']), onText: (_, all) => seen.push(all) });
  assert.equal(t, 'Hello'); assert.deepEqual(seen, ['Hel', 'Hello']);
});
await claim('Anthropic events', async () => {
  assert.equal(await ask(q('anthropic'), { fetch: async () => stream(['event: x\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\ndata: {"type":"message_stop"}\n\n']) }), 'Hi');
});
await claim('Gemini events', async () => {
  assert.equal(await ask(q('gemini'), { fetch: async () => stream(['data: {"candidates":[{"content":{"parts":[{"text":"G"}]},"finishReason":"STOP"}]}\n\n']) }), 'G');
});
await claim('a reply that is not streamed', async () => {
  assert.equal(await ask(q('ollama', { stream: false }), { fetch: async () => new Response('{"message":{"content":"whole"},"done":true}') }), 'whole');
});

section('The processor or the graphics chip reaches Ollama');
for (const [device, want] of [['cpu', 0], ['gpu', 999], ['auto', undefined]]) {
  await claim(`${device} sends num_gpu ${want}`, async () => {
    let body;
    await ask(q('ollama', { device }), { fetch: async (u, init) => { body = JSON.parse(init.body); return stream(['{"message":{"content":"a"},"done":true}\n']); } });
    assert.equal(body.options.num_gpu, want);
  });
}
await claim('an unknown choice sends nothing', () => assert.equal(gpuLayers('fast'), undefined));

section('Every failure says what to do');
const rejects = (label, req, io, re) => claim(label, () => assert.rejects(ask(req, io), re));
await rejects('no key for a cloud service', q('openai', { key: '' }), { fetch: async () => stream([]) }, /Add your OpenAI key/);
await rejects('no model chosen', q('ollama', { model: '' }), { fetch: async () => stream([]) }, /Choose a model/);
await rejects('a local service that is not running', q('ollama'), { fetch: async () => { throw new TypeError('fetch failed'); } }, /Ollama did not answer at 127\.0\.0\.1:11434/);
await rejects('a refused key, with the service’s own words', q('openai'), { fetch: async () => new Response('{"error":{"message":"bad key"}}', { status: 401 }) }, /did not accept the key.*bad key/);
await rejects('an error sent inside the stream', q('openai'), { fetch: async () => stream(['data: {"error":{"message":"overloaded"}}\n\n']) }, /OpenAI: overloaded/);
await rejects('an empty answer', q('ollama'), { fetch: async () => stream(['{"message":{"content":""},"done":true}\n']) }, /empty answer/);
await claim('a stop is reported as stopped, not as a failure', async () => {
  const ac = new AbortController(); ac.abort();
  await assert.rejects(ask(q('ollama'), { signal: ac.signal, fetch: async (u, i) => { if (i.signal.aborted) throw Object.assign(new Error('a'), { name: 'AbortError' }); } }), (e) => e.stopped === true);
});

section('Model lists');
await claim('Ollama lists chat models, sorted, without embedding models', async () => {
  const ms = await listModels('ollama', { fetch: async () => new Response(JSON.stringify({ models: [{ name: 'qwen2.5:7b' }, { name: 'nomic-embed-text' }, { name: 'gemma3:4b' }] })) });
  assert.deepEqual(ms.map((m) => m.id), ['gemma3:4b', 'qwen2.5:7b']);
});
await claim('a service with a built-in list falls back to it when unreachable', async () => {
  const ms = await listModels('anthropic', { key: 'k', fetch: async () => { throw new TypeError('x'); } });
  assert.ok(ms.length >= 1);
});
await claim('a cloud list without a key asks for one', () => assert.rejects(listModels('openai', { fetch: async () => new Response('') }), /key first/));

section('The way of working suggested for a model');
await claim('a 3B local model is guided', () => assert.equal(modelProfile('ollama', 'qwen2.5:3b').tier, 'guided'));
await claim('a 32B local model plans', () => assert.equal(modelProfile('ollama', 'qwen2.5:32b').tier, 'plan'));
await claim('a frontier cloud model writes code', () => assert.equal(modelProfile('anthropic', 'claude-opus-5-5').tier, 'code'));
done();
