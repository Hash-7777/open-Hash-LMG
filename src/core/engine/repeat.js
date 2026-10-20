// One layer repeated by a rule: copies laid out in a row, a column, a grid
// or a circle, each arriving a moment after the one before. One rule makes
// a whole field of shapes move, and a model writes it as a few numbers.

export const REPEAT_LAYOUTS = ['row', 'column', 'grid', 'circle'];

// Offsets of each copy from the layer's place, in pixels.
export function repeatOffsets(r, u) {
  const n = r.count;
  const gap = r.gap * u;
  const out = [];
  for (let i = 0; i < n; i++) {
    if (r.layout === 'row') out.push([(i - (n - 1) / 2) * gap, 0]);
    else if (r.layout === 'column') out.push([0, (i - (n - 1) / 2) * gap]);
    else if (r.layout === 'grid') {
      const cols = Math.max(1, Math.min(n, r.cols));
      const rows = Math.ceil(n / cols);
      out.push([((i % cols) - (cols - 1) / 2) * gap, (Math.floor(i / cols) - (rows - 1) / 2) * gap]);
    } else {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      out.push([Math.cos(a) * r.radius * u, Math.sin(a) * r.radius * u]);
    }
  }
  return out;
}

// Draws every copy through `draw(L, t)`, each one shifted in place and later
// in time by its share of the stagger.
export function drawRepeated(kit, L, t, draw) {
  const { W, H, u } = kit;
  const offs = repeatOffsets(L.repeat, u);
  const single = { ...L, repeat: null };
  offs.forEach(([ox, oy], i) => draw({ ...single, x: L.x + ox / W, y: L.y + oy / H }, t - i * L.repeat.stagger));
}
