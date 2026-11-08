// The product-film planner: from a product film's storyboard, its spoken
// lines and the recordings of the product, it lays out the whole film on the
// 3D stage: every part on the beat grid, the camera, the screen's flights,
// the pieces that lift off it, the score's sections and hits, and the sounds
// on the recording's clicks and typing.
//
// The lines drive the timeline: every part lasts as long as its line needs,
// and every moment in a diagram lands on the word that names it. The
// recordings never play slower than they were made. Two camera keys are never
// closer than CAMERA_GAP, and every part starts on a beat.
//
// planProductFilm({ board, lines, takes, panels, film, looks, icon, palette, bpm, key, motif })
//   board   the storyboard (product-board.js)
//   lines   { key: { text, say?, length, words?: [[word, start, end]], clip? } },
//           times in seconds from the line's start; keys are the parts' own
//           (open, name, brief, make, steps, film, split, hands, export, hub,
//           looks, yours, figure-0.., release, end)
//   takes   { make, hands, export }: { asset, marks: [{ label, t, x?, y?, click? }] }
//   panels  { question, steps, preview, inspector, export }: [fx, fy, fw, fh]
//   film    the film the product made (shown lifted off its screen); looks: [{ name, doc }]
// Returns { doc, parts: [{ key, t0, t1 }], problems: [] }.

import { normalizeDirection, sequence, cameraKey } from './product-direction.js';

export const BPM = 100;
export const CAMERA_GAP = 0.6;
export const SCREEN = { w: 1500, h: 937.5 };
const IN = { o: 0, x: 960, y: 560, z: -900, ry: 26, rx: 6 };
const REST = { o: 1, x: 960, y: 540, z: 0, ry: -4, rx: 1.5 };
const AWAY = { o: 0, x: 960, y: 600, z: -1500, ry: -24, rx: 4 };
const FAR = { o: 0, x: 960, y: 600, z: -1100, ry: -28, rx: 4 };
const MAKING_SPEED = 1.6;

const r3 = (v) => Math.round(v * 1000) / 1000;
const bare = (w) => String(w).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const centre = (c) => (c ? [c[0] + c[2] / 2, c[1] + c[3] / 2] : null);
const onScreen = ([fx, fy]) => [960 + (fx - 0.5) * SCREEN.w, 540 + (fy - 0.5) * SCREEN.h];

// When each word of a line starts, from the voice's own timing when there is
// one, else by the length of each word with a pause after a stop or a comma.
export function wordTimes(line, t0) {
  if (line.words?.length) return line.words.map(([w, s]) => [w, r3(t0 + s)]);
  const ws = String(line.text).split(/\s+/).filter(Boolean);
  const wt = ws.map((w) => w.length + (/[.,:;]$/.test(w) ? 4 : 0));
  const total = wt.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  return ws.map((w, i) => { const at = r3(t0 + (line.length * acc) / total); acc += wt[i]; return [w, at]; });
}

// The time a word is said, searching from a word on: a cue's last word (the
// one that names it: "app" in "The app"), or null when the line never says it.
export function whenSaid(ws, cue, after = 0) {
  const want = bare(String(cue).split(/\s+/).filter(Boolean).pop() || '');
  for (let i = after; i < ws.length; i++) if (bare(ws[i][0]) === want) return { t: ws[i][1], i };
  return null;
}

// Times for a list of cues said in order in a line; a cue the line does not
// say is placed evenly between its neighbours.
export function cueTimes(ws, cues, t0, t1) {
  const out = [];
  let after = 0;
  for (const c of cues) { const f = whenSaid(ws, c, after); out.push(f ? f.t : null); if (f) after = f.i + 1; }
  return out.map((t, i) => {
    if (t !== null) return t;
    const prev = out.slice(0, i).reverse().find((v) => v !== null) ?? t0, next = out.slice(i + 1).find((v) => v !== null) ?? t1;
    const gapIn = out.slice(0, i).reverse().findIndex((v) => v !== null), gapOut = out.slice(i + 1).findIndex((v) => v !== null);
    const k = gapIn < 0 ? i + 1 : gapIn + 1, m = gapOut < 0 ? cues.length - i : gapOut + 1;
    return r3(prev + ((next - prev) * k) / (k + m));
  });
}

