// Making a product film from its form: the facts, the storyboard a model
// writes against them, each line spoken in the voice chosen in Settings (or
// timed as if spoken when there is none), the two accents read from the icon,
// and the planner, which lays the whole film out on the stage.

import { formFacts, fillLines, spokenLines } from '../core/scene/product-board.js';
import { writeProductBoard } from '../core/director/product-board.js';
import { planProductFilm } from '../core/scene/product-film.js';
import { normalizeScene } from '../core/scene/normalize.js';
import { estimateSpeech, wordCount } from '../core/scene/format.js';
import { iconAccents } from '../core/util/accents.js';
import { clipId } from '../core/providers/speech.js';
import { decodeWav, toMono48k, bytesToBase64 } from '../core/audio/wav.js';
import { timeWords } from '../core/audio/words.js';
import { extractJson } from '../core/util/json.js';
import { guarded } from '../core/director/guard.js';
import { speakText } from './narration.js';

const SR = 48000;
// A product film is changed from its form; the conversation points there.
export const PRODUCT_CHANGE = 'A product film is changed from its form: choose New film, then Product film, change what it is made from, and make it again.';
// The release score's key, from the name, so two products seldom share one.
const KEYS = [-5, -3, -2, 0, 2, 3];
const keyFor = (name) => KEYS[[...String(name)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % KEYS.length];

// The icon's two strongest colours, from its picture.
async function accentsOf(asset) {
  if (!asset?.data) return {};
  try {
    const bmp = await createImageBitmap(await (await fetch(asset.data)).blob());
    const c = new OffscreenCanvas(Math.min(256, bmp.width), Math.min(256, bmp.height));
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    const a = iconAccents(g.getImageData(0, 0, c.width, c.height).data);
    return { ...(a.accent ? { accent: a.accent } : {}), ...(a.accent2 ? { accent2: a.accent2 } : {}) };
  } catch { return {}; }
}

// form: the product form; icon: its picture asset or null. askModel: the
// director's question to the model. Returns { scene, board, problems }.
export async function runProductFilm({ form, icon, askModel, settings, progress, note, signal }) {
  const facts = formFacts(form);
  const brief = `A launch film for ${form.name}: ${form.line}`;
  progress.step('story', 'Writing the storyboard');
  const askJson = async (system, content, { schema, purpose }) => {
    const text = await askModel({ system: guarded(system), messages: [{ role: 'user', content }], json: true, schema, purpose });
    return extractJson(text).value || {};
  };
  const board = fillLines(await writeProductBoard(askJson, note, brief, facts), form);
  progress.stepDone('story');

  // Each line spoken, or timed as if it were.
  const v = settings.get().voice;
  const speak = v.engine !== 'none';
  const said = spokenLines(board, facts);
  const lines = {}, assets = {};
  progress.step('voice', speak ? 'Speaking the lines' : 'Timing the lines');
  const keys = Object.keys(said);
  for (const [i, k] of keys.entries()) {
    if (signal?.aborted) throw Object.assign(new Error('Stopped'), { stopped: true });
    const { text, say } = said[k];
    if (!speak) { lines[k] = { text, say, length: estimateSpeech(wordCount(text)) }; continue; }
    progress.within(i / keys.length, `Speaking line ${i + 1} of ${keys.length}`);
    const bytes = await speakText(settings, say || text);
    const samples = toMono48k(decodeWav(bytes));
    const id = clipId(v.engine, v.voice, v.speed, say || text);
    const words = timeWords(samples, SR, text);
    assets[id] = { kind: 'audio', name: text.slice(0, 60), data: `data:audio/wav;base64,${bytesToBase64(bytes)}`, duration: samples.length / SR, words, text, voice: `${v.engine} ${v.voice}`.trim() };
    lines[k] = { text, say, length: samples.length / SR, words: words.map(([w, s, e]) => [w, s, e]), clip: id };
  }
  progress.stepDone('voice');
  if (!speak) note('No voice is chosen, so the film is timed as if its lines were spoken. Choose one in Settings, under Voice, and make it again to hear them.');

  progress.step('layout', 'Laying out the film');
  const iconKey = icon ? 'product-icon' : null;
  const plan = planProductFilm({
    board, lines, icon: iconKey, assets: { ...(icon ? { [iconKey]: icon } : {}), ...assets },
    palette: await accentsOf(icon), key: keyFor(form.name), voice: speak ? { engine: v.engine, voice: v.voice } : null,
  });
  for (const p of plan.problems) note(p);
  const { scene } = normalizeScene(plan.doc);
  progress.stepDone('layout');
  return { scene, board, problems: plan.problems };
}
