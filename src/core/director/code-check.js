// Reads model-written drawing code before it runs, and refuses what a drawing
// has no use for.
//
// This is the first of two walls. The second is the worker the code runs in
// (src/render/lockdown.js), which has no network, no storage and no way to
// start anything else, whatever the code says. This check exists so that a
// model is told plainly what to change, instead of its code failing in the
// worker with a message only a programmer could read.

const RULES = [
  { re: /\bimport\s*(\(|[\w{*])/, msg: 'It imports other code. Everything it needs is passed in as lmg.' },
  { re: /\brequire\s*\(/, msg: 'It loads other code with require. Everything it needs is passed in as lmg.' },
  { re: /\b(fetch|XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon)\b/, msg: 'It reaches the network. A frame is drawn from time alone.' },
  { re: /\b(eval|Function)\s*\(/, msg: 'It builds code from text. Write the drawing directly.' },
  { re: /\bnew\s+Function\b/, msg: 'It builds code from text. Write the drawing directly.' },
  { re: /\b(setTimeout|setInterval|requestAnimationFrame|queueMicrotask)\s*\(/, msg: 'It runs on a timer. Draw from t only: every frame is a pure function of time.' },
  { re: /\b(Date\.now|performance\.now|new\s+Date)\b/, msg: 'It reads the clock. Use t, the film time, so every render is identical.' },
  { re: /\bMath\.random\s*\(/, msg: 'It uses Math.random. Use lmg.rand(seed) so every render is identical.' },
  { re: /\b(localStorage|sessionStorage|indexedDB|caches|document\.cookie)\b/, msg: 'It touches storage. A drawing keeps no state between frames.' },
  { re: /\b(postMessage|importScripts|Worker|SharedWorker|BroadcastChannel)\b/, msg: 'It talks to other threads. Only draw.' },
  { re: /\b(document|window)\s*\./, msg: 'It reaches for the page. Draw only through lmg and lmg.ctx.' },
  { re: /\bwhile\s*\(\s*(true|1)\s*\)|\bfor\s*\(\s*;\s*;\s*\)/, msg: 'It has a loop with no end. Every loop needs a fixed bound.' },
];

export const MAX_CODE_CHARS = 60000;

// Returns a list of problems, each a sentence a model can act on. Empty means
// the code may be tried.
export function checkCode(code) {
  const problems = [];
  const src = String(code || '');
  if (!src.trim()) return ['There is no code.'];
  if (src.length > MAX_CODE_CHARS) problems.push(`It is ${src.length} characters long; keep it under ${MAX_CODE_CHARS}.`);
  // Comments and strings may mention these words freely.
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g, '""');
  for (const r of RULES) if (r.re.test(stripped)) problems.push(r.msg);
  if (!/export\s+default\s+function|export\s+default\s+\(|export\s+default\s+render|export\s+function\s+render|function\s+render\s*\(/.test(stripped)) {
    problems.push('It has no render function. Write: export default function render(t, lmg) { ... }');
  }
  return [...new Set(problems)];
}

// Makes the code a module with a default render export, whatever form the
// model chose, so the worker loads it one way.
export function asModule(code) {
  let src = String(code || '').trim();
  if (/export\s+default/.test(src)) return src;
  if (/export\s+function\s+render\s*\(/.test(src)) return src + '\nexport default render;\n';
  if (/function\s+render\s*\(/.test(src)) return src + '\nexport default render;\n';
  return src;
}
