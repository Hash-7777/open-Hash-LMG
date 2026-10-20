// Hash LMG speaks for itself: no other app, platform, product or skill is
// named in what it ships (its code, its prompts, its documents). Where a kind
// of tool or place is meant, it is described ("video editing apps", "phone
// video apps", "video platforms").
//
// The model services and voice engines the app connects to are named, because
// a person needs those names to set it up; operating systems are named where
// a fact depends on them. The barred names are written once, in
// lib/barred-names.mjs, which the commit-msg hook reads too.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { root, ok, section, done } from './lib/check.mjs';
import { PATTERN, BARRED } from './lib/barred-names.mjs';

const walk = (d) => (existsSync(d) ? readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; }) : []);
const files = [
  ...walk(join(root, 'src')), ...walk(join(root, 'scripts')), ...walk(join(root, 'docs')), ...walk(join(root, 'src-tauri', 'src')),
  join(root, 'README.md'), join(root, 'src-tauri', 'tauri.conf.json'), join(root, 'package.json'),
].filter((f) => existsSync(f) && /\.(m?js|css|html|md|json|rs|svg)$/.test(f) && !f.endsWith('barred-names.mjs'));

section('No other app, platform, product or skill is named');
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  const hit = lines.findIndex((l) => PATTERN.test(l.replace(/-apple-system/g, '')));
  ok(relative(root, f), hit < 0, hit < 0 ? '' : `line ${hit + 1}: ${lines[hit].match(PATTERN)[0]}`);
}
section('The rule works');
ok('a name is caught', PATTERN.test(`Export for ${BARRED[BARRED.length - 1]}`));
ok('an ordinary word is not', !PATTERN.test('a shortcut to the reel of shortstop fabric'));
done();
