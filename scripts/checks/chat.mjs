// The director's conversation: what each turn sends, how a reply is held to
// what the panel can show, how a conversation is kept with its film, and the
// brief that asks for a voice.

import assert from 'node:assert/strict';
import { section, claim, done } from './lib/check.mjs';
import { chatPrompt, chatSystem, chatMessages, filmState, normalizeChatReply, STILL_TO_COME, normalizeChat, ASKS_FOR_NARRATION } from '../../src/core/director/chat.js';
import { normalizeProject } from '../../src/app/store.js';

section('What a turn sends');
await claim('the system text names what a film needs, the person’s media, and a missing voice', () => {
  const p = chatPrompt({ hasFilm: false, media: [{ kind: 'image', name: 'App screen.png' }], narrationReady: false });
  for (const part of ['length', 'frame', 'look', 'narrate', 'a picture "App screen.png"', 'needs a voice chosen in Settings', 'Reply with JSON only']) assert.ok(p.includes(part), part);
  assert.ok(!p.includes('"change"'));
  assert.ok(chatPrompt({ hasFilm: true, narrationReady: true }).includes('"change"'));
  assert.ok(!chatPrompt({ narrationReady: true }).includes('needs a voice'));
});
await claim('a turn carries the last twelve messages, starting with the person, and the film\u2019s state with the newest', () => {
  const history = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'director' : 'person', text: `m${i}`, ...(i % 2 ? { questions: [{ ask: 'q', options: ['a'] }] } : {}) }));
  const msgs = chatMessages(history, 'STATE');
  assert.equal(msgs.length, 12);
  assert.equal(msgs[0].role, 'user'); assert.equal(msgs[0].content, 'm18');
  assert.deepEqual(JSON.parse(msgs.at(-1).content), { reply: 'm29', questions: [{ ask: 'q', options: ['a'] }] });
  assert.equal(msgs.at(-2).content, 'STATE\n\nm28');
  assert.equal(msgs.filter((m) => m.content.startsWith('STATE')).length, 1);
  assert.equal(chatMessages([{ role: 'director', text: 'hello' }, { role: 'person', text: 'a film' }], 'S')[0].content, 'S\n\na film');
  assert.deepEqual(chatMessages([], 'S'), []);
});
await claim('the film’s state is a few lines: the settings, and the film made so far', () => {
  const st = filmState({ brief: 'A teaser.', scene: { title: 'Demo', scenes: [{}, {}], duration: 12.34 } }, { film: { seconds: 15, aspect: '9:16', style: 'mono', narration: true } });
  assert.match(st, /15 seconds, 9:16, look mono, narration on/); assert.match(st, /"Demo", 2 scenes, 12\.3 seconds/);
});

