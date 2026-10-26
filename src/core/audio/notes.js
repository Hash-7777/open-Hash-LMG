// Plays a composition (music-kit.js) with the app's own instruments: each note
// or drum is made once per pitch and length and laid onto the score's buses,
// the music under the kick lowered a little for each one, as in the grooves.
//
// Levels are set per instrument so a model's gain of 0.5 sits where a groove
// would put that instrument; the master then brings the whole to platform
// loudness.

import { arrange } from './music-kit.js';
import { SR, pad, kick, sub, tick, hat, snap, boom, swell, whoosh, bell, hit, mallet, pluck, epiano, synthPluck, bass, clap, shaker } from './synth.js';

const freq = (midi) => 440 * 2 ** ((midi - 69) / 12);

// [how loud to the room, how much to the reverb]
const LEVEL = {
  pad: [0.55, 0.45], keys: [0.22, 0.15], mallet: [0.4, 0.2], pluck: [0.5, 0.25], synth: [0.32, 0.15], bass: [0.7, 0], sub: [0.75, 0], bell: [0.14, 0.12],
  kick: [1, 0], clap: [0.5, 0.25], snare: [0.4, 0.25], hat: [0.14, 0.03], shaker: [0.2, 0.05], tick: [0.14, 0.03],
  // A boom at a model's usual gain lands where a groove's does, under the voice.
  boom: [0.55, 0.2], swell: [0.4, 0.25], whoosh: [0.35, 0.1], hit: [0.4, 0.1], chime: [0.14, 0.12],
};

function voice(inst, midi, len, seed, beat) {
  const f = freq(midi);
  switch (inst) {
    case 'pad': return pad(f, len + 1, seed + midi, { harmonics: 5, attack: Math.min(0.9, len * 0.35), release: Math.min(1.2, len * 0.4 + 0.3) });
    case 'keys': return epiano(f, Math.max(0.6, len + 0.4));
    case 'mallet': return mallet(f, Math.max(0.4, Math.min(2, len + 0.3)));
    case 'pluck': return pluck(f, Math.max(0.5, Math.min(3, len + 0.5)), seed + midi, 0.5);
    case 'synth': return synthPluck(f, Math.max(0.12, Math.min(2, len)), 1.2);
    case 'bass': return bass(f, Math.max(0.1, Math.min(3, len)));
    case 'sub': return sub(f, Math.max(0.1, Math.min(3, len)));
    case 'bell': return bell(f, Math.max(1, Math.min(4, len + 1)));
    case 'kick': return kick(seed + 3);
    case 'clap': return clap(seed + 23);
    case 'snare': return snap(seed + 9);
    case 'hat': return hat(seed + 5);
    case 'shaker': return shaker(seed + 29);
    case 'tick': return tick(seed + 7);
    case 'boom': return boom(seed + 11);
    case 'swell': return swell(2 * beat, seed + 13);
    case 'whoosh': return whoosh(0.45, seed + 17);
    case 'hit': return hit(seed + 19);
    default: return null;
  }
}

// Lays the notes onto dry and send, as arranged (music-kit.js arrange).
// duck(t, depth) lowers the bed under a kick.
export function playNotes(notes, { dry, send, duck, seed = 1, beat = 0.5 }) {
  const made = new Map();
  for (const [t, inst, midi, len, gain, pan] of arrange(notes, beat)) {
    if (inst === 'chime') {
      for (const [dt, f] of [[0, 88], [0.12, 93]]) { const sig = bell(freq(f), 1.6); dry.add(sig, t + dt, LEVEL.chime[0] * gain, pan); send.add(sig, t + dt, LEVEL.chime[1] * gain, pan); }
      continue;
    }
    const key = `${inst}|${midi}|${Math.round(len * 20)}`;
    let sig = made.get(key);
    if (sig === undefined) { sig = voice(inst, midi, len, seed, beat); made.set(key, sig); }
    if (!sig) continue;
    // A swell rises into its time; a whoosh is centred on it.
    const at = inst === 'swell' ? t - sig.length / SR : inst === 'whoosh' ? t - 0.2 : t;
    const [toRoom, toVerb] = LEVEL[inst] || [0.3, 0.1];
    dry.add(sig, at, toRoom * gain * 2, pan);
    if (toVerb) send.add(sig, at, toVerb * gain * 2, pan);
    if (inst === 'kick') duck(t, 0.55);
  }
}
