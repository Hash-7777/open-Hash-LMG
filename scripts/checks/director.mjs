// The director end to end, with a scripted model and the stand-in canvas, in
// each of the three ways of working: the steps run in order, what the model
// writes is checked and repaired, a model's answer that cannot be read is
// asked for again or set aside, code that breaks the rules is sent back, and
// a change asked for afterwards lands.

import assert from 'node:assert/strict';
import { section, claim, done } from './lib/check.mjs';
import { STORYBOARD, measure, loadCode } from './lib/fixtures.mjs';
import { createDirector } from '../../src/core/director/pipeline.js';
import { compileStoryboard } from '../../src/core/scene/compile.js';
import { sceneForModel } from '../../src/core/director/pipeline.js';
import { reviseInParts, partsOf, compact, mergePart, takeSaid } from '../../src/core/director/design.js';
import { PART_DESIGN_TASK, revisePartTask } from '../../src/core/director/prompts.js';

const GOOD_CODE = '```js\nexport default function render(t, lmg) {\n  lmg.clear("bg");\n  lmg.text("Lumen", lmg.W / 2, lmg.H / 2, { size: 120 * lmg.u, color: "ink" });\n}\n```';
const BAD_CODE = '```js\nexport default function render(t, lmg) { const x = Math.random(); lmg.clear("bg"); }\n```';

function director(script, log = []) {
  const asked = [];
  const d = createDirector({
    ask: async ({ purpose, system, messages }) => {
      asked.push(purpose);
      const next = script[purpose];
      const reply = typeof next === 'function' ? next(messages, system) : Array.isArray(next) ? next.shift() : next;
      if (reply === undefined) throw new Error(`no scripted answer for ${purpose}`);
      return typeof reply === 'string' ? reply : JSON.stringify(reply);
    },
    measure: async ({ scene, code }, times) => measure(scene, times, code ? await loadCode(code) : null),
    trial: async ({ scene, code }) => { try { const r = await loadCode(code); measure(scene, [0, 1], r); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } },
    sheet: async () => null,
    log: (e) => log.push(e),
  });
  return { d, asked, log };
}

const opts = { brief: 'A launch film for Lumen Desk, an invented lamp.', style: 'studio', aspect: '16:9', seconds: 30 };

section('Guided: the model writes words, the app does the rest');
await claim('a film comes back, laid out and timed', async () => {
  const { d, asked, log } = director({ storyboard: STORYBOARD });
  const out = await d.make({ ...opts, tier: 'guided' });
  assert.equal(out.tier, 'guided'); assert.ok(out.scene.scenes.length >= 8); assert.equal(out.code, null);
  assert.deepEqual(asked, ['storyboard', 'pictures']);
  assert.ok(log.some((e) => e.id === 'check' && e.status === 'done'));
});
await claim('an answer that is not a storyboard is asked for again', async () => {
  const { d, asked } = director({ storyboard: ['I would love to help!', STORYBOARD] });
  await d.make({ ...opts, tier: 'guided' });
  assert.deepEqual(asked, ['storyboard', 'storyboard', 'pictures']);
});
await claim('two unreadable answers end with a plain sentence', async () => {
  const { d } = director({ storyboard: ['no', 'still no'] });
  await assert.rejects(d.make({ ...opts, tier: 'guided' }), /did not write a storyboard/);
});
await claim('an empty brief is refused before any model is asked', async () => {
  const { d, asked } = director({});
  await assert.rejects(d.make({ ...opts, brief: '  ', tier: 'guided' }), /Describe the film/);
  assert.equal(asked.length, 0);
});

