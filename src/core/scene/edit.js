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

// Staggers the entrances of a scene's layers: each layer that enters starts
// `step` seconds after the one before, in the order chosen, from where the
// earliest of them starts now. Layers with no entrance keep their time.
//   order  listed (as in the layer list), top (top to bottom), left (left to
//          right) or centre (nearest the middle of the frame first)
//   end    the scene's length
export const STAGGER_ORDERS = ['listed', 'top', 'left', 'centre'];
export function staggerLayers(layers, { step = 0.12, order = 'listed', end = Infinity } = {}) {
  const moving = layers.filter((L) => (typeof L.in === 'string' ? L.in : L.in?.preset) !== 'none');
  if (moving.length < 2) return 0;
  const key = {
    listed: (L) => layers.indexOf(L),
    top: (L) => L.y ?? 0.5,
    left: (L) => L.x ?? 0.5,
    centre: (L) => Math.hypot((L.x ?? 0.5) - 0.5, (L.y ?? 0.5) - 0.5),
  }[order] || ((L) => layers.indexOf(L));
  const start = Math.min(...moving.map((L) => L.at || 0));
  [...moving].sort((a, b) => key(a) - key(b) || layers.indexOf(a) - layers.indexOf(b)).forEach((L, k) => {
    const shift = +(start + k * step).toFixed(3) - (L.at || 0);
    L.at = +(start + k * step).toFixed(3);
    // A layer that leaves before the scene ends moves its leaving with it, so
    // its hold stays as long; one that stays to the end still does.
    if (Number.isFinite(L.until) && L.until < end - 1e-6) L.until = +Math.min(end, L.until + shift).toFixed(3);
  });
  return moving.length;
}
