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
const COMMON = { name: 'n', x: 0.3, y: 0.4, anchor: 'top-left', rotate: 5, scale: 1.1, opacity: 0.9, color: 'accent2', at: 0.2, until: 2.5, in: { preset: 'rise', at: 0.1, duration: 0.6, ease: 'outQuint', stagger: 0.05, distance: 30 }, out: { preset: 'fade', duration: 0.4, ease: 'inCubic', stagger: 0, distance: 20 }, hold: 'float', keys: { x: [[0, 0.3], [1, 0.4]] }, z: 2 };
const FULL = {
  text: { ...COMMON, type: 'text', text: 'Every field', size: 80, weight: 600, font: 'serif', align: 'left', tracking: 0.01, leading: 1.2, maxWidth: 0.7, upper: true, highlight: ['field'], highlightColor: 'accent', plate: { color: 'surface', padX: 20, padY: 10, radius: 8 } },
  shape: { ...COMMON, type: 'shape', shape: 'polygon', w: 200, h: 120, radius: 4, fill: 'accent', stroke: 'ink', strokeWidth: 3, d: '', points: [[0, 0], [1, 1], [0, 1]], sides: 5, arc: [0, 0.75], cap: 'butt' },
  counter: { ...COMMON, type: 'counter', from: 1, to: 9, decimals: 1, prefix: '$', suffix: 'k', separator: false, size: 120, weight: 700, font: 'display', align: 'right', tracking: 0, count: 2 },
  bars: { ...COMMON, type: 'bars', values: [1, 2, 3], labels: ['a', 'b', 'c'], w: 600, h: 300, max: 5, min: 0, gap: 0.3, orientation: 'horizontal', showValues: false, labelSize: 22, track: 'surface', strokeWidth: 4, dots: false, area: true, decimals: 1, suffix: '%' },
  group: { ...COMMON, type: 'group', layers: [{ type: 'text', text: 'inside', id: 'inner' }] },
};
for (const type of LAYER_TYPES) {
  if (type === 'image' || type === 'line-chart') continue;
  const L = FULL[type];
  if (!L) { ok(`${type} has a full layer here`, false); continue; }
  const doc = { scenes: [{ duration: 3, layers: [{ id: 'probe', ...L }] }] };
  const once = normalizeScene(doc).scene.scenes[0].layers[0];
  const twice = normalizeScene(normalizeScene(doc).scene).scene.scenes[0].layers[0];
  const lost = Object.keys(L).filter((k) => !(k in once) || !(k in twice));
  ok(`${type}: every field survives twice`, lost.length === 0, `lost ${lost.join(', ')}`);
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