section('Guided: several storyboards, the cleanest kept');
const LONG = { title: 'Lumen', beats: Array.from({ length: 12 }, (_, i) => ({ kind: i === 0 ? 'hook' : i === 11 ? 'end' : 'statement', text: 'This line runs on with far too many words for anyone to read in time ' + i })) };
const SHORT = { title: 'Lumen', beats: [{ kind: 'hook', text: 'Your desk is loud.' }, { kind: 'title', text: 'Lumen', sub: 'The quiet lamp' }, { kind: 'stat', value: 38, suffix: '%', sub: 'fewer interruptions' }, { kind: 'end', text: 'Lumen', sub: 'lumen.example' }] };
await claim('of two storyboards, the one nearer the length with fewer problems is kept', async () => {
  const { d, asked, log } = director({ storyboard: [LONG, SHORT] });
  const out = await d.make({ ...opts, seconds: 15, tier: 'guided', drafts: 2 });
  assert.deepEqual(asked, ['storyboard', 'storyboard', 'pictures']);
  assert.equal(out.storyboard.beats.length, 4);
  assert.ok(log.some((e) => e.status === 'note' && /kept the cleanest, storyboard 2/.test(e.detail)));
});
await claim('a draft that cannot be read is set aside, not fatal', async () => {
  const { d, log } = director({ storyboard: ['nope', 'still nope', SHORT] });
  const out = await d.make({ ...opts, seconds: 15, tier: 'guided', drafts: 2 });
  assert.equal(out.storyboard.beats.length, 4);
  assert.ok(log.some((e) => e.status === 'note' && /set aside/.test(e.detail)));
});
await claim('stopping while drafting stops at once', async () => {
  const d = createDirector({ ask: async () => { throw Object.assign(new Error('Stopped.'), { stopped: true }); }, measure: async () => [], trial: async () => ({ ok: true }), sheet: async () => null });
  await assert.rejects(d.make({ ...opts, tier: 'guided', drafts: 3 }), (e) => e.stopped === true);
});
await claim('only the guided way writes several', async () => {
  const draft = compileStoryboard(STORYBOARD, { style: 'studio', targetDuration: 30 }).scene;
  const { d, asked } = director({ storyboard: [STORYBOARD, STORYBOARD], plan: sceneForModel(draft) });
  await d.make({ ...opts, tier: 'plan', drafts: 2, rounds: 0 });
  assert.equal(asked.filter((p) => p === 'storyboard').length, 1);
});

