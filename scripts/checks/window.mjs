// Where the desktop window opens, run against real screen layouts: a first
// start is a little smaller than the screen and centred; a saved place and
// size come back; a place on a screen that is no longer there is centred on
// one that is; nothing is ever bigger than the screen.

import assert from 'node:assert/strict';
import { section, claim, done } from './lib/check.mjs';
import { planWindow, readSaved, MIN_LOGICAL } from '../../src/platform/window.js';

// A laptop at scale 2 (physical pixels), with the menu bar taken off its work area.
const laptop = { x: 0, y: 74, w: 2940, h: 1838 - 74 };
const pad = { w: 0, h: 56 };
const first = { width: 2880, height: 1800 }; // tauri.conf.json 1440 x 900 at scale 2
const external = { x: 2940, y: 0, w: 3840, h: 2160 };

section('A first start');
await claim('fits the work area with some desktop showing, and is centred', () => {
  const p = planWindow({ saved: null, now: first, pad, areas: [laptop], here: laptop, scale: 2 });
  assert.ok(p.width + pad.w <= laptop.w - 48 && p.height + pad.h <= laptop.h - 32);
  assert.equal(p.x, Math.round(laptop.x + (laptop.w - (p.width + pad.w)) / 2));
  assert.equal(p.maximized, false);
});
await claim('never goes below the minimum size when the screen allows it', () => {
  const p = planWindow({ saved: { width: 400, height: 300 }, now: first, pad, areas: [laptop], here: laptop, scale: 2 });
  assert.ok(p.width >= MIN_LOGICAL.w * 2 && p.height >= MIN_LOGICAL.h * 2);
});

section('A saved window');
await claim('comes back where and how big it was', () => {
  const saved = { x: 100, y: 120, width: 2400, height: 1500, maximized: false };
  assert.deepEqual(planWindow({ saved, now: first, pad, areas: [laptop], here: laptop, scale: 2 }), saved);
});
await claim('on a screen that was unplugged is centred on one that is there', () => {
  const p = planWindow({ saved: { x: 3200, y: 200, width: 2400, height: 1400 }, now: first, pad, areas: [laptop], here: laptop, scale: 2 });
  assert.ok(p.x >= laptop.x && p.x + p.width <= laptop.x + laptop.w);
  assert.equal(p.x, Math.round(laptop.x + (laptop.w - p.width) / 2));
});
await claim('on a second screen that is still there stays on it', () => {
  const p = planWindow({ saved: { x: 3200, y: 200, width: 2400, height: 1400 }, now: first, pad, areas: [laptop, external], here: laptop, scale: 2 });
  assert.equal(p.x, 3200); assert.equal(p.y, 200);
});
await claim('larger than the screen is cut to fit', () => {
  const p = planWindow({ saved: { x: 0, y: 74, width: 6000, height: 4000 }, now: first, pad, areas: [laptop], here: laptop, scale: 2 });
  assert.ok(p.width + pad.w <= laptop.w && p.height + pad.h <= laptop.h);
});
await claim('maximised is remembered', () => assert.equal(planWindow({ saved: { maximized: true }, now: first, pad, areas: [laptop], here: laptop, scale: 2 }).maximized, true));
await claim('nothing to measure against means no plan', () => assert.equal(planWindow({ saved: null, now: null, pad, areas: [], here: null, scale: 1 }), null));

section('What is read back');
const mem = (v) => ({ getItem: () => v });
await claim('a damaged entry is nothing', () => assert.equal(readSaved(mem('{oops')), null));
await claim('a usable entry is rounded and kept', () => assert.deepEqual(readSaved(mem(JSON.stringify({ x: 10.4, y: 20.6, width: 1000, height: 700, maximized: false }))), { x: 10, y: 21, width: 1000, height: 700, maximized: false }));
done();
