// The film checks: what a motion designer would catch reviewing stills and
// timing, turned into rules a machine can apply to every plan.
//
// Each rule comes from docs/MOTION-RULES.md, where its source and weight are
// recorded. Issues carry a level (error, warn, info), a code, a plain sentence
// for the person, and where it applies. Many can be repaired without a model:
// autofix() applies those and says what it did.
//
// Timing rules read the document alone. Layout rules (off frame, outside the
// safe area, overlapping, contrast against what is really behind) need the
// boxes the renderer measured: pass them as `samples`, from the render worker in
// the app or from the stand-in canvas in the checks.

import { readingTime, wordCount, STYLE_PACKS, estimateSpeech } from './format.js';
import { entranceSpan, exitSpan } from '../engine/motion.js';
import { OVERSHOOT } from '../engine/ease.js';
import { contrast } from '../util/color.js';
import { normalizeScene } from './normalize.js';

const resolve = (doc, c) => (doc.palette[c] ? doc.palette[c] : c);

function allLayers(layers, out = []) {
  for (const L of layers) { out.push(L); if (L.layers) allLayers(L.layers, out); }
  return out;
}

// When the layer can be read in full: after its entrance, before its exit or the
// next scene's transition begins.
function readableSpan(doc, si, L) {
  const S = doc.scenes[si];
  const next = doc.scenes[si + 1];
  const ins = entranceSpan(L);
  const outs = exitSpan(L);
  let end = Math.min(L.until, outs.start);
  if (next && next.transition.kind !== 'cut') end = Math.min(end, S.duration - next.transition.duration);
  return { from: ins.end, to: end, length: end - ins.end };
}

// The moments worth looking at: in each scene, just after the last entrance
// settles, and in the middle of its hold.
// How far into its entrance the opening line already is on the first frame.
export const PREROLL = 0.4;

export function sampleTimes(doc) {
  const times = [];
  doc.scenes.forEach((S, si) => {
    const layers = allLayers(S.layers);
    const settled = Math.max(0.3, ...layers.map((L) => entranceSpan(L).end));
    const next = doc.scenes[si + 1];
    const lastClean = S.duration - (next && next.transition.kind !== 'cut' ? next.transition.duration : 0) - 0.05;
    // Never inside a transition: mid-push, both scenes are partly off the frame.
    const t1 = Math.min(Math.max(settled + 0.05, S.transition.duration + 0.05), lastClean);
    times.push(+(S.start + Math.max(0, t1)).toFixed(3));
    const t2 = (t1 + lastClean) / 2;
    if (lastClean - t1 > 1) times.push(+(S.start + t2).toFixed(3));
  });
  return [...new Set(times)].filter((t) => t <= doc.duration);
}

// Safe areas, as fractions of the frame: titles stay inside these.
export function safeArea(doc) {
  if (doc.height > doc.width) {
    // Phone video apps cover the top, the bottom and the right edge with their own buttons.
    return { left: 60 / 1080, right: 1 - 140 / 1080, top: 250 / 1920, bottom: 1 - 450 / 1920 };
  }
  return { left: 0.05, right: 0.95, top: 0.06, bottom: 0.94 };
}

