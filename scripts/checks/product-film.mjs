// A product film, planned: every part starts on a beat, no two camera keys
// are closer than the gap, no recording plays slower than it was made, every
// line is said before its part ends, every diagram moment lands on its word,
// the plan is a film the format keeps and the renderer draws with nothing
// flickering and no piece without its screen; the storyboard claims only what
// the facts hold; and the app's own facts match the code that makes them true.

import { section, ok, claim, done } from './lib/check.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './lib/check.mjs';
import { fakeContext } from './lib/fake-canvas.mjs';
import { STORYBOARD } from './lib/fixtures.mjs';
import { planProductFilm, wordTimes, cueTimes, CAMERA_GAP, BPM } from '../../src/core/scene/product-film.js';
import { normalizeBoard, claimProblems, dropUnsupported, spokenLines, sayAs, factTokens, normalizeProductForm, readFactsFile, formFacts, fillLines } from '../../src/core/scene/product-board.js';
import { writeProductBoard } from '../../src/core/director/product-board.js';
import { appFacts, APP_EXPORTS } from '../../src/core/director/app-facts.js';
import { normalizeScene } from '../../src/core/scene/normalize.js';
import { compileStoryboard } from '../../src/core/scene/compile.js';
import { mapProblems } from '../../src/core/engine/recording.js';
import { createKit } from '../../src/core/engine/kit.js';
import { renderStage } from '../../src/core/engine/render-stage.js';
import { renderPlan, activeScenes } from '../../src/core/engine/render-plan.js';
import { coplanarPairs, orphanPieces } from '../../src/core/engine/stage-rules.js';
import { STYLE_NAMES, ASPECTS } from '../../src/core/scene/format.js';
import { TEMPLATES } from '../../src/core/scene/templates.js';
import { iconAccents } from '../../src/core/util/accents.js';

// An invented product, its facts, its board and its lines.
const FACTS = { name: 'Orbi Desk', looks: ['Calm', 'Bright', 'Night'], export: [{ format: 'MP4', codec: 'H.264' }, { format: 'GIF' }], largest: '1080p', modes: 3, allowNames: [] };
const BOARD = normalizeBoard({
  name: 'Orbi Desk', expansion: '', tagline: 'Quiet light, all day.',
  steps: [{ name: 'Plan', sub: 'a line', cue: 'plan' }, { name: 'Light', sub: 'it glows', cue: 'light' }, { name: 'Rest', sub: 'it dims', cue: 'rest' }],
  split: { left: { title: 'You', items: [{ label: 'Choose', cue: 'choose' }] }, right: { title: 'The lamp', items: [{ label: 'Dims', cue: 'dims' }, { label: 'Warms', cue: 'warms' }] } },
  hub: { title: 'Inside', sub: 'made to last', tiles: [{ name: 'MP4', sub: 'H.264', cue: 'MP4' }, { name: 'GIF', sub: 'loops', cue: 'GIF' }], note: 'Nothing to add.' },
  yours: [{ cap: 'On your desk', icon: 'computer' }, { cap: 'No cloud', icon: 'no-server' }, { cap: 'Locked', icon: 'lock' }],
  figures: [{ value: '3', cap: 'Looks', say: 'Three looks.' }, { value: '3', cap: 'Modes', say: 'Three modes.' }],
  releaseLine: 'Out now.', endLine: 'Your light.',
  lines: {
    open: 'Every desk deserves good light.', name: 'Orbi Desk. Quiet light, all day.', brief: 'Tell it what the room is for, in your words.', make: 'Then it sets the light for you.',
    steps: 'First you plan. Then the light comes up. Then it lets you rest.', film: 'And it is calm.', split: 'You choose. The lamp dims and warms on its own.',
    hands: 'Change anything by hand.', export: 'Share it as MP4 or GIF.', hub: 'MP4 with H.264, and GIF. Nothing to add.', looks: 'Three looks to start from.',
    yours: 'No cloud, and nothing leaves your desk.', release: 'Orbi Desk is out now.', end: 'Orbi Desk. Your light.',
  },
});
const LINES = Object.fromEntries(Object.entries(spokenLines(BOARD, FACTS)).map(([k, v]) => [k, { ...v, length: 0.4 + v.text.split(/\s+/).length / 2.6 }]));
const mk = (asset, marks) => ({ asset, marks: marks.map(([label, t, x = null, y = null, click = false]) => ({ label, t, x, y, click })) });
const TAKES = {
  make: mk('take-make', [['type', 1.2, 0.14, 0.95], ['typed', 4.3], ['send', 5.1, 0.25, 0.97, true], ['question', 6.3], ['answer', 8.2, 0.05, 0.34, true], ['answer-send', 8.7, 0.03, 0.43, true], ['steps', 10.6, 0.51, 0.02, true], ['made', 21.0], ['play', 24.0, 0.33, 0.7, true]]),
  hands: mk('take-hands', [['start', 1.5], ['select', 4.0, 0.42, 0.9, true], ['size', 5.7, 0.85, 0.63], ['jog', 11.7, 0.33, 0.36], ['end', 14.9]]),
  export: mk('take-export', [['open', 1.5, 0.84, 0.02], ['end', 7.8]]),
};
const PANELS = { question: [0.008, 0.272, 0.254, 0.18], steps: [0.378, 0.048, 0.266, 0.44], preview: [0.319, 0.1625, 0.632, 0.395], inspector: [0.795, 0.05, 0.205, 0.66], export: [0.346, 0.328, 0.308, 0.343] };
const FILM = compileStoryboard(STORYBOARD, { style: 'studio' }).scene;
const LOOKS = ['studio', 'paper', 'tech'].map((s) => ({ name: s, doc: compileStoryboard(STORYBOARD, { style: s }).scene }));
const video = (n) => ({ kind: 'video', name: `Invented ${n}`, media: `0123456789abcdef0123456${n}`, duration: 40, width: 1920, height: 1200 });
const ASSETS = { mark: { kind: 'image', name: 'Invented mark', data: 'data:image/png;base64,iVBORw0KGgo=' }, 'take-make': video(1), 'take-hands': video(2), 'take-export': video(3) };
const PLAN = planProductFilm({ board: BOARD, lines: LINES, takes: TAKES, panels: PANELS, film: FILM, looks: LOOKS, icon: 'mark', assets: ASSETS, palette: { accent: '#3f7be9', accent2: '#d9b26a' } });
const DOC = normalizeScene(PLAN.doc).scene;
const beat = 60 / BPM;

