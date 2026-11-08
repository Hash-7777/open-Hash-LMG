// A product's two accent colours, read from its icon: the strongest colour in
// it, and the strongest whose hue is clearly another. A product film uses only
// these and the studio's own neutrals, so it is coloured by the product and
// never by invented brand colours.

const hsv = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h * 60) + 360) % 360, mx ? d / mx : 0, mx / 255];
};
const hex = (r, g, b) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

// rgba: the icon's pixels (4 bytes each). Returns { accent, accent2 } as hex,
// either null when the icon has no colour strong enough.
export function iconAccents(rgba, { bins = 24, minSat = 0.35, minVal = 0.35, apart = 25 } = {}) {
  const weight = new Float64Array(bins), sum = Array.from({ length: bins }, () => [0, 0, 0]);
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    const [h, s, v] = hsv(rgba[i], rgba[i + 1], rgba[i + 2]);
    if (s < minSat || v < minVal) continue;
    // The purest pixels count most, so soft edges do not darken the colour.
    const k = Math.floor(h / (360 / bins)) % bins, w = (s * v) ** 4;
    weight[k] += w;
    sum[k][0] += rgba[i] * w; sum[k][1] += rgba[i + 1] * w; sum[k][2] += rgba[i + 2] * w;
  }
  const order = [...weight.keys()].filter((k) => weight[k] > 0).sort((a, b) => weight[b] - weight[a]);
  const colour = (k) => (k === undefined ? null : hex(...sum[k].map((c) => c / weight[k])));
  const first = order[0];
  const hueOf = (k) => (k + 0.5) * (360 / bins);
  const far = (a, b) => { const d = Math.abs(hueOf(a) - hueOf(b)); return Math.min(d, 360 - d) >= apart; };
  const second = first === undefined ? undefined : order.find((k) => far(k, first));
  return { accent: colour(first), accent2: colour(second) };
}
