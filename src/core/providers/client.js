// Talking to a model service: one question out, the answer streamed back.
//
// request.js builds the request and reads each streamed event; this sends it
// and puts the pieces together. The fetch is passed in, so the checks can play
// a recorded reply through it without a network, and the page passes its own.
//
// Every failure becomes one plain sentence that says what to do: a local
// service that is not running, a key that was refused, a model the service
// does not know, a reply that stopped half way.

import { PROVIDERS } from './catalog.js';
import { buildRequest, MORE_THINKING_ROOM, readEvent, readUsage, mergeUsage, eventSplitter, describeFailure } from './request.js';
import { modelsRequest, parseModelList, sortModels } from './models.js';
import { stripThinking, speedOf } from './local.js';

// The processor or the graphics chip, as Ollama's num_gpu: the number of the
// model's layers placed on the chip. "auto" sends nothing.
export function gpuLayers(device) {
  if (device === 'cpu') return 0;
  if (device === 'gpu') return 999;
  return undefined;
}

// A model told to run only on the graphics chip that does not fit there fails
// to load; the message then says how to go back.
function onChipHint(req, message) {
  if (req.device === 'gpu' && /memory|alloc|metal|cuda|vram|load/i.test(message)) {
    return `${message} The model may not fit on the graphics chip: choose Automatic under Runs on in Settings.`;
  }
  return message;
}

