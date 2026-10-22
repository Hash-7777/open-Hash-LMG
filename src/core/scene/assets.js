// A film's assets: pictures and spoken clips carried inside the project as
// data, so a project file is complete on its own, and footage and sound files
// that stay where they are on this computer, named by the app's id for them.

import { isObj, num, str, slug } from './values.js';

export function normAssets(input) {
  const assets = {};
  const assetsIn = isObj(input) ? input : {};
  for (const [id, a] of Object.entries(assetsIn).slice(0, 200)) {
    const key = slug(id);
    if (!key || !isObj(a)) continue;
    // Footage and sound files stay where they are on this computer and are
    // named by the id the app keeps them under (src-tauri/src/commands/media.rs).
    if ((a.kind === 'video' || a.kind === 'sound') && typeof a.media === 'string' && /^[0-9a-f]{24}$/.test(a.media)) {
      assets[key] = {
        kind: a.kind, name: str(a.name, key, 200), media: a.media,
        duration: num(a.duration, 0, 0, 100000),
        ...(a.kind === 'video' ? { width: num(a.width, 0, 0, 20000), height: num(a.height, 0, 0, 20000), audio: a.audio === undefined ? true : Boolean(a.audio) } : {}),
      };
      continue;
    }
    if (typeof a.data !== 'string') continue;
    if (/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/.test(a.data)) {
      assets[key] = { kind: 'image', name: str(a.name, key, 120), data: a.data, width: num(a.width, 0, 0, 20000), height: num(a.height, 0, 0, 20000) };
    } else if (/^data:audio\/(wav|x-wav|wave);base64,/.test(a.data)) {
      assets[key] = {
        kind: 'audio', name: str(a.name, key, 120), data: a.data,
        duration: num(a.duration, 0, 0, 600),
        words: (Array.isArray(a.words) ? a.words : []).filter((w) => Array.isArray(w) && w.length >= 3)
          .slice(0, 2000).map((w) => [str(w[0], '', 60), num(w[1], 0, 0, 600), num(w[2], 0, 0, 600)]),
        text: str(a.text, '', 400),
        voice: str(a.voice, '', 200),
      };
    }
  }
  return assets;
}
