// Looking things up before the storyboard: what is offered, that nothing is
// looked up without the person's yes, how a page is read as text, and that
// the notes reach the storyboard step and no other.

import assert from 'node:assert/strict';
import { section, claim, done } from './lib/check.mjs';
import { STORYBOARD, measure } from './lib/fixtures.mjs';
import { urlsInBrief, pageText, notesFrom, research, researchBlock } from '../../src/core/research/research.js';
import { createDirector } from '../../src/core/director/pipeline.js';

const web = (log = []) => ({
  search: async (q) => { log.push(`search ${q}`); return { ok: true, source: 'Wikipedia', results: [{ title: 'Example Lamp', url: 'https://en.wikipedia.org/wiki/Example', snippet: 'An invented lamp from an invented maker, 2026.' }] }; },
  fetch: async (u) => { log.push(`read ${u}`); return { ok: true, contentType: 'text/html', text: '<html><head><title>Lamp Co</title><script>steal()</script></head><body><p>The quiet lamp &amp; desk light.</p><nav>menu</nav></body></html>' }; },
});

section('What is offered');
await claim('addresses in the brief are offered, once each, without trailing punctuation', () => {
  assert.deepEqual(urlsInBrief('See https://lamp.example/about, and (https://lamp.example/about). Also http://b.example/x?y=1.'), ['https://lamp.example/about', 'http://b.example/x?y=1']);
  assert.deepEqual(urlsInBrief('no links here'), []);
});
await claim('a page is read as its words: no scripts, styles or menus, entities read, the title first', () => {
  const t = pageText('<html><head><title>Lamp Co</title><style>p{}</style><script>steal()</script></head><body><p>The quiet lamp &amp; desk&nbsp;light &#8212; now.</p><nav>menu</nav></body></html>', 'text/html');
  assert.equal(t, 'Lamp Co\nThe quiet lamp & desk light — now.');
  assert.equal(pageText('plain words', 'text/plain'), 'plain words');
});
await claim('notes say where each came from and stay short', () => {
  const notes = notesFrom({ found: [{ ok: true, query: 'lamp', source: 'Wikipedia', results: [{ title: 'Lamp', url: 'https://w.example/Lamp', snippet: 'x'.repeat(2000) }] }], read: [{ ok: true, url: 'https://lamp.example', text: 'y'.repeat(9000) }] });
  assert.match(notes, /Search "lamp" \(Wikipedia\)/); assert.match(notes, /https:\/\/w\.example\/Lamp/); assert.match(notes, /Page https:\/\/lamp\.example/);
  assert.ok(notes.length <= 6010);
  assert.match(researchBlock(notes), /never add a fact that is in neither the brief nor these notes/);
  assert.equal(researchBlock(''), '');
});

section('Nothing is looked up without a yes');
await claim('when the model needs nothing and the brief names no page, the person is not asked', async () => {
  let asked = false;
  const out = await research({ askJson: async () => ({ searches: [] }), permit: async () => { asked = true; return null; }, web: web(), brief: 'A calm film.' });
  assert.equal(asked, false); assert.equal(out.notes, '');
});
await claim('a no looks nothing up', async () => {
  const log = [];
  const out = await research({ askJson: async () => ({ searches: ['Example Lamp'] }), permit: async () => null, web: web(log), brief: 'A film for Example Lamp, see https://lamp.example' });
  assert.deepEqual(log, []); assert.equal(out.notes, ''); assert.equal(out.asked, true);
});
await claim('only what the person left ticked is looked up', async () => {
  const log = [];
  let offered = null;
  const out = await research({ askJson: async () => ({ searches: ['Example Lamp', 'lamp sales'] }), permit: async (w) => { offered = w; return { searches: ['Example Lamp'], pages: [] }; }, web: web(log), brief: 'A film for Example Lamp, see https://lamp.example' });
  assert.deepEqual(offered, { searches: ['Example Lamp', 'lamp sales'], pages: ['https://lamp.example'] });
  assert.deepEqual(log, ['search Example Lamp']);
  assert.match(out.notes, /An invented lamp/);
});
await claim('a model that asks for too much is held to three searches', async () => {
  let offered = null;
  await research({ askJson: async () => ({ searches: ['a', 'b', 'c', 'd', 'e'] }), permit: async (w) => { offered = w; return null; }, web: web(), brief: 'b' });
  assert.equal(offered.searches.length, 3);
});

section('The notes reach the storyboard step, and no other');
await claim('a film made with research has the notes in its storyboard request only', async () => {
  const seen = {};
  const d = createDirector({
    ask: async ({ purpose, messages }) => {
      seen[purpose] = messages[0].content;
      if (purpose === 'research') return JSON.stringify({ searches: ['Example Lamp'] });
      if (purpose === 'storyboard') return JSON.stringify(STORYBOARD);
      if (purpose === 'pictures') return JSON.stringify({ pictures: [] });
      throw new Error(`no answer for ${purpose}`);
    },
    measure: async ({ scene }, times) => measure(scene, times), trial: async () => ({ ok: true }), sheet: async () => null,
    web: web(), permit: async (w) => w,
  });
  await d.make({ brief: 'A film for Example Lamp.', style: 'studio', aspect: '16:9', seconds: 20, tier: 'guided', research: true });
  assert.match(seen.storyboard, /Notes looked up on the web/); assert.match(seen.storyboard, /An invented lamp/);
  assert.ok(!/An invented lamp/.test(seen.pictures || ''));
});
await claim('without research, no question about it is asked', async () => {
  const asked = [];
  const d = createDirector({
    ask: async ({ purpose }) => { asked.push(purpose); return JSON.stringify(purpose === 'storyboard' ? STORYBOARD : { pictures: [] }); },
    measure: async ({ scene }, times) => measure(scene, times), trial: async () => ({ ok: true }), sheet: async () => null, web: web(), permit: async (w) => w,
  });
  await d.make({ brief: 'A film.', style: 'studio', aspect: '16:9', seconds: 20, tier: 'guided' });
  assert.ok(!asked.includes('research'));
});
done();
