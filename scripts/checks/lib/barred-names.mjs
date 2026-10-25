// The names Hash LMG never writes: other apps, platforms, products and skills.
// Read by scripts/checks/no-names.mjs and by the commit-msg hook.
//
// They are kept as fingerprints, not as words, so the list itself names
// nothing: each is the start of the SHA-256 of the name in lower case, its
// words joined by one space. A line is read as words (letters and figures,
// a dot inside a word kept, as in a file name), and every run of one to
// 3 words is fingerprinted and looked up. To add a name, print its
// fingerprint with fingerprintOf("the name") and add it below.

import { createHash } from 'node:crypto';

const FINGERPRINTS = new Set([
  '46335fe7f3000956', 'b8124533e84f2c82', 'ae224b8778f14f9a', '443c058f72668594', '6f0fbb09c6d36db1', 'b4fd22362224a6d1',
  '3b3a7e5e1806d281', '73ba542af97d08e9', 'bf795410009206d3', 'ba5c3966adf48513', '3cd2776e9abe2d80', '83d0fd83c9c8d1bf',
  '16c7dc721bc2a15a', '857ebcf804b48917', 'd1bd7a5bd6e1467f', '790bc4bd0bbdad00', '89549c68a5647cac', '04df7707fcfebae5',
  'b40c76bf23c6072e', '01a51b61741fdc43', 'a7518cc15100be58', '7a62c1187b4217e7', '32161e08e0f2abdf', '3db1f560db626918',
  '5b79d0d574eedd09', '5a80e4ba8e6d0425', 'c95215f892421822', '6f744188ef937ce4', '06617ce460b16539', '24e6654bfd1ab85b',
  '5ede56738376a8c5', '5beeafeac2e27eae', '6348b5c02c3090a3', '474a744f02d8b7ff', 'c3b0a945be60f0d1', '7352f353c460e74c',
  'cae9d3b20ba8a782', 'a625159d18da5718', '60965168ce762e94', '57de4cf40144bdf7',
]);
const MAX_WORDS = 3;

const wordsOf = (line) => String(line).toLowerCase().replace(/-apple-system/g, '').match(/[a-z0-9]+(?:\.[a-z0-9]+)*/g) || [];
const fingerprint = (words) => createHash('sha256').update(words).digest('hex').slice(0, 16);

// The fingerprint of a name, for adding one to the list.
export const fingerprintOf = (name) => fingerprint(wordsOf(name).join(' '));

// The first barred name in a line, as written there, or null.
export function nameIn(line) {
  const w = wordsOf(line);
  for (let i = 0; i < w.length; i++) {
    for (let n = 1; n <= MAX_WORDS && i + n <= w.length; n++) {
      const run = w.slice(i, i + n).join(' ');
      if (FINGERPRINTS.has(fingerprint(run))) return run;
    }
  }
  return null;
}

// Every barred name in a text, as [{ line, name }].
export function findNames(text) {
  const out = [];
  String(text).split('\n').forEach((l, i) => { const name = nameIn(l); if (name) out.push({ line: i + 1, name }); });
  return out;
}