section('The plan keeps the rules of a product film');
ok('nothing went wrong while planning', PLAN.problems.length === 0, PLAN.problems.join('; '));
ok('every section of the score, and so every change of part, starts on a beat', DOC.sound.release.sections.every(([t]) => Math.abs(t / beat - Math.round(t / beat)) < 1e-6), DOC.sound.release.sections.map(([t, k]) => `${k} ${t}`).join(', '));
ok('no two camera keys are closer than the gap', DOC.stage.camera.every((k, i) => i === 0 || k[0] - DOC.stage.camera[i - 1][0] >= CAMERA_GAP - 1e-6));
const display = DOC.stage.parts.find((p) => p.kind === 'display');
ok('every recording is shown at its own speed or faster, never slower', display.recordings.every((r) => mapProblems(r.map).length === 0), display.recordings.map((r) => mapProblems(r.map).join('; ')).join(' | '));
ok('the three recordings and their lifted panels are all on the screen', display.recordings.length === 4 && display.pieces.length === 4);
ok('every line is said before its part ends', PLAN.voice.every((v) => { const p = PLAN.parts.filter((q) => q.t0 <= v.t + 1e-6).pop(); return v.t + v.length <= Math.max(p.t1, DOC.duration) - 0.3 || p.key === 'end'; }));
ok('the film ends after its last line, with time for the end card', PLAN.voice.at(-1).t + PLAN.voice.at(-1).length + 4 <= DOC.duration + 1e-6);
ok('each spoken line has a scene of its own', DOC.voice.lines.length === PLAN.voice.length);
ok('the plan is a film the format keeps whole', JSON.stringify(normalizeScene(DOC).scene) === JSON.stringify(DOC));
ok('its score is the release piece, with the parts as its sections', DOC.sound.score === 'release' && DOC.sound.release.sections.length >= 8 && DOC.sound.release.hits.length >= 4);
ok('the clicks and typing of the recordings become sounds', DOC.sound.release.cues.some((c) => c[1] === 'type') && DOC.sound.release.cues.filter((c) => c[1] === 'click').length >= 4);

