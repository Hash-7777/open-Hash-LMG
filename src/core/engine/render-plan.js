// Draws a normalized scene document at time t.
//
// The order every frame follows: for each scene alive at t (two during a
// transition), its background, then its layers under its camera and its
// transition; then the film-wide overlays (grain, vignette). Nothing here keeps
// state between frames, so frame 900 drawn alone is the same as frame 900
// drawn after frame 899.

import { drawOdometer } from './odometer.js';
import { carryPair, drawCarrier, arrived } from './carry.js';
import { drawRepeated } from './repeat.js';
import { resolveEase } from './ease.js';
import { clamp, mix, noise } from './math.js';
import { layerState } from './motion.js';

// Which scenes are on screen at t, each with its transition state.
export function activeScenes(doc, t) {
  const out = [];
  const list = doc.scenes;
  for (let i = 0; i < list.length; i++) {
    const S = list[i];
    const end = S.start + S.duration;
    if (t < S.start || t > end + 1e-6) continue;
    const local = t - S.start;
    const tr = S.transition;
    const inP = tr.kind !== 'cut' && tr.duration > 0 && local < tr.duration ? resolveEase(tr.ease)(clamp(local / tr.duration)) : 1;
    const next = list[i + 1];
    let outP = 0, outKind = null, outDir = 'left';
    if (next && t >= next.start) {
      const nt = next.transition;
      if (nt.kind === 'cut') continue;
      outP = resolveEase(nt.ease)(clamp((t - next.start) / Math.max(0.001, nt.duration)));
      outKind = nt.kind;
      outDir = nt.direction;
    }
    out.push({ scene: S, index: i, local, inP, inKind: tr.kind, inDir: tr.direction, outP, outKind, outDir });
  }
  return out;
}

const DIR = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

