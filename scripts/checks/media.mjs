// The person's own pictures and clips in a film a model makes: listed for the
// model, placed on the beats it chose and on suitable ones when it chose none,
// laid out whole and inside the frame in every frame shape, and carried into
// the new film with nothing a model or an earlier film made.

import assert from 'node:assert/strict';
import { section, claim, done } from './lib/check.mjs';
import { STORYBOARD, measure } from './lib/fixtures.mjs';
import { mediaList, mediaPromptText, placeMedia, keptAssets } from '../../src/core/scene/media.js';
import { normalizeStoryboard } from '../../src/core/scene/storyboard.js';
import { compileStoryboard } from '../../src/core/scene/compile.js';
import { createDirector } from '../../src/core/director/pipeline.js';
import { ASPECTS } from '../../src/core/scene/format.js';
import { normalizeScene } from '../../src/core/scene/normalize.js';
import { layerState } from '../../src/core/engine/motion.js';
import { createKit } from '../../src/core/engine/kit.js';
import { renderPlan } from '../../src/core/engine/render-plan.js';
import { fakeContext } from './lib/fake-canvas.mjs';

// A wide screenshot, a tall photo and a clip; a spoken clip that is not the person's media.
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const ASSETS = {
  'image-wide': { kind: 'image', name: 'App screen.png', data: PIXEL, width: 2400, height: 1500 },
  'image-tall': { kind: 'image', name: 'Product photo.jpg', data: PIXEL, width: 900, height: 1600 },
  'video-clip': { kind: 'video', name: 'Demo.mov', media: '0123456789abcdef01234567', duration: 6, width: 1920, height: 1080 },
  'voice-1': { kind: 'audio', name: 'Spoken line', data: 'data:audio/wav;base64,AAAA', duration: 2 },
  'sound-1': { kind: 'sound', name: 'Song.mp3', media: '89abcdef0123456789abcdef', duration: 120 },
};
const sb = (beats) => normalizeStoryboard({ title: 'T', beats }).storyboard;

section('The person’s media, listed for the model');
await claim('pictures and clips are listed by number; sounds and spoken clips are not', () => {
  const list = mediaList(ASSETS);
  assert.deepEqual(list.map((m) => [m.n, m.key, m.kind]), [[1, 'image-wide', 'image'], [2, 'image-tall', 'image'], [3, 'video-clip', 'video']]);
});
await claim('the prompt names each, with its shape, and how to show it', () => {
  const text = mediaPromptText(mediaList(ASSETS));
  assert.match(text, /1\. a picture, wide, "App screen\.png"/);
  assert.match(text, /2\. a picture, tall, "Product photo\.jpg"/);
  assert.match(text, /3\. a video clip, 6\.0 s, wide/);
  assert.match(text, /"media": its number/);
  assert.equal(mediaPromptText([]), '');
});
await claim('a new film keeps the person’s media and drops what a film made', () => {
  assert.deepEqual(Object.keys(keptAssets(ASSETS)).sort(), ['image-tall', 'image-wide', 'sound-1', 'video-clip']);
});

