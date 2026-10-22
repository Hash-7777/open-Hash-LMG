// One request shape in, four request shapes out.
//
// The director asks every model the same way: a system text, a list of
// messages (each may carry pictures), and whether the answer must be JSON.
// buildRequest turns that into what the chosen service expects; readStream
// turns its streamed reply back into plain text as it arrives.
//
// Pure apart from the fetch the caller makes with the result, so the checks
// can build every shape and parse recorded replies without a network.

import { PROVIDERS } from './catalog.js';

const dataUrlParts = (url) => {
  const m = /^data:([^;]+);base64,(.*)$/.exec(url || '');
  return m ? { mime: m[1], data: m[2] } : null;
};

// Models that refuse a temperature (reasoning families) are sent none.
const NO_TEMPERATURE = /^(o\d|gpt-5)/i;
// Claude models that still take a temperature: the 3 family and the 4 family
// up to 4.6. Every later one refuses any sampling value, and thinks before it
// answers, so it is given room for that.
const CLAUDE_SAMPLING = /^claude-(?:3|2|instant)|^claude-[a-z]+-4(?:-[0-6])?(?:-\d{8})?$/i;
// Gemini models that think before answering, and count that in their budget.
const GEMINI_THINKING = /gemini-(?:2\.5|[3-9])/i;
// Models served in the chat shape whose names say they reason first.
const THINKS_BY_NAME = /reason|think|deepseek-r1|qwq/i;
// Room for thinking on top of the answer, for the models that do it.
export const THINKING_ROOM = 16000;
const withRoom = (maxTokens) => maxTokens + THINKING_ROOM;

// req: { provider, model, key, base, system, messages: [{ role, content, images: [dataUrl] }],
//        json: boolean, schema: object|null, temperature, maxTokens, stream, numCtx, numGpu, keepAlive,
//        thinks: the model is known to think first, so it gets room for that }
export function buildRequest(req) {
  const p = PROVIDERS[req.provider];
  if (!p) throw new Error(`Unknown model service: ${req.provider}`);
  const base = req.base || p.base;
  const stream = req.stream !== false;
  const temperature = req.temperature ?? 0.4;
  const maxTokens = req.maxTokens ?? 8000;
  const headers = { 'Content-Type': 'application/json', ...(p.extraHeaders || {}) };

  if (p.style === 'ollama') {
    const body = {
      model: req.model,
      stream,
      messages: [
        ...(req.system ? [{ role: 'system', content: req.system }] : []),
        ...req.messages.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.images?.length ? { images: m.images.map((u) => dataUrlParts(u)?.data).filter(Boolean) } : {}),
        })),
      ],
      options: {
        temperature,
        num_predict: maxTokens,
        ...(req.numCtx ? { num_ctx: req.numCtx } : {}),
        // Where the model runs: 0 layers on the graphics chip is the processor
        // alone, a number past the model's layer count is all of it on the chip,
        // and leaving it out lets Ollama decide.
        ...(Number.isInteger(req.numGpu) ? { num_gpu: req.numGpu } : {}),
      },
      ...(req.keepAlive !== undefined ? { keep_alive: req.keepAlive } : {}),
    };
    if (req.json) body.format = req.schema && p.json === 'schema' ? req.schema : 'json';
    return { url: base + p.chatPath, init: { method: 'POST', headers, body: JSON.stringify(body) } };
  }

  if (p.style === 'openai') {
    if (p.kind === 'cloud') headers.Authorization = `Bearer ${req.key || ''}`;
    const body = {
      model: req.model,
      stream,
      messages: [
        ...(req.system ? [{ role: 'system', content: req.system }] : []),
        ...req.messages.map((m) => ({
          role: m.role,
          content: m.images?.length
            ? [{ type: 'text', text: m.content }, ...m.images.map((url) => ({ type: 'image_url', image_url: { url } }))]
            : m.content,
        })),
      ],
    };
    // A service that relays other companies' models names them "maker/model".
    const bare = String(req.model || '').replace(/^[^/]+\//, '');
    const reasons = NO_TEMPERATURE.test(bare);
    const sampling = !reasons && !(/^claude-/i.test(bare) && !CLAUDE_SAMPLING.test(bare));
    const limit = (reasons && p.newTokenField) || req.thinks || THINKS_BY_NAME.test(bare) ? withRoom(maxTokens) : maxTokens;
    if (p.newTokenField) body.max_completion_tokens = limit; else body.max_tokens = limit;
    if (sampling) body.temperature = temperature;
    if (req.json) {
      if (req.schema && p.json === 'schema') body.response_format = { type: 'json_schema', json_schema: { name: 'answer', schema: req.schema, strict: false } };
      else if (p.json) body.response_format = { type: 'json_object' };
    }
    return { url: base + p.chatPath, init: { method: 'POST', headers, body: JSON.stringify(body) } };
  }

  if (p.style === 'anthropic') {
    headers['x-api-key'] = req.key || '';
    headers['anthropic-version'] = '2023-06-01';
    // The service refuses a request from a web page unless it is told the page
    // means it. The key stays on this computer either way.
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
    const sampling = CLAUDE_SAMPLING.test(req.model || '');
    const body = {
      model: req.model,
      stream,
      max_tokens: sampling && !req.thinks ? maxTokens : withRoom(maxTokens),
      ...(sampling ? { temperature } : {}),
      ...(req.system ? { system: req.system } : {}),
      messages: req.messages.map((m) => ({
        role: m.role,
        content: [
          ...(m.images || []).map((u) => dataUrlParts(u)).filter(Boolean).map((d) => ({ type: 'image', source: { type: 'base64', media_type: d.mime, data: d.data } })),
          { type: 'text', text: m.content },
        ],
      })),
    };
    return { url: base + p.chatPath, init: { method: 'POST', headers, body: JSON.stringify(body) } };
  }

  if (p.style === 'gemini') {
    // The key goes in a header, never in the address, so it cannot end up in a log line.
    headers['x-goog-api-key'] = req.key || '';
    const model = String(req.model || '').replace(/^models\//, '');
    const body = {
      ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
      contents: req.messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [
          { text: m.content },
          ...(m.images || []).map((u) => dataUrlParts(u)).filter(Boolean).map((d) => ({ inline_data: { mime_type: d.mime, data: d.data } })),
        ],
      })),
      generationConfig: { temperature, maxOutputTokens: GEMINI_THINKING.test(model) || req.thinks ? withRoom(maxTokens) : maxTokens, ...(req.json ? { responseMimeType: 'application/json' } : {}) },
    };
    const action = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
    return { url: `${base}/v1beta/models/${encodeURIComponent(model)}:${action}`, init: { method: 'POST', headers, body: JSON.stringify(body) } };
  }
  throw new Error(`No request shape for ${p.label}`);
}

