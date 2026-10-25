// Writing the storyboard: the brief, with the person's own media listed (and
// shown to a model that can see), their text files, and any notes looked up
// on the web, in; the
// beats out. A small model writes better by choosing than by trying once, so
// in the guided way it can write several and the cleanest is kept.

import { normalizeStoryboard } from '../scene/storyboard.js';
import { lintScene } from '../scene/lint.js';
import { STORYBOARD_SCHEMA, storyboardPrompt } from './prompts.js';
import { draftScore } from './scene-io.js';
import { mediaPromptText } from '../scene/media.js';
import { researchBlock } from '../research/research.js';
import { docsBlock } from './brand.js';

// deps: { askJson, note(id, text), compile(storyboard, opts) -> { scene }, measured(scene) }
export function createStoryWriter({ askJson, note, compile, measured }) {
  async function writeStoryboard(brief, opts, part = null, temperature) {
    // The person's own media is listed for the model, and shown to one that can see.
    const system = storyboardPrompt({ seconds: opts.seconds, narration: opts.narration }) + mediaPromptText(opts.media || []);
    const images = opts.mediaImages?.length ? opts.mediaImages : null;
    let raw = await askJson(system, `Brief:\n${brief}${docsBlock(opts.docs)}${researchBlock(opts.facts)}`, { schema: STORYBOARD_SCHEMA, purpose: 'storyboard', part, temperature, images });
    let { storyboard, notes } = normalizeStoryboard(raw || {});
    if (!storyboard.beats.length) {
      note('story', 'The first answer had no usable beats; asking again.');
      raw = await askJson(system, `Brief:\n${brief}\n\nYour last answer could not be read as a storyboard. Reply with JSON only, exactly like {"title": "...", "beats": [{"kind": "hook", "text": "..."}]}.`, { schema: STORYBOARD_SCHEMA, purpose: 'storyboard', part, temperature });
      ({ storyboard, notes } = normalizeStoryboard(raw || {}));
    }
    if (!storyboard.beats.length) throw new Error('The model did not write a storyboard the app could read. A different model, or a shorter brief, usually helps.');
    for (const n of notes) note('story', n);
    return storyboard;
  }

  // A small model writes better by choosing than by trying once: several
  // storyboards at rising temperatures, each laid out and measured, and the
  // one with the fewest problems nearest the length asked for is kept.
  const DRAFT_HEAT = [0.4, 0.75, 0.95];
  async function bestStoryboard(brief, opts, drafts) {
    if (drafts <= 1) return writeStoryboard(brief, opts);
    let best = null;
    for (let i = 0; i < drafts; i++) {
      let sb;
      try {
        sb = await writeStoryboard(brief, opts, { index: i, of: drafts }, DRAFT_HEAT[i % DRAFT_HEAT.length]);
      } catch (err) {
        if (err?.stopped || (i === drafts - 1 && !best)) throw err;
        note('story', `Storyboard ${i + 1} could not be read and was set aside.`);
        continue;
      }
      const { scene } = compile(sb, opts);
      const score = draftScore(scene, lintScene(scene, { ...(await measured(scene)), targetDuration: opts.seconds }), opts.seconds);
      if (!best || score < best.score) best = { sb, score, i };
    }
    note('story', `Wrote ${drafts} storyboards and kept the cleanest, storyboard ${best.i + 1}.`);
    return best.sb;
  }

  return { writeStoryboard, bestStoryboard };
}
