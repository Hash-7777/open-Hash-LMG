// The rules the checks hold a stage to: no two planes may stand face to face
// closer than the gap that lets the frame tell which is in front.

import { MIN_GAP, planeNormal } from './stage3d.js';

// Pairs of drawn planes that face the same way, overlap on the frame and stand
// closer than MIN_GAP along their facing: those flicker. Copies of one object
// stacked on purpose (one group, drawn in a fixed order) are left out.
export function coplanarPairs(drawn) {
  const out = [];
  const same = (a, b) => ['rx', 'ry', 'rz'].every((k) => Math.abs((a[k] || 0) - (b[k] || 0)) < 0.5);
  for (let i = 0; i < drawn.length; i++) for (let j = i + 1; j < drawn.length; j++) {
    const A = drawn[i], B = drawn[j];
    if (A.plane?.group && A.plane.group === B.plane?.group) continue;
    if (!same(A.pose, B.pose)) continue;
    // Planes that only meet at an edge share no pixel, so cannot flicker.
    if (quadOverlap(A.corners, B.corners) <= 1) continue;
    // Distance between the two centres along the shared facing.
    const n = planeNormal(A.pose);
    const d = (B.pose.x - A.pose.x) * n[0] + (B.pose.y - A.pose.y) * n[1] + (B.pose.z - A.pose.z) * n[2];
    if (Math.abs(d) < MIN_GAP - 0.01) out.push([A.id, B.id, Math.abs(d)]);
  }
  return out;
}

// How deep two convex quads on the frame overlap, in pixels: 0 when some edge
// of either one separates them.
export function quadOverlap(P, Q) {
  let depth = Infinity;
  for (const poly of [P, Q]) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      let nx = b[1] - a[1], ny = a[0] - b[0];
      const l = Math.hypot(nx, ny) || 1;
      nx /= l; ny /= l;
      const span = (pts) => { let lo = Infinity, hi = -Infinity; for (const p of pts) { const v = p[0] * nx + p[1] * ny; lo = Math.min(lo, v); hi = Math.max(hi, v); } return [lo, hi]; };
      const [p0, p1] = span(P), [q0, q1] = span(Q);
      depth = Math.min(depth, Math.min(p1, q1) - Math.max(p0, q0));
      if (depth <= 0) return 0;
    }
  }
  return depth;
}
