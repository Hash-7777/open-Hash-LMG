// The film itself: the storyboard compiler lays out every kind of beat in
// every style and every frame shape without a single error the film checks
// can see; normalising a scene twice gives the same scene; no field of a
// layer is lost on the way through (COMMIT_RULES 12.5); and every example
// draws at every moment without throwing.

import { root, ok, section, attempt, done } from './lib/check.mjs';
import { compileStoryboard } from '../../src/core/scene/compile.js';
import { normalizeScene } from '../../src/core/scene/normalize.js';
import { lintScene, sampleTimes } from '../../src/core/scene/lint.js';
import { STYLE_NAMES, ASPECTS, LAYER_TYPES } from '../../src/core/scene/format.js';
import { EXAMPLES } from '../../src/core/scene/examples.js';
import { STORYBOARD, measure } from './lib/fixtures.mjs';
import { statUnits, normalizeStoryboard } from '../../src/core/scene/storyboard.js';
import { autofix, motionTimes, beatTimes } from '../../src/core/scene/lint.js';
import { resizeScene } from '../../src/core/scene/edit.js';

section('Every beat kind, in every style and frame shape, compiles clean');
for (const style of STYLE_NAMES) {
  for (const aspect of Object.keys(ASPECTS)) {
    await attempt(`${style} ${aspect}`, async () => {
      const { scene } = compileStoryboard(STORYBOARD, { style, aspect, targetDuration: 40, narration: true });
      const samples = measure(scene, sampleTimes(scene));
      const errors = lintScene(scene, { samples, targetDuration: 40 }).filter((i) => i.level === 'error');
      ok(`${style} ${aspect}: no errors`, errors.length === 0, errors.slice(0, 3).map((e) => `${e.code}: ${e.message}`).join(' / '));
      ok(`${style} ${aspect}: scenes start on the beat`, scene.scenes.every((S) => Math.abs(S.start / (60 / scene.bpm) - Math.round(S.start / (60 / scene.bpm))) < 0.02 || S.transition.kind !== 'cut'));
    });
  }
}

section('Frame one is a picture, never an empty frame');
for (const style of STYLE_NAMES) {
  const { scene } = compileStoryboard(STORYBOARD, { style, targetDuration: 30 });
  ok(`${style}: the first frame draws something`, measure(scene, [0])[0].boxes.some((b) => b.tag));
}
ok('the example that opens a new project does too', measure(normalizeScene(EXAMPLES.launch).scene, [0])[0].boxes.some((b) => b.tag));
{
  const plain = normalizeScene({ scenes: [{ duration: 3, layers: [{ type: 'text', text: 'Hello there', in: 'rise' }] }] }).scene;
  const issues = lintScene(plain, { samples: measure(plain, sampleTimes(plain)) });
  const hit = issues.find((i) => i.code === 'empty-open');
  ok('an empty opening is caught', Boolean(hit));
  const fixed = autofix(plain, [hit]).scene;
  ok('and repaired so frame one draws', measure(fixed, [0])[0].boxes.some((b) => b.tag));
  ok('and the repair holds through normalising', JSON.stringify(normalizeScene(fixed).scene) === JSON.stringify(fixed));
}

section('Words never cross words while they move');
for (const style of STYLE_NAMES) {
  for (const aspect of Object.keys(ASPECTS)) {
    const { scene } = compileStoryboard(normalizeStoryboard(STORYBOARD).storyboard, { style, aspect, targetDuration: 40 });
    const hits = lintScene(scene, { moving: measure(scene, motionTimes(scene)) }).filter((i) => i.code === 'collide-in-motion');
    ok(`${style} ${aspect}: a handoff at every shared-frame transition`, hits.length === 0, hits.slice(0, 2).map((i) => i.message).join(' / '));
  }
}
{
  // Two lines in the same place, joined by a crossfade with the new one arriving at once.
  const pile = normalizeScene({ scenes: [
    { duration: 3, layers: [{ id: 'old', type: 'text', text: 'Leaving now', size: 90 }] },
    { duration: 3, transition: { kind: 'fade', duration: 0.6 }, layers: [{ id: 'new', type: 'text', text: 'Arriving now', size: 90, in: { preset: 'fade', duration: 0.3 } }] },
  ] }).scene;
  const hit = lintScene(pile, { moving: measure(pile, motionTimes(pile)) }).find((i) => i.code === 'collide-in-motion');
  ok('a crossfade that piles words on words is caught', Boolean(hit));
  const fixed = autofix(pile, [hit]).scene;
  ok('and repaired with a dip through the background', fixed.scenes[1].transition.kind === 'dip');
  ok('after which nothing crosses', !lintScene(fixed, { moving: measure(fixed, motionTimes(fixed)) }).some((i) => i.code === 'collide-in-motion'));
}