section('Plan: the model redesigns the rule-made draft, a few scenes at a time');
// A scripted designer: gives back the scenes it was shown, each with a slow push.
const partScenes = (messages) => JSON.parse(messages[0].content.split('made by rule:\n')[1].split('\n\n')[0]);
const designer = (messages) => ({ scenes: partScenes(messages).map((S) => ({ ...S, camera: { zoom: [1, 1.07] } })) });
await claim('a redesign is asked for in parts and used, normalised', async () => {
  const { d, asked } = director({ storyboard: STORYBOARD, 'plan part': designer });
  const out = await d.make({ ...opts, tier: 'plan', rounds: 0 });
  assert.ok(asked.filter((p) => p === 'plan part').length >= 2, 'more than one part');
  assert.ok(out.scene.scenes.every((S) => S.camera?.zoom?.[1] === 1.07), 'every part was used');
});
await claim('each part is shown only its own scenes, after the same brief and outline', async () => {
  const seen = [];
  const { d } = director({ storyboard: STORYBOARD, 'plan part': (messages) => { seen.push(messages[0].content); return designer(messages); } });
  const out = await d.make({ ...opts, tier: 'plan', rounds: 0 });
  const shown = seen.map((c) => partScenes([{ content: c }]).map((S) => S.id));
  assert.deepEqual(shown.flat(), out.scene.scenes.map((S) => S.id));
  const lead = (c) => c.split('\n\nDesign scenes')[0];
  assert.ok(seen.every((c) => lead(c) === lead(seen[0])), 'every part starts the same way');
});
await claim('a part that fails keeps its rule-made scenes, and the other parts are used', async () => {
  let n = 0;
  const { d, log } = director({ storyboard: STORYBOARD, 'plan part': (messages) => { if (n++ === 1) throw new Error('The service used all the room it was given.'); return designer(messages); } });
  const out = await d.make({ ...opts, tier: 'plan', rounds: 0 });
  const pushed = out.scene.scenes.filter((S) => S.camera?.zoom?.[1] === 1.07).length;
  assert.ok(pushed > 0 && pushed < out.scene.scenes.length);
  assert.ok(log.some((e) => e.status === 'note' && /all the room.*keep the rule-made design/.test(e.detail)));
});
await claim('a redesign that cannot be read keeps the rule-made film, saying so', async () => {
  const { d, log } = director({ storyboard: STORYBOARD, 'plan part': 'not json at all' });
  const out = await d.make({ ...opts, tier: 'plan', rounds: 0 });
  assert.ok(out.scene.scenes.length >= 8);
  assert.ok(log.some((e) => e.status === 'note' && /could not be read; they keep the rule-made design/.test(e.detail)));
});
await claim('a revision sends only the scenes the checks named', async () => {
  const draft = compileStoryboard(STORYBOARD, { style: 'studio', targetDuration: 30 }).scene;
  const target = draft.scenes[2].id;
  const sent = [];
  const askJson = async (system, content) => { sent.push(content); return { scenes: JSON.parse(content.split('):\n')[1].split('\n\nReply')[0]) }; };
  const out = await reviseInParts({ askJson, note: () => {}, system: 's', brief: 'b', scene: draft, issues: [{ level: 'warn', message: 'Too small.', scene: target }], task: () => 'Fix it.' });
  assert.equal(sent.length, 1);
  assert.match(sent[0], new RegExp(`ids ${target}\\)`));
  assert.equal(out.scenes.length, draft.scenes.length);
});
await claim('a problem that names no scene sends every scene, still in parts', async () => {
  const draft = compileStoryboard(STORYBOARD, { style: 'studio', targetDuration: 30 }).scene;
  let parts = 0;
  const askJson = async () => { parts++; return null; };
  await reviseInParts({ askJson, note: () => {}, system: 's', brief: 'b', scene: draft, issues: [{ level: 'warn', message: 'Too many transitions.' }], task: () => 'Fix it.' });
  assert.equal(parts, partsOf(draft.scenes).length);
});
await claim('parts are even, and never leave one scene alone', () => {
  assert.deepEqual(partsOf([1, 2, 3, 4, 5, 6]).map((p) => p.length), [3, 3]);
  assert.deepEqual(partsOf(Array.from({ length: 13 })).map((p) => p.length), [5, 5, 3]);
  assert.deepEqual(partsOf([1, 2, 3]).map((p) => p.length), [3]);
});
await claim('what a model is shown leaves out empty values and rounds numbers, nothing else', () => {
  assert.deepEqual(compact({ a: 1.23456, b: null, c: '', d: [], e: {}, f: [0.1 + 0.2, { g: undefined, h: 'x' }], i: false, j: 0 }), { a: 1.235, f: [0.3, { h: 'x' }], i: false, j: 0 });
});
await claim('a part answered with scenes in place of ids is merged by place', () => {
  const scenes = [{ id: 'a', layers: [] }, { id: 'b', layers: [] }, { id: 'c', layers: [] }];
  const { scenes: out, used } = mergePart(scenes, ['b', 'c'], { scenes: [{ id: 'x', layers: [{ type: 'text' }] }, { id: 'c', layers: [{ type: 'shape' }] }] });
  assert.equal(used, 2);
  assert.deepEqual(out.map((S) => S.id), ['a', 'b', 'c']);
  assert.equal(out[1].layers[0].type, 'text');
});

section('The finished film keeps to the length asked for');
await claim('a design that holds every scene too long comes back near the length asked for, saying so', async () => {
  // A scripted designer that gives every scene four tenths more time, each arrival later too.
  const slow = (messages) => ({ scenes: partScenes(messages).map((S) => ({ ...S, duration: S.duration * 1.4, layers: S.layers.map((L) => ({ ...L, at: (L.at || 0) * 1.4, until: L.until >= S.duration - 0.011 ? S.duration * 1.4 : L.until * 1.4, out: L.out?.at !== undefined && L.out?.at !== null ? { ...L.out, at: S.duration * 1.4 - (S.duration - L.out.at) } : L.out })) })) });
  const { d, log } = director({ storyboard: STORYBOARD, 'plan part': slow });
  const out = await d.make({ ...opts, tier: 'plan', rounds: 0 });
  assert.ok(out.scene.duration <= opts.seconds * 1.1, `runs ${out.scene.duration.toFixed(1)} s for ${opts.seconds}`);
  assert.ok(log.some((e) => e.status === 'note' && /Brought the film back to the 30 s asked for/.test(e.detail)));
});

