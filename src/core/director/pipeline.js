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
//   deps.ask({ system, messages, json, schema, purpose, part, temperature }) -> the model's text
//                                                           part: { index, of } when one of several drafts
//   deps.measure({ scene, code }, times)                    -> [{ t, boxes }]
//   deps.trial({ scene, code })                             -> { ok, error }
//   deps.sheet({ scene, code }, times)                      -> image data URL or null
//   deps.log({ id, title, status, detail })                 status: run | done | fail | note

import { normalizeStoryboard } from '../scene/storyboard.js';
import { compileStoryboard } from '../scene/compile.js';
import { chooseDirection, describeDirection } from '../scene/direction.js';
import { normalizeScene } from '../scene/normalize.js';
import { lintScene, autofix, sampleTimes, motionTimes, beatTimes } from '../scene/lint.js';
import { extractJson, extractCode } from '../util/json.js';
import { checkCode, asModule } from './code-check.js';
import { INTENT_SCHEMA, intentPrompt, normalizeIntent, intentTimes, verifyIntent, intentFailures } from './intent.js';
import {
  STORYBOARD_SCHEMA, storyboardPrompt, planPrompt, planFromDraftMessage, codePrompt,
  revisePlanMessage, reviseCodeMessage, CRITIC_PROMPT, criticMessage, applyCritiqueMessage, editMessage,
} from './prompts.js';
import { sceneForModel, restore, draftScore } from './scene-io.js';

