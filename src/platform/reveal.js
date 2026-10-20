// The desktop window starts hidden so it can be placed before it is seen
// (src/platform/window.js). If the editor fails before it gets that far, this
// shows the window anyway, so a broken start is never an invisible one. It is
// a separate module on purpose: an error in the editor's modules cannot stop
// it loading.

const internals = globalThis.__TAURI_INTERNALS__;
if (internals && typeof internals.invoke === 'function') {
  setTimeout(() => { internals.invoke('plugin:window|show').catch(() => {}); }, 4000);
}