export function lintScene(doc, opts = {}) {
  const issues = [];
  const add = (level, code, message, where = {}, fix = null) => issues.push({ level, code, message, ...where, fix });
  const vertical = doc.height > doc.width;

  if (!doc.scenes.length) add('error', 'empty-film', 'The film has no scenes yet.');

  // Transition families: two or three read as designed, more read as a template sampler.
  const kinds = new Set(doc.scenes.slice(1).map((S) => S.transition.kind).filter((k) => k !== 'cut'));
  if (kinds.size > 3) add('warn', 'transition-mix', `The film uses ${kinds.size} kinds of transition. Two or three, used consistently, read as designed.`, {}, { kind: 'unify-transitions' });

  // The first frame should already be moving.
  const first = doc.scenes[0];
  if (first) {
    const starts = allLayers(first.layers).map((L) => entranceSpan(L).start);
    if (starts.length && Math.min(...starts) > 0.4) add('warn', 'slow-open', 'Nothing moves in the opening moment. The first second decides whether people keep watching; start the first motion at once.', { scene: first.id }, { kind: 'open-at-zero', scene: first.id });
    // Frame one is a picture, not black: something is already part way in.
    const shown = allLayers(first.layers).some((L) => L.at <= 0 && (L.in.preset === 'none' || entranceSpan(L).start < 0));
    if (starts.length && !shown) add('warn', 'empty-open', 'The film opens on an empty frame. Open on a picture already forming: start the first line\u2019s entrance a moment before the film does.', { scene: first.id }, { kind: 'preroll', scene: first.id });
  }

  doc.scenes.forEach((S, si) => {
    const layers = allLayers(S.layers);
    if (!layers.length) add('error', 'empty-scene', `Scene ${si + 1} is empty.`, { scene: S.id });
    if (S.transition.duration > 1.2) add('info', 'slow-transition', `Scene ${si + 1} takes over a second to arrive. Transitions under about half a second keep the pace.`, { scene: S.id });
    const bg = resolve(doc, S.background ?? doc.background.color ?? 'bg');

    // Dead time: a stretch where nothing begins to move.
    const events = [0];
    for (const L of layers) {
      const ins = entranceSpan(L), outs = exitSpan(L);
      events.push(ins.start, ins.end);
      if (L.out.preset !== 'none') events.push(outs.start);
      if (L.hold !== 'none') events.push(ins.end + 0.1);
      if (L.type === 'counter') events.push(ins.start + L.count);
      for (const list of Object.values(L.keys || {})) for (const [kt] of list) events.push(kt);
    }
    const nextTr = doc.scenes[si + 1] && doc.scenes[si + 1].transition.kind !== 'cut' ? doc.scenes[si + 1].transition.duration : 0;
    events.push(S.duration - nextTr);
    events.sort((a, b) => a - b);
    // A hold spent reading is not dead time: the limit grows with the words on screen.
    const sceneWords = layers.filter((L) => L.type === 'text').reduce((n, L) => n + wordCount(L.text), 0);
    // A cut rounded up to the next beat adds up to one more beat, and the last
    // scene is an end card, which holds on purpose.
    const lastScene = si === doc.scenes.length - 1;
    const limit = Math.max(vertical ? 3 : 4, readingTime(sceneWords) + 0.5) + 60 / doc.bpm + (lastScene ? 2.5 : 0);
    for (let i = 1; i < events.length; i++) {
      if (events[i] - events[i - 1] > limit) {
        add('info', 'dead-time', `Scene ${si + 1} holds still for ${(events[i] - events[i - 1]).toFixed(1)} s. A new motion every few seconds holds attention; a second line or a change of shot would help.`, { scene: S.id }, { kind: 'add-camera', scene: S.id });
        break;
      }
    }

    // Too many things arriving at once.
    const starts = layers.filter((L) => L.in.preset !== 'none').map((L) => ({ id: L.id, t: entranceSpan(L).start })).sort((a, b) => a.t - b.t);
    for (let i = 0; i + 3 < starts.length + 0; i++) {
      if (starts[i + 3] && starts[i + 3].t - starts[i].t < 0.12) {
        add('info', 'crowded-entrance', `In scene ${si + 1}, four or more things arrive in the same instant. A short stagger lets the eye follow them.`, { scene: S.id }, { kind: 'stagger', scene: S.id });
        break;
      }
    }

    for (const L of layers) {
      for (const m of [L.in, L.out]) {
        if (typeof m.ease === 'string' && OVERSHOOT.has(m.ease)) {
          add('warn', 'overshoot', `"${L.text || L.id}" overshoots and settles back. Premium motion arrives without a bounce.`, { scene: S.id, layer: L.id }, { kind: 'calm-ease', scene: S.id, layer: L.id });
        }
      }
      if (L.type !== 'text' && L.type !== 'counter') continue;
      const size = L.size;
      const minSize = vertical ? 34 : 26;
      if (size < minSize) add('warn', 'small-text', `"${(L.text || '').slice(0, 40)}" is set at ${Math.round(size)}, too small to read on a phone. Use ${minSize} or more.`, { scene: S.id, layer: L.id }, { kind: 'grow-text', scene: S.id, layer: L.id, to: minSize });
      const fg = resolve(doc, L.color);
      const ratio = contrast(fg, bg);
      const need = size >= 48 ? 3 : 4.5;
      if (ratio < need) add('warn', 'contrast', `"${(L.text || L.id).slice(0, 40)}" is hard to see against its background (contrast ${ratio.toFixed(1)} to 1, needs ${need}).`, { scene: S.id, layer: L.id }, { kind: 'raise-contrast', scene: S.id, layer: L.id });
      if (L.type === 'text') {
        const words = wordCount(L.text);
        const span = readableSpan(doc, si, L);
        const need2 = readingTime(words);
        if (span.length < need2 * 0.9) {
          add('warn', 'read-time', `"${L.text.slice(0, 40)}" is readable for ${Math.max(0, span.length).toFixed(1)} s; ${words} words need about ${need2.toFixed(1)} s.`, { scene: S.id, layer: L.id }, { kind: 'extend-scene', scene: S.id, by: +(need2 - span.length).toFixed(2) });
        }
        if (words > 16) add('info', 'long-text', `"${L.text.slice(0, 40)}..." has ${words} words. Motion graphics read best at seven words or fewer on screen at once; split it across scenes.`, { scene: S.id, layer: L.id });
      }
    }
  });

  // Narration must finish before its scene hands over to the next.
  for (const line of doc.voice?.lines || []) {
    const si = doc.scenes.findIndex((S) => S.id === line.scene);
    if (si < 0) continue;
    const S = doc.scenes[si];
    const next = doc.scenes[si + 1];
    const clip = line.clip ? doc.assets[line.clip] : null;
    const spoken = clip ? clip.duration : estimateSpeech(wordCount(line.text));
    const room = S.duration - (next && next.transition.kind !== 'cut' ? next.transition.duration / 2 : 0) - line.at;
    if (spoken + 0.2 > room) {
      add(clip ? 'warn' : 'info', 'voice-overrun', clip
        ? `The narration for scene ${si + 1} runs ${(spoken + 0.2 - room).toFixed(1)} s past the scene.`
        : `The narration for scene ${si + 1} will probably run past the scene once it is spoken.`, { scene: S.id }, { kind: 'extend-scene', scene: S.id, by: +(spoken + 0.2 - room).toFixed(2) });
    }
  }

  // Layout rules, from measured boxes.
  const safe = safeArea(doc);
  const W = doc.width, H = doc.height;
  const where = new Map();
  doc.scenes.forEach((S) => allLayers(S.layers).forEach((L) => where.set(L.id, S.id)));
  const seen = new Set();
  for (const sample of opts.samples || []) {
    const texts = sample.boxes.filter((b) => b.kind === 'text' && b.alpha > 0.5 && b.tag);
    for (const b of sample.boxes) {
      if (!b.tag || b.alpha < 0.5) continue;
      const key = (code) => `${code}:${b.tag}`;
      const out = b.x < -0.01 * W || b.y < -0.01 * H || b.x + b.w > 1.01 * W || b.y + b.h > 1.01 * H;
      if (out && b.kind === 'text' && !seen.has(key('off-frame'))) {
        seen.add(key('off-frame'));
        add('error', 'off-frame', `"${(b.text || b.tag).slice(0, 40)}" runs off the edge of the frame at ${sample.t.toFixed(1)} s.`, { scene: where.get(b.tag), layer: b.tag, t: sample.t }, { kind: 'fit-frame', layer: b.tag, scene: where.get(b.tag) });
        continue;
      }
      const unsafe = b.x < safe.left * W - 1 || b.x + b.w > safe.right * W + 1 || b.y < safe.top * H - 1 || b.y + b.h > safe.bottom * H + 1;
      if (unsafe && b.kind === 'text' && !seen.has(key('safe'))) {
        seen.add(key('safe'));
        add('warn', 'safe-area', vertical
          ? `"${(b.text || b.tag).slice(0, 40)}" sits where phone apps put their own buttons and captions.`
          : `"${(b.text || b.tag).slice(0, 40)}" sits outside the title-safe area.`, { scene: where.get(b.tag), layer: b.tag, t: sample.t }, { kind: 'fit-safe', layer: b.tag, scene: where.get(b.tag) });
      }
    }
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], c = texts[j];
      if (a.tag === c.tag) continue;
      const ix = Math.max(0, Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x));
      const iy = Math.max(0, Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y));
      const small = Math.min(a.w * a.h, c.w * c.h) || 1;
      const k = `overlap:${[a.tag, c.tag].sort().join('+')}`;
      if ((ix * iy) / small > 0.12 && !seen.has(k)) {
        seen.add(k);
        add('warn', 'overlap', `"${(a.text || a.tag).slice(0, 30)}" and "${(c.text || c.tag).slice(0, 30)}" overlap at ${sample.t.toFixed(1)} s.`, { scene: where.get(c.tag), layer: c.tag, t: sample.t }, { kind: 'separate', layer: c.tag, other: a.tag, scene: where.get(c.tag) });
      }
    }
  }

  if (opts.targetDuration && doc.duration > 0) {
    const r = doc.duration / opts.targetDuration;
    if (r > 1.25 || r < 0.75) add('info', 'length', `The film runs ${doc.duration.toFixed(1)} s against the ${opts.targetDuration} s asked for.`);
  }

  const order = { error: 0, warn: 1, info: 2 };
  issues.sort((a, b) => order[a.level] - order[b.level]);
  return issues;
}

