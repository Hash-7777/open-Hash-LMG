// Settings and keys: rebuilt from a fixed list of fields on every read, kept
// apart from each other, and restored after the app opens again.

import assert from 'node:assert/strict';
import { section, claim, done } from './lib/check.mjs';
import { normalizeSettings, normalizeKeys, createSettingsStore, SETTINGS_KEY, KEYS_KEY } from '../../src/platform/settings.js';

const memory = () => { const m = new Map(); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
// A stand-in for the desktop side's key store: it keeps keys and answers with hints only.
const fakeVault = () => {
  const kept = {};
  const status = () => Object.fromEntries(Object.entries(kept).map(([k, v]) => [k, `ends in ${v.slice(-4)}`]));
  return { kept, status: async () => status(), set: async (id, key) => { if (key) kept[id] = key; else delete kept[id]; return status(); } };
};

section('Settings normalise');
await claim('the defaults are sane', () => {
  const d = normalizeSettings({});
  assert.equal(d.model.provider, 'ollama');
  assert.deepEqual(d.local.ports, { ollama: 11434, lmstudio: 1234, llamacpp: 8080 });
  assert.equal(d.film.style, 'auto');
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
  assert.equal(s.film.style, 'auto'); assert.equal(s.film.seconds, 30); assert.equal(s.local.ports.ollama, 11434);
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
  assert.equal(createSettingsStore(mem).get().film.style, 'auto');
});

section('Keys kept by the desktop side');
await claim('a key goes to the vault, never into the page\u2019s storage, and is never handed back', async () => {
  const mem = memory(); const vault = fakeVault(); const st = createSettingsStore(mem, vault);
  await st.ready();
  await st.setKey('openai', 'sk-test-0000aaaa1111');
  assert.equal(vault.kept.openai, 'sk-test-0000aaaa1111');
  assert.ok(![...mem.m.values()].some((v) => String(v).includes('sk-test')));
  assert.equal(st.key('openai'), '');
  assert.ok(st.hasKey('openai') && st.keyHeld());
  assert.equal(st.keyHint('openai'), 'ends in 1111');
});
await claim('forgetting a key empties it in the vault', async () => {
  const vault = fakeVault(); const st = createSettingsStore(memory(), vault);
  await st.setKey('groq', 'gsk-test-0000aaaa'); await st.setKey('groq', '');
  assert.ok(!vault.kept.groq && !st.hasKey('groq'));
});
await claim('a key an older version left in the page\u2019s storage moves to the vault once, and leaves the storage', async () => {
  const mem = memory(); mem.setItem(KEYS_KEY, JSON.stringify({ deepseek: 'sk-test-old0key9' }));
  const vault = fakeVault(); const st = createSettingsStore(mem, vault);
  await st.ready();
  assert.equal(vault.kept.deepseek, 'sk-test-old0key9');
  assert.equal(mem.getItem(KEYS_KEY), null);
  assert.ok(st.hasKey('deepseek'));
});
await claim('a key the vault would not take stays where it was, for the next start', async () => {
  const mem = memory(); mem.setItem(KEYS_KEY, JSON.stringify({ mistral: 'm-test-key-123' }));
  const vault = { status: async () => ({}), set: async () => { throw new Error('busy'); } };
  await createSettingsStore(mem, vault).ready();
  assert.ok(mem.getItem(KEYS_KEY).includes('m-test-key-123'));
});
await claim('a search key is kept like a model service\u2019s key', () => {
  assert.deepEqual(normalizeKeys({ tavily: 't', nobody: 'x' }), { tavily: 't' });
});
done();
