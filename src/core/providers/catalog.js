// Every model service the app can talk to, local first.
//
// A service is named by how it is asked (its "style": the request and reply
// shapes), where it lives, how its key is sent, whether it can be told to
// answer in JSON, and for a cloud service the page where its keys are made
// (keyUrl), which Settings opens in the system browser. Local services need no key and never leave the computer.
//
// The cloud hosts here and the connect-src list in src-tauri/tauri.conf.json
// must name the same places: scripts/checks/policy.mjs fails if they
// drift. A host the code calls that the policy does not list fails as an
// ordinary network error, which looks like a broken service for no visible
// reason. Local services may use any port on this computer, which the policy
// allows for 127.0.0.1 and localhost and nowhere else.

export const PROVIDERS = {
  // ---- on this computer ---------------------------------------------------
  ollama: {
    label: 'Ollama',
    kind: 'local',
    style: 'ollama',
    base: 'http://127.0.0.1:11434',
    chatPath: '/api/chat',
    modelsPath: '/api/tags',
    json: 'schema',
    help: 'Install Ollama, then pull a model, for example: ollama pull qwen2.5:7b',
  },
  lmstudio: {
    label: 'LM Studio',
    kind: 'local',
    style: 'openai',
    base: 'http://127.0.0.1:1234',
    chatPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
    json: 'schema',
    help: 'Open LM Studio, load a model, and start its local server from the Developer tab.',
  },
  llamacpp: {
    label: 'llama.cpp server',
    kind: 'local',
    style: 'openai',
    base: 'http://127.0.0.1:8080',
    chatPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
    json: 'object',
    help: 'Start llama-server with a model; it listens on port 8080 by default.',
  },

  // ---- in the cloud, with the person's own key ----------------------------
  anthropic: {
    label: 'Anthropic',
    kind: 'cloud',
    style: 'anthropic',
    base: 'https://api.anthropic.com',
    chatPath: '/v1/messages',
    modelsPath: '/v1/models',
    json: null,
    keyHint: 'console.anthropic.com, Settings, Keys',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    fallbackModels: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
  },
  openai: {
    label: 'OpenAI',
    kind: 'cloud',
    style: 'openai',
    base: 'https://api.openai.com',
    chatPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
    json: 'object',
    newTokenField: true,
    keyHint: 'platform.openai.com, Keys',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  gemini: {
    label: 'Google Gemini',
    kind: 'cloud',
    style: 'gemini',
    base: 'https://generativelanguage.googleapis.com',
    modelsPath: '/v1beta/models?pageSize=200',
    json: 'object',
    keyHint: 'aistudio.google.com, Get key',
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  openrouter: {
    label: 'OpenRouter',
    kind: 'cloud',
    style: 'openai',
    base: 'https://openrouter.ai',
    chatPath: '/api/v1/chat/completions',
    modelsPath: '/api/v1/models',
    json: 'object',
    // OpenRouter credits requests to an app by these; they are not credentials.
    extraHeaders: { 'X-Title': 'Hash LMG' },
    keyHint: 'openrouter.ai, Keys',
    keyUrl: 'https://openrouter.ai/settings/keys',
  },
  groq: {
    label: 'Groq',
    kind: 'cloud',
    style: 'openai',
    base: 'https://api.groq.com',
    chatPath: '/openai/v1/chat/completions',
    modelsPath: '/openai/v1/models',
    json: 'object',
    keyHint: 'console.groq.com, Keys',
    keyUrl: 'https://console.groq.com/keys',
  },
  deepseek: {
    label: 'DeepSeek',
    kind: 'cloud',
    style: 'openai',
    base: 'https://api.deepseek.com',
    chatPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
    json: 'object',
    keyHint: 'platform.deepseek.com, Keys',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  mistral: {
    label: 'Mistral',
    kind: 'cloud',
    style: 'openai',
    base: 'https://api.mistral.ai',
    chatPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
    json: 'object',
    keyHint: 'console.mistral.ai, Keys',
    keyUrl: 'https://console.mistral.ai/api-keys',
  },
  xai: {
    label: 'xAI',
    kind: 'cloud',
    style: 'openai',
    base: 'https://api.x.ai',
    chatPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
    json: 'object',
    keyHint: 'console.x.ai, Keys',
    keyUrl: 'https://console.x.ai',
  },
  moonshot: {
    label: 'Moonshot (Kimi)',
    kind: 'cloud',
    style: 'openai',
    base: 'https://api.moonshot.ai',
    chatPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
    json: 'object',
    keyHint: 'platform.moonshot.ai, Keys',
    keyUrl: 'https://platform.moonshot.ai/console/api-keys',
  },
  together: {
    label: 'Together AI',
    kind: 'cloud',
    style: 'openai',
    base: 'https://api.together.xyz',
    chatPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
    json: 'object',
    keyHint: 'api.together.ai, Settings, Keys',
    keyUrl: 'https://api.together.ai/settings/api-keys',
  },
  fireworks: {
    label: 'Fireworks AI',
    kind: 'cloud',
    style: 'openai',
    base: 'https://api.fireworks.ai',
    chatPath: '/inference/v1/chat/completions',
    modelsPath: '/inference/v1/models',
    json: 'object',
    keyHint: 'fireworks.ai, Settings, Keys',
    keyUrl: 'https://app.fireworks.ai/settings/users/api-keys',
  },
  cerebras: {
    label: 'Cerebras',
    kind: 'cloud',
    style: 'openai',
    base: 'https://api.cerebras.ai',
    chatPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
    json: 'object',
    keyHint: 'cloud.cerebras.ai, Keys',
    keyUrl: 'https://cloud.cerebras.ai',
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);
export const LOCAL_IDS = PROVIDER_IDS.filter((id) => PROVIDERS[id].kind === 'local');
export const CLOUD_IDS = PROVIDER_IDS.filter((id) => PROVIDERS[id].kind === 'cloud');

// Every origin the page reaches, for checking against the content policy.
export function allOrigins() {
  const out = new Set();
  for (const p of Object.values(PROVIDERS)) {
    out.add(new URL(p.base).origin);
    if (p.kind === 'local') out.add(new URL(p.base.replace('127.0.0.1', 'localhost')).origin);
  }
  return [...out];
}

// A local service's address may be changed in Settings, but only to another
// port on this computer: the content policy allows loopback addresses and
// nothing else.
export function localBase(id, port) {
  const p = PROVIDERS[id];
  if (!p || p.kind !== 'local') return null;
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return p.base;
  return `http://127.0.0.1:${n}`;
}
