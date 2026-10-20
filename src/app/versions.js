// A version of the film for another frame shape: 9:16 for phones from a 16:9
// film, or the other way round. A version for a phone is laid out again for
// the phone, never cropped from the wide film.
//
// A film made from a storyboard and not changed by hand is laid out afresh
// from its storyboard in the new shape, keeping its style, palette, tempo,
// music and spoken clips. Any other film keeps its scenes and layers, takes
// the new shape, and has its layout repaired by the film checks, measured on
// the new frame.

import { compileStoryboard } from '../core/scene/compile.js';
import { normalizeScene } from '../core/scene/normalize.js';
import { lintScene, autofix, sampleTimes } from '../core/scene/lint.js';
import { ASPECTS } from '../core/scene/format.js';
import { createHost } from '../render/host.js';
import { normalizeProject } from './store.js';

export async function makeVersion(project, aspect, newId) {
  const s = project.scene;
  if (!ASPECTS[aspect] || aspect === s.aspect) throw new Error('Choose another frame shape.');
  let scene;
  if (project.storyboard && !project.edited && !project.code) {
    scene = compileStoryboard(project.storyboard, {
      style: s.style, aspect, fps: s.fps, bpm: s.bpm, targetDuration: s.duration, palette: s.palette,
      score: s.sound.score, voice: s.voice, assets: s.assets, narration: s.voice.lines.length > 0,
    }).scene;
    // Spoken clips belong to the words, not the frame: they come along.
    const clips = new Map(s.voice.lines.filter((l) => l.clip).map((l) => [l.text, l.clip]));
    scene = normalizeScene({ ...scene, voice: { ...scene.voice, lines: scene.voice.lines.map((l) => ({ ...l, clip: clips.get(l.text) || null })) } }).scene;
  } else {
    scene = normalizeScene({ ...s, aspect, width: undefined, height: undefined }).scene;
    if (!project.code) {
      const host = createHost();
      try {
        for (let round = 0; round < 2; round++) {
          await host.setScene(scene);
          const issues = lintScene(scene, { samples: await host.measure(sampleTimes(scene)) }).filter((i) => i.fix && ['fit-frame', 'fit-safe', 'separate', 'grow-text'].includes(i.fix.kind));
          if (!issues.length) break;
          scene = autofix(scene, issues).scene;
        }
      } finally { host.dispose(); }
    }
  }
  const label = { '9:16': 'vertical', '16:9': 'wide', '1:1': 'square', '4:5': 'portrait' }[aspect];
  return normalizeProject({
    ...project, id: undefined, created: undefined, updated: undefined,
    scene: { ...scene, title: `${s.title.replace(/ \((vertical|wide|square|portrait)\)$/, '')} (${label})` },
  }, newId);
}
