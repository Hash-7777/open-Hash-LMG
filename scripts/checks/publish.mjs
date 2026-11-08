// What goes out with a product film: chapters a video site can read (the
// first at 0:00, none shorter than ten seconds), a description built from the
// storyboard and facts alone, tags, and a thumbnail drawn by the stage with
// no plane over any of its words.

import { section, ok, claim, done } from './lib/check.mjs';
import assert from 'node:assert/strict';
import { fakeContext } from './lib/fake-canvas.mjs';
import { STORYBOARD } from './lib/fixtures.mjs';
import { chapters, description, tags, thumbnailDoc, THUMB_AT, MIN_CHAPTER, clock } from '../../src/core/scene/publish-kit.js';
import { normalizeBoard, claimsIn, factTokens } from '../../src/core/scene/product-board.js';
import { normalizeScene } from '../../src/core/scene/normalize.js';
import { compileStoryboard } from '../../src/core/scene/compile.js';
import { createKit } from '../../src/core/engine/kit.js';
import { renderStage } from '../../src/core/engine/render-stage.js';
import { renderPlan, activeScenes } from '../../src/core/engine/render-plan.js';
import { coveredWords, coplanarPairs } from '../../src/core/engine/stage-rules.js';

const FACTS = { name: 'Orbi Desk', looks: ['Calm', 'Bright', 'Night'], modes: 3, links: [{ label: 'Get it', url: 'https://orbi.example/get' }, { label: 'Unsafe', url: 'http://orbi.example' }], kind: 'desk lamp', tags: ['quiet light'] };
const BOARD = normalizeBoard({
  name: 'Orbi Desk', expansion: '', tagline: 'Quiet light, all day.',
  steps: [{ name: 'Plan' }, { name: 'Light' }, { name: 'Rest' }],
  split: { left: { title: 'You', items: [{ label: 'Choose' }] }, right: { title: 'The lamp', items: [{ label: 'Dims' }] } },
  figures: [{ value: '3', cap: 'Looks' }], yours: [{ cap: 'On your desk', icon: 'computer' }],
  lines: { open: 'Every desk deserves good light.', brief: 'Tell it what the room is for.', make: 'It sets the light.', release: 'Orbi Desk is out now.' },
});
const PARTS = [['open', 0], ['name', 6], ['brief', 12.6], ['make', 21.8], ['steps', 30.6], ['lift', 44.8], ['split', 53.4], ['hands', 62.4], ['export', 74.4], ['hub', 83.4], ['ring', 97.8], ['drawings', 106.2], ['figures', 114], ['end', 123.6]].map(([key, t0]) => ({ key, t0 }));

section('Chapters');
const C = chapters(PARTS, BOARD, 137.6);
const at = C.map((c) => { const [m, s] = c.split(' ')[0].split(':').map(Number); return m * 60 + s; });
ok('the first chapter is at 0:00', C[0].startsWith('0:00 '));
ok('no chapter is shorter than the least a video site reads', at.every((t, i) => (at[i + 1] ?? 137.6) - t >= MIN_CHAPTER));
ok('a short part joins the one before it, by name', C.some((c) => /Tell it what you want, watch it build/.test(c)));
ok('titles carry no trailing stops', C.every((c) => !/\.$/.test(c)));
ok('times read as minutes and seconds', clock(75.9) === '1:15' && clock(5) === '0:05');

section('Description and tags');
const D = description(BOARD, FACTS, { footnote: 'Filmed with invented footage.', version: '2.0' });
ok('it opens with the name, version and tagline', D.split('\n')[0] === 'Orbi Desk 2.0: Quiet light, all day.');
ok('it lists what is inside from the storyboard', /What is inside:/.test(D) && /- Three steps: Plan, Light, Rest\./.test(D) && /- 3 Looks\./.test(D));
ok('it carries only secure links from the facts', /Get it: https:\/\/orbi\.example\/get/.test(D) && !/http:\/\//.test(D));
ok('it ends with what in the film was real', D.endsWith('Filmed with invented footage.'));
ok('it claims nothing the facts do not hold', claimsIn(D.replace(/https?:\S+/g, '')).every((c) => factTokens(FACTS).has(c) || c === '2.0'));
ok('tags are the name, the kind and the facts\' own, once each', JSON.stringify(tags(BOARD, FACTS)) === JSON.stringify(['Orbi Desk', 'quiet light', 'desk lamp', 'launch film', 'product video']));

section('The thumbnail');
const film = compileStoryboard(STORYBOARD, { style: 'studio' }).scene;
const input = thumbnailDoc({ board: { ...BOARD, expansion: 'Orbital Desk' }, film, icon: 'mark', palette: { accent: '#3f7be9', accent2: '#d9b26a' } });
const doc = normalizeScene({ ...input, assets: { mark: { kind: 'image', name: 'Invented mark', data: 'data:image/png;base64,iVBORw0KGgo=' } } }).scene;
ok('the thumbnail film keeps every part and field', doc.stage.parts.map((p) => p.kind).join() === 'icon,thumb,lift' && JSON.stringify(normalizeScene(doc).scene) === JSON.stringify(doc));
ok('its words keep their name, capitals and two tagline lines', (() => { const p = doc.stage.parts.find((q) => q.kind === 'thumb'); return p.name === 'Orbi Desk' && p.expansion === 'Orbital Desk' && p.tagline.join('|') === 'Quiet light,|all day.'; })());
const fakeCanvas = (w, h) => { const c = { width: w, height: h }; c.ctx = fakeContext(w, h); c.getContext = () => c.ctx; return c; };
await claim('drawn at a thumbnail size, no plane covers its words and nothing flickers', () => {
  const kit = createKit(fakeContext(1280, 720), { width: 1280, height: 720, makeCanvas: fakeCanvas, assets: { mark: fakeCanvas(320, 320) } });
  const drawn = renderStage(kit, doc, THUMB_AT, { renderPlan, activeScenes });
  assert.deepEqual(drawn.map((d) => d.id).filter((id) => /thumb|lift|icon-6/.test(id)).sort(), ['icon-6', 'lift-back', 'lift-shapes', 'lift-words', 'thumb']);
  assert.deepEqual(coveredWords(drawn), []);
  assert.deepEqual(coplanarPairs(drawn), []);
});
ok('a plane laid over the words is caught', (() => {
  const bad = normalizeScene({ ...input, stage: { ...input.stage, parts: input.stage.parts.map((p) => (p.kind === 'lift' ? { ...p, pose: [[0, { x: 700, y: 560, z: 40, ry: 0, rx: 0, s: 0.43 }]] } : p)) }, assets: {} }).scene;
  const kit = createKit(fakeContext(1280, 720), { width: 1280, height: 720, makeCanvas: fakeCanvas, assets: {} });
  return coveredWords(renderStage(kit, bad, THUMB_AT, { renderPlan, activeScenes })).length > 0;
})());

done();
