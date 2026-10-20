// Edits to a scene that keep its timing whole, the way a motion designer
// expects: a layer that ran to the end of its scene still runs to the end
// when the scene gets longer or shorter, with its exit moving with it, while
// entrances keep their times. Works on the plain objects the editor changes
// before they are normalised.

const EPS = 1e-3;

function each(layers, fn) {
  for (const L of layers || []) { fn(L); if (L.layers) each(L.layers, fn); }
}

export function resizeScene(S, duration) {
  const old = S.duration;
  const next = Math.max(0.1, duration);
  const delta = next - old;
  each(S.layers, (L) => {
    const until = L.until ?? old;
    if (until >= old - EPS) {
      L.until = next;
      if (L.out && typeof L.out === 'object' && Number.isFinite(L.out.at)) L.out.at = Math.max(0, L.out.at + delta);
    } else if (until > next) {
      L.until = next;
    }
    if ((L.at ?? 0) >= next) L.at = Math.max(0, next - 0.1);
  });
  S.duration = next;
  return S;
}
