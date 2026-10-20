// What a layer looks like at a moment: its entrance, its hold and its exit,
// worked out as numbers the renderer applies.
//
// Every preset named in format.js is defined here and nowhere else. The checks
// read IN_PRESETS and OUT_PRESETS and fail if one of them is not handled.

import { resolveEase } from './ease.js';
import { clamp, keys, noise } from './math.js';
import { wordCount } from '../scene/format.js';

// How many units a text reveal staggers over, so the entrance knows when it ends.
function units(L, preset) {
  if (L.type !== 'text') return 1;
  if (preset === 'letters' || preset === 'type') return L.text.replace(/\s+/g, ' ').length + 1;
  if (preset === 'words') return wordCount(L.text);
  if (preset === 'mask-up' || preset === 'mask-down') return L.text.split('\n').length + Math.floor(L.text.length / 40);
  return 1;
}

// When the entrance starts and ends, in scene time.
export function entranceSpan(L) {
  const start = L.in.at ?? L.at;
  const n = units(L, L.in.preset);
  const stag = ['letters', 'words', 'type', 'mask-up'].includes(L.in.preset) ? L.in.stagger * (n - 1) : 0;
  const dur = L.in.preset === 'type' ? stag + 0.05 : L.in.duration + stag;
  return { start, end: start + (L.in.preset === 'none' ? 0 : dur) };
}

// When the exit starts and ends, in scene time. No exit means the layer holds to
// `until` and leaves with its scene.
export function exitSpan(L) {
  if (L.out.preset === 'none' || L.out.duration <= 0) return { start: L.until, end: L.until };
  const start = L.out.at ?? Math.max(L.at, L.until - L.out.duration);
  return { start, end: Math.min(L.until, start + L.out.duration) };
}

// The state of layer L at scene time t. `u` scales distances to the frame.
export function layerState(L, t, u = 1) {
  const st = {
    visible: false, opacity: L.opacity, dx: 0, dy: 0, scale: L.scale, rotate: L.rotate,
    x: L.x, y: L.y, progress: 1, reveal: null, clip: null, hold: null, color: L.color,
    size: L.size, w: L.w, h: L.h, fill: L.fill, stroke: L.stroke,
  };
  if (t < L.at || t > L.until) return st;

  // Keyframes set the base values; motion presets add to them.
  if (L.keys) {
    for (const prop of Object.keys(L.keys)) {
      const v = keys(t, L.keys[prop]);
      if (v === undefined) continue;
      if (prop === 'opacity') st.opacity = v * L.opacity;
      else if (prop === 'progress') st.progress = clamp(v);
      else st[prop] = v;
    }
  }

  const ins = entranceSpan(L);
  const outs = exitSpan(L);
  const dist = (L.in.distance || 40) * u;

  // ---- entrance
  if (t < ins.start) return st;
  st.visible = true;
  const inPreset = L.in.preset;
  const inLocal = t - ins.start;
  const pin = L.in.duration > 0 ? resolveEase(L.in.ease)(clamp(inLocal / L.in.duration)) : 1;
  switch (inPreset) {
    case 'fade': st.opacity *= pin; break;
    case 'rise': st.opacity *= clamp(pin * 1.4); st.dy += (1 - pin) * dist; break;
    case 'drop': st.opacity *= clamp(pin * 1.4); st.dy -= (1 - pin) * dist; break;
    case 'slide-left': st.opacity *= clamp(pin * 1.6); st.dx += (1 - pin) * dist * 2.5; break;
    case 'slide-right': st.opacity *= clamp(pin * 1.6); st.dx -= (1 - pin) * dist * 2.5; break;
    case 'scale': st.opacity *= clamp(pin * 1.5); st.scale *= 0.88 + 0.12 * pin; break;
    case 'focus': st.opacity *= pin; st.scale *= 1.07 - 0.07 * pin; break;
    // A short rise out of nothing that settles: fades in a little ahead of
    // its move, travels under half the usual distance, and grows the last
    // percent and a half into place.
    case 'soft': st.opacity *= clamp(pin * 1.25); st.dy += (1 - pin) * dist * 0.45; st.scale *= 0.985 + 0.015 * pin; break;
    case 'letters': case 'words': case 'type': case 'mask-up':
      if (L.type === 'text') st.reveal = { mode: inPreset, time: inLocal, duration: L.in.duration, stagger: L.in.stagger, ease: L.in.ease, distance: dist };
      else { st.opacity *= pin; st.dy += (1 - pin) * dist; }
      break;
    case 'wipe':
      if (L.type === 'text') st.reveal = { mode: 'wipe', time: inLocal, duration: L.in.duration, ease: L.in.ease };
      else st.clip = { from: 'left', p: pin };
      break;
    case 'draw': st.progress = Math.min(st.progress, pin); break;
    case 'grow': st.progress = Math.min(st.progress, pin); break;
    default: break;
  }

  // ---- hold
  const holdT = t - ins.end;
  if (holdT >= 0 && L.hold !== 'none') {
    if (L.hold === 'float') { st.dy += noise(t * 0.35, L.id.length) * 6 * u; st.dx += noise(t * 0.27, L.id.length + 9) * 4 * u; }
    else if (L.hold === 'drift') { st.scale *= 1 + Math.min(holdT, 8) * 0.004; }
    else if (L.hold === 'underline' || L.hold === 'marker') st.hold = { mode: L.hold, p: resolveEase('outExpo')(clamp((holdT - 0.1) / 0.6)) };
    else if (L.hold === 'shimmer') st.hold = { mode: 'shimmer', p: holdT / 2.6 };
  }

  // ---- exit
  if (L.out.preset !== 'none' && t >= outs.start) {
    const pout = resolveEase(L.out.ease)(clamp((t - outs.start) / Math.max(0.001, outs.end - outs.start)));
    const od = (L.out.distance || 30) * u;
    switch (L.out.preset) {
      case 'fade': st.opacity *= 1 - pout; break;
      case 'rise': st.opacity *= 1 - pout; st.dy -= pout * od; break;
      case 'soft': st.opacity *= 1 - pout; st.dy -= pout * od * 0.3; break;
      case 'fall': st.opacity *= 1 - pout; st.dy += pout * od; break;
      case 'slide-left': st.opacity *= 1 - pout; st.dx -= pout * od * 2.5; break;
      case 'slide-right': st.opacity *= 1 - pout; st.dx += pout * od * 2.5; break;
      case 'scale': st.opacity *= 1 - pout; st.scale *= 1 - 0.1 * pout; break;
      case 'focus': st.opacity *= 1 - pout; st.scale *= 1 + 0.06 * pout; break;
      case 'mask-down':
        if (L.type === 'text') st.reveal = { mode: 'mask-down', time: t - outs.start, duration: outs.end - outs.start, stagger: 0.04, ease: L.out.ease, exit: true };
        else { st.opacity *= 1 - pout; st.dy -= pout * od; }
        break;
      case 'wipe':
        if (L.type === 'text') st.reveal = { mode: 'wipe', time: (outs.end - outs.start) - (t - outs.start), duration: outs.end - outs.start, ease: 'linear' };
        else st.clip = { from: 'right', p: 1 - pout };
        break;
      default: break;
    }
  }
  if (st.opacity <= 0.001) st.visible = false;
  return st;
}
