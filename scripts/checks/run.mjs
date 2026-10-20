// Runs every check in this folder, each in its own process, and prints one
// total. Checks are found, not listed: a check added to the folder gates the
// next run from the moment it exists, and nothing has to remember to name it.

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { root } from './lib/check.mjs';

const dir = join(root, 'scripts', 'checks');
const only = process.argv[2];
const files = readdirSync(dir).filter((f) => f.endsWith('.mjs') && f !== 'run.mjs' && (!only || f.includes(only))).sort();
let pass = 0, fail = 0;
const failed = [];
for (const f of files) {
  const r = spawnSync(process.execPath, [join(dir, f)], { encoding: 'utf8', cwd: root, timeout: 120000 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const m = out.match(/(\d+) passed, (\d+) failed\s*$/);
  const p = m ? Number(m[1]) : 0;
  const q = m ? Number(m[2]) : 1;
  pass += p; fail += q;
  const bad = q > 0 || r.status !== 0 || !m;
  if (bad) {
    failed.push(f);
    console.log(`\n=== ${f}\n${out.trim()}`);
    // Check logs need repository admin to read; annotations are visible to
    // anyone who can see the run, so failures are said there too.
    if (process.env.GITHUB_ACTIONS) for (const line of out.split('\n').filter((l) => l.includes('FAIL')).slice(0, 10)) console.log(`::error title=${f}::${line.trim()}`);
  }
  console.log(`${bad ? 'FAIL' : 'ok  '}  ${f.padEnd(28)} ${p} passed, ${q} failed${!m ? ' (no summary: it stopped early)' : ''}`);
}
console.log(`\nnpm run check: ${pass.toLocaleString('en-US')} passed, ${fail.toLocaleString('en-US')} failed, from ${files.length} check scripts`);
if (failed.length) console.log(`Failing: ${failed.join(', ')}`);
process.exitCode = fail || failed.length ? 1 : 0;
