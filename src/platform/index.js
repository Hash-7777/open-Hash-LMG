// The one place the app meets the computer it runs on.
//
// The same page runs in two places: inside the desktop app (Tauri), and in a
// plain browser while it is being built and checked. Everything that differs
// between the two goes through here, and nothing else in src/ reaches for
// Tauri or for the browser's file handling directly.
//
// Every door into the desktop side is a named command written for one job
// (src-tauri/src/commands/). None of them takes a file path from the page:
// where a project is kept is fixed by the app, and where an export is written
// is chosen by the person in the system's own save dialog. A page driven by a
// model's output therefore has nothing in it to aim elsewhere.

const tauri = globalThis.__TAURI_INTERNALS__;

export const isApp = Boolean(tauri && typeof tauri.invoke === 'function');

export function invoke(cmd, args, options) {
  if (!isApp) return Promise.reject(new Error('This needs the desktop app.'));
  return tauri.invoke(cmd, args, options);
}

// Local storage, or a stand-in that forgets, when the page may not use it.
export const storage = (() => {
  try {
    const s = globalThis.localStorage;
    const probe = '__lmg_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  }
})();

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export function newProjectId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `film-${Date.now().toString(36)}-${rand}`;
}

// ---- projects ------------------------------------------------------------
//
// A project is one JSON text. The desktop app keeps each in its own file in
// the app's data folder; a browser keeps them in the page's own database.

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('hash-lmg', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('projects', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('The browser would not open its project store.'));
  });
}

async function idbDo(mode, fn) {
  const db = await idb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('projects', mode);
      const req = fn(tx.objectStore('projects'));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error || new Error('The project store refused the change.'));
    });
  } finally { db.close(); }
}

const checkId = (id) => { if (!ID.test(String(id))) throw new Error('That project name cannot be used.'); };

export const projects = {
  // [{ id, title, updated }], newest first.
  async list() {
    const rows = isApp ? await invoke('project_list') : (await idbDo('readonly', (s) => s.getAll())).map(({ id, title, updated }) => ({ id, title, updated }));
    return rows.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  },
  async read(id) {
    checkId(id);
    if (isApp) return invoke('project_read', { id });
    const row = await idbDo('readonly', (s) => s.get(id));
    if (!row) throw new Error('That project is not there any more.');
    return row.content;
  },
  async write(id, title, content) {
    checkId(id);
    if (isApp) return invoke('project_write', { id, title: String(title || 'Untitled film'), content });
    await idbDo('readwrite', (s) => s.put({ id, title: String(title || 'Untitled film'), updated: Date.now(), content }));
    return true;
  },
  async remove(id) {
    checkId(id);
    if (isApp) return invoke('project_delete', { id });
    await idbDo('readwrite', (s) => s.delete(id));
    return true;
  },
};

// ---- files in and out ----------------------------------------------------

// Saves bytes under a suggested name. In the desktop app the system's save
// dialog chooses the place, and the bytes travel in slices so a long film does
// not have to fit in one message. Returns false when the person cancels.
const SLICE = 8 * 1024 * 1024;
export async function saveFile(name, bytes, mime = 'application/octet-stream') {
  if (isApp) {
    const token = await invoke('export_begin', { name });
    if (!token) return false;
    try {
      for (let i = 0; i < bytes.length; i += SLICE) {
        await invoke('export_chunk', bytes.subarray(i, i + SLICE), { headers: { 'x-export-token': token } });
      }
      await invoke('export_end', { token, ok: true });
    } catch (err) {
      await invoke('export_end', { token, ok: false }).catch(() => {});
      throw err;
    }
    return true;
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return true;
}

// Asks for one file through the page's own file picker, which works the same
// in the desktop app and a browser. Resolves to a File, or null on cancel.
export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept || '';
    input.style.display = 'none';
    let done = false;
    const finish = (f) => { if (done) return; done = true; input.remove(); resolve(f); };
    input.addEventListener('change', () => finish(input.files && input.files[0] ? input.files[0] : null));
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}

// Asks for several files through the page's own picker. Resolves to Files.
export function pickFiles(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = accept || '';
    input.style.display = 'none';
    let done = false;
    const finish = (list) => { if (done) return; done = true; input.remove(); resolve(list); };
    input.addEventListener('change', () => finish([...(input.files || [])]));
    input.addEventListener('cancel', () => finish([]));
    document.body.appendChild(input);
    input.click();
  });
}

