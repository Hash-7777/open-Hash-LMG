// SVG path data, flattened to polylines so a stroke can be drawn on over time.
//
// Canvas can fill and stroke a Path2D built from the same string, but it cannot
// say how long a path is or draw only its first 40 percent. "Draw on" is one of
// the motions that reads as designed rather than generated, so the path is
// parsed here, curves are flattened into short segments, and the length is
// known exactly.
//
// Supported: M L H V C S Q T A Z, absolute and relative. Arcs are flattened by
// the endpoint-to-centre conversion in the SVG specification.

const CMD = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/g;

function tokenize(d) {
  const out = [];
  let m;
  CMD.lastIndex = 0;
  while ((m = CMD.exec(String(d || '')))) out.push(m[1] || parseFloat(m[2]));
  return out;
}

function cubic(p0, p1, p2, p3, pts, steps) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    pts.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
}

function quad(p0, p1, p2, pts, steps) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    pts.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
  }
}

function arc(p0, rx, ry, rot, large, sweep, p1, pts) {
  if (rx === 0 || ry === 0) { pts.push(p1); return; }
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = (rot * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2, dy = (p0[1] - p1[1]) / 2;
  const x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy;
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let k = Math.sqrt(Math.max(0, num / (den || 1e-12)));
  if (large === sweep) k = -k;
  const cx1 = (k * rx * y1) / ry, cy1 = (-k * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0[0] + p1[0]) / 2;
  const cy = sin * cx1 + cos * cy1 + (p0[1] + p1[1]) / 2;
  const ang = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const th1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dth = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dth > 0) dth -= 2 * Math.PI;
  if (sweep && dth < 0) dth += 2 * Math.PI;
  const steps = Math.max(4, Math.ceil(Math.abs(dth) / (Math.PI / 24)));
  for (let i = 1; i <= steps; i++) {
    const a = th1 + (dth * i) / steps;
    const x = rx * Math.cos(a), y = ry * Math.sin(a);
    pts.push([cos * x - sin * y + cx, sin * x + cos * y + cy]);
  }
}

// Parses path data into subpaths: [{ points: [[x, y], ...], closed }].
export function parsePath(d, steps = 16) {
  const tk = tokenize(d);
  const subs = [];
  let i = 0, cmd = null, cur = [0, 0], start = [0, 0], sub = null, lastCtrl = null, lastCmd = '';
  const num = () => { const v = tk[i]; if (typeof v !== 'number') throw new Error('bad path'); i++; return v; };
  const begin = (p) => { sub = { points: [p], closed: false }; subs.push(sub); };
  try {
    while (i < tk.length) {
      if (typeof tk[i] === 'string') cmd = tk[i++];
      else if (!cmd) break;
      const rel = cmd === cmd.toLowerCase();
      const C = cmd.toUpperCase();
      const at = (x, y) => (rel ? [cur[0] + x, cur[1] + y] : [x, y]);
      if (C === 'Z') {
        if (sub) { sub.closed = true; sub.points.push([start[0], start[1]]); }
        cur = [start[0], start[1]];
        lastCtrl = null; lastCmd = 'Z';
        continue;
      }
      if (C === 'M') {
        const p = at(num(), num());
        begin(p); cur = p; start = p;
        cmd = rel ? 'l' : 'L';
        lastCtrl = null; lastCmd = 'M';
        continue;
      }
      if (!sub) begin([cur[0], cur[1]]);
      if (C === 'L') { const p = at(num(), num()); sub.points.push(p); cur = p; lastCtrl = null; }
      else if (C === 'H') { const x = num(); const p = [rel ? cur[0] + x : x, cur[1]]; sub.points.push(p); cur = p; lastCtrl = null; }
      else if (C === 'V') { const y = num(); const p = [cur[0], rel ? cur[1] + y : y]; sub.points.push(p); cur = p; lastCtrl = null; }
      else if (C === 'C') {
        const p1 = at(num(), num()), p2 = at(num(), num()), p3 = at(num(), num());
        cubic(cur, p1, p2, p3, sub.points, steps); cur = p3; lastCtrl = p2;
      } else if (C === 'S') {
        const p1 = lastCtrl && /[CS]/i.test(lastCmd) ? [2 * cur[0] - lastCtrl[0], 2 * cur[1] - lastCtrl[1]] : cur;
        const p2 = at(num(), num()), p3 = at(num(), num());
        cubic(cur, p1, p2, p3, sub.points, steps); cur = p3; lastCtrl = p2;
      } else if (C === 'Q') {
        const p1 = at(num(), num()), p2 = at(num(), num());
        quad(cur, p1, p2, sub.points, steps); cur = p2; lastCtrl = p1;
      } else if (C === 'T') {
        const p1 = lastCtrl && /[QT]/i.test(lastCmd) ? [2 * cur[0] - lastCtrl[0], 2 * cur[1] - lastCtrl[1]] : cur;
        const p2 = at(num(), num());
        quad(cur, p1, p2, sub.points, steps); cur = p2; lastCtrl = p1;
      } else if (C === 'A') {
        const rx = num(), ry = num(), rot = num(), large = num() ? 1 : 0, sweep = num() ? 1 : 0;
        const p = at(num(), num());
        arc(cur, rx, ry, rot, large, sweep, p, sub.points); cur = p; lastCtrl = null;
      } else { break; }
      lastCmd = C;
    }
  } catch {
    // A malformed tail keeps whatever parsed before it, so one bad number in a
    // model's path does not erase the whole shape.
  }
  return subs.filter((s) => s.points.length > 1);
}

