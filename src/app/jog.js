// The playhead moved by hand, as in a video editor.
//
// A scroll or a two-finger swipe over the preview turns it like a jog wheel:
// right or down goes forward, left or up back. A trackpad's fine steps add up
// to a frame every few pixels; a mouse wheel's notch is one frame, ten with
// Shift, and a pinch is kept from zooming the window. editTime finds the
// scene start before or after the playhead, for the mouse's back and forward
// buttons and the Up and Down keys. attachJog wires both to the preview.

const PIXELS_PER_FRAME = 6;
const NOTCH = 40;

// A jog for one surface: each wheel event in, whole frames to move out.
export function createJog() {
  let rest = 0;
  return function frames(e) {
    const across = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    const d = across ? e.deltaX : e.deltaY;
    if (!d) return 0;
    // A wheel that counts in lines, or a mouse wheel's whole notch: a frame each.
    const notch = e.deltaMode === 1 || (e.deltaMode === 0 && !across && Math.abs(d) >= NOTCH && Number.isInteger(d));
    if (notch) { rest = 0; return Math.sign(d) * (e.shiftKey ? 10 : 1); }
    rest += d;
    const n = Math.trunc(rest / PIXELS_PER_FRAME);
    rest -= n * PIXELS_PER_FRAME;
    return n;
  };
}

// The start of the scene after t (dir 1) or before it (dir -1), the film's
// end and start counting as edits too.
export function editTime(scene, t, dir) {
  const eps = 1 / (2 * (scene.fps || 30));
  const edits = [0, ...scene.scenes.map((S) => S.start), scene.duration].filter((x, i, a) => a.indexOf(x) === i).sort((a, b) => a - b);
  if (dir > 0) return edits.find((x) => x > t + eps) ?? scene.duration;
  return [...edits].reverse().find((x) => x < t - eps) ?? 0;
}

// The jog on the preview's picture, and the jump to the scene before or after.
//   player { step(frames), seek(t) }
export function attachJog(surface, { store, player }) {
  const jog = createJog();
  surface.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || !store.get().project.scene.scenes.length) return;
    const n = jog(e);
    if (n) player.step(n);
  }, { passive: false });
  return {
    jumpEdit(dir) {
      const st = store.get();
      player.seek(editTime(st.project.scene, st.time, dir));
    },
  };
}