// ---- footage, pictures and sound ------------------------------------------
//
// In the desktop app, files are picked in the system's dialog and remembered
// by the app under an id (src-tauri/src/commands/media.rs), then read through
// its own address in pieces. In a browser they are picked with the page's own
// picker and kept for the session only.

const MEDIA_ID = /^[0-9a-f]{24}$/;
const sessionMedia = new Map(); // browser: id -> { url, file }
const hexId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
const kindOfFile = (f) => (f.type.startsWith('video/') ? 'video' : f.type.startsWith('image/') ? 'image' : f.type.startsWith('audio/') ? 'sound' : null);

export const media = {
  // [{ id, name, kind: video | image | sound, size, mime }]; empty when cancelled.
  async import() {
    if (isApp) return invoke('media_import');
    const files = await pickFiles('video/*,image/*,audio/*');
    return files.filter(kindOfFile).map((f) => {
      const id = hexId();
      sessionMedia.set(id, { url: URL.createObjectURL(f), file: f });
      return { id, name: f.name, kind: kindOfFile(f), size: f.size, mime: f.type };
    });
  },
  // The address the window reads a file at, or '' when it is not known here.
  url(id) {
    if (!MEDIA_ID.test(String(id))) return '';
    if (isApp) return /Windows/.test(navigator.userAgent) ? `http://lmgmedia.localhost/${id}` : `lmgmedia://localhost/${id}`;
    return sessionMedia.get(id)?.url || '';
  },
  // The whole file, for a picture carried in the film or sound to decode.
  async read(id) {
    if (!isApp) {
      const kept = sessionMedia.get(id);
      if (!kept) throw new Error('That file was imported in an earlier session; import it again.');
      return kept.file;
    }
    const res = await fetch(this.url(id));
    if (!res.ok) throw new Error('The file could not be read. It may have been moved or renamed.');
    return res.blob();
  },
};

// ---- model services, asked by the desktop side ------------------------------
//
// In the desktop app the page reaches no host on the internet itself. Cloud
// services, and model apps on this computer that refuse a web page, are asked
// by the desktop side (src-tauri/src/commands/relay.rs), which reaches only a
// fixed table of addresses and adds the key for the service itself; the
// answer streams back through a channel.

// A channel the desktop side sends messages down, delivered in order.
function channel(onmessage) {
  const pending = {};
  let next = 0, end = -1, id = 0;
  const done = () => tauri.unregisterCallback?.(id);
  id = tauri.transformCallback((raw) => {
    const i = raw.index;
    if ('end' in raw) { if (i === next) done(); else end = i; return; }
    if (i !== next) { pending[i] = raw.message; return; }
    onmessage(raw.message);
    next++;
    while (next in pending) { onmessage(pending[next]); delete pending[next]; next++; }
    if (next === end) done();
  });
  return { toJSON: () => `__CHANNEL__:${id}` };
}

// Every service asked through the desktop side in the app: all of them but
// Ollama, which the page asks on this computer directly.
export const RELAYED = new Set(['lmstudio', 'llamacpp', 'anthropic', 'openai', 'gemini', 'openrouter', 'groq', 'deepseek', 'mistral', 'xai', 'moonshot', 'together', 'fireworks', 'cerebras']);