section('A scene that changes length keeps its layers whole');
{
  const S = { duration: 3, layers: [{ id: 'a', at: 0, until: 3, out: { preset: 'fade', at: 2.5 } }, { id: 'b', at: 0.5, until: 1.5 }, { id: 'g', at: 0, until: 3, layers: [{ id: 'c', at: 0, until: 3 }] }] };
  resizeScene(S, 5);
  ok('a layer that ran to the end still does, its exit moved with it', S.layers[0].until === 5 && S.layers[0].out.at === 4.5);
  ok('a layer that ended earlier keeps its time', S.layers[1].until === 1.5);
  ok('inside a group too', S.layers[2].layers[0].until === 5);
  resizeScene(S, 1);
  ok('shorter, nothing outlives its scene', S.layers.every((L) => L.until <= 1 && L.at < 1));
}

section('A storyboard longer than the length asked for');
{
  const { scene, notes } = compileStoryboard(STORYBOARD, { style: 'studio', targetDuration: 15 });
  const kinds = scene.scenes.map((S) => S.name);
  ok('it is cut to about the length asked for', scene.duration <= 15 * 1.25, `${scene.duration.toFixed(1)} s`);
  ok('the opening, the name and the end are kept', kinds[0] === 'hook' && kinds.includes('title') && kinds[kinds.length - 1] === 'end');
  ok('the quote goes before the stat', !kinds.includes('quote') || kinds.includes('stat'));
  ok('it says which beats were left out', notes.some((n) => /left out/.test(n)));
}

section('A stat reads its unit sensibly');
const units = (p, s) => JSON.stringify(statUnits(p, s));
ok('a word for percent becomes the sign, and a phrase moves under the number', units('percent', 'of focus') === JSON.stringify({ prefix: '', suffix: '%', rest: 'of focus' }));
ok('a short unit word keeps a space before it', statUnits('', 'hours').suffix === ' hours');
ok('a currency sign stays in front', statUnits('$', '').prefix === '$');
ok('"times" becomes a multiplication sign', statUnits('', 'times faster').suffix === '\u00d7');
ok('through the storyboard', (() => { const b = normalizeStoryboard({ beats: [{ kind: 'stat', value: 86, prefix: 'percent', suffix: 'of focus' }] }).storyboard.beats[0]; return b.suffix === '%' && b.prefix === '' && /of focus/.test(b.sub); })());

section('Normalising is idempotent');
for (const [name, ex] of Object.entries(EXAMPLES)) {
  const once = normalizeScene(ex).scene;
  const twice = normalizeScene(once).scene;
  ok(`example ${name}`, JSON.stringify(once) === JSON.stringify(twice));
}
{
  const { scene } = compileStoryboard(STORYBOARD, { style: 'tech', aspect: '9:16', narration: true });
  ok('a compiled film', JSON.stringify(normalizeScene(scene).scene) === JSON.stringify(scene));
}

section('No layer field is dropped (the field guard)');
const COMMON = { name: 'n', x: 0.3, y: 0.4, anchor: 'top-left', rotate: 5, scale: 1.1, opacity: 0.9, color: 'accent2', at: 0.2, until: 2.5, in: { preset: 'rise', at: 0.1, duration: 0.6, ease: 'outQuint', stagger: 0.05, distance: 30 }, out: { preset: 'fade', duration: 0.4, ease: 'inCubic', stagger: 0, distance: 20 }, hold: 'float', keys: { x: [[0, 0.3], [1, 0.4]] }, z: 2, repeat: { count: 12, layout: 'grid', cols: 4, gap: 40, radius: 100, stagger: 0.05 } };
const FULL = {
  text: { ...COMMON, type: 'text', text: 'Every field', size: 80, weight: 600, font: 'serif', align: 'left', tracking: 0.01, leading: 1.2, maxWidth: 0.7, upper: true, highlight: ['field'], highlightColor: 'accent', plate: { color: 'surface', padX: 20, padY: 10, radius: 8 } },
  shape: { ...COMMON, type: 'shape', shape: 'polygon', w: 200, h: 120, radius: 4, fill: 'accent', stroke: 'ink', strokeWidth: 3, d: '', points: [[0, 0], [1, 1], [0, 1]], sides: 5, arc: [0, 0.75], cap: 'butt' },
  counter: { ...COMMON, type: 'counter', from: 1, to: 9, decimals: 1, prefix: '$', suffix: 'k', separator: false, size: 120, weight: 700, font: 'display', align: 'right', tracking: 0, count: 2, roll: true },
  bars: { ...COMMON, type: 'bars', values: [1, 2, 3], labels: ['a', 'b', 'c'], w: 600, h: 300, max: 5, min: 0, gap: 0.3, orientation: 'horizontal', showValues: false, labelSize: 22, track: 'surface', strokeWidth: 4, dots: false, area: true, decimals: 1, suffix: '%' },
  group: { ...COMMON, type: 'group', layers: [{ type: 'text', text: 'inside', id: 'inner' }] },
  video: { ...COMMON, type: 'video', asset: 'clip', w: 1600, h: 900, fit: 'contain', radius: 12, from: 2.5, rate: 1.5, volume: 0.6, muted: true },
};
const FOOTAGE = { clip: { kind: 'video', name: 'Invented clip', media: '0123456789abcdef01234567', duration: 12, width: 1920, height: 1080, audio: true } };
for (const type of LAYER_TYPES) {
  if (type === 'image' || type === 'line-chart') continue;
  const L = FULL[type];
  if (!L) { ok(`${type} has a full layer here`, false); continue; }
  const doc = { assets: FOOTAGE, scenes: [{ duration: 3, layers: [{ id: 'probe', ...L }] }] };
  const once = normalizeScene(doc).scene.scenes[0].layers[0];
  const twice = normalizeScene(normalizeScene(doc).scene).scene.scenes[0].layers[0];
  const lost = Object.keys(L).filter((k) => !(k in once) || !(k in twice));
  ok(`${type}: every field survives twice`, lost.length === 0, `lost ${lost.join(', ')}`);
}

