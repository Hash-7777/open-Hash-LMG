// Where the desktop app's window opens, and how big.
//
// The window starts hidden (tauri.conf.json), is placed here, and only then
// shown, so it never jumps. Its place and size are remembered when it moves
// or is resized and restored at the next start, with three guards:
//
//   - the size is capped at the screen's work area, title bar and frame
//     included, so the whole window fits;
//   - a saved place is used only when the title bar would be on a screen that
//     is still connected; otherwise the window is centred;
//   - maximised is remembered, and the ordinary bounds it returns to are the
//     last ordinary ones.
//
// A first start is a little smaller than the screen and centred: an ordinary
// window, not a maximised one.

const STATE_KEY = 'lmg.window.v1';

// tauri.conf.json minWidth and minHeight.
export const MIN_LOGICAL = { w: 760, h: 540 };
const REACH_W = 160; // pixels of title bar that must be on a screen
const REACH_H = 48; // and the height of that strip
const FIRST_MARGIN = { x: 24, y: 16 };

// Where the window goes, as numbers only, so the checks run it against real
// screen layouts.
//   saved  { x, y, width, height, maximized }, any part missing
//   now    { width, height }, the inner size it has now
//   pad    { w, h }, the frame: outer minus inner
//   areas  every screen's work area { x, y, w, h }
//   here   the work area it is on now
//   scale  that screen's scale factor
// Returns { x, y, width, height, maximized } in physical pixels, or null.
export function planWindow({ saved, now, pad, areas, here, scale }) {
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  const reachable = (x, y, w, h, a) => {
    const bar = Math.min(REACH_H, h);
    const across = Math.min(x + w, a.x + a.w) - Math.max(x, a.x);
    return across >= Math.min(REACH_W, w) && y >= a.y && y + bar <= a.y + a.h;
  };
  if (!here || !now || !(now.width > 0) || !(now.height > 0)) return null;
  const p = pad || { w: 0, h: 0 };
  const choseSize = Boolean(saved && saved.width > 0 && saved.height > 0);
  const chosePlace = Boolean(saved && Number.isFinite(saved.x) && Number.isFinite(saved.y));
  let outerW = (choseSize ? saved.width : now.width) + p.w;
  let outerH = (choseSize ? saved.height : now.height) + p.h;

  let area = here;
  let place = null;
  if (chosePlace) {
    const home = (areas || []).find((a) => reachable(saved.x, saved.y, outerW, outerH, a));
    if (home) { area = home; place = { x: saved.x, y: saved.y }; }
  }

  const margin = choseSize ? { x: 0, y: 0 } : FIRST_MARGIN;
  const minW = Math.round(MIN_LOGICAL.w * (scale || 1)) + p.w;
  const minH = Math.round(MIN_LOGICAL.h * (scale || 1)) + p.h;
  outerW = Math.min(area.w, Math.max(Math.min(minW, area.w), Math.min(outerW, area.w - 2 * margin.x)));
  outerH = Math.min(area.h, Math.max(Math.min(minH, area.h), Math.min(outerH, area.h - 2 * margin.y)));

  const x = place ? clamp(place.x, area.x, area.x + area.w - outerW) : Math.round(area.x + (area.w - outerW) / 2);
  const y = place ? clamp(place.y, area.y, area.y + area.h - outerH) : Math.round(area.y + (area.h - outerH) / 2);
  return { x, y, width: Math.max(1, outerW - p.w), height: Math.max(1, outerH - p.h), maximized: Boolean(saved && saved.maximized) };
}

// What was saved, if anything usable.
export function readSaved(storage) {
  let s = null;
  try { s = JSON.parse(storage.getItem(STATE_KEY) || 'null'); } catch { s = null; }
  if (!s || typeof s !== 'object') return null;
  const out = {};
  if (Number.isFinite(s.x) && Number.isFinite(s.y)) { out.x = Math.round(s.x); out.y = Math.round(s.y); }
  if (s.width > 0 && s.height > 0) { out.width = Math.round(s.width); out.height = Math.round(s.height); }
  out.maximized = Boolean(s.maximized);
  return out.x !== undefined || out.width !== undefined || out.maximized ? out : null;
}

const areaOf = (m) => {
  const a = m && m.workArea;
  if (!a || !a.position || !a.size || !(a.size.width > 0) || !(a.size.height > 0)) return null;
  return { x: a.position.x, y: a.position.y, w: a.size.width, h: a.size.height };
};

// Places the window, then shows it, then keeps its place. Never throws: a
// window that cannot be measured is centred and shown as it is.
export async function initWindow(invoke, storage) {
  const call = async (cmd, args) => { try { return await invoke(cmd, args); } catch { return null; } };
  let lastNormal = null;

  const measure = async () => {
    if (await call('plugin:window|is_minimized')) return null;
    if (await call('plugin:window|is_maximized')) return { maximized: true };
    const pos = await call('plugin:window|outer_position');
    const size = await call('plugin:window|inner_size');
    if (!pos || !size || !(size.width >= 200) || !(size.height >= 150)) return null;
    if (pos.x <= -30000 || pos.y <= -30000) return null;
    return { x: pos.x, y: pos.y, width: size.width, height: size.height, maximized: false };
  };
  const save = async () => {
    const now = await measure();
    if (!now) return;
    if (!now.maximized) lastNormal = now;
    const keep = now.maximized ? (lastNormal || {}) : now;
    try { storage.setItem(STATE_KEY, JSON.stringify({ ...keep, maximized: Boolean(now.maximized) })); } catch { /* a convenience only */ }
  };
  let timer = 0;
  const saveSoon = () => { clearTimeout(timer); timer = setTimeout(save, 400); };

  try {
    const list = await call('plugin:window|available_monitors');
    const areas = (Array.isArray(list) ? list : []).map(areaOf).filter(Boolean);
    const here = areaOf(await call('plugin:window|current_monitor')) || areas[0] || null;
    const outer = await call('plugin:window|outer_size');
    const inner = await call('plugin:window|inner_size');
    const pad = outer && inner && outer.width >= inner.width && outer.height >= inner.height ? { w: outer.width - inner.width, h: outer.height - inner.height } : { w: 0, h: 0 };
    const scale = Number(await call('plugin:window|scale_factor')) || 1;
    const plan = planWindow({ saved: readSaved(storage), now: inner, pad, areas, here, scale });
    if (plan) {
      if (!inner || plan.width !== inner.width || plan.height !== inner.height) {
        await call('plugin:window|set_size', { value: { Physical: { width: plan.width, height: plan.height } } });
      }
      await call('plugin:window|set_position', { value: { Physical: { x: plan.x, y: plan.y } } });
      lastNormal = { x: plan.x, y: plan.y, width: plan.width, height: plan.height, maximized: false };
      if (plan.maximized) await call('plugin:window|maximize');
    } else {
      await call('plugin:window|center');
    }
  } finally {
    await call('plugin:window|show');
  }

  // Moving and resizing are heard through the app's events, and a short wait
  // folds a drag into one write. Where events cannot be heard, a slow look
  // stands in for them.
  const internals = globalThis.__TAURI_INTERNALS__;
  let listening = false;
  if (internals && typeof internals.transformCallback === 'function') {
    try {
      const handler = internals.transformCallback(() => saveSoon());
      await Promise.all(['tauri://move', 'tauri://resize'].map((event) => invoke('plugin:event|listen', { event, target: { kind: 'Any' }, handler })));
      listening = true;
    } catch { listening = false; }
  }
  if (!listening) setInterval(() => { if (!document.hidden) saveSoon(); }, 3000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
}