// A fetch for one service that goes through the desktop side, answering with
// an ordinary Response whose body streams as the answer arrives.
function relayFetch(provider) {
  return (url, init = {}) => new Promise((resolve, reject) => {
    const u = new URL(url);
    const once = /:generateContent$/.test(u.pathname);
    const route = init.method === 'POST' ? (once ? 'chat-once' : 'chat') : 'models';
    // A service that names the model in its address: the name alone goes over.
    const model = decodeURIComponent((/\/models\/([^/:]+):/.exec(u.pathname) || [])[1] || '') || null;
    const requestId = `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const text = new TextEncoder();
    let started = false, body = null;
    const stream = new ReadableStream({ start(c) { body = c; }, cancel() { invoke('model_relay_cancel', { requestId }).catch(() => {}); } });
    const fail = (err) => { if (!started) reject(err); else { try { body.error(err); } catch { /* already closed */ } } };
    const onEvent = channel((ev) => {
      if (ev.kind === 'head') { started = true; resolve(new Response(stream, { status: ev.status, headers: { 'content-type': ev.mime || 'application/json' } })); }
      else if (ev.kind === 'chunk') body.enqueue(text.encode(ev.text));
      else if (ev.kind === 'end') { try { body.close(); } catch { /* already closed */ } }
      else if (ev.kind === 'fail') fail(new TypeError(ev.message));
    });
    init.signal?.addEventListener('abort', () => { invoke('model_relay_cancel', { requestId }).catch(() => {}); fail(new DOMException('Stopped.', 'AbortError')); });
    const port = Number(u.port) || null;
    invoke('model_relay', { provider, route, port, model, body: init.body ?? null, requestId, onEvent }).catch((err) => fail(new TypeError(err?.message || String(err))));
  });
}

// The fetch to ask a service with: through the desktop side where a page may
// not ask it, otherwise the page's own.
export function fetchFor(provider) {
  return isApp && RELAYED.has(provider) ? relayFetch(provider) : (u, i) => fetch(u, i);
}

// Keys for cloud services, kept by the desktop side (src-tauri/src/commands/keys.rs).
// The page hands a key over and gets back only which services have one, each
// with a hint such as "ends in 3456"; nothing returns a key. null in a
// browser, where Settings keeps keys in the page's own storage.
export const keyVault = isApp ? {
  status: () => invoke('keys_status'),
  set: (service, key) => invoke('key_set', { service, key }),
} : null;

// One line spoken by a cloud voice, through the desktop side, which adds the
// key: the request body in, the sound's bytes out.
export async function speakInCloud(provider, body) {
  const out = await invoke('speech_relay', { provider, body });
  return out instanceof Uint8Array ? out : new Uint8Array(out);
}

// ---- voices installed on this computer --------------------------------------
//
// Chatterbox and Kokoro, through the person's own install, whose folder the
// desktop side asks for and remembers (src-tauri/src/commands/voice.rs).
export const voices = {
  available: isApp,
  // { set, name, ready, missing: [what the folder lacks] }
  status: (engine) => invoke('voice_status', { engine }),
  pickFolder: (engine) => invoke('voice_folder', { engine }),
  async speak({ engine, text, voice = '', speed = 1, device = 'auto' }) {
    const out = await invoke('voice_speak', { engine, text, voice, speed, device });
    return out instanceof Uint8Array ? out : new Uint8Array(out);
  },
};

// ---- system services -----------------------------------------------------

// AAC through the operating system's own encoder, for web views that cannot
// encode sound themselves. Returns ADTS bytes, or null where there is none.
export async function encodeAacNative(wavBytes) {
  if (!isApp) return null;
  const out = await invoke('aac_encode', wavBytes);
  return out ? new Uint8Array(out) : null;
}

// The app's own encoders (src-tauri/src/commands/encode.rs), the same on every
// system: H.264 and GIF from raw RGBA frames, MP3 from stereo sound. Each
// call answers with bytes. Only in the desktop app.
const bytesOf = (out) => (out instanceof Uint8Array ? out : new Uint8Array(out));
export const nativeEncoder = {
  available: isApp,
  open: (kind, { width, height, fps, bitrate = 0, keyint = 60 }) => invoke('encoder_open', { kind, width, height, fps, bitrate, keyint }),
  frame: async (token, rgba, key = false) => bytesOf(await invoke('encoder_frame', rgba, { headers: { 'x-encoder': token, 'x-key': key ? '1' : '0' } })),
  close: async (token) => bytesOf(await invoke('encoder_close', { token })),
  async mp3(left, right, sampleRate) {
    const body = new Float32Array(left.length * 2);
    body.set(left, 0);
    body.set(right.subarray(0, left.length), left.length);
    const pcm = new Uint8Array(body.buffer);
    return bytesOf(await invoke('mp3_encode', pcm, { headers: { 'x-rate': String(sampleRate) } }));
  },
};

// Opens a web address in the system's browser; the app window only ever
// shows the app.
export function openExternal(url) {
  let u;
  try { u = new URL(url); } catch { return; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return;
  if (isApp) invoke('plugin:opener|open_url', { url: u.href }).catch(() => {});
  else window.open(u.href, '_blank', 'noopener');
}

// The app's version, from the desktop side; null in a browser.
export async function appVersion() {
  if (!isApp) return null;
  try { return await invoke('plugin:app|version'); } catch { return null; }
}
