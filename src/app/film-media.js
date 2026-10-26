// What a new film takes from the one it replaces: the person's own pictures,
// clips and sounds, listed for the model, shown to a model that can see as
// small pictures, and a song chosen as the music kept as the music.

import { mediaList, keptAssets } from '../core/scene/media.js';
import { base64ToBytes } from '../core/audio/wav.js';

// A picture as a JPEG data address no longer than `side` on its long side,
// small enough to send to a model.
export async function previewPicture(dataUrl, side = 768) {
  const blob = await smallPicture(dataUrl, side);
  if (!blob) return null;
  try {
    return await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(blob); });
  } catch { return null; }
}

// A picture as a JPEG no longer than `side`, or null. Read from its own bytes:
// the content policy lets the page fetch only the services it names.
async function smallPicture(dataUrl, side) {
  try {
    const [head, body] = String(dataUrl).split(',');
    const blob = new Blob([base64ToBytes(body)], { type: head.slice(5).split(';')[0] });
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const c = new OffscreenCanvas(w, h);
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close();
    return await c.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
  } catch { return null; }
}

// Small copies of pictures for tiles and lists, made once per picture and
// shared. An <img> showing the picture itself decodes it whole: a few large
// screenshots shown that way hold more memory than the rest of the editor.
const thumbs = new Map();
export function showThumb(img, key, dataUrl, side = 360) {
  const id = `${key}:${String(dataUrl).length}:${side}`;
  if (!thumbs.has(id)) thumbs.set(id, smallPicture(dataUrl, side).then((b) => (b ? URL.createObjectURL(b) : '')));
  thumbs.get(id).then((url) => { if (url) img.src = url; });
  return img;
}

// { assets, media, mediaImages, music } for director.make.
export async function mediaFor(scene, { vision = false } = {}) {
  const assets = keptAssets(scene.assets);
  const media = mediaList(assets);
  const mediaImages = vision ? (await Promise.all(media.filter((m) => m.kind === 'image').slice(0, 4).map((m) => previewPicture(assets[m.key].data)))).filter(Boolean) : [];
  const music = (scene.sound?.clips || []).filter((c) => assets[c.asset]?.kind === 'sound');
  return { assets, media, mediaImages, music };
}

// A song the person chose stays the film's music, fitted to the new length.
export function withMusic(scene, music) {
  if (!music.length) return scene;
  return { ...scene, sound: { ...scene.sound, score: 'none', clips: [...(scene.sound.clips || []).filter((c) => scene.assets[c.asset]?.kind !== 'sound'), ...music.map((c) => ({ ...c, length: Math.min(c.length || scene.duration, scene.duration) }))] } };
}
