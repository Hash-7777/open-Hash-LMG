// A ratchet on the size of every source file (COMMIT_RULES 12.6). A file
// that grows past its budget is a file doing two jobs; split it. A budget
// may be raised only with a line here saying what earned the room, and is
// lowered whenever a file shrinks well under it.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { root, ok, section, done } from './lib/check.mjs';

const DEFAULT = 400;
const BUDGETS = {
  // The drawing kit is the whole vocabulary of a frame, shared by the plan
  // renderer and model-written code; splitting it would split that contract.
  'src/core/engine/kit.js': 700,
  // The normaliser rebuilds every field of every layer type in one place, so
  // the field guard has one gate to hold.
  'src/core/scene/normalize.js': 560,
};

const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = [...walk(join(root, 'src')), ...walk(join(root, 'scripts')), ...walk(join(root, 'src-tauri', 'src'))].filter((f) => /\.(m?js|css|rs)$/.test(f));

section(`Every source file is within its budget (${DEFAULT} lines unless named)`);
for (const f of files) {
  const rel = relative(root, f);
  const lines = readFileSync(f, 'utf8').split('\n').length;
  const budget = BUDGETS[rel] ?? DEFAULT;
  ok(`${rel}: ${lines} of ${budget}`, lines <= budget, 'split it, or say here what earned the room');
}
section('Every named budget still names a file');
for (const rel of Object.keys(BUDGETS)) ok(rel, files.some((f) => relative(root, f) === rel));
done();
