// What the app knows about a model running on this computer through Ollama:
// how long it stays loaded, how much it is given room to read, what it can
// do, how fast it writes here, and whether it fits on the graphics chip.
//
// Pure apart from the fetch it is given, so the checks play Ollama's answers
// through it without Ollama.

// ---- how long a model stays loaded --------------------------------------
//
// Ollama keeps a model in memory for a while after each answer, five minutes
// unless its server was told otherwise. That stands until the person picks a
// time. Never for good: a model held for good is never given up. Never at
// once: a film is several questions in a row, and reloading between them
// costs more than it frees.
export const KEEP_CHOICES = [
  ['', 'As Ollama decides (usually 5 minutes)'],
  ['2m', '2 minutes'],
  ['10m', '10 minutes'],
  ['30m', '30 minutes'],
  ['1h', '1 hour'],
];
export const KEEP_VALUES = KEEP_CHOICES.map(([v]) => v);

// ---- how much a model is given room to read ------------------------------
//
// Ollama reads a request into a window of num_ctx tokens and, when the
// request is longer, drops its START without a word: the instructions and
// the shape the answer must take. The window is sized to what is sent, in a
// few fixed steps so Ollama does not reload the model for every request,
// never past what the model supports, and never past a ceiling that keeps
// memory in check. A request that still does not fit is refused in words.
export const WINDOW_STEPS = [4096, 8192, 16384, 32768];

// About three and a half characters a token for English and JSON alike;
// rounded up, since running short is the failure that matters.
export const estimateTokens = (text) => Math.ceil(String(text || '').length / 3.2);

export function requestTokens({ system = '', messages = [] }) {
  let n = estimateTokens(system) + 16;
  for (const m of messages) n += estimateTokens(m.content) + 8 + (m.images?.length || 0) * 800;
  return n;
}

// { numCtx, fits }: the smallest step that holds the request and the answer.
// `modelMax` is the model's own limit when it is known; `previous` is the
// window the model is loaded with now, kept when the request fits it, since
// a different window reloads the model.
export function windowFor(need, { modelMax = null, previous = null } = {}) {
  const ceiling = Math.min(WINDOW_STEPS[WINDOW_STEPS.length - 1], modelMax || Infinity);
  if (previous && need <= previous && previous <= ceiling) return { numCtx: previous, fits: true };
  const step = WINDOW_STEPS.find((s) => s >= need && s <= ceiling);
  if (step) return { numCtx: step, fits: true };
  return { numCtx: Math.max(WINDOW_STEPS[0], Math.floor(ceiling)), fits: false };
}

// The longest answer each kind of question needs. Asking for more makes
// the window, and the memory, bigger for nothing.
export const ANSWER_TOKENS = { chat: 900, research: 400, intent: 600, storyboard: 1500, pictures: 3000, music: 8000, 'revise music': 8000, plan: 7000, 'plan part': 3500, revise: 7000, 'revise part': 3500, edit: 7000, code: 8000, 'revise code': 8000, review: 1000, 'apply review': 7000 };
export const answerTokens = (purpose) => ANSWER_TOKENS[purpose] || 4000;

// ---- what a model can do -------------------------------------------------

// From Ollama's /api/show: { context, vision, thinking }.
export function readShow(json) {
  const info = json && typeof json.model_info === 'object' ? json.model_info : {};
  const ctxKey = Object.keys(info).find((k) => k.endsWith('.context_length'));
  const caps = Array.isArray(json?.capabilities) ? json.capabilities : [];
  return {
    context: ctxKey && Number.isFinite(info[ctxKey]) ? info[ctxKey] : null,
    vision: caps.includes('vision'),
    thinking: caps.includes('thinking'),
  };
}

export async function showModel(base, model, fetch) {
  try {
    const res = await fetch(`${base}/api/show`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }) });
    if (!res.ok) return null;
    return readShow(await res.json());
  } catch { return null; }
}

// ---- thinking ---------------------------------------------------------------

// Some models write their thinking into the answer between think tags. It is
// taken out, so a storyboard or a plan is read from the answer alone.
export function stripThinking(text) {
  return String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '').trim();
}

// ---- speed --------------------------------------------------------------------

// Tokens a second from the counts Ollama sends with the end of a reply.
// Fewer than twenty tokens say too little to count.
export function speedOf(done) {
  const n = Number(done?.eval_count), ns = Number(done?.eval_duration);
  if (!(n >= 20) || !(ns > 0)) return null;
  return n / (ns / 1e9);
}

// ---- whether a model fits on the graphics chip ------------------------------

// From Ollama's /api/ps for one loaded model: { share } is the part of it held
// on the graphics chip, 0 to 1, or null when the model is not loaded.
export function fitOf(json, model) {
  const list = Array.isArray(json?.models) ? json.models : [];
  const m = list.find((x) => x.name === model || x.model === model || x.name === `${model}:latest`);
  if (!m || !(m.size > 0)) return null;
  return { share: Math.max(0, Math.min(1, (m.size_vram || 0) / m.size)), size: m.size };
}

export async function loadedFit(base, model, fetch) {
  try {
    const res = await fetch(`${base}/api/ps`);
    if (!res.ok) return null;
    return fitOf(await res.json(), model);
  } catch { return null; }
}

// One sentence on where the model ran, or null when there is nothing to say.
export function fitSentence(fit, speed) {
  if (!fit) return null;
  const pace = speed ? ` It wrote about ${Math.round(speed)} tokens a second here.` : '';
  if (fit.share >= 0.99) return `The model ran entirely on the graphics chip.${pace}`;
  if (fit.share <= 0.01) return `The model ran on the processor.${pace}`;
  const cpu = Math.round((1 - fit.share) * 100);
  return `About ${cpu}% of the model ran on the processor because it does not fit on the graphics chip, which is slower.${pace} A smaller model, or closing other apps, would be faster.`;
}

// ---- the services on this computer ----------------------------------------

// Whether a local service answers, and with which models. Quick: a service
// that does not answer within a moment is reported as not running.
export async function probeLocal(url, fetch, ms = 1500) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
  try {
    const res = await fetch(url, ctrl ? { signal: ctrl.signal } : {});
    if (!res.ok) return { running: true, ok: false, status: res.status };
    return { running: true, ok: true, json: await res.json().catch(() => null) };
  } catch {
    return { running: false, ok: false };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// A readable size for a model file.
export function sizeText(bytes) {
  if (!(bytes > 0)) return '';
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

// ---- giving the memory back ---------------------------------------------------

// Asks Ollama to unload a model now, so the graphics chip and the memory are
// free for everything else the moment a film is made. True when Ollama said yes.
export async function unloadModel(base, model, fetch) {
  try {
    const res = await fetch(`${base}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, keep_alive: 0 }) });
    return res.ok;
  } catch { return false; }
}