export function planProductFilm(input) {
  const { board, lines = {}, takes = {}, panels = {}, film = null, looks = [], icon = null } = input;
  const bpm = input.bpm || BPM, beat = 60 / bpm;
  // The film's direction: canonical unless one is given (product-direction.js).
  const dir = normalizeDirection(input.direction);
  const onBeat = (t) => r3(Math.round(t / beat) * beat);
  const problems = [];
  const cam = [], parts = [], voice = [], sections = [], hits = [], cues = [], display = [], recordings = [], pieces = [], icons = [];
  const key = (t, [x, y], zoom = 1, ry = 0, rx = 0, ease = 'inOutCubic') => {
    // A key too close to the one before waits for the gap: two keys closer than
    // that read as a jump. A part in another order can bring its first key early.
    if (cam.length && t - cam[cam.length - 1][0] < CAMERA_GAP - 1e-9) t = cam[cam.length - 1][0] + CAMERA_GAP;
    cam.push(cameraKey(dir, [r3(t), Math.round(x * 100) / 100, Math.round(y * 100) / 100, zoom, ry, rx, ease]));
  };
  const say = (k, t) => { const L = lines[k]; if (!L) { problems.push(`no line for ${k}`); return t; } voice.push({ key: k, t: r3(t), length: L.length }); return t + L.length; };
  const part = (kind, t0, t1, extra = {}) => { parts.push({ kind, t0: r3(t0), t1: r3(t1), ...(dir.variants[kind] ? { variant: dir.variants[kind] } : {}), ...extra }); };
  const mark = (take, label) => takes[take]?.marks?.find((m) => m.label === label)?.t ?? null;
  const has = (take, ...labels) => takes[take] && labels.every((l) => mark(take, l) !== null);
  const clicks = (take) => (takes[take]?.marks || []).filter((m) => m.x !== null && m.x !== undefined && !/^typed/.test(m.label)).map((m) => ({ t: m.t, x: m.x, y: m.y, click: Boolean(m.click) }));
  const C = (k) => centre(panels[k]);
  const recording = (take, t0, t1, map, fi = 0.6, fo = 0.6) => {
    const end = clipAt(map, t1);
    const m = map.filter((p) => p[0] < t1 - 1e-6).concat([[t1, end], [t1 + fo + 0.1, end]]);
    recordings.push({ asset: takes[take].asset, t0: r3(t0), t1: r3(t1), fi, fo, map: m.map(([a, b]) => [r3(a), r3(b)]), points: clicks(take) });
    return recordings.length - 1;
  };
  const piece = (rec, t0, t1, crop, grow) => { if (crop) pieces.push({ rec, t0: r3(t0), t1: r3(t1), crop, grow }); };

  // ---- 1. the cold open, 2. the name
  key(0, [960, 540]);
  say('open', 0.9);
  part('open', 0, 4.2, { fi: 0.3, fo: 0.4 });
  sections.push([0, 'still']);
  const tName = onBeat(6.0);
  key(5.4, [960, 540], 1.03, -1.5, 0.5, 'inOutSine');
  const nameEnd = say('name', tName);
  const wf = wordTimes(lines.name || { text: '', length: 0 }, tName);
  const nameWords = String(board.name).split(/\s+/).length, expWords = String(board.expansion || '').split(/\s+/).filter(Boolean).length;
  const tNameEnd = onBeat(nameEnd + 1.0);
  part('name', tName, tNameEnd, { fi: 0.4, fo: 0.6, name: board.name, expansion: wf.slice(nameWords, nameWords + expWords), tagline: wf.slice(nameWords + expWords) });
  sections.push([tName, 'move']); hits.push(tName);
  icons.push([0, { o: 0, x: 960, y: 540, z: 0, ry: -75, rx: 0, s: 1 }], [3.2, { o: 0, x: 960, y: 540, z: 0, ry: -75, rx: 0, s: 1 }], [4.0, { o: 1, x: 960, y: 540, z: 0, ry: -24, rx: 0, s: 1 }],
    // The icon has risen above the name before the name card comes up under it.
    [5.0, { o: 1, x: 960, y: 540, z: 0, ry: 0, rx: 0, s: 1 }], [Math.max(5.05, tName - 1.0), { o: 1, x: 960, y: 540, z: 0, ry: 0, rx: 0, s: 1 }], [tName + 0.1, { o: 1, x: 960, y: 330, z: 0, ry: 0, rx: 0, s: 0.62 }],
    [tNameEnd - 0.2, { o: 1, x: 960, y: 330, z: 0, ry: 0, rx: 0, s: 0.62 }], [tNameEnd + 0.7, { o: 0, x: 960, y: 300, z: -400, ry: 0, rx: -30, s: 0.62 }]);
  display.push([0, IN]);
  let t = tNameEnd;

  // ---- 3. the brief and 4. the making, from the make recording
  let made = null;
  if (has('make', 'type', 'answer-send', 'made')) {
    const tB = onBeat(t + 0.4);
    const off = mark('make', 'type') - 0.9;
    const rtSend = mark('make', 'answer-send'), rtMade = mark('make', 'made');
    const tMake = tB + (rtSend - off) + 0.2;
    const tMade = tMake + (rtMade - rtSend) / MAKING_SPEED;
    const map = [[tB - 0.6, off - 0.6], [tMake, rtSend + 0.2], [tMade, rtMade], [tMade + 30, rtMade + 30]];
    display.push([tB - 0.9, { ...IN, o: 0 }], [tB + 0.9, REST]);
    key(tB - 0.6, [960, 540], 1, 0, 0, 'inOutSine');
    say('brief', tB + 0.7);
    const typeAt = takes.make.marks.find((m) => m.label === 'type');
    key(tB + 2.0, onScreen(typeAt?.x !== undefined && typeAt.x !== null ? [typeAt.x + 0.015, Math.min(0.42, typeAt.y)] : [0.15, 0.42]), 1.55, 5, 0);
    part('brief', tB, tMake, { fi: 0, fo: 0 });
    sections.push([tB, 'move']);
    const rec = recording('make', tB - 0.6, tMade + 0.8, map);
    if (mark('make', 'question') !== null && mark('make', 'answer') !== null) {
      const tQ = tB + (mark('make', 'question') - off);
      key(tQ + 0.2, onScreen(C('question') || [0.14, 0.36]), 1.7, 3, 0);
      piece(rec, tQ + 0.15, tB + (mark('make', 'answer') - off) - 0.25, panels.question, 0.10);
    }
    key(tMake + 0.2, onScreen([0.5, 0.36]), 1.2, -3, 0);
    say('make', tMake + 0.4);
    if (mark('make', 'steps') !== null) {
      const tSteps = tMake + (mark('make', 'steps') - rtSend) / MAKING_SPEED;
      key(tSteps + 0.6, onScreen(C('steps') || [0.51, 0.27]), 1.5, -4, 0);
      piece(rec, tSteps + 0.7, tMade + 0.3, panels.steps, 0.08);
    }
    part('make', tMake, tMade, { fi: 0, fo: 0 });
    sections.push([onBeat(tMake), 'lift']);
    display.push([tMade + 0.3, REST]);
    for (const [label, kind] of [['type', 'type'], ['send', 'click'], ['answer', 'click'], ['answer-send', 'click'], ['steps', 'click']]) {
      const rt = mark('make', label);
      if (rt === null) continue;
      const ft = filmAt(map, rt);
      if (ft !== null) cues.push(kind === 'type' ? [r3(ft), 'type', r3((mark('make', 'typed') ?? rt + 2) - rt)] : [r3(ft), 'click']);
    }
    made = { rtMade, map, rec };
    t = tMade;
  }

  // The parts after the name, each a step of its own, run in the order the
  // film's direction gives (recordings keep their places).
  const S = {};
  let away = AWAY;
  // ---- 5. how a film is made: the steps
  S.steps = () => {
    if (board.steps?.length) {
      const tP = onBeat(t + 0.9);
      if (made) display.push([tP + 0.5, AWAY]);
      key(tP, [960, 540]);
      const t0 = tP + 0.7, end = say('steps', t0);
      const ws = wordTimes(lines.steps || { text: '', length: 0 }, t0);
      const at = cueTimes(ws, board.steps.map((s) => s.cue || s.name), t0, end);
      const tEnd = end + 1.0;
      key(tEnd - 0.6, [960, 520], 1.05, -3, -2, 'inOutSine');
      part('steps', tP, tEnd, { fi: 0.4, fo: 0.7, items: board.steps.map((s) => [s.name, s.sub, s.icon || '']), at });
      sections.push([tP, 'move']); hits.push(tP);
      t = tEnd;
    }
  };

  // ---- 6. the film it made, lifted off its screen
  S.lift = () => {
    if (made && film && panels.preview) {
      const tBack = onBeat(t + 0.3);
      const rtBack = made.rtMade + 1.2;
      const map = [[tBack - 0.8, rtBack - 0.8], [tBack + 40, rtBack + 40]];
      display.push([tBack - 0.8, AWAY], [tBack + 0.6, REST]);
      key(tBack + 0.1, [960, 540], 1, -2, 0);
      const tPlay = tBack + ((mark('make', 'play') ?? rtBack + 1) - rtBack);
      const [px, py] = onScreen(C('preview'));
      key(tPlay + 0.4, [px, py], 1.5, 0, 0);
      sections.push([onBeat(tBack), 'move']);
      const s = (panels.preview[2] * SCREEN.w) / 1600;
      const tLift = tPlay + 1.6, tLiftEnd = tLift + 8.4;
      say('film', tLift + 0.6);
      part('lift', tLift, tLiftEnd, {
        fi: 0.5, fo: 0.7, ft0: r3(tLift - tPlay + 0.05), film, apart: [tLift + 1.6, tLift + 3.4, tLift + 6.2, tLift + 7.6].map(r3),
        pose: [[tLift, { x: px, y: py, z: 1, ry: 0, rx: 0, s }], [tLift + 1.6, { x: px, y: py, z: 1, ry: 0, rx: 0, s }], [tLift + 3.4, { x: px, y: py, z: -40, ry: 0, rx: 0, s: s * 1.02 }], [tLift + 7.6, { x: px, y: py, z: 1, ry: 0, rx: 0, s }]].map(([a, b]) => [r3(a), b]),
      });
      key(tLift + 1.6, [px, py], 1.5, 0, 0, 'inOutSine');
      key(tLift + 3.4, [px - 60, py], 1.25, 8, -2);
      key(tLift + 6.2, [px - 60, py], 1.22, 10, -2, 'inOutSine');
      key(tLift + 7.6, [px, py], 1.4, 0, 0);
      display.push([tLift + 0.4, REST], [tLift + 1.2, { ...REST, o: 0 }]);
      sections.push([onBeat(tLift + 1.6), 'lift']); hits.push(onBeat(tLift + 1.6));
      recording('make', tBack - 0.8, tLift + 1.2, map, 0.6, 0.1);
      if (mark('make', 'play') !== null) cues.push([r3(tPlay), 'click']);
      t = tLiftEnd;
    }
  };

  // ---- 7. what each side does
  S.split = () => {
    if (board.split) {
      const tS = onBeat(t + 0.2);
      key(tS, [960, 540]);
      const t0 = tS + 0.6, end = say('split', t0);
      const ws = wordTimes(lines.split || { text: '', length: 0 }, t0);
      const L = board.split.left, R = board.split.right;
      const all = cueTimes(ws, [...L.items.map((i) => i.cue || i.label), R.cue || R.title, ...R.items.map((i) => i.cue || i.label)], t0, end);
      const left = L.items.map((i, k) => [i.label, all[k]]), arrow = r3(all[L.items.length] - 0.2), right = R.items.map((i, k) => [i.label, all[L.items.length + 1 + k]]);
      const tEnd = end + 1.0;
      key(tEnd - 0.6, [960, 540], 1.05, 3, 0, 'inOutSine');
      part('split', tS, tEnd, { fi: 0.4, fo: 0.7, left: { title: L.title, icon: L.icon || 'chip', items: left }, right: { title: R.title, icon: R.icon || 'window', items: right }, arrow });
      sections.push([tS, 'move']);
      t = tEnd;
    }
  };

  // ---- 8. by hand, from the hands recording
  S.hands = () => {
    if (has('hands', 'start', 'end')) {
      const tH = onBeat(t + 0.3);
      display.push([tH - 0.6, AWAY], [tH + 0.6, REST]);
      const off = mark('hands', 'start') + 0.9;
      const map = [[tH, off], [tH + 40, off + 40]];
      key(tH + 0.2, onScreen([0.6, 0.55]), 1.12, -4, 0);
      say('hands', tH + 0.5);
      const tEnd = tH + (mark('hands', 'end') - off) - 0.4;
      const rec = recording('hands', tH - 0.6, tEnd, map, 0.8, 0.8);
      if (mark('hands', 'select') !== null) key(tH + (mark('hands', 'select') - off) + 0.4, onScreen(C('inspector') || [0.88, 0.42]), 1.5, -6, 0);
      if (mark('hands', 'size') !== null) { const ts = tH + (mark('hands', 'size') - off); piece(rec, ts - 0.4, ts + 2.6, panels.inspector, 0.06); }
      if (mark('hands', 'jog') !== null) key(tH + (mark('hands', 'jog') - off) - 0.6, onScreen([0.55, 0.36]), 1.35, -3, 0);
      for (const m of takes.hands.marks) if (m.click) cues.push([r3(tH + m.t - off), 'click']);
      part('hands', tH, tEnd, { fi: 0, fo: 0 });
      sections.push([onBeat(tH), 'move']);
      t = tEnd;
    }
  };

  // ---- 9. export, from the export recording
  S.exporting = () => {
    if (has('export', 'open', 'end')) {
      const tX = onBeat(t - 0.2);
      const off = mark('export', 'open') - 0.8;
      const map = [[tX, off], [tX + 40, off + 40]];
      const tEnd = tX + (mark('export', 'end') - off) + 0.8;
      const rec = recording('export', tX - 0.6, tEnd, map, 0.8, 0.8);
      if (!has('hands', 'start', 'end')) display.push([tX - 0.6, AWAY], [tX + 0.6, REST]);
      key(tX + 0.4, onScreen([0.5, 0.5]), 1.45, 3, 0);
      say('export', tX + 0.6);
      piece(rec, tX + (mark('export', 'open') - off) + 0.9, tEnd - 0.1, panels.export, 0.08);
      for (const m of takes.export.marks) if (m.click) cues.push([r3(tX + m.t - off), 'click']);
      part('export', tX, tEnd, { fi: 0, fo: 0 });
      sections.push([onBeat(tX), 'move']);
      display.push([tEnd - 0.2, REST], [tEnd + 0.9, FAR]);
      away = FAR;
      t = tEnd;
    } else if (has('hands', 'start', 'end')) display.push([t - 0.2, REST], [t + 0.9, FAR]);
  };

  // ---- 10. the hub: what is built in
  S.hub = () => {
    if (board.hub?.tiles?.length) {
      const tN = onBeat(t + 0.3);
      key(tN, [960, 560]);
      const t0 = tN + 0.6, end = say('hub', t0);
      const ws = wordTimes(lines.hub || { text: '', length: 0 }, t0);
      const at = cueTimes(ws, [...board.hub.tiles.map((x) => x.cue || x.name), board.hub.noteCue || board.hub.note || 'nothing'], t0, end);
      const tEnd = end + 1.0;
      key(tEnd - 0.6, [960, 560], 1.05, 2, -2, 'inOutSine');
      part('hub', tN, tEnd, { fi: 0.4, fo: 0.7, title: board.hub.title, sub: board.hub.sub, tiles: board.hub.tiles.map((x) => [x.name, x.sub]), at: at.slice(0, -1), note: board.hub.note || '', noteAt: at[at.length - 1] });
      sections.push([tN, 'lift']); hits.push(tN);
      t = tEnd;
    }
  };

  // ---- 11. the looks on a ring
  S.looks = () => {
    if (looks.length) {
      const tL = onBeat(t + 0.6);
      key(tL - 0.2, [960, 540]);
      key(tL + 2.5, [960, 520], 1.04, 0, -3, 'inOutSine');
      const end = say('looks', tL + 0.6);
      const tEnd = Math.max(end + 1.6, tL + 8.0);
      part('ring', tL, tEnd, { fi: 0.8, fo: 0.8, at: [960, 500, -260], films: looks });
      sections.push([tL, 'lift']); hits.push(tL);
      t = tEnd;
    }
  };

  // ---- 12. what stays the person's own
  S.yours = () => {
    if (board.yours?.length) {
      const tY = onBeat(t + 0.3);
      key(tY, [960, 540]);
      const end = say('yours', tY + 0.4);
      const tEnd = Math.max(end + 0.8, tY + 6.6);
      key(tEnd - 0.4, [960, 540], 1.05, 3, 0, 'inOutSine');
      part('drawings', tY, tEnd, { fi: 0.4, fo: 0.7, items: board.yours.map((y, i) => ({ at: r3(tY + 0.3 + i * 1.3), cap: y.cap, icon: y.icon })) });
      sections.push([tY, 'still']);
      t = tEnd;
    }
  };

  // ---- 13. figures, each said on its own
  S.figures = () => {
    if (board.figures?.length) {
      const tF = onBeat(t + 0.4);
      key(tF + 0.4, [960, 560]);
      let tt = tF + 0.7;
      const items = board.figures.map((f, i) => { const at = r3(tt); tt = say(`figure-${i}`, tt) + 0.75; return { t: at, value: f.value, cap: f.cap }; });
      const tEnd = tt + 0.6;
      key(tEnd - 0.6, [960, 560], 1.06, -3, 0, 'inOutSine');
      part('figures', tF, tEnd, { fi: 0.3, fo: 0.7, items });
      sections.push([tF, 'move']);
      t = tEnd;
    }
  };

  for (const k of sequence(dir)) S[k]();

  // ---- 14. the end card
  const tE = onBeat(t + 0.3);
  key(tE + 0.2, [960, 540]);
  const releaseEnd = lines.release ? say('release', tE + 1.0) : tE + 1.0;
  const endEnd = say('end', releaseEnd + 0.5);
  const D = r3(endEnd + 4.2);
  key(D - 0.2, [960, 540], 1.03, 0, 0, 'inOutSine');
  // The card shows the name above its line, so a line that opens with the name drops it.
  const esc = String(board.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const endLine = String(board.releaseLine || board.endLine || '').replace(new RegExp(`^${esc}[.,:;]?\\s*`, 'i'), '');
  part('end', tE, D, { fi: 0.5, fo: 0.1, name: board.name, line: endLine.charAt(0).toUpperCase() + endLine.slice(1), footnote: board.footnote || '' });
  icons.push([tE - 0.1, { o: 0, x: 960, y: 410, z: -300, ry: 70, rx: 0, s: 0.7 }], [tE + 1.2, { o: 1, x: 960, y: 410, z: 0, ry: 0, rx: 0, s: 0.7 }], [D, { o: 1, x: 960, y: 410, z: 0, ry: -6, rx: 0, s: 0.7 }]);
  sections.push([tE, 'out']); hits.push(r3(tE + 0.4));
  display.push([D, away]);

  return assemble({ input, bpm, D, dir, cam, parts, voice, sections, hits, cues, display, recordings, pieces, icons, icon, problems });
}

// Clip time on a map at film time t (as the stage reads it).
function clipAt(map, t) {
  for (let i = 1; i < map.length; i++) if (t <= map[i][0]) { const [a, x] = map[i - 1], [b, y] = map[i]; return x + ((y - x) * (t - a)) / ((b - a) || 1e-6); }
  const [a, x] = map[map.length - 1];
  return x + (t - a);
}
// Film time at which a map shows clip time rt, or null.
function filmAt(map, rt) {
  for (let i = 1; i < map.length; i++) { const [a, x] = map[i - 1], [b, y] = map[i]; if (x <= rt && rt <= y && y > x) return a + ((b - a) * (rt - x)) / (y - x); }
  return null;
}

// The scene document: one scene per part and per extra line within a part, so
// each spoken line has a scene of its own; the stage; the score; the voice.
function assemble({ input, bpm, D, dir, cam, parts, voice, sections, hits, cues, display, recordings, pieces, icons, icon, problems }) {
  const stageParts = [];
  if (icon) stageParts.push({ kind: 'icon', t0: 0, t1: D, asset: icon, keys: icons.map(([a, b]) => [r3(a), b]).sort((x, y) => x[0] - y[0]) });
  if (recordings.length) stageParts.push({ kind: 'display', t0: 0, t1: D, keys: display.map(([a, b]) => [r3(a), b]).sort((x, y) => x[0] - y[0]), recordings, pieces });
  const shown = parts.filter((p) => !['brief', 'make', 'hands', 'export'].includes(p.kind));
  stageParts.push(...shown.map((p) => ({ ...p, kind: p.kind === 'drawings' ? 'drawings' : p.kind })));
  const starts = [...new Set([0, ...parts.map((p) => p.t0), ...voice.map((v) => v.t)].map(r3))].sort((a, b) => a - b);
  // A boundary inside another line would split it; keep only those between lines.
  const bounds = starts.filter((s) => s === 0 || !voice.some((v) => s > v.t + 1e-6 && s < v.t + v.length - 1e-6));
  const merged = bounds.filter((s, i) => i === 0 || s - bounds[i - 1] >= 0.4);
  const scenes = merged.map((s, i) => ({ id: `part-${i + 1}`, start: s, duration: r3((merged[i + 1] ?? D) - s), transition: { kind: 'cut' }, layers: [] }));
  const sceneAt = (tt) => scenes.filter((S) => S.start <= tt + 1e-6).pop();
  const used = new Set();
  const lines = [];
  for (const v of voice) {
    const S = sceneAt(v.t);
    if (!S || used.has(S.id)) { problems.push(`the line ${v.key} shares a scene`); continue; }
    used.add(S.id);
    const L = input.lines[v.key];
    lines.push({ scene: S.id, text: L.text, say: L.say || '', at: r3(v.t - S.start), clip: L.clip || null });
  }
  const doc = {
    title: input.board.name, aspect: '16:9', fps: 60, bpm, style: 'studio',
    palette: { ...(input.palette || {}) },
    scenes: scenes.map(({ start, ...S }) => S),
    sound: { score: 'release', key: input.key ?? -5, release: { motif: input.motif || dir.motif, bright: true, sections: sections.sort((a, b) => a[0] - b[0]), hits: [...new Set(hits)].sort((a, b) => a - b), cues: cues.sort((a, b) => a[0] - b[0]), duck: 11, carve: 6 } },
    voice: { engine: input.voice?.engine || 'none', voice: input.voice?.voice || '', captions: false, lines },
    assets: input.assets || {},
    stage: { tone: dir.tone, camera: cam, parts: stageParts },
  };
  return { doc, parts: parts.map((p) => ({ key: p.kind, t0: p.t0, t1: p.t1 })), voice, problems };
}