section('Placed on the beats');
await claim('a beat’s number becomes the media’s key; a number that names nothing is dropped', () => {
  const { storyboard } = placeMedia(sb([{ kind: 'hook', text: 'Look' }, { kind: 'statement', text: 'This', media: 2 }, { kind: 'title', text: 'Name', media: 9 }]), mediaList({ 'image-tall': ASSETS['image-tall'] }));
  assert.equal(storyboard.beats[1].media, 'image-tall');
  assert.equal(storyboard.beats[2].media, undefined);
});
await claim('media the model left out goes on a suitable beat, after the opening if it can, with a note', () => {
  const { storyboard, notes } = placeMedia(sb([{ kind: 'hook', text: 'Look' }, { kind: 'stat', value: 3, sub: 'x' }, { kind: 'statement', text: 'This' }, { kind: 'end', text: 'Name' }]), mediaList(ASSETS));
  const shown = storyboard.beats.map((b) => b.media || null);
  assert.deepEqual(shown, [null, 'image-wide', 'image-tall', 'video-clip']);
  assert.ok(notes.some((n) => /3 of your pictures and clips were put on the film's beats/.test(n)));
});
await claim('a beat the model chose keeps its media, and nothing is placed twice', () => {
  const { storyboard, notes } = placeMedia(sb([{ kind: 'hook', text: 'A' }, { kind: 'title', text: 'B', media: '1' }, { kind: 'statement', text: 'C' }]), mediaList({ 'image-wide': ASSETS['image-wide'] }));
  assert.deepEqual(storyboard.beats.map((b) => b.media || null), [null, 'image-wide', null]);
  assert.ok(!notes.some((n) => /put on the film's beats/.test(n)));
});
await claim('a film with no media of the person’s is left as it was', () => {
  const before = sb([{ kind: 'hook', text: 'A' }]);
  assert.deepEqual(placeMedia(before, []).storyboard, before);
});

await claim('a picture shown once gets a second, closer look on the beat after it, but never the end card, and never a logo', () => {
  const beats = [{ kind: 'hook', text: 'A' }, { kind: 'statement', text: 'B', media: '1' }, { kind: 'list', items: ['x', 'y'] }, { kind: 'statement', text: 'D', media: '2' }, { kind: 'end', text: 'E' }];
  const list = mediaList({ 'image-wide': ASSETS['image-wide'], 'logo-mark': { kind: 'image', name: 'logo.png', data: PIXEL, width: 400, height: 400 } });
  const { storyboard, notes } = placeMedia(sb(beats), list);
  assert.deepEqual(storyboard.beats.map((b) => b.media || null), [null, 'image-wide', 'image-wide', 'logo-mark', null]);
  assert.ok(notes.some((n) => /second, closer look/.test(n)));
});

section('Laid out whole, inside the frame, in every frame shape');
const story = { ...sb([{ kind: 'hook', text: 'Your app, *in motion*' }, { kind: 'title', text: 'Hash Demo', sub: 'Made clear' }, { kind: 'statement', text: 'Every screen moves' }, { kind: 'statement', text: 'And plays its clip' }, { kind: 'end', text: 'Hash Demo', sub: 'demo.example' }]) };
story.beats[0].media = 'image-wide'; story.beats[1].media = 'image-tall'; story.beats[2].media = 'image-wide'; story.beats[3].media = 'video-clip'; story.beats[4].media = 'image-wide';
for (const aspect of Object.keys(ASPECTS)) {
  await claim(`${aspect}: each media beat shows its media at its own shape, framed, and inside the frame`, () => {
    const { scene } = compileStoryboard(story, { style: 'studio', aspect, targetDuration: 20, assets: ASSETS });
    const { width: FW, height: FH } = ASPECTS[aspect];
    const u = Math.min(FW, FH) / 1080;
    scene.scenes.forEach((S, i) => {
      const key = story.beats[i].media;
      const own = S.layers.find((L) => (L.type === 'image' || L.type === 'video') && L.asset === key);
      assert.ok(own, `scene ${i + 1} shows ${key}`);
      if (own.fit === 'cover') return;
      const a = ASSETS[key];
      assert.ok(Math.abs(own.w / own.h - a.width / a.height) < 0.02, `scene ${i + 1} keeps its shape`);
      assert.ok(S.layers.some((L) => L.type === 'shape' && L.shape === 'rect' && L.w === own.w && L.h === own.h), `scene ${i + 1} is framed`);
      const [x0, x1] = [own.x * FW - (own.w * u) / 2, own.x * FW + (own.w * u) / 2];
      const [y0, y1] = [own.y * FH - (own.h * u) / 2, own.y * FH + (own.h * u) / 2];
      assert.ok(x0 >= -1 && x1 <= FW + 1 && y0 >= -1 && y1 <= FH + 1, `scene ${i + 1} sits inside the frame`);
    });
  });
}

section('Beside a list or a figure, and carried into a second look');
const story2 = sb([{ kind: 'hook', text: 'Look closer' }, { kind: 'list', text: 'At a glance', items: ['Speed', 'Heat', 'Memory'] }, { kind: 'statement', text: 'Right there' }, { kind: 'stat', value: 3, suffix: 'x', sub: 'an invented figure' }, { kind: 'end', text: 'Hash Demo', sub: 'demo.example' }]);
story2.beats[1].media = 'image-tall'; story2.beats[2].media = 'image-tall'; story2.beats[3].media = 'image-wide';
await claim('a list and a figure sit in a column beside the picture, inside the frame', () => {
  const { scene } = compileStoryboard(story2, { style: 'studio', aspect: '16:9', targetDuration: 20, assets: ASSETS });
  for (const [i, kind] of [[1, 'list'], [3, 'stat']]) {
    const S = scene.scenes[i];
    const pic = S.layers.find((L) => L.type === 'image');
    assert.ok(pic, `${kind} shows its picture`);
    const col = S.layers.filter((L) => L.type === 'text' || L.type === 'counter');
    assert.ok(col.length && col.every((L) => (pic.x > 0.5 ? L.x < 0.5 : L.x > 0.5)), `${kind}: words on the other side`);
    assert.ok(pic.y * 1080 - pic.h / 2 >= -1 && pic.y * 1080 + pic.h / 2 <= 1081, `${kind}: inside the frame`);
  }
  assert.ok(scene.scenes[3].layers.some((L) => L.type === 'counter' && L.to === 3));
});
await claim('the same picture on two beats in a row is carried into a larger second look', () => {
  const { scene } = compileStoryboard(story2, { style: 'studio', aspect: '16:9', targetDuration: 20, assets: ASSETS });
  const S = scene.scenes[2], prev = scene.scenes[1];
  assert.equal(S.transition.kind, 'carry');
  const from = prev.layers.find((L) => L.id === S.transition.carry.from), to = S.layers.find((L) => L.id === S.transition.carry.to);
  assert.equal(from.asset, 'image-tall'); assert.equal(to.asset, 'image-tall');
  assert.ok(to.h > from.h, 'larger the second time');
  assert.ok(S.camera.zoom[1] > S.camera.zoom[0], 'the camera eases in');
});
await claim('a carried picture is drawn once, between its two places, part way across', () => {
  const { scene } = compileStoryboard(story2, { style: 'studio', aspect: '16:9', targetDuration: 20, assets: ASSETS });
  const S = scene.scenes[2];
  const kit = createKit(fakeContext(scene.width, scene.height), { width: scene.width, height: scene.height, palette: scene.palette, assets: { 'image-tall': { width: 900, height: 1600 }, 'image-wide': { width: 2400, height: 1500 } } });
  const boxes = [];
  renderPlan(kit, scene, S.start + S.transition.duration / 2, { collect: boxes });
  const mid = boxes.filter((b) => b.kind === 'image');
  assert.equal(mid.length, 1);
  const from = scene.scenes[1].layers.find((L) => L.id === S.transition.carry.from), to = S.layers.find((L) => L.id === S.transition.carry.to);
  assert.ok(mid[0].h > from.h * 0.99 && mid[0].h < to.h * 1.07, 'part way between its two sizes');
});
await claim('a picture can unfold from its top edge', () => {
  const L = normalizeScene({ assets: { 'image-wide': ASSETS['image-wide'] }, scenes: [{ duration: 3, layers: [{ type: 'image', asset: 'image-wide', w: 400, h: 300, in: { preset: 'unfold', duration: 1 } }] }] }).scene.scenes[0].layers[0];
  assert.equal(L.in.preset, 'unfold');
  assert.deepEqual(layerState(L, 0.3).clip.from, 'top');
  assert.equal(layerState(L, 2).clip.p, 1);
});

section('The director, end to end');
const brief = { brief: 'A teaser for an invented app, using the screenshot I gave you.', style: 'studio', aspect: '16:9', seconds: 20, tier: 'guided' };
await claim('a model that ignores the person’s media still makes a film that shows it, and it was told about it', async () => {
  let system = '';
  const log = [];
  const d = createDirector({
    ask: async ({ purpose, system: sys, messages }) => {
      if (purpose === 'storyboard') { system = sys; assert.equal(messages[0].images?.length, 1); return JSON.stringify(STORYBOARD); }
      if (purpose === 'pictures') return JSON.stringify({ pictures: [] });
      throw new Error(`no answer for ${purpose}`);
    },
    measure: async ({ scene }, times) => measure(scene, times), trial: async () => ({ ok: true }), sheet: async () => null, log: (e) => log.push(e),
  });
  const assets = { 'image-wide': ASSETS['image-wide'] };
  const out = await d.make({ ...brief, assets, media: mediaList(assets), mediaImages: [PIXEL] });
  assert.match(system, /The person gave their own media/);
  assert.ok(out.scene.scenes.some((S) => S.layers.some((L) => L.type === 'image' && L.asset === 'image-wide')));
  assert.ok(out.scene.assets['image-wide']);
  assert.ok(log.some((e) => e.status === 'note' && /put on the film's beats/.test(e.detail)));
});
done();
