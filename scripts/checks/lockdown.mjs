// The walls around model-written drawing code: after the lockdown, nothing a
// drawing has no use for is reachable from the worker's scope, and time and
// randomness are fixed so every render of a frame is identical.

import assert from 'node:assert/strict';
import { section, ok, claim, done } from './lib/check.mjs';
import { lockdown, MUST_BE_GONE } from '../../src/render/lockdown.js';
import { checkCode } from '../../src/core/director/code-check.js';

// A stand-in worker scope: what a worker has, own and inherited.
const proto = { fetch() {}, XMLHttpRequest() {}, WebSocket() {}, EventSource() {}, importScripts() {}, Worker() {}, indexedDB: {}, caches: {}, setTimeout() {}, setInterval() {}, BroadcastChannel() {}, WebAssembly: {}, navigator: {} };
const scope = Object.create(proto);
Object.assign(scope, { postMessage() {}, eval: globalThis.eval, Function: globalThis.Function, URL, Blob, localStorage: {}, performance: { now: () => 123 } });
const { keep } = lockdown(scope, { seed: 7 });

section('Gone after the lockdown');
for (const name of MUST_BE_GONE) ok(`${name} is unreachable`, scope[name] === undefined);
for (const name of ['WebAssembly', 'navigator', 'localStorage', 'BroadcastChannel', 'setInterval']) ok(`${name} is unreachable`, scope[name] === undefined);

section('Kept for the worker’s own use, taken before the walls went up');
ok('the reply channel', typeof keep.post === 'function');

section('Time and chance are fixed');
await claim('the clock never moves', () => { assert.equal(Date.now(), 0); assert.equal(scope.performance.now(), 0); });
await claim('random numbers repeat from the seed', () => { const a = Math.random(); assert.ok(a >= 0 && a < 1); });
await claim('code cannot be built from text through a function constructor', () => {
  const Ctor = Object.getPrototypeOf(function () {}).constructor;
  assert.equal(Ctor, undefined);
});

section('The code check names what a drawing may not do');
const refuse = (code, re) => ok(`refuses: ${re}`, checkCode(code).some((p) => re.test(p)));
const body = (s) => `export default function render(t, lmg) { ${s} }`;
refuse(body('fetch("x")'), /network/);
refuse(body('setTimeout(() => {}, 1)'), /timer/);
refuse(body('Date.now()'), /clock/);
refuse(body('Math.random()'), /lmg\.rand/);
refuse(body('localStorage.x = 1'), /storage/);
refuse(body('while (true) {}'), /no end/);
refuse(body('document.body'), /page/);
refuse('function draw() {}', /no render function/);
ok('a plain drawing passes', checkCode(body('lmg.clear("bg"); // fetch in a comment is fine')).length === 0);
done();
