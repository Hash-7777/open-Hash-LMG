// The inspector's Narration section for a scene: the line the voice says,
// whether it has been spoken yet, and a button that speaks every line not yet
// spoken in the voice chosen in Settings.

import { toast } from './dom.js';
import { field, section, textArea, textButton, buttonRow } from './fields.js';
import { speakLines } from './narration.js';

export function narrationSection(S, scene, { store, settings }) {
  const line = scene.voice.lines.find((l) => l.scene === S.id);
  const setLine = (text, live) => store.edit((doc) => {
    const lines = doc.voice.lines;
    const i = lines.findIndex((l) => l.scene === S.id);
    const clean = text.trim();
    if (!clean) { if (i >= 0) lines.splice(i, 1); else return false; return undefined; }
    if (i >= 0) { if (lines[i].text === clean) return false; lines[i].text = clean; lines[i].clip = null; } else lines.push({ scene: S.id, text: clean, at: 0.15 });
    return undefined;
  }, { live });
  async function speakAll() {
    try {
      const n = await speakLines({ store, settings, onLine: (i, of) => toast(`Speaking line ${i + 1} of ${of}`) });
      toast(n ? `Spoke ${n} line${n === 1 ? '' : 's'}` : 'Every line is already spoken');
    } catch (err) { toast(err.message || String(err), 'error'); }
  }
  return section('Narration',
    field('Spoken line', textArea(line ? line.text : '', { onLive: (v) => setLine(v, true), onCommit: (v) => { setLine(v, true); store.commit(); }, rows: 3, placeholder: 'What the voice says in this scene', max: 300 }),
      line && line.clip ? null : line ? 'Not spoken yet.' : null),
    settings && scene.voice.lines.length ? buttonRow(textButton('Speak every line', speakAll)) : null);
}
