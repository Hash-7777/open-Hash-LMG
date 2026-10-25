// Pictures the model draws: a drawing is read as path data only and fitted to
// its grid, or set aside; the storyboard keeps drawings by name, through a
// model's rewrite, and never shows them to the model; every composition with
// a picture, in every look, frame shape and take, lays out with no error the
// film checks can see, never puts a picture over the words or off the frame;
// the plain compositions, turned through by takes, are clean too; and the
// director draws them, makes the film without them when drawing fails, and
// gives a redesign back the path data it hid.

import assert from 'node:assert/strict';
import { section, claim, ok, attempt, done } from './lib/check.mjs';
import { STORYBOARD, measure } from './lib/fixtures.mjs';
import { normalizeDrawing, cleanPicture, PICTURE_GRID, shapesToStrokes } from '../../src/core/scene/pictures.js';
import { normalizeStoryboard, storyboardForModel, keepPictures } from '../../src/core/scene/storyboard.js';
import { applyPictures, picturesMessage, pictureCount, picturesPrompt, PICTURE_EXAMPLES, copiedExample } from '../../src/core/director/pictures.js';
import { compileStoryboard } from '../../src/core/scene/compile.js';
import { chooseDirection } from '../../src/core/scene/direction.js';
import { lintScene, sampleTimes } from '../../src/core/scene/lint.js';
import { STYLE_NAMES, ASPECTS } from '../../src/core/scene/format.js';
import { createDirector, sceneForModel } from '../../src/core/director/pipeline.js';
import { restore } from '../../src/core/director/scene-io.js';

// Invented drawings: a cup with steam, a ring drawn as one stroke.
const CUP = { strokes: ['M28 42 H72 V74 Q72 86 60 86 H40 Q28 86 28 74 Z', 'M72 52 Q86 52 86 63 Q86 74 72 74', 'M20 92 H80'], accent: ['M42 34 Q36 26 43 18', 'M57 34 Q51 26 58 18'] };
const RING = { strokes: ['M50 10 A40 40 0 1 0 50.1 10'] };

section('A drawing is path data, fitted to its grid, or set aside');
await claim('a clear drawing is kept, filling and centred on its grid', () => {
  const { picture } = normalizeDrawing(CUP);
  assert.ok(picture && picture.d && picture.accent);
  const all = [picture.box, picture.accentBox];
  const x0 = Math.min(...all.map((b) => b.x)), x1 = Math.max(...all.map((b) => b.x + b.w));
  const y0 = Math.min(...all.map((b) => b.y)), y1 = Math.max(...all.map((b) => b.y + b.h));
  assert.ok(Math.max(x1 - x0, y1 - y0) > PICTURE_GRID * 0.9);
  assert.ok(Math.abs((x0 + x1) / 2 - PICTURE_GRID / 2) < 1.5 && Math.abs((y0 + y1) / 2 - PICTURE_GRID / 2) < 1.5);
  assert.match(picture.d, /^[ML0-9. -]+$/);
});
await claim('one closed stroke with enough points is kept', () => assert.ok(normalizeDrawing(RING).picture));
for (const [label, raw] of [
  ['anything but path data', { strokes: ['<svg onload="x()">', 'M0 0 L50 50'] }],
  ['a speck', { strokes: ['M10 10 L12 12', 'M11 10 L12 11'] }],
  ['a single short stroke', { strokes: ['M10 10 L90 90'] }],
  ['far off its grid', { strokes: ['M0 0 L400 400', 'M10 10 L20 20'] }],
  ['too many strokes', { strokes: Array.from({ length: 40 }, (_, i) => `M${i} 0 L${i} 90`) }],
  ['not a drawing at all', 'a lamp'],
]) await claim(`set aside: ${label}`, () => assert.equal(normalizeDrawing(raw).picture, null));
await claim('a saved picture is read back as path data only', () => {
  assert.ok(cleanPicture(normalizeDrawing(CUP).picture));
  assert.equal(cleanPicture({ d: 'M0 0 L10 10"/><script>' }), null);
});