section('Every moment lands on its word');
const stepsPart = DOC.stage.parts.find((p) => p.kind === 'steps');
const stepVoice = PLAN.voice.find((v) => v.key === 'steps');
const ws = wordTimes(LINES.steps, stepVoice.t);
ok('each step lights as its cue is said', BOARD.steps.every((s, i) => { const w = ws.find(([x]) => x.toLowerCase().replace(/\W/g, '') === s.cue); return w && Math.abs(stepsPart.at[i] - w[1]) < 1e-3; }));
const hubPart = DOC.stage.parts.find((p) => p.kind === 'hub');
const hubWords = wordTimes(LINES.hub, PLAN.voice.find((v) => v.key === 'hub').t);
ok('each tile tips up as its name is said', BOARD.hub.tiles.every((x, i) => Math.abs(hubPart.at[i] - hubWords.find(([w]) => w.replace(/\W/g, '') === x.name)[1]) < 1e-3));
ok('a cue a line never says falls evenly between its neighbours', JSON.stringify(cueTimes([['a', 1], ['b', 2], ['c', 3]], ['a', 'zzz', 'c'], 0, 4)) === '[1,2,3]');
ok('word times without the voice\'s own follow word length and pauses', (() => { const w = wordTimes({ text: 'One, two three', length: 3 }, 10); return w[0][1] === 10 && w[1][1] > 10 + 3 * (4 / 15) && w[2][1] < 13; })());
ok('figures are each said on their own, the tile standing as it is said', DOC.stage.parts.find((p) => p.kind === 'figures').items.every((it, i) => Math.abs(it.t - PLAN.voice.find((v) => v.key === `figure-${i}`).t) < 1e-3));

section('Drawn, it holds together');
const fakeCanvas = (w, h) => { const c = { width: w, height: h }; c.ctx = fakeContext(w, h); c.getContext = () => c.ctx; return c; };
const icon = fakeCanvas(320, 320);
const kit = createKit(fakeContext(1920, 1080), { width: 1920, height: 1080, palette: DOC.palette, assets: { mark: icon }, makeCanvas: fakeCanvas });
let flicker = [], orphans = [], drawnParts = new Set();
await claim('every fifth of a second of the film draws', () => {
  for (let t = 0; t <= DOC.duration; t += 0.2) {
    const drawn = renderStage(kit, DOC, t, { renderPlan, activeScenes });
    flicker.push(...coplanarPairs(drawn).map((p) => `${t.toFixed(1)} ${p[0]}/${p[1]}`));
    orphans.push(...orphanPieces(drawn));
    for (const d of drawn) drawnParts.add(d.id.split('-')[0]);
  }
});
ok('nothing flickers', flicker.length === 0, flicker.slice(0, 3).join('; '));
ok('no piece is ever without its screen', orphans.length === 0);
ok('every kind of part is seen', ['open', 'name', 'icon', 'display', 'piece', 'steps', 'split', 'hub', 'lift', 'look', 'drawing', 'figure', 'end'].every((k) => drawnParts.has(k)), [...drawnParts].join(','));
ok('with no recordings, the film is diagrams alone', (() => { const p = planProductFilm({ board: BOARD, lines: LINES, icon: 'mark', assets: ASSETS }); return p.problems.length === 0 && !p.doc.stage.parts.some((q) => q.kind === 'display' || q.kind === 'lift'); })());

section('The storyboard claims only what the facts hold');
ok('a board within its facts has no problems', claimProblems(BOARD, FACTS).length === 0, JSON.stringify(claimProblems(BOARD, FACTS)));
const OVER = normalizeBoard({ ...BOARD, figures: [...BOARD.figures, { value: '9', cap: 'Colours', say: 'Nine colours.' }], hub: { ...BOARD.hub, tiles: [...BOARD.hub.tiles, { name: 'MOV', sub: 'H.265' }] }, lines: { ...BOARD.lines, looks: 'Twelve looks to start from. Pick one.' } });
const bad = claimProblems(OVER, FACTS);
ok('a figure, a format, a codec and a count beyond the facts are each named', ['figure 3', 'tile 3', 'line looks'].every((w) => bad.some((b) => b.where === w)) && bad.some((b) => b.claim === 'h.265') && bad.some((b) => b.claim === '12'));
ok('left out, the figure and tile go and the line keeps what is true', (() => { const d = dropUnsupported(OVER, FACTS); return d.figures.length === 2 && d.hub.tiles.length === 2 && d.lines.looks === 'Pick one.' && claimProblems(d, FACTS).length === 0; })());
ok('lists count as facts: three looks', factTokens(FACTS).has('3'));
ok('the voice says codecs and formats as people say them', sayAs('MP4 with H.264 and AV1, up to 4K.') === 'M P four with H two six four and A V one, up to four K.');
await claim('a model asked for a board is sent its unsupported claims once, then they are left out', async () => {
  const asked = [], notes = [];
  const replies = [OVER, OVER];
  const board = await writeProductBoard(async (system, user) => { asked.push(user); return replies.shift(); }, (n) => notes.push(n), 'A film for a lamp.', FACTS);
  assert.equal(asked.length, 2);
  assert.ok(/not in the facts/.test(asked[1]) && /tile 3: h\.265/.test(asked[1]));
  assert.equal(claimProblems(board, FACTS).length, 0);
  assert.equal(notes.length, 2);
});

