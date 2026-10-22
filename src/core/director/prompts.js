// What the director tells each model.
//
// The knowledge here is the point of the app: how motion designers plan,
// time and judge a film, distilled from docs/MOTION-RULES.md into instructions
// a model can follow. Three sizes of the same knowledge:
//   - the storyboard prompt is short, because small local models have small
//     windows and follow short instructions best;
//   - the plan prompt carries the scene format and one worked example;
//   - the code prompt carries the drawing kit's reference and the rules a
//     frame function must keep.
// Everything a prompt says must be true of the code it describes: the format
// names come from format.js, so a renamed preset cannot leave a prompt behind.

import { IN_PRESETS, OUT_PRESETS, HOLD_PRESETS, TRANSITIONS, STYLE_PACKS, SHAPES, FONT_NAMES, ASPECTS } from '../scene/format.js';
import { BEAT_KINDS } from '../scene/storyboard.js';
import { EXAMPLE_LAUNCH } from '../scene/examples.js';

// The craft, in the words every prompt shares.
export const CRAFT = [
  'One clear message per film; every scene serves it.',
  'Open on the most striking moment: the first frame is already moving, never a black frame or a logo sting.',
  'At most seven words on screen at once; one idea per scene.',
  'Hold each line long enough to read twice: about 0.8 s plus 2.5 words a second.',
  'Something new starts moving every two to four seconds; let important moments breathe.',
  'One cue at a time: a punch-in, an accent colour or a callout, never all three.',
  'Restraint reads as premium: ease out, no bounce, no shake, no spin, no pulsing to the beat, no glow, no lens flares.',
  'Two or three transition families, used consistently.',
  'Big confident type, one family, generous space around it; the accent colour on one or two words only.',
  'Names, numbers and claims only as the brief gives them; never invent a fact about a real company or person.',
];

const craftList = () => CRAFT.map((c) => `- ${c}`).join('\n');

// How the most directed model-made films move (docs/MOTION-RULES.md), for the
// models that design the motion themselves.
export const MOTION = [
  'Frame one is a finished picture, never a word half way through flying in.',
  'One main movement leads; smaller ones overlap under it, so the frame never stops and starts all at once.',
  'The speed always changes: things land slowly enough to read, leave fast, and the next thing slows as it arrives.',
  'The element in front becomes the transition: it moves toward the camera or across the frame while the next scene already waits underneath.',
  'One object carries the story across scenes and keeps its identity: a line that becomes a chart axis, a ring that becomes a frame, a word that moves into the next layout.',
  'Vary the scale and the composition: close, wide, full-frame type, small precise labels, left-set, centred, split. Never the same composition twice in a row.',
  'About twelve to fifteen compositions in thirty seconds, each held one and a half to three and a half seconds.',
  'Build with geometry: hairlines that draw on, rings and arcs, grids and dot fields that fill in by a rule, masks that reveal type, numbers that count.',
  'It makes sense with the sound off.',
];
export const BANNED = 'a crossfade between every scene, blur-ins, particle bursts, glows and lens flares, camera shake, colour-split glitches, bouncy easing, a hold over a second with nothing moving, a camera move that reverses, zooming in and straight back out, gradients as decoration, and anything that looks like a template';
const motionList = () => MOTION.map((c) => `- ${c}`).join('\n');

// ---- storyboard (every model, and the only step small models do) ----------

export const STORYBOARD_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    beats: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: BEAT_KINDS },
          text: { type: 'string' },
          sub: { type: 'string' },
          accent: { type: 'string' },
          items: { type: 'array', items: { type: 'string' } },
          value: { type: 'number' },
          prefix: { type: 'string' },
          suffix: { type: 'string' },
          values: { type: 'array', items: { type: 'number' } },
          labels: { type: 'array', items: { type: 'string' } },
          words: { type: 'array', items: { type: 'string' } },
          by: { type: 'string' },
          left: { type: 'object', properties: { label: { type: 'string' }, text: { type: 'string' } } },
          right: { type: 'object', properties: { label: { type: 'string' }, text: { type: 'string' } } },
          say: { type: 'string' },
        },
        required: ['kind'],
      },
    },
    look: { type: 'object', properties: { mood: { type: 'string' }, accent: { type: 'string' }, tempo: { type: 'string' } } },
  },
  required: ['title', 'beats'],
};