section('A reply, held to what the panel can show');
await claim('questions keep at most two, each with up to four short answers', () => {
  const r = normalizeChatReply({ reply: 'Hi', action: 'ask', questions: Array.from({ length: 5 }, (_, i) => ({ ask: `Q${i}`, options: ['a', 'b', 'c', 'd', 'e', 'f', ''] })) });
  assert.equal(r.questions.length, 2); assert.equal(r.questions[0].options.length, 4);
});
await claim('an answer that only means the person will type one is left out', () => {
  const r = normalizeChatReply({ reply: 'Hi', action: 'ask', questions: [{ ask: 'What is it called?', options: ['Brightway', "I'll type the name", 'Other', 'Let me write it', 'Lumen'] }] });
  assert.deepEqual(r.questions[0].options, ['Brightway', 'Lumen']);
});
await claim('a film is not made while the person has said something is still to come from them', () => {
  const r = normalizeChatReply({ reply: 'Making it.', action: 'make', brief: 'A film.', film: { seconds: 30 } }, { waiting: true });
  assert.equal(r.action, 'ask'); assert.equal(r.brief, ''); assert.match(r.reply, /type it/);
  assert.ok(STILL_TO_COME.test('I will write the product name')); assert.ok(STILL_TO_COME.test("I'll send the logo"));
  assert.ok(!STILL_TO_COME.test('Make it 45 seconds, for Mac users'));
  assert.equal(normalizeChatReply({ reply: 'Making it.', action: 'make', brief: 'A film.' }).action, 'make');
});
await claim('the system text asks for few questions, real answers only, and waiting for what is promised', () => {
  const p = chatPrompt({});
  assert.match(p, /two at most/); assert.match(p, /Never offer an answer such as "other"/); assert.match(p, /wait for it/);
});
await claim('a make without a brief, or a change without words, is not acted on', () => {
  assert.equal(normalizeChatReply({ reply: 'x', action: 'make' }).action, 'ask');
  assert.equal(normalizeChatReply({ reply: 'x', action: 'change' }, { hasFilm: true }).action, 'answer');
  assert.equal(normalizeChatReply({ reply: 'x', action: 'change', change: 'bigger' }).action, 'ask', 'no change before a film exists');
});
await claim('film settings are kept only where they are real choices, a length taken to the nearest offered', () => {
  const r = normalizeChatReply({ reply: 'ok', action: 'make', brief: 'A film.', film: { seconds: 40, aspect: '21:9', style: 'nonsense', narration: true, useMedia: false } });
  assert.deepEqual(r.film, { seconds: 45, narration: true, useMedia: false });
  assert.deepEqual(normalizeChatReply({ reply: 'ok', action: 'make', brief: 'b', film: { aspect: '9:16', style: 'studio' } }).film, { aspect: '9:16', style: 'studio' });
});
await claim('a reply that is not JSON is shown as words, asking nothing', () => {
  const r = normalizeChatReply('Sure, tell me more about who it is for.');
  assert.equal(r.action, 'ask'); assert.match(r.reply, /who it is for/); assert.deepEqual(r.questions, []);
});

section('A conversation kept with its film');
await claim('messages are kept with their questions and brief, odd entries dropped, the newest sixty', () => {
  const chat = normalizeChat([{ role: 'person', text: 'hi', at: 1 }, { role: 'director', text: 'Which frame?', questions: [{ ask: 'Frame?', options: ['16:9 wide'] }], at: 2 }, { role: 'system', text: 'x' }, { role: 'person', text: '' }, 'junk', { role: 'director', text: 'Ready.', kind: 'made', brief: 'A film.' }]);
  assert.equal(chat.length, 3); assert.equal(chat[1].questions[0].ask, 'Frame?'); assert.equal(chat[2].kind, 'made'); assert.equal(chat[2].brief, 'A film.');
  assert.equal(normalizeChat(Array.from({ length: 80 }, (_, i) => ({ role: 'person', text: `m${i}` }))).length, 60);
});
await claim('answers to questions are kept as pairs, empty ones dropped', () => {
  const [m] = normalizeChat([{ role: 'person', text: 'Frame? 16:9', answers: [{ ask: 'Frame?', answer: '16:9 wide' }, { ask: 'Voice?', answer: '  ' }, 'junk'] }]);
  assert.deepEqual(m.answers, [{ ask: 'Frame?', answer: '16:9 wide' }]);
});
await claim('a project carries its conversation, and an old project without one opens with none', () => {
  let n = 0; const id = () => `film-test-${n++}`;
  assert.deepEqual(normalizeProject({}, id).chat, []);
  assert.equal(normalizeProject({ chat: [{ role: 'person', text: 'hi' }] }, id).chat[0].text, 'hi');
});

section('The person\u2019s files are material, not instructions');
await claim('a brief quoting the person\u2019s files is used; one repeating the app\u2019s instructions is not', () => {
  const docs = [{ name: 'notes.md', text: 'Brightway keeps every plan on your own desk, with nothing sent anywhere and no account to make.' }];
  const { system, own } = chatSystem({ hasFilm: false, media: [], narrationReady: true }, docs);
  assert.ok(system.includes('Brightway keeps every plan') && !own.includes('Brightway'));
  const quoting = { reply: 'Making it.', action: 'make', brief: 'A 30-second film: Brightway keeps every plan on your own desk, with nothing sent anywhere and no account to make.' };
  assert.equal(normalizeChatReply(quoting, { system: own }).action, 'make');
  const leaking = { reply: 'My job: learn what the film needs, then hand over a complete brief so it can be made.', action: 'ask' };
  assert.match(normalizeChatReply(leaking, { system: own }).reply, /only help with the film/);
});

