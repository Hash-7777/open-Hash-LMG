// The film held to its brief: statements read safely from what a model
// writes, each kind judged correctly against a film measured as it is drawn,
// a film from drawing code checked the same way, and a guided film that
// misses something sent back once for a storyboard that shows it.

import assert from 'node:assert/strict';
import { section, ok, claim, done } from './lib/check.mjs';
import { STORYBOARD, measure, loadCode } from './lib/fixtures.mjs';
import { normalizeIntent, verifyIntent, intentTimes, intentFailures } from '../../src/core/director/intent.js';
import { compileStoryboard } from '../../src/core/scene/compile.js';
import { normalizeStoryboard } from '../../src/core/scene/storyboard.js';
import { createDirector } from '../../src/core/director/pipeline.js';

section('Statements are read safely');
await claim('unknown checks and empty subjects are dropped, before and after need another subject', () => {
  const got = normalizeIntent({ checks: [{ subject: 'Lumen', check: 'appears' }, { subject: '', check: 'appears' }, { subject: 'x', check: 'sparkles' }, { subject: 'a', check: 'before' }, { subject: 'Lumen', check: 'holds', seconds: 'lots' }] });
  assert.deepEqual(got, [{ subject: 'lumen', check: 'appears' }, { subject: 'lumen', check: 'holds', seconds: 1.5 }]);
});
await claim('no more than six', () => assert.equal(normalizeIntent({ checks: Array.from({ length: 10 }, () => ({ subject: 'a', check: 'appears' })) }).length, 6));

section('Each kind of statement, on a real film');
const scene = compileStoryboard(normalizeStoryboard(STORYBOARD).storyboard, { style: 'studio', targetDuration: 40 }).scene;
const samples = measure(scene, intentTimes(scene.duration));
const flat = (list) => list.flatMap((L) => [L, ...flat(L.layers || [])]);
const counters = scene.scenes.flatMap((S) => flat(S.layers)).filter((L) => L.type === 'counter');
const judge = (c) => verifyIntent(normalizeIntent({ checks: [c] }), samples, { duration: scene.duration, width: scene.width, counters })[0];
ok('appears: a line in the film', judge({ subject: 'Lumen Desk', check: 'appears' }).ok);
ok('appears: a line not in the film', !judge({ subject: 'free trial', check: 'appears' }).ok);
ok('before: the hook before the name', judge({ subject: 'Your desk is loud', check: 'before', other: 'The quiet workspace' }).ok);
ok('after: the hook is not after the name', !judge({ subject: 'Your desk is loud', check: 'after', other: 'The quiet workspace' }).ok);
ok('ends: the end card is on screen at the end', judge({ subject: 'lumen.example', check: 'ends' }).ok);
ok('ends: the hook is not', !judge({ subject: 'Your desk is loud', check: 'ends' }).ok);
ok('counts: the stat counts up', judge({ subject: '38%', check: 'counts' }).ok);
ok('enters-from: the stat rises from below', judge({ subject: '38%', check: 'enters-from', from: 'below' }).ok);
ok('enters-from: and not from above', !judge({ subject: '38%', check: 'enters-from', from: 'above' }).ok);
ok('holds: the name holds a second and a half', judge({ subject: 'Lumen Desk', check: 'holds', seconds: 1.5 }).ok);
ok('holds: but not half a minute', !judge({ subject: 'Lumen Desk', check: 'holds', seconds: 30 }).ok);
ok('a failure is said as a sentence', /asks the film to show "free trial", but it never appears/.test(intentFailures([judge({ subject: 'free trial', check: 'appears' })])[0]));

section('A film drawn by code is checked the same way');
await claim('lines the code draws are seen, and counted figures count', async () => {
  const code = 'export default function render(t, lmg) { lmg.clear("bg"); lmg.text("Orbit", lmg.W / 2, lmg.H / 3, { size: 90 * lmg.u }); lmg.text(lmg.formatNumber(Math.round(lmg.tween(t, 0, 2, 0, 500)), 0) + "+", lmg.W / 2, lmg.H * 0.6, { size: 120 * lmg.u }); }';
  const s2 = { ...scene, duration: 3 };
  const smp = measure(s2, intentTimes(3), await loadCode(code));
  const r = verifyIntent(normalizeIntent({ checks: [{ subject: 'Orbit', check: 'appears' }, { subject: '500+', check: 'counts' }] }), smp, { duration: 3, width: s2.width });
  assert.deepEqual(r.map((x) => x.ok), [true, true]);
});

section('A guided film that misses something goes back once');
await claim('the second storyboard shows what was missing and is kept', async () => {
  const withTrial = structuredClone(STORYBOARD);
  withTrial.beats.splice(1, 0, { kind: 'statement', text: 'Free trial today' });
  const answers = { storyboard: [STORYBOARD, withTrial], intent: [{ checks: [{ subject: 'Free trial', check: 'appears' }] }] };
  const asked = [], log = [];
  const d = createDirector({
    ask: async ({ purpose }) => { asked.push(purpose); return JSON.stringify(answers[purpose].shift()); },
    measure: async ({ scene: s, code }, times) => measure(s, times, code ? await loadCode(code) : null),
    trial: async () => ({ ok: true }), sheet: async () => null, log: (e) => log.push(e),
  });
  const out = await d.make({ brief: 'A launch film with a free trial offer.', tier: 'guided', style: 'studio', seconds: 40, verify: true });
  assert.deepEqual(asked, ['storyboard', 'intent', 'storyboard']);
  assert.ok(out.brief.every((r) => r.ok));
  assert.ok(log.some((e) => e.status === 'note' && /shows everything the brief asked for/.test(e.detail)));
});
await claim('a list that cannot be read lets the film be made without it', async () => {
  const answers = { storyboard: [STORYBOARD], intent: ['not a list'] };
  const d = createDirector({
    ask: async ({ purpose }) => { const a = answers[purpose].shift(); return typeof a === 'string' ? a : JSON.stringify(a); },
    measure: async ({ scene: s }, times) => measure(s, times), trial: async () => ({ ok: true }), sheet: async () => null,
  });
  const out = await d.make({ brief: 'A film.', tier: 'guided', style: 'studio', seconds: 40, verify: true });
  assert.equal(out.brief, null);
});
done();
