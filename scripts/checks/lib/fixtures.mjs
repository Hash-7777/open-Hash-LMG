// What several checks share: a storyboard with every kind of beat, written
// with invented words and numbers, and a way to measure where a scene (or
// model-written drawing code) puts things, on the stand-in canvas.

import { fakeContext } from './fake-canvas.mjs';
import { createKit } from '../../../src/core/engine/kit.js';
import { renderPlan } from '../../../src/core/engine/render-plan.js';

// Every beat kind, with invented words and numbers.
export const STORYBOARD = {
  title: 'Lumen Desk',
  beats: [
    { kind: 'hook', text: 'Your desk is *loud*.', say: 'Your desk is loud.' },
    { kind: 'statement', text: 'Lumen makes it calm', sub: 'one light, one place' },
    { kind: 'title', text: 'Lumen Desk', sub: 'The quiet workspace' },
    { kind: 'stat', value: 38, suffix: '%', sub: 'fewer interruptions in an invented trial' },
    { kind: 'list', text: 'What it does', items: ['Mutes the noise', 'Keeps your focus', 'Learns your day'] },
    { kind: 'steps', items: ['Plug it in', 'Pick a mood', 'Work'] },
    { kind: 'chart', text: 'Focus by week', values: [3, 5, 6, 9], labels: ['W1', 'W2', 'W3', 'W4'] },
    { kind: 'quote', text: 'The calmest hour of my day.', by: 'An invented tester' },
    { kind: 'compare', left: { label: 'Before', text: 'Twelve tabs' }, right: { label: 'After', text: 'One light' } },
    { kind: 'words', words: ['Calm', 'Clear', 'Yours'] },
    { kind: 'end', text: 'Lumen Desk', sub: 'lumen.example' },
  ],
};

export async function loadCode(code) {
  const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  return mod.default || mod.render;
}

export function measure(scene, times, render = null) {
  const ctx = fakeContext(scene.width, scene.height);
  const kit = createKit(ctx, { width: scene.width, height: scene.height, fps: scene.fps, bpm: scene.bpm, seed: scene.seed, palette: scene.palette, assets: {} });
  kit.duration = scene.duration;
  return times.map((t) => {
    const boxes = [];
    if (render) { kit.collectInto(boxes); try { render(t, kit); } finally { kit.collectInto(null); } } else renderPlan(kit, scene, t, { collect: boxes });
    return { t, boxes };
  });
}

