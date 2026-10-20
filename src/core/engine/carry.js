// One element carried from a scene into the next: a layer of the scene
// before becomes a layer of this scene, moving and resizing into place while
// everything else crossfades, so the story reads as one continuous piece.
//
// While the transition runs, neither layer draws itself. A carrier is drawn
// instead, in screen space: its place and size move from where the first
// layer is on screen (through its own scene's camera) to where the second
// will rest (through its scene's camera), on a settling spring. Two lines of
// text with different words crossfade on the way. Once it has arrived, the
// second layer stays where it is instead of making its entrance again.

import { layerState } from './motion.js';
import { clamp, mix } from './math.js';
import { resolveEase } from './ease.js';

function find(layers, id) {
  for (const L of layers || []) {
    if (L.id === id) return L;
    const inner = find(L.layers, id);
    if (inner) return inner;
  }
  return null;
}

// The pair an incoming scene carries in, when both layers exist.
export function carryPair(doc, index) {
  const S = doc.scenes[index], prev = doc.scenes[index - 1];
  const c = S && S.transition.kind === 'carry' ? S.transition.carry : null;
  if (!c || !prev) return null;
  const from = find(prev.layers, c.from), to = find(S.layers, c.to);
  return from && to ? { prev, scene: S, from, to } : null;
}

// The layer that arrived by being carried, already in place.
export function arrived(L) {
  return { ...L, at: Math.min(L.at, 0), in: { ...L.in, preset: 'none', duration: 0, at: null } };
}

function camera(S, local, W, H) {
  const cp = resolveEase(S.camera.ease)(clamp(local / S.duration));
  return { z: mix(S.camera.zoom[0], S.camera.zoom[1], cp), cx: mix(S.camera.x[0], S.camera.x[1], cp) * W, cy: mix(S.camera.y[0], S.camera.y[1], cp) * H };
}

// Where a layer is on screen, through its scene's camera.
function onScreen(S, local, L, st, W, H) {
  const { z, cx, cy } = camera(S, local, W, H);
  const px = st.x * W + st.dx, py = st.y * H + st.dy;
  return { x: (px - W / 2 - cx) * z + W / 2, y: (py - H / 2 - cy) * z + H / 2, z };
}

// Draws the carrier at film time t. `drawLayer(kit, doc, L, local)` draws a
// layer as the renderer does.
export function drawCarrier(kit, doc, pair, t, p, drawLayer) {
  const { W, H, u } = kit;
  const { prev, scene, from, to } = pair;
  const aLocal = t - prev.start, bLocal = t - scene.start;
  const sa = layerState(from, aLocal, u);
  const restB = arrived(to);
  const sb = layerState(restB, Math.max(bLocal, scene.transition.duration), u);
  const A = onScreen(prev, aLocal, from, sa, W, H);
  const B = onScreen(scene, Math.max(bLocal, scene.transition.duration), to, sb, W, H);
  const k = resolveEase('settle')(clamp(p));
  const x = mix(A.x, B.x, k), y = mix(A.y, B.y, k);
  const still = { at: 0, until: 1e6, in: { preset: 'none', duration: 0, at: null, ease: 'linear', stagger: 0, distance: 0 }, out: { preset: 'none', duration: 0, at: null, ease: 'linear', stagger: 0, distance: 0 }, hold: 'none', keys: {}, x: x / W, y: y / H, rotate: mix(sa.rotate, sb.rotate, k) };
  const sameText = from.type === 'text' && to.type === 'text';
  if (sameText) {
    // One size for both on the way, so the two lines move as one.
    const size = mix((from.size * A.z), (to.size * B.z), k);
    if (k < 0.999) drawLayer(kit, doc, { ...from, ...still, size, scale: 1, opacity: sa.opacity * (from.text === to.text ? 1 - Math.round(k) : 1 - k), id: from.id }, 1);
    if (k > 0.001) drawLayer(kit, doc, { ...restB, ...still, size, scale: 1, opacity: sb.opacity * (from.text === to.text ? Math.round(k) : k), id: to.id }, 1);
  } else {
    drawLayer(kit, doc, { ...from, ...still, scale: mix(sa.scale * A.z, sa.scale * B.z, k), opacity: sa.opacity * (1 - k), id: from.id }, 1);
    drawLayer(kit, doc, { ...restB, ...still, scale: mix(sb.scale * A.z, sb.scale * B.z, k), opacity: sb.opacity * k, id: to.id }, 1);
  }
}