section('The accents come from the icon');
{
  // An invented icon: a dark chip, a red border line, a gold bar and a little grey.
  const px = new Uint8ClampedArray(64 * 64 * 4);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const i = (y * 64 + x) * 4;
    const edge = x < 3 || y < 3 || x > 60 || y > 60, bar = x >= 30 && x <= 33 && y > 10 && y < 54, grey = y > 50 && x < 20;
    const [r, g, b] = edge ? [233, 66, 63] : bar ? [217, 178, 106] : grey ? [140, 140, 140] : [26, 26, 30];
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
  }
  const A = iconAccents(px);
  ok('the strongest colour is the first accent', A.accent === '#e9423f', A.accent);
  ok('a clearly different hue is the second', A.accent2 === '#d9b26a', A.accent2);
  ok('an icon in greys gives none', iconAccents(new Uint8ClampedArray(16).fill(128)).accent === null);
}

section('The app\'s own facts match its code');
const F = appFacts();
ok('its looks are the looks it has', F.looks.length === STYLE_NAMES.length);
ok('its templates and frame shapes are counted from the code', F.templates === TEMPLATES.length && F.frameShapes.length === Object.keys(ASPECTS).length);
ok('its largest export is 4K', factTokens(F).has('4k'));
const dialog = readFileSync(join(root, 'src/app/export-dialog.js'), 'utf8'), exporter = readFileSync(join(root, 'src/render/export.js'), 'utf8');
ok('every format it names is one the export window offers', APP_EXPORTS.every((e) => new RegExp(`\\b${e.format.toLowerCase()}: \\{ label`).test(dialog)));
ok('MP4 and MOV are written from H.264, WebM from AV1 with Vorbis', /muxMp4/.test(exporter) && /h264/i.test(exporter) && /av1Sink/.test(exporter) && /encodeVorbis/.test(exporter));

section('The form a product film is made from');
const FORM = normalizeProductForm({ name: 'Orbi Desk', line: 'A lamp that sets its own light', facts: '- Three modes\n\n* Dims at 10 pm\n', file: readFactsFile('facts.txt', 'Works with no account\n- 2 colours'), icon: 'product-icon' });
ok('the form reads back as itself', JSON.stringify(normalizeProductForm(JSON.parse(JSON.stringify(FORM)))) === JSON.stringify(FORM));
ok('a form that is not one is none', normalizeProductForm('Orbi') === null && normalizeProductForm(null) === null);
ok('an icon id that is not one of the film\'s is left out', normalizeProductForm({ name: 'x', icon: '../icon.png' }).icon === null);
ok('a JSON facts file is read as its object', (() => { const f = readFactsFile('f.json', '{"modes": 3, "allowNames": ["Example Store"]}'); return f.facts.modes === 3 && f.lines.length === 0; })());
ok('any other file is read line by line, list marks dropped', JSON.stringify(readFactsFile('f.md', '- One\n* Two\n\nThree').lines) === '["One","Two","Three"]');
ok('the facts hold the name, the line, every typed fact and the file\'s', (() => { const f = formFacts(FORM); const t = factTokens(f); return f.name === 'Orbi Desk' && t.has('10') && t.has('2') && f.facts.includes('Three modes') && f.facts.includes('Works with no account'); })());
ok('a JSON file\'s own fields become facts too', formFacts({ ...FORM, file: readFactsFile('f.json', '{"modes": 3}') }).modes === 3);
const FILLED = fillLines(normalizeBoard({ name: 'Orbi', expansion: 'Orbital Desk', tagline: 'Light that knows the hour', steps: [{ name: 'Plan' }, { name: 'Light' }], hub: { title: 'Inside', tiles: [{ name: 'LED' }] }, yours: [{ cap: 'On your desk' }], lines: { name: 'Meet the lamp' } }), FORM);
ok('the name line says the product\'s own name, its capitals and its tagline, as shown', FILLED.name === 'Orbi Desk' && FILLED.lines.name === 'Orbi Desk. Orbital Desk. Light that knows the hour.');
ok('every part on the board gets a line, from its own words when the model gave none', ['open', 'steps', 'hub', 'yours', 'end'].every((k) => FILLED.lines[k]) && FILLED.lines.steps === 'Plan. Light.' && FILLED.lines.open === 'A lamp that sets its own light.');
ok('filled lines claim nothing the form does not hold', claimProblems(FILLED, formFacts(FORM)).length === 0, JSON.stringify(claimProblems(FILLED, formFacts(FORM))));
ok('a filled board plans with nothing missing', (() => { const sp = spokenLines(FILLED, formFacts(FORM)); const L = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, { ...v, length: 1 + v.text.split(' ').length / 2.6 }])); const p = planProductFilm({ board: FILLED, lines: L }); return p.problems.length === 0 && normalizeScene(p.doc).scene.stage.parts.some((q) => q.kind === 'steps'); })());

done();
