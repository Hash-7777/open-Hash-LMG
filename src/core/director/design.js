// Designing and revising a scene plan a few scenes at a time.
//
// A model asked to redesign a whole film in one answer writes a very long
// answer, and a model that thinks before it answers can spend all of its room
// thinking about it and give back nothing: the film then keeps none of that
// work, and every token spent is lost. Asked a few scenes at a time, each
// answer is short, a part that fails keeps the rule-made scenes it covered,
// and a revision sends only the scenes the checks named.
//
// Every part is sent the same system text, brief and film outline first, so a
// service that keeps the start of a request it has seen before reads that
// part once. What the model is shown of a plan is compacted: empty values are
// left out and numbers rounded, which leaves the plan the same and the
// request smaller.

import { sceneForModel } from './scene-io.js';

export const PART_SIZE = 5;

// A value with empty parts left out and numbers rounded to three places.
export function compact(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : v;
  if (Array.isArray(v)) return v.map(compact);
  if (!v || typeof v !== 'object') return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (x === null || x === undefined || x === '') continue;
    if (Array.isArray(x) && !x.length) continue;
    if (typeof x === 'object' && !Array.isArray(x) && !Object.keys(x).length) continue;
    out[k] = compact(x);
  }
  return out;
}

// Scenes in runs of at most `size`, the last run never left with one alone.
export function partsOf(list, size = PART_SIZE) {
  const n = Math.max(1, Math.ceil(list.length / size));
  const each = Math.ceil(list.length / n);
  const out = [];
  for (let i = 0; i < list.length; i += each) out.push(list.slice(i, i + each));
  return out;
}

// The whole film in one line a scene, for the model to see where its part sits.
export function outline(scene) {
  return (scene.scenes || []).map((S, i) => `${i + 1}. ${S.id}, ${S.name || 'scene'}, ${Number(S.duration).toFixed(1)} s${S.note ? `: ${S.note}` : ''}`).join('\n');
}

// The film's settings every part shares.
function filmOf(scene) {
  const m = sceneForModel(scene);
  return compact({ title: m.title, aspect: m.aspect, style: m.style, fps: m.fps, bpm: m.bpm, palette: m.palette, fonts: m.fonts, background: m.background, duration: m.duration });
}

// The scenes of one part as the model is shown them.
function partScenes(scene, ids) {
  const m = sceneForModel(scene);
  return compact(m.scenes.filter((S) => ids.includes(S.id)));
}

// Puts a part's answer in place of its scenes: each scene by its id, else the
// scene in the same place within the part. A scene the answer left out stays
// as it was.
export function mergePart(scenes, ids, answer) {
  const got = Array.isArray(answer?.scenes) ? answer.scenes.filter((S) => S && typeof S === 'object') : [];
  if (!got.length) return { scenes, used: 0 };
  let used = 0;
  const out = scenes.map((S) => {
    const at = ids.indexOf(S.id);
    if (at < 0) return S;
    const next = got.find((G) => G.id === S.id) || (got.length === ids.length ? got[at] : null);
    if (!next || !Array.isArray(next.layers)) return S;
    used++;
    return { ...next, id: S.id };
  });
  return { scenes: out, used };
}

// Asks for one part and returns the scenes with that part's answer in place.
// A part that cannot be read keeps its scenes and says so in a note.
async function onePart({ askJson, note, system, scenes, ids, content, purpose, part }) {
  let answer = null;
  try {
    answer = await askJson(system, content, { purpose, part });
  } catch (err) {
    if (err?.stopped) throw err;
    note(`Scenes ${part.from} to ${part.to}: ${String(err.message || err)} They keep the rule-made design.`);
    return scenes;
  }
  const { scenes: merged, used } = mergePart(scenes, ids, answer);
  if (!used) note(`Scenes ${part.from} to ${part.to} could not be read; they keep the rule-made design.`);
  return merged;
}

const head = (brief, storyboard, scene) => `Brief:\n${brief}\n\n${storyboard ? `Storyboard agreed:\n${JSON.stringify(compact(storyboard))}\n\n` : ''}The film:\n${JSON.stringify(filmOf(scene))}\n\nAll scenes, in order:\n${outline(scene)}`;

// Redesigns every scene, a part at a time. Returns the plan with each part's
// answer in place; the caller puts back what models are not shown and
// normalises it.
export async function designInParts({ askJson, note, system, brief, storyboard, draft, task }) {
  let scenes = draft.scenes;
  const parts = partsOf(draft.scenes.map((S) => S.id));
  let from = 1;
  for (const [i, ids] of parts.entries()) {
    const part = { index: i, of: parts.length, from, to: from + ids.length - 1 };
    const content = `${head(brief, storyboard, draft)}\n\nDesign scenes ${part.from} to ${part.to} of ${draft.scenes.length} now; the others are designed separately. The draft of these scenes, made by rule:\n${JSON.stringify(partScenes({ ...draft, scenes }, ids))}\n\n${task} Reply with JSON only: {"scenes": [these ${ids.length} scenes, with the same ids, in order]}.`;
    scenes = await onePart({ askJson, note, system, scenes, ids, content, purpose: 'plan part', part });
    from += ids.length;
  }
  return { ...draft, scenes };
}

// Sends back only the scenes the checks named, with their problems. Problems
// that name no scene are about the whole film: then every scene goes, still a
// part at a time.
export async function reviseInParts({ askJson, note, system, brief, scene, issues, task }) {
  const named = new Set(issues.map((i) => i.scene).filter(Boolean));
  const whole = issues.some((i) => !i.scene) || !named.size;
  const ids = scene.scenes.map((S) => S.id).filter((id) => whole || named.has(id));
  let scenes = scene.scenes;
  const parts = partsOf(ids);
  for (const [i, partIds] of parts.entries()) {
    const own = issues.filter((x) => !x.scene || partIds.includes(x.scene));
    const first = scene.scenes.findIndex((S) => S.id === partIds[0]) + 1;
    const part = { index: i, of: parts.length, from: first, to: first + partIds.length - 1 };
    const content = `${head(brief, null, scene)}\n\n${task(own)}\n\nThe scenes to change (ids ${partIds.join(', ')}):\n${JSON.stringify(partScenes({ ...scene, scenes }, partIds))}\n\nReply with JSON only: {"scenes": [these ${partIds.length} scenes, corrected, with the same ids, in order]}.`;
    scenes = await onePart({ askJson, note, system, scenes, ids: partIds, content, purpose: 'revise part', part });
  }
  return { ...scene, scenes };
}