section('The model’s pictures land on the beats it named');
const sb = () => normalizeStoryboard(STORYBOARD).storyboard;
await claim('beats are numbered from one, and only the kinds with room take one', () => {
  const msg = picturesMessage('An invented lamp', sb());
  assert.match(msg, /^1\. hook: Your desk is loud\./m);
  assert.doesNotMatch(msg, /chart:/);
});
await claim('each picture goes to its beat by name; a beat kind without room is skipped', () => {
  const { storyboard, kept } = applyPictures(sb(), { pictures: [{ beat: 1, name: ' Desk  Lamp ', ...CUP }, { beat: 7, name: 'chart', ...CUP }, { beat: 3, name: 'mark', ...RING }] }, 3);
  assert.equal(kept, 2);
  assert.equal(storyboard.beats[0].picture, 'desk lamp');
  assert.equal(storyboard.beats[2].picture, 'mark');
  assert.equal(storyboard.beats[6].picture, undefined);
});
await claim('no more pictures than asked for; an unclear one is set aside with a note', () => {
  const out = applyPictures(sb(), { pictures: [{ beat: 1, name: 'a', strokes: ['nope'] }, { beat: 2, name: 'b', ...CUP }, { beat: 3, name: 'c', ...CUP }] }, 1);
  assert.equal(out.kept, 1);
  assert.ok(out.notes.some((n) => /set aside/.test(n)));
});
await claim('about half the beats are asked for, never more than five', () => {
  assert.equal(pictureCount(sb()), 3);
  assert.equal(pictureCount({ beats: Array.from({ length: 20 }, () => ({ kind: 'statement' })) }), 5);
});

section('The storyboard keeps drawings by name, and never shows them to a model');
const drawn = () => applyPictures(sb(), { pictures: [{ beat: 1, name: 'cup', ...CUP }, { beat: 2, name: 'ring', ...RING }] }, 3).storyboard;
await claim('a saved storyboard keeps its pictures, and a beat naming a missing one shows none', () => {
  const again = normalizeStoryboard({ ...drawn(), beats: [...drawn().beats, { kind: 'statement', text: 'Extra', picture: 'missing' }] }).storyboard;
  assert.equal(again.beats[0].picture, 'cup');
  assert.ok(again.pictures.cup && again.pictures.ring);
  assert.equal(again.beats.at(-1).picture, undefined);
});
await claim('a model is shown picture names, not drawings', () => {
  const shown = JSON.stringify(storyboardForModel(drawn()));
  assert.ok(shown.includes('"picture":"cup"'));
  assert.ok(!shown.includes('"pictures"'));
});
await claim('a rewrite keeps the drawings: by name, and by place for a beat of the same kind', () => {
  const prev = drawn();
  const rewritten = normalizeStoryboard({ title: 'Lumen', beats: [{ kind: 'hook', text: 'A new hook' }, { kind: 'statement', text: 'Changed', picture: 'ring' }, { kind: 'end', text: 'Lumen' }] }).storyboard;
  const kept = keepPictures(rewritten, prev);
  assert.equal(kept.beats[0].picture, 'cup');
  assert.equal(kept.beats[1].picture, 'ring');
  assert.deepEqual(Object.keys(kept.pictures).sort(), ['cup', 'ring']);
});

