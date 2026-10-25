// Talking to model services, played through a stand-in fetch: every request
// shape the app knows streams back into the right text, every failure turns
// into one sentence that says what to do, the processor or graphics-chip
// choice reaches Ollama, and model lists read the way each service sends them.

import assert from 'node:assert/strict';
import { section, claim, done } from './lib/check.mjs';
import { ask, listModels, gpuLayers } from '../../src/core/providers/client.js';
import { modelProfile, sortModels, defaultModel, parseModelList } from '../../src/core/providers/models.js';
import { buildRequest, THINKING_ROOM } from '../../src/core/providers/request.js';

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

section('What each request used is read from the reply, in one shape');
const usageOf = async (provider, chunks, extra = {}) => { let u = null; await ask(q(provider, extra), { fetch: async () => stream(chunks), onUsage: (x) => { u = x; } }); return u; };
await claim('Ollama: what it read and wrote, from its last line', async () => {
  assert.deepEqual(await usageOf('ollama', ['{"message":{"content":"a"}}\n{"message":{"content":"b"},"done":true,"prompt_eval_count":120,"eval_count":30}\n']), { input: 120, output: 30, cacheRead: 0, cacheWrite: 0 });
});
await claim('the chat shape: fresh and cached reading apart, thinking counted as written', async () => {
  const u = await usageOf('openai', ['data: {"choices":[{"delta":{"content":"x"},"finish_reason":"stop"}]}\n\n', 'data: {"choices":[],"usage":{"prompt_tokens":1000,"completion_tokens":200,"prompt_tokens_details":{"cached_tokens":600}}}\n\ndata: [DONE]\n\n']);
  assert.deepEqual(u, { input: 400, output: 200, cacheRead: 600, cacheWrite: 0 });
});
await claim('a service that names its cache hits its own way', async () => {
  const u = await usageOf('deepseek', ['data: {"choices":[{"delta":{"content":"x"},"finish_reason":"stop"}],"usage":{"prompt_tokens":900,"completion_tokens":50,"prompt_cache_hit_tokens":512}}\n\ndata: [DONE]\n\n']);
  assert.deepEqual(u, { input: 388, output: 50, cacheRead: 512, cacheWrite: 0 });
});
await claim('Anthropic: reading at the start, writing at the end, cache writes kept apart', async () => {
  const u = await usageOf('anthropic', ['data: {"type":"message_start","message":{"usage":{"input_tokens":50,"cache_creation_input_tokens":2000,"cache_read_input_tokens":0,"output_tokens":1}}}\n\n', 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":75}}\n\ndata: {"type":"message_stop"}\n\n']);
  assert.deepEqual(u, { input: 50, output: 75, cacheRead: 0, cacheWrite: 2000 });
});
await claim('Gemini: a running total, with thinking counted as written', async () => {
  const u = await usageOf('gemini', ['data: {"candidates":[{"content":{"parts":[{"text":"G"}]}}],"usageMetadata":{"promptTokenCount":300,"candidatesTokenCount":5}}\n\n', 'data: {"candidates":[{"content":{"parts":[{"text":"o"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":300,"candidatesTokenCount":20,"thoughtsTokenCount":100,"cachedContentTokenCount":200}}\n\n']);
  assert.deepEqual(u, { input: 100, output: 120, cacheRead: 200, cacheWrite: 0 });
});
await claim('services that report only when asked are asked; the rest are not', () => {
  const body = (provider) => JSON.parse(buildRequest(q(provider)).init.body);
  assert.deepEqual(body('openai').stream_options, { include_usage: true });
  assert.deepEqual(body('deepseek').stream_options, { include_usage: true });
  assert.equal(body('mistral').stream_options, undefined);
  assert.equal(JSON.parse(buildRequest(q('openai', { stream: false })).init.body).stream_options, undefined);
});
await claim('a long system text is marked for Anthropic\u2019s cache; a short one is sent plain', () => {
  const long = JSON.parse(buildRequest(q('anthropic', { system: 'x'.repeat(6000) })).init.body).system;
  assert.equal(long[0].cache_control.type, 'ephemeral'); assert.equal(long[0].text.length, 6000);
  assert.equal(JSON.parse(buildRequest(q('anthropic', { system: 'short' })).init.body).system, 'short');
});
await claim('a reply that says nothing about it reports nothing', async () => {
  assert.equal(await usageOf('openai', ['data: {"choices":[{"delta":{"content":"x"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n']), null);
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

section('What each service accepts');
const body = (provider, model, extra = {}) => JSON.parse(buildRequest({ ...q(provider, { model, ...extra }), maxTokens: 1500 }).init.body);
await claim('a current Claude model is sent no sampling value, and room to think', () => {
  for (const m of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-4-8', 'claude-fable-5-1']) {
    const b = body('anthropic', m);
    assert.equal(b.temperature, undefined, m); assert.ok(b.max_tokens >= 16000, m);
  }
});
await claim('an older Claude model keeps its temperature and its own length', () => {
  for (const m of ['claude-sonnet-4-5-20250929', 'claude-opus-4-6', 'claude-3-5-haiku-latest']) {
    const b = body('anthropic', m);
    assert.equal(b.temperature, 0.4, m); assert.equal(b.max_tokens, 1500, m);
  }
});
await claim('an OpenAI reasoning model gets room to reason and no temperature', () => {
  const b = body('openai', 'gpt-5.1');
  assert.equal(b.temperature, undefined); assert.ok(b.max_completion_tokens >= 16000);
  assert.equal(body('openai', 'gpt-4.1').max_completion_tokens, 1500);
});
await claim('a relayed current Claude model is sent no temperature either', () => {
  assert.equal(body('openrouter', 'anthropic/claude-opus-5-5').temperature, undefined);
  assert.equal(body('openrouter', 'meta-llama/llama-4-maverick').temperature, 0.4);
});
await claim('a Gemini model that thinks gets room to think', () => {
  assert.ok(body('gemini', 'gemini-2.5-flash').generationConfig.maxOutputTokens >= 16000);
  assert.equal(body('gemini', 'gemini-2.0-flash').generationConfig.maxOutputTokens, 1500);
});
await rejects('an answer declined by the model says so', q('anthropic'), { fetch: async () => stream(['data: {"type":"message_delta","delta":{"stop_reason":"refusal"}}\n\ndata: {"type":"message_stop"}\n\n']) }, /declined to answer/);
await rejects('a model that answers only another request shape says to choose another', q('openai'), { fetch: async () => new Response('{"error":{"message":"This model is only supported in v1/responses and not in v1/chat/completions."}}', { status: 404 }) }, /does not answer chat requests/);
await rejects('an answer cut off before any text says so', q('openai'), { fetch: async () => stream(['data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n']) }, /used all the room/);

section('A model that thinks first is given room for it');
const thinkingCut = 'data: {"choices":[{"delta":{"reasoning_content":"Let me think"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n';
const answered = 'data: {"choices":[{"delta":{"content":"{\\"ok\\":1}"},"finish_reason":"stop"}]}\n\n';
const recorder = (replies) => {
  const limits = [];
  return { limits, fetch: async (u, init) => { const b = JSON.parse(init.body); limits.push(b.max_tokens ?? b.max_completion_tokens); return stream([replies[limits.length - 1] ?? replies.at(-1)]); } };
};
await claim('an answer spent on thinking is asked once more with room on top, and comes back', async () => {
  const r = recorder([thinkingCut, answered]);
  assert.equal(await ask(q('deepseek', { model: 'ds-a', maxTokens: 600 }), r), '{"ok":1}');
  assert.deepEqual(r.limits, [600, 600 + THINKING_ROOM]);
});
await claim('later questions to that model get the room at once', async () => {
  const r = recorder([answered]);
  await ask(q('deepseek', { model: 'ds-a', maxTokens: 7000 }), r);
  assert.deepEqual(r.limits, [7000 + THINKING_ROOM]);
});
await claim('thinking written inside the answer counts too', async () => {
  const r = recorder(['data: {"choices":[{"delta":{"content":"<think>hmm"},"finish_reason":"length"}]}\n\n', answered]);
  assert.equal(await ask(q('openrouter', { model: 'or-b', maxTokens: 600 }), r), '{"ok":1}');
  assert.equal(r.limits.length, 2);
});
await claim('a model still out of room with the extra room says so, after one more try only', async () => {
  const r = recorder([thinkingCut]);
  await assert.rejects(ask(q('deepseek', { model: 'ds-c', maxTokens: 600 }), r), /used all the room/);
  assert.equal(r.limits.length, 2);
});
await claim('a long answer cut off without thinking is not asked again', async () => {
  const r = recorder(['data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}\n\n']);
  assert.equal(await ask(q('deepseek', { model: 'plain-a', maxTokens: 600 }), r), 'partial');
  assert.equal(r.limits.length, 1);
});
await claim('Ollama is asked once, its room being part of the reading window', async () => {
  let calls = 0;
  await assert.rejects(ask(q('ollama', { model: 'ol-d' }), { fetch: async () => { calls++; return stream(['{"message":{"thinking":"hm","content":""},"done":true,"done_reason":"length"}\n']); } }), /empty answer/);
  assert.equal(calls, 1);
});
await claim('a model whose name says it reasons gets the room from the start', () => {
  assert.equal(body('deepseek', 'deepseek-reasoner').max_tokens, 1500 + THINKING_ROOM);
  assert.equal(body('deepseek', 'deepseek-chat').max_tokens, 1500);
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
await claim('a dated list comes newest first, so current models lead', () => {
  const list = sortModels([{ id: 'a', label: 'Old', meta: { created: 1 } }, { id: 'b', label: 'New', meta: { created: 9 } }]);
  assert.deepEqual(list.map((m) => m.id), ['b', 'a']);
});
await claim('OpenAI models that do not chat are left out', () => {
  const ids = parseModelList('openai', { data: ['gpt-5.1', 'babbage-002', 'gpt-image-1', 'sora-2', 'text-embedding-3-small', 'gpt-4o-mini'].map((id) => ({ id, created: 1 })) }).map((m) => m.id);
  assert.deepEqual(ids, ['gpt-5.1', 'gpt-4o-mini']);
});
await claim('the first model chosen is a recommended one, not the first by name', () => {
  assert.equal(defaultModel('anthropic', [{ id: 'claude-3-haiku' }, { id: 'claude-sonnet-5-5' }]), 'claude-sonnet-5-5');
  assert.equal(defaultModel('groq', [{ id: 'x' }, { id: 'y' }]), 'x');
});
await claim('a cloud list without a key asks for one', () => assert.rejects(listModels('openai', { fetch: async () => new Response('') }), /key first/));

section('The way of working suggested for a model');
await claim('a 3B local model is guided', () => assert.equal(modelProfile('ollama', 'qwen2.5:3b').tier, 'guided'));
await claim('a 32B local model plans', () => assert.equal(modelProfile('ollama', 'qwen2.5:32b').tier, 'plan'));
await claim('a frontier cloud model writes code', () => assert.equal(modelProfile('anthropic', 'claude-opus-5-5').tier, 'code'));
done();