export function storyboardPrompt({ seconds, narration }) {
  const beats = Math.max(3, Math.min(14, Math.round(seconds / 3.2)));
  return `You are a motion designer writing the storyboard for a short animated film.
Write ONLY the words and numbers of each beat. Layout, timing, colour and motion are done for you.

Beat kinds:
- hook: the opening line, a promise or question, up to 6 words
- statement: one short line, up to 7 words; "sub" is an optional second line
- title: a product or topic name in "text", a short tagline in "sub"
- stat: one number in "value" with "prefix"/"suffix" (like "%", " hours"), what it means in "sub"
- list: up to 4 short "items", optional heading in "text"
- steps: 2 to 4 short "items" in order
- chart: "values" (numbers) with "labels", heading in "text"
- quote: "text" and who said it in "by"
- compare: "left" and "right", each {"label","text"}
- words: 2 to 6 single words in "words", shown one per beat for punch
- logo: the brand name in "text", tagline in "sub"
- end: the name in "text", a web address or call to action in "sub"
Put one accent word in "accent" when a word deserves the accent colour.
Add "look": {"mood": one of calm, bold, playful, technical, luxury, warm, serious, energetic; "accent": a hex colour that suits the subject; "tempo": slow, medium or fast}.${narration ? '\nGive every beat a "say": one short spoken sentence of narration, at most 14 words, in plain speech.' : ''}

Craft:
${craftList()}

The film should run about ${Math.round(seconds)} seconds: about ${beats} beats. Start with a hook. End with an end beat.
Reply with JSON only, no other text:
{"title": "...", "look": {"mood": "...", "accent": "#...", "tempo": "..."}, "beats": [{"kind": "hook", "text": "..."}, ...]}`;
}

// ---- full scene plan (mid-size models) -------------------------------------

function exampleJson() {
  // The example, trimmed to three scenes so it teaches the shape without
  // filling a small window.
  const ex = { ...EXAMPLE_LAUNCH, scenes: EXAMPLE_LAUNCH.scenes.slice(0, 3) };
  return JSON.stringify(ex);
}

export function planFormatReference() {
  return `Scene format, lmg.scene/1 (JSON):
{
 "title": string, "style": one of ${Object.keys(STYLE_PACKS).join(', ')},
 "aspect": one of ${Object.keys(ASPECTS).join(', ')}, "fps": 60, "bpm": 120,
 "palette": {"bg","surface","ink","muted","accent","accent2"} as CSS colours (optional; the style has one),
 "scenes": [ {
   "id": string, "name": the beat kind, "duration": seconds,
   "transition": {"kind": one of ${TRANSITIONS.join(', ')}, "duration": 0.3 to 0.6, "direction": left|right|up|down,
                  "carry": {"from": a layer id in the scene before, "to": a layer id in this scene} only with kind carry, which moves that one element into place while the rest crossfades},
   "camera": {"zoom": [from, to]} (a slow push such as [1, 1.04] keeps a scene alive),
   "background": optional colour or palette name,
   "layers": [ {
     "type": text | shape | counter | bars | line-chart | image | group,
     "x", "y": position as a FRACTION of the frame (0.5, 0.5 is the centre),
     "anchor": center | left | right | top | bottom,
     "at": seconds after the scene starts that the layer enters, "until": when it leaves (default: scene end),
     "in": {"preset": ${IN_PRESETS.join(' | ')}, "duration": seconds, "ease": outExpo | outQuint | inOutCubic | ..., "stagger": seconds between letters or words},
     "out": {"preset": ${OUT_PRESETS.join(' | ')}, "duration": seconds},
     "hold": ${HOLD_PRESETS.join(' | ')},
     "color": a palette name (ink, muted, accent ...) or a CSS colour,
     "opacity", "scale", "rotate" (degrees),
     "keys": {"x": [[t, value, ease], ...], "y": ..., "scale": ..., "opacity": ..., "rotate": ...} for custom moves (t in scene seconds)
     "repeat": {"count": 2 to 200, "layout": row | column | grid | circle, "cols" (grid), "gap" (pixels between copies), "radius" (circle), "stagger": seconds between copies} draws the layer many times by a rule
     text:    "text", "size" (pixels on a 1080-high frame: 96 to 160 for headlines, 40 to 56 for lines, never under 28),
              "weight" (100 to 900), "font" (${FONT_NAMES.join(', ')}), "align", "tracking" (em), "maxWidth" (fraction),
              "highlight": [words in the accent colour], "upper": true for small caps labels
     shape:   "shape": ${SHAPES.join(' | ')}, "w", "h" (pixels on a 1080 frame), "radius", "fill", "stroke", "strokeWidth",
              "d" (SVG path, for path), "arc": [from, to] turns (ring), "sides" (polygon)
     counter: "from", "to", "decimals", "prefix", "suffix", "size", "count" (seconds to count)
     bars / line-chart: "values", "labels", "w", "h", "suffix", "area" (line-chart)
     group:   "layers": [...] moved together
   } ]
 } ],
 "sound": {"score": pulse | soft | cinematic | none, "hits": [{"t": seconds, "kind": boom | hit | swell | chime}]}
}
Scene start times are worked out from durations and transitions: do not write them.`;
}