function unreachable(providerId, base, err) {
  const p = PROVIDERS[providerId];
  if (err?.name === 'AbortError') return Object.assign(new Error('Stopped.'), { stopped: true });
  if (p?.kind === 'local') {
    const where = String(base || p.base).replace(/^https?:\/\//, '');
    return new Error(`${p.label} did not answer at ${where}. Check that it is running, and that the port in Settings matches. ${p.help || ''}`.trim());
  }
  return new Error(`${p ? p.label : 'The service'} could not be reached. Check the connection to the internet, then try again.`);
}

// Models seen thinking until their answer ran out of room, kept while the app
// runs, so every later question gives them that room at once.
const thinkers = new Set();

// Sends one question and returns the whole answer as text, with any thinking
// a model wrote into it taken out.
//   req     as for buildRequest, plus device for local models, and keyHeld
//           when the desktop side adds the key to the request itself
//   io      { fetch, signal, onText(chunk, all), onThinking(chunk), onStats({ speed, promptTokens }),
//             onUsage({ input, output, cacheRead, cacheWrite }) once per request the service reported on }
//
// A model that thinks before it answers can spend the room given for the
// answer on its thinking. When an answer is cut off that way, the question is
// asked once more with room for the thinking on top, and a model that had that
// room and still used it all is asked once more with a larger one. Ollama is
// left out: its
// room is part of the reading window, sized before the question is sent.
export async function ask(req, io) {
  const p = PROVIDERS[req.provider];
  if (!p) throw new Error(`Unknown model service: ${req.provider}`);
  if (!req.model) throw new Error('Choose a model in Settings first.');
  if (p.kind === 'cloud' && !req.key && !req.keyHeld) throw new Error(`Add your ${p.label} key in Settings first.`);
  const id = `${req.provider}|${req.model}`;
  const thinks = !!req.thinks || thinkers.has(id);
  let r = await askOnce({ ...req, thinks }, io, p);
  if (r.stop === 'cut' && !thinks && p.style !== 'ollama' && (r.thought || !r.text.trim())) {
    thinkers.add(id);
    r = await askOnce({ ...req, thinks: true }, io, p);
  }
  if (r.stop === 'cut' && p.style !== 'ollama' && !r.text.trim() && !req.room) {
    // It had the usual room for thinking and thought through all of it: one
    // more try with a larger room, since the same room would end the same way.
    r = await askOnce({ ...req, thinks: true, room: MORE_THINKING_ROOM }, io, p);
  }
  if (!r.text.trim() && r.stop === 'declined') throw new Error(`${p.label} declined to answer this brief. Try other words, or another model.`);
  if (!r.text.trim() && r.stop === 'cut') throw new Error(`${p.label} used all the room it was given before it wrote an answer. Try again, or choose another model.`);
  if (!r.text.trim()) {
    throw new Error(`${p.label} sent back an empty answer.${r.finished ? '' : ' It may have stopped early.'} Try again, or choose another model.`);
  }
  return r.text;
}

// One request and its reply: { text, stop, finished, thought }, thought being
// whether the model sent any thinking.
async function askOnce(req, io, p) {
  const numGpu = req.numGpu ?? (p.style === 'ollama' ? gpuLayers(req.device) : undefined);
  const { url, init } = buildRequest({ ...req, numGpu });

  let res;
  try {
    res = await io.fetch(url, { ...init, signal: io.signal });
  } catch (err) {
    throw unreachable(req.provider, req.base, err);
  }
  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch { /* the status says enough */ }
    throw new Error(onChipHint(req, describeFailure(req.provider, res.status, body)));
  }

  let text = '';
  let failure = null;
  let finished = false;
  let stop = null;
  let thought = false;
  let usage = null;
  const take = (ev) => {
    if (ev && ev.__done) { finished = true; return; }
    usage = mergeUsage(usage, readUsage(p.style, ev));
    if (p.style === 'ollama' && ev && ev.done && io.onStats) io.onStats({ speed: speedOf(ev), promptTokens: Number(ev.prompt_eval_count) || null });
    const r = readEvent(p.style, ev);
    if (r.error) { failure = r.error; return; }
    if (r.thinking) { thought = true; if (io.onThinking) io.onThinking(r.thinking); }
    if (r.text) { text += r.text; if (io.onText) io.onText(r.text, text); }
    if (r.stop) stop = r.stop;
    if (r.done) finished = true;
  };

  if (req.stream === false || !res.body || typeof res.body.getReader !== 'function') {
    const raw = await res.text();
    if (req.stream === false) {
      try { take(JSON.parse(raw)); } catch { throw new Error(`${p.label} sent an answer that could not be read.`); }
    } else {
      const split = eventSplitter(p.style, take);
      split.push(raw);
      split.end();
    }
  } else {
    const split = eventSplitter(p.style, take);
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        split.push(value);
        if (failure) break;
      }
    } catch (err) {
      if (err?.name === 'AbortError') throw Object.assign(new Error('Stopped.'), { stopped: true });
      if (!text) throw unreachable(req.provider, req.base, err);
      failure = 'The answer stopped before it was finished.';
    } finally {
      try { reader.releaseLock(); } catch { /* already released */ }
    }
    split.end();
  }

  // What the request used is reported even when its answer is then refused:
  // the tokens were spent either way.
  if (usage && io.onUsage) io.onUsage(usage);
  if (failure) throw new Error(onChipHint(req, `${p.label}: ${failure}`));
  const answer = stripThinking(text);
  return { text: answer, stop, finished, thought: thought || /<think>/i.test(text) };
}

// The models a service offers, as [{ id, label, meta }]. A cloud service with
// a built-in fallback list returns that list when its own cannot be read.
export async function listModels(providerId, { key = '', keyHeld = false, base = '', fetch, signal } = {}) {
  const p = PROVIDERS[providerId];
  if (!p) throw new Error(`Unknown model service: ${providerId}`);
  if (p.kind === 'cloud' && !key && !keyHeld) throw new Error(`Add your ${p.label} key first.`);
  const { url, init } = modelsRequest(providerId, key, base);
  let res;
  try {
    res = await fetch(url, { ...init, signal });
  } catch (err) {
    if (p.fallbackModels) return p.fallbackModels.map((id) => ({ id, label: id, meta: {} }));
    throw unreachable(providerId, base, err);
  }
  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch { /* the status says enough */ }
    if (p.fallbackModels && res.status !== 401 && res.status !== 403) return p.fallbackModels.map((id) => ({ id, label: id, meta: {} }));
    throw new Error(describeFailure(providerId, res.status, body));
  }
  let json = null;
  try { json = await res.json(); } catch { /* read as empty below */ }
  const list = sortModels(parseModelList(providerId, json));
  if (!list.length && p.fallbackModels) return p.fallbackModels.map((id) => ({ id, label: id, meta: {} }));
  return list;
}
