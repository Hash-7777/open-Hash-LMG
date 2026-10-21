// What a model is likely able to do, judged from its name and what its service
// says about it: how large it is, whether it can see pictures, and which of the
// three ways of making a film suits it.
//
//   guided  the model writes a storyboard of words; the app lays it out
//   plan    the model writes the whole scene plan; the app checks and repairs it
//   code    the model writes its own drawing code, run in a locked worker
//
// These are starting points, shown to the person, who can always choose.

import { PROVIDERS } from './catalog.js';

// Billions of parameters from a name like "qwen2.5:7b", "llama-3.1-70b",
// "mixtral-8x7b" or a service's "7.6B".
export function paramsFromName(name) {
  const s = String(name || '').toLowerCase();
  const moe = s.match(/(\d+)x(\d+(?:\.\d+)?)b/);
  if (moe) return parseFloat(moe[1]) * parseFloat(moe[2]);
  const all = [...s.matchAll(/(?:^|[^a-z0-9.])(\d+(?:\.\d+)?)\s*b(?![a-z])/g)].map((m) => parseFloat(m[1]));
  // "a3b" style active-parameter tags are not the model's size.
  const active = s.match(/a(\d+(?:\.\d+)?)b/);
  const list = all.filter((v) => !active || v !== parseFloat(active[1]));
  if (list.length) return Math.max(...list);
  const m = s.match(/(\d+(?:\.\d+)?)m(?![a-z])/);
  if (m) return parseFloat(m[1]) / 1000;
  return null;
}

const FRONTIER = [
  /claude-(opus|sonnet)/, /claude-\d.*(opus|sonnet)/, /^gpt-5(?!.*(mini|nano))/, /^gpt-4\.1(?!.*(mini|nano))/, /^gpt-4o(?!.*mini)/, /^o[134](?!.*mini)/,
  /gemini-[\d.]+-pro/, /gemini-.*-pro/, /deepseek-(chat|reasoner|v3|r1)/, /kimi-k2/, /grok-[34](?!.*mini)/, /qwen3-coder-480b/, /qwen3-235b/, /glm-4\.[56]/,
  /mistral-large/, /llama-?4-maverick/, /gpt-oss-120b/,
];
const LARGE = [/claude-.*haiku/, /mini/, /flash/, /nano/, /mistral-medium/, /codestral/, /llama-?3\.[13]-70b/];
const VISION = [/vision/, /[-_.]vl\b/, /vl[-_:]/, /llava/, /bakllava/, /gemma-?3/, /minicpm-v/, /moondream/, /pixtral/, /qwen2\.5vl/, /qwen2\.5-vl/, /qwen3-vl/, /llama3\.2-vision/, /granite.*vision/, /mistral-small3\.[12]/, /claude/, /gpt-4o/, /gpt-4\.1/, /gpt-5/, /gemini/, /grok-4/, /llama-?4/];

export function modelProfile(providerId, model, meta = {}) {
  const p = PROVIDERS[providerId] || { kind: 'cloud' };
  const name = String(model || '').toLowerCase();
  let params = meta.params ?? paramsFromName(name) ?? (meta.parameterSize ? paramsFromName(meta.parameterSize) : null);
  let size;
  if (p.kind === 'local' || params !== null) {
    if (params === null) size = 'medium';
    else size = params < 10 ? 'small' : params < 40 ? 'medium' : params < 100 ? 'large' : 'frontier';
  }
  if (!size || p.kind === 'cloud') {
    if (FRONTIER.some((r) => r.test(name))) size = 'frontier';
    else if (LARGE.some((r) => r.test(name))) size = size === 'frontier' ? 'frontier' : 'large';
    else size = size || 'large';
  }
  const vision = meta.vision ?? VISION.some((r) => r.test(name));
  const tier = size === 'small' ? 'guided' : size === 'frontier' ? 'code' : 'plan';
  return { params, size, vision, tier };
}

export const TIER_LABELS = {
  guided: 'Guided: the model writes the story, the app designs it',
  plan: 'Plan: the model designs every scene, the app checks it',
  code: 'Code: the model writes its own animation code',
};

// Reads a service's model list into [{ id, label, meta }].
export function parseModelList(providerId, json) {
  const p = PROVIDERS[providerId];
  if (!p || !json) return [];
  if (p.style === 'ollama') {
    return (json.models || []).map((m) => ({
      id: m.name || m.model,
      label: m.name || m.model,
      meta: {
        parameterSize: m.details?.parameter_size,
        quantization: m.details?.quantization_level,
        bytes: m.size,
        vision: Array.isArray(m.details?.families) ? m.details.families.some((f) => /clip|mllama|vision/i.test(f)) || undefined : undefined,
      },
    })).filter((m) => m.id && !/embed/i.test(m.id));
  }
  if (p.style === 'gemini') {
    return (json.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => ({ id: String(m.name).replace(/^models\//, ''), label: m.displayName || m.name, meta: { vision: true } }))
      .filter((m) => /gemini/i.test(m.id) && !/embedding|aqa|imagen|tts|image-generation/i.test(m.id));
  }
  const data = Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
  return data.map((m) => ({
    id: m.id,
    label: m.display_name || m.name || m.id,
    meta: {
      vision: Array.isArray(m.architecture?.input_modalities) ? m.architecture.input_modalities.includes('image') : undefined,
      context: m.context_length || m.context_window || undefined,
      created: createdAt(m),
    },
  })).filter((m) => m.id && !NOT_CHAT.test(m.id));
}

// Models a service lists that do not answer a chat request: embeddings,
// speech, pictures, moderation, and the old completion models (named with a
// three-digit revision, such as "-002"). A model that answers only another
// request shape is told apart by the service's own refusal instead
// (describeFailure in request.js).
const NOT_CHAT = /embed|whisper|tts|dall-e|moderation|rerank|transcribe|audio|realtime|image|guard|-00\d$|-instruct|sora|deep-research|computer-use|search-preview/i;

// When a model was published, in seconds, from the field each service uses.
function createdAt(m) {
  if (Number.isFinite(m.created)) return m.created;
  const t = Date.parse(m.created_at || '');
  return Number.isFinite(t) ? t / 1000 : undefined;
}

// Newest first where the service says when each model came out, which puts
// the current models at the top; by name otherwise.
export function sortModels(list) {
  const dated = list.length && list.every((m) => Number.isFinite(m.meta?.created));
  return [...list].sort((a, b) => (dated ? b.meta.created - a.meta.created : 0) || a.label.localeCompare(b.label));
}

// The model to start with when none is chosen: the first of the service's
// recommended ones it offers, or else the first of its list.
export function defaultModel(providerId, list) {
  const p = PROVIDERS[providerId];
  const ids = new Set(list.map((m) => m.id));
  return (p?.fallbackModels || []).find((id) => ids.has(id)) || list[0]?.id || '';
}

// Headers and address for listing a service's models.
export function modelsRequest(providerId, key, base) {
  const p = PROVIDERS[providerId];
  if (!p) throw new Error(`Unknown model service: ${providerId}`);
  const headers = {};
  if (p.style === 'anthropic') {
    headers['x-api-key'] = key || '';
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  } else if (p.style === 'gemini') headers['x-goog-api-key'] = key || '';
  else if (p.kind === 'cloud') headers.Authorization = `Bearer ${key || ''}`;
  return { url: (base || p.base) + p.modelsPath, init: { method: 'GET', headers } };
}
