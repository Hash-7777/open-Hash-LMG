// Voices for narration.
//
// Two ways to speak a line:
//   - through the person's own Python install, for Chatterbox and Kokoro: the
//     app runs a fixed script it ships with that install's interpreter, on the
//     processor or the graphics chip as chosen (src-tauri/src/commands/voice.rs);
//   - by asking a speech service: any local server that answers the common
//     /v1/audio/speech request (Kokoro and Chatterbox both have such servers),
//     or OpenAI's voices in the cloud.
// Every way returns a WAV, which the app times word by word itself.

export const VOICE_ENGINES_INFO = {
  chatterbox: {
    label: 'Chatterbox (on this computer)',
    route: 'python',
    blurb: 'The most human-sounding open voice. Runs through your own Chatterbox install; about 5 GB, slower on the processor.',
    folderHint: 'The folder holding venv/ with chatterbox-tts installed (and hf/ for its model files, if you keep them there).',
    voices: [],
    acceptsReference: true,
  },
  kokoro: {
    label: 'Kokoro (on this computer)',
    route: 'python',
    blurb: 'A natural, light voice (about 420 MB). Runs through your own kokoro-onnx install.',
    folderHint: 'The folder holding .venv/ with kokoro-onnx installed and the files kokoro-v1.0.onnx and voices-v1.0.bin.',
    voices: ['af_heart', 'af_bella', 'af_nicole', 'am_michael', 'am_fenrir', 'am_puck', 'bf_emma', 'bf_isabella', 'bm_george', 'bm_fable'],
  },
  server: {
    label: 'Local speech server',
    route: 'http',
    blurb: 'Any server on this computer that answers /v1/audio/speech, such as a Kokoro or Chatterbox server.',
    defaultPort: 8880,
    voices: [],
  },
  openai: {
    label: 'OpenAI voices (cloud)',
    route: 'http',
    blurb: 'Uses your OpenAI key. Lines are sent to OpenAI to be spoken.',
    base: 'https://api.openai.com',
    model: 'gpt-4o-mini-tts',
    voices: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'],
  },
};

// The request for one line, for the http route.
export function speechRequest(engine, { text, voice, speed = 1, key = '', port, model, instructions }) {
  const info = VOICE_ENGINES_INFO[engine];
  if (!info || info.route !== 'http') throw new Error(`No speech request for ${engine}`);
  const headers = { 'Content-Type': 'application/json' };
  let base;
  if (engine === 'openai') { base = info.base; headers.Authorization = `Bearer ${key}`; }
  else {
    const p = Number(port) || info.defaultPort;
    base = `http://127.0.0.1:${p}`;
  }
  const body = {
    model: model || info.model || 'tts-1',
    input: String(text).slice(0, 4000),
    voice: voice || info.voices[0] || 'default',
    response_format: 'wav',
    speed: Math.min(2, Math.max(0.5, speed)),
    ...(instructions && engine === 'openai' ? { instructions } : {}),
  };
  return { url: `${base}/v1/audio/speech`, init: { method: 'POST', headers, body: JSON.stringify(body) } };
}

// What a line is called in the project's assets: the same words in the same
// voice reuse the same clip instead of being spoken again.
export function clipId(engine, voice, speed, text) {
  const s = `${engine}|${voice}|${speed}|${text}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `voice-${(h >>> 0).toString(36)}`;
}

// Respellings for the voice: {"LMG": "L M G"} makes a name sound right without
// changing the words on screen.
export function spoken(text, sayAs = {}) {
  let out = String(text);
  for (const [word, said] of Object.entries(sayAs).sort((a, b) => b[0].length - a[0].length)) {
    const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(?<![\\w.])${esc}(?![\\w])`, 'g'), said);
  }
  return out;
}
