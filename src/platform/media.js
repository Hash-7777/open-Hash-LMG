// Footage, pictures, sound and text files brought into a film, for the
// platform layer (src/platform/index.js re-exports it).
//
// In the desktop app files are chosen in the system's dialogs or dropped on
// the window, and remembered by the desktop side
// (src-tauri/src/commands/media.rs), which answers with ids; the window reads
// a file through the app's own address by id, in pieces. In a browser, files
// are picked with the page's own picker and kept for the session only.

import { isApp, invoke, pickFiles } from './index.js';

const tauri = globalThis.__TAURI_INTERNALS__;

const MEDIA_ID = /^[0-9a-f]{24}$/;
const sessionMedia = new Map(); // browser: id -> { url, file }

// Browser: files kept for the session, as import items.
function keepFiles(files) {
  return files.filter(kindOfFile).slice(0, 50).map((f) => {
    const id = hexId();
    sessionMedia.set(id, { url: URL.createObjectURL(f), file: f });
    return { id, name: f.name, kind: kindOfFile(f), size: f.size, mime: f.type };
  });
}
const hexId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
const kindOfFile = (f) => (f.type.startsWith('video/') ? 'video' : f.type.startsWith('image/') ? 'image' : f.type.startsWith('audio/') ? 'sound'
  : /\.(txt|md|markdown|csv|json)$/i.test(f.name) ? 'doc' : null);

export const media = {
  // [{ id, name, kind: video | image | sound | doc, size, mime }]; empty when cancelled.
  async import() {
    if (isApp) return invoke('media_import');
    return keepFiles(await pickFiles('video/*,image/*,audio/*,.txt,.md,.markdown,.csv,.json'));
  },
  // The files a film takes from inside a folder the person chooses.
  async importFolder() {
    if (isApp) return invoke('media_import_folder');
    return keepFiles(await pickFiles('', { folder: true }));
  },
  // Files dropped on the window. In the desktop app the drop is read by the
  // desktop side, which remembers the files and says only which ids it took;
  // in a browser the dropped files are kept for the session.
  //   onDrag(over: boolean), onDrop(items) as from import()
  onDrop({ onDrag, onDrop }) {
    if (isApp) {
      const listen = (event, fn) => invoke('plugin:event|listen', { event, target: { kind: 'Any' }, handler: tauri.transformCallback((e) => fn(e.payload)) }).catch(() => {});
      listen('media-drag', (over) => onDrag(Boolean(over)));
      listen('media-drop', (items) => onDrop(Array.isArray(items) ? items : []));
      return;
    }
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    let depth = 0;
    window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { depth++; onDrag(true); } });
    window.addEventListener('dragleave', (e) => { if (hasFiles(e) && --depth <= 0) { depth = 0; onDrag(false); } });
    window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      onDrag(false);
      onDrop(keepFiles([...e.dataTransfer.files]));
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

