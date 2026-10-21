// What the director passes between a scene and a model: the scene as a model
// is shown it, what is put back after a model rewrites it, and how a laid-out
// storyboard is scored against another.

// What a model is shown of a scene: everything but the media bytes.
export function sceneForModel(scene) {
  const { assets, ...rest } = scene;
  const listed = Object.fromEntries(Object.entries(assets || {}).filter(([, a]) => a.kind === 'image').map(([id, a]) => [id, { kind: a.kind, name: a.name }]));
  return { ...rest, assets: listed, voice: { ...scene.voice, lines: (scene.voice?.lines || []).map(({ clip, ...l }) => l) } };
}

// Puts back what the model is not shown: media, clips, and the narration the
// film was planned around if a redesign dropped it.
export function restore(next, prev) {
  const doc = { ...next, assets: { ...(prev.assets || {}) } };
  const lines = next.voice?.lines?.length ? next.voice.lines : prev.voice?.lines || [];
  const ids = new Set((next.scenes || []).map((S, i) => S.id || `scene-${i + 1}`));
  const prevIds = (prev.scenes || []).map((S) => S.id);
  const nextIds = (next.scenes || []).map((S, i) => S.id || `scene-${i + 1}`);
  doc.voice = {
    ...(prev.voice || {}),
    ...(next.voice || {}),
    engine: prev.voice?.engine ?? next.voice?.engine,
    lines: lines.map((l) => {
      const prevLine = (prev.voice?.lines || []).find((p) => p.scene === l.scene && p.text === l.text);
      // A redesign that renamed scenes keeps each line on the scene in the same place.
      const scene = ids.has(l.scene) ? l.scene : nextIds[prevIds.indexOf(l.scene)] ?? l.scene;
      return { ...l, scene, clip: prevLine?.clip ?? null };
    }),
  };
  return doc;
}

// How far a laid-out storyboard is from good: its problems by weight, and how
// far it runs from the length asked for. Lower is better.
export function draftScore(scene, issues, seconds) {
  const weight = { error: 10, warn: 3, info: 1 };
  let s = issues.reduce((n, i) => n + (weight[i.level] || 0), 0);
  if (seconds) s += (Math.abs(scene.duration - seconds) / seconds) * 10;
  return s;
}
