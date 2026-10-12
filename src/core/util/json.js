// Getting JSON and code out of what a model wrote.
//
// Models wrap answers in prose, in code fences, in a "thinking" preamble; small
// ones leave trailing commas, single quotes or comments, or stop mid-object
// when they run out of room. extractJson finds the largest balanced object or
// array, repairs the common slips, and closes what was left open. It never
// evaluates anything.

function stripThinking(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/^[\s\S]*?<\/think>/i, (m) => (m.includes('<think>') ? m : ''));
}

// Candidate JSON texts, best first: fenced json blocks, then balanced spans.
function candidates(text) {
  const out = [];
  const fence = /```(?:json|JSON)?\s*\n?([\s\S]*?)```/g;
  let m;
  while ((m = fence.exec(text))) if (/[[{]/.test(m[1])) out.push(m[1]);
  // Balanced spans from each opening brace, longest first.
  const spans = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c !== '{' && c !== '[') continue;
    let depth = 0, inStr = false, q = '', esc = false, end = -1;
    for (let j = i; j < text.length; j++) {
      const d = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (d === '\\') esc = true;
        else if (d === q) inStr = false;
        continue;
      }
      if (d === '"' || d === "'") { inStr = true; q = d; continue; }
      if (d === '{' || d === '[') depth++;
      else if (d === '}' || d === ']') { depth--; if (depth === 0) { end = j; break; } }
    }
    spans.push(end > 0 ? text.slice(i, end + 1) : text.slice(i));
    if (end > 0) i = end;
  }
  spans.sort((a, b) => b.length - a.length);
  return [...out, ...spans];
}

// Repairs the slips small models make. Each step is safe on valid JSON.
export function repairJson(s) {
  let t = s.trim();
  // Comments outside strings.
  t = t.replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, str) => str || '');
  // Smart quotes used as delimiters.
  t = t.replace(/[“”]/g, '"');
  // Single-quoted strings to double-quoted.
  t = t.replace(/'([^'\\\n]*(?:\\.[^'\\\n]*)*)'(?=\s*[:,}\]])/g, (m, body) => JSON.stringify(body.replace(/\\'/g, "'")));
  // Unquoted keys.
  t = t.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/g, '$1"$2"$3');
  // Trailing commas.
  t = t.replace(/,(\s*[}\]])/g, '$1');
  // Bare NaN, Infinity, undefined.
  t = t.replace(/:\s*(NaN|Infinity|-Infinity|undefined)\b/g, ': null');
  return t;
}

// Closes strings, arrays and objects a truncated answer left open.
export function closeJson(s) {
  const stack = [];
  let inStr = false, esc = false;
  for (const c of s) {
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') stack.pop();
  }
  let t = s;
  if (inStr) t += '"';
  // A dangling key or comma at the cut is removed before closing.
  t = t.replace(/,\s*$/, '').replace(/,\s*"[^"]*"\s*:?\s*$/, '').replace(/:\s*$/, ': null');
  while (stack.length) t += stack.pop() === '{' ? '}' : ']';
  return t;
}

export function extractJson(text) {
  const src = stripThinking(text);
  for (const c of candidates(src)) {
    for (const attempt of [c, repairJson(c), closeJson(repairJson(c))]) {
      try {
        const v = JSON.parse(attempt);
        if (v && typeof v === 'object') return { value: v, repaired: attempt !== c };
      } catch { /* next */ }
    }
  }
  return { value: null, repaired: false };
}

// The code a model wrote: the largest fenced block, preferring JavaScript.
export function extractCode(text) {
  const src = stripThinking(text);
  const blocks = [];
  const fence = /```([a-zA-Z]*)\s*\n([\s\S]*?)```/g;
  let m;
  while ((m = fence.exec(src))) blocks.push({ lang: m[1].toLowerCase(), body: m[2] });
  const js = blocks.filter((b) => ['js', 'javascript', 'mjs', ''].includes(b.lang));
  const pick = (js.length ? js : blocks).sort((a, b) => b.body.length - a.body.length)[0];
  if (pick) return pick.body.trim();
  // An unclosed fence: everything after it.
  const open = src.match(/```(?:js|javascript)?\s*\n([\s\S]*)$/);
  if (open) return open[1].trim();
  return /function\s+render|export\s+default/.test(src) ? src.trim() : '';
}
