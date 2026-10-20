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
  assert.deepEqual(asked, ['storyboard']);
  assert.ok(log.some((e) => e.id === 'check' && e.status === 'done'));
});
await claim('an answer that is not a storyboard is asked for again', async () => {
  const { d, asked } = director({ storyboard: ['I would love to help!', STORYBOARD] });
  await d.make({ ...opts, tier: 'guided' });
  assert.deepEqual(asked, ['storyboard', 'storyboard']);
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

section('Plan: the model redesigns the rule-made draft');
await claim('a redesign is used, normalised', async () => {
  const draft = compileStoryboard(STORYBOARD, { style: 'studio', targetDuration: 30 }).scene;
  const redesign = sceneForModel(draft);
  redesign.title = 'Redesigned';
  const { d } = director({ storyboard: STORYBOARD, plan: redesign, revise: redesign });
  const out = await d.make({ ...opts, tier: 'plan' });
  assert.equal(out.scene.title, 'Redesigned');
});
await claim('a redesign that cannot be read keeps the rule-made film', async () => {
  const { d, log } = director({ storyboard: STORYBOARD, plan: 'not json at all' });
  const out = await d.make({ ...opts, tier: 'plan', rounds: 0 });
  assert.ok(out.scene.scenes.length >= 8);
  assert.ok(log.some((e) => e.status === 'note' && /rule-made design is kept/.test(e.detail)));
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