section('Something moves on every beat');
{
  const still = normalizeScene({ bpm: 120, scenes: [
    { id: 'a', duration: 6, camera: { zoom: [1, 1] }, layers: [{ type: 'text', text: 'Held', in: { preset: 'fade', at: -0.4, duration: 0.4 } }] },
    { id: 'b', duration: 3, layers: [{ type: 'text', text: 'End' }] },
  ] }).scene;
  const frozen = lintScene(still, { beats: measure(still, beatTimes(still)) }).filter((i) => i.code === 'frozen');
  ok('a scene that holds a still picture is caught', frozen.length === 1 && frozen[0].scene === 'a');
  const fixed = autofix(still, frozen).scene;
  ok('and given a slow push, after which it moves on every beat', lintScene(fixed, { beats: measure(fixed, beatTimes(fixed)) }).every((i) => i.code !== 'frozen'));
  ok('the end card may hold', lintScene(still, { beats: measure(still, beatTimes(still)) }).every((i) => i.scene !== 'b' || i.code !== 'frozen'));
}
for (const style of STYLE_NAMES) {
  const { scene } = compileStoryboard(STORYBOARD, { style, targetDuration: 40 });
  const hits = lintScene(scene, { beats: measure(scene, beatTimes(scene)) }).filter((i) => i.code === 'frozen');
  ok(`${style}: a compiled film moves on every beat`, hits.length === 0, hits.map((i) => i.message).join(' / '));
}

section('Footage and sound clips survive normalising');
{
  const assets = { ...FOOTAGE, song: { kind: 'sound', name: 'Invented song', media: 'fedcba9876543210fedcba98', duration: 90 }, bad: { kind: 'video', media: '../../etc' } };
  const doc = { assets, scenes: [{ duration: 6, layers: [{ type: 'video', asset: 'clip', from: 1 }] }], sound: { score: 'none', clips: [{ asset: 'song', at: 0, from: 10, length: 6, volume: 0.5, fadeIn: 1, fadeOut: 2 }, { asset: 'missing', at: 0 }] } };
  const once = normalizeScene(doc).scene;
  ok('footage and sound kept by id, a damaged id dropped', once.assets.clip?.media === FOOTAGE.clip.media && once.assets.song?.kind === 'sound' && !once.assets.bad);
  ok('a sound clip keeps every field; one with no asset is dropped', once.sound.clips.length === 1 && once.sound.clips[0].from === 10 && once.sound.clips[0].fadeOut === 2);
  ok('normalising twice changes nothing', JSON.stringify(normalizeScene(once).scene) === JSON.stringify(once));
  ok('a video layer fills the frame and starts with a cut by default', once.scenes[0].layers[0].w === 1920 && once.scenes[0].layers[0].h === 1080 && once.scenes[0].layers[0].in.preset === 'none');
}

section('Every example draws at every moment');
for (const [name, ex] of Object.entries(EXAMPLES)) {
  await attempt(`example ${name} draws`, async () => {
    const scene = normalizeScene(ex).scene;
    const times = Array.from({ length: 41 }, (_, i) => (scene.duration * i) / 40);
    const samples = measure(scene, times);
    ok(`example ${name}: every frame drew something, the last one too`, samples.every((s) => s.boxes.length > 0 || s.t === 0));
  });
}
done();