// The scene helpers are in scene-io.js; sceneForModel is re-exported for the checks.
export { sceneForModel, draftScore } from './scene-io.js';

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

  async function askJson(system, content, { schema = null, purpose, images = null, part = null, temperature }) {
    const text = await deps.ask({ system, messages: [{ role: 'user', content, ...(images ? { images } : {}) }], json: true, schema, purpose, part, temperature });
    return extractJson(text).value;
  }

  async function writeStoryboard(brief, opts, part = null, temperature) {
    const system = storyboardPrompt({ seconds: opts.seconds, narration: opts.narration });
    let raw = await askJson(system, `Brief:\n${brief}`, { schema: STORYBOARD_SCHEMA, purpose: 'storyboard', part, temperature });
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

  // ---- the brief, checked on the finished film ---------------------------------
  async function listIntent(brief) {
    return normalizeIntent(await askJson(intentPrompt(), `Brief:\n${brief}`, { schema: INTENT_SCHEMA, purpose: 'intent' }));
  }

  async function checkBrief(intent, scene, code) {
    const samples = await deps.measure({ scene, code }, intentTimes(scene.duration));
    const flat = (list) => list.flatMap((L) => [L, ...flat(L.layers || [])]);
    const counters = code ? [] : scene.scenes.flatMap((S) => flat(S.layers)).filter((L) => L.type === 'counter');
    return verifyIntent(intent, samples, { duration: scene.duration, width: scene.width, counters });
  }

  // The film's direction: read from the brief and the model's suggested look,
  // turned by the take so the same brief made again is a new film.
  function directionFor(storyboard, opts) {
    return chooseDirection({ brief: opts.brief, look: storyboard?.look, style: opts.style, take: opts.take || 0 });
  }

  function compile(storyboard, opts) {
    return compileStoryboard(storyboard, {
      direction: directionFor(storyboard, opts),
      style: opts.style, aspect: opts.aspect, fps: opts.fps, targetDuration: opts.seconds,
      narration: opts.narration, voice: opts.voice, assets: opts.assets, palette: opts.palette, score: opts.score,
    });
  }

  // Measures, repairs by rule, and returns what is left.
  // Measures frames at rest and in the middle of moves, so words that only
  // collide while moving are caught too.
  async function measured(scene) {
    const rest = sampleTimes(scene);
    const moves = motionTimes(scene);
    const all = await deps.measure({ scene }, [...rest, ...moves, ...beatTimes(scene)]);
    return { samples: all.slice(0, rest.length), moving: all.slice(rest.length, rest.length + moves.length), beats: all.slice(rest.length + moves.length) };
  }

  async function checkScene(scene, opts) {
    let issues = lintScene(scene, { ...(await measured(scene)), targetDuration: opts.seconds });
    const fixable = issues.filter((i) => i.fix);
    if (fixable.length) {
      const fixed = autofix(scene, fixable);
      scene = fixed.scene;
      for (const a of fixed.applied) note('check', a);
      issues = lintScene(scene, { ...(await measured(scene)), targetDuration: opts.seconds });
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
    const d = directionFor(storyboard, opts);
    let content = `Brief:\n${brief}\n\nStoryboard:\n${JSON.stringify(storyboard)}\n\nDirection: ${describeDirection(d)}. Fonts: ${JSON.stringify(draft.fonts)}. Palette (lmg.palette holds it): ${JSON.stringify(draft.palette)}`;
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

  // opts: { brief, tier, style, aspect, seconds, fps, narration, voice, vision, rounds, assets, palette, score, drafts, verify }
  async function make(opts) {
    const brief = String(opts.brief || '').trim();
    if (!brief) throw new Error('Describe the film first.');
    const tier = opts.tier || 'guided';
    const rounds = opts.rounds ?? (tier === 'guided' ? 0 : 2);

    const drafts = tier === 'guided' ? Math.max(1, Math.min(3, opts.drafts || 1)) : 1;
    let storyboard = await step('story', drafts > 1 ? 'Writing storyboards' : 'Writing the storyboard', () => bestStoryboard(brief, opts, drafts));
    // What the brief asks to see, as statements the finished film is held to.
    let intent = [];
    if (opts.verify) {
      try {
        intent = await step('intent', 'Listing what the brief asks to see', () => listIntent(brief));
      } catch (err) {
        if (err?.stopped) throw err;
        note('intent', 'The model\u2019s list of what the brief asks for could not be read, so the film is made without it.');
      }
    }
    const direction = directionFor(storyboard, opts);
    note('layout', `Direction: ${describeDirection(direction)}.`);
    let { scene, notes: laid } = await step('layout', 'Laying it out and timing it to the music', async () => compile(storyboard, opts));
    for (const n of laid || []) note('layout', n);
    let code = null;

    if (tier === 'plan') {
      // A redesign that fails leaves the rule-made design, so the film is still made.
      const draft = scene;
      try {
        scene = await step('design', 'Designing every scene', () => designPlan(brief, storyboard, draft, opts));
      } catch (err) {
        if (err?.stopped) throw err;
        note('design', `${String(err.message || err)} The rule-made design is kept.`);
        scene = draft;
      }
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

    let briefResults = null;
    if (intent.length) {
      briefResults = await step('verify', 'Checking the film against the brief', () => checkBrief(intent, scene, code));
      let failed = intentFailures(briefResults);
      // One round back to whatever made the film, kept only if it misses less.
      if (failed.length) {
        if (code) {
          const next = await step('revise', 'Showing what the brief asks for', async () => {
            const text = await deps.ask({ system: codePrompt({ seconds: scene.duration, aspect: scene.aspect, timing: timingText(scene) }), messages: [{ role: 'user', content: `${reviseCodeMessage(failed)}\n\n\`\`\`js\n${code}\n\`\`\`` }], purpose: 'revise code' });
            const c2 = asModule(extractCode(text));
            return !checkCode(c2).length && (await deps.trial({ scene, code: c2 })).ok ? c2 : null;
          });
          if (next) {
            const again = await step('verify', 'Checking against the brief again', () => checkBrief(intent, scene, next));
            if (intentFailures(again).length < failed.length) { code = next; briefResults = again; }
          }
        } else {
          let candidate = null;
          if (tier === 'guided') {
            const sb2 = await step('revise', 'Rewriting the storyboard to show what the brief asks for', async () => {
              const raw = await askJson(storyboardPrompt({ seconds: opts.seconds, narration: opts.narration }), `Brief:\n${brief}\n\nThe last storyboard missed these:\n${failed.join('\n')}\nWrite the whole storyboard again so the film shows all of them.`, { schema: STORYBOARD_SCHEMA, purpose: 'storyboard' });
              const { storyboard: s2 } = normalizeStoryboard(raw || {});
              return s2.beats.length ? s2 : null;
            });
            if (sb2) candidate = { storyboard: sb2, ...(await checkScene(compile(sb2, opts).scene, opts)) };
          } else {
            const s2 = await step('revise', 'Showing what the brief asks for', () => revisePlan(scene, failed.map((message) => ({ level: 'warn', message })), opts));
            candidate = { storyboard, ...(await checkScene(s2, opts)) };
          }
          if (candidate) {
            const again = await step('verify', 'Checking against the brief again', () => checkBrief(intent, candidate.scene, null));
            if (intentFailures(again).length < failed.length) { ({ storyboard, scene, issues } = candidate); briefResults = again; }
          }
        }
        failed = intentFailures(briefResults);
      }
      note('verify', failed.length ? 'Some of what the brief asks for is not in the film yet:' : 'The film shows everything the brief asked for.');
      for (const f of failed) note('verify', f);
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

    // Code that never ran falls back to the scene plan, and the film says so.
    return { storyboard, scene, code, issues, brief: briefResults, tier: code ? 'code' : tier === 'code' ? 'plan' : tier, take: opts.take || 0, direction };
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
        direction: chooseDirection({ brief: project.brief, look: sb.look || project.storyboard?.look, style: project.scene.style, take: project.take || 0 }),
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
