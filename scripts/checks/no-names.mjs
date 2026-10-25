// Hash LMG speaks for itself: no other app, platform, product or skill is
// named in what it ships (its code, its prompts, its documents). Where a kind
// of tool or place is meant, it is described ("video editing apps", "phone
// video apps", "video platforms").
//
// The model services and voice engines the app connects to are named, because
// a person needs those names to set it up; operating systems are named where
// a fact depends on them. The barred names are kept once, as fingerprints,
// in lib/barred-names.mjs, which the commit-msg hook reads too.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { root, ok, section, done } from './lib/check.mjs';
import { nameIn, fingerprintOf } from './lib/barred-names.mjs';

const walk = (d) => (existsSync(d) ? readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; }) : []);
const files = [
  ...walk(join(root, 'src')), ...walk(join(root, 'scripts')), ...walk(join(root, 'docs')), ...walk(join(root, 'src-tauri', 'src')),
  join(root, 'README.md'), join(root, 'src-tauri', 'tauri.conf.json'), join(root, 'package.json'),
].filter((f) => existsSync(f) && /\.(m?js|css|html|md|json|rs|svg)$/.test(f) && !f.endsWith('barred-names.mjs'));

section('No other app, platform, product or skill is named');
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  const hit = lines.findIndex((l) => nameIn(l));
  ok(relative(root, f), hit < 0, hit < 0 ? '' : `line ${hit + 1}: ${nameIn(lines[hit])}`);
}
section('The rule works');
// Names are spelled in pieces here, so this file names nothing either.
const piece = (...p) => p.join('');
ok('a name is caught, in any case, inside a sentence', nameIn(`Export it for ${piece('Ch', 'atG', 'PT')} today`) === piece('ch', 'atg', 'pt'));
ok('a name of two words is caught whatever the spacing', Boolean(nameIn(`made in ${piece('Fi', 'nal', '   ', 'C', 'ut')}`)));
ok('an ordinary word is not', !nameIn('a shortcut to the reel of shortstop fabric'));
ok('the list is fingerprints, not names', !/'[a-z][a-z ]+'/.test(readFileSync(join(root, 'scripts/checks/lib/barred-names.mjs'), 'utf8').split('FINGERPRINTS = ')[1].split(']);')[0]));
ok('a fingerprint can be made for a new name', /^[0-9a-f]{16}$/.test(fingerprintOf('Some New App')));
done();