export function planPrompt({ seconds, aspect, style }) {
  return `You are a senior motion designer. You design animated films as a JSON scene plan that an engine renders frame by frame.

Craft:
${craftList()}
- Letters or words entrances for headlines; mask-up or rise for lines; draw for strokes; grow for charts.
- Ease out (outExpo, outQuint) for things arriving; inCubic for things leaving; inOutCubic for things moving within the frame.
- Stagger related items by 0.1 to 0.3 s; never more than a third of the frame moving at once.
- A 0.3 to 0.6 s stillness before a big reveal makes it land.

Motion:
${motionList()}
Never: ${BANNED}.
- Vertical (9:16) frames: keep words between y 0.14 and 0.76 and x 0.06 to 0.86; phone apps cover the rest.

${planFormatReference()}

Example of a good plan (shortened):
${exampleJson()}

The film: about ${Math.round(seconds)} seconds, aspect ${aspect}, style ${style}.
Reply with the complete scene plan as JSON only.`;
}

// Every plan a model rewrites is told the drawings stay.
const DRAWINGS = 'Layers with an id starting "picture" are drawings of what the film is about: keep every one in its scene. You may move one, change when it arrives or set its opacity; its path data shows as "kept:" and stays as it is.';

export function planFromDraftMessage(brief, storyboard, draft) {
  return `Brief:\n${brief}\n\nStoryboard agreed:\n${JSON.stringify(storyboard)}\n\nA draft plan made from it by rule:\n${JSON.stringify(draft)}\n\nImprove the draft into a finished design for this brief alone: stronger composition and hierarchy, varied scale and placement from scene to scene, motion designed for each beat (custom keys, hairlines and rings that draw on, a repeat field that fills in, a counter, a chart), one element carried between scenes where it helps, and moments of stillness before reveals. Keep the words, the timing grid, the style and the palette. ${DRAWINGS} Reply with the complete scene plan as JSON only.`;
}

// ---- free drawing code (strong models) -------------------------------------

