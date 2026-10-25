// Moving a scene to another place in the film from the timeline: drag its
// block sideways, or press Alt with an arrow while it has the keyboard.
//
// A block dragged past a few pixels is picked up: it follows the pointer, a
// line shows where it will land, and letting go puts it there as one step of
// undo. A press that does not move only selects, as before.

import { h, drag } from './dom.js';

export function createSceneMover({ store, focusMoved = () => {} }) {
  function move(id, to) {
    store.edit((doc) => {
      const from = doc.scenes.findIndex((x) => x.id === id);
      const dest = Math.max(0, Math.min(doc.scenes.length - 1, to));
      if (from < 0 || from === dest) return false;
      const [S] = doc.scenes.splice(from, 1);
      doc.scenes.splice(dest, 0, S);
      return undefined;
    });
    // The moved block keeps the keyboard after the timeline redraws.
    focusMoved();
  }

  // e: the press on the block; live(): the block as drawn now (selecting a
  // scene redraws the timeline, so the pressed element may be gone); scene:
  // the film as drawn; pps: pixels a second.
  function pick(e, live, scene, from, pps) {
    let block = null;
    const mids = scene.scenes.map((S) => (S.start + S.duration / 2) * pps);
    const own = mids[from];
    let moving = false;
    let to = from;
    const marker = h('div', { class: 'tl-insert' });
    drag(e, {
      onMove: (dx) => {
        if (!moving && Math.abs(dx) < 6) return;
        if (!moving) {
          block = live();
          if (!block) return;
          moving = true;
          block.classList.add('dragging');
          block.parentElement.append(marker);
        }
        block.style.transform = `translateX(${dx}px)`;
        to = mids.filter((m, k) => k !== from && m < own + dx).length;
        const rest = scene.scenes.filter((_, k) => k !== from);
        marker.style.left = `${(to < rest.length ? rest[to].start : scene.duration) * pps}px`;
      },
      onEnd: () => {
        if (!moving) return;
        block.classList.remove('dragging');
        block.style.transform = '';
        marker.remove();
        if (to !== from) move(scene.scenes[from].id, to);
      },
    });
  }

  return { move, pick };
}
