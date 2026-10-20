// The preview: the film drawn at the playhead, the transport under it, and
// direct handling of what is on the picture (click a layer to select it, drag
// it to move it).
//
// Frames come from the render host, which draws off the page's thread. Only
// one frame is asked for at a time; while it is being drawn, newer playhead
// positions replace each other, so a slow frame drops frames instead of
// falling behind. Playing follows the sound's own clock when there is sound,
// so picture and music cannot drift apart.

import { h, iconButton, timecode, perFrame } from './dom.js';
import { ICONS } from './icons.js';
import { findLayer } from './store.js';
import { safeArea } from '../core/scene/lint.js';
import { soundtrackFor } from './soundtrack.js';

export function createPlayer({ store, host, prefs }) {
  const canvas = h('canvas', { class: 'preview-canvas', 'aria-label': 'Film preview' });
  const overlay = h('canvas', { class: 'preview-overlay', 'aria-hidden': 'true' });
  const notice = h('div', { class: 'preview-notice', hidden: true });
  const frameBox = h('div', { class: 'preview-frame' }, canvas, overlay, notice);
  const viewport = h('div', { class: 'preview-viewport' }, frameBox);
  const g = canvas.getContext('2d', { alpha: false });
  const og = overlay.getContext('2d');

  // ---- transport ---------------------------------------------------------
  const playBtn = iconButton(ICONS.play, 'Play (Space)', () => toggle(), 'play-btn');
  const time = h('span', { class: 'timecode' });
  const loopBtn = iconButton(ICONS.loop, 'Loop', () => { prefs.loop = !prefs.loop; paintToggles(); });
  const soundBtn = iconButton(ICONS.sound, 'Sound', () => { prefs.sound = !prefs.sound; applyVolume(); paintToggles(); });
  const safeBtn = iconButton(ICONS.safe, 'Safe area guides', () => { prefs.safe = !prefs.safe; paintToggles(); drawOverlay(); });
  const status = h('span', { class: 'transport-status' });
  const facts = h('span', { class: 'transport-facts' });
  const transport = h('div', { class: 'transport' },
    h('div', { class: 'transport-group' },
      iconButton(ICONS.toStart, 'Go to start (Home)', () => seek(0)),
      iconButton(ICONS.stepBack, 'Back one frame (Left)', () => step(-1)),
      playBtn,
      iconButton(ICONS.stepForward, 'Forward one frame (Right)', () => step(1)),
      iconButton(ICONS.toEnd, 'Go to end (End)', () => seek(store.get().project.scene.duration))),
    time,
    status,
    h('span', { class: 'spacer' }),
    facts,
    h('div', { class: 'transport-group' }, loopBtn, soundBtn, safeBtn));

  const el = h('section', { class: 'stage', 'aria-label': 'Preview' }, viewport, transport);

  function paintToggles() {
    loopBtn.classList.toggle('on', prefs.loop);
    loopBtn.setAttribute('aria-pressed', String(prefs.loop));
    soundBtn.innerHTML = prefs.sound ? ICONS.sound : ICONS.mute;
    soundBtn.classList.toggle('on', prefs.sound);
    soundBtn.setAttribute('aria-pressed', String(prefs.sound));
    safeBtn.classList.toggle('on', prefs.safe);
    safeBtn.setAttribute('aria-pressed', String(prefs.safe));
  }

  // ---- fitting the frame into the space ------------------------------------
  let cssW = 0, cssH = 0;
  function fit() {
    const scene = store.get().project.scene;
    const r = viewport.getBoundingClientRect();
    const pad = 24;
    const availW = Math.max(40, r.width - pad * 2), availH = Math.max(40, r.height - pad * 2);
    const k = Math.min(availW / scene.width, availH / scene.height);
    cssW = Math.max(1, Math.floor(scene.width * k));
    cssH = Math.max(1, Math.floor(scene.height * k));
    frameBox.style.width = `${cssW}px`;
    frameBox.style.height = `${cssH}px`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [canvas, overlay]) {
      const w = Math.round(cssW * dpr), hh = Math.round(cssH * dpr);
      if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh; }
    }
    requestDraw();
  }
  new ResizeObserver(() => fit()).observe(viewport);

  // ---- drawing --------------------------------------------------------------
  // Scene and code reach the host in order, and frames wait for them.
  let sync = Promise.resolve();
  let sentScene = null, sentCode;
  let drawing = false, pending = false;
  let lastBitmapOk = false;
  let boxes = [];
  let boxesAt = -1;

  function pushScene() {
    const { scene, code } = store.get().project;
    if (scene === sentScene && code === sentCode) return;
    const codeChanged = code !== sentCode;
    sentScene = scene;
    sentCode = code;
    boxesAt = -1;
    sync = sync.then(async () => {
      await host.setScene(scene);
      if (codeChanged) await host.setCode(code);
      notice.hidden = true;
    }).catch((err) => showNotice(err.message || String(err)));
  }

  function showNotice(msg) {
    notice.textContent = msg;
    notice.hidden = false;
  }

  async function drawNow() {
    drawing = true;
    try {
      await sync;
      const t = store.get().time;
      const bmp = await host.frame(t);
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      bmp.close?.();
      lastBitmapOk = true;
    } catch (err) {
      if (!lastBitmapOk) showNotice(err.message || String(err));
    } finally {
      drawing = false;
    }
    drawOverlay();
    if (pending) { pending = false; drawNow(); }
  }

  function requestDraw() {
    if (!cssW) return;
    if (drawing) { pending = true; return; }
    drawNow();
  }

  // Where the selected layer is, measured by drawing the frame at the playhead.
  const measureSoon = perFrame(async () => {
    const st = store.get();
    if (st.playing || !st.selection.layer || st.project.code) { boxes = []; drawOverlay(); return; }
    const t = st.time;
    try {
      await sync;
      const [sample] = await host.measure([t]);
      boxes = sample ? sample.boxes : [];
      boxesAt = t;
    } catch { boxes = []; }
    drawOverlay();
  });

  function selectedIds() {
    const st = store.get();
    const S = st.project.scene.scenes.find((x) => x.id === st.selection.scene);
    const L = S && st.selection.layer ? findLayer(S.layers, st.selection.layer) : null;
    if (!L) return new Set();
    const ids = new Set([L.id]);
    const walk = (list) => { for (const k of list || []) { ids.add(k.id); walk(k.layers); } };
    walk(L.layers);
    return ids;
  }

  function unionOf(list) {
    if (!list.length) return null;
    const x0 = Math.min(...list.map((b) => b.x)), y0 = Math.min(...list.map((b) => b.y));
    const x1 = Math.max(...list.map((b) => b.x + b.w)), y1 = Math.max(...list.map((b) => b.y + b.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function drawOverlay() {
    const scene = store.get().project.scene;
    og.clearRect(0, 0, overlay.width, overlay.height);
    const k = overlay.width / scene.width;
    const accent = getComputedStyle(el).getPropertyValue('--accent').trim() || '#d9b46c';
    if (prefs.safe) {
      const a = safeArea(scene);
      og.save();
      og.strokeStyle = 'rgba(255,255,255,0.5)';
      og.setLineDash([4, 4]);
      og.lineWidth = 1;
      og.strokeRect(Math.round(a.left * overlay.width) + 0.5, Math.round(a.top * overlay.height) + 0.5,
        Math.round((a.right - a.left) * overlay.width), Math.round((a.bottom - a.top) * overlay.height));
      og.restore();
    }
    if (boxesAt === store.get().time && !store.get().playing) {
      const ids = selectedIds();
      const box = unionOf(boxes.filter((b) => ids.has(b.tag)));
      if (box) {
        og.save();
        og.strokeStyle = accent;
        og.lineWidth = Math.max(1, Math.round(window.devicePixelRatio || 1));
        og.strokeRect(Math.round(box.x * k) - 2.5, Math.round(box.y * k) - 2.5, Math.round(box.w * k) + 5, Math.round(box.h * k) + 5);
        og.restore();
      }
    }
  }

  // ---- picking and moving on the picture -----------------------------------
  canvas.addEventListener('pointerdown', async (e) => {
    const st = store.get();
    if (st.playing || st.project.code) return;
    const r = canvas.getBoundingClientRect();
    const scene = st.project.scene;
    const fx = ((e.clientX - r.left) / r.width) * scene.width;
    const fy = ((e.clientY - r.top) / r.height) * scene.height;
    let list = boxes;
    if (boxesAt !== st.time) {
      try { await sync; list = (await host.measure([st.time]))[0]?.boxes || []; boxes = list; boxesAt = st.time; } catch { list = []; }
    }
    const hit = [...list].reverse().find((b) => b.tag && fx >= b.x && fx <= b.x + b.w && fy >= b.y && fy <= b.y + b.h);
    if (!hit) { store.select({ scene: st.selection.scene, layer: null }); return; }
    const owner = scene.scenes.find((S) => findLayer(S.layers, hit.tag));
    // A click inside a group selects the group's top layer.
    const top = owner ? owner.layers.find((L) => L.id === hit.tag || findLayer(L.layers, hit.tag)) : null;
    if (!owner || !top) return;
    store.select({ scene: owner.id, layer: top.id });
    const x0 = top.x, y0 = top.y;
    let moved = false;
    const move = (ev) => {
      const dx = (ev.clientX - e.clientX) / r.width, dy = (ev.clientY - e.clientY) / r.height;
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return;
      moved = true;
      store.edit((doc) => {
        const S = doc.scenes.find((x) => x.id === owner.id);
        const L = S && S.layers.find((x) => x.id === top.id);
        if (!L) return false;
        L.x = +(x0 + dx).toFixed(4);
        L.y = +(y0 + dy).toFixed(4);
      }, { live: true });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) store.commit();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  // ---- playing ---------------------------------------------------------------
  let audio = null;      // { ctx, gain }
  let source = null;
  let clock = null;      // { kind: 'audio'|'wall', t0, at }
  let raf = 0;

  function audioCtx() {
    if (!audio) {
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Ctx) return null;
      const ctx = new Ctx({ sampleRate: 48000 });
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      audio = { ctx, gain, buffer: null, bufferFor: null };
    }
    return audio;
  }
  function applyVolume() {
    if (audio) audio.gain.gain.value = prefs.sound ? 1 : 0;
  }

  function stopSource() {
    if (source) { try { source.stop(); } catch { /* already stopped */ } source.disconnect(); source = null; }
  }

  function startSource(t) {
    const a = audio;
    if (!a || !a.buffer || a.bufferFor !== store.get().project.scene) return false;
    stopSource();
    source = a.ctx.createBufferSource();
    source.buffer = a.buffer;
    source.connect(a.gain);
    source.start(0, Math.min(t, a.buffer.duration));
    clock = { kind: 'audio', t0: t, at: a.ctx.currentTime };
    return true;
  }

  async function prepareSound() {
    const a = audioCtx();
    if (!a) return;
    const scene = store.get().project.scene;
    if (a.bufferFor === scene) return;
    status.textContent = 'Preparing sound';
    try {
      const st = await soundtrackFor(scene);
      if (store.get().project.scene !== scene) return;
      if (!st) { a.buffer = null; a.bufferFor = scene; return; }
      const buf = a.ctx.createBuffer(2, st.left.length, st.sampleRate);
      buf.copyToChannel(st.left, 0);
      buf.copyToChannel(st.right, 1);
      a.buffer = buf;
      a.bufferFor = scene;
      if (store.get().playing) startSource(now());
    } catch (err) {
      status.textContent = 'Sound could not be made';
      return;
    }
    status.textContent = '';
  }

  function now() {
    if (!clock) return store.get().time;
    if (clock.kind === 'audio' && audio) return clock.t0 + (audio.ctx.currentTime - clock.at);
    return clock.t0 + (performance.now() - clock.at) / 1000;
  }

  function tick() {
    const st = store.get();
    if (!st.playing) return;
    const d = st.project.scene.duration;
    let t = now();
    if (t >= d) {
      if (prefs.loop) {
        t = 0;
        clock = { kind: 'wall', t0: 0, at: performance.now() };
        if (!startSource(0)) stopSource();
      } else {
        store.setTime(d);
        pause();
        return;
      }
    }
    store.setTime(t);
    raf = requestAnimationFrame(tick);
  }

  function play() {
    const st = store.get();
    if (st.playing) return;
    let t = st.time;
    if (t >= st.project.scene.duration - 1 / st.project.scene.fps) { t = 0; store.setTime(0); }
    const a = audioCtx();
    if (a && a.ctx.state === 'suspended') a.ctx.resume();
    applyVolume();
    clock = { kind: 'wall', t0: t, at: performance.now() };
    store.setPlaying(true);
    if (!startSource(t)) prepareSound();
    raf = requestAnimationFrame(tick);
  }

  function pause() {
    cancelAnimationFrame(raf);
    stopSource();
    clock = null;
    store.setPlaying(false);
  }

  function toggle() { if (store.get().playing) pause(); else play(); }

  function seek(t) {
    const playing = store.get().playing;
    if (playing) pause();
    store.setTime(t);
    if (playing) play();
  }

  function step(frames) {
    const st = store.get();
    if (st.playing) pause();
    const fps = st.project.scene.fps;
    store.setTime(Math.round(st.time * fps + frames) / fps);
  }

  // ---- following the store ---------------------------------------------------
  function paintTime() {
    const st = store.get();
    time.textContent = `${timecode(st.time)} / ${timecode(st.project.scene.duration)}`;
  }
  function paintFacts() {
    const s = store.get().project.scene;
    facts.textContent = `${s.width} × ${s.height}  ·  ${s.fps} fps  ·  ${s.bpm} bpm`;
  }

  store.on('time', () => { paintTime(); requestDraw(); if (!store.get().playing) measureSoon(); });
  store.on('project', () => {
    const st = store.get();
    pushScene();
    paintTime();
    paintFacts();
    fit();
    if (st.playing && audio && audio.bufferFor !== st.project.scene) { stopSource(); clock = { kind: 'wall', t0: now(), at: performance.now() }; prepareSound(); }
    measureSoon();
  });
  store.on('selection', () => { boxesAt = -1; measureSoon(); drawOverlay(); });
  store.on('playing', () => {
    const on = store.get().playing;
    playBtn.innerHTML = on ? ICONS.pause : ICONS.play;
    playBtn.setAttribute('aria-label', on ? 'Pause (Space)' : 'Play (Space)');
    playBtn.title = on ? 'Pause (Space)' : 'Play (Space)';
    if (!on) measureSoon();
  });

  pushScene();
  paintTime();
  paintFacts();
  paintToggles();

  return { el, play, pause, toggle, seek, step, redraw: requestDraw };
}
