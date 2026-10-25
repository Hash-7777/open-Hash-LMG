// The timeline: a ruler marked in seconds and beats, the scenes as blocks in
// one track, the layers of the scene in focus, the narration and the music.
//
// Everything is placed from the scene document on each change, and a drag is
// a live edit that becomes one undo step when the pointer is let go. With
// snapping on, ends and starts land on the beat, which is what keeps cuts on
// the music.

import { splitScene } from '../core/scene/edit.js';
import { h, clear, iconButton, drag, perFrame } from './dom.js';
import { ICONS, LAYER_ICONS } from './icons.js';
import { createSceneMover } from './scene-mover.js';
import { estimateSpeech, wordCount, LIMITS } from '../core/scene/format.js';
import { entranceSpan } from '../core/engine/motion.js';
import { scorePlan } from '../core/audio/score.js';
import { soundtrackFor } from './soundtrack.js';
import { resizeScene } from '../core/scene/edit.js';

const LABEL_W = 148;
const PAD_R = 80;
const SCORE_NAMES = { composed: 'Composed score', pulse: 'Pulse score', soft: 'Soft score', cinematic: 'Cinematic score', bounce: 'Bounce score', drive: 'Drive score', keys: 'Keys score', arp: 'Arp score', none: 'No music' };

function layerTitle(L) {
  if (L.name) return L.name;
  if (L.type === 'text') return L.text.replace(/\n/g, ' ');
  if (L.type === 'counter') return `${L.prefix}${L.to}${L.suffix}`;
  if (L.type === 'shape') return L.shape[0].toUpperCase() + L.shape.slice(1);
  if (L.type === 'bars') return 'Bar chart';
  if (L.type === 'line-chart') return 'Line chart';
  if (L.type === 'video') return `Clip from ${L.from.toFixed(1)} s`;
  if (L.type === 'group') return `Group of ${L.layers.length}`;
  return L.type;
}

