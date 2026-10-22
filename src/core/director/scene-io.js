// What the director passes between a scene and a model: the scene as a model
// is shown it, what is put back after a model rewrites it, and how a laid-out
// storyboard is scored against another.

// A drawn picture's path data is long and the model has nothing to change in
// it; it is shown this mark instead and given back by restore.
const KEPT = 'kept:';
const hidePaths = (layers) => (layers || []).map((L) => ({
  ...L,
  ...(L.shape === 'path' && typeof L.d === 'string' && L.d.length > 160 ? { d: `${KEPT}${L.id}` } : {}),
  ...(L.layers ? { layers: hidePaths(L.layers) } : {}),
}));

// What a model is shown of a scene: everything but the media bytes and the
// drawings' path data.
export function sceneForModel(scene) {
  const { assets, ...rest } = scene;
  const listed = Object.fromEntries(Object.entries(assets || {}).filter(([, a]) => a.kind === 'image').map(([id, a]) => [id, { kind: a.kind, name: a.name }]));
  return { ...rest, scenes: (scene.scenes || []).map((S) => ({ ...S, layers: hidePaths(S.layers) })), assets: listed, voice: { ...scene.voice, lines: (scene.voice?.lines || []).map(({ clip, ...l }) => l) } };
}

// Path data shown as a mark goes back from the scene it came from: the same
// scene id, else the scene in the same place.
function showPaths(nextScenes, prevScenes) {
  const flat = (list) => (list || []).flatMap((L) => [L, ...flat(L.layers)]);
  return (nextScenes || []).map((S, i) => {
    const from = (prevScenes || []).find((P) => P.id === S?.id) || prevScenes?.[i];
    const put = (layers) => (Array.isArray(layers) ? layers.map((L) => {
      if (!L || typeof L !== 'object') return L;
      let d = L.d;
      if (typeof d === 'string' && d.startsWith(KEPT)) d = flat(from?.layers).find((P) => P.id === d.slice(KEPT.length) && P.shape === 'path')?.d || '';
      return { ...L, ...(d !== L.d ? { d } : {}), ...(L.layers ? { layers: put(L.layers) } : {}) };
    }) : layers);
    return S && typeof S === 'object' ? { ...S, layers: put(S.layers) } : S;
  });
}

// Puts back what the model is not shown: media, clips, and the narration the
// film was planned around if a redesign dropped it.
export function restore(next, prev) {
  const doc = { ...next, scenes: showPaths(next.scenes, prev.scenes), assets: { ...(prev.assets || {}) } };
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

// A model rewriting a plan may drop the drawings of the brief's subject, the
// one thing in a film that shows what it is about. A rewritten scene that
// lost the drawing its earlier version had is put back as it was: the same
// scene id, else the scene in the same place. Returns { scene, kept, note },
// kept being how many scenes were put back; the caller normalises the result.
const drawn = (S) => (S?.layers || []).some((L) => L.shape === 'path' && /^picture/.test(L.id || ''));
export function keepDrawings(next, prev) {
  let kept = 0;
  const scenes = (next.scenes || []).map((S, i) => {
    const before = (prev.scenes || []).find((P) => P.id === S.id) || prev.scenes?.[i];
    if (!drawn(before) || drawn(S)) return S;
    kept++;
    return { ...before, id: S.id };
  });
  const note = kept ? `${kept === 1 ? 'One scene keeps its' : `${kept} scenes keep their`} drawing as the app laid ${kept === 1 ? 'it' : 'them'} out, since the redesign left ${kept === 1 ? 'it' : 'them'} out.` : '';
  return { scene: { ...next, scenes }, kept, note };
}

// How far a laid-out storyboard is from good: its problems by weight, and how
// far it runs from the length asked for. Lower is better.
export function draftScore(scene, issues, seconds) {
  const weight = { error: 10, warn: 3, info: 1 };
  let s = issues.reduce((n, i) => n + (weight[i.level] || 0), 0);
  if (seconds) s += (Math.abs(scene.duration - seconds) / seconds) * 10;
  return s;
}
