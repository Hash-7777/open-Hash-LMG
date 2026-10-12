// The director: brief in, film out, the way a motion designer works.
//
//   story    the model writes the storyboard (every tier)
//   design   the storyboard is laid out by rule; a plan-tier model then
//            redesigns that draft, a code-tier model animates it in code
//   check    the film is rendered at its key moments and measured; what rules
//            can repair is repaired, the rest goes back to the model
//   review   a model that can see looks at a contact sheet of stills and asks
//            for changes, once
//
// Pure orchestration: it never touches the page, the network or a canvas
// itself. Everything outside is passed in, so the checks run it end to end
// with a scripted model and the stand-in canvas.
//
//   deps.ask({ system, messages, json, schema, purpose })  -> the model's text
//   deps.measure({ scene, code }, times)                    -> [{ t, boxes }]
//   deps.trial({ scene, code })                             -> { ok, error }
//   deps.sheet({ scene, code }, times)                      -> image data URL or null
//   deps.log({ id, title, status, detail })                 status: run | done | fail | note

import { normalizeStoryboard } from '../scene/storyboard.js';
import { compileStoryboard } from '../scene/compile.js';
import { normalizeScene } from '../scene/normalize.js';
import { lintScene, autofix, sampleTimes } from '../scene/lint.js';
import { extractJson, extractCode } from '../util/json.js';
import { checkCode, asModule } from './code-check.js';
import {
  STORYBOARD_SCHEMA, storyboardPrompt, planPrompt, planFromDraftMessage, codePrompt,
  revisePlanMessage, reviseCodeMessage, CRITIC_PROMPT, criticMessage, applyCritiqueMessage, editMessage,
} from './prompts.js';

// What a model is shown of a scene: everything but the media bytes.
export function sceneForModel(scene) {
  const { assets, ...rest } = scene;
  const listed = Object.fromEntries(Object.entries(assets || {}).filter(([, a]) => a.kind === 'image').map(([id, a]) => [id, { kind: a.kind, name: a.name }]));
  return { ...rest, assets: listed, voice: { ...scene.voice, lines: (scene.voice?.lines || []).map(({ clip, ...l }) => l) } };
}

// Puts back what the model is not shown: media, clips, and the narration the
// film was planned around if a redesign dropped it.
function restore(next, prev) {
  const doc = { ...next, assets: { ...(prev.assets || {}) } };
  const lines = next.voice?.lines?.length ? next.voice.lines : prev.voice?.lines || [];
  const ids = new Set((next.scenes || []).map((S, i) => S.id || `scene-${i + 1}`));
  const prevIds = (prev.scenes || []).map((S) => S.id);
  const nextIds = (next.scenes || []).map((S, i) => S.id || `scene-${i + 1}`);
  doc.voice = {
    ...(prev.voice || {}),
    ...(next.voice || {}),
    engine: prev.voice?.engine ?? next.voice?.engine,
    lines: lines.map((l) => {
      const prevLine = (prev.voice?.lines || []).find((p) => p.scene === l.scene && p.text === l.text);
      // A redesign that renamed scenes keeps each line on the scene in the same place.
      const scene = ids.has(l.scene) ? l.scene : nextIds[prevIds.indexOf(l.scene)] ?? l.scene;
      return { ...l, scene, clip: prevLine?.clip ?? null };
    }),
  };
  return doc;
}