function drawBackgroundLayer(kit, doc, S, t) {
  const { W, H, u } = kit;
  const bg = S.background ?? doc.background.color ?? 'bg';
  const ctx = kit.ctx;
  ctx.save();
  ctx.fillStyle = kit.color(bg);
  // Oversized so a camera zoom-out or a push never shows an edge.
  ctx.fillRect(-W * 0.5, -H * 0.5, W * 2, H * 2);
  ctx.restore();
  const kind = doc.background.kind;
  const drift = doc.background.drift;
  if (kind === 'grid') {
    const step = 120 * u, off = (t * drift * 10 * u) % step;
    ctx.save();
    ctx.strokeStyle = kit.withAlpha('muted', 0.14);
    ctx.lineWidth = Math.max(1, u);
    ctx.beginPath();
    for (let x = -step + off; x < W + step; x += step) { ctx.moveTo(x, -H * 0.5); ctx.lineTo(x, H * 1.5); }
    for (let y = -step + off * 0.5; y < H + step; y += step) { ctx.moveTo(-W * 0.5, y); ctx.lineTo(W * 1.5, y); }
    ctx.stroke();
    ctx.restore();
  } else if (kind === 'dots') {
    const step = 48 * u, off = (t * drift * 8 * u) % step;
    ctx.save();
    ctx.fillStyle = kit.withAlpha('muted', 0.22);
    const r = 1.6 * u;
    for (let y = -step + off; y < H + step; y += step) for (let x = -step; x < W + step; x += step) {
      ctx.fillRect(x - r / 2, y - r / 2, r, r);
    }
    ctx.restore();
  } else if (kind === 'field') {
    // Slow contour lines: thin, low, never starting or stopping, so they give the
    // frame life without competing with what does start to move.
    ctx.save();
    ctx.strokeStyle = kit.withAlpha('accent', 0.1);
    ctx.lineWidth = Math.max(1, 1.2 * u);
    const lines = 14;
    for (let k = 0; k < lines; k++) {
      ctx.beginPath();
      const base = (k + 0.5) / lines * H;
      for (let x = -40 * u; x <= W + 40 * u; x += 24 * u) {
        const y = base + noise(x / (420 * u) + k * 1.7 + t * drift * 0.12, k) * 70 * u;
        x <= -40 * u ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}

// Positions a block of size (w, h) so that its anchor sits at (px, py).
function anchorOffset(anchor, w, h) {
  let ax = 0, ay = 0;
  if (anchor.includes('left')) ax = w / 2;
  if (anchor.includes('right')) ax = -w / 2;
  if (anchor.includes('top')) ay = h / 2;
  if (anchor.includes('bottom')) ay = -h / 2;
  return [ax, ay];
}

function drawLayer(kit, doc, L, t) {
  if (L.repeat && L.repeat.count > 1) { drawRepeated(kit, L, t, (one, tt) => drawLayer(kit, doc, one, tt)); return; }
  const { W, H, u } = kit;
  const s = layerState(L, t, u);
  if (!s.visible) return;
  const px = s.x * W, py = s.y * H;
  kit.tag(L.id);
  kit.push({ x: px + s.dx, y: py + s.dy, rotate: s.rotate, scale: s.scale, opacity: s.opacity });
  if (s.clip) {
    const cw = (L.w || 600) * u * 1.4, ch = (L.h || 300) * u * 1.4;
    const ctx = kit.ctx;
    ctx.beginPath();
    if (s.clip.from === 'left') ctx.rect(-cw / 2, -ch / 2, cw * s.clip.p, ch);
    else if (s.clip.from === 'top') ctx.rect(-cw / 2, -ch / 2, cw, ch * s.clip.p);
    else ctx.rect(-cw / 2 + cw * (1 - s.clip.p), -ch / 2, cw * s.clip.p, ch);
    ctx.clip();
  }
  switch (L.type) {
    case 'text': {
      const size = (s.size ?? L.size) * u;
      const maxW = L.maxWidth * W;
      let ax = 0;
      if (L.anchor.includes('left')) ax = 0;
      const baseline = L.anchor.includes('top') ? 'top' : L.anchor.includes('bottom') ? 'bottom' : 'middle';
      kit.text(L.text, ax, 0, {
        size, weight: L.weight, font: L.font, color: s.color, align: L.align, tracking: L.tracking,
        leading: L.leading, maxWidth: maxW, upper: L.upper, highlight: L.highlight,
        highlightColor: L.highlightColor, reveal: s.reveal, hold: s.hold, baseline,
        plate: L.plate ? { ...L.plate, padX: L.plate.padX * u, padY: L.plate.padY * u, radius: L.plate.radius * u } : null,
      });
      break;
    }
    case 'counter': {
      if (L.roll) { drawOdometer(kit, L, s, t, u); break; }
      const start = L.in.at ?? L.at;
      const p = resolveEase('outExpo')(clamp((t - start) / Math.max(0.001, L.count)));
      const v = mix(L.from, L.to, p);
      const label = L.prefix + kit.formatNumber(v, L.decimals, L.separator) + L.suffix;
      const baseline = L.anchor.includes('top') ? 'top' : L.anchor.includes('bottom') ? 'bottom' : 'middle';
      kit.text(label, 0, 0, { size: L.size * u, weight: L.weight, font: L.font, color: s.color, align: L.align, tracking: L.tracking, baseline, reveal: s.reveal });
      break;
    }
    case 'shape': drawShape(kit, L, s); break;
    case 'image': case 'video': {
      const w = (s.w ?? L.w) * u, h = (s.h ?? L.h) * u;
      const [ax, ay] = anchorOffset(L.anchor, w, h);
      // Footage is drawn from the frame the page sent for this layer.
      kit.image(L.type === 'video' ? `video:${L.id}` : L.asset, ax, ay, w, h, { fit: L.fit, radius: L.radius * u });
      break;
    }
    case 'bars': {
      const w = (s.w ?? L.w) * u, h = (s.h ?? L.h) * u;
      const [ax, ay] = anchorOffset(L.anchor, w, h);
      kit.bars(L.values, ax - w / 2, ay - h / 2, w, h, {
        progress: s.progress, labels: L.labels, max: L.max ?? undefined, gap: L.gap, orientation: L.orientation,
        showValues: L.showValues, labelSize: L.labelSize * u, color: s.color, track: L.track, decimals: L.decimals, suffix: L.suffix,
        font: doc.fonts.text,
      });
      break;
    }
    case 'line-chart': {
      const w = (s.w ?? L.w) * u, h = (s.h ?? L.h) * u;
      const [ax, ay] = anchorOffset(L.anchor, w, h);
      kit.lineChart(L.values, ax - w / 2, ay - h / 2, w, h, {
        progress: s.progress, color: s.color, width: L.strokeWidth * u, dots: L.dots, area: L.area,
        min: L.min ?? undefined, max: L.max ?? undefined,
      });
      break;
    }
    case 'group': {
      // Children are placed in frame fractions; the group's own transform pivots
      // on its (x, y), so undo that offset for them.
      kit.push({ x: -px, y: -py });
      for (const C of [...L.layers].sort((a, b) => a.z - b.z)) drawLayer(kit, doc, C, t);
      kit.pop();
      break;
    }
    default: break;
  }
  kit.pop();
  kit.tag(null);
}

function drawShape(kit, L, s) {
  const { u } = kit;
  const w = (s.w ?? L.w) * u, h = (s.h ?? L.h) * u;
  const fill = s.fill === undefined ? L.fill : s.fill;
  const stroke = s.stroke === undefined ? L.stroke : s.stroke;
  const sw = L.strokeWidth * u;
  const [ax, ay] = anchorOffset(L.anchor, w, h);
  const p = s.progress;
  switch (L.shape) {
    case 'rect': {
      if (L.in.preset === 'grow' && p < 1) {
        kit.rect(ax - w / 2, ay - h / 2, w * p, h, { fill, stroke, width: sw, radius: L.radius * u });
      } else if (L.in.preset === 'draw' && p < 1 && stroke) {
        const x0 = ax - w / 2, y0 = ay - h / 2;
        kit.polygon([[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]], { stroke, width: sw, progress: p });
      } else {
        kit.rect(ax - w / 2, ay - h / 2, w, h, { fill, stroke, width: sw, radius: L.radius * u });
      }
      break;
    }
    case 'circle': {
      const r = w / 2;
      if (L.in.preset === 'draw' && p < 1) kit.ring(ax, ay, r, { color: stroke || fill, width: sw, progress: p });
      else if (L.in.preset === 'grow' && p < 1) kit.circle(ax, ay, r * p, { fill, stroke, width: sw });
      else kit.circle(ax, ay, r, { fill, stroke, width: sw });
      break;
    }
    case 'ellipse':
      kit.ellipse(ax, ay, (w / 2) * (L.in.preset === 'grow' ? p : 1), (h / 2) * (L.in.preset === 'grow' ? p : 1), { fill, stroke, width: sw });
      break;
    // A line or arrow spans its w by h box, centred on its point like every shape.
    case 'line':
      kit.line(ax - w / 2, ay - h / 2, ax + w / 2, ay + h / 2, { color: stroke || fill || 'ink', width: sw, progress: p, cap: L.cap });
      break;
    case 'arrow':
      kit.arrow(ax - w / 2, ay - h / 2, ax + w / 2, ay + h / 2, { color: stroke || fill || 'ink', width: sw, progress: p, head: 18 * u });
      break;
    case 'ring':
      kit.ring(ax, ay, w / 2, { color: stroke || fill || 'accent', width: sw, from: L.arc[0], to: L.arc[1], progress: p, cap: L.cap });
      break;
    case 'polygon': {
      let pts = L.points.map(([x, y]) => [ax + x * u, ay + y * u]);
      if (pts.length < 3) {
        pts = [];
        for (let i = 0; i < L.sides; i++) {
          const a = -Math.PI / 2 + (i / L.sides) * Math.PI * 2;
          pts.push([ax + Math.cos(a) * w / 2, ay + Math.sin(a) * h / 2]);
        }
      }
      kit.polygon(pts, { fill: p >= 1 ? fill : null, stroke: stroke || (p < 1 ? fill : null), width: sw, progress: p });
      break;
    }
    case 'path':
      kit.path(L.d, { x: ax, y: ay, scale: u * (L.w ? 1 : 1), center: true, fill, stroke, width: sw, progress: p, cap: L.cap });
      break;
    default: break;
  }
}

// The narration's words on screen as they are said: the current phrase, the
// word being spoken in the accent colour, placed where the frame is clear (low
// in landscape, above the area phone apps cover in vertical).
export function captionAt(doc, t) {
  for (const line of doc.voice.lines) {
    const clip = line.clip ? doc.assets[line.clip] : null;
    if (!clip || !clip.words.length) continue;
    const S = doc.scenes.find((x) => x.id === line.scene);
    if (!S) continue;
    const t0 = S.start + line.at;
    const local = t - t0;
    const words = clip.words;
    if (local < words[0][1] - 0.05 || local > words[words.length - 1][2] + 0.35) continue;
    // Phrases of up to six words, broken after punctuation where possible.
    const phrases = [];
    let cur = [];
    words.forEach((w, i) => {
      cur.push(i);
      if (cur.length >= 6 || /[.,;:?!]$/.test(w[0])) { phrases.push(cur); cur = []; }
    });
    if (cur.length) phrases.push(cur);
    let current = -1;
    words.forEach((w, i) => { if (local >= w[1] - 0.02) current = i; });
    const phrase = phrases.find((p) => p.includes(Math.max(0, current))) || phrases[0];
    return { words: phrase.map((i) => words[i][0]), active: phrase.indexOf(current), local, end: words[phrase[phrase.length - 1]][2] };
  }
  return null;
}

function drawCaptions(kit, doc, t) {
  const c = captionAt(doc, t);
  if (!c) return;
  const { W, H, u } = kit;
  const vertical = H > W;
  const y = vertical ? H * 0.74 : H * 0.88;
  const text = c.words.join(' ');
  const size = (vertical ? 46 : 40) * u;
  const ctx = kit.ctx;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const L = kit.measureText(text, { size, weight: 600, font: 'sans' });
  const padX = 22 * u, padY = 12 * u;
  const x = vertical ? W * 0.463 : W / 2;
  kit.rect(x - L.width / 2 - padX, y - L.height / 2 - padY, L.width + padX * 2, L.height + padY * 2, { fill: 'rgba(0,0,0,0.55)', radius: 12 * u });
  kit.text(text, x, y, {
    size, weight: 600, font: 'sans', color: '#ffffff', align: 'center',
    highlight: c.active >= 0 ? [c.words[c.active]] : [], highlightColor: 'accent',
  });
  ctx.restore();
}

// Draws the whole frame. opts.collect: an array to receive drawn boxes.
export function renderPlan(kit, doc, t, opts = {}) {
  const { W, H } = kit;
  const ctx = kit.ctx;
  if (opts.collect) kit.collectInto(opts.collect);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = kit.color(doc.background.color || 'bg');
  ctx.fillRect(0, 0, W, H);

  // The last moment of the film holds its last frame instead of falling
  // past the end of the final scene.
  const alive = activeScenes(doc, Math.min(t, doc.duration - 1e-4));
  // Layers carried across a scene change: each scene leaves its half out
  // while the carrier is drawn, and the arriving layer stays put after.
  const carriers = [];
  const skip = new Set();
  for (const A of alive) {
    const pair = A.inKind === 'carry' ? carryPair(doc, A.index) : null;
    if (pair && A.inP < 1) { carriers.push({ pair, p: A.inP }); skip.add(pair.from.id); skip.add(pair.to.id); }
  }
  for (const A of alive) {
    const S = A.scene;
    ctx.save();
    let alpha = 1, dx = 0, dy = 0, scale = 1, clip = null, shade = 0;
    // Incoming transition.
    if (A.inP < 1) {
      const p = A.inP, [ux, uy] = DIR[A.inDir] || DIR.left;
      switch (A.inKind) {
        case 'fade': case 'carry': alpha *= p; break;
        case 'dip': alpha *= clamp(p * 2 - 1); break;
        case 'push': case 'slide': dx += -ux * (1 - p) * W; dy += -uy * (1 - p) * H; break;
        case 'zoom': alpha *= p; scale *= 0.86 + 0.14 * p; break;
        case 'wipe': clip = { p, ux, uy }; break;
        default: break;
      }
    }
    // Outgoing transition.
    if (A.outKind) {
      const p = A.outP, [ux, uy] = DIR[A.outDir] || DIR.left;
      switch (A.outKind) {
        case 'dip': alpha *= clamp(1 - p * 2); break;
        case 'carry': alpha *= 1 - p; break;
        case 'push': dx += ux * p * W; dy += uy * p * H; break;
        case 'slide': scale *= 1 - 0.05 * p; shade = 0.45 * p; break;
        case 'zoom': alpha *= 1 - p; scale *= 1 + 0.22 * p; break;
        default: break;
      }
    }
    if (alpha <= 0.001) { ctx.restore(); continue; }
    ctx.globalAlpha = alpha;
    if (clip) {
      ctx.beginPath();
      const { p, ux, uy } = clip;
      // The new scene uncovers from the side the wipe travels from.
      if (ux) ctx.rect(ux < 0 ? W * (1 - p) : 0, 0, W * p, H);
      else ctx.rect(0, uy < 0 ? H * (1 - p) : 0, W, H * p);
      ctx.clip();
    }
    ctx.translate(W / 2 + dx, H / 2 + dy);
    ctx.scale(scale, scale);
    ctx.translate(-W / 2, -H / 2);
    drawBackgroundLayer(kit, doc, S, t);

    // The scene's camera: a slow push or pan across its whole length.
    const cp = resolveEase(S.camera.ease)(clamp(A.local / S.duration));
    const z = mix(S.camera.zoom[0], S.camera.zoom[1], cp);
    const cx = mix(S.camera.x[0], S.camera.x[1], cp) * W, cy = mix(S.camera.y[0], S.camera.y[1], cp) * H;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(z, z);
    ctx.translate(-W / 2 - cx, -H / 2 - cy);
    const arrivedId = S.transition.kind === 'carry' && carryPair(doc, A.index) ? S.transition.carry.to : null;
    for (const L of [...S.layers].sort((a, b) => a.z - b.z)) {
      if (skip.has(L.id)) continue;
      drawLayer(kit, doc, L.id === arrivedId ? arrived(L) : L, A.local);
    }
    ctx.restore();

    if (shade > 0) {
      ctx.fillStyle = `rgba(0,0,0,${shade})`;
      ctx.fillRect(-W * 0.5, -H * 0.5, W * 2, H * 2);
    }
    ctx.restore();
    // A hairline on the wipe's edge, in the accent.
    if (clip && clip.p > 0 && clip.p < 1) {
      ctx.save();
      ctx.fillStyle = kit.color('accent');
      const lw = Math.max(2, 3 * kit.u);
      if (clip.ux) ctx.fillRect(clip.ux < 0 ? W * (1 - clip.p) - lw / 2 : W * clip.p - lw / 2, 0, lw, H);
      else ctx.fillRect(0, clip.uy < 0 ? H * (1 - clip.p) - lw / 2 : H * clip.p - lw / 2, W, lw);
      ctx.restore();
    }
  }

  for (const c of carriers) drawCarrier(kit, doc, c.pair, t, c.p, drawLayer);

  if (doc.voice && doc.voice.captions) drawCaptions(kit, doc, t);
  if (doc.background.kind === 'grain') kit.grain(t, 0.045);
  if (doc.background.kind === 'vignette' || doc.background.kind === 'grain') kit.vignette(doc.background.kind === 'vignette' ? 0.55 : 0.3);
  ctx.restore();
  if (opts.collect) kit.collectInto(null);
}