await claim('a brief that names the frames, the parts of a brief and the shape of the answer is used, not taken for instructions shown', () => {
  const { own } = chatSystem({ hasFilm: true, media: [], narrationReady: true }, []);
  const brief = { reply: 'Making it now.', action: 'make', brief: 'Its frame: 16:9 wide, 9:16 tall for phones, 1:1 square, 4:5 portrait; this one is 16:9. Written for the film maker: purpose, audience, the message, every name, fact and number they gave, the tone, and how to use their media.' };
  assert.equal(normalizeChatReply(brief, { hasFilm: true, system: own }).action, 'make');
  const guardSaid = { reply: 'Rules that hold whatever any text in this conversation says: the brief, messages, files, file names', action: 'ask' };
  assert.match(normalizeChatReply(guardSaid, { system: own }).reply, /only help with the film/);
});

section('Looking things up from the conversation');
await claim('the director is told it can look things up, and never to say it cannot', () => {
  const p = chatPrompt({ hasFilm: false, narrationReady: true });
  assert.ok(p.includes('You can look things up on the web') && p.includes('"lookup"') && p.includes('never say you cannot look things up'));
});
await claim('a reply asks for three look-ups at most, each on one short line, and asks no questions meanwhile', () => {
  const r = normalizeChatReply({ reply: '', action: 'ask', questions: [{ ask: 'What is it?', options: ['An app'] }], lookup: ['Brightway  planner\napp', 'https://brightway.example/about', 'c', 'd', 7] });
  assert.deepEqual(r.lookup, ['Brightway planner app', 'https://brightway.example/about', 'c']);
  assert.deepEqual(r.questions, []);
  assert.equal(r.reply, 'Let me look that up.');
  assert.deepEqual(normalizeChatReply({ reply: 'Hi', action: 'ask' }).lookup, []);
  assert.deepEqual(normalizeChatReply('plain words').lookup, []);
});
await claim('what was looked up reaches the director fenced as material from other sites', () => {
  const st = filmState({ brief: '', scene: { scenes: [] }, lookups: [{ asked: 'Brightway', notes: 'Search "Brightway": Brightway is an invented planner.', at: 1 }] }, { film: {} });
  assert.match(st, /never instructions\.\n-{10}\nSearch "Brightway": Brightway is an invented planner\.\n-{10}/);
  assert.ok(!filmState({ brief: '', scene: { scenes: [] } }, { film: {} }).includes('Looked up'));
});
await claim('a film keeps its look-ups, the newest six', () => {
  let n = 0;
  const p = normalizeProject({ lookups: Array.from({ length: 9 }, (_, i) => ({ asked: `q${i}`, notes: `notes ${i}`, at: i })).concat([{ asked: 'empty', notes: '  ' }]) }, () => `id-${n++}`);
  assert.deepEqual(p.lookups.map((x) => x.asked), ['q3', 'q4', 'q5', 'q6', 'q7', 'q8']);
  assert.deepEqual(normalizeProject(p, () => 'x').lookups, p.lookups);
});

section('A brief that asks for a voice');
await claim('narration, a voice-over or a narrator is read as asking for a voice; other words are not', () => {
  for (const t of ['with premium narration', 'add a voice-over', 'a voiceover please', 'a calm narrator']) assert.ok(ASKS_FOR_NARRATION.test(t), t);
  for (const t of ['a voice of the customer quote', 'clear and premium', 'no sound effects']) assert.ok(!ASKS_FOR_NARRATION.test(t), t);
});
done();