export const KIT_REFERENCE = `The drawing kit, passed to your function as lmg:
Frame:   lmg.W, lmg.H (pixels), lmg.u (one unit = a pixel on a 1080 short side; size things as n * lmg.u),
         lmg.fps, lmg.duration (seconds), lmg.bpm, lmg.beat(n) (time of beat n), lmg.palette (bg, surface, ink, muted, accent, accent2)
Time:    lmg.ease.outExpo(x) and the rest (in/out/inOut of Quad, Cubic, Quart, Quint, Sine, Expo, Circ),
         lmg.progress(t, start, duration, easeName) -> 0..1 eased,
         lmg.tween(t, t0, t1, from, to, easeName), lmg.keys(t, [[time, value, easeName], ...]) (numbers, arrays or colours),
         lmg.spring(t, t0, {freq, ratio}), lmg.clamp, lmg.mix, lmg.smoothstep, lmg.noise(x, seed), lmg.noise2(x, y, seed),
         lmg.rand(seed) -> a seeded generator function
Colour:  lmg.color('accent') -> CSS colour from the palette, lmg.withAlpha(c, a), lmg.linear(x0,y0,x1,y1,[[0,c],[1,c]]), lmg.radial(x,y,r,stops)
Draw:    lmg.clear(color)
         lmg.text(str, x, y, {size, weight, font: sans|display|condensed|serif|mono|rounded, color, align: left|center|right,
                  baseline: middle|top|bottom, tracking (em), leading, maxWidth (px), upper, highlight: [words], highlightColor,
                  reveal: {mode: letters|words|type|mask-up|mask-down|wipe, time (s since the reveal began), duration, stagger, ease, distance, exit},
                  hold: {mode: underline|marker|shimmer, p (0..1)}, opacity}) -> {x, y, w, h}
         lmg.measureText(str, options) -> {width, height, lines}
         lmg.rect(x, y, w, h, {fill, stroke, width, radius, opacity}), lmg.circle(x, y, r, opts), lmg.ellipse(x, y, rx, ry, opts)
         lmg.line(x1, y1, x2, y2, {color, width, progress (0..1 draws it on), cap}), lmg.arrow(x1, y1, x2, y2, opts)
         lmg.ring(x, y, r, {color, width, from, to (turns), progress}), lmg.polygon([[x, y], ...], {fill, stroke, width, progress, closed})
         lmg.path(svgPathData, {x, y, scale, center, fill, stroke, width, progress}), lmg.image(assetId, x, y, w, h, {fit, radius})
         lmg.bars(values, x, y, w, h, {progress, labels, color, suffix}), lmg.lineChart(values, x, y, w, h, {progress, color, area})
         lmg.grain(t, amount), lmg.vignette(strength), lmg.formatNumber(v, decimals)
Layers:  lmg.push({x, y, scale, rotate (degrees), opacity}) ... lmg.pop(), lmg.clip(x, y, w, h, () => {...}), lmg.alpha(a, () => {...})
Raw:     lmg.ctx is the 2D canvas context, for anything the kit does not cover.`;

export const CODE_EXAMPLE = `export default function render(t, lmg) {
  const { W, H, u } = lmg;
  lmg.clear('bg');
  // Scene 1, 0 to 3 s: the hook, letters rising, a slow push.
  if (t < 3.2) {
    const push = 1 + 0.04 * lmg.progress(t, 0, 3.2, 'inOutSine');
    const out = 1 - lmg.progress(t, 2.8, 0.4, 'inCubic');
    lmg.push({ x: W / 2, y: H / 2, scale: push, opacity: out });
    lmg.text('Plans change.', 0, 0, { size: 120 * u, weight: 700, color: 'ink',
      reveal: { mode: 'letters', time: t, duration: 0.7, stagger: 0.03, ease: 'outExpo' } });
    lmg.pop();
  }
  // Scene 2, 3 to 6 s: a ring draws on, the name arrives inside it.
  if (t >= 3) {
    const s = t - 3;
    lmg.ring(W / 2, H * 0.42, 90 * u, { color: 'accent', width: 10 * u, progress: lmg.progress(s, 0, 1, 'inOutCubic') });
    lmg.text('Northwind', W / 2, H * 0.66, { size: 132 * u, weight: 800, color: 'ink',
      opacity: lmg.progress(s, 0.3, 0.8, 'outExpo'), hold: { mode: 'shimmer', p: (s - 1.2) / 2.6 } });
  }
  lmg.grain(t, 0.04);
}`;

