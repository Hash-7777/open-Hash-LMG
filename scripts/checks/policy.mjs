// The desktop app's walls, held to what the code actually does:
//   - the content policy lets the page reach every cloud service the app
//     offers, loopback for local ones, and nothing else;
//   - script and style rules stay strict, and the page carries no inline
//     script, style block or style attribute for the policy to relax for;
//   - every command the page calls exists on the Rust side with the same
//     argument names, and the Rust side registers nothing the page never calls;
//   - the window's permissions are only the ones the page uses.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { root, ok, section, done } from './lib/check.mjs';
import { PROVIDERS, CLOUD_IDS } from '../../src/core/providers/catalog.js';
import { VOICE_ENGINES_INFO } from '../../src/core/providers/speech.js';

const conf = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const csp = conf.app.security.csp;
const directive = (name) => (csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) || '').split(/\s+/).slice(1);

section('The content policy');
const connect = directive('connect-src');
const cloud = new Set([...CLOUD_IDS.map((id) => new URL(PROVIDERS[id].base).origin), new URL(VOICE_ENGINES_INFO.openai.base).origin]);
for (const o of cloud) ok(`connect-src lets the page reach ${o}`, connect.includes(o));
const allowedExtra = new Set(["'self'", 'ipc:', 'http://ipc.localhost', 'http://127.0.0.1:*', 'http://localhost:*']);
for (const c of connect) ok(`connect-src names nothing the app does not call: ${c}`, cloud.has(c) || allowedExtra.has(c));
ok('local services are reachable on any loopback port', connect.includes('http://127.0.0.1:*') && connect.includes('http://localhost:*'));
const script = directive('script-src');
ok("script-src has no 'unsafe-eval' or 'unsafe-inline'", !script.includes("'unsafe-eval'") && !script.includes("'unsafe-inline'"));
ok('script-src allows blob: only for model-written drawing code loaded in the locked worker', script.includes('blob:'));
ok('worker-src allows the render worker and nothing remote', JSON.stringify(directive('worker-src')) === JSON.stringify(["'self'", 'blob:']));
for (const d of ['object-src', 'frame-src']) ok(`${d} is 'none'`, JSON.stringify(directive(d)) === JSON.stringify(["'none'"]));
ok("base-uri and form-action are 'none'", directive('base-uri')[0] === "'none'" && directive('form-action')[0] === "'none'");
const css = readdirSync(join(root, 'src', 'css')).map((f) => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
ok('img-src allows data: because a stylesheet draws with a data: picture', !css.includes('url("data:') || directive('img-src').includes('data:'));

section('Nothing inline for the policy to relax for');
const html = readFileSync(join(root, 'src', 'index.html'), 'utf8');
ok('index.html has no inline script', !/<script(?![^>]*\bsrc=)[^>]*>/.test(html));
ok('index.html has no style block', !/<style\b/.test(html));
ok('index.html has no style attribute', !/\sstyle=/.test(html));
const appDir = join(root, 'src', 'app');
for (const f of readdirSync(appDir)) {
  const s = readFileSync(join(appDir, f), 'utf8');
  ok(`${f} writes no style attribute into markup`, !/style=["'`]/.test(s));
  ok(`${f} never evaluates text as code`, !/\beval\(|new Function\(/.test(s));
}

section('The bridge between the page and the Rust side');
const platform = readFileSync(join(root, 'src', 'platform', 'index.js'), 'utf8');
const calls = new Map();
for (const m of platform.matchAll(/invoke\('([a-z_:|]+)'(?:,\s*(\{[^}]*\}|[A-Za-z_.()\s,]+?))?[,)]/g)) {
  if (m[1].startsWith('plugin:')) continue;
  const args = m[2] && m[2].trim().startsWith('{') ? m[2].slice(1, -1).split(',').map((x) => x.split(':')[0].trim()).filter(Boolean) : null;
  if (!calls.has(m[1]) || args) calls.set(m[1], args);
}
const lib = readFileSync(join(root, 'src-tauri', 'src', 'lib.rs'), 'utf8');
const handler = (lib.match(/generate_handler!\[([\s\S]*?)\]/) || [, ''])[1];
const registered = [...handler.matchAll(/commands::\w+::(\w+)/g)].map((m) => m[1]);
const rust = readdirSync(join(root, 'src-tauri', 'src', 'commands')).map((f) => readFileSync(join(root, 'src-tauri', 'src', 'commands', f), 'utf8')).join('\n');
const params = (name) => {
  const m = rust.match(new RegExp(`pub (?:async )?fn ${name}\\s*\\(([^)]*)\\)`));
  if (!m) return null;
  return m[1].replace(/<[^>]*>/g, '<>').split(',').map((p) => p.trim()).filter(Boolean).filter((p) => !/:\s*(AppHandle|State<|Request<)/.test(p)).map((p) => p.split(':')[0].trim());
};
for (const [cmd, args] of calls) {
  ok(`the page's ${cmd} is registered`, registered.includes(cmd));
  const want = params(cmd);
  if (want && args) ok(`${cmd} takes the arguments the page sends (${want.join(', ') || 'raw bytes'})`, JSON.stringify([...args].sort()) === JSON.stringify([...want].sort()), `page sends ${args.join(', ')}`);
}
for (const cmd of registered) ok(`Rust registers ${cmd} because the page calls it`, calls.has(cmd));

section('The window is given only the permissions the page uses');
const caps = JSON.parse(readFileSync(join(root, 'src-tauri', 'capabilities', 'default.json'), 'utf8'));
const allowed = new Set(['core:default', 'core:window:allow-start-dragging', 'opener:allow-open-url', 'opener:allow-default-urls']);
for (const p of caps.permissions) ok(`permission ${p} is accounted for`, allowed.has(p));
ok('the page opens links through the opener', platform.includes("'plugin:opener|open_url'"));
const mainJs = readFileSync(join(root, 'src', 'app', 'main.js'), 'utf8');
ok('the top bar can drag the window', mainJs.includes("'data-tauri-drag-region': true"));

section('The identifier keys every person’s saved films and keys');
ok('identifier is com.hashlmg.app', conf.identifier === 'com.hashlmg.app');
done();
