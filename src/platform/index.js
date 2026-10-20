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

// ---- system services -----------------------------------------------------

// AAC through the operating system's own encoder, for web views that cannot
// encode sound themselves. Returns ADTS bytes, or null where there is none.
export async function encodeAacNative(wavBytes) {
  if (!isApp) return null;
  const out = await invoke('aac_encode', wavBytes);
  return out ? new Uint8Array(out) : null;
}

// Opens a web address in the system's browser; the app window only ever
// shows the app.
export function openExternal(url) {
  let u;
  try { u = new URL(url); } catch { return; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return;
  if (isApp) invoke('plugin:opener|open_url', { url: u.href }).catch(() => {});
  else window.open(u.href, '_blank', 'noopener');
}