export function createTimeline({ store, player, prefs }) {
  const scroller = h('div', { class: 'tl-scroll' });
  const playhead = h('div', { class: 'tl-playhead', 'aria-hidden': 'true' }, h('div', { class: 'tl-playhead-cap' }));
  const content = h('div', { class: 'tl-content' });
  const mover = createSceneMover({ store, focusMoved: () => requestAnimationFrame(() => content.querySelector('.tl-scene.selected')?.focus()) });
  scroller.append(content);

  const snapBtn = iconButton(ICONS.snap, 'Snap to the beat', () => { prefs.snap = !prefs.snap; paintSnap(); });
  const zoomLabel = h('span', { class: 'tl-zoom-label' });
  const head = h('div', { class: 'tl-head' },
    h('span', { class: 'panel-title', text: 'Timeline' }),
    h('span', { class: 'spacer' }),
    iconButton(ICONS.scissors, 'Split the scene at the playhead (S)', () => split()),
    snapBtn,
    iconButton(ICONS.zoomOut, 'Zoom out', () => zoomBy(1 / 1.5)),
    zoomLabel,
    iconButton(ICONS.zoomIn, 'Zoom in', () => zoomBy(1.5)),
    h('button', { class: 'text-btn', type: 'button', text: 'Fit', onclick: () => { zoom = 1; render(); } }));
  const el = h('section', { class: 'timeline', 'aria-label': 'Timeline' }, head, scroller);

  // Splits the scene under the playhead in two, as one step to undo.
  function split() {
    store.edit((doc) => (splitScene(doc, store.get().time) ? undefined : false));
  }

  let zoom = 1;
  let pps = 40;

  function paintSnap() {
    snapBtn.classList.toggle('on', prefs.snap);
    snapBtn.setAttribute('aria-pressed', String(prefs.snap));
  }

  function computePps() {
    const d = store.get().project.scene.duration;
    const avail = Math.max(200, scroller.clientWidth - LABEL_W - PAD_R);
    pps = (avail / Math.max(1, d)) * zoom;
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }

  function zoomBy(f, anchorX) {
    const old = pps;
    const ax = anchorX ?? scroller.clientWidth / 2;
    const tAt = (scroller.scrollLeft + ax - LABEL_W) / old;
    zoom = Math.min(40, Math.max(0.5, zoom * f));
    render();
    scroller.scrollLeft = Math.max(0, tAt * pps + LABEL_W - ax);
  }

  scroller.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const r = scroller.getBoundingClientRect();
    zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left);
  }, { passive: false });

  const X = (t) => LABEL_W + t * pps;

  function snapTime(t) {
    if (!prefs.snap) return t;
    const beat = 60 / store.get().project.scene.bpm;
    return Math.round(t / beat) * beat;
  }

  // The scene whose layers are shown: the selected one, or the one under the playhead.
  function focusScene() {
    const st = store.get();
    const scenes = st.project.scene.scenes;
    if (st.selection.scene) return scenes.find((S) => S.id === st.selection.scene) || null;
    let at = scenes[0] || null;
    for (const S of scenes) if (st.time >= S.start - 1e-6) at = S;
    return at;
  }

  // ---- rows ------------------------------------------------------------------
  function row(label, cls, lane, icon) {
    return h('div', { class: `tl-row ${cls}` },
      h('div', { class: 'tl-label' }, icon ? h('span', { class: 'tl-label-icon', html: icon }) : null, h('span', { class: 'tl-label-text', text: label, title: label })),
      lane);
  }

  function ruler(scene, width) {
    const lane = h('div', { class: 'tl-lane tl-ruler-lane' });
    lane.style.width = `${width}px`;
    const beat = 60 / scene.bpm;
    if (beat * pps >= 6) {
      for (let i = 0, t = 0; t <= scene.duration + 1e-6; i++, t = i * beat) {
        const tick = h('div', { class: i % 4 === 0 ? 'tl-beat bar' : 'tl-beat' });
        tick.style.left = `${t * pps}px`;
        lane.append(tick);
      }
    }
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60];
    const every = steps.find((s) => s * pps >= 64) || 60;
    for (let t = 0; t <= scene.duration + 1e-6; t += every) {
      const m = h('div', { class: 'tl-second' }, h('span', { text: every < 1 ? t.toFixed(1) : `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}` }));
      m.style.left = `${t * pps}px`;
      lane.append(m);
    }
    lane.addEventListener('pointerdown', (e) => scrub(e, lane));
    return h('div', { class: 'tl-row tl-ruler' }, h('div', { class: 'tl-label' }), lane);
  }

  function scrub(e, lane) {
    if (e.button !== 0) return;
    const r = lane.getBoundingClientRect();
    const set = (cx) => store.setTime((cx - r.left) / pps);
    if (store.get().playing) player.pause();
    set(e.clientX);
    drag(e, { onMove: (dx, dy, ev) => set(ev.clientX) });
  }

  function scenesRow(scene, width) {
    const st = store.get();
    const lane = h('div', { class: 'tl-lane' });
    lane.style.width = `${width}px`;
    lane.addEventListener('pointerdown', (e) => { if (e.target === lane) { store.select(null); scrub(e, lane); } });
    scene.scenes.forEach((S, i) => {
      const selected = st.selection.scene === S.id;
      const label = S.name || S.id;
      const block = h('div', { class: `tl-scene${selected ? ' selected' : ''}`, role: 'button', tabindex: '0', title: `${label}, ${S.duration.toFixed(2)} s` },
        h('span', { class: 'tl-scene-name', text: label }),
        h('span', { class: 'tl-scene-dur', text: `${S.duration.toFixed(1)} s` }));
      block.style.left = `${S.start * pps}px`;
      block.style.width = `${Math.max(2, S.duration * pps)}px`;
      block.addEventListener('pointerdown', (e) => {
        if (e.target.classList.contains('tl-handle') || e.button !== 0) return;
        store.select({ scene: S.id, layer: null });
        const t = store.get().time;
        if (t < S.start || t >= S.start + S.duration) store.setTime(S.start + S.transition.duration);
        // Selecting redraws the timeline; the selected block takes the keyboard.
        requestAnimationFrame(() => content.querySelector('.tl-scene.selected')?.focus({ preventScroll: true }));
        mover.pick(e, () => content.querySelector('.tl-scene.selected'), scene, i, pps);
      });
      block.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); store.select({ scene: S.id, layer: null }); }
        // Alt with an arrow moves the scene one place along the film.
        else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); mover.move(S.id, i + (e.key === 'ArrowLeft' ? -1 : 1)); }
      });
      const handle = h('div', { class: 'tl-handle end', title: 'Drag to change the length' });
      handle.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        const d0 = S.duration, start = S.start;
        drag(e, {
          onMove: (dx) => {
            const end = snapTime(start + d0 + dx / pps);
            const dur = Math.min(LIMITS.maxSceneDuration, Math.max(LIMITS.minSceneDuration, end - start));
            store.edit((doc) => { const T = doc.scenes.find((x) => x.id === S.id); if (!T) return false; resizeScene(T, +dur.toFixed(3)); }, { live: true });
          },
          onEnd: () => store.commit(),
        });
      });
      block.append(handle);
      lane.append(block);
      if (i > 0 && S.transition.kind !== 'cut' && S.transition.duration > 0) {
        const joint = h('div', { class: 'tl-transition', title: `${S.transition.kind[0].toUpperCase()}${S.transition.kind.slice(1)}, ${S.transition.duration} s` });
        joint.style.left = `${S.start * pps}px`;
        joint.style.width = `${Math.max(3, S.transition.duration * pps)}px`;
        lane.append(joint);
      }
    });
    return row('Scenes', 'tl-scenes', lane, ICONS.film);
  }

  function layerRow(scene, S, L, width) {
    const st = store.get();
    const lane = h('div', { class: 'tl-lane' });
    lane.style.width = `${width}px`;
    lane.addEventListener('pointerdown', (e) => { if (e.target === lane) scrub(e, lane); });
    const selected = st.selection.layer === L.id;
    const bar = h('div', { class: `tl-layer${selected ? ' selected' : ''}`, role: 'button', tabindex: '0', title: layerTitle(L) },
      h('span', { class: 'tl-layer-in' }),
      h('span', { class: 'tl-layer-name', text: layerTitle(L) }));
    const a = S.start + L.at, b = S.start + L.until;
    bar.style.left = `${a * pps}px`;
    bar.style.width = `${Math.max(4, (b - a) * pps)}px`;
    const ins = entranceSpan(L);
    bar.firstChild.style.width = `${Math.max(0, Math.min(b - a, ins.end - L.at)) * pps}px`;
    const editTimes = (fn) => store.edit((doc) => {
      const T = doc.scenes.find((x) => x.id === S.id);
      const M = T && T.layers.find((x) => x.id === L.id);
      if (!M) return false;
      fn(M);
    }, { live: true });
    const startDrag = (e, mode) => {
      e.stopPropagation();
      store.select({ scene: S.id, layer: L.id });
      const at0 = L.at, until0 = L.until, len = until0 - at0;
      let moved = false;
      drag(e, {
        onMove: (dx) => {
          if (!moved && Math.abs(dx) < 3) return;
          moved = true;
          const dt = dx / pps;
          if (mode === 'move') {
            let at = snapTime(S.start + at0 + dt) - S.start;
            at = Math.min(S.duration - len, Math.max(0, at));
            editTimes((M) => { M.at = +at.toFixed(3); M.until = +(at + len).toFixed(3); });
          } else if (mode === 'start') {
            const at = Math.min(until0 - 0.1, Math.max(0, snapTime(S.start + at0 + dt) - S.start));
            editTimes((M) => { M.at = +at.toFixed(3); });
          } else {
            const until = Math.max(at0 + 0.1, Math.min(S.duration, snapTime(S.start + until0 + dt) - S.start));
            editTimes((M) => { M.until = +until.toFixed(3); });
          }
        },
        onEnd: () => { if (moved) store.commit(); },
      });
    };
    const hs = h('div', { class: 'tl-handle start', title: 'Drag to change when it appears' });
    const he = h('div', { class: 'tl-handle end', title: 'Drag to change when it leaves' });
    hs.addEventListener('pointerdown', (e) => startDrag(e, 'start'));
    he.addEventListener('pointerdown', (e) => startDrag(e, 'end'));
    bar.addEventListener('pointerdown', (e) => startDrag(e, 'move'));
    bar.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); store.select({ scene: S.id, layer: L.id }); } });
    bar.append(hs, he);
    lane.append(bar);
    return row(layerTitle(L), 'tl-layer-row', lane, LAYER_ICONS[L.type]);
  }

  function voiceRow(scene, width) {
    const lane = h('div', { class: 'tl-lane' });
    lane.style.width = `${width}px`;
    lane.addEventListener('pointerdown', (e) => { if (e.target === lane) scrub(e, lane); });
    for (const line of scene.voice.lines) {
      const S = scene.scenes.find((x) => x.id === line.scene);
      if (!S) continue;
      const clip = line.clip ? scene.assets[line.clip] : null;
      const len = clip?.duration || estimateSpeech(wordCount(line.text));
      const box = h('div', { class: `tl-clip${clip ? '' : ' planned'}`, title: clip ? line.text : `${line.text} (not spoken yet)` });
      box.style.left = `${(S.start + line.at) * pps}px`;
      box.style.width = `${Math.max(4, len * pps)}px`;
      if (clip) box.append(waveFromWords(clip, len));
      box.append(h('span', { class: 'tl-clip-text', text: line.text }));
      box.addEventListener('pointerdown', () => store.select({ scene: S.id, layer: null }));
      lane.append(box);
    }
    if (!scene.voice.lines.length) lane.append(h('span', { class: 'tl-empty', text: 'No narration' }));
    return row('Voice', 'tl-voice', lane, ICONS.voice);
  }

  // A light drawing of where the words fall, until the real waveform is drawn.
  function waveFromWords(clip, len) {
    const bars = h('div', { class: 'tl-words' });
    for (const [, a, b] of clip.words) {
      const w = h('span');
      w.style.left = `${(a / len) * 100}%`;
      w.style.width = `${Math.max(0.5, ((b - a) / len) * 100)}%`;
      bars.append(w);
    }
    return bars;
  }

  let wave = { scene: null, canvas: null };
  function musicRow(scene, width) {
    const lane = h('div', { class: 'tl-lane' });
    lane.style.width = `${width}px`;
    lane.addEventListener('pointerdown', (e) => { if (e.target === lane || e.target.classList.contains('tl-music-bed')) scrub(e, lane); });
    // The bed names what plays: the score, or imported music in its place.
    const music = (scene.sound.clips || []).filter((c) => scene.assets[c.asset]?.kind === 'sound').map((c) => scene.assets[c.asset].name);
    const label = scene.sound.score === 'none' && music.length ? music.join(', ') : music.length ? `${SCORE_NAMES[scene.sound.score]} and ${music.join(', ')}` : SCORE_NAMES[scene.sound.score];
    const bed = h('div', { class: 'tl-music-bed', title: label });
    bed.style.width = `${scene.duration * pps}px`;
    bed.append(h('span', { class: 'tl-music-name', text: label }));
    if (wave.scene === scene && wave.canvas) bed.append(wave.canvas);
    lane.append(bed);
    if (scene.sound.score !== 'none') {
      for (const t of scorePlan(scene).drops) {
        const d = h('div', { class: 'tl-drop', title: `Drop at ${t.toFixed(2)} s` });
        d.style.left = `${t * pps}px`;
        lane.append(d);
      }
    }
    for (const hit of scene.sound.hits) {
      const d = h('div', { class: 'tl-hit', title: `${hit.kind[0].toUpperCase()}${hit.kind.slice(1)} at ${hit.t.toFixed(2)} s` });
      d.style.left = `${hit.t * pps}px`;
      lane.append(d);
    }
    return row('Music', 'tl-music', lane, ICONS.music);
  }

  // The real soundtrack's outline, drawn once it has been made for this version.
  async function drawWave(scene) {
    try {
      const st = await soundtrackFor(scene);
      if (!st || store.get().project.scene !== scene) return;
      const n = 1200;
      const c = h('canvas', { class: 'tl-wave' });
      c.width = n; c.height = 40;
      const g = c.getContext('2d');
      const color = getComputedStyle(el).getPropertyValue('--wave').trim() || 'rgba(255,255,255,0.35)';
      g.fillStyle = color;
      const per = Math.max(1, Math.floor(st.left.length / n));
      for (let i = 0; i < n; i++) {
        let peak = 0;
        for (let j = i * per; j < Math.min(st.left.length, (i + 1) * per); j += 8) {
          const v = Math.abs(st.left[j]) + Math.abs(st.right[j]);
          if (v > peak) peak = v;
        }
        const hh = Math.max(1, Math.min(1, peak / 1.6) * 36);
        g.fillRect(i, 20 - hh / 2, 1, hh);
      }
      wave = { scene, canvas: c };
      render();
    } catch { /* the bed shows without its outline */ }
  }

  // ---- whole render ------------------------------------------------------------
  const render = perFrame(() => {
    computePps();
    const scene = store.get().project.scene;
    const width = Math.ceil(scene.duration * pps + PAD_R);
    const S = focusScene();
    const rows = [ruler(scene, width), scenesRow(scene, width)];
    if (S) {
      if (store.get().project.code) {
        const lane = h('div', { class: 'tl-lane' }, h('span', { class: 'tl-empty', text: 'This film is drawn by the model’s own code. Ask for changes on the left.' }));
        lane.style.width = `${width}px`;
        rows.push(row('Code', 'tl-layer-row', lane, ICONS.code));
      } else if (!S.layers.length) {
        const lane = h('div', { class: 'tl-lane' }, h('span', { class: 'tl-empty', text: 'This scene has no layers.' }));
        lane.style.width = `${width}px`;
        rows.push(row('Layers', 'tl-layer-row', lane, null));
      } else {
        for (const L of S.layers) rows.push(layerRow(scene, S, L, width));
      }
    }
    rows.push(voiceRow(scene, width), musicRow(scene, width));
    clear(content).append(...rows, playhead);
    content.style.width = `${width + LABEL_W}px`;
    placePlayhead();
  });

  function placePlayhead() {
    const t = store.get().time;
    playhead.style.transform = `translateX(${X(t)}px)`;
    if (store.get().playing) {
      const x = X(t);
      const left = scroller.scrollLeft + LABEL_W, right = scroller.scrollLeft + scroller.clientWidth - 40;
      if (x < left || x > right) scroller.scrollLeft = Math.max(0, x - LABEL_W - 40);
    }
  }

  store.on('project', () => { render(); const s = store.get().project.scene; if (wave.scene !== s) drawWaveSoon(s); });
  store.on('selection', render);
  let lastFocus = null;
  store.on('time', () => {
    placePlayhead();
    if (!store.get().selection.scene) {
      const f = focusScene();
      if (f && f.id !== lastFocus) { lastFocus = f.id; render(); }
    }
  });
  const drawWaveSoon = (() => { let timer = 0; return (s) => { clearTimeout(timer); timer = setTimeout(() => drawWave(s), 600); }; })();
  new ResizeObserver(() => render()).observe(scroller);

  paintSnap();
  render();
  drawWaveSoon(store.get().project.scene);
  return { el, render, split };
}