export function createDirector(deps) {
  const log = deps.log || (() => {});
  const step = async (id, title, fn) => {
    log({ id, title, status: 'run' });
    try {
      const out = await fn();
      log({ id, title, status: 'done' });
      return out;
    } catch (err) {
      log({ id, title, status: 'fail', detail: String(err?.message || err) });
      throw err;
    }
  };
  const note = (id, detail) => log({ id, status: 'note', detail });

  async function askJson(system, content, { schema = null, purpose, images = null }) {
    const text = await deps.ask({ system, messages: [{ role: 'user', content, ...(images ? { images } : {}) }], json: true, schema, purpose });
    return extractJson(text).value;
  }

  async function writeStoryboard(brief, opts) {
    const system = storyboardPrompt({ seconds: opts.seconds, narration: opts.narration });
    let raw = await askJson(system, `Brief:\n${brief}`, { schema: STORYBOARD_SCHEMA, purpose: 'storyboard' });
    let { storyboard, notes } = normalizeStoryboard(raw || {});
    if (!storyboard.beats.length) {
      note('story', 'The first answer had no usable beats; asking again.');
      raw = await askJson(system, `Brief:\n${brief}\n\nYour last answer could not be read as a storyboard. Reply with JSON only, exactly like {"title": "...", "beats": [{"kind": "hook", "text": "..."}]}.`, { schema: STORYBOARD_SCHEMA, purpose: 'storyboard' });
      ({ storyboard, notes } = normalizeStoryboard(raw || {}));
    }
    if (!storyboard.beats.length) throw new Error('The model did not write a storyboard the app could read. A different model, or a shorter brief, usually helps.');
    for (const n of notes) note('story', n);
    return storyboard;
  }

  function compile(storyboard, opts) {
    return compileStoryboard(storyboard, {
      style: opts.style, aspect: opts.aspect, fps: opts.fps, targetDuration: opts.seconds,
      narration: opts.narration, voice: opts.voice, assets: opts.assets, palette: opts.palette, score: opts.score,
    });
  }

  // Measures, repairs by rule, and returns what is left.
  async function checkScene(scene, opts) {
    const times = sampleTimes(scene);
    const samples = await deps.measure({ scene }, times);
    let issues = lintScene(scene, { samples, targetDuration: opts.seconds });
    const fixable = issues.filter((i) => i.fix);
    if (fixable.length) {
      const fixed = autofix(scene, fixable);
      scene = fixed.scene;
      for (const a of fixed.applied) note('check', a);
      const samples2 = await deps.measure({ scene }, sampleTimes(scene));
      issues = lintScene(scene, { samples: samples2, targetDuration: opts.seconds });
    }
    return { scene, issues };
  }

  async function designPlan(brief, storyboard, draft, opts) {
    const system = planPrompt({ seconds: opts.seconds, aspect: draft.aspect, style: draft.style });
    const raw = await askJson(system, planFromDraftMessage(brief, storyboard, sceneForModel(draft)), { purpose: 'plan' });
    if (!raw) { note('design', 'The redesign could not be read; the rule-made design is kept.'); return draft; }
    const { scene, notes } = normalizeScene(restore(raw, draft), { style: draft.style, aspect: draft.aspect });
    if (!scene.scenes.length) { note('design', 'The redesign had no scenes; the rule-made design is kept.'); return draft; }
    for (const n of notes.slice(0, 8)) note('design', n);
    return scene;
  }

  async function revisePlan(scene, issues, opts) {
    const system = planPrompt({ seconds: opts.seconds, aspect: scene.aspect, style: scene.style });
    const raw = await askJson(system, `${revisePlanMessage(issues)}\n\nThe plan:\n${JSON.stringify(sceneForModel(scene))}`, { purpose: 'revise' });
    if (!raw) return scene;
    const next = normalizeScene(restore(raw, scene), { style: scene.style, aspect: scene.aspect }).scene;
    return next.scenes.length ? next : scene;
  }

  function timingText(draft) {
    return draft.scenes.map((S) => `${S.start.toFixed(2)} to ${(S.start + S.duration).toFixed(2)} s, ${S.name || S.id}${S.transition.kind !== 'cut' ? ` (enters with ${S.transition.kind}, ${S.transition.duration} s)` : ''}: ${S.note || ''}`).join('\n');
  }

  async function writeCode(brief, storyboard, draft, opts) {
    const system = codePrompt({ seconds: draft.duration, aspect: draft.aspect, timing: timingText(draft) });
    let content = `Brief:\n${brief}\n\nStoryboard:\n${JSON.stringify(storyboard)}\n\nPalette: ${JSON.stringify(draft.palette)}`;
    let code = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      const text = await deps.ask({ system, messages: [{ role: 'user', content }], purpose: attempt ? 'revise code' : 'code' });
      code = asModule(extractCode(text));
      const problems = checkCode(code);
      if (!problems.length) {
        const run = await deps.trial({ scene: draft, code });
        if (run.ok) return code;
        problems.push(`It failed while drawing: ${run.error}`);
      }
      note('design', `The code needs changes: ${problems[0]}`);
      content = `${reviseCodeMessage(problems)}\n\nYour code:\n\`\`\`js\n${code}\n\`\`\``;
    }
    throw new Error('The model could not write drawing code that runs. The scene plan made from its storyboard is kept instead.');
  }

  async function review(target, brief, tier, opts) {
    const times = sampleTimes(target.scene).slice(0, 8);
    const image = await deps.sheet(target, times);
    if (!image) return null;
    const verdict = await askJson(CRITIC_PROMPT, criticMessage(brief, times), { images: [image], purpose: 'review' });
    if (!verdict || verdict.verdict === 'ship' || !Array.isArray(verdict.notes) || !verdict.notes.length) {
      note('review', 'The review found nothing to change.');
      return null;
    }
    const notes = verdict.notes.map(String).slice(0, 5);
    for (const n of notes) note('review', n);
    return notes;
  }

  // opts: { brief, tier, style, aspect, seconds, fps, narration, voice, vision, rounds, assets, palette, score }
  async function make(opts) {
    const brief = String(opts.brief || '').trim();
    if (!brief) throw new Error('Describe the film first.');
    const tier = opts.tier || 'guided';
    const rounds = opts.rounds ?? (tier === 'guided' ? 0 : 2);

    const storyboard = await step('story', 'Writing the storyboard', () => writeStoryboard(brief, opts));
    let { scene } = await step('layout', 'Laying it out and timing it to the music', async () => compile(storyboard, opts));
    let code = null;

    if (tier === 'plan') {
      scene = await step('design', 'Designing every scene', () => designPlan(brief, storyboard, scene, opts));
    } else if (tier === 'code') {
      try {
        code = await step('design', 'Animating it in code', () => writeCode(brief, storyboard, scene, opts));
      } catch (err) {
        note('design', String(err.message || err));
        code = null;
      }
    }

    let issues = [];
    if (!code) {
      ({ scene, issues } = await step('check', 'Checking stills and timing', () => checkScene(scene, opts)));
      for (let r = 0; r < rounds && tier !== 'guided' && issues.some((i) => i.level !== 'info'); r++) {
        scene = await step('revise', 'Fixing what the checks found', () => revisePlan(scene, issues.filter((i) => i.level !== 'info'), opts));
        ({ scene, issues } = await step('check', 'Checking again', () => checkScene(scene, opts)));
      }
    } else {
      issues = await step('check', 'Checking stills', async () => {
        const samples = await deps.measure({ scene, code }, sampleTimes(scene));
        return lintScene({ ...scene, scenes: [] }, { samples }).filter((i) => ['off-frame', 'safe-area', 'overlap'].includes(i.code));
      });
      for (let r = 0; r < Math.min(1, rounds) && issues.some((i) => i.level !== 'info'); r++) {
        code = await step('revise', 'Fixing what the checks found', async () => {
          const text = await deps.ask({ system: codePrompt({ seconds: scene.duration, aspect: scene.aspect, timing: timingText(scene) }), messages: [{ role: 'user', content: `${revisePlanMessage(issues).replace('scene plan as JSON only', 'code in one ```js block')}\n\n\`\`\`js\n${code}\n\`\`\`` }], purpose: 'revise code' });
          const next = asModule(extractCode(text));
          if (checkCode(next).length) return code;
          const run = await deps.trial({ scene, code: next });
          return run.ok ? next : code;
        });
      }
    }

    if (opts.vision && rounds > 0) {
      const notes = await step('review', 'Reviewing stills like a creative director', () => review({ scene, code }, brief, tier, opts));
      if (notes) {
        if (code) {
          code = await step('apply', 'Making the changes', async () => {
            const text = await deps.ask({ system: codePrompt({ seconds: scene.duration, aspect: scene.aspect, timing: timingText(scene) }), messages: [{ role: 'user', content: `${applyCritiqueMessage(notes, 'code')}\n\n\`\`\`js\n${code}\n\`\`\`` }], purpose: 'apply review' });
            const next = asModule(extractCode(text));
            if (checkCode(next).length) return code;
            const run = await deps.trial({ scene, code: next });
            return run.ok ? next : code;
          });
        } else if (tier === 'plan') {
          scene = await step('apply', 'Making the changes', async () => {
            const system = planPrompt({ seconds: opts.seconds, aspect: scene.aspect, style: scene.style });
            const raw = await askJson(system, `${applyCritiqueMessage(notes, 'plan')}\n\nThe plan:\n${JSON.stringify(sceneForModel(scene))}`, { purpose: 'apply review' });
            if (!raw) return scene;
            const next = normalizeScene(restore(raw, scene), { style: scene.style, aspect: scene.aspect }).scene;
            return next.scenes.length ? next : scene;
          });
          ({ scene, issues } = await step('check', 'Checking the changes', () => checkScene(scene, opts)));
        }
      }
    }

    return { storyboard, scene, code, issues, tier: code ? 'code' : tier };
  }

  // project: { tier, storyboard, scene, code, edited }
  async function edit(project, instruction, opts = {}) {
    const text = String(instruction || '').trim();
    if (!text) throw new Error('Say what to change.');
    const route = project.code ? 'code' : project.tier === 'guided' && !project.edited ? 'guided' : 'plan';
    if (route === 'guided') {
      const sb = await step('edit', 'Rewriting the storyboard', async () => {
        const raw = await askJson(storyboardPrompt({ seconds: opts.seconds || project.scene.duration, narration: opts.narration }), editMessage('guided', text, project.storyboard), { schema: STORYBOARD_SCHEMA, purpose: 'edit' });
        const { storyboard } = normalizeStoryboard(raw || {});
        if (!storyboard.beats.length) throw new Error('The model\'s answer could not be read as a storyboard. Nothing was changed.');
        return storyboard;
      });
      let { scene } = compileStoryboard(sb, {
        style: project.scene.style, aspect: project.scene.aspect, fps: project.scene.fps, bpm: project.scene.bpm,
        targetDuration: opts.seconds, narration: opts.narration, voice: project.scene.voice, assets: project.scene.assets,
        palette: project.scene.palette, score: project.scene.sound.score,
      });
      scene = normalizeScene(restore(scene, project.scene)).scene;
      ({ scene } = await step('check', 'Checking stills and timing', () => checkScene(scene, opts)));
      return { ...project, storyboard: sb, scene };
    }
    if (route === 'code') {
      const code = await step('edit', 'Changing the code', async () => {
        const reply = await deps.ask({ system: codePrompt({ seconds: project.scene.duration, aspect: project.scene.aspect, timing: timingText(project.scene) }), messages: [{ role: 'user', content: editMessage('code', text, project.code) }], purpose: 'edit' });
        const next = asModule(extractCode(reply));
        const problems = checkCode(next);
        if (problems.length) throw new Error(`The changed code was not used: ${problems[0]}`);
        const run = await deps.trial({ scene: project.scene, code: next });
        if (!run.ok) throw new Error(`The changed code failed while drawing: ${run.error}`);
        return next;
      });
      return { ...project, code };
    }
    let scene = await step('edit', 'Changing the plan', async () => {
      const raw = await askJson(planPrompt({ seconds: project.scene.duration, aspect: project.scene.aspect, style: project.scene.style }), editMessage('plan', text, sceneForModel(project.scene)), { purpose: 'edit' });
      if (!raw) throw new Error('The model\'s answer could not be read as a plan. Nothing was changed.');
      const next = normalizeScene(restore(raw, project.scene), { style: project.scene.style, aspect: project.scene.aspect }).scene;
      if (!next.scenes.length) throw new Error('The changed plan had no scenes. Nothing was changed.');
      return next;
    });
    ({ scene } = await step('check', 'Checking stills and timing', () => checkScene(scene, opts)));
    return { ...project, scene };
  }

  return { make, edit, checkScene };
}
