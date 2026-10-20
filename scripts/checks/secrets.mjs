// The pre-commit hook is what stands between a key and the repository. This
// runs a key of every shape the app can be given against the patterns read
// out of the hook itself, so a service added to the app without its key
// shape fails here instead of reaching git in silence.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, ok, section, done } from './lib/check.mjs';
import { CLOUD_IDS } from '../../src/core/providers/catalog.js';

const hook = readFileSync(join(root, '.githooks', 'pre-commit'), 'utf8');
const patterns = [...hook.matchAll(/^check_pattern '([^']+)'/gm)].map((m) => new RegExp(m[1]));
ok('the patterns were read out of the hook', patterns.length >= 10);
const caught = (s) => patterns.some((p) => p.test(s));

// Written in two pieces so this file holds no key-shaped string of its own.
const k = (a, b) => a + b;
const SHAPES = {
  anthropic: k('sk-', 'ant-api03-abc123DEF456ghi789JKL012mno345'),
  openai: k('sk-', 'proj-abc123DEF456ghi789JKL012mno345PQR678stu'),
  gemini: k('AIza', 'SyABC123def456GHI789jkl012MNO345pqr'),
  openrouter: k('sk-', 'or-v1-abc123def456ghi789jkl012mno345pqr678stu901'),
  groq: k('gsk', '_abc123DEF456ghi789JKL012mno345PQR678'),
  deepseek: k('sk-', 'abc123def456ghi789jkl012mno345pqr'),
  mistral: null, // Mistral keys are plain letters and digits with no prefix; nothing can match them by shape.
  xai: k('xai', '-abc123DEF456ghi789JKL012mno345PQR678'),
  moonshot: k('sk-', 'abc123DEF456ghi789JKL012mno345PQR678stu'),
  together: k('tgp', '_v1_abc123DEF456ghi789JKL012mno345'), // older Together keys are plain hex, which nothing can match by shape
  fireworks: k('fw', '_abc123DEF456ghi789JKL012mno345'),
  cerebras: k('csk-', 'abc123def456ghi789jkl012mno345pqr678'),
};

section('Every cloud service in the app has its key shape decided');
for (const id of CLOUD_IDS) ok(`${id} is listed here`, id in SHAPES);

section('Every key with a prefix is caught by the hook');
for (const [id, key] of Object.entries(SHAPES)) {
  if (key === null) continue;
  ok(`a ${id} key`, caught(`const key = "${key}";`));
}

section('Ordinary code is not caught');
for (const s of ['const risk = "sk-low";', 'task-runner-mask', 'export function askJson(system)']) ok(s, !caught(s));
done();
