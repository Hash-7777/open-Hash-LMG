// The names Hash LMG never writes: other apps, platforms, products and skills.
// One list, read by scripts/checks/no-names.mjs and by the commit-msg hook.

export const BARRED = [
  'hashcortx', 'hash cortx', 'hashmeter', 'hashnotch', 'hashcerebrum', 'barracudask',
  'product motion graphics', 'product_motion', 'motion graphics skill', 'workflow skill',
  'after effects', 'cavalry', 'jitter', 'motion canvas', 'remotion', 'hyperframes', 'theatre.js', 'lottie', 'bodymovin',
  'final cut', 'premiere', 'davinci', 'capcut', 'canva', 'figma', 'blender', 'cinema 4d', 'houdini', 'manim',
  'youtube', 'instagram', 'tiktok', 'reels', 'shorts', 'vimeo', 'twitter',
  'keynote', 'claude code', 'chatgpt', 'codex',
];
// Whole words only, so ordinary words that contain a name are not caught.
export const PATTERN = new RegExp(`\\b(${BARRED.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');


// Every barred name in a text, as [{ line, name }].
export function findNames(text) {
  const out = [];
  String(text).split('\n').forEach((l, i) => { const m = l.replace(/-apple-system/g, '').match(PATTERN); if (m) out.push({ line: i + 1, name: m[0] }); });
  return out;
}
