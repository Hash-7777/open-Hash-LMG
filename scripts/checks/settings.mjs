// Settings and keys: rebuilt from a fixed list of fields on every read, kept
// apart from each other, and restored after the app opens again.

import assert from 'node:assert/strict';
import { section, claim, done } from './lib/check.mjs';
import { normalizeSettings, normalizeKeys, createSettingsStore, SETTINGS_KEY, KEYS_KEY } from '../../src/platform/settings.js';

const memory = () => { const m = new Map(); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

section('Settings normalise');
await claim('the defaults are sane', () => {
  const d = normalizeSettings({});
  assert.equal(d.model.provider, 'ollama');
  assert.deepEqual(d.local.ports, { ollama: 11434, lmstudio: 1234, llamacpp: 8080 });
  assert.equal(d.film.style, 'studio');
});
await claim('guided films choose from two storyboards unless told otherwise, never more than three', () => {
  assert.equal(normalizeSettings({}).model.drafts, 2);
  assert.equal(normalizeSettings({ model: { drafts: 9 } }).model.drafts, 2);
  assert.equal(normalizeSettings({ model: { drafts: 3 } }).model.drafts, 3);
});
await claim('normalising twice changes nothing', () => { const d = normalizeSettings({ film: { style: 'paper' } }); assert.deepEqual(normalizeSettings(d), d); });
await claim('unknown or out-of-range values come back valid', () => {
  const s = normalizeSettings({ model: { provider: 'nope', tier: 'x' }, film: { fps: 61, style: 'zzz', seconds: 2 }, local: { ports: { ollama: '99999' }, device: 'gpu' }, voice: { speed: 9 }, extra: 1 });
  assert.equal(s.model.provider, 'ollama'); assert.equal(s.model.tier, 'auto'); assert.equal(s.film.fps, 60);
  assert.equal(s.film.style, 'studio'); assert.equal(s.film.seconds, 30); assert.equal(s.local.ports.ollama, 11434);
  assert.equal(s.local.device, 'gpu'); assert.equal(s.voice.speed, 2); assert.equal(s.extra, undefined);
});
await claim('only cloud services keep keys, trimmed', () => assert.deepEqual(normalizeKeys({ openai: ' a ', ollama: 'b', other: 'c' }), { openai: 'a' }));

section('The store');
await claim('a change merges one level deep and is heard', () => {
  const st = createSettingsStore(memory());
  let heard = 0; st.subscribe(() => heard++);
  st.update({ film: { style: 'paper' } });
  assert.equal(st.get().film.style, 'paper'); assert.equal(st.get().film.aspect, '16:9'); assert.equal(heard, 1);
});
await claim('a local service is addressed on its own port, on this computer only', () => {
  const st = createSettingsStore(memory());
  st.update({ local: { ports: { ...st.get().local.ports, ollama: 11500 } } });
  assert.equal(st.base('ollama'), 'http://127.0.0.1:11500'); assert.equal(st.base('openai'), 'https://api.openai.com');
});
await claim('keys never enter the settings entry', () => {
  const mem = memory(); const st = createSettingsStore(mem);
  st.setKey('openai', 'a-test-value');
  assert.ok(!(mem.m.get(SETTINGS_KEY) || '').includes('a-test-value')); assert.ok(mem.m.get(KEYS_KEY).includes('a-test-value'));
});
await claim('everything is there after reopening', () => {
  const mem = memory(); const a = createSettingsStore(mem);
  a.update({ film: { style: 'mono' } }); a.setKey('groq', 'g');
  const b = createSettingsStore(mem);
  assert.equal(b.get().film.style, 'mono'); assert.equal(b.key('groq'), 'g');
});
await claim('a damaged stored entry reads as the defaults', () => {
  const mem = memory(); mem.setItem(SETTINGS_KEY, '{broken');
  assert.equal(createSettingsStore(mem).get().film.style, 'studio');
});
done();
