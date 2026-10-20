// The app's settings and the person's keys, kept on this computer.
//
// Settings are rebuilt from a fixed list of fields on every read, the same way
// a scene is (src/core/scene/normalize.js): a value from an older version, a
// hand-edited file or a typo comes back as a valid setting, never as a value
// the rest of the app has to check again.
//
// Keys live apart from the settings, under their own storage entry, so that
// settings can be shown, exported or reset without a key ever travelling with
// them. In the desktop app the storage is the web view's own, kept in the
// app's data folder and keyed by the app's identifier; in a browser it is the
// page's local storage. Neither is encrypted, and Settings says so beside
// the place a key is typed.

import { PROVIDERS, PROVIDER_IDS, LOCAL_IDS, CLOUD_IDS } from '../core/providers/catalog.js';
import { VOICE_ENGINES_INFO } from '../core/providers/speech.js';
import { ASPECTS, FPS_CHOICES, STYLE_NAMES, DEVICES } from '../core/scene/format.js';

export const SETTINGS_KEY = 'lmg.settings.v1';
export const KEYS_KEY = 'lmg.keys.v1';

export const TIERS = ['auto', 'guided', 'plan', 'code'];
export const THEMES = ['system', 'dark', 'light'];
export const CONTAINERS = ['mp4', 'mov'];
export const QUALITIES = ['draft', 'good', 'high', 'master'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const pick = (v, list, def) => (list.includes(v) ? v : def);
const int = (v, def, lo, hi) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isInteger(n) && n >= lo && n <= hi ? n : def;
};
const numIn = (v, def, lo, hi) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};
const text = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function defaultSettings() {
  return normalizeSettings({});
}

export function normalizeSettings(input) {
  const s = isObj(input) ? input : {};
  const model = isObj(s.model) ? s.model : {};
  const local = isObj(s.local) ? s.local : {};
  const voice = isObj(s.voice) ? s.voice : {};
  const film = isObj(s.film) ? s.film : {};
  const out = isObj(s.export) ? s.export : {};
  const look = isObj(s.appearance) ? s.appearance : {};

  const ports = {};
  for (const id of LOCAL_IDS) {
    const def = Number(new URL(PROVIDERS[id].base).port);
    ports[id] = int(isObj(local.ports) ? local.ports[id] : undefined, def, 1, 65535);
  }
  const folders = isObj(voice.folders) ? voice.folders : {};

  return {
    version: 1,
    model: {
      provider: pick(model.provider, PROVIDER_IDS, 'ollama'),
      model: text(model.model, 200),
      tier: pick(model.tier, TIERS, 'auto'),
      // A model that can see pictures reviews a contact sheet of stills; it can
      // be turned off to save time and tokens.
      review: model.review === undefined ? true : Boolean(model.review),
    },
    local: {
      ports,
      device: pick(local.device, DEVICES, 'auto'),
    },
    voice: {
      engine: pick(voice.engine, ['none', ...Object.keys(VOICE_ENGINES_INFO)], 'none'),
      voice: text(voice.voice, 200),
      speed: numIn(voice.speed, 1, 0.5, 2),
      device: pick(voice.device, DEVICES, 'cpu'),
      python: text(voice.python, 1000),
      folders: { chatterbox: text(folders.chatterbox, 1000), kokoro: text(folders.kokoro, 1000) },
      serverPort: int(voice.serverPort, VOICE_ENGINES_INFO.server.defaultPort, 1, 65535),
    },
    film: {
      style: pick(film.style, STYLE_NAMES, 'studio'),
      aspect: pick(film.aspect, Object.keys(ASPECTS), '16:9'),
      fps: pick(int(film.fps, 60, 1, 240), FPS_CHOICES, 60),
      seconds: int(film.seconds, 30, 5, 600),
      narration: Boolean(film.narration),
    },
    export: {
      container: pick(out.container, CONTAINERS, 'mp4'),
      quality: pick(out.quality, QUALITIES, 'high'),
      blur: int(out.blur, 0, 0, 16),
    },
    appearance: {
      theme: pick(look.theme, THEMES, 'system'),
    },
  };
}

// Keys, one per cloud service and one for cloud voices. Anything else is dropped.
export function normalizeKeys(input) {
  const k = isObj(input) ? input : {};
  const out = {};
  for (const id of CLOUD_IDS) {
    const v = text(k[id], 400);
    if (v) out[id] = v;
  }
  return out;
}

function readJson(storage, key) {
  try {
    const raw = storage && storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeJson(storage, key, value) {
  try { storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

// A store over any object with getItem and setItem (local storage in the page,
// a map in the checks). Listeners hear every change.
export function createSettingsStore(storage) {
  let settings = normalizeSettings(readJson(storage, SETTINGS_KEY));
  let keys = normalizeKeys(readJson(storage, KEYS_KEY));
  const listeners = new Set();
  const emit = () => { for (const fn of listeners) fn(settings); };

  return {
    get: () => settings,
    // A partial change, merged one level deep: update({ film: { style: 'paper' } }).
    update(patch) {
      const next = { ...settings };
      for (const [k, v] of Object.entries(patch || {})) {
        next[k] = isObj(v) && isObj(settings[k]) ? { ...settings[k], ...v } : v;
      }
      settings = normalizeSettings(next);
      const saved = writeJson(storage, SETTINGS_KEY, settings);
      emit();
      return saved;
    },
    reset() {
      settings = defaultSettings();
      writeJson(storage, SETTINGS_KEY, settings);
      emit();
    },
    key: (id) => keys[id] || '',
    hasKey: (id) => Boolean(keys[id]),
    setKey(id, value) {
      keys = normalizeKeys({ ...keys, [id]: value });
      return writeJson(storage, KEYS_KEY, keys);
    },
    // Where a local service listens, from its port in Settings.
    base(id) {
      const p = PROVIDERS[id];
      if (!p) return '';
      return p.kind === 'local' ? `http://127.0.0.1:${settings.local.ports[id]}` : p.base;
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
