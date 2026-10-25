// Speaking a film's narration: each line in the voice chosen in Settings,
// timed word by word so the captions light up as the words are said, and
// kept in the film as a clip. Once spoken, the lines are laid over the film
// as one script at their real lengths (narration-timing.js): a line may run
// on into the next scene for a moment, and only a scene a line would overrun
// by more is lengthened. The same words in the same voice reuse their clip.

import { VOICE_ENGINES_INFO, speechRequest, clipId } from '../core/providers/speech.js';
import { decodeWav, toMono48k, bytesToBase64 } from '../core/audio/wav.js';
import { timeWords } from '../core/audio/words.js';
import { voices, isApp, speakInCloud } from '../platform/index.js';
import { placeNarration } from '../core/scene/narration-timing.js';
import { estimateSpeech, wordCount } from '../core/scene/format.js';

const SR = 48000;

// One line's sound, as WAV bytes, from the voice chosen.
export async function speakText(settings, text) {
  const v = settings.get().voice;
  const info = VOICE_ENGINES_INFO[v.engine];
  if (!info) throw new Error('Choose a voice in Settings, under Voice, first.');
  if (info.route === 'python') {
    if (!voices.available) throw new Error('Voices installed on this computer are spoken by the desktop app.');
    return voices.speak({ engine: v.engine, text, voice: v.voice, speed: v.speed, device: v.device });
  }
  if (v.engine === 'openai' && !settings.hasKey('openai')) throw new Error('Add your OpenAI key under Cloud keys first.');
  const { url, init } = speechRequest(v.engine, { text, voice: v.voice, speed: v.speed, key: settings.key('openai'), port: v.serverPort });
  // A cloud voice is asked by the desktop side, which adds the key.
  if (v.engine === 'openai' && isApp) return speakInCloud('openai', init.body);
  let res;
  try { res = await fetch(url, init); } catch {
    throw new Error(v.engine === 'server' ? `No speech server answered on port ${v.serverPort}. Start it, or check the port in Settings.` : 'The voice service could not be reached.');
  }
  if (!res.ok) throw new Error(`The voice service answered with an error (${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

// Speaks the lines not yet spoken (every line when `again`), and returns how
// many were spoken. onLine(i, of, text) reports progress.
export async function speakLines({ store, settings, again = false, onLine = () => {} }) {
  const v = settings.get().voice;
  if (v.engine === 'none') throw new Error('Choose a voice in Settings, under Voice, first.');
  const scene = store.get().project.scene;
  const todo = scene.voice.lines.filter((l) => again || !l.clip || !scene.assets[l.clip]);
  let n = 0;
  for (const [i, line] of todo.entries()) {
    const said = line.say || line.text;
    onLine(i, todo.length, said);
    const id = clipId(v.engine, v.voice, v.speed, said);
    let clip = store.get().project.scene.assets[id];
    if (!clip) {
      const bytes = await speakText(settings, said);
      const samples = toMono48k(decodeWav(bytes));
      clip = {
        kind: 'audio', name: said.slice(0, 60), data: `data:audio/wav;base64,${bytesToBase64(bytes)}`,
        duration: samples.length / SR, words: timeWords(samples, SR, line.text), text: line.text, voice: `${v.engine} ${v.voice}`.trim(),
      };
    }
    store.edit((doc) => {
      doc.assets[id] = clip;
      const L = doc.voice.lines.find((x) => x.scene === line.scene);
      const S = doc.scenes.find((x) => x.id === line.scene);
      if (!L || !S) return false;
      L.clip = id;
      return undefined;
    });
    n++;
  }
  if (n) {
    store.edit((doc) => {
      placeNarration(doc, (l) => (l.clip && doc.assets[l.clip] ? doc.assets[l.clip].duration : estimateSpeech(wordCount(l.say || l.text))));
      return undefined;
    });
  }
  return n;
}
