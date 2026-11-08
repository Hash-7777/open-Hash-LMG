// The app's own facts, for a film about the app itself, read from the code
// that makes them true so they cannot drift from it: its looks, its
// templates, its frame shapes, the largest export, how many questions the
// director asks at most, and the formats it exports with their codecs. The
// export table is held against the export code by scripts/checks/product-board.mjs.

import { STYLE_PACKS, STYLE_NAMES, ASPECTS } from '../scene/format.js';
import { TEMPLATES } from '../scene/templates.js';
import { sizeLabel } from '../export/sizes.js';
import { MAX_QUESTIONS } from './chat.js';

export const APP_EXPORTS = [
  { format: 'MP4', codec: 'H.264' },
  { format: 'MOV', codec: 'H.264' },
  { format: 'WebM', codec: 'AV1 + Vorbis' },
  { format: 'GIF' },
  { format: 'MP3', what: 'sound' },
];

export function appFacts() {
  return {
    name: 'Hash LMG',
    expansion: 'Hash Local Motion Graphics',
    licence: 'GPL v3, free and open source',
    looks: STYLE_NAMES.map((n) => STYLE_PACKS[n].label),
    templates: TEMPLATES.length,
    frameShapes: Object.keys(ASPECTS),
    export: APP_EXPORTS,
    largest: sizeLabel(2160),
    encoders: 'built into the app; nothing else to install',
    questionsMax: MAX_QUESTIONS,
    steps: ['Brief', 'Storyboard', 'Design', 'Check', 'Film'],
    modelJobs: ['Words', 'Drawings'],
    appJobs: ['Layout', 'Timing', 'Motion', 'Music', 'Checks'],
    privacy: 'no account and no server of ours; with a local model every part of a film is made on the computer',
    allowNames: [],
  };
}