// Why an answer ended early, in the app's own words, from each service's name
// for it: the length it was allowed, or the model declining to answer.
const CUT = { length: 'cut', max_tokens: 'cut', MAX_TOKENS: 'cut', refusal: 'declined', SAFETY: 'declined', content_filter: 'declined', PROHIBITED_CONTENT: 'declined' };

// Text from one parsed event of a streamed reply, per style. Returns
// { text, thinking, error, done, stop }, stop being 'cut' or 'declined' when
// the answer ended before it was finished.
export function readEvent(style, ev) {
  if (!ev || typeof ev !== 'object') return {};
  if (ev.error) {
    const msg = typeof ev.error === 'string' ? ev.error : ev.error.message || JSON.stringify(ev.error).slice(0, 300);
    return { error: msg };
  }
  if (style === 'ollama') {
    return { text: ev.message?.content || '', thinking: ev.message?.thinking || '', done: !!ev.done };
  }
  if (style === 'openai') {
    const c = ev.choices?.[0];
    if (!c) return {};
    const d = c.delta || c.message || {};
    return { text: d.content || '', thinking: d.reasoning_content || d.reasoning || '', done: !!c.finish_reason, stop: CUT[c.finish_reason] };
  }
  if (style === 'anthropic') {
    if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') return { text: ev.delta.text };
    if (ev.type === 'content_block_delta' && ev.delta?.type === 'thinking_delta') return { thinking: ev.delta.thinking };
    if (ev.type === 'message_delta' && CUT[ev.delta?.stop_reason]) return { stop: CUT[ev.delta.stop_reason] };
    if (ev.type === 'message_stop') return { done: true };
    if (ev.type === 'error') return { error: ev.error?.message || 'The service reported an error.' };
    // A non-streamed reply.
    if (Array.isArray(ev.content)) return { text: ev.content.filter((b) => b.type === 'text').map((b) => b.text).join(''), done: true, stop: CUT[ev.stop_reason] };
    return {};
  }
  if (style === 'gemini') {
    const parts = ev.candidates?.[0]?.content?.parts || [];
    return {
      text: parts.filter((x) => !x.thought).map((x) => x.text || '').join(''),
      thinking: parts.filter((x) => x.thought).map((x) => x.text || '').join(''),
      done: !!ev.candidates?.[0]?.finishReason,
      stop: CUT[ev.candidates?.[0]?.finishReason],
    };
  }
  return {};
}

// Splits a stream of bytes into events: server-sent "data:" lines for most
// services, one JSON object per line for Ollama. Feed it chunks; it calls
// onEvent with each parsed object.
export function eventSplitter(style, onEvent) {
  let buf = '';
  const decoder = new TextDecoder();
  const line = (raw) => {
    const s = raw.trim();
    if (!s) return;
    if (style === 'ollama') {
      try { onEvent(JSON.parse(s)); } catch { /* a partial line waits for the rest */ }
      return;
    }
    if (!s.startsWith('data:')) return;
    const payload = s.slice(5).trim();
    if (payload === '[DONE]') { onEvent({ __done: true }); return; }
    try { onEvent(JSON.parse(payload)); } catch { /* ignore keep-alives and partials */ }
  };
  return {
    push(chunk) {
      buf += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); }
    },
    end() { if (buf) line(buf); buf = ''; },
  };
}

// Plain words for an HTTP failure, with the service's own message when it gave one.
export function describeFailure(providerId, status, bodyText) {
  const p = PROVIDERS[providerId];
  let detail = '';
  try {
    const j = JSON.parse(bodyText);
    detail = j.error?.message || j.error || j.message || '';
    if (typeof detail !== 'string') detail = JSON.stringify(detail);
  } catch { detail = String(bodyText || '').slice(0, 200); }
  const who = p ? p.label : 'The service';
  if (/v1\/responses|not a chat model|not supported in the v1\/chat|chat\/completions? (?:is )?not supported/i.test(detail)) return `${who}: that model does not answer chat requests. Choose another model in Settings.`;
  if (status === 401 || status === 403) return `${who} did not accept the key. Check it in Settings.${detail ? ` (${detail})` : ''}`;
  if (status === 404) return `${who} does not know that model, or the address is wrong.${detail ? ` (${detail})` : ''}`;
  if (status === 429) return `${who} says too many requests right now. Wait a moment, or choose another model.${detail ? ` (${detail})` : ''}`;
  if (status >= 500) return `${who} had a problem on its side (${status}).${detail ? ` ${detail}` : ''} Try again shortly.`;
  return `${who} answered with an error (${status}).${detail ? ` ${detail}` : ''}`;
}
