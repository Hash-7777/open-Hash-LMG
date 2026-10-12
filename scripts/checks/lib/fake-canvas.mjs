// A stand-in 2D canvas for the checks. Node has no canvas, and the checks need
// to run the real renderer: this records every call, keeps a real transform
// stack so measured boxes come out where a browser would put them, and measures
// text with a fixed advance per character so results are the same everywhere.

export function fakeContext(width = 1920, height = 1080) {
  const calls = [];
  let m = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const state = { globalAlpha: 1, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px sans-serif', textAlign: 'left', textBaseline: 'alphabetic', lineCap: 'butt', lineJoin: 'miter', imageSmoothingEnabled: true, imageSmoothingQuality: 'low', globalCompositeOperation: 'source-over' };
  const mul = (a, b) => [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
  const sizeOf = () => parseFloat((state.font.match(/(\d+(?:\.\d+)?)px/) || [0, 10])[1]);
  const ctx = {
    canvas: { width, height },
    calls,
    save() { stack.push({ m: [...m], s: { ...state } }); },
    restore() { const top = stack.pop(); if (top) { m = top.m; Object.assign(state, top.s); } },
    translate(x, y) { m = mul(m, [1, 0, 0, 1, x, y]); },
    scale(x, y) { m = mul(m, [x, 0, 0, y, 0, 0]); },
    rotate(a) { const c = Math.cos(a), s = Math.sin(a); m = mul(m, [c, s, -s, c, 0, 0]); },
    setTransform(a, b, c, d, e, f) { m = [a, b, c, d, e, f]; },
    getTransform() { return { a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] }; },
    measureText(s) { return { width: String(s).length * sizeOf() * 0.55 }; },
    fillText(s, x, y) {
      for (const v of [x, y]) if (!Number.isFinite(v)) throw new Error(`fillText at a non-finite position: ${s}`);
      calls.push(['fillText', s, x, y, state.globalAlpha]);
    },
    fillRect(x, y, w, h) {
      for (const v of [x, y, w, h]) if (!Number.isFinite(v)) throw new Error('fillRect with a non-finite value');
      calls.push(['fillRect', x, y, w, h]);
    },
    strokeRect() {}, clearRect() {},
    beginPath() {}, closePath() {},
    moveTo(x, y) { if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('moveTo with a non-finite value'); },
    lineTo(x, y) { if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('lineTo with a non-finite value'); },
    arc() {}, arcTo() {}, ellipse(x, y, rx, ry) { if (rx < 0 || ry < 0) throw new Error('negative ellipse radius'); },
    rect() {}, quadraticCurveTo() {}, bezierCurveTo() {},
    fill() { calls.push(['fill']); }, stroke() { calls.push(['stroke']); }, clip() {},
    drawImage() { calls.push(['drawImage']); },
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    createPattern() { return null; },
    createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
    putImageData() {},
  };
  for (const k of Object.keys(state)) {
    Object.defineProperty(ctx, k, { get: () => state[k], set: (v) => { state[k] = v; }, enumerable: true });
  }
  return ctx;
}