function findLayer(doc, id) {
  for (const S of doc.scenes) for (const L of allLayers(S.layers)) if (L.id === id) return { S, L };
  return null;
}

// Applies every repair that needs no judgement. Returns the repaired, normalized
// scene and a sentence for each change.
export function autofix(doc, issues) {
  const d = JSON.parse(JSON.stringify(doc));
  const applied = [];
  const byScene = (id) => d.scenes.find((S) => S.id === id);
  const extended = new Map();
  for (const is of issues) {
    const f = is.fix;
    if (!f) continue;
    if (f.kind === 'extend-scene') {
      const S = byScene(f.scene);
      if (!S) continue;
      const by = Math.max(extended.get(S.id) || 0, f.by);
      extended.set(S.id, by);
    } else if (f.kind === 'calm-ease') {
      const hit = findLayer(d, f.layer);
      if (!hit) continue;
      for (const m of [hit.L.in, hit.L.out]) if (typeof m.ease === 'string' && OVERSHOOT.has(m.ease)) m.ease = 'outExpo';
      applied.push(`Took the bounce out of "${(hit.L.text || hit.L.id).slice(0, 30)}".`);
    } else if (f.kind === 'grow-text') {
      const hit = findLayer(d, f.layer);
      if (!hit) continue;
      hit.L.size = f.to;
      applied.push(`Made "${(hit.L.text || '').slice(0, 30)}" large enough to read on a phone.`);
    } else if (f.kind === 'raise-contrast') {
      const hit = findLayer(d, f.layer);
      if (!hit) continue;
      const bg = resolve(d, hit.S.background ?? d.background.color ?? 'bg');
      const choices = ['ink', 'bg', 'accent', 'muted'].filter((c) => c !== hit.L.color);
      const best = choices.map((c) => ({ c, r: contrast(resolve(d, c), bg) })).sort((a, b) => b.r - a.r)[0];
      if (best) { hit.L.color = best.c; applied.push(`Changed the colour of "${(hit.L.text || '').slice(0, 30)}" so it stands out from its background.`); }
    } else if (f.kind === 'open-at-zero') {
      const S = byScene(f.scene);
      if (!S) continue;
      const layers = allLayers(S.layers);
      const firstStart = Math.min(...layers.map((L) => L.in.at ?? L.at));
      for (const L of layers) { L.at = Math.max(0, L.at - firstStart); if (L.in.at !== null && L.in.at !== undefined) L.in.at = Math.max(0, L.in.at - firstStart); }
      applied.push('Started the first motion on the first frame.');
    } else if (f.kind === 'preroll') {
      const S = byScene(f.scene);
      if (!S) continue;
      for (const L of S.layers) if (L.at <= 0 && L.in.preset !== 'none' && !(L.in.at < 0)) L.in.at = -PREROLL;
      applied.push('Opened the film on a picture already forming instead of an empty frame.');
    } else if (f.kind === 'stagger') {
      const S = byScene(f.scene);
      if (!S) continue;
      const ls = S.layers.filter((L) => L.in.preset !== 'none').sort((a, b) => (a.in.at ?? a.at) - (b.in.at ?? b.at));
      ls.forEach((L, i) => { L.at = +(L.at + i * 0.12).toFixed(3); if (L.in.at !== null && L.in.at !== undefined) L.in.at = +(L.in.at + i * 0.12).toFixed(3); });
      applied.push(`Staggered the arrivals in scene ${d.scenes.indexOf(S) + 1}.`);
    } else if (f.kind === 'fit-frame' || f.kind === 'fit-safe') {
      const hit = findLayer(d, f.layer);
      if (!hit || hit.L.type !== 'text') continue;
      const safe = safeArea(d);
      hit.L.size = Math.max(24, Math.round(hit.L.size * (f.kind === 'fit-frame' ? 0.8 : 0.9)));
      hit.L.maxWidth = Math.min(hit.L.maxWidth, +(safe.right - safe.left).toFixed(3));
      hit.L.x = Math.min(safe.right - 0.02, Math.max(safe.left + 0.02, hit.L.x));
      hit.L.y = Math.min(safe.bottom - 0.04, Math.max(safe.top + 0.04, hit.L.y));
      applied.push(`Brought "${(hit.L.text || '').slice(0, 30)}" inside the ${f.kind === 'fit-frame' ? 'frame' : 'safe area'}.`);
    } else if (f.kind === 'separate') {
      const hit = findLayer(d, f.layer), other = findLayer(d, f.other);
      if (!hit || !other) continue;
      const dir = hit.L.y >= other.L.y ? 1 : -1;
      const u = Math.min(d.width, d.height) / 1080;
      const step = (((hit.L.size || 60) + (other.L.size || 60)) * 0.6 * u) / d.height;
      hit.L.y = +Math.min(0.92, Math.max(0.08, hit.L.y + dir * step)).toFixed(4);
      applied.push(`Moved "${(hit.L.text || '').slice(0, 30)}" so it no longer covers "${(other.L.text || '').slice(0, 30)}".`);
    } else if (f.kind === 'add-camera') {
      const S = byScene(f.scene);
      if (!S || S.camera.zoom[0] !== S.camera.zoom[1]) continue;
      S.camera.zoom = [1, 1.05];
      applied.push(`Added a slow camera push to scene ${d.scenes.indexOf(S) + 1}.`);
    } else if (f.kind === 'unify-transitions') {
      const pack = STYLE_PACKS[d.style] || STYLE_PACKS.studio;
      d.scenes.slice(1).forEach((S, i) => { if (S.transition.kind !== 'cut') S.transition.kind = pack.transitions[i % pack.transitions.length]; });
      applied.push('Brought the transitions down to the style\'s own two or three.');
    }
  }
  for (const [id, by] of extended) {
    const S = byScene(id);
    S.duration = +(S.duration + by + 0.1).toFixed(3);
    for (const L of allLayers(S.layers)) if (L.until >= S.duration - by - 0.11) L.until = S.duration;
    applied.push(`Held scene ${d.scenes.indexOf(S) + 1} longer so its words can be read.`);
  }
  return { scene: normalizeScene(d).scene, applied };
}
