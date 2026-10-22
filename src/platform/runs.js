// The run history, kept on this computer in the web view's own database (in
// the app's data folder in the desktop app). The newest runs are kept and the
// oldest let go. A run never holds a key: see src/core/director/run-record.js.

const DB = 'hash-lmg-runs';
const STORE = 'runs';
export const KEEP_RUNS = 60;

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('This window has no place to keep a history.')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('The history could not be opened.'));
  });
}

async function tx(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error || new Error('The history refused the change.'));
    });
  } finally { db.close(); }
}

export const runs = {
  // Newest first.
  async list() {
    const all = (await tx('readonly', (s) => s.getAll())) || [];
    return all.sort((a, b) => b.started - a.started);
  },
  async put(run) {
    // A record is copied whole, so later changes to the live object do not leak in.
    await tx('readwrite', (s) => s.put(JSON.parse(JSON.stringify(run))));
    const all = await this.list();
    for (const old of all.slice(KEEP_RUNS)) await tx('readwrite', (s) => s.delete(old.id));
  },
  clear: () => tx('readwrite', (s) => s.clear()),
};
