// The templates: every one makes a whole film at once that passes the film
// checks, moves on every beat, keeps its invented words, and comes out as a
// new film on a new take.

import { ok, section, attempt, done } from './lib/check.mjs';
import { measure } from './lib/fixtures.mjs';
import { TEMPLATES, filmFromTemplate } from '../../src/core/scene/templates.js';
import { lintScene, sampleTimes, motionTimes, beatTimes } from '../../src/core/scene/lint.js';
import { BEAT_KINDS } from '../../src/core/scene/storyboard.js';

section('Every template makes a clean film');
for (const tpl of TEMPLATES) {
  await attempt(tpl.id, async () => {
    for (const take of [0, 1, 2]) {
      const { scene, storyboard } = filmFromTemplate(tpl, { take });
      const issues = lintScene(scene, { samples: measure(scene, sampleTimes(scene)), moving: measure(scene, motionTimes(scene)), beats: measure(scene, beatTimes(scene)), targetDuration: tpl.seconds });
      const bad = issues.filter((i) => i.level === 'error' || i.code === 'frozen' || i.code === 'collide-in-motion' || i.code === 'off-frame');
      ok(`${tpl.id} take ${take}: no errors, nothing frozen, nothing crossing`, bad.length === 0, bad.slice(0, 2).map((i) => i.message).join(' / '));
      ok(`${tpl.id} take ${take}: in its own frame shape`, scene.aspect === tpl.aspect);
      ok(`${tpl.id} take ${take}: every beat kind known, no markup left in the words`, storyboard.beats.every((b) => BEAT_KINDS.includes(b.kind)) && !JSON.stringify(scene.scenes).includes('*'));
    }
    const film = (take) => JSON.stringify(filmFromTemplate(tpl, { take }).scene.scenes);
    ok(`${tpl.id}: a new take is another film`, film(5) !== film(6) && film(6) !== film(7));
  });
}
section('The templates are different films');
{
  const ids = new Set(TEMPLATES.map((t) => t.id));
  ok('ids are unique', ids.size === TEMPLATES.length);
  ok('several frame shapes are offered', new Set(TEMPLATES.map((t) => t.aspect)).size >= 3);
}
done();
