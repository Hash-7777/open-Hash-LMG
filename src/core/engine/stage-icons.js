// The line drawings the stage's cards carry, each drawn in two passes: its
// outline in ink, then its accent in the film's own colour. Every drawing is
// centred on (0, 0) in a card's pixels. A film names one by its key; a key it
// does not know falls back to a plain frame.

import { stroke, STUDIO } from './stage-paint.js';

const FRAME = ['M-60 -42 H60 V42 H-60 Z', 3];
const grid6 = [[-40, -22], [0, -22], [40, -22], [-40, 22], [0, 22], [40, 22]]
  .map(([x, y]) => [`M${x - 17} ${y - 14} H${x + 17} V${y + 14} H${x - 17} Z`, 2.6]);
const pins = (r, near, far) => [-12, 0, 12].map((k) => [`M${k} -${r} V-${far} M${k} ${r} V${far} M-${r} ${k} H-${far} M${r} ${k} H${far}`, 2.4]).concat([[`M-${near} -${near} H${near} V${near} H-${near} Z`, 3]]);

// base: drawn first, in ink; accent: then, in the accent; second: in the second accent.
export const ICONS = {
  brief: { base: [['M-58 -40 H58 V26 H-10 L-34 48 V26 H-58 Z', 3]], accent: [['M-38 -16 H38 M-38 4 H18', 3]] },
  storyboard: { base: grid6, accent: [['M-57 -22 H-23', 3]] },
  design: { base: [FRAME, ['M-40 -18 H8 M-40 -2 H24', 2.6]], accent: [['M40 24 m-14 0 a14 14 0 1 0 28 0 a14 14 0 1 0 -28 0', 3]] },
  check: { base: [FRAME], accent: [['M-26 2 L-6 22 L30 -18', 4]] },
  film: { base: [FRAME], accent: [['M-12 -18 L18 0 L-12 18 Z', 3.4]], second: [['M-44 58 C-30 48 -18 68 -4 58 C10 48 22 68 36 58', 2.4]] },
  chip: { base: [], accent: pins(26, 26, 36) },
  window: { base: [['M-34 -26 H34 V26 H-34 Z', 3], ['M-34 10 H34 M-6 -26 V10', 2.4]], accent: [['M14 -8 L26 0', 2.4]] },
  computer: {
    base: [['M-120 -80 H120 V60 H-120 Z', 3], ['M-160 60 H160 L140 92 H-140 Z', 3]],
    accent: [['M-34 -42 H34 V22 H-34 Z', 3], ...[-20, 0, 20].flatMap((k) => [[`M${k} -42 V-56 M${k} 22 V36`, 2.4], [`M-34 ${k - 10} H-48 M34 ${k - 10} H48`, 2.4]])],
  },
  'no-server': {
    base: [['M-110 40 C-170 40 -170 -40 -104 -36 C-98 -96 -10 -110 18 -58 C60 -96 132 -62 118 -10 C170 -6 160 40 112 40 Z', 3]],
    accent: [['M-150 90 L150 -110', 3.4]],
  },
  lock: { base: [['M-70 -10 H70 V100 H-70 Z', 3], ['M-44 -10 V-50 C-44 -100 44 -100 44 -50 V-10', 3]], accent: [['M0 32 V62', 4]] },
  frame: { base: [FRAME], accent: [] },
};
export const ICON_NAMES = Object.keys(ICONS);

// Draws a drawing about (0, 0): its outline p of the way, its accents q.
// scale: how much larger the context draws it; lines keep their weight.
export function drawIcon(g, name, p, q, colors = {}, scale = 1) {
  const I = ICONS[name] || ICONS.frame;
  const ink = colors.ink || STUDIO.ink;
  for (const [d, w] of I.base) stroke(g, d, p, w / scale, ink);
  for (const [d, w] of I.accent || []) stroke(g, d, q, w / scale, colors.accent || '#e9423f');
  for (const [d, w] of I.second || []) stroke(g, d, q, w / scale, colors.accent2 || '#d9b26a');
}