section('Every composition with a picture lays out clean, in every look, shape and take');
const PICTURED = normalizeStoryboard({
  title: 'Ember Cafe',
  pictures: { cup: normalizeDrawing(CUP).picture, ring: normalizeDrawing(RING).picture },
  beats: [
    { kind: 'hook', text: 'Mornings start slow.', picture: 'cup' },
    { kind: 'statement', text: 'Roasted down the street', sub: 'every single morning', picture: 'ring' },
    { kind: 'title', text: 'Ember Cafe', sub: 'Open at six', picture: 'cup' },
    { kind: 'stat', value: 12, sub: 'kinds of invented beans', picture: 'ring' },
    { kind: 'list', text: 'What we pour', items: ['Espresso', 'Pour over', 'Cold brew'], picture: 'cup' },
    { kind: 'statement', text: 'Pull up a chair and stay a while', picture: 'cup' },
    { kind: 'end', text: 'Ember Cafe', sub: 'ember.example', picture: 'ring' },
  ],
}).storyboard;
const overlaps = (scene) => {
  const bad = [];
  for (const smp of measure(scene, sampleTimes(scene))) {
    for (const p of smp.boxes.filter((b) => /^picture/.test(b.tag || '') && b.alpha > 0.5)) {
      if (p.x < -1 || p.y < -1 || p.x + p.w > scene.width + 1 || p.y + p.h > scene.height + 1) bad.push(`${p.tag} off the frame at ${smp.t.toFixed(1)} s`);
      for (const w of smp.boxes.filter((b) => b.kind === 'text')) {
        const ix = Math.min(p.x + p.w, w.x + w.w) - Math.max(p.x, w.x), iy = Math.min(p.y + p.h, w.y + w.h) - Math.max(p.y, w.y);
        if (ix > 4 && iy > 4) bad.push(`${p.tag} over "${w.text}" at ${smp.t.toFixed(1)} s`);
      }
    }
  }
  return bad;
};
for (const style of STYLE_NAMES) {
  for (const aspect of Object.keys(ASPECTS)) {
    await attempt(`${style} ${aspect}`, async () => {
      for (const take of [0, 1, 2]) {
        const direction = chooseDirection({ brief: 'An invented cafe', style, take });
        const { scene } = compileStoryboard(PICTURED, { direction, aspect, targetDuration: 30 });
        const errors = lintScene(scene, { samples: measure(scene, sampleTimes(scene)), targetDuration: 30 }).filter((i) => i.level === 'error');
        const pictures = scene.scenes.filter((S) => S.layers.some((L) => L.shape === 'path')).length;
        const bad = overlaps(scene);
        ok(`${style} ${aspect} take ${take}: every pictured beat drawn, no errors, nothing over the words`, pictures === 7 && !errors.length && !bad.length,
          [`${pictures} pictured`, ...errors.slice(0, 2).map((e) => e.message), ...bad.slice(0, 2)].join(' / '));
      }
    });
  }
}

section('The plain compositions, turned through by takes, lay out clean');
for (const style of STYLE_NAMES) {
  for (const aspect of Object.keys(ASPECTS)) {
    await attempt(`${style} ${aspect} plain`, async () => {
      const errors = [];
      for (let take = 0; take < 5; take++) {
        const { scene } = compileStoryboard(normalizeStoryboard(STORYBOARD).storyboard, { direction: chooseDirection({ brief: 'An invented lamp', style, take }), aspect, targetDuration: 40 });
        errors.push(...lintScene(scene, { samples: measure(scene, sampleTimes(scene)), targetDuration: 40 }).filter((i) => i.level === 'error').map((e) => `take ${take}: ${e.message}`));
      }
      ok(`${style} ${aspect}: five takes, no errors`, errors.length === 0, errors.slice(0, 2).join(' / '));
    });
  }
}

