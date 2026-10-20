// No picture typed as text, anywhere the project ships: the app, its code,
// the prompts it sends, the docs, the hooks, the workflows. Where a mark is
// needed it is drawn as an SVG on currentColor; where none is, a word.
// The commit-msg hook applies the same rule to commit messages.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { root, ok, section, done } from './lib/check.mjs';

// Plain typographic marks a line of text may use.
const MARKS = '✓✔✗✘✕✖✦✧★☆❯❮·•—–…';
const PICTURE = new RegExp(`(?![${MARKS}])[\\u{1F000}-\\u{1FAFF}\\u{1F1E6}-\\u{1F1FF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}\\u{FE0F}]`, 'u');
const TEXT = /\.(m?js|css|html|md|json|rs|toml|sh|yml|yaml|svg|txt)$/;

const walk = (d) => (existsSync(d) ? readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  if (/^(node_modules|target|gen|\.git)$/.test(f)) return [];
  return statSync(p).isDirectory() ? walk(p) : [p];
}) : []);

const files = [
  ...walk(join(root, 'src')), ...walk(join(root, 'scripts')), ...walk(join(root, 'docs')),
  ...walk(join(root, 'src-tauri', 'src')), ...walk(join(root, 'src-tauri', 'capabilities')), ...walk(join(root, '.github')), ...walk(join(root, '.githooks')),
  ...['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'package.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml'].map((f) => join(root, f)).filter(existsSync),
].filter((f) => TEXT.test(f) || f.includes('.githooks') ).filter((f) => !f.endsWith('.local.md'));

section('No emoji in any shipped text file');
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  const hit = lines.findIndex((l) => PICTURE.test(l));
  ok(relative(root, f), hit < 0, hit < 0 ? '' : `line ${hit + 1}`);
}
section('The rule itself works');
ok('a pictograph is caught', PICTURE.test('done \u{1F680}'));
ok('a typographic tick is allowed', !PICTURE.test('done ✓'));
done();