section('Words on screen and the voice change together');
await claim('a part shows each scene with the line the voice says over it', async () => {
  const draft = compileStoryboard(STORYBOARD, { style: 'studio', targetDuration: 30, narration: true }).scene;
  const line = draft.voice.lines[0];
  assert.ok(line, 'the draft has narration');
  const sent = [];
  const askJson = async (system, content) => { sent.push(content); return null; };
  await reviseInParts({ askJson, note: () => {}, system: 's', brief: 'b', scene: draft, issues: [{ level: 'warn', message: 'x', scene: line.scene }], task: () => 'Fix it.' });
  const shown = JSON.parse(sent[0].split('):\n')[1].split('\n\nReply')[0]);
  assert.equal(shown[0].say, line.say || line.text);
});
await claim('a rewritten "say" replaces that scene\u2019s line, to be spoken again; one given back as it was keeps its voice', () => {
  const scene = { voice: { engine: 'kokoro', lines: [{ scene: 'a', text: 'Old words here.', say: '', clip: 'voice-1' }, { scene: 'b', text: 'Kept line.', say: '', clip: 'voice-2' }] } };
  const { scenes, voice } = takeSaid(scene, [{ id: 'a', layers: [], say: 'New words  here.' }, { id: 'b', layers: [], say: 'Kept line.' }, { id: 'c', layers: [] }]);
  assert.ok(scenes.every((S) => !('say' in S)), 'say is no scene field');
  assert.deepEqual(voice.lines[0], { scene: 'a', text: 'New words here.', say: '', clip: null });
  assert.equal(voice.lines[1].clip, 'voice-2');
});
await claim('a redesign is told to change words and voice together, and a brief fix to touch one scene only', () => {
  assert.match(PART_DESIGN_TASK, /rewrite its "say" to match/);
  const t = revisePartTask([{ level: 'warn', message: 'The brief asks the film to show "x".' }]);
  assert.match(t, /ONE scene closest to it in meaning, never into several/); assert.match(t, /rewrite its "say" to match/);
});

section('Code: the model writes its own drawing code');
await claim('code that follows the rules is kept', async () => {
  const { d } = director({ storyboard: STORYBOARD, code: GOOD_CODE });
  const out = await d.make({ ...opts, tier: 'code', rounds: 0 });
  assert.equal(out.tier, 'code'); assert.match(out.code, /export default function render/);
});
await claim('code that reads randomness is sent back once, then the fix is kept', async () => {
  const { d, asked } = director({ storyboard: STORYBOARD, code: BAD_CODE, 'revise code': GOOD_CODE });
  const out = await d.make({ ...opts, tier: 'code', rounds: 0 });
  assert.deepEqual(asked, ['storyboard', 'code', 'revise code']); assert.ok(!/Math\.random/.test(out.code));
});
await claim('code that never gets right falls back to the scene plan', async () => {
  const { d } = director({ storyboard: STORYBOARD, code: BAD_CODE, 'revise code': BAD_CODE });
  const out = await d.make({ ...opts, tier: 'code', rounds: 0 });
  assert.equal(out.code, null); assert.equal(out.tier, 'plan');
});

section('A change asked for afterwards');
await claim('guided: the storyboard is rewritten and laid out again', async () => {
  const changed = structuredClone(STORYBOARD); changed.beats[0].text = 'Your desk is *quiet*.';
  const { d } = director({ storyboard: STORYBOARD, edit: changed });
  const made = await d.make({ ...opts, tier: 'guided' });
  const out = await d.edit({ ...made, edited: false }, 'make the hook calmer', { seconds: 30 });
  assert.match(JSON.stringify(out.scene), /quiet/);
});
await claim('a change that cannot be read changes nothing and says so', async () => {
  const { d } = director({ storyboard: STORYBOARD, edit: 'sorry' });
  const made = await d.make({ ...opts, tier: 'guided' });
  await assert.rejects(d.edit({ ...made, edited: false }, 'anything'), /Nothing was changed/);
});
done();
