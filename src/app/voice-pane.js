// Settings, Voice: which voice speaks the narration, and how.
//
// Voices installed on this computer (Chatterbox, Kokoro) are pointed at once,
// by their install's folder, in the system's own dialog; the section says
// what a folder still lacks and shows the commands that install a voice, for
// the person to run. A speech server on this computer and the cloud voices
// need no install. A sample can be heard before a film is spoken.

import { h, toast } from './dom.js';
import { field, pair, section, select, segmented, numberInput, textButton } from './fields.js';
import { VOICE_ENGINES_INFO } from '../core/providers/speech.js';
import { voices } from '../platform/index.js';
import { speakText } from './narration.js';

const INSTALL = {
  kokoro: ['python3 -m venv .venv', '.venv/bin/pip install kokoro-onnx', 'Then put kokoro-v1.0.onnx and voices-v1.0.bin from the kokoro-onnx release page in the same folder.'],
  chatterbox: ['python3 -m venv venv', 'venv/bin/pip install chatterbox-tts'],
};

export function createVoicePane({ settings, repaint, command }) {
  const status = {};
  let sample = null;

  async function refresh(engine) {
    if (!voices.available || VOICE_ENGINES_INFO[engine]?.route !== 'python') return;
    try { status[engine] = await voices.status(engine); } catch (err) { status[engine] = { error: err.message || String(err) }; }
    repaint();
  }

  async function hear() {
    try {
      const bytes = await speakText(settings, 'This is how the narration of your film will sound.');
      if (sample) URL.revokeObjectURL(sample);
      sample = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
      new Audio(sample).play().catch(() => {});
    } catch (err) { toast(err.message || String(err), 'error'); }
  }

  return function paint() {
    const v = settings.get().voice;
    const info = VOICE_ENGINES_INFO[v.engine];
    const set = (patch) => { settings.update({ voice: patch }); repaint(); };
    const parts = [field('Voice', select(v.engine, [['none', 'No narration voice'], ...Object.entries(VOICE_ENGINES_INFO).map(([k, i]) => [k, i.label])], (e) => { set({ engine: e, voice: '' }); refresh(e); }), info?.blurb || 'Narration is shown as captions only, with no voice.')];
    if (info?.route === 'python') {
      const st = status[v.engine];
      if (!voices.available) parts.push(h('p', { class: 'insp-note warn', text: 'Voices installed on this computer are spoken by the desktop app.' }));
      else {
        if (!st) refresh(v.engine);
        parts.push(field('Installed in', h('div', { class: 'row' },
          h('span', { class: 'voice-folder', text: st?.set ? st.name : 'Not chosen yet' }),
          textButton(st?.set ? 'Choose another folder' : 'Choose the folder', async () => {
            try { status[v.engine] = await voices.pickFolder(v.engine); repaint(); } catch (err) { toast(err.message || String(err), 'error'); }
          })), info.folderHint));
        if (st?.set && !st.ready) parts.push(h('p', { class: 'insp-note warn', text: `This folder lacks ${st.missing.join(', ')}.` }));
        if (st?.ready) parts.push(h('p', { class: 'insp-note', text: 'Ready.' }));
        if (!st?.ready) parts.push(h('div', {}, h('div', { class: 'field-label', text: 'To install it, in a new folder, run' }), ...INSTALL[v.engine].map((c) => (c.startsWith('Then') ? h('div', { class: 'field-hint', text: c }) : command(c)))));
      }
    }
    if (info) {
      const speed = field('Speed', numberInput(v.speed, (x) => set({ speed: x }), { min: 0.5, max: 2, step: 5, scale: 100, unit: '%', digits: 0 }));
      parts.push(info.voices.length
        ? pair(field('Speaker', select(v.voice || info.voices[0], info.voices.map((x) => [x, x]), (x) => set({ voice: x }))), speed)
        : speed);
      if (v.engine === 'chatterbox') parts.push(field('Runs on', segmented(v.device, [['auto', 'Automatic'], ['cpu', 'Processor'], ['gpu', 'Graphics chip']], (x) => set({ device: x })), 'The processor is slower and leaves the graphics chip free.'));
      if (v.engine === 'server') parts.push(field('Port', numberInput(v.serverPort, (x) => set({ serverPort: Math.round(x) }), { min: 1, max: 65535, digits: 0 })));
      if (v.engine === 'openai') parts.push(h('p', { class: 'insp-note', text: 'Uses your OpenAI key from Cloud keys. Each line is sent to OpenAI to be spoken.' }));
      parts.push(h('div', { class: 'button-row' }, textButton('Hear a sample', hear)));
    }
    return [section('Voice', ...parts)];
  };
}
