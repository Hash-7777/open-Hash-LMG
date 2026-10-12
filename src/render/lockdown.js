// The walls around model-written drawing code, put up inside the render worker
// before that code is loaded.
//
// A worker already has no page, no cookies and no access to the app's stored
// keys. This takes away the rest of what drawing has no use for: every way to
// reach the network, every kind of storage a worker can open, starting more
// threads, building code from text, and the real clock and random numbers
// (replaced, so frames come out identical every time).
//
// It returns the few capabilities the worker's own harness still needs, taken
// before they are removed. scripts/checks/lockdown.mjs runs this in a stand-in
// global and fails naming anything that is still reachable.

export function lockdown(scope, { seed = 7 } = {}) {
  const keep = {
    post: scope.postMessage.bind(scope),
    makeUrl: scope.URL && scope.URL.createObjectURL ? scope.URL.createObjectURL.bind(scope.URL) : null,
    dropUrl: scope.URL && scope.URL.revokeObjectURL ? scope.URL.revokeObjectURL.bind(scope.URL) : null,
    Blob: scope.Blob,
  };

  const remove = [
    'fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'EventSource', 'WebTransport',
    'importScripts', 'Worker', 'SharedWorker', 'BroadcastChannel', 'MessageChannel',
    'indexedDB', 'caches', 'CacheStorage', 'storage', 'cookieStore', 'localStorage', 'sessionStorage',
    'eval', 'Request', 'Response', 'Headers', 'navigator', 'FileReader', 'FileReaderSync',
    'RTCPeerConnection', 'WebAssembly', 'SharedArrayBuffer', 'Atomics', 'postMessage', 'close',
    'requestAnimationFrame', 'setTimeout', 'setInterval', 'queueMicrotask', 'Blob', 'URL', 'Function',
  ];
  const gone = [];
  for (const name of remove) {
    // Own properties and the prototype chain's both: in a worker most of these
    // live on WorkerGlobalScope.prototype, not on the global itself.
    let obj = scope;
    let guard = 0;
    while (obj && guard++ < 8) {
      if (Object.prototype.hasOwnProperty.call(obj, name)) {
        try { Object.defineProperty(obj, name, { value: undefined, writable: false, configurable: false }); } catch {
          try { delete obj[name]; } catch { /* left; the check reports it */ }
        }
      }
      obj = Object.getPrototypeOf(obj);
    }
    gone.push(name);
  }

  // Building code from text through a function's constructor: closed for
  // plain, async and generator functions alike.
  const ctorOf = (src) => { try { return Object.getPrototypeOf(src).constructor; } catch { return null; } };
  for (const fn of [function a() {}, async function b() {}, function* c() {}, async function* d() {}]) {
    const proto = Object.getPrototypeOf(fn);
    const Ctor = ctorOf(fn);
    try { Object.defineProperty(proto, 'constructor', { value: undefined, writable: false, configurable: false }); } catch { /* reported by the check */ }
    if (Ctor && Ctor.prototype) {
      try { Object.defineProperty(Ctor.prototype, 'constructor', { value: undefined, writable: false, configurable: false }); } catch { /* same */ }
    }
  }

  // A clock that never moves and random numbers from a seed.
  let s = (Math.floor(seed * 9973) ^ 0x5bd1e995) >>> 0;
  const seeded = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  try { Object.defineProperty(Math, 'random', { value: seeded, writable: false, configurable: false }); } catch { /* reported */ }
  try { Object.defineProperty(Date, 'now', { value: () => 0, writable: false, configurable: false }); } catch { /* reported */ }
  if (scope.performance) {
    try { Object.defineProperty(scope.performance, 'now', { value: () => 0, writable: false, configurable: false }); } catch { /* reported */ }
  }
  return { keep, gone };
}

// Names the check expects to be unreachable after lockdown.
export const MUST_BE_GONE = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'Worker', 'indexedDB', 'caches', 'eval', 'postMessage', 'setTimeout', 'Function'];