function segLen(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }

export function pathLength(subs) {
  let len = 0;
  for (const s of subs) for (let i = 1; i < s.points.length; i++) len += segLen(s.points[i - 1], s.points[i]);
  return len;
}

// The part of the path between fractions `from` and `to` of its total length,
// as polylines. trim(subs, 0, 0.4) is the first 40 percent, drawn on.
export function trimPath(subs, from = 0, to = 1) {
  const total = pathLength(subs);
  if (total === 0 || to <= from) return [];
  const a = Math.max(0, from) * total, b = Math.min(1, to) * total;
  const out = [];
  let walked = 0;
  for (const s of subs) {
    let line = null;
    for (let i = 1; i < s.points.length; i++) {
      const p = s.points[i - 1], q = s.points[i], l = segLen(p, q);
      const s0 = walked, s1 = walked + l;
      walked = s1;
      if (s1 < a || s0 > b || l === 0) { if (line && s0 > b) break; continue; }
      const f0 = Math.max(0, (a - s0) / l), f1 = Math.min(1, (b - s0) / l);
      const P = [p[0] + (q[0] - p[0]) * f0, p[1] + (q[1] - p[1]) * f0];
      const Q = [p[0] + (q[0] - p[0]) * f1, p[1] + (q[1] - p[1]) * f1];
      if (!line) { line = [P]; out.push(line); }
      line.push(Q);
    }
  }
  return out;
}

// The point and direction at a fraction of the path, for something that travels
// along it (a dot riding a line chart, a marker following a route).
export function pointAt(subs, f) {
  const total = pathLength(subs);
  let target = Math.max(0, Math.min(1, f)) * total, walked = 0;
  for (const s of subs) {
    for (let i = 1; i < s.points.length; i++) {
      const p = s.points[i - 1], q = s.points[i], l = segLen(p, q);
      if (walked + l >= target && l > 0) {
        const k = (target - walked) / l;
        return { x: p[0] + (q[0] - p[0]) * k, y: p[1] + (q[1] - p[1]) * k, angle: Math.atan2(q[1] - p[1], q[0] - p[0]) };
      }
      walked += l;
    }
  }
  const last = subs.at(-1)?.points.at(-1) || [0, 0];
  return { x: last[0], y: last[1], angle: 0 };
}

export function pathBounds(subs) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of subs) for (const [x, y] of s.points) {
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 0, h: 0 };
}