section('The director draws pictures, and makes the film without them when it cannot');
const STORY = { title: 'Lumen', beats: [{ kind: 'hook', text: 'Your desk is loud.' }, { kind: 'statement', text: 'Lumen makes it calm' }, { kind: 'title', text: 'Lumen', sub: 'The quiet lamp' }, { kind: 'end', text: 'Lumen', sub: 'lumen.example' }] };
function director(script) {
  const asked = [], log = [];
  const d = createDirector({
    ask: async ({ purpose, messages }) => {
      asked.push(purpose);
      const next = script[purpose];
      const reply = typeof next === 'function' ? next(messages) : next;
      if (reply === undefined) throw new Error(`no scripted answer for ${purpose}`);
      return typeof reply === 'string' ? reply : JSON.stringify(reply);
    },
    measure: async ({ scene }, times) => measure(scene, times),
    trial: async () => ({ ok: true }),
    sheet: async () => null,
    log: (e) => log.push(e),
  });
  return { d, asked, log };
}
const brief = { brief: 'A launch film for an invented lamp.', style: 'studio', aspect: '16:9', seconds: 15 };
await claim('a guided film shows the pictures the model drew', async () => {
  const { d, asked, log } = director({ storyboard: STORY, pictures: { pictures: [{ beat: 1, name: 'lamp', ...CUP }, { beat: 3, name: 'mark', ...RING }] } });
  const out = await d.make({ ...brief, tier: 'guided' });
  assert.deepEqual(asked, ['storyboard', 'pictures']);
  assert.ok(out.storyboard.pictures.lamp);
  assert.equal(out.scene.scenes.filter((S) => S.layers.some((L) => L.shape === 'path')).length, 2);
  assert.ok(log.some((e) => e.id === 'pictures' && e.status === 'done'));
});
await claim('a drawing step that fails leaves a film without pictures, with a note', async () => {
  const { d, log } = director({ storyboard: STORY, pictures: () => { throw new Error('The service is busy.'); } });
  const out = await d.make({ ...brief, tier: 'guided' });
  assert.ok(out.scene.scenes.length >= 3);
  assert.ok(log.some((e) => e.id === 'pictures' && e.status === 'note' && /busy.*without pictures/.test(e.detail)));
});
await claim('turned off, no pictures are asked for', async () => {
  const { d, asked } = director({ storyboard: STORY });
  await d.make({ ...brief, tier: 'guided', pictures: false });
  assert.deepEqual(asked, ['storyboard']);
});
await claim('a redesign is shown marks for the drawings and given the path data back', () => {
  const sbDrawn = applyPictures(normalizeStoryboard(STORY).storyboard, { pictures: [{ beat: 1, name: 'cup', ...CUP }] }, 2).storyboard;
  const { scene } = compileStoryboard(sbDrawn, { style: 'studio', targetDuration: 15 });
  const shown = sceneForModel(scene);
  const paths = shown.scenes[0].layers.filter((L) => L.shape === 'path');
  assert.ok(paths.length && paths.every((L) => /^kept:/.test(L.d)));
  const back = restore(JSON.parse(JSON.stringify(shown)), scene);
  assert.deepEqual(back.scenes[0].layers.filter((L) => L.shape === 'path').map((L) => L.d), scene.scenes[0].layers.filter((L) => L.shape === 'path').map((L) => L.d));
});

