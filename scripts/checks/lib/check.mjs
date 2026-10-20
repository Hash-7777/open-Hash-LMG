// The few lines every check shares: a pass or a failure per claim, a heading
// per group, and one summary line the runner reads.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

let pass = 0;
let fail = 0;

export function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${label}`); } else { fail++; console.log(`  FAIL  ${label}${detail ? ` (${detail})` : ''}`); }
  return Boolean(cond);
}

export function section(title) { console.log(`\n${title}`); }

// For a check whose body may throw: a throw is one failure, named.
export async function attempt(label, fn) {
  try { await fn(); } catch (err) { ok(label, false, err?.stack?.split('\n').slice(0, 3).join(' | ') || String(err)); }
}

export function done() {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}

// A claim proved by ordinary assertions: it passes if fn returns without
// throwing, and fails with the assertion's own message.
export async function claim(label, fn) {
  try { await fn(); return ok(label, true); } catch (err) { return ok(label, false, String(err?.message || err).split('\n')[0]); }
}