export function codePrompt({ seconds, aspect, timing }) {
  return `You are a senior motion designer who animates in code. Write one JavaScript function that draws any frame of the film from its time alone.

Rules the engine enforces:
- export default function render(t, lmg) { ... } draws the frame at t seconds. It is called for every frame, in any order.
- Every visual is a pure function of t: no timers, no clock, no Math.random (use lmg.rand(seed)), no state kept between calls.
- No imports, no network, no page access, no storage: only lmg and plain JavaScript.
- Draw the whole frame each call, starting with lmg.clear().

Craft:
${craftList()}
- Ease out (outExpo, outQuint) for arrivals; inCubic for exits; inOutCubic for camera moves and moves within the frame.
- Build scenes as time windows that overlap by their transition, and move the outgoing and incoming scenes together (push, zoom-through, mask wipe).
- Use lmg.u for every size so the film is right at every resolution.

Motion, as the best directed films move:
${motionList()}
Never: ${BANNED}.
Design it as an expert motion designer would for this brief alone: its own compositions, its own geometry, its own way of moving between scenes. Use the direction and palette you are given.${aspect === '9:16' ? '\n- Vertical frame: keep words between 14% and 76% of the height and out of the right 13%; phone apps cover the rest.' : ''}

${KIT_REFERENCE}

Example:
\`\`\`js
${CODE_EXAMPLE}
\`\`\`

The film: ${Math.round(seconds)} seconds, aspect ${aspect}. Follow this timing so the music lands on the cuts:
${timing}
Reply with the complete code in one \`\`\`js block.`;
}

// ---- review and revision ----------------------------------------------------

export function issuesText(issues) {
  return issues.map((i, k) => `${k + 1}. [${i.level}] ${i.message}${i.layer ? ` (layer ${i.layer})` : ''}${i.scene ? ` (scene ${i.scene})` : ''}`).join('\n');
}

export function revisePlanMessage(issues) {
  return `The checks found these problems in your plan:\n${issuesText(issues)}\n\nFix every one and keep the drawings. ${DRAWINGS} Reply with the complete corrected scene plan as JSON only.`;
}

export function reviseCodeMessage(problems) {
  return `Your code could not be used yet:\n${problems.map((p, k) => `${k + 1}. ${p}`).join('\n')}\n\nFix every one and reply with the complete corrected code in one \`\`\`js block.`;
}

export const CRITIC_PROMPT = `You are a creative director reviewing stills from an animated film, laid out left to right, top to bottom, each labelled with its time.
Judge it as a premium motion piece: hierarchy and readability, spacing and alignment, contrast, whether anything is cut off or crowded, whether the accent is used sparingly, whether it looks designed rather than generated.
Reply with JSON only: {"verdict": "ship" | "revise", "notes": ["one concrete change per note, naming the time or the words it concerns", ...]}
Give at most five notes, most important first. If it is ready, say "ship" with no notes.`;

export function criticMessage(brief, times) {
  return `The brief was:\n${brief}\n\nStills at ${times.map((t) => `${t.toFixed(1)} s`).join(', ')}.`;
}

export function applyCritiqueMessage(notes, tier) {
  const what = tier === 'code' ? 'the complete corrected code in one ```js block' : `the complete corrected scene plan as JSON only. ${DRAWINGS}`;
  return `A creative director reviewed stills of your film and asks for these changes:\n${notes.map((n, k) => `${k + 1}. ${n}`).join('\n')}\n\nMake them and reply with ${what}.`;
}

// ---- edits after the film exists -------------------------------------------

export function editMessage(tier, instruction, current) {
  if (tier === 'guided') {
    return `Current storyboard:\n${JSON.stringify(current)}\n\nChange it as asked: ${instruction}\n\nReply with the complete updated storyboard as JSON only.`;
  }
  if (tier === 'code') {
    return `Current code:\n\`\`\`js\n${current}\n\`\`\`\n\nChange it as asked: ${instruction}\n\nReply with the complete updated code in one \`\`\`js block.`;
  }
  return `Current scene plan:\n${JSON.stringify(current)}\n\nChange it as asked: ${instruction}\n\n${DRAWINGS} Reply with the complete updated scene plan as JSON only.`;
}
