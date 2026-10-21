// The size and frame rate an export is drawn at, from the film's own and the
// choices made: a short side in pixels and frames a second, 0 for the film's
// own. Sides are even, as video encoders need, and stay within 4K.

export function exportSize(scene, shortSide = 0) {
  if (!shortSide) return { width: scene.width, height: scene.height };
  const k = shortSide / Math.min(scene.width, scene.height);
  const even = (v) => Math.max(16, Math.round((v * k) / 2) * 2);
  let width = even(scene.width), height = even(scene.height);
  const over = Math.max(width / 4096, height / 4096, (width * height) / (4096 * 2304));
  if (over > 1) { width = Math.round(width / Math.sqrt(over) / 2) * 2; height = Math.round(height / Math.sqrt(over) / 2) * 2; }
  return { width, height };
}

export function exportFps(scene, fps = 0) {
  return fps || scene.fps;
}

// A name for a short side, as people say it.
export function sizeLabel(shortSide) {
  return { 480: '480p', 720: '720p HD', 1080: '1080p Full HD', 1440: '1440p', 2160: '2160p 4K' }[shortSide] || 'The film’s own';
}