section('A redesign keeps the drawings, and the music chosen from the brief');
// The scenes a part of the redesign was shown.
const partShown = (content) => JSON.parse(content.split('made by rule:\n')[1].split('\n\n')[0]);
await claim('a redesign that dropped the drawings gets them put back, with a note, and keeps the brief\u2019s score', async () => {
  const { d, log } = director({
    storyboard: STORY,
    pictures: { pictures: [{ beat: 1, name: 'cup', ...CUP }, { beat: 2, name: 'ring', ...RING }] },
    'plan part': (messages) => ({ scenes: partShown(messages[0].content).map((S) => ({ ...S, camera: { zoom: [1, 1.06] }, layers: S.layers.filter((L) => L.shape !== 'path') })) }),
  });
  const out = await d.make({ ...brief, tier: 'plan', rounds: 0 });
  assert.ok(out.scene.scenes.some((S) => S.camera?.zoom?.[1] === 1.06), 'the redesign was used');
  assert.equal(out.scene.sound.score, out.direction.score);
  assert.equal(out.scene.scenes.filter((S) => S.layers.some((L) => L.shape === 'path')).length, 2);
  assert.ok(log.some((e) => e.id === 'design' && e.status === 'note' && /keep their drawing/.test(e.detail)));
});
await claim('a redesign that kept them is used as written, and was shown no drawing data', async () => {
  let shown = '';
  const log = [];
  const d2 = createDirector({
    ask: async ({ purpose, messages }) => {
      if (purpose === 'storyboard') return JSON.stringify(STORY);
      if (purpose === 'pictures') return JSON.stringify({ pictures: [{ beat: 1, name: 'cup', ...CUP }] });
      shown += messages[0].content;
      const scenes = partShown(messages[0].content);
      const pic = scenes.flatMap((S) => S.layers).find((L) => L.id === 'picture');
      if (pic) pic.x = 0.4;
      return JSON.stringify({ scenes });
    },
    measure: async ({ scene }, times) => measure(scene, times), trial: async () => ({ ok: true }), sheet: async () => null, log: (e) => log.push(e),
  });
  const out = await d2.make({ ...brief, tier: 'plan', rounds: 0 });
  assert.equal(out.scene.scenes[0].layers.find((L) => L.id === 'picture').x, 0.4);
  assert.ok(out.scene.scenes[0].layers.find((L) => L.id === 'picture').d.startsWith('M'));
  assert.ok(!/"pictures":\{/.test(shown) && /kept:picture/.test(shown) && /keep every one/.test(shown));
  assert.ok(!log.some((e) => /keep their drawing|keeps its drawing/.test(e.detail || '')));
});

section('Pictures built from simple shapes');
await claim('each shape becomes a stroke; unknown shapes and numbers off the grid are left out', () => {
  const st = shapesToStrokes([['rect', 10, 10, 30, 20, 4], ['circle', 50, 50, 10], ['line', 0, 0, 10, 10], ['poly', 1, 1, 9, 1, 5, 9], ['arc', 50, 50, 20, 0, 90], ['star', 1, 2, 3], ['line', 0, 0, 'x', 1], ['circle', 50, 50, 9999]]);
  assert.equal(st.length, 5);
  assert.ok(st.every((d) => /^M/.test(d)));
});
await claim('a box round the whole drawing is a frame and is left out, but a lone box is kept', () => {
  assert.equal(shapesToStrokes([['rect', 2, 2, 96, 96, 8], ['circle', 50, 50, 20]]).length, 1);
  assert.equal(shapesToStrokes([['rect', 2, 2, 96, 96, 8]]).length, 1);
});
await claim('a drawing of shapes is kept and fitted like one of strokes, its accent too', () => {
  const { picture } = normalizeDrawing(PICTURE_EXAMPLES[1]);
  assert.ok(picture && picture.d && picture.accent);
  assert.ok(picture.box.w > 60 || picture.box.h > 60, 'it fills the grid');
});
await claim('an example copied under another object\u2019s name is set aside; drawn for its own object it is kept', () => {
  assert.equal(copiedExample({ ...PICTURE_EXAMPLES[0], name: 'city skyline' }), true);
  assert.equal(copiedExample({ ...PICTURE_EXAMPLES[0], name: 'reading lamp' }), false);
  const sb = normalizeStoryboard({ title: 'T', beats: [{ kind: 'hook', text: 'Night falls' }, { kind: 'statement', text: 'A lamp that rests your eyes' }] }).storyboard;
  const out = applyPictures(sb, { pictures: [{ ...PICTURE_EXAMPLES[0], beat: 1, name: 'city skyline' }, { ...PICTURE_EXAMPLES[0], beat: 2, name: 'lamp' }] }, 2);
  assert.equal(out.kept, 1); assert.equal(out.storyboard.beats[1].picture, 'lamp');
});
await claim('the prompt asks for one everyday object built from shapes, with its examples', () => {
  const p = picturesPrompt(3);
  assert.match(p, /\["rect", x, y, width, height, cornerRadius\]/); assert.match(p, /no frame or border/); assert.match(p, /copy one only when you draw that same object/);
  for (const e of PICTURE_EXAMPLES) assert.ok(p.includes(JSON.stringify(e)));
});
done();
