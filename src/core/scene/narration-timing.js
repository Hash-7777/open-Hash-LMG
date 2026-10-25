// Narration as one spoken script laid over the film, not a line squeezed
// into each scene's box.
//
// A scene held still until its own line has been said is the weird stop
// viewers notice: the words land in a second, then nothing moves while the
// voice catches up. Here each line starts in its own scene, after the line
// before it and a breath, and may run on into the next scene for a moment, as
// a narrator speaks over a cut. Only a line that would run on too far
// lengthens its scene, by just what it needs.
//
// placeNarration works on a normalised scene document in place: it sets each
// line's `at`, lengthens the scenes that must hold longer (carrying layers
// that held to the old end along to the new one) and recomputes every start.

// Where a line starts, at the earliest, after its scene does.
export const LEAD = 0.15;
// The pause between one line and the next.
export const BREATH = 0.25;
// How far a line may run on into the next scene.
export const SPILL = 1.1;
// What the film keeps after its last line.
export const TAIL = 0.4;

// Start times from durations, as normalizeScene works them out.
export function sceneStarts(scenes) {
  let t = 0;
  return scenes.map((S, i) => {
    const start = i === 0 ? 0 : Math.max(0, t - (S.transition?.duration || 0));
    t = start + S.duration;
    return start;
  });
}

// A longer scene keeps its ending: layers that held to the old end hold to
// the new one, and exits timed to the change into the next scene (from
// `handover` seconds before the end) move with it.
function lengthen(S, by, handover = 0) {
  const old = S.duration;
  S.duration = +(old + by).toFixed(3);
  const walk = (layers) => {
    for (const L of layers || []) {
      if (Number.isFinite(L.until) && L.until >= old - 0.011) L.until = S.duration;
      if (L.out && Number.isFinite(L.out.at) && L.out.at >= old - handover - 0.011) L.out.at = +(L.out.at + by).toFixed(3);
      walk(L.layers);
    }
  };
  walk(S.layers);
}

// lengthOf(line) -> seconds the line takes to say (its clip, or an estimate).
// Returns { grown: [{ scene, by }], moved: number of lines whose start changed }.
export function placeNarration(doc, lengthOf) {
  const scenes = doc.scenes || [];
  const lines = doc.voice?.lines || [];
  const index = new Map(scenes.map((S, i) => [S.id, i]));
  const order = lines.filter((l) => index.has(l.scene)).sort((a, b) => index.get(a.scene) - index.get(b.scene) || a.at - b.at);
  const grown = [];
  let moved = 0;
  let starts = sceneStarts(scenes);
  let prevEnd = -Infinity;
  for (const line of order) {
    const i = index.get(line.scene);
    const S = scenes[i];
    const len = Math.max(0, Number(lengthOf(line)) || 0);
    const t = Math.max(starts[i] + LEAD, prevEnd + BREATH);
    const at = +(t - starts[i]).toFixed(3);
    if (Math.abs(at - line.at) > 0.001) moved++;
    line.at = at;
    const next = scenes[i + 1];
    const limit = next ? starts[i + 1] + SPILL : starts[i] + S.duration - TAIL;
    const end = t + len;
    if (end > limit + 0.001) {
      const by = +(end - limit).toFixed(3);
      lengthen(S, by, next ? next.transition?.duration || 0 : 0);
      grown.push({ scene: S.id, by });
      starts = sceneStarts(scenes);
    }
    prevEnd = end;
  }
  scenes.forEach((S, i) => { S.start = +starts[i].toFixed(4); });
  if (scenes.length) doc.duration = +(starts.at(-1) + scenes.at(-1).duration).toFixed(4);
  return { grown, moved };
}
