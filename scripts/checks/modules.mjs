// Every module the app loads parses, and every import it makes points at a
// file that exists and a name that file exports.
//
// src/ is served as it is, without a bundler, so nothing else would catch a
// typo in an import: the browser stops loading that module, and every panel
// that depends on it silently never appears.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, relative, resolve } from 'node:path';
import { root, ok, section, done } from './lib/check.mjs';

const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const files = [...walk(join(root, 'src')), ...walk(join(root, 'scripts'))].filter((f) => /\.(m?js)$/.test(f));

section('Every script parses');
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  ok(relative(root, f), r.status === 0, (r.stderr || '').split('\n').find((l) => /Error/.test(l)));
}

// Names a module exports, read from its text.
const exportsCache = new Map();
function exportsOf(file) {
  if (exportsCache.has(file)) return exportsCache.get(file);
  const s = readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of s.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of s.matchAll(/^export\s*\{([^}]+)\}/gm)) for (const part of m[1].split(',')) { const n = part.trim().split(/\s+as\s+/).pop(); if (n) names.add(n); }
  if (/^export\s+default\b/m.test(s)) names.add('default');
  exportsCache.set(file, names);
  return names;
}

section('Every import resolves to a file and to names that file exports');
const appFiles = files.filter((f) => f.startsWith(join(root, 'src')));
for (const f of appFiles) {
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(/^import\s+(?:(\{[^}]*\})|([A-Za-z_$][\w$]*))\s+from\s+'([^']+)'/gm)) {
    const spec = m[3];
    if (!spec.startsWith('.')) { ok(`${relative(root, f)} imports only files of its own (${spec})`, false); continue; }
    const target = resolve(dirname(f), spec);
    if (!ok(`${relative(root, f)} -> ${spec}`, existsSync(target), 'no such file')) continue;
    const have = exportsOf(target);
    const want = m[1] ? m[1].slice(1, -1).split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean) : ['default'];
    const missing = want.filter((n) => !have.has(n));
    if (missing.length) ok(`${relative(root, f)} -> ${spec} exports ${missing.join(', ')}`, false, 'not exported');
  }
}

section('The page loads its entry and its stylesheets');
const html = readFileSync(join(root, 'src', 'index.html'), 'utf8');
for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) ok(`index.html -> ${m[1]}`, existsSync(join(root, 'src', m[1])));
ok('index.html starts the editor as a module', /<script type="module" src="app\/main\.js"><\/script>/.test(html));

done();
