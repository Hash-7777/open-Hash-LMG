// What a new film takes from the one it replaces: the person's own pictures,
// clips and sounds, listed for the model, shown to a model that can see as
// small pictures, and a song chosen as the music kept as the music.

import { mediaList, keptAssets } from '../core/scene/media.js';

// A picture as a JPEG data address no longer than `side` on its long side,
// small enough to send to a model.
async function preview(dataUrl, side = 768) {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const c = new OffscreenCanvas(w, h);
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const out = await c.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
    return await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(out); });
  } catch { return null; }
}

// { assets, media, mediaImages, music } for director.make.
export async function mediaFor(scene, { vision = false } = {}) {
  const assets = keptAssets(scene.assets);
  const media = mediaList(assets);
  const mediaImages = vision ? (await Promise.all(media.filter((m) => m.kind === 'image').slice(0, 4).map((m) => preview(assets[m.key].data)))).filter(Boolean) : [];
  const music = (scene.sound?.clips || []).filter((c) => assets[c.asset]?.kind === 'sound');
  return { assets, media, mediaImages, music };
}

// A song the person chose stays the film's music, fitted to the new length.
export function withMusic(scene, music) {
  if (!music.length) return scene;
  return { ...scene, sound: { ...scene.sound, score: 'none', clips: [...(scene.sound.clips || []).filter((c) => scene.assets[c.asset]?.kind !== 'sound'), ...music.map((c) => ({ ...c, length: Math.min(c.length || scene.duration, scene.duration) }))] } };
}
