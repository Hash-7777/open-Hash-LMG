// The model the director is working with, for one film: how much room to give
// each question, how long Ollama keeps it loaded, what it can do, how fast it
// writes here, and where it ran.
//
// For a model on Ollama, each question's reading window is sized to what is
// sent (src/core/providers/local.js), and the window the model is loaded with
// is kept when the question fits it, since a different one reloads the model.
// Cloud services get only the longest answer each kind of question needs.

import { PROVIDERS } from '../core/providers/catalog.js';
import { showModel, requestTokens, windowFor, answerTokens, loadedFit, fitSentence, unloadModel } from '../core/providers/local.js';

const known = new Map(); // what Ollama said about each model, kept while the app runs
const windows = new Map(); // the window each model was last loaded with

export function createModelSession(settings, fetchFn) {
  const s = settings.get();
  const m = s.model;
  const local = PROVIDERS[m.provider]?.style === 'ollama';
  const base = settings.base(m.provider);
  const key = `${base}|${m.model}`;
  let speed = null;

  async function describe() {
    if (!local) return {};
    if (!known.has(key)) known.set(key, (await showModel(base, m.model, fetchFn)) || {});
    return known.get(key);
  }

  return {
    local,
    describe,
    // Extra request fields for one question.
    async options(purpose, { system, messages }) {
      const maxTokens = answerTokens(purpose);
      if (!local) return { maxTokens };
      const info = await describe();
      const w = windowFor(requestTokens({ system, messages }) + maxTokens, { modelMax: info.context, previous: windows.get(key) });
      if (!w.fits) throw new Error(`This question is longer than ${m.model} can read at once. A shorter brief, or a model that reads more, will work.`);
      windows.set(key, w.numCtx);
      return { maxTokens, numCtx: w.numCtx, keepAlive: s.local.keep || undefined };
    },
    onStats(stats) { if (stats && stats.speed) speed = stats.speed; },
    speed: () => speed,
    // Unloads the model when the person has asked for that (the default), so
    // the graphics chip is free the moment the film is made. True if unloaded.
    async release() {
      if (!local || settings.get().local.unload === false) return false;
      windows.delete(key);
      return unloadModel(base, m.model, fetchFn);
    },
    // One sentence on where the model ran, read after it has answered.
    async fitNote() {
      if (!local) return null;
      return fitSentence(await loadedFit(base, m.model, fetchFn), speed);
    },
  };
}
